from datetime import datetime, timezone
from typing import List, Optional

from fastapi import HTTPException
from sqlmodel import Session, select

from entities.tools import Tool, ToolLoan, ToolLoanItem
from entities.users import User
from loggiing import logger
from . import model


# ── Helpers ──────────────────────────────────────────────────────────────────

def _tool_to_response(tool: Tool) -> model.ToolResponse:
    return model.ToolResponse(
        toolId=tool.toolId,
        name=tool.name,
        description=tool.description,
        status=tool.status,
    )


def _user_display_name(db: Session, user_id) -> Optional[str]:
    if not user_id:
        return None
    user = db.get(User, user_id)
    if not user:
        return None
    return f"{user.firstName} {user.secondName}".strip() if user.secondName else user.firstName


def _loan_to_response(loan: ToolLoan, db: Session) -> model.ToolLoanResponse:
    tool_ids = [item.tool_id for item in loan.items]
    tools_cache = {}
    if tool_ids:
        tools = db.exec(select(Tool).where(Tool.toolId.in_(tool_ids))).all()
        tools_cache = {t.toolId: t for t in tools}

    items = [
        model.ToolLoanItemResponse(
            itemId=item.itemId,
            toolId=item.tool_id,
            toolName=tools_cache[item.tool_id].name if item.tool_id in tools_cache else "Unknown Tool",
            returned=item.returned,
            returned_at=item.returned_at.isoformat() if item.returned_at else None,
            defect_note=item.defect_note,
        )
        for item in loan.items
    ]

    return model.ToolLoanResponse(
        loanId=loan.loanId,
        workerName=loan.workerName,
        issued_by=_user_display_name(db, loan.issued_by),
        issued_at=loan.issued_at.isoformat() if loan.issued_at else "",
        returned_by=_user_display_name(db, loan.returned_by),
        returned_at=loan.returned_at.isoformat() if loan.returned_at else None,
        status=loan.status,
        notes=loan.notes,
        items=items,
    )


# ── Tool Catalog ─────────────────────────────────────────────────────────────

def create_tool(data: model.ToolCreate, db: Session) -> model.ToolResponse:
    try:
        tool = Tool(
            name=data.name,
            description=data.description,
            status=data.status or "available",
        )
        db.add(tool)
        db.commit()
        db.refresh(tool)
        logger.info(f"Tool '{tool.name}' (id={tool.toolId}) added to catalog.")
        return _tool_to_response(tool)
    except Exception as e:
        db.rollback()
        logger.error(f"Error creating tool: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail="Failed to create tool")


def update_tool(tool_id: int, data: model.ToolUpdate, db: Session) -> model.ToolResponse:
    tool = db.get(Tool, tool_id)
    if not tool:
        raise HTTPException(status_code=404, detail="Tool not found")

    if data.status and data.status not in ("available", "non_functional"):
        raise HTTPException(
            status_code=400,
            detail="Status can only be set to 'available' or 'non_functional' here — "
                   "'taken' is managed automatically by checkout/return.",
        )

    update_dict = data.model_dump(exclude_unset=True)
    for key, value in update_dict.items():
        setattr(tool, key, value)

    db.add(tool)
    db.commit()
    db.refresh(tool)
    return _tool_to_response(tool)


def get_all_tools(db: Session, status_filter: Optional[str] = None) -> List[model.ToolResponse]:
    stmt = select(Tool).order_by(Tool.name)
    if status_filter:
        stmt = stmt.where(Tool.status == status_filter)
    return [_tool_to_response(t) for t in db.exec(stmt).all()]


# ── Loans ────────────────────────────────────────────────────────────────────

def create_loan(data: model.ToolLoanCreate, db: Session, current_user) -> model.ToolLoanCreateResponse:
    try:
        if not data.toolIds:
            raise HTTPException(status_code=422, detail="Select at least one tool")
        if not data.workerName or not data.workerName.strip():
            raise HTTPException(status_code=422, detail="Worker name is required")

        tools = db.exec(select(Tool).where(Tool.toolId.in_(data.toolIds))).all()
        tools_by_id = {t.toolId: t for t in tools}

        missing = [tid for tid in data.toolIds if tid not in tools_by_id]
        if missing:
            raise HTTPException(status_code=404, detail=f"Tool id(s) not found: {missing}")

        unavailable = [t.name for t in tools_by_id.values() if t.status != "available"]
        if unavailable:
            raise HTTPException(
                status_code=400,
                detail=f"These tools are not available to check out: {', '.join(unavailable)}",
            )

        loan = ToolLoan(
            workerName=data.workerName.strip(),
            issued_by=current_user.userId,
            status="out",
            notes=data.notes,
        )
        db.add(loan)
        db.flush()  # generate loanId

        for tool_id in data.toolIds:
            db.add(ToolLoanItem(loan_id=loan.loanId, tool_id=tool_id, returned=False))
            tools_by_id[tool_id].status = "taken"
            db.add(tools_by_id[tool_id])

        db.commit()
        logger.info(
            f"Tool loan {loan.loanId} created for worker '{loan.workerName}' "
            f"({len(data.toolIds)} tool(s)) by {current_user.userId}."
        )
        return model.ToolLoanCreateResponse(message="Tools checked out successfully", loanId=loan.loanId)
    except HTTPException:
        raise
    except Exception as e:
        db.rollback()
        logger.error(f"Error creating tool loan: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail="Failed to check out tools")


def get_all_loans(
    db: Session,
    status_filter: Optional[str] = None,
    worker: Optional[str] = None,
    skip: int = 0,
    limit: int = 100,
) -> List[model.ToolLoanResponse]:
    stmt = select(ToolLoan).order_by(ToolLoan.issued_at.desc()).offset(skip).limit(limit)
    if status_filter:
        stmt = stmt.where(ToolLoan.status == status_filter)
    if worker:
        stmt = stmt.where(ToolLoan.workerName.ilike(f"%{worker}%"))
    loans = db.exec(stmt).all()
    return [_loan_to_response(loan, db) for loan in loans]


def process_return(loan_id: int, data: model.ToolReturnRequest, db: Session, current_user) -> model.ToolReturnResponse:
    try:
        loan = db.get(ToolLoan, loan_id)
        if not loan:
            raise HTTPException(status_code=404, detail="Loan not found")
        if not data.items:
            raise HTTPException(status_code=422, detail="No tools specified for return")

        items_by_tool_id = {item.tool_id: item for item in loan.items}

        for ret in data.items:
            loan_item = items_by_tool_id.get(ret.toolId)
            if not loan_item or loan_item.returned:
                continue  # already returned or not part of this loan — skip silently

            loan_item.returned = True
            loan_item.returned_at = datetime.now(timezone.utc)
            loan_item.defect_note = ret.defectNote
            db.add(loan_item)

            tool = db.get(Tool, ret.toolId)
            if tool:
                if ret.defectNote:
                    tool.description = ret.defectNote
                tool.status = "non_functional" if ret.markNonFunctional else "available"
                db.add(tool)

        db.flush()
        db.refresh(loan)

        all_returned = all(item.returned for item in loan.items)
        if all_returned:
            loan.status = "returned"
            loan.returned_at = datetime.now(timezone.utc)
            loan.returned_by = current_user.userId
        else:
            loan.status = "partially_returned"
        db.add(loan)

        db.commit()
        logger.info(f"Tool loan {loan_id} return processed by {current_user.userId} — status={loan.status}.")
        return model.ToolReturnResponse(message="Return processed", loanStatus=loan.status)
    except HTTPException:
        raise
    except Exception as e:
        db.rollback()
        logger.error(f"Error processing tool return: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail="Failed to process return")
