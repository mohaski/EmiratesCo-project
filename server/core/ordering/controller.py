from fastapi import APIRouter, Depends, Query, BackgroundTasks
from typing import List, Optional
from sqlmodel import Session
from db.database import get_session
from core.userManagement.authService import get_current_user
from ws.manager import manager
from utils import require_role
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
    require_role(["manager", "ceo", "admin"], current_user)
    return orderService.get_all_orders(db, skip, limit)


@router.get("/audit/history", response_model=List[model.EditHistoryResponse])
def get_audit_history(
    entity_type: Optional[str] = None,
    skip: int = 0,
    limit: int = 100,
    db: Session = Depends(get_session),
    current_user = Depends(get_current_user),
):
    """Return edit history records for CEO/admin review."""
    return orderService.get_audit_history(entity_type, db, skip, limit)


@router.get("/customer/{customer_id}", response_model=List[model.OrderResponse])
def get_orders_by_customer(
    customer_id: int,
    skip: int = 0,
    limit: int = 20,
    db: Session = Depends(get_session)
):
    return orderService.get_orders_by_customerId(customer_id, db, skip, limit)


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


@router.put("/{order_id}/payment-status", response_model=model.OrderStatusUpdateResponse)
async def update_payment_status(
    order_id: int,
    new_status: str,
    background_tasks: BackgroundTasks,
    db: Session = Depends(get_session),
    current_user = Depends(get_current_user)
):
    result = orderService.update_order_payment_status(order_id, new_status, db, current_user)
    background_tasks.add_task(manager.broadcast, "orders_updated")
    return result


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
    result = orderService.cancel_order_with_pin(order_id, body.pin, db, current_user)
    background_tasks.add_task(manager.broadcast, "orders_updated")
    background_tasks.add_task(manager.broadcast, "products_updated")
    return result


@router.get("/{order_id}/items", response_model=List[model.OrderItemResponse])
def get_order_items(
    order_id: int,
    db: Session = Depends(get_session)
):
    return orderItemService.get_orderItems_by_orderId(order_id, db)
