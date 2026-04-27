from fastapi import APIRouter, Depends, Query, HTTPException
from typing import List, Optional
from sqlmodel import Session
from db.database import get_session
from core.userManagement.authService import get_current_user
from . import model, orderService, orderItemService

router = APIRouter(prefix="/orders", tags=["Orders"])

# ---------------------------------------------------------------------------
# Static / non-parameterised routes FIRST (avoids shadowing by /{order_id})
# ---------------------------------------------------------------------------

@router.post("/", response_model=model.OrderCreateResponse)
def create_order(
    order_data: model.OrderCreate,
    db: Session = Depends(get_session),
    current_user = Depends(get_current_user)
):
    return orderService.create_order(order_data, db, current_user)


@router.get("/", response_model=List[model.OrderResponse])
def get_orders(
    skip: int = 0,
    limit: int = 100,
    db: Session = Depends(get_session)
):
    return orderService.get_all_orders(db, skip, limit)


@router.get("/store-view", response_model=List[model.StoreOrderResponse])
def get_store_orders(
    status: str = "confirmed",
    skip: int = 0,
    limit: int = 50,
    db: Session = Depends(get_session),
    current_user = Depends(get_current_user),
):
    """Confirmed orders with only profile/glass items, enriched with offcut data."""
    return orderService.get_store_orders(db, status, skip, limit)


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
    db: Session = Depends(get_session)
):
    return orderService.get_order_by_orderId(order_id, db)


@router.put("/{order_id}/edit", response_model=model.OrderCreateResponse)
def edit_order(
    order_id: int,
    order_data: model.OrderEditRequest,
    db: Session = Depends(get_session),
    current_user = Depends(get_current_user),
):
    """Edit an existing order: restores stock, replaces items, writes audit log."""
    return orderService.update_order(order_id, order_data, db, current_user)


@router.put("/{order_id}/items/{item_id}/reassign-offcut", response_model=model.OffcutReassignResponse)
def reassign_item_offcut(
    order_id: int,
    item_id: int,
    body: model.OffcutReassignRequest,
    db: Session = Depends(get_session),
    current_user = Depends(get_current_user),
):
    """
    Store manager: swap which offcut(s) fulfill a cut line in an order item.
    Uses SELECT FOR UPDATE — safe under concurrent requests.
    """
    return orderService.reassign_item_offcut(db, order_id, item_id, body, current_user)


@router.put("/{order_id}/payment-status", response_model=model.OrderStatusUpdateResponse)
def update_payment_status(
    order_id: int,
    new_status: str,
    db: Session = Depends(get_session),
    current_user = Depends(get_current_user)
):
    return orderService.update_order_payment_status(order_id, new_status, db, current_user)


@router.put("/{order_id}/workflow-status", response_model=model.OrderStatusUpdateResponse)
def update_workflow_status(
    order_id: int,
    new_status: str,
    db: Session = Depends(get_session),
    current_user = Depends(get_current_user)
):
    return orderService.update_order_status(order_id, new_status, db, current_user)


@router.get("/{order_id}/items", response_model=List[model.OrderItemResponse])
def get_order_items(
    order_id: int,
    db: Session = Depends(get_session)
):
    return orderItemService.get_orderItems_by_orderId(order_id, db)
