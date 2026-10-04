from fastapi import APIRouter, Depends, Query, BackgroundTasks
from typing import List, Optional
from sqlmodel import Session
from db.database import get_session
from core.userManagement.authService import get_current_user
from ws.manager import manager
from utils import require_role
from . import operationsService
from . import model, orderService, orderItemService

router = APIRouter(prefix="/orders", tags=["Orders"])

# ---------------------------------------------------------------------------
# Static / non-parameterised routes FIRST (avoids shadowing by /{order_id})
# ---------------------------------------------------------------------------

@router.post("/", response_model=model.OrderCreateResponse)
async def create_order(
    order_data: model.OrderCreate,
    background_tasks: BackgroundTasks,
    db: Session = Depends(get_session),
    current_user = Depends(get_current_user)
):
    result = orderService.create_order(order_data, db, current_user)
    background_tasks.add_task(manager.broadcast, "orders_updated")
    background_tasks.add_task(manager.broadcast, "products_updated")
    return result


@router.get("/", response_model=List[model.OrderResponse])
def get_orders(
    skip: int = 0,
    limit: int = 100,
    db: Session = Depends(get_session),
    current_user = Depends(get_current_user)
):
    require_role(["manager", "cashier", "ceo", "admin"], current_user)
    return orderService.get_all_orders(db, skip, limit)


@router.get("/audit/history", response_model=List[model.EditHistoryResponse])
def get_audit_history(
    entity_type: Optional[str] = None,
    skip: int = 0,
    limit: int = 100,
    user_id: Optional[str] = None,
    since: Optional[str] = Query(None, description="Inclusive lower bound, YYYY-MM-DD"),
    until: Optional[str] = Query(None, description="Inclusive upper bound, YYYY-MM-DD"),
    db: Session = Depends(get_session),
    current_user = Depends(get_current_user),
):
    """CEO/admin-only activity feed spanning every module that writes to edit_history."""
    require_role(["ceo", "admin"], current_user)
    return orderService.get_audit_history(entity_type, db, skip, limit, user_id, since, until)


@router.get("/customer/{customer_id}", response_model=List[model.OrderResponse])
def get_orders_by_customer(
    customer_id: int,
    skip: int = 0,
    limit: int = 20,
    db: Session = Depends(get_session)
):
    return orderService.get_orders_by_customerId(customer_id, db, skip, limit)


@router.get("/with-balance", response_model=List[model.OrderResponse])
def get_orders_with_balance(
    skip: int = 0,
    limit: int = 200,
    db: Session = Depends(get_session),
    current_user = Depends(get_current_user),
):
    """Orders with an outstanding balance — feeds the Cashier's Collect Payments page."""
    require_role(["cashier", "manager", "ceo", "admin"], current_user)
    return orderService.get_orders_with_balance(db, skip, limit)


@router.get("/cutting-queue", response_model=List[model.PendingCuttingOrder])
def get_cutting_queue(
    skip: int = 0,
    limit: int = 100,
    db: Session = Depends(get_session),
    current_user = Depends(get_current_user),
):
    """Orders with at least one item still awaiting a cutting report, for the
    order-level cutting-queue batch-report screen. CEO doesn't work the cutting
    floor — kept out of this queue (unlike the shared per-item/per-order
    mark-done endpoints below, still used from OrderSummaryPage)."""
    require_role(["manager", "cashier", "admin"], current_user)
    return orderService.get_pending_cutting_orders(db, current_user, skip, limit)


@router.put("/cutting-queue/mark-done", response_model=model.MarkCuttingDoneResponse)
async def mark_cutting_done(
    body: model.MarkCuttingDoneRequest,
    background_tasks: BackgroundTasks,
    db: Session = Depends(get_session),
    current_user = Depends(get_current_user),
):
    """Batch-report a set of items as cut — used by OrderSummaryPage's
    single-item quick-mark (a 1-element list)."""
    result = orderService.mark_cutting_complete_batch(body.item_ids, db, current_user)
    background_tasks.add_task(manager.broadcast, "cutting_status_updated")
    return model.MarkCuttingDoneResponse(updated=result["updated"])


@router.put("/cutting-queue/mark-orders-done", response_model=model.MarkOrdersCuttingDoneResponse)
async def mark_orders_cutting_done(
    body: model.MarkOrdersCuttingDoneRequest,
    background_tasks: BackgroundTasks,
    db: Session = Depends(get_session),
    current_user = Depends(get_current_user),
):
    """Order-queue batch-report: mark every still-pending item across the given
    orders as cut, and each of those orders as completed — used by the
    cutting-queue page (multi-select of whole orders). CEO kept out, same as
    the queue's GET above."""
    require_role(["manager", "cashier", "admin"], current_user)
    result = orderService.mark_cutting_complete_for_orders_batch(body.order_ids, db, current_user)
    background_tasks.add_task(manager.broadcast, "cutting_status_updated")
    background_tasks.add_task(manager.broadcast, "orders_updated")
    return model.MarkOrdersCuttingDoneResponse(**result)


# ---------------------------------------------------------------------------
# Parameterised routes (/{order_id} must come after static paths)
# ---------------------------------------------------------------------------

@router.get("/{order_id}", response_model=model.OrderResponse)
def get_order(
    order_id: int,
    db: Session = Depends(get_session),
    current_user = Depends(get_current_user)
):
    require_role(["manager", "cashier", "ceo", "admin"], current_user)
    return orderService.get_order_by_orderId(order_id, db)


@router.get("/{order_id}/reversal-plan", response_model=model.ReversalPlanResponse)
def get_reversal_plan(
    order_id: int,
    db: Session = Depends(get_session),
    current_user = Depends(get_current_user),
):
    """What editing or cancelling this order would do to its cut material, and which cut
    lines still need a physical yes/no from the floor. Read-only — call this before
    showing the edit or cancel screen so the operator sees the constraints up front."""
    return orderService.get_reversal_plan(order_id, db, current_user)


@router.post("/{order_id}/reversal-plan", response_model=model.ReversalPlanResponse)
def preview_reversal_plan(
    order_id: int,
    body: model.ReversalPlanRequest,
    db: Session = Depends(get_session),
    current_user = Depends(get_current_user),
):
    """Same as the GET form, but narrowed to the items the given cart would actually change
    — what the edit screen calls before saving, so it only asks about material that moves.
    Read-only."""
    return orderService.get_reversal_plan(order_id, db, current_user, incoming_items=body.items)


@router.put("/{order_id}/edit", response_model=model.OrderCreateResponse)
async def edit_order(
    order_id: int,
    order_data: model.OrderEditRequest,
    background_tasks: BackgroundTasks,
    db: Session = Depends(get_session),
    current_user = Depends(get_current_user),
):
    """Edit an existing order: restores stock, replaces items, writes audit log."""
    result = orderService.update_order(order_id, order_data, db, current_user)
    background_tasks.add_task(manager.broadcast, "orders_updated")
    background_tasks.add_task(manager.broadcast, "products_updated")
    return result


@router.put("/{order_id}/correct-offcut", response_model=model.CorrectOffcutResponse)
async def correct_offcut(
    order_id: int,
    body: model.CorrectOffcutRequest,
    background_tasks: BackgroundTasks,
    db: Session = Depends(get_session),
    current_user = Depends(get_current_user),
):
    """Manager-only: correct the remainder(s) a past cutting event recorded,
    and/or replace any of its delivered cuts that never actually came out of it."""
    result = orderService.correct_offcut_for_order_item(
        order_id, body.item_id, body.line_idx, body.event_idx,
        body.new_remainders, body.failed_cuts, body.forced_offcut_id, body.notes, db, current_user,
        **_correction_opts(body),
    )
    background_tasks.add_task(manager.broadcast, "products_updated")
    return model.CorrectOffcutResponse(
        message="Offcut corrected", before=result["before"], after=result["after"],
        replacement_events=result["replacement_events"],
    )


@router.put("/{order_id}/correct-profile-offcut", response_model=model.CorrectProfileOffcutResponse)
async def correct_profile_offcut(
    order_id: int,
    body: model.CorrectProfileOffcutRequest,
    background_tasks: BackgroundTasks,
    db: Session = Depends(get_session),
    current_user = Depends(get_current_user),
):
    """Manager-only: correct a single 1D (bar/profile) cutting event — its
    recorded remainder, and/or replace the source it says it came from."""
    result = orderService.correct_profile_offcut_for_order_item(
        order_id, body.item_id, body.line_idx, body.event_idx,
        body.new_remainder_length, body.replace_source, body.forced_offcut_id, body.notes, db, current_user,
        **_correction_opts(body),
    )
    background_tasks.add_task(manager.broadcast, "products_updated")
    return model.CorrectProfileOffcutResponse(
        message="Offcut corrected", before=result["before"], after=result["after"],
        replacement_event=result["replacement_event"],
    )


def _correction_opts(body) -> dict:
    return body.model_dump(include={"source_unused", "source_fate", "remeasure", "force_new_source", "use_original",
                                    "original_part", "assignments"})


@router.post("/{order_id}/correct-offcut/preview")
def preview_correct_offcut(
    order_id: int,
    body: model.CorrectOffcutRequest,
    db: Session = Depends(get_session),
    current_user = Depends(get_current_user),
):
    """Dry run of PUT /correct-offcut: the replacement it would make, and which sources can
    supply the pieces. Nothing is saved."""
    return orderService.preview_offcut_correction(order_id, body, db, current_user)


@router.post("/{order_id}/correct-profile-offcut/preview")
def preview_correct_profile_offcut(
    order_id: int,
    body: model.CorrectProfileOffcutRequest,
    db: Session = Depends(get_session),
    current_user = Depends(get_current_user),
):
    """Dry run of PUT /correct-profile-offcut. Nothing is saved."""
    return orderService.preview_profile_offcut_correction(order_id, body, db, current_user)


@router.put("/{order_id}/mark-cutting-done", response_model=model.MarkCuttingDoneResponse)
async def mark_order_cutting_done(
    order_id: int,
    background_tasks: BackgroundTasks,
    db: Session = Depends(get_session),
    current_user = Depends(get_current_user),
):
    """Whole-order report: marks every still-pending item on this order as cut,
    and the order itself as completed, in one call."""
    result = orderService.mark_cutting_complete_for_order(order_id, db, current_user)
    background_tasks.add_task(manager.broadcast, "cutting_status_updated")
    background_tasks.add_task(manager.broadcast, "orders_updated")
    return model.MarkCuttingDoneResponse(updated=result["updated"])


@router.put("/{order_id}/workflow-status", response_model=model.OrderStatusUpdateResponse)
async def update_workflow_status(
    order_id: int,
    new_status: str,
    background_tasks: BackgroundTasks,
    db: Session = Depends(get_session),
    current_user = Depends(get_current_user)
):
    result = orderService.update_order_status(order_id, new_status, db, current_user)
    background_tasks.add_task(manager.broadcast, "orders_updated")
    return result


@router.put("/{order_id}/cancel", response_model=model.OrderStatusUpdateResponse)
async def cancel_order(
    order_id: int,
    body: model.OrderCancelRequest,
    background_tasks: BackgroundTasks,
    db: Session = Depends(get_session),
    current_user = Depends(get_current_user)
):
    """Cancel an order — requires the CEO-configured PIN. Restores stock/offcuts."""
    result = orderService.cancel_order_with_pin(
        order_id, body.pin, db, current_user, body.refundMethod, body.refundDetails,
        cut_confirmations=body.cutConfirmations,
        plan_token=body.planToken,
    )
    background_tasks.add_task(manager.broadcast, "orders_updated")
    background_tasks.add_task(manager.broadcast, "products_updated")
    return result


@router.post("/{order_id}/items/{item_id}/projected-offcuts")
def projected_offcuts(
    order_id: int,
    item_id: int,
    body: model.ProjectedOffcutsRequest,
    db: Session = Depends(get_session),
    current_user = Depends(get_current_user),
):
    """The offcut pool once this item is reversed with the given cut answers - including the
    pieces the reversal hands back (joined/own/source). Read-only."""
    return orderService.projected_offcuts(order_id, item_id, body.answers, body.variantId, db, current_user)


@router.get("/{order_id}/operations", response_model=List[model.OrderOperation])
def list_order_operations(
    order_id: int,
    db: Session = Depends(get_session),
    current_user = Depends(get_current_user),
):
    """Every recorded change to this order (sale, edits, cancel, undos), newest first."""
    return operationsService.list_order_operations(order_id, db, current_user)


@router.post("/operations/{op_id}/undo-preview", response_model=model.UndoPreviewResponse)
def preview_undo_operation(
    op_id: str,
    db: Session = Depends(get_session),
    current_user = Depends(get_current_user),
):
    """What undoing this change would do, or why it can't be undone exactly. Read-only."""
    return operationsService.preview_undo(op_id, db, current_user)


@router.post("/operations/{op_id}/undo")
async def undo_operation(
    op_id: str,
    body: model.UndoRequest,
    background_tasks: BackgroundTasks,
    db: Session = Depends(get_session),
    current_user = Depends(get_current_user),
):
    """Undo an order edit or cancellation exactly (manager/CEO, cancel PIN, reason)."""
    result = operationsService.undo(op_id, body.pin, body.reason, db, current_user, body.moneyHandled)
    background_tasks.add_task(manager.broadcast, "orders_updated")
    background_tasks.add_task(manager.broadcast, "products_updated")
    return result


@router.get("/operations/{op_id}/correction-plan", response_model=model.ReversalPlanResponse)
def get_correction_plan(
    op_id: str,
    db: Session = Depends(get_session),
    current_user = Depends(get_current_user),
):
    """The cut questions of an edit/cancel, with the answers originally given. Read-only."""
    return operationsService.correction_plan(op_id, db, current_user)


@router.post("/operations/{op_id}/correct-preview", response_model=model.UndoPreviewResponse)
def preview_correct_operation(
    op_id: str,
    body: model.CorrectPreviewRequest,
    db: Session = Depends(get_session),
    current_user = Depends(get_current_user),
):
    """What re-running this change with corrected cut answers would do. Read-only."""
    return operationsService.preview_correction(op_id, body.cutConfirmations, db, current_user)


@router.post("/operations/{op_id}/correct")
async def correct_operation(
    op_id: str,
    body: model.CorrectRequest,
    background_tasks: BackgroundTasks,
    db: Session = Depends(get_session),
    current_user = Depends(get_current_user),
):
    """Undo this change and re-run it with corrected cut answers, in one transaction."""
    result = operationsService.correct(op_id, body.pin, body.reason, body.cutConfirmations, db, current_user)
    background_tasks.add_task(manager.broadcast, "orders_updated")
    background_tasks.add_task(manager.broadcast, "products_updated")
    return result


@router.get("/{order_id}/items", response_model=List[model.OrderItemResponse])
def get_order_items(
    order_id: int,
    db: Session = Depends(get_session)
):
    return orderItemService.get_orderItems_by_orderId(order_id, db)
