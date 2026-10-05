"""
Order change history, and the Undo / Correct-cut-answers actions on it (managers and CEO).

Thin API layer over core/audit/undo.py: role and PIN checks, previews run in a SAVEPOINT and
rolled back, and the real actions committed as one transaction.
"""
from typing import Optional

from fastapi import HTTPException
from sqlmodel import Session, select

from entities.opJournal import STATUS_APPLIED, UNDOABLE_KINDS, StockOperation
from entities.orders import Order
from loggiing import logger
from utils import require_role
from config import NAIROBI_TZ

from core.audit import undo as undo_engine

UNDO_ROLES = ["manager", "ceo", "admin"]


def _check_pin(db: Session, pin: Optional[str], current_user=None) -> None:
    from core.settings.service import cancel_pin_is_configured, check_cancel_pin

    if not cancel_pin_is_configured(db):
        raise HTTPException(status_code=400, detail="No cancel PIN has been set up yet. Ask the CEO to configure one.")
    if not check_cancel_pin(db, pin, current_user):
        raise HTTPException(status_code=403, detail="Incorrect PIN.")


def _op_or_404(db: Session, op_id: str) -> StockOperation:
    op = db.get(StockOperation, op_id)
    if op is None:
        raise HTTPException(status_code=404, detail="Change not found")
    return op


def list_order_operations(order_id: int, db: Session, current_user) -> list:
    require_role(UNDO_ROLES, current_user)
    from core.ordering.visibility import get_visible_order_or_404
    get_visible_order_or_404(db, order_id)  # an open sale window is not an order
    from entities.opJournal import WINDOW_KINDS
    # A confirmed sale-window order's history starts at its sale: building the cart in the
    # window (window_cart) happened before it was an order.
    ops = db.exec(select(StockOperation).where(StockOperation.order_id == order_id,
                                               StockOperation.kind.notin_(WINDOW_KINDS))
                  .order_by(StockOperation.created_at.desc())).all()
    out = []
    for op in ops:
        summary = op.summary or {}
        out.append({
            "op_id": op.op_id,
            "kind": op.kind,
            "status": op.status,
            "created_at": op.created_at.replace(tzinfo=NAIROBI_TZ).isoformat(),
            "actor_name": op.actor_name,
            "notes": op.notes,
            "cut_confirmations": summary.get("cut_confirmations") or [],
            "undoes_op_id": op.undoes_op_id,
            "undone_by_op_id": op.undone_by_op_id,
            # Advisory - the preview runs the full check.
            "can_undo": op.kind in UNDOABLE_KINDS and op.status == STATUS_APPLIED,
        })
    return out


def _refusal(e: undo_engine.UndoRefused):
    return {"undoable": False, "reasons": e.reasons, "lines": [], "items_added": [],
            "items_removed": [], "money_note": None}


def preview_undo(op_id: str, db: Session, current_user) -> dict:
    require_role(UNDO_ROLES, current_user)
    _op_or_404(db, op_id)
    try:
        effects = undo_engine.preview(db, lambda: undo_engine.undo_operation(
            db, op_id, actor=current_user, reason="preview"))
    except undo_engine.UndoRefused as e:
        return _refusal(e)
    return {"undoable": True, "reasons": [], **effects}


def undo(op_id: str, pin: str, reason: str, db: Session, current_user, money_handled=None) -> dict:
    require_role(UNDO_ROLES, current_user)
    _check_pin(db, pin, current_user)
    if not (reason or "").strip():
        raise HTTPException(status_code=422, detail="Say why this change is being undone.")
    _op_or_404(db, op_id)
    try:
        if undo_engine.money_moved(db, op_id) and money_handled is None:
            raise HTTPException(status_code=422, detail="Say whether the money in this change really changed hands.")
        row = undo_engine.undo_operation(db, op_id, actor=current_user, reason=reason.strip(),
                                         money_handled=money_handled)
        db.commit()
    except undo_engine.UndoRefused as e:
        db.rollback()
        raise HTTPException(status_code=409, detail={"message": "This change can't be undone exactly.", "reasons": e.reasons})
    except HTTPException:
        db.rollback()
        raise
    except Exception as e:
        db.rollback()
        logger.error(f"undo of {op_id} failed: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail="Something went wrong while undoing the change.")
    logger.info(f"operation {op_id} undone by {current_user.userId}: {reason}")
    return {"undo_op_id": row.op_id}


def correction_plan(op_id: str, db: Session, current_user) -> dict:
    """The cut questions of an edit/cancel as they stand once it is undone, each carrying the
    answer given originally - what the correction screen shows for re-answering."""
    from core.inventory import reversalPlan
    from core.ordering import model
    from core.ordering.orderService import _match_items, _order_age, CANCEL_WINDOW
    from entities.orderItems import OrderItem

    require_role(UNDO_ROLES, current_user)
    target = _op_or_404(db, op_id)
    if target.kind not in UNDOABLE_KINDS:
        raise HTTPException(status_code=400, detail="Only order edits and cancellations have cut answers to correct.")
    previous = {c.get("line_ref"): c for c in (target.summary or {}).get("cut_confirmations") or []}

    savepoint = db.begin_nested()
    try:
        undo_engine.undo_operation(db, op_id, actor=current_user, reason="preview")
        db.flush()
        order = db.get(Order, target.order_id)
        from core.ordering.visibility import is_hidden
        if order is None or is_hidden(order):
            raise HTTPException(status_code=404, detail="Order not found")
        reversing = None
        if target.kind == "edit":
            req = model.OrderEditRequest(**(target.request or {}))
            existing = db.exec(select(OrderItem).where(OrderItem.order_id == order.orderId)).all()
            _, rev_items, _ = _match_items(existing, req.items)
            reversing = {oi.item_id for oi in rev_items}
        plan = reversalPlan.build_plan(db, order, reversing_item_ids=reversing)
        plan = reversalPlan.public_plan(plan)
        for line in plan["lines"]:
            prev = previous.get(line["line_ref"]) or {}
            line["previous_answer"] = {
                "physicalState": prev.get("physical_state"),
                "resolution": prev.get("resolution"),
                "laterCuts": prev.get("later_cuts") or {},
            }
        plan["can_edit"] = True
        plan["can_cancel"] = True
        return plan
    except undo_engine.UndoRefused as e:
        raise HTTPException(status_code=409, detail={"message": "This change can't be undone exactly, so it can't be corrected.", "reasons": e.reasons})
    finally:
        savepoint.rollback()


def preview_correction(op_id: str, cut_confirmations: dict, db: Session, current_user) -> dict:
    require_role(UNDO_ROLES, current_user)
    _op_or_404(db, op_id)
    try:
        effects = undo_engine.preview(db, lambda: undo_engine.correct_operation(
            db, op_id, actor=current_user, reason="preview", cut_confirmations=cut_confirmations))
    except undo_engine.UndoRefused as e:
        return _refusal(e)
    except HTTPException as e:
        detail = e.detail if isinstance(e.detail, str) else (e.detail or {}).get("message", "Refused")
        return {"undoable": False, "reasons": [detail], "lines": [], "items_added": [],
                "items_removed": [], "money_note": None}
    return {"undoable": True, "reasons": [], **effects}


def correct(op_id: str, pin: str, reason: str, cut_confirmations: dict, db: Session, current_user) -> dict:
    require_role(UNDO_ROLES, current_user)
    _check_pin(db, pin, current_user)
    if not (reason or "").strip():
        raise HTTPException(status_code=422, detail="Say what was wrong with the original answers.")
    _op_or_404(db, op_id)
    try:
        result = undo_engine.correct_operation(db, op_id, actor=current_user, reason=reason.strip(),
                                               cut_confirmations=cut_confirmations)
        db.commit()
    except undo_engine.UndoRefused as e:
        db.rollback()
        raise HTTPException(status_code=409, detail={"message": "This change can't be corrected exactly.", "reasons": e.reasons})
    except HTTPException:
        db.rollback()
        raise
    except Exception as e:
        db.rollback()
        logger.error(f"correction of {op_id} failed: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail="Something went wrong while correcting the change.")
    logger.info(f"operation {op_id} corrected by {current_user.userId}: {reason}")
    return result
