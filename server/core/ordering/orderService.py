# services/order_service.py
from __future__ import annotations

from datetime import datetime
from typing import Sequence, Literal
from decimal import Decimal, ROUND_HALF_UP

from fastapi import Depends, HTTPException, Query, status
from sqlmodel import Session, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy import func

from entities.orders import Order
from entities.orderItems import OrderItem
from entities.variants import Variant
from db.database import get_session
from loggiing import logger
from utils import require_role
from ..userManagement.authService import get_current_user
from ..inventory.inventoryService import deduct_stock_for_order_item
from . import model
from typing import List
from decimal import Decimal





# ---------------------------------------------------------------------------
# Shared helpers
# ---------------------------------------------------------------------------
def _order_to_response(order: Order) -> model.OrderResponse:
    """Map ORM → response Pydantic model (centralised)."""
    return model.OrderResponse(
        orderId=order.orderId,
        customerId=order.customerid,
        amountPaid=order.amountPayed, # Map DB 'amountPayed' to Pydantic 'amountPaid'
        servedBy=order.servedby,
        parentOrderId=order.parent_orderid,
        VAT_status=order.VAT_status,
        created_at=order.created_at.isoformat() if order.created_at else "",
        paymentStatus=order.payment_status,
        subtotal=order.subtotal,
        totalAmount=order.subtotal, # Legacy field support
        discount=order.discount,
        status=order.status,
        paymentMethod=order.payment_method,
        balance=order.balance,
        items=[
            model.OrderItemResponse(
                productId=item.product_id,
                orderId=item.order_id,
                quantity=item.details.get("quantity", 0) if item.details else 0,
                unitType=item.details.get("unitType") if item.details else None,
                unitPrice=item.details.get("unitPrice", 0) if item.details else 0,
                totalPrice=item.total_price,
                details=item.details,
                status=None 
            ) for item in order.orderItems
        ]
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

def compute_VAT_amount(subtotal: Decimal) -> Decimal:
    vat = subtotal * Decimal("0.16")
    return vat.quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)

def _calculate_complex_item_total(item_req: model.OrderItemRequest, db: Session) -> Decimal:
    """
    Calculate item total using DB prices for validation.
    Handles both simple items (Variant/Product price) and complex lineItems (Full/Half/Cuts).
    """
    from entities.products import Product
    from entities.variants import Variant
    
    # 1. Fetch Product & Variant
    product = db.get(Product, item_req.productId)
    if not product:
        raise HTTPException(status_code=400, detail=f"Product {item_req.productId} not found")
        
    variant = None
    if item_req.variantId:
        variant = db.get(Variant, item_req.variantId)

    # 2. Check for Complex Line Items
    details = item_req.details or {}
    line_items = details.get("lineItems")
    
    if line_items and isinstance(line_items, list):
        # --- Complex Calculation ---
        total = Decimal("0.00")
        
        for line in line_items:
            l_type = line.get("type", "")
            qty = Decimal(line.get("qty", 0))
            meta = line.get("meta", {})
            
            # Rate determination logic
            rate = Decimal("0.00")
            
            if "full" in l_type:
                # Use Product Full Price
                rate = Decimal(product.price_full)
                if rate == 0: 
                     rate = Decimal(line.get("rate", 0))

            elif "half" in l_type:
                # Use Product Half Price
                rate = Decimal(product.price_half or 0)
                if rate == 0: 
                     rate = Decimal(line.get("rate", 0))

            elif "cut" in l_type:
                # Cut Logic
                # Glass: Area * SqFt Price
                if "glass" in l_type or "area" in meta:
                    area = Decimal(meta.get("area", 0))
                    sqft_price = Decimal(product.price_unit or 0)
                    
                    if variant and variant.price_unit > 0:
                        sqft_price = Decimal(variant.price_unit)
                    
                    # Fallback to frontend rate (implied unit price) if DB is 0
                    if sqft_price == 0:
                        # Try to derive unit price from total/quantity? 
                        # Or just use the line 'total' divided by qty? 
                        # Usually line['rate'] for glass is the Final Piece Price calculated by logic.
                        # Let's trust line['rate'] if we can't calc it.
                        rate = Decimal(line.get("rate", 0))
                    else:
                        rate = area * sqft_price 
                else:
                    # Generic unit price (Feet?)
                    rate = Decimal(product.price_unit or 0)
                    if rate == 0:
                         rate = Decimal(line.get("rate", 0))
            
            # Add line total
            # Note: For 'cut' (glass), 'rate' calculated above is PER PIECE (Area * SqFtRate).
            # So we multiply by qty.
            # line_total = qty * rate
            
            # Wait, line['total'] in JSON is provided. We are validating it.
            # Calculated Line Total:
            if "cut" in l_type and ("glass" in l_type or "area" in meta):
                 total += qty * rate # rate is price_per_piece here
            else:
                 total += qty * rate

        return total
        
    else:
        # --- Simple Calculation ---
        # Prefer Variant Price -> Product Price -> Request Unit Price (Legacy/Trust)
        price = Decimal(item_req.unitPrice) # Default to trust if no DB match
        
        if variant and variant.price > 0:
            price = Decimal(variant.price)
        elif product.price_full > 0 and not product.price_unit:
             # Fallback to full price if it's a "whole" item sale?
             # Depends on unitType. 
             pass
             
        # Just use the simple logic we had before
        if variant and variant.price > 0:
            price = Decimal(variant.price)
            
        return Decimal(item_req.quantity) * price




# ---------------------------------------------------------------------------
# Public API
# ---------------------------------------------------------------------------

def create_order(order_data: model.OrderCreate, db: Session = Depends(get_session), current_user=Depends(get_current_user)) -> model.OrderCreateResponse:
    """
    Create a new order entry + items transactionally.
    - Only users with admin or manager roles can create orders.
    - Returns a structured success message.
    """
    try:
        # 🔐 Ensure user has privilege to create
        #require_role(["SeniorCashier", "JuniorCashier", "CEO"], current_user)        

        # 1. Create the Order Shell (Pending totals)
        new_order = Order(
            customerid=order_data.customerId,
            servedby=order_data.servedBy,
            parent_orderid=order_data.parentOrderId,
            VAT_status=order_data.VAT_status,
            payment_status=order_data.paymentStatus,
            discount=order_data.discount,
            amountPayed=order_data.amountPaid,
            status=order_data.status or "confirmed", # Default to confirmed if paid? Or pending.
            payment_method=order_data.paymentMethod,
            payment_details=order_data.paymentDetails,
            subtotal=0.0,
            balance=0.0,
            total=0.0
        )
        
        with db.begin():
            db.add(new_order)
            db.flush()  # Generate orderId
            
            # 2. Process Items & Calculate Subtotal
            calculated_subtotal = Decimal("0.00")
            
            for item_req in order_data.items:
                # Backend calculation for trust (Complex + Simple)
                item_total = _calculate_complex_item_total(item_req, db)
                
                # Determine Unit Price for storage (Approximate for complex items)
                # For complex items, unit_price might be meaningless (it's a bundle).
                # We store total_price accurately. unit_price can be total/qty.
                store_unit_price = item_total
                if item_req.quantity > 0:
                    store_unit_price = item_total / Decimal(item_req.quantity)
                
                # Ensure details exists and has metadata
                final_details = item_req.details or {}
                final_details["quantity"] = item_req.quantity
                final_details["unitType"] = item_req.unitType
                final_details["unitPrice"] = float(store_unit_price)

                new_item = OrderItem(
                    order_id=new_order.orderId,
                    product_id=item_req.productId,
                    variant_id=item_req.variantId,
                    total_price=float(item_total),
                    details=final_details
                )
                db.add(new_item)
                
                # Deduct Stock & Handle Offcuts
                deduct_stock_for_order_item(db, new_item)
                
                calculated_subtotal += item_total
            
            # 3. Apply Financials to Order
            # Apply Discount
            discount_val = Decimal(order_data.discount or 0)
            net_subtotal = calculated_subtotal - discount_val
            if net_subtotal < 0: net_subtotal = Decimal("0.00")
            
            # Apply VAT
            if new_order.VAT_status:
                vat_amount = compute_VAT_amount(net_subtotal)
                final_total = net_subtotal + vat_amount
            else:
                final_total = net_subtotal
                
            # Update Order Totals
            new_order.subtotal = float(net_subtotal) # Storing 'Total' in subtotal column based on previous schema usage?
            new_order.total = float(final_total)
            new_order.balance = float(final_total - Decimal(order_data.amountPaid))
            
            db.add(new_order)

        logger.info(f"Order {new_order.orderId} created (Items: {len(order_data.items)}) by {current_user.userId}.")
        return model.OrderCreateResponse(
            message="Order created successfully",
            orderId=new_order.orderId
        )
    except HTTPException:
        raise
    except Exception as e:
        db.rollback()
        logger.error(f"Error creating transactional order: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail="Internal server error")
    
def get_order_by_orderId(order_id: int, db: Session = Depends(get_session)) -> model.OrderResponse:
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
        return _order_to_response(order)
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
) -> List[model.OrderResponse]:
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
            model.OrderResponse(
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
) -> List[model.OrderResponse]:
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
            model.OrderResponse(
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
) -> List[model.OrderResponse]:
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
            model.OrderResponse(
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
) -> List[model.OrderResponse]:
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
            model.OrderResponse(
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
    
def get_orders_for_certain_day(date: str, db: Session = Depends(get_session)) -> list[model.OrderResponse]:
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
            model.OrderResponse(
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
    
def get_child_orders(parent_order_id: int, db: Session = Depends(get_session)) -> list[model.OrderResponse]:
    """
    Retrieve all child orders associated with a specific parent order ID.
    - Returns a list of child orders for the given parent order.
    """
    try:
        statement = select(Order).where(Order.parent_orderid == parent_order_id)
        orders = db.exec(statement).all()
        return [
            model.OrderResponse(
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
) -> list[model.OrderResponse]:
    """
    Retrieve all orders in the system with pagination.
    - skip: Number of records to skip.
    - limit: Maximum number of records to return.
    """
    try:
        statement = select(Order).offset(skip).limit(limit)
        orders = db.exec(statement).all()

        return [
            model.OrderResponse(
                orderId=order.orderId,
                customerId=order.customerid,
                amountPaid=order.amountPayed,
                totalAmount=(Decimal(str(order.amountPayed)) + Decimal(str(order.balance))) if order.amountPayed is not None else Decimal(0),
                servedBy=order.servedby,
                parentOrderId=order.parent_orderid,
                VAT_status=order.VAT_status,
                created_at=order.created_at.isoformat() if order.created_at else "",
                paymentStatus=order.payment_status,
                status=order.status,
                subtotal=order.subtotal,
                discount=order.discount,
                balance=order.balance
            )
            for order in orders
        ]

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error retrieving all orders: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail="Internal server error")
    
    
def getAll_orders_VatIncluded(db: Session = Depends(get_session)) -> list[model.OrderResponse]:
    """
    Retrieve all VAT-included orders.
    - Returns a list of VAT-included orders.
    """
    try:
        statement = select(Order).where(Order.VAT_status == True)
        orders = db.exec(statement).all()

        return [
            model.OrderResponse(
                orderId=order.orderId,
                customerId=order.customerid,
                amountPaid=order.amountPayed,
                totalAmount=(Decimal(str(order.amountPayed)) + Decimal(str(order.balance))) if order.amountPayed is not None else Decimal(0),
                servedBy=order.servedby,
                parentOrderId=order.parent_orderid,
                VAT_status=order.VAT_status,
                created_at=order.created_at.isoformat() if order.created_at else "",
                paymentStatus=order.payment_status,
                status=order.status,
                subtotal=order.subtotal,
                discount=order.discount,
                balance=order.balance
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
) -> model.OrderStatusUpdateResponse:
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
        return model.OrderStatusUpdateResponse(
            message=f"Order {order_id} payment status updated successfully to {new_status}."
        )
    except HTTPException:
        raise
    except Exception as e:
        db.rollback()
        logger.error(f"Error updating order {order_id} payment status: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail="Internal server error")
    
