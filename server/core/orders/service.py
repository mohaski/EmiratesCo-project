from fastapi import Depends, HTTPException, Query
from sqlmodel import Session, select
from . import models
from ...entities.orders import Order
from ...db.database import get_session
from ..auth.service import get_current_user
from ...logging import logger
from ...utils import require_role
from typing import List



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
            amountPayed=order_data.amountPayed,
            servedby=order_data.servedby,
            parent_orderid=order_data.parent_orderid,
            VAT_status=order_data.VAT_status,
            payment_status=order_data.payment_status,
            subtotal=order_data.subtotal,
            discount=order_data.discount
        )

        # 💾 Save order
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
    