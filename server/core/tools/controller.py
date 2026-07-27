from fastapi import APIRouter, Depends, Query, BackgroundTasks
from typing import List, Optional
from sqlmodel import Session
from db.database import get_session
from core.userManagement.authService import get_current_user
from ws.manager import manager
from utils import require_role
from . import model, service

router = APIRouter(prefix="/tools", tags=["Tools"])

# ---------------------------------------------------------------------------
# Static / non-parameterised routes FIRST (avoids shadowing by /{tool_id})
# ---------------------------------------------------------------------------

@router.get("/", response_model=List[model.ToolResponse])
def list_tools(
    status: Optional[str] = Query(None, description="Filter by status: available|taken|non_functional"),
    db: Session = Depends(get_session),
    current_user=Depends(get_current_user),
):
    """Tool catalog — visible to everyone so cashiers can see what's available to check out."""
    return service.get_all_tools(db, status)


@router.post("/", response_model=model.ToolResponse)
async def create_tool(
    data: model.ToolCreate,
    background_tasks: BackgroundTasks,
    db: Session = Depends(get_session),
    current_user=Depends(get_current_user),
):
    require_role(["manager"], current_user)
    result = service.create_tool(data, db)
    background_tasks.add_task(manager.broadcast, "tools_updated")
    return result


@router.get("/loans", response_model=List[model.ToolLoanResponse])
def list_loans(
    status: Optional[str] = Query(None, description="Filter by status: out|partially_returned|returned"),
    worker: Optional[str] = Query(None, description="Filter by worker name (partial match)"),
    skip: int = 0,
    limit: int = 100,
    db: Session = Depends(get_session),
    current_user=Depends(get_current_user),
):
    require_role(["manager", "cashier", "ceo", "admin"], current_user)
    return service.get_all_loans(db, status, worker, skip, limit)


@router.post("/loans", response_model=model.ToolLoanCreateResponse)
async def create_loan(
    data: model.ToolLoanCreate,
    background_tasks: BackgroundTasks,
    db: Session = Depends(get_session),
    current_user=Depends(get_current_user),
):
    require_role(["manager", "cashier", "ceo", "admin"], current_user)
    result = service.create_loan(data, db, current_user)
    background_tasks.add_task(manager.broadcast, "tools_updated")
    return result


@router.put("/loans/{loan_id}/return", response_model=model.ToolReturnResponse)
async def return_loan_items(
    loan_id: int,
    data: model.ToolReturnRequest,
    background_tasks: BackgroundTasks,
    db: Session = Depends(get_session),
    current_user=Depends(get_current_user),
):
    require_role(["manager", "cashier", "ceo", "admin"], current_user)
    result = service.process_return(loan_id, data, db, current_user)
    background_tasks.add_task(manager.broadcast, "tools_updated")
    return result


# ---------------------------------------------------------------------------
# Parameterised routes (/{tool_id} must come after static paths)
# ---------------------------------------------------------------------------

@router.put("/{tool_id}", response_model=model.ToolResponse)
async def update_tool(
    tool_id: int,
    data: model.ToolUpdate,
    background_tasks: BackgroundTasks,
    db: Session = Depends(get_session),
    current_user=Depends(get_current_user),
):
    require_role(["manager"], current_user)
    result = service.update_tool(tool_id, data, db)
    background_tasks.add_task(manager.broadcast, "tools_updated")
    return result
