# services/order_service.py
from __future__ import annotations

from datetime import datetime
from typing import Sequence, Literal

from fastapi import Depends, HTTPException, Query, status
from sqlmodel import Session, select, SQLModelError
from sqlalchemy.exc import IntegrityError

from ...entities.orders import Order
from ...entities.orderItems import OrderItem
from ...db.database import get_session
from ...logging import logger
from ...utils import require_role
from ..userManagement.auth.service import get_current_user
from .orderItemService import compute_order_total  
from . import models
from typing import List





# ---------------------------------------------------------------------------
# Shared helpers
# ---------------------------------------------------------------------------
def _order_to_response(order: Order) -> models.OrderResponse:
    """Map ORM → response Pydantic model (centralised)."""
    return models.OrderResponse(
        orderId=order.orderId,
        customerId=order.customerid,
        amountPayed=order.amountPayed,
        servedby=order.servedby,
        parent_orderid=order.parent_orderid,
        VAT_status=order.VAT_status,
        created_at=order.created_at,
        payment_status=order.payment_status,
        subtotal=order.subtotal,
        discount=order.discount,
    )


def _execute_query(
    stmt,
    db: Session,
    not_found_msg: str | None = None,
) -> list[Order] | Order:
    """
    Execute a SELECT statement.
    - For single row → returns Order or raises 404.
    - For multiple → returns list (empty list if none).
    """
    results = db.exec(stmt).all()

    if not_found_msg and not results:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=not_found_msg)

    return results[0] if len(results) == 1 and not_found_msg else results


# Role dependency (reuse)
cashier_or_ceo_dep = lambda: Depends(require_role(["SeniorCashier", "JuniorCashier", "CEO"]))

# ---------------------------------------------------------------------------
# Business logic
# ---------------------------------------------------------------------------

def compute_VAT_amount(subtotal: float, vat_rate: float = 0.16) -> float:
    """Compute VAT amount from subtotal."""
    return subtotal * vat_rate



# ---------------------------------------------------------------------------
# Public API
# ---------------------------------------------------------------------------

def create_order(order_data: models.OrderCreate, db: Session = Depends(get_session), current_user=Depends(get_current_user)) -> models.OrderCreateResponse:
    """
    Create a new order entry.
    - Only users with admin or manager roles can create orders.
    - Returns a structured success message.
    """
    try:
        # 🔐 Ensure user has privilege to create
        require_role(["SeniorCashier", "JuniorCashier", "CEO"], current_user)        

        # 🧱 Create the new order instance
        new_order = Order(
            customerId=order_data.customerId,
            servedby=order_data.servedby,
            parent_orderid=order_data.parent_orderid,
            VAT_status=order_data.VAT_status,
            payment_status=order_data.payment_status,
            discount=order_data.discount
        )

        # 💾 Save order
        db.add(new_order)
        db.commit()
        db.refresh(new_order)
        
        orderItemsTotals = db.exec(
            select(OrderItem.totalAmount).where(OrderItem.orderId == new_order.orderId)
        ).all()
            
        subtotal = sum(orderItemsTotals) if orderItemsTotals else 0.0
        subtotal -= new_order.discount
        
        if new_order.VAT_status:
            vat_inclusive_amount = compute_VAT_amount(subtotal)
            subtotal += vat_inclusive_amount
        
        new_order.subtotal = subtotal
        db.add(new_order)
        db.commit()
        db.refresh(new_order)

        logger.info(f"Order {new_order.orderId} created successfully by user {current_user.userId}.")
        return models.OrderCreateResponse(
            message="Order created successfully",
            orderId=new_order.orderId
        )
    except HTTPException:
        raise
    except Exception as e:
        db.rollback()
        logger.error(f"Error creating order: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail="Internal server error")
    
def get_order_by_orderId(order_id: int, db: Session = Depends(get_session)) -> models.orderResponse:
    """
    Retrieve an order by its ID.
    - Returns the order details if found.
    - Raises 404 error if the order does not exist.
    """
    try:
        order = db.get(Order, order_id)
        if not order:
            logger.warning(f"Order {order_id} not found.")
            raise HTTPException(status_code=404, detail="Order not found")
        return models.OrderResponse(
            orderId=order.orderId,
            customerId=order.customerid,
            amountPayed=order.amountPayed,
            servedby=order.servedby,
            parent_orderid=order.parent_orderid,
            VAT_status=order.VAT_status,
            created_at=order.created_at,
            payment_status=order.payment_status,
            subtotal=order.subtotal,
            discount=order.discount
        )
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error retrieving order {order_id}: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail="Internal server error")
    
def get_orders_for_period_vatExcluded(
    start_date: str,
    end_date: str,
    db: Session = Depends(get_session),
    skip: int = Query(0, ge=0, description="Number of records to skip"),
    limit: int = Query(10, ge=1, le=100, description="Maximum number of records to return"),
) -> List[models.OrderResponse]:
    """
    Retrieve all VAT-excluded orders within a specified date range, with pagination.
    """
    try:
        statement = (
            select(Order)
            .where(
                Order.created_at >= start_date,
                Order.created_at <= end_date,
                Order.VAT_status == False
            )
            .offset(skip)
            .limit(limit)
        )
        orders = db.exec(statement).all()

        return [
            models.OrderResponse(
                orderId=order.orderId,
                customerId=order.customerid,
                amountPayed=order.amountPayed,
                servedby=order.servedby,
                parent_orderid=order.parent_orderid,
                VAT_status=order.VAT_status,
                created_at=order.created_at,
                payment_status=order.payment_status,
                subtotal=order.subtotal,
                discount=order.discount,
            )
            for order in orders
        ]

    except HTTPException:
        raise
    except Exception as e:
        logger.error(
            f"Error retrieving VAT-excluded orders for period {start_date} to {end_date}: {e}",
            exc_info=True,
        )
        raise HTTPException(status_code=500, detail="Internal server error")


def get_orders_for_period_vatIncluded(
    start_date: str,
    end_date: str,
    db: Session = Depends(get_session),
    skip: int = Query(0, ge=0, description="Number of records to skip"),
    limit: int = Query(10, ge=1, le=100, description="Maximum number of records to return"),
) -> List[models.OrderResponse]:
    """
    Retrieve all VAT-included orders within a specified date range, with pagination.
    """
    try:
        statement = (
            select(Order)
            .where(
                Order.created_at >= start_date,
                Order.created_at <= end_date,
                Order.VAT_status == True
            )
            .offset(skip)
            .limit(limit)
        )
        orders = db.exec(statement).all()

        return [
            models.OrderResponse(
                orderId=order.orderId,
                customerId=order.customerid,
                amountPayed=order.amountPayed,
                servedby=order.servedby,
                parent_orderid=order.parent_orderid,
                VAT_status=order.VAT_status,
                created_at=order.created_at,
                payment_status=order.payment_status,
                subtotal=order.subtotal,
                discount=order.discount,
            )
            for order in orders
        ]

    except HTTPException:
        raise
    except Exception as e:
        logger.error(
            f"Error retrieving VAT-included orders for period {start_date} to {end_date}: {e}",
            exc_info=True,
        )
        raise HTTPException(status_code=500, detail="Internal server error")


def get_orders_by_customerId(
    customer_id: int,
    db: Session = Depends(get_session),
    skip: int = Query(0, ge=0, description="Number of records to skip"),
    limit: int = Query(10, ge=1, le=100, description="Maximum number of records to return"),
) -> List[models.OrderResponse]:
    """
    Retrieve all orders for a specific customer, with pagination.
    """
    try:
        statement = (
            select(Order)
            .where(Order.customerid == customer_id)
            .offset(skip)
            .limit(limit)
        )
        orders = db.exec(statement).all()

        return [
            models.OrderResponse(
                orderId=order.orderId,
                customerId=order.customerid,
                amountPayed=order.amountPayed,
                servedby=order.servedby,
                parent_orderid=order.parent_orderid,
                VAT_status=order.VAT_status,
                created_at=order.created_at,
                payment_status=order.payment_status,
                subtotal=order.subtotal,
                discount=order.discount,
            )
            for order in orders
        ]

    except HTTPException:
        raise
    except Exception as e:
        logger.error(
            f"Error retrieving orders for customer {customer_id}: {e}",
            exc_info=True,
        )
        raise HTTPException(status_code=500, detail="Internal server error")


def get_orders_by_servedby(
    user_id: int,
    db: Session = Depends(get_session),
    skip: int = Query(0, ge=0, description="Number of records to skip"),
    limit: int = Query(10, ge=1, le=100, description="Maximum number of records to return"),
) -> List[models.OrderResponse]:
    """
    Retrieve all orders served by a specific user, with pagination.
    """
    try:
        statement = (
            select(Order)
            .where(Order.servedby == user_id)
            .offset(skip)
            .limit(limit)
        )
        orders = db.exec(statement).all()

        return [
            models.OrderResponse(
                orderId=order.orderId,
                customerId=order.customerid,
                amountPayed=order.amountPayed,
                servedby=order.servedby,
                parent_orderid=order.parent_orderid,
                VAT_status=order.VAT_status,
                created_at=order.created_at,
                payment_status=order.payment_status,
                subtotal=order.subtotal,
                discount=order.discount,
            )
            for order in orders
        ]

    except HTTPException:
        raise
    except Exception as e:
        logger.error(
            f"Error retrieving orders served by user {user_id}: {e}",
            exc_info=True,
        )
        raise HTTPException(status_code=500, detail="Internal server error")
    
def get_orders_for_certain_day(date: str, db: Session = Depends(get_session)) -> list[models.OrderResponse]:
    """
    Retrieve all orders created on a specific date.
    - Returns a list of orders for the given date.
    """
    try:
        statement = select(Order).where(
            Order.created_at >= f"{date} 00:00:00",
            Order.created_at <= f"{date} 23:59:59"
        )
        orders = db.exec(statement).all()
        return [
            models.OrderResponse(
                orderId=order.orderId,
                customerId=order.customerid,
                amountPayed=order.amountPayed,
                servedby=order.servedby,
                parent_orderid=order.parent_orderid,
                VAT_status=order.VAT_status,
                created_at=order.created_at,
                payment_status=order.payment_status,
                subtotal=order.subtotal,
                discount=order.discount
            ) for order in orders
        ]
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error retrieving orders for date {date}: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail="Internal server error")
    
def get_child_orders(parent_order_id: int, db: Session = Depends(get_session)) -> list[models.OrderResponse]:
    """
    Retrieve all child orders associated with a specific parent order ID.
    - Returns a list of child orders for the given parent order.
    """
    try:
        statement = select(Order).where(Order.parent_orderid == parent_order_id)
        orders = db.exec(statement).all()
        return [
            models.OrderResponse(
                orderId=order.orderId,
                customerId=order.customerid,
                amountPayed=order.amountPayed,
                servedby=order.servedby,
                parent_orderid=order.parent_orderid,
                VAT_status=order.VAT_status,
                created_at=order.created_at,
                payment_status=order.payment_status,
                subtotal=order.subtotal,
                discount=order.discount
            ) for order in orders
        ]
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error retrieving child orders for parent order {parent_order_id}: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail="Internal server error")
    
def get_all_orders(
    db: Session = Depends(get_session),
    skip: int = Query(0, ge=0, description="Number of records to skip"),
    limit: int = Query(10, ge=1, le=20, description="Maximum number of records to return"),
) -> list[models.OrderResponse]:
    """
    Retrieve all orders in the system with pagination.
    - skip: Number of records to skip.
    - limit: Maximum number of records to return.
    """
    try:
        statement = select(Order).offset(skip).limit(limit)
        orders = db.exec(statement).all()

        return [
            models.OrderResponse(
                orderId=order.orderId,
                customerId=order.customerid,
                amountPayed=order.amountPayed,
                servedby=order.servedby,
                parent_orderid=order.parent_orderid,
                VAT_status=order.VAT_status,
                created_at=order.created_at,
                payment_status=order.payment_status,
                subtotal=order.subtotal,
                discount=order.discount,
            )
            for order in orders
        ]

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error retrieving all orders: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail="Internal server error")
    
    
def getAll_orders_VatIncluded(db: Session = Depends(get_session)) -> list[models.OrderResponse]:
    """
    Retrieve all VAT-included orders.
    - Returns a list of VAT-included orders.
    """
    try:
        statement = select(Order).where(Order.VAT_status == True)
        orders = db.exec(statement).all()

        return [
            models.OrderResponse(
                orderId=order.orderId,
                customerId=order.customerid,
                amountPayed=order.amountPayed,
                servedby=order.servedby,
                parent_orderid=order.parent_orderid,
                VAT_status=order.VAT_status,
                created_at=order.created_at,
                payment_status=order.payment_status,
                subtotal=order.subtotal,
                discount=order.discount,
            )
            for order in orders
        ]

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error retrieving VAT-included orders: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail="Internal server error")

def update_order_payment_status(
    order_id: int,
    new_status: str,
    db: Session = Depends(get_session),
    current_user=Depends(get_current_user)
) -> models.OrderStatusUpdateResponse:
    """
    Update the payment status of an existing order.
    - Only users with admin or manager roles can update order status.
    - Returns a structured success message.
    """
    try:
        # 🔐 Ensure user has privilege to update
        require_role(["SeniorCashier", "JuniorCashier", "CEO"], current_user)        

        order = db.get(Order, order_id)
        if not order:
            logger.warning(f"Order {order_id} not found for status update.")
            raise HTTPException(status_code=404, detail="Order not found")

        order.payment_status = new_status
        db.add(order)
        db.commit()
        db.refresh(order)

        logger.info(f"Order {order_id} payment status updated to {new_status} by user {current_user.userId}.")
        return models.OrderStatusUpdateResponse(
            message=f"Order {order_id} payment status updated successfully to {new_status}."
        )
    except HTTPException:
        raise
    except Exception as e:
        db.rollback()
        logger.error(f"Error updating order {order_id} payment status: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail="Internal server error")
    


def create_order(
    order_data: models.OrderCreate,
    db: Session = Depends(get_session),
    current_user=Depends(get_current_user),
) -> models.OrderCreateResponse:
    """
    Create a new order.
    - Requires cashier/CEO role.
    - **Re-calculates subtotal** from linked order items (if provided).
    """
    cashier_or_ceo_dep()  # raises 403 if not allowed

    # If order items are sent, validate + recompute subtotal
    if getattr(order_data, "order_items", None):
        # NOTE: assume OrderCreate optionally contains `order_items: list[OrderItemCreate]`
        subtotal = compute_order_total(order_data.order_items)
        if abs(subtotal - order_data.subtotal) > 1e-6:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Provided subtotal does not match calculated total from items.",
            )
    else:
        # Trust provided subtotal (legacy path)
        subtotal = order_data.subtotal

    new_order = Order(
        customerId=order_data.customerId,
        amountPayed=order_data.amountPayed,
        servedby=order_data.servedby,
        parent_orderid=order_data.parent_orderid,
        VAT_status=order_data.VAT_status,
        payment_status=order_data.payment_status,
        subtotal=subtotal,
        discount=order_data.discount,
    )

    try:
        db.add(new_order)
        db.commit()
        db.refresh(new_order)
        logger.info("Order %s created by user %s", new_order.orderId, current_user.userId)
        return models.OrderCreateResponse(
            message="Order created successfully",
            orderId=new_order.orderId,
        )
    except IntegrityError as exc:
        db.rollback()
        logger.error("Integrity error creating order: %s", exc)
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Conflict (e.g., duplicate order ID).",
        ) from exc
    except Exception as exc:
        db.rollback()
        logger.exception("Unexpected error creating order")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Internal server error",
        ) from exc


def get_order_by_orderId(
    order_id: int,
    db: Session = Depends(get_session),
) -> models.OrderResponse:
    stmt = select(Order).where(Order.orderId == order_id)
    order: Order = _execute_query(stmt, db, not_found_msg="Order not found")
    return _order_to_response(order)


def _date_range_query(
    start: datetime,
    end: datetime,
    vat_included: bool | None = None,
) -> select:
    stmt = select(Order).where(Order.created_at >= start, Order.created_at <= end)
    if vat_included is not None:
        stmt = stmt.where(Order.VAT_status == vat_included)
    return stmt


def _paginate(stmt, skip: int, limit: int) -> select:
    return stmt.offset(skip).limit(limit)


def _parse_iso_date(date_str: str, field_name: str) -> datetime:
    """Accepts YYYY-MM-DD or full ISO → returns start-of-day (or full datetime)."""
    try:
        dt = datetime.fromisoformat(date_str.replace("Z", "+00:00"))
    except ValueError:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Invalid {field_name}: expected ISO format (e.g., 2025-10-01 or 2025-10-01T00:00:00)",
        )
    return dt


def get_orders_for_period_vatExcluded(
    start_date: str = Query(..., description="ISO start date"),
    end_date: str = Query(..., description="ISO end date"),
    db: Session = Depends(get_session),
    skip: int = Query(0, ge=0),
    limit: int = Query(10, ge=1, le=100),
) -> list[models.OrderResponse]:
    start = _parse_iso_date(start_date, "start_date")
    end = _parse_iso_date(end_date, "end_date")
    stmt = _date_range_query(start, end, vat_included=False)
    stmt = _paginate(stmt, skip, limit)
    orders: list[Order] = _execute_query(stmt, db)
    return [_order_to_response(o) for o in orders]


def get_orders_for_period_vatIncluded(
    start_date: str = Query(..., description="ISO start date"),
    end_date: str = Query(..., description="ISO end date"),
    db: Session = Depends(get_session),
    skip: int = Query(0, ge=0),
    limit: int = Query(10, ge=1, le=100),
) -> list[models.OrderResponse]:
    start = _parse_iso_date(start_date, "start_date")
    end = _parse_iso_date(end_date, "end_date")
    stmt = _date_range_query(start, end, vat_included=True)
    stmt = _paginate(stmt, skip, limit)
    orders: list[Order] = _execute_query(stmt, db)
    return [_order_to_response(o) for o in orders]


def get_orders_by_customerId(
    customer_id: int,
    db: Session = Depends(get_session),
    skip: int = Query(0, ge=0),
    limit: int = Query(10, ge=1, le=100),
) -> list[models.OrderResponse]:
    stmt = _paginate(select(Order).where(Order.customerid == customer_id), skip, limit)
    orders = _execute_query(stmt, db)
    return [_order_to_response(o) for o in orders]


def get_orders_by_servedby(
    user_id: int,
    db: Session = Depends(get_session),
    skip: int = Query(0, ge=0),
    limit: int = Query(10, ge=1, le=100),
) -> list[models.OrderResponse]:
    stmt = _paginate(select(Order).where(Order.servedby == user_id), skip, limit)
    orders = _execute_query(stmt, db)
    return [_order_to_response(o) for o in orders]


def get_orders_for_certain_day(
    date: str = Query(..., description="ISO date, e.g., 2025-10-28"),
    db: Session = Depends(get_session),
) -> list[models.OrderResponse]:
    day = _parse_iso_date(date, "date").date()
    start = datetime.combine(day, datetime.min.time())
    end = datetime.combine(day, datetime.max.time())
    stmt = select(Order).where(Order.created_at >= start, Order.created_at <= end)
    orders = _execute_query(stmt, db)
    return [_order_to_response(o) for o in orders]


def get_child_orders(
    parent_order_id: int,
    db: Session = Depends(get_session),
) -> list[models.OrderResponse]:
    stmt = select(Order).where(Order.parent_orderid == parent_order_id)
    orders = _execute_query(stmt, db)
    return [_order_to_response(o) for o in orders]


def get_all_orders_VAT(
    db: Session = Depends(get_session),
    skip: int = Query(0, ge=0),
    limit: int = Query(10, ge=1, le=100),
) -> list[models.OrderResponse]:
    stmt = _paginate(select(Order), skip, limit)
    orders = _execute_query(stmt, db)
    return [_order_to_response(o) for o in orders]


def update_order_payment_status(
    order_id: int,
    new_status: Literal["pending", "paid", "failed", "refunded"],
    db: Session = Depends(get_session),
    current_user=Depends(get_current_user),
) -> models.OrderStatusUpdateResponse:
    cashier_or_ceo_dep()  # 403 if not allowed

    order: Order = _execute_query(
        select(Order).where(Order.orderId == order_id),
        db,
        not_found_msg="Order not found",
    )

    order.payment_status = new_status
    try:
        db.add(order)
        db.commit()
        db.refresh(order)
        logger.info("Order %s payment status → %s by %s", order_id, new_status, current_user.userId)
        return models.OrderStatusUpdateResponse(
            message=f"Order {order_id} payment status updated successfully to {new_status}."
        )
    except Exception as exc:
        db.rollback()
        logger.exception("Failed to update payment status")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Internal server error",
        ) from exc