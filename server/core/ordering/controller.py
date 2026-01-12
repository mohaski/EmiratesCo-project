from fastapi import APIRouter, Depends, Query, HTTPException
from typing import List, Optional
from sqlmodel import Session
from db.database import get_session
from core.userManagement.authService import get_current_user
from . import model, orderService, orderItemService

router = APIRouter(prefix="/orders", tags=["Orders"])

# ---------------------------------------------------------------------------
# Order Endpoints
# ---------------------------------------------------------------------------

@router.post("/", response_model=model.OrderCreateResponse)
def create_order(
    order_data: model.OrderCreate,
    db: Session = Depends(get_session),
    current_user = Depends(get_current_user)
):
    """
    Create a new order with items transactionally.
    """
    return orderService.create_order(order_data, db, current_user)

@router.get("/{order_id}", response_model=model.OrderResponse)
def get_order(
    order_id: int,
    db: Session = Depends(get_session)
):
    """
    Get a specific order by ID.
    """
    return orderService.get_order_by_orderId(order_id, db)

@router.get("/", response_model=List[model.OrderResponse])
def get_orders(
    skip: int = 0,
    limit: int = 20,
    db: Session = Depends(get_session)
):
    """
    Get all orders with pagination.
    """
    return orderService.get_all_orders(db, skip, limit)

@router.get("/customer/{customer_id}", response_model=List[model.OrderResponse])
def get_orders_by_customer(
    customer_id: int,
    skip: int = 0,
    limit: int = 20,
    db: Session = Depends(get_session)
):
    """
    Get orders for a specific customer.
    """
    return orderService.get_orders_by_customerId(customer_id, db, skip, limit)

@router.put("/{order_id}/payment-status", response_model=model.OrderStatusUpdateResponse)
def update_payment_status(
    order_id: int,
    new_status: str,
    db: Session = Depends(get_session),
    current_user = Depends(get_current_user)
):
    """
    Update order payment status (Paid, Unpaid, Partial).
    """
    return orderService.update_order_payment_status(order_id, new_status, db, current_user)

@router.put("/{order_id}/workflow-status", response_model=model.OrderStatusUpdateResponse)
def update_workflow_status(
    order_id: int,
    new_status: str,
    db: Session = Depends(get_session),
    current_user = Depends(get_current_user)
):
    """
    Update order workflow status (pending, confirmed, completed, cancelled).
    """
    return orderService.update_order_status(order_id, new_status, db, current_user)

# ---------------------------------------------------------------------------
# Order Item Endpoints
# ---------------------------------------------------------------------------

@router.get("/{order_id}/items", response_model=List[model.OrderItemResponse])
def get_order_items(
    order_id: int,
    db: Session = Depends(get_session)
):
    """
    Get items for a specific order.
    """
    return orderItemService.get_orderItems_by_orderId(order_id, db)
