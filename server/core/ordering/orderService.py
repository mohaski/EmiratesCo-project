# services/order_service.py
from __future__ import annotations

import json
from datetime import datetime, timedelta
from decimal import Decimal

from fastapi import Depends, HTTPException, Query
from sqlmodel import Session, select, update
from sqlalchemy import func, or_
from sqlalchemy.orm import selectinload
from sqlalchemy.orm.attributes import flag_modified

from entities.orders import Order
from entities.orderItems import OrderItem
from entities.products import Product
from entities.variants import Variant
from entities.customers import Customer
from entities.editHistory import EditHistory
from entities.invoices import Invoice
from db.database import get_session
from loggiing import logger
from utils import require_role, ceil_amount
from ..userManagement.authService import get_current_user
from ..inventory.inventoryService import deduct_stock_for_order_item, lock_stock_rows
from core.audit.opContext import (
    current as current_op,
    operation,
    record_summary,
    set_order,
    stock_operation,
)
from entities.opJournal import (
    OP_CANCEL,
    OP_CUT_CORRECTION,
    OP_CUTTING_REPORT,
    OP_EDIT,
    OP_SALE,
    OP_STATUS,
)
from . import model
from .visibility import HIDDEN_STATUSES, visible_orders, get_visible_order_or_404, order_label
from .orderNumbers import assign_order_no
from core.financials.splitDetails import normalize_payment_details
from typing import List, Optional
from config import nairobi_now





# ---------------------------------------------------------------------------
# Shared helpers
# ---------------------------------------------------------------------------
def _resolve_customer_name(db: Session, customer_id: Optional[int], provided_name: Optional[str]) -> Optional[str]:
    """Customer display name to snapshot onto the order: the registered
    customer's name when one is selected, otherwise whatever name was typed
    in for the walk-in guest."""
    if customer_id:
        customer = db.get(Customer, customer_id)
        return customer.name if customer else None
    return provided_name

def _latest_payment_method(order: Order) -> Optional[str]:
    """Order.payment_method no longer exists — the method shown for an order
    is whichever Payment against it was recorded most recently (mirrors how
    order.customer is already lazy-loaded per order in the response builders
    below; same N+1-per-list-row tradeoff, not a new pattern)."""
    try:
        payments = order.payments
    except Exception:
        return None
    if not payments:
        return None
    return max(payments, key=lambda p: p.payed_at).payment_method

def _order_to_response(order: Order) -> model.OrderResponse:
    """Map ORM → response Pydantic model (centralised)."""
    customer_name = order.customer_name
    customer_type = None
    customer_phone = None
    try:
        if order.customer:
            customer_type = order.customer.type
            customer_phone = order.customer.phoneNumber
    except Exception:
        pass

    amount_paid = order.amountPayed or 0
    balance = order.balance or 0

    return model.OrderResponse(
        orderId=order.orderId,
        orderNo=order.order_no,
        customerId=order.customerid,
        customerName=customer_name,
        customerType=customer_type,
        customerPhone=customer_phone,
        amountPaid=amount_paid,
        servedBy=order.servedby,
        parentOrderId=order.parent_orderid,
        VAT_status=order.VAT_status,
        created_at=order.created_at.isoformat() if order.created_at else "",
        paymentStatus=order.payment_status,
        subtotal=order.subtotal or 0,
        totalAmount=(Decimal(str(amount_paid)) + Decimal(str(balance))),
        discount=order.discount or 0,
        status=order.status,
        paymentMethod=_latest_payment_method(order),
        balance=balance,
        total=order.total or 0,
        source_invoice_id=order.source_invoice_id,
        version=_order_version_of(order),
        items=[
            model.OrderItemResponse(
                itemId=item.item_id,
                productId=item.product_id,
                orderId=item.order_id,
                variantId=item.variant_id,
                quantity=item.details.get("quantity", 0) if item.details else 0,
                unitType=item.details.get("unitType") if item.details else None,
                unitPrice=item.details.get("unitPrice", 0) if item.details else 0,
                totalPrice=item.total_price,
                details=item.details,
                status=None,
                cuttingCompleted=item.cutting_completed,
                cuttingCompletedAt=item.cutting_completed_at.isoformat() if item.cutting_completed_at else None,
            ) for item in order.orderItems
        ]
    )

ORDER_VERSION_KINDS = ("sale", "edit", "cancel", "undo")


def order_version(db: Session, order_id: int, exclude_op: Optional[str] = None) -> str:
    """The latest change that altered what this order IS - its sale, an edit, a cancel or an
    undo - as that operation's id; "none" for an order with no recorded change (older than
    the operation journal). Payments and cutting reports don't count: an edit reads the
    current values of those, so a stale cart can't overwrite them."""
    from entities.opJournal import StockOperation

    conditions = [StockOperation.order_id == order_id, StockOperation.kind.in_(ORDER_VERSION_KINDS)]
    if exclude_op:
        # The operation doing the checking is already in the session - it is not a change
        # someone else made.
        conditions.append(StockOperation.op_id != exclude_op)
    row = db.exec(select(StockOperation.op_id).where(*conditions)
                  .order_by(StockOperation.created_at.desc()).limit(1)).first()
    return row or "none"


def _order_version_of(order: Order) -> Optional[str]:
    from sqlalchemy.orm import object_session

    sess = object_session(order)
    return order_version(sess, order.orderId) if sess is not None else None


# What the shallow response reads per order (customer, and payments for the latest payment
# method), loaded for the whole page at once: lazily it was two queries PER ORDER (118 queries
# for a 100-order page).
_SHALLOW_LOAD = (selectinload(Order.customer), selectinload(Order.payments))


def _order_to_shallow_response(order: Order) -> model.OrderResponse:
    """Map ORM into response Pydantic model WITHOUT loading items (to prevent N+1 list queries)."""
    customer_name = order.customer_name
    customer_type = None
    customer_phone = None
    try:
        if order.customer:
            customer_type = order.customer.type
            customer_phone = order.customer.phoneNumber
    except Exception:
        pass

    amount_paid = order.amountPayed or 0
    balance = order.balance or 0

    return model.OrderResponse(
        orderId=order.orderId,
        orderNo=order.order_no,
        customerId=order.customerid,
        customerName=customer_name,
        customerType=customer_type,
        customerPhone=customer_phone,
        amountPaid=amount_paid,
        servedBy=order.servedby,
        parentOrderId=order.parent_orderid,
        VAT_status=order.VAT_status,
        created_at=order.created_at.isoformat() if isinstance(order.created_at, datetime) else str(order.created_at),
        paymentStatus=order.payment_status,
        subtotal=order.subtotal or 0,
        totalAmount=(Decimal(str(amount_paid)) + Decimal(str(balance))),
        discount=order.discount or 0,
        status=order.status,
        paymentMethod=_latest_payment_method(order),
        balance=balance,
        total=order.total or 0,
        source_invoice_id=order.source_invoice_id,
        items=[]
    )

# ---------------------------------------------------------------------------
# Business logic
# ---------------------------------------------------------------------------

def compute_VAT_amount(subtotal: Decimal) -> Decimal:
    vat = subtotal * Decimal("0.16")  # 16% VAT
    return ceil_amount(vat)

def _calculate_complex_item_total(
    item_req: model.OrderItemRequest, 
    db: Session, 
    products_cache: dict = None, 
    variants_cache: dict = None
) -> Decimal:
    """
    Calculate item total using DB prices for validation.
    Handles both simple items (Variant/Product price) and complex lineItems (Full/Half/Cuts).
    """
    
    # 1. Fetch Product & Variant
    if products_cache is not None and item_req.productId in products_cache:
        product = products_cache[item_req.productId]
    else:
        product = db.get(Product, item_req.productId)
        
    if not product:
        raise HTTPException(status_code=400, detail=f"Product {item_req.productId} not found")
        
    variant = None
    if item_req.variantId:
        if variants_cache is not None and item_req.variantId in variants_cache:
            variant = variants_cache[item_req.variantId]
        else:
            variant = db.get(Variant, item_req.variantId)

    # Pricing/length now live only on the variant. Every product is required to have
    # at least one, so resolve a variant even if the request didn't specify one.
    if variant is None:
        variant = db.exec(select(Variant).where(Variant.product_id == product.productId)).first()

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
                # Use Variant Full Price
                rate = Decimal(variant.price) if variant and variant.price else Decimal("0")
                if rate == 0:
                     rate = Decimal(line.get("rate", 0))

            elif "half" in l_type:
                # Use Variant Half Price
                rate = Decimal(variant.price_half) if variant and variant.price_half else Decimal("0")
                if rate == 0:
                     rate = Decimal(line.get("rate", 0))

            elif "cut" in l_type:
                if "glass" in l_type or "area" in meta:
                    # Glass: area (sqft) × price per sqft → piece price
                    area = Decimal(str(meta.get("area", 0)))
                    sqft_price = Decimal(str(variant.price_unit)) if variant and variant.price_unit else Decimal("0")
                    rate = (area * sqft_price) if sqft_price > 0 else Decimal(str(line.get("rate", 0)))
                else:
                    # Profile / accessory cut: length (ft) × price per foot → line total
                    length = Decimal(str(meta.get("length", 0)))
                    unit_price = Decimal(str(variant.price_unit)) if variant and variant.price_unit else Decimal("0")

                    if length > 0 and unit_price > 0:
                        rate = length * unit_price
                    else:
                        # Frontend sends rate=price_per_foot, qty=1
                        foot_rate = Decimal(str(line.get("rate", 0)))
                        rate = (length * foot_rate) if length > 0 and foot_rate > 0 else foot_rate
            
            # Final Fallback for unmatched types (e.g. 'accessory-unit', 'accessory-roll' etc)
            if rate == 0:
                rate = Decimal(str(line.get("rate", 0)))

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
        # Prefer Variant Price -> Request Unit Price (Legacy/Trust)
        price = Decimal(item_req.unitPrice) # Default to trust if no DB match

        if variant and variant.price > 0:
            price = Decimal(variant.price)

        return Decimal(item_req.quantity) * price




# ---------------------------------------------------------------------------
# Public API
# ---------------------------------------------------------------------------

def settle_new_sale(db: Session, order: Order, final_total: Decimal, amount_paid, payment_method,
                    payment_details, current_user) -> None:
    """The money side of a new sale - the ONE path both checkout (create_order) and a sale
    window's confirm take, so their rules can never drift apart.

    `final_total` is the server's own total. The amount paid is refused when negative or more
    than KSH 1 over the total, rounded like every amount (ceil_amount) and capped at the total;
    the balance under KSH 0.10 is forgiven. A known customer left owing gets a Credit row, and
    money actually collected gets a Payment row carrying the same rounded amount (split
    details checked by normalize_payment_details), so the payment rows and the order agree.
    """
    if (amount_paid or 0) < 0:
        raise HTTPException(status_code=400, detail="The amount paid can't be negative.")
    amount_paid_val = ceil_amount(Decimal(str(amount_paid or 0)))
    # The server prices the order, so the amount is checked against ITS total — a
    # payment above it would leave amountPayed > total and the excess on the books.
    if amount_paid_val > final_total + Decimal("1"):
        raise HTTPException(
            status_code=400,
            detail=(f"The amount paid (KSH {amount_paid_val:,.0f}) is more than the order total "
                    f"(KSH {final_total:,.0f}). Prices may have changed — check the cart and try again."),
        )
    amount_paid_val = min(amount_paid_val, final_total)
    raw_balance = final_total - amount_paid_val
    new_balance = ceil_amount(raw_balance) if raw_balance > Decimal("0.10") else Decimal("0.00")

    order.total = float(final_total)
    order.balance = float(new_balance)
    order.amountPayed = float(amount_paid_val)
    # Same rule as the edit path and invoice conversion.
    order.payment_status = (
        "Paid" if new_balance <= Decimal("0.10")
        else ("Partial" if amount_paid_val > 0 else "Unpaid")
    )
    db.add(order)

    # Auto-create credit record when there is an outstanding balance for a known customer
    if order.balance > 0.01 and order.customerid:
        from entities.credits import Credit
        credit_status = "Partially Paid" if amount_paid_val > 0 else "Pending"
        db.add(Credit(
            orderId=order.orderId,
            customerId=order.customerid,
            amount=float(final_total),
            amount_due=float(order.balance),
            status=credit_status,
        ))
        logger.info(
            f"Credit record created for order {order.orderId}: "
            f"amount={float(final_total):.2f}, due={float(order.balance):.2f}, status={credit_status}"
        )

    # Record payment when money was actually collected — the same rounded amount
    # amountPayed holds, so the payment rows and the order always agree.
    if amount_paid_val > 0:
        from entities.payments import Payment
        pay_method = (payment_method or "cash").lower()
        if pay_method not in {"cash", "mpesa", "split", "number"}:
            pay_method = "cash"
        db.add(Payment(
            orderId=order.orderId,
            amount=float(amount_paid_val),
            payment_method=pay_method,
            reason="order",
            payment_details=normalize_payment_details(pay_method, payment_details, float(amount_paid_val)),
            recorded_by=current_user.userId,
        ))


@stock_operation(OP_SALE, order_arg=None)
def create_order(order_data: model.OrderCreate, db: Session = Depends(get_session), current_user=Depends(get_current_user)) -> model.OrderCreateResponse:
    """
    Create a new order entry + items transactionally.
    - Only users with admin or manager roles can create orders.
    - Returns a structured success message.
    """
    try:
        # 🔐 Ensure user has privilege to create
        require_role(["manager", "cashier", "ceo", "admin"], current_user)

        # Held/abandoned belong to sale windows (windowService) and are never created here.
        if order_data.status in HIDDEN_STATUSES:
            raise HTTPException(status_code=422, detail=f"An order cannot be created as '{order_data.status}'")
        if (order_data.amountPaid or 0) < 0:
            raise HTTPException(status_code=400, detail="The amount paid can't be negative.")
        if (order_data.discount or 0) < 0:
            raise HTTPException(status_code=400, detail="The discount can't be negative.")

        # 1. Validate source invoice (if converting) before touching anything
        source_inv = None
        if order_data.sourceInvoiceId:
            # Locked: two tills converting the same quotation at once would otherwise both see
            # it unconverted - two orders, the stock taken twice. The second now waits and is
            # refused as already converted.
            source_inv = db.exec(select(Invoice).where(Invoice.invoiceId == order_data.sourceInvoiceId)
                                 .with_for_update()).first()
            if not source_inv:
                raise HTTPException(status_code=404, detail=f"Invoice {order_data.sourceInvoiceId} not found")
            if source_inv.status == "converted":
                raise HTTPException(status_code=400, detail="Invoice has already been converted to an order")

        # 2. Create the Order Shell (Pending totals)
        new_order = Order(
            customerid=order_data.customerId,
            customer_name=_resolve_customer_name(db, order_data.customerId, order_data.customerName),
            servedby=order_data.servedBy,
            parent_orderid=order_data.parentOrderId,
            source_invoice_id=order_data.sourceInvoiceId,
            VAT_status=order_data.VAT_status,
            # Placeholder — derived from the server-side totals below, never taken
            # from the client (the server reprices items, so the client's view of
            # "Paid" can be wrong).
            payment_status="Unpaid",
            discount=order_data.discount,
            amountPayed=order_data.amountPaid,
            status=order_data.status or "confirmed",
            subtotal=0.0,
            balance=0.0,
            total=0.0
        )
        
        db.add(new_order)
        db.flush()  # Generate orderId without committing
        set_order(new_order.orderId)

        # Pre-fetch Products and Variants for performance (N+1 fix)
        product_ids = [item.productId for item in order_data.items]
        variant_ids = [item.variantId for item in order_data.items if item.variantId]
        # Before any item is inserted: one global lock order, or two checkouts deadlock.
        lock_stock_rows(db, product_ids, variant_ids)

        products_cache = {}
        if product_ids:
            products = db.exec(select(Product).where(Product.productId.in_(product_ids))).all()
            products_cache = {p.productId: p for p in products}

        variants_cache = {}
        if variant_ids:
            variants = db.exec(select(Variant).where(Variant.variantId.in_(variant_ids))).all()
            variants_cache = {v.variantId: v for v in variants}

        # 2. Process Items & Calculate Subtotal
        calculated_subtotal = Decimal("0.00")

        for cart_index, item_req in enumerate(order_data.items):
            item_total = ceil_amount(_calculate_complex_item_total(item_req, db, products_cache, variants_cache))

            store_unit_price = item_total
            if item_req.quantity > 0:
                store_unit_price = item_total / Decimal(item_req.quantity)

            final_details = dict(item_req.details or {})
            final_details.pop("_sourceItemId", None)
            final_details["quantity"] = item_req.quantity
            final_details["unitType"] = item_req.unitType
            final_details["unitPrice"] = float(store_unit_price)

            new_item = OrderItem(
                order_id=new_order.orderId,
                product_id=item_req.productId,
                variant_id=item_req.variantId,
                total_price=float(item_total),
                details=final_details,
                position=cart_index,
            )
            db.add(new_item)

            # Deduct Stock & Handle Offcuts
            deduct_stock_for_order_item(db, new_item)

            calculated_subtotal += item_total

        # 3. Apply Financials to Order
        discount_val = Decimal(str(order_data.discount or 0))
        net_subtotal = ceil_amount(max(calculated_subtotal - discount_val, Decimal("0.00")))

        if new_order.VAT_status:
            vat_amount = compute_VAT_amount(net_subtotal)
            final_total = net_subtotal + vat_amount
        else:
            final_total = net_subtotal

        new_order.subtotal = float(net_subtotal)
        new_order.total = float(final_total)
        # Money: shared with the sale-window confirm, so the two can never charge differently.
        settle_new_sale(db, new_order, final_total, order_data.amountPaid, order_data.paymentMethod,
                        order_data.paymentDetails, current_user)
        db.add(new_order)

        # Mark source invoice as converted in the same transaction
        if source_inv is not None:
            from datetime import datetime, timezone
            source_inv.status = "converted"
            source_inv.order_id = new_order.orderId
            source_inv.converted_at = datetime.now(timezone.utc)
            db.add(source_inv)

        # Last, after every stock lock: the counter row serialises confirms (orderNumbers.py).
        assign_order_no(db, new_order)
        db.commit()

        logger.info(f"Order {new_order.orderId} (no. {new_order.order_no}) created (Items: {len(order_data.items)}) by {current_user.userId}.")
        return model.OrderCreateResponse(
            message="Order created successfully",
            orderId=new_order.orderId,
            orderNo=new_order.order_no,
        )
    except HTTPException:
        # Some refusals (the amount checks) come after stock was already deducted in
        # this session — never leave that pending on the session.
        db.rollback()
        raise
    except ValueError as e:
        db.rollback()
        raise HTTPException(status_code=422, detail=str(e))
    except Exception as e:
        db.rollback()
        logger.error(f"Error creating transactional order: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail="Something went wrong while creating the order. Please try again.")
    
def get_order_by_number(order_no: int, db: Session) -> model.OrderResponse:
    """An order by the number people know it by (orders.order_no - receipts, the order card),
    which is not its internal id once sale windows have used ids up."""
    order = db.exec(select(Order).where(Order.order_no == order_no, visible_orders())).first()
    if order is None:
        raise HTTPException(status_code=404, detail=f"No order number {order_no}")
    return _order_to_response(order)


def get_order_by_orderId(order_id: int, db: Session = Depends(get_session)) -> model.OrderResponse:
    """
    Retrieve an order by its ID.
    - Returns the order details if found.
    - Raises 404 error if the order does not exist.
    """
    try:
        order = get_visible_order_or_404(db, order_id)
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
                Order.VAT_status == False,
                visible_orders(),
            )
            .offset(skip)
            .limit(limit)
        )
        orders = db.exec(statement.options(*_SHALLOW_LOAD)).all()
        return [_order_to_shallow_response(order) for order in orders]

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
                Order.VAT_status == True,
                visible_orders(),
            )
            .offset(skip)
            .limit(limit)
        )
        orders = db.exec(statement.options(*_SHALLOW_LOAD)).all()
        return [_order_to_shallow_response(order) for order in orders]

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
            .where(Order.customerid == customer_id, visible_orders())
            .offset(skip)
            .limit(limit)
        )
        orders = db.exec(statement.options(*_SHALLOW_LOAD)).all()
        return [_order_to_shallow_response(order) for order in orders]

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
            .where(Order.servedby == user_id, visible_orders())
            .offset(skip)
            .limit(limit)
        )
        orders = db.exec(statement.options(*_SHALLOW_LOAD)).all()
        return [_order_to_shallow_response(order) for order in orders]

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
            Order.created_at <= f"{date} 23:59:59",
            visible_orders(),
        )
        orders = db.exec(statement.options(*_SHALLOW_LOAD)).all()
        return [_order_to_shallow_response(order) for order in orders]
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
        statement = select(Order).where(Order.parent_orderid == parent_order_id, visible_orders())
        orders = db.exec(statement.options(*_SHALLOW_LOAD)).all()
        return [_order_to_shallow_response(order) for order in orders]
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error retrieving child orders for parent order {parent_order_id}: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail="Internal server error")
    
def get_all_orders(
    db: Session = Depends(get_session),
    skip: int = Query(0, ge=0, description="Number of records to skip"),
    limit: int = Query(100, ge=1, le=500, description="Maximum number of records to return"),
    search: str | None = None,
) -> list[model.OrderResponse]:
    """
    Retrieve all orders in the system with pagination, newest first.
    `search` narrows to orders whose customer name contains it (any age) — Order History
    only loads the newest page, so a name search must reach older orders here. A search that
    is a number also matches that order NUMBER (orders.order_no, the one on the receipt).
    """
    try:
        statement = select(Order).where(visible_orders())
        if search and search.strip():
            term = search.strip().lstrip("#")
            by_name = Order.customer_name.ilike(f"%{search.strip()}%")
            # A number also matches the order NUMBER - but only one that fits its 32-bit column:
            # a phone number (2547...) overflowed Postgres and failed the whole search.
            as_number = int(term) if term.isdigit() and int(term) <= 2147483647 else None
            statement = statement.where(or_(by_name, Order.order_no == as_number) if as_number else by_name)
        statement = statement.order_by(Order.created_at.desc()).offset(skip).limit(limit)
        orders = db.exec(statement.options(*_SHALLOW_LOAD)).all()

        return [_order_to_shallow_response(order) for order in orders]

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
        statement = select(Order).where(Order.VAT_status == True, visible_orders())
        orders = db.exec(statement.options(*_SHALLOW_LOAD)).all()

        return [_order_to_shallow_response(order) for order in orders]

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error retrieving VAT-included orders: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail="Internal server error")

# Keys the cut/stock engines WRITE into a line after the fact. They are the result of a
# consumption, not an input to it, so they must not make an otherwise identical line look
# changed — a round-tripped cart carries them back from the order it was loaded from.
#
#   offcut_sources   cut lines, 1D and 2D (inventoryService / glassOffcutService)
#   stock_sources    packaged/boxed accessory draws and open-container dispenses
#                    (inventoryService._deduct_packaged_stock_pooled,
#                     _dispense_from_open_container)
#   _resolved_as_2d  marks a sheet-half line the 2D engine took over
#                    (inventoryService._process_line_items)
#
# NOT stripped: `offcut_selection`. That one is written by the FRONTEND
# (ProfileCalculator) and is the cashier's manual choice of which offcut to cut from —
# a genuine input, so changing it must count as changing the line.
#
# `meta` carries the real cut dimensions, so it is compared -- minus the keys listed in
# _IGNORED_META_KEYS / _SHEET_HALF_DERIVED_META_KEYS below. A false "changed" is NOT the
# safe way to err: it puts an untouched glass item in front of the operator as a cut to
# confirm, and a wrong answer there reverses real, already-cut material.
#
# These also drift under the order's feet: a manager offcut correction, or a container
# being finished and reopened, rewrites them on the stored item while a cashier has the
# order open. Comparing them would then reverse and re-deduct material nobody touched.
_ENGINE_WRITTEN_LINE_KEYS = ("offcut_sources", "stock_sources", "_resolved_as_2d", "voided_sources")

# Per-line pricing and display, written by the frontend calculators. Excluded for the same
# reason as the item's own unitPrice: money does not describe a different consumption, and
# the backend reprices from the DB anyway (_calculate_complex_item_total). Comparing them
# would reverse and re-cut real material over a tariff change.
_PRICE_AND_DISPLAY_LINE_KEYS = ("rate", "total", "label")

_IGNORED_LINE_KEYS = _ENGINE_WRITTEN_LINE_KEYS + _PRICE_AND_DISPLAY_LINE_KEYS

# The glass calculator's per-sq-ft price, nested in a glass-cut line's meta. Price, not
# consumption, for the same reason as `rate` above -- and it changes whenever the tariff
# does, so reopening an old glass item and saving it unchanged would otherwise count as
# an edit.
_IGNORED_META_KEYS = ("rateSqFt",)

# On a sheet-half line the calculator writes only meta.halfSide; _process_line_items then
# injects l/w/u, worked out from the variant's sheet size and halfSide -- both of which
# the signature already compares. Derived, so not an input. Worse, the engine stores them
# as floats (1650.0), and a float that is a whole number comes back from the browser as an
# int (1650): JSON has one number type. Compared as written, every order with a half sheet
# of glass looked edited on every edit, so changing an unrelated accessory asked the
# operator to confirm the glass cuts and reversed them on the answer.
_SHEET_HALF_DERIVED_META_KEYS = ("l", "w", "u")


def _canonical_numbers(value):
    """Write every whole-number float as an int, recursively (1650.0 -> 1650).

    The stored side of a comparison comes out of a Postgres JSON column exactly as the
    backend wrote it; the incoming side has been through the browser, where 1650.0 and
    1650 are the same number and JSON.stringify writes it as 1650. Without this the two
    serialize differently and an untouched line reads as changed.
    """
    if isinstance(value, float) and value.is_integer():
        return int(value)
    if isinstance(value, dict):
        return {k: _canonical_numbers(v) for k, v in value.items()}
    if isinstance(value, list):
        return [_canonical_numbers(v) for v in value]
    return value


def _stock_signature(product_id, variant_id, unit_type, quantity, line_items) -> str:
    """Canonical form of everything that determines an item's STOCK consumption.

    Two items with the same signature consume the same material, so an edit that leaves one
    untouched can leave its stock, its offcut chain and its cutting status completely alone
    (see update_order). Deliberately EXCLUDES price: stock doesn't depend on what it sold
    for, so a price-only change must not reverse and re-cut real material.
    """
    def norm_line(line):
        if not isinstance(line, dict):
            return repr(line)
        keep = {k: v for k, v in line.items() if k not in _IGNORED_LINE_KEYS}
        if isinstance(keep.get("meta"), dict):
            drop = _IGNORED_META_KEYS
            if keep.get("type") == "sheet-half":
                drop = drop + _SHEET_HALF_DERIVED_META_KEYS
            keep["meta"] = {k: v for k, v in keep["meta"].items() if k not in drop}
        return json.dumps(_canonical_numbers(keep), sort_keys=True, default=str)

    lines = [norm_line(l) for l in (line_items or [])]
    return json.dumps({
        "p": product_id,
        "v": variant_id,
        "u": unit_type,
        "q": float(quantity or 0),
        "l": lines,
    }, sort_keys=True)


CANCEL_WINDOW = timedelta(days=7)


def _order_age(db: Session, order: Order) -> timedelta:
    """How long ago the order was placed, measured on the database's own clock.

    orders.created_at is `timestamp without time zone` filled by server_default now() in a
    session whose TimeZone is Africa/Nairobi, so it holds LOCAL time. The cancel window used
    to subtract it from nairobi_now(), which made every order look three hours younger
    than it was — the "7-day" window was really 7 days 3 hours, and a fresh order computed
    to a negative age. Asking the database for now() in the same local frame avoids
    depending on either the machine's timezone or Python's.
    """
    if order.created_at is None:
        return timedelta(0)
    # now() comes back tz-aware in the session's zone (+03:00); dropping the tzinfo leaves the
    # same local wall-clock time created_at was stored in.
    now_local = db.exec(select(func.now())).one().replace(tzinfo=None)
    return now_local - order.created_at


def _remap_offcut_selection(db, selection, old_sources) -> list:
    """Keep a cashier's manual offcut pick valid across an edit that re-cuts the line.

    `offcut_selection` names pooled `offcuts` rows by id, and those ids are not stable: when
    this line's own cut used an offcut up, its row was deleted, and the reversal that runs
    first in update_order puts the material back as a NEW row. Re-cutting with the stored id
    then failed the whole edit with "Offcut #N no longer exists" — something the cashier had
    no way to fix. This was pre-existing; the old teardown-and-rebuild hit it on ANY edit of
    such an order, even one touching a different item.

    For each picked row, in order:
      1. still there with a unit to spare  -> keep it
      2. otherwise follow the ledger: the round-tripped offcut_sources say which PIECE was
         consumed from that row, and the reversal released that piece into whatever row
         now holds it -> point the pick at that row (the same physical piece)
      3. otherwise drop it. apply_manual_cut_selection tops any shortfall up exactly as the
         automatic path would, so the cut still happens — it just isn't pinned.
    """
    from collections import Counter

    from entities.offcuts import Offcut
    from core.inventory import offcutLedger as ledger

    pieces_by_row: dict = {}
    for src in old_sources or []:
        if isinstance(src, dict) and src.get("source") == "offcut" and src.get("offcut_id"):
            pieces_by_row.setdefault(int(src["offcut_id"]), []).append(src.get("source_piece_id"))

    claimed: Counter = Counter()
    out = []
    for entry in selection or []:
        if isinstance(entry, dict) and entry.get("returned_ref"):
            # A pick of a piece this very edit hands back (the calculator's projected pool):
            # resolve it to the piece the reversal just produced, wherever it was pooled.
            piece = _returned_piece(db, entry["returned_ref"])
            row = db.get(Offcut, piece.offcut_row_id) if (piece is not None and piece.offcut_row_id
                                                          and piece.state == "available") else None
            if row is None or (row.quantity or 0) - claimed[row.offcutId] < 1:
                label = entry.get("returned_label") or "the returned piece"
                raise ValueError(
                    f"The cut was set to use {label}, but with the cut answers given that piece "
                    "doesn't come back. Open the item and choose its offcuts again."
                )
            claimed[row.offcutId] += 1
            out.append({**entry, "offcut_id": row.offcutId, "prefer_piece_id": piece.piece_id})
            continue
        if not isinstance(entry, dict) or not entry.get("offcut_id"):
            continue
        row_id = int(entry["offcut_id"])
        need = float(entry.get("length_used") or 0)

        row = db.get(Offcut, row_id)
        if row is not None and (row.quantity or 0) - claimed[row_id] >= 1:
            claimed[row_id] += 1
            out.append(entry)
            continue

        remapped = None
        candidates = pieces_by_row.get(row_id) or []
        while candidates and remapped is None:
            piece = ledger.get_piece(db, candidates.pop(0))
            if piece is None or piece.state != "available" or not piece.offcut_row_id:
                continue
            new_row = db.get(Offcut, piece.offcut_row_id)
            if (new_row is not None
                    and (new_row.quantity or 0) - claimed[new_row.offcutId] >= 1
                    and (new_row.length or 0) + 0.02 >= need):
                claimed[new_row.offcutId] += 1
                remapped = {**entry, "offcut_id": new_row.offcutId}

        if remapped is not None:
            out.append(remapped)
        else:
            logger.info(
                f"update_order: manual offcut pick #{row_id} is no longer available and could "
                "not be traced to its replacement; letting the automatic path cover that length"
            )
    return out


def _line_without_selection(line: dict) -> str:
    keep = {k: v for k, v in line.items() if k not in _IGNORED_LINE_KEYS and k != "offcut_selection"}
    return json.dumps(_canonical_numbers(keep), sort_keys=True, default=str)


def _reuse_own_pieces(db, new_lines: list, old_lines: Optional[list], source_item_id) -> None:
    """An already-cut 1D cut line re-cut UNCHANGED - only because something else on its item
    changed - takes back exactly its own pieces, which the reversal just returned as "own".

    Otherwise the re-cut looks for ONE piece at least the cut's length. A cut delivered as
    several pieces (order 117: 8ft = 6ft + 2ft from two offcuts) can't be matched that way,
    so the edit either failed on an empty shelf or opened a new bar and sent the item back to
    the cutting queue for material that already exists.

    A line whose manual pick the cashier changed keeps the new pick. The picks made here are
    ordinary returned-piece picks, resolved by _remap_offcut_selection like any other.
    """
    op = current_op()
    if op is None or not old_lines or source_item_id is None:
        return
    from core.inventory import offcutLedger as ledger

    used = set()
    for line in new_lines:
        l_type = line.get("type", "") if isinstance(line, dict) else ""
        if "cut" not in l_type or l_type == "glass-cut":
            continue
        sig = _line_without_selection(line)
        for j, old in enumerate(old_lines):
            if j in used or not isinstance(old, dict) or _line_without_selection(old) != sig:
                continue
            # A pick the cashier CHANGED is theirs to keep; the pick the line was originally
            # cut with is spent (those pieces are the ones coming back below).
            if line.get("offcut_selection") and line.get("offcut_selection") != old.get("offcut_selection"):
                break
            ref = f"{source_item_id}:{j}"
            entries = op.returned.get(ref) or []
            if not entries or any(e["kind"] != "own" for e in entries):
                break
            pieces = [ledger.get_piece(db, e["piece_id"]) for e in entries]
            try:
                need = float((line.get("meta") or {}).get("length") or 0) * int(line.get("qty") or 0)
            except (TypeError, ValueError):
                break
            if any(p is None for p in pieces) or abs(sum(p.length for p in pieces) - need) > 0.02:
                break
            line["offcut_selection"] = [
                {"offcut_id": None, "returned_ref": f"{ref}#{k}", "length_used": p.length,
                 "returned_label": f"{p.length:.2f} - the cut piece"}
                for k, p in enumerate(pieces)
            ]
            used.add(j)
            break


def _tidy_offcut_selection(item) -> None:
    """After a re-cut, store the manual pick as plain {offcut_id, length_used} - the keys the
    edit used to resolve it (a returned piece's ref, the exact piece) are spent - and keep the
    item-level copy the calculator reopens from in step with the line, so reopening the item
    later doesn't read as a change."""
    details = dict(item.details or {})
    changed = False
    for line in details.get("lineItems") or []:
        sel = line.get("offcut_selection") if isinstance(line, dict) else None
        if not sel:
            continue
        clean = [{"offcut_id": e.get("offcut_id"), "length_used": e.get("length_used")}
                 for e in sel if isinstance(e, dict) and e.get("offcut_id")]
        line["offcut_selection"] = clean
        if "offcutSelection" in details:
            details["offcutSelection"] = clean
        changed = True
    if changed:
        item.details = details
        flag_modified(item, "details")


def _returned_piece(db, ref: str):
    """The piece a returned-piece pick ("<item>:<line>#<n>") refers to, from the running
    operation's reversal record (core/audit/opContext.OpContext.returned)."""
    from core.inventory import offcutLedger as ledger

    op = current_op()
    if op is None or not ref:
        return None
    line_ref, _, idx = str(ref).partition("#")
    entries = op.returned.get(line_ref) or []
    try:
        entry = entries[int(idx or 0)]
    except (ValueError, IndexError):
        return None
    return ledger.get_piece(db, entry["piece_id"])


def _assert_cart_is_this_orders(db: Session, order_id: int, item_requests) -> None:
    """Refuse a cart whose lines were opened from a DIFFERENT order.

    Lines loaded from a saved order carry details._sourceItemId. If any of those items
    belongs to another order, saving would rebuild THIS order out of that order's goods —
    which is what a stale edit session in the browser once did (the cart had been reloaded
    with order B while the session still pointed at order A, so the save went to A). An
    item that no longer exists (replaced by a later edit) proves nothing and is ignored;
    the version check covers that case.
    """
    source_ids = {
        sid for sid in ((r.details or {}).get("_sourceItemId") for r in (item_requests or []))
        if isinstance(sid, int)
    }
    if not source_ids:
        return
    foreign = db.exec(
        select(OrderItem.item_id, OrderItem.order_id)
        .where(OrderItem.item_id.in_(source_ids), OrderItem.order_id != order_id)
    ).all()
    if foreign:
        other = sorted({row[1] for row in foreign})
        raise HTTPException(
            status_code=409,
            detail=(f"This cart holds items from {', '.join(order_label(db, o) for o in other)}, not {order_label(db, order_id)}. "
                    "Discard the edit and open the order you want to change again."),
        )


def _match_items(existing_items, item_requests):
    """Pair the incoming cart against the order as it stands.

    Returns (reused, reversing, unmatched):
      reused      [(cart_index, request, existing_item)] -- identical, leave the material alone
      reversing   [existing_item]                        -- changed or removed, reverse and delete
      unmatched   [(cart_index, request)]                -- new or changed, create and deduct

    The cart index rides along because it is the item's position in the order as the cashier
    built it, which callers match against positionally and which item_id no longer implies.

    Matching is by _stock_signature and consumes each existing item at most once, so two
    identical cart lines pair with two existing rows rather than both claiming the same one.
    """
    buckets: dict = {}
    for oi in existing_items:
        sig = _stock_signature(
            oi.product_id,
            oi.variant_id,
            (oi.details or {}).get("unitType"),
            (oi.details or {}).get("quantity"),
            (oi.details or {}).get("lineItems"),
        )
        buckets.setdefault(sig, []).append(oi)

    # Two identical items (same product, size and cuts) share a signature, so which saved row a
    # cart line pairs with used to be first-come - and when their cut histories differ, the
    # UNTOUCHED one could be the one reversed (order 136). The cart says which saved item each
    # line came from (details._sourceItemId, set when the order is opened for editing); lines
    # that name theirs are paired first, the rest take what is left in order.
    reused, unmatched = [], []
    pending = []
    for cart_index, req in enumerate(item_requests):
        sig = _stock_signature(
            req.productId, req.variantId, req.unitType, req.quantity,
            (req.details or {}).get("lineItems"),
        )
        pool = buckets.get(sig) or []
        source_id = (req.details or {}).get("_sourceItemId")
        named = next((oi for oi in pool if source_id is not None and oi.item_id == source_id), None)
        if named is not None:
            pool.remove(named)
            reused.append((cart_index, req, named))
        else:
            pending.append((cart_index, req, sig))
    for cart_index, req, sig in pending:
        pool = buckets.get(sig)
        if pool:
            reused.append((cart_index, req, pool.pop(0)))
        else:
            unmatched.append((cart_index, req))
    reused.sort(key=lambda r: r[0])

    reversing = [oi for pool in buckets.values() for oi in pool]
    return reused, reversing, unmatched


def update_order(
    order_id: int,
    order_data: model.OrderEditRequest,
    db: Session,
    current_user,
) -> model.OrderCreateResponse:
    """The edit endpoint: one edit is one operation (core/audit/opContext) and one transaction.

    The work itself is apply_order_edit, which never commits — so the undo tool can re-run an
    edit, with corrected cut answers, inside the same transaction as the undo it follows.
    The request is stored on the operation for exactly that reason.
    """
    require_role(["manager", "ceo", "admin"], current_user)
    try:
        with operation(db, OP_EDIT, actor=current_user, order_id=order_id,
                       request=order_data.model_dump(mode="json") if order_data is not None else None):
            apply_order_edit(order_id, order_data, db, current_user)
        db.commit()
    except HTTPException:
        db.rollback()
        raise
    except Exception as e:
        db.rollback()
        logger.error(f"Error editing order {order_id}: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail="Something went wrong while updating the order. Please try again.")

    logger.info(f"Order {order_id} edited by {current_user.userId}")
    return model.OrderCreateResponse(message="Order updated successfully", orderId=order_id)


def apply_order_edit(
    order_id: int,
    order_data: model.OrderEditRequest,
    db: Session,
    current_user,
    money_check: bool = True,
) -> dict:
    """
    Edit an existing order in-place (no commit — see update_order):
      1. Snapshot the before state for audit.
      2. Work out which items actually changed.
      3. Restore stock from, and delete, only the CHANGED items.
      4. Create the new/changed items and deduct their stock.
      5. Recalculate order totals across every item, changed or not.
      6. Write an EditHistory record.

    Step 2 is what keeps an edit from disturbing material it has no business touching. This
    used to tear down every item and rebuild it, which meant editing one line reversed and
    re-cut ALL of them — and because a freshly created item starts with
    cutting_completed=False, an already-cut line went straight back into the cutting queue
    for the floor to cut a second time.

    Items are matched by _stock_signature: same product, variant, unit and quantity, and the
    same cut lines ignoring the engines' own bookkeeping. An unchanged item keeps its row,
    its offcut chain, its provenance and its cutting status; only its price is refreshed.
    Financials are still recalculated over every item, so a price change alone never moves
    material.

    Granularity is the item, not the individual cut line. That matches the data (62 of 66
    cut-bearing items carry exactly one cut line) and is forced for glass anyway, where
    resolve_glass_cut_lines packs every cut of an item into one sheet as a single batch — so
    no subset of those lines can be reused independently.

    money_check: the payment sent must fit the server's totals and what is already paid
    (else 409/400 — the cashier's screen was out of date). False only for the undo tool's
    corrections, which re-run an edit with amountPaid=0 to rebuild the goods and leave the
    money exactly as the original edit recorded it.
    """
    from core.inventory.inventoryService import (
        deduct_stock_for_order_item,
        restore_stock_for_order_item,
    )
    from entities.editHistory import EditHistory
    from entities.products import Product
    from entities.variants import Variant
    from core.inventory import reversalPlan

    require_role(["manager", "ceo", "admin"], current_user)
    if money_check and (getattr(order_data, "discount", 0) or 0) < 0:
        raise HTTPException(status_code=400, detail="The discount can't be negative.")

    # Locked for the rest of the transaction: two saves of the same order are serialised, so
    # the version check below can't let both through.
    order = db.exec(select(Order).where(Order.orderId == order_id).with_for_update()).first()
    if not order or order.status in HIDDEN_STATUSES:
        raise HTTPException(status_code=404, detail="Order not found")
    running = current_op()
    if getattr(order_data, "orderVersion", None) is not None and order_data.orderVersion != order_version(
            db, order_id, exclude_op=running.op_id if running else None):
        # Saving this cart would silently undo whatever changed the order since it was opened
        # here (another device's edit, a cancel, an undo). Refused; the cashier reopens it.
        raise HTTPException(
            status_code=409,
            detail=(f"{order_label(db, order_id).capitalize()} was changed on another device after you opened it here. "
                    "Nothing was saved - reopen the order from Order History and make your change again."),
        )
    # A finished or cancelled order is off limits. This blocked every CUT order too until
    # mark_cutting_complete_for_orders_batch stopped auto-completing them: reporting a
    # cutting job done no longer touches the order's workflow status, so "completed" once
    # again means only what a human set it to, and a cut-but-unfinished order stays
    # editable through the confirmation flow below.
    if order.status in ("cancelled", "completed"):
        raise HTTPException(status_code=400, detail=f"Cannot edit a {order.status} order")

    # An order whose cutting was reported used to be refused outright here. Now each cut
    # line is confirmed independently (see core/inventory/reversalPlan.py): an already-cut
    # line is never recombined into a whole bar, but the order can still be edited. Lines
    # that need no judgement fall back to their prefilled default, so editing a fresh
    # order needs no confirmation payload and behaves exactly as it did before.
    # Which existing items does the incoming cart still contain unchanged? Those are left
    # entirely alone; everything else is reversed and rebuilt. Worked out before the
    # confirmation is validated, so the operator is only ever asked about material this
    # edit actually disturbs.
    _assert_cart_is_this_orders(db, order_id, order_data.items)
    existing_items = db.exec(select(OrderItem).where(OrderItem.order_id == order_id)).all()
    # Before any item is reversed or inserted: the global lock order (inventoryService.lock_stock_rows).
    lock_stock_rows(db, [i.product_id for i in existing_items] + [r.productId for r in order_data.items],
                    [i.variant_id for i in existing_items] + [r.variantId for r in order_data.items])
    reused_items, reversing_items, unmatched_requests = _match_items(existing_items, order_data.items)
    reversing_item_ids = {oi.item_id for oi in reversing_items}

    reversal_plan = reversalPlan.build_plan(db, order, reversing_item_ids=reversing_item_ids)
    try:
        # Phase 4: refuse a confirmation built against a plan the chain has since moved
        # past, rather than applying a verdict that is no longer true.
        reversalPlan.assert_plan_fresh(db, reversal_plan, order_data.planToken)
        cut_decisions = reversalPlan.validate_decisions(reversal_plan, order_data.cutConfirmations)
    except reversalPlan.PlanStaleError as e:
        raise HTTPException(status_code=409, detail={"message": str(e), "plan": e.fresh_plan})
    except ValueError as e:
        raise HTTPException(status_code=422, detail=str(e))

    try:
        # ── 1. Snapshot before state ──────────────────────────────────────────
        old_items_snapshot = [
            {
                "product_id": oi.product_id,
                "variant_id": oi.variant_id,
                "total_price": oi.total_price,
                "details": oi.details,
            }
            for oi in order.orderItems
        ]
        before_snapshot = {
            "subtotal": order.subtotal,
            "total": order.total,
            "discount": order.discount,
            "payment_status": order.payment_status,
            "items": old_items_snapshot,
            # What the operator confirmed about each cut line, and what the chain said
            # about it — the CEO needs this to audit why stock moved the way it did.
            "cut_confirmations": reversalPlan.decisions_summary(reversal_plan, cut_decisions),
        }

        # ── 2. Restore stock from old items ───────────────────────────────────
        # Load into a plain list first so the loop isn't affected by deletions
        # Lock every piece this reversal will touch, lowest id first, before anything is
        # written — so a batch of per-line answers applies all-or-nothing and two
        # overlapping reversals can't deadlock.
        reversalPlan.lock_decision_pieces(db, reversal_plan)

        doomed_ids = [oi.item_id for oi in reversing_items]
        # What the reversed items' lines were, for re-cutting an unchanged already-cut line
        # from its own pieces (see _reuse_own_pieces).
        source_lines = {oi.item_id: list((oi.details or {}).get("lineItems") or []) for oi in reversing_items}
        if doomed_ids:
            # Which offcut rows named these items as their producer - recorded so an undo can
            # put the links back (they drive the "source not cut yet" notice).
            from entities.offcuts import Offcut as _Off
            links = db.exec(select(_Off.offcutId, _Off.source_item_id).where(
                _Off.source_item_id.in_(doomed_ids))).all()
            record_summary(current_op(), provenance=[[int(a), int(b)] for a, b in links])
            # A pooled/scrap Offcut row can outlive the item that last produced
            # it (restore only decrements its quantity, since other unrelated
            # cuts still own the rest) — leaving offcuts.source_item_id dangling
            # at an item we're about to delete, which offcuts_source_item_id_fkey
            # then refuses. Clear it here; it's provenance metadata only (drives
            # the advisory "still awaiting cutting" notice), never load-bearing
            # for stock accounting, so nulling it for a since-deleted item is safe.
            # Scoped to the items actually being deleted -- a KEPT item must hold on to its
            # provenance, or its offcuts stop reporting whose cutting job produced them.
            from entities.offcuts import Offcut
            db.exec(update(Offcut).where(Offcut.source_item_id.in_(doomed_ids)).values(source_item_id=None))
        # Newest first, for the same reason as _restore_and_cancel.
        for old_item in sorted(reversing_items, key=lambda oi: oi.item_id, reverse=True):
            restore_stock_for_order_item(db, old_item, decisions=cut_decisions)
            db.delete(old_item)
        db.flush()
        # Later cuts from the same material that the operator confirmed made are marked cut
        # on their own orders, so the floor doesn't cut them twice.
        reversalPlan.apply_later_cut_answers(db, reversal_plan, cut_decisions, order_id)
        # Expire the order object so its stale orderItems collection is cleared;
        # otherwise SQLAlchemy hits the now-deleted instances when we add new items.
        db.expire(order)

        # ── 3. Pre-fetch products/variants ────────────────────────────────────
        product_ids = [i.productId for i in order_data.items]
        variant_ids = [i.variantId for i in order_data.items if i.variantId]

        products_cache = {}
        if product_ids:
            prods = db.exec(select(Product).where(Product.productId.in_(product_ids))).all()
            products_cache = {p.productId: p for p in prods}

        variants_cache = {}
        if variant_ids:
            vars_ = db.exec(select(Variant).where(Variant.variantId.in_(variant_ids))).all()
            variants_cache = {v.variantId: v for v in vars_}

        # ── 4. Create new items and deduct stock ──────────────────────────────
        # Every item is repriced, so a tariff change still lands. Only changed ones move stock.
        calculated_subtotal = Decimal("0.00")
        new_items_snapshot = []

        for cart_index, item_req, kept_item in reused_items:
            # An untouched item keeps the price it was SOLD at. It used to be repriced from
            # today's price list on every edit, so editing one item silently changed what the
            # customer owed for the others (order 103: a 1,400 refund nobody asked for).
            # `details` keeps the STORED copy too: it holds the offcut_sources this item's real
            # consumption recorded, which a round-tripped cart copy can't be trusted for.
            item_total = Decimal(str(kept_item.total_price or 0))
            kept_item.position = cart_index
            db.add(kept_item)

            calculated_subtotal += item_total
            new_items_snapshot.append({
                "position": cart_index,
                "product_id": kept_item.product_id,
                "variant_id": kept_item.variant_id,
                "total_price": float(item_total),
                "unchanged": True,
            })

        for cart_index, item_req in unmatched_requests:
            item_total = ceil_amount(_calculate_complex_item_total(item_req, db, products_cache, variants_cache))

            store_unit_price = item_total / Decimal(item_req.quantity) if item_req.quantity > 0 else item_total
            final_details = dict(item_req.details or {})
            source_item_id = final_details.pop("_sourceItemId", None)
            final_details.pop("_source", None)
            _reuse_own_pieces(db, final_details.get("lineItems") or [],
                              source_lines.get(source_item_id) if doomed_ids else None, source_item_id)
            final_details["quantity"] = item_req.quantity
            final_details["unitType"] = item_req.unitType
            final_details["unitPrice"] = float(store_unit_price)
            # Drop any offcut_sources the cart round-tripped in from the order it was loaded
            # from: this is a NEW consumption and the engines record their own. Before they go,
            # use them to repoint a manual offcut pick at wherever the reversal above put that
            # piece back (see _remap_offcut_selection).
            for line in final_details.get("lineItems") or []:
                if isinstance(line, dict):
                    if line.get("offcut_selection"):
                        remapped = _remap_offcut_selection(
                            db, line["offcut_selection"], line.get("offcut_sources"))
                        if remapped:
                            line["offcut_selection"] = remapped
                        else:
                            line.pop("offcut_selection")
                    line.pop("offcut_sources", None)
                    line.pop("voided_sources", None)

            new_item = OrderItem(
                order_id=order.orderId,
                product_id=item_req.productId,
                variant_id=item_req.variantId,
                total_price=float(item_total),
                details=final_details,
                position=cart_index,
            )
            db.add(new_item)
            db.flush()
            deduct_stock_for_order_item(db, new_item)
            _tidy_offcut_selection(new_item)

            calculated_subtotal += item_total
            new_items_snapshot.append({
                "position": cart_index,
                "product_id": item_req.productId,
                "variant_id": item_req.variantId,
                "total_price": float(item_total),
            })

        # Kept items are processed before new ones, so the snapshot is built out of order.
        # Put it back into cart order — it is the audit record of what the order became.
        new_items_snapshot.sort(key=lambda r: r.get("position", 0))

        # ── 5. Recalculate totals ─────────────────────────────────────────────
        discount_val = Decimal(str(order_data.discount or 0))
        net = ceil_amount(max(calculated_subtotal - discount_val, Decimal("0.00")))
        vat = compute_VAT_amount(net) if order_data.VAT_status else Decimal("0.00")
        final_total = net + vat

        # Accumulate payments: add the new payment on top of what was already collected.
        # new_payment is signed — positive when more was collected on this edit,
        # negative when a refund was paid out (item total dropped below what was
        # already collected) — so this same accumulation handles both directions.
        new_payment = ceil_amount(Decimal(str(order_data.amountPaid)))
        prior_paid = Decimal(str(order.amountPayed or 0))
        total_paid = max(Decimal("0.00"), min(prior_paid + new_payment, final_total))
        new_balance = max(final_total - total_paid, Decimal("0.00"))
        # What actually moves onto the order. The Payment row records this, so it can never
        # disagree with amountPayed.
        recorded_payment = total_paid - prior_paid if money_check else new_payment
        if money_check:
            if new_payment < 0 and prior_paid + new_payment < final_total - Decimal("0.10"):
                raise HTTPException(
                    status_code=400,
                    detail=(f"A refund of KSH {abs(new_payment):,.0f} is more than the customer overpaid "
                            f"(KSH {max(prior_paid - final_total, Decimal('0')):,.0f})."),
                )
            if abs(recorded_payment - new_payment) > Decimal("1"):
                # The cashier's screen worked the amount out from figures that are no longer
                # true: money was collected on this order since the edit was opened, or the
                # server priced the cart differently.
                raise HTTPException(
                    status_code=409,
                    detail=(f"The amounts on this order have changed since it was opened (total now "
                            f"KSH {final_total:,.0f}, already paid KSH {prior_paid:,.0f}). "
                            "Reopen the order and try again."),
                )

        is_paid = new_balance <= Decimal("0.10")
        payment_status = "Paid" if is_paid else ("Partial" if total_paid > 0 else "Unpaid")

        order.customerid = order_data.customerId
        order.customer_name = _resolve_customer_name(db, order_data.customerId, order_data.customerName)
        order.discount = float(discount_val)
        order.amountPayed = float(total_paid)
        order.subtotal = float(net)
        order.total = float(final_total)
        order.balance = float(new_balance)
        order.payment_status = payment_status
        order.VAT_status = order_data.VAT_status
        db.add(order)

        # Keep the order's Credit row (if any) in sync with the recomputed balance
        from core.financials.PaymentService import _sync_credit_for_order
        _sync_credit_for_order(db, order)

        # ── 6. Write audit record ─────────────────────────────────────────────
        old_total = Decimal(str(before_snapshot["total"]))
        total_delta = final_total - old_total  # positive = customer owes more, negative = refund

        if total_delta > Decimal("0.10"):
            financial_action = "additional_payment"
            financial_note = f"Customer owes KSH {float(total_delta):.2f} more after edit"
        elif total_delta < Decimal("-0.10"):
            financial_action = "refund"
            financial_note = f"Refund of KSH {abs(float(total_delta)):.2f} due to customer"
        else:
            financial_action = "no_change"
            financial_note = "No financial change"

        after_snapshot = {
            "subtotal": float(net),
            "total": float(final_total),
            "discount": float(discount_val),
            "payment_status": payment_status,
            "financial_action": financial_action,
            "financial_note": financial_note,
            "total_delta": float(total_delta),
            "items": new_items_snapshot,
            # The operation this edit ran as — the handle the undo/correct tools use.
            "op_id": current_op().op_id if current_op() else None,
        }
        audit = EditHistory(
            entity_type="order",
            entity_id=order_id,
            edited_by=current_user.userId,
            action=financial_action,
            before_snapshot=before_snapshot,
            after_snapshot=after_snapshot,
            notes=order_data.notes or financial_note,
        )
        db.add(audit)

        # Record the money movement for this edit (new_payment is the signed delta:
        # positive = additional payment collected, negative = refund paid out to
        # the customer). Either way it's one Payment row tagged with the method
        # the cashier actually used — get_financial_summary sums Payment.amount
        # per method, so a negative row here nets straight out of that day's
        # cash/mpesa totals for the CEO, the same way the positive case adds to it.
        if recorded_payment != Decimal("0"):
            from entities.payments import Payment
            pay_method = (order_data.paymentMethod or "cash").lower()
            if pay_method not in {"cash", "mpesa", "split", "number"}:
                pay_method = "cash"
            edit_payment_rec = Payment(
                orderId=order_id,
                amount=float(recorded_payment),
                payment_method=pay_method,
                reason="refund" if recorded_payment < Decimal("0") else "order",
                payment_details=normalize_payment_details(pay_method, order_data.paymentDetails, float(recorded_payment)),
                recorded_by=current_user.userId,
            )
            db.add(edit_payment_rec)

        db.flush()
        op = current_op()
        if op is not None and op.row is not None:
            op.row.edit_history_id = audit.id
        record_summary(
            op,
            cut_confirmations=before_snapshot["cut_confirmations"],
            payment=float(recorded_payment),
            total_delta=float(total_delta),
            returned=op.returned if op else {},
        )
        return {"order_id": order_id, "edit_history_id": audit.id}

    except ValueError as e:
        # A cut engine refusing the new cart (no material, over-selected offcut...). The
        # caller owns the transaction and rolls it back.
        raise HTTPException(status_code=422, detail=str(e))


def _canonical_event(value):
    """An offcut_sources event in a form that survives a trip through the browser: JSON
    numbers lose the int/float distinction (3.0 comes back as 3), so numbers compare as
    rounded floats and dict keys in sorted order."""
    if isinstance(value, dict):
        return {k: _canonical_event(value[k]) for k in sorted(value)}
    if isinstance(value, list):
        return [_canonical_event(v) for v in value]
    if isinstance(value, bool) or value is None or isinstance(value, str):
        return value
    if isinstance(value, (int, float)):
        return round(float(value), 6)
    return value


def _correction_target(order_id: int, item_id: int, line_idx: int, event_idx: int, db: Session, current_user,
                       expected_event: dict | None = None):
    """The order item, a private copy of its details, and the product a correction is about.
    The copy keeps the loaded JSON untouched until the result is assigned back as a whole.

    expected_event: the cutting event as the manager's screen showed it. Events are found by
    position, and a correction shifts positions (a failed glass cut leaves its event), so a
    retry after a lost response — or a second manager on the same order — would otherwise
    correct whatever now sits at that position. Refused with 409 when it differs."""
    import copy

    require_role(["manager", "ceo", "admin"], current_user)

    order = get_visible_order_or_404(db, order_id)
    if order.status == "cancelled":
        raise HTTPException(
            status_code=400,
            detail="This order has been cancelled — its stock/offcuts were already restored, so its cutting records can no longer be corrected.",
        )

    item = db.get(OrderItem, item_id)
    if not item or item.order_id != order_id:
        raise HTTPException(status_code=404, detail="Order item not found on this order")

    details = copy.deepcopy(item.details or {})
    line_items = details.get("lineItems") or []
    if not (0 <= line_idx < len(line_items)):
        raise HTTPException(status_code=422, detail="Invalid line_idx for this order item")

    offcut_sources = line_items[line_idx].get("offcut_sources") or []
    if not (0 <= event_idx < len(offcut_sources)):
        raise HTTPException(status_code=422, detail="Invalid event_idx for this cutting line")
    if expected_event is not None and _canonical_event(expected_event) != _canonical_event(offcut_sources[event_idx]):
        raise HTTPException(
            status_code=409,
            detail="This cutting record has changed since you opened it (it may already have been corrected). "
                   "Reopen the order and check it again.",
        )

    product = db.get(Product, item.product_id)
    if not product:
        raise HTTPException(status_code=404, detail="Product not found")
    variant = db.get(Variant, item.variant_id) if item.variant_id else None
    return item, details, line_items, product, variant


def _mirror_source_pref(details: dict, line_items: list, line_idxs) -> None:
    """A line a correction marked new-material-only (source_pref): mirror it onto the
    item-level copies the calculators rebuild their lines from (a glass cut piece, the half
    sheet/bar, the profile cut), so reopening the item doesn't read as a change."""
    glass_k, k = {}, 0
    for li, line in enumerate(line_items):
        if isinstance(line, dict) and line.get("type") == "glass-cut":
            glass_k[li], k = k, k + 1
    for li in line_idxs:
        l_type = line_items[li].get("type", "")
        if l_type == "glass-cut":
            pieces = list(details.get("cutPieces") or [])
            k = glass_k[li]
            if k < len(pieces) and isinstance(pieces[k], dict):
                pieces[k] = {**pieces[k], "sourcePref": "new"}
                details["cutPieces"] = pieces
        elif "half" in l_type:
            details["halfSourcePref"] = "new"
        elif "cut" in l_type:
            details["sourcePref"] = "new"


def _apply_glass_correction(db, item, details, line_items, line_idx, event_idx, product, variant,
                            new_remainders, failed_cut_refs, forced_offcut_id, opts: dict) -> dict:
    from core.inventory import cutCorrection as cc
    from core.inventory.glassOffcutService import correct_glass_offcut_event

    if opts.get("source_unused"):
        result = cc.glass_source_unused(
            db, product, variant, line_items, line_idx, event_idx,
            fate=opts.get("source_fate") or cc.FATE_AVAILABLE, remeasure=opts.get("remeasure"),
            forced_offcut_id=forced_offcut_id, force_new_sheet=bool(opts.get("force_new_source")),
            use_original=bool(opts.get("use_original")), original_part=opts.get("original_part") or 0,
            assignments=opts.get("assignments"), item_id=item.item_id,
        )
        if result["fate"] == cc.FATE_AVOID:
            _mirror_source_pref(details, line_items, result["voided_lines"])
    else:
        event = line_items[line_idx]["offcut_sources"][event_idx]
        group_id = event.get("group_id")
        sibling_events = {}
        if group_id is not None:
            for other_idx, other_line in enumerate(line_items):
                if other_idx == line_idx:
                    continue
                for other_event in other_line.get("offcut_sources") or []:
                    if other_event.get("group_id") == group_id:
                        sibling_events[other_idx] = other_event
                        break
        result = correct_glass_offcut_event(
            db, product, variant, event, [r.model_dump() if hasattr(r, "model_dump") else dict(r) for r in new_remainders],
            failed_cut_refs, forced_offcut_id,
            sibling_events=sibling_events, owner_line_idx=line_idx,
            force_new_sheet=bool(opts.get("force_new_source")), assignments=opts.get("assignments"),
            item_id=item.item_id,
        )
        for origin_idx, rep_events in result["replacement_events_by_line"].items():
            target_idx = origin_idx if isinstance(origin_idx, int) and 0 <= origin_idx < len(line_items) else line_idx
            line_items[target_idx].setdefault("offcut_sources", []).extend(rep_events)

    item.details = {**details, "lineItems": line_items}
    flag_modified(item, "details")
    db.add(item)
    return result


@stock_operation(OP_CUT_CORRECTION)
def correct_offcut_for_order_item(
    order_id: int,
    item_id: int,
    line_idx: int,
    event_idx: int,
    new_remainders: list,
    failed_cuts: list,
    forced_offcut_id: int | None,
    notes: str | None,
    db: Session,
    current_user,
    **opts,
) -> dict:
    """
    Manager correction for a single cutting event on a past order: real-world
    cutting sometimes produces a different remainder than what got recorded at
    checkout, and/or one of the delivered cuts never actually came out of its
    source (the cutter missed). Reverses the remainder(s) the owning event
    recorded and applies the manager-supplied replacement, and — for any
    failed_cuts — pulls those cuts out and resolves a replacement source for
    them (see glassOffcutService.correct_glass_offcut_event for the actual
    offcut inventory mutation), then writes an EditHistory row.

    A sheet joint-packed across several of this OrderItem's cut-lines (see
    glassOffcutService._apply_candidate's owns_consumption/group_id) splits
    into one owning event (line_idx/event_idx here) plus a non-owning "stub"
    per sibling line, each holding only that line's own cuts. Every sibling
    sharing the owning event's group_id is looked up here and handed to
    correct_glass_offcut_event as `sibling_events`, so each failed_cuts entry's
    own line_idx can address any line in the group, not just the owner's —
    and any resulting replacement event lands back on whichever line's missed
    piece it actually replaces, not always the owner's.

    `opts` (CorrectOffcutRequest): source_unused - the source was never touched at all (see
    core/inventory/cutCorrection.py; new_remainders/failed_cuts are then ignored, every piece
    on the sheet is re-supplied); source_fate/remeasure - what happens to that source;
    force_new_source - the replacement comes from a new sheet; use_original - the
    replacement is the never-used source itself, chosen on purpose.
    """
    expected_event = opts.pop("expected_event", None)
    item, details, line_items, product, variant = _correction_target(
        order_id, item_id, line_idx, event_idx, db, current_user, expected_event=expected_event)
    failed_cut_refs = [{"line_idx": fc.line_idx, "cut_idx": fc.cut_idx} for fc in failed_cuts]

    try:
        result = _apply_glass_correction(db, item, details, line_items, line_idx, event_idx, product, variant,
                                         new_remainders, failed_cut_refs, forced_offcut_id, opts)
        audit = EditHistory(
            entity_type="offcut_correction",
            entity_id=order_id,
            edited_by=current_user.userId,
            action="correct",
            before_snapshot={"item_id": item_id, "line_idx": line_idx, "event_idx": event_idx, "remainders": result["before"]},
            after_snapshot={
                "item_id": item_id, "line_idx": line_idx, "event_idx": event_idx, "remainders": result["after"],
                "failed_cuts": failed_cut_refs, "replacement_events": result["replacement_events"],
                "source_unused": bool(opts.get("source_unused")), "source_fate": result.get("fate"),
            },
            notes=notes,
        )
        db.add(audit)
        db.commit()
        db.refresh(item)

        logger.info(f"Offcut corrected for order {order_id} item {item_id} by {current_user.userId}")
        return result
    except HTTPException:
        raise
    except ValueError as e:
        db.rollback()
        raise HTTPException(status_code=422, detail=str(e))
    except Exception as e:
        db.rollback()
        logger.error(f"Error correcting offcut for order {order_id}: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail="Something went wrong while correcting the offcut. Please try again.")


def _dry_run(db: Session, fn):
    """Run `fn` inside a savepoint that is always rolled back: (result, error message)."""
    savepoint = db.begin_nested()
    try:
        return fn(), None
    except ValueError as e:
        return None, str(e)
    finally:
        savepoint.rollback()


def _listing_fate(opts: dict, is_2d: bool) -> str:
    """The fate to list replacement options under while the manager is still typing a
    re-measured size."""
    from core.inventory import cutCorrection as cc

    fate = opts.get("source_fate") or cc.FATE_AVAILABLE
    if fate == cc.FATE_REMEASURE and not cc.parts_entered(opts.get("remeasure"), is_2d):
        return cc.FATE_AVAILABLE
    return fate


def _returned_for_listing(db, product, variant, event: dict, is_2d: bool, opts: dict):
    """Inside a dry run: put a never-used source back as the manager chose, so the options
    list shows the pool as it will be. Returns (original_rows, exclude_row): the rows of the
    original's usable parts ("original:<k>"), and a row to leave off the list."""
    from core.inventory import cutCorrection as cc
    from core.inventory.poolKey import compute_pool_key

    rev = cc.plan_unused(db, event, is_2d)
    pool_key = compute_pool_key(db, variant)
    cc._retire_remainders(db, product, variant, rev, pool_key)
    fate = _listing_fate(opts, is_2d)
    if fate == cc.FATE_AVOID and rev.kind == cc.resolver.KIND_FULL_UNIT:
        fate = cc.FATE_AVAILABLE
    rows = cc._return_source(db, product, variant, rev, is_2d, fate, opts.get("remeasure"), pool_key)
    if fate == cc.FATE_AVOID:
        return [], (rows[0] if rows else None)
    return rows, None


def preview_offcut_correction(order_id: int, body, db: Session, current_user) -> dict:
    """Dry run of correct_offcut_for_order_item with the same payload: the replacement it
    would make, and for each piece the sources that can cut it (offcuts, the original's usable
    parts, a new sheet) - see cutCorrection.glass_piece_options."""
    from core.inventory import cutCorrection as cc
    from core.inventory.cutCorrection import group_pieces as _glass_group_pieces

    opts = body.model_dump(include={"source_unused", "source_fate", "remeasure", "force_new_source", "use_original",
                                    "original_part", "assignments"})
    try:
        item, details, line_items, product, variant = _correction_target(
            order_id, body.item_id, body.line_idx, body.event_idx, db, current_user)
        event = line_items[body.line_idx]["offcut_sources"][body.event_idx]
        refs = [{"line_idx": fc.line_idx, "cut_idx": fc.cut_idx} for fc in body.failed_cuts]

        def candidates():
            if opts.get("source_unused"):
                original_rows, exclude_row = _returned_for_listing(db, product, variant, event, True, opts)
                pieces = _glass_group_pieces(line_items, body.line_idx, body.event_idx, None)
            else:
                original_rows, exclude_row = [], None
                pieces = _glass_group_pieces(line_items, body.line_idx, body.event_idx, refs)
            if not pieces:
                return None
            return cc.glass_piece_options(db, product, variant, pieces, original_rows, exclude_row)

        listing, error = _dry_run(db, candidates)
        out = {"events": [], "candidates": listing, "original": None, "error": error}
        wants_replacement = opts.get("source_unused") or refs
        if error is None and wants_replacement:
            res, error = _dry_run(db, lambda: _apply_glass_correction(
                db, item, details, line_items, body.line_idx, body.event_idx, product, variant,
                body.new_remainders, refs, body.forced_offcut_id, opts))
            out["error"] = error
            if res is not None:
                out["events"], out["original"] = res["replacement_events"], res.get("original")
        return out
    finally:
        db.rollback()  # dry run only — never persist


def _apply_profile_correction(db, item, details, line_items, line_idx, event_idx, product, variant,
                              new_remainder_length, replace_source, forced_offcut_id, opts: dict) -> dict:
    from core.inventory import cutCorrection as cc
    from core.inventory.inventoryService import correct_profile_offcut_event

    line = line_items[line_idx]
    if opts.get("source_unused"):
        had_pick = bool(line.get("offcut_selection"))
        result = cc.profile_source_unused(
            db, product, variant, line, event_idx,
            fate=opts.get("source_fate") or cc.FATE_AVAILABLE, remeasure=opts.get("remeasure"),
            forced_offcut_id=forced_offcut_id, force_new_bar=bool(opts.get("force_new_source")),
            use_original=bool(opts.get("use_original")), original_part=opts.get("original_part") or 0,
            item_id=item.item_id,
        )
        if had_pick:
            details.pop("offcutSelection", None)  # the calculator's copy of the spent pick
        if result["fate"] == cc.FATE_AVOID:
            _mirror_source_pref(details, line_items, [line_idx])
    else:
        offcut_sources = line["offcut_sources"]
        result = correct_profile_offcut_event(
            db, product, variant, offcut_sources[event_idx], new_remainder_length, replace_source, forced_offcut_id,
            force_new_bar=bool(opts.get("force_new_source")), item_id=item.item_id,
        )
        if result["replacement_event"]:
            offcut_sources.append(result["replacement_event"])

    item.details = {**details, "lineItems": line_items}
    flag_modified(item, "details")
    db.add(item)
    return result


@stock_operation(OP_CUT_CORRECTION)
def correct_profile_offcut_for_order_item(
    order_id: int,
    item_id: int,
    line_idx: int,
    event_idx: int,
    new_remainder_length: float,
    replace_source: bool,
    forced_offcut_id: int | None,
    notes: str | None,
    db: Session,
    current_user,
    **opts,
) -> dict:
    """
    Manager correction for a single 1D (bar/profile) cutting event on a past
    order — the 1D analogue of correct_offcut_for_order_item. See
    inventoryService.correct_profile_offcut_event for the actual offcut
    inventory mutation (remainder-only edit vs. full source replacement), and
    core/inventory/cutCorrection.py for `opts.source_unused` (the source was never used:
    a new bar goes back to STOCK, not into the offcut pool).
    """
    expected_event = opts.pop("expected_event", None)
    item, details, line_items, product, variant = _correction_target(
        order_id, item_id, line_idx, event_idx, db, current_user, expected_event=expected_event)

    try:
        result = _apply_profile_correction(db, item, details, line_items, line_idx, event_idx, product, variant,
                                           new_remainder_length, replace_source, forced_offcut_id, opts)
        audit = EditHistory(
            entity_type="profile_offcut_correction",
            entity_id=order_id,
            edited_by=current_user.userId,
            action="correct",
            before_snapshot={"item_id": item_id, "line_idx": line_idx, "event_idx": event_idx, "event": result["before"]},
            after_snapshot={
                "item_id": item_id, "line_idx": line_idx, "event_idx": event_idx, "event": result["after"],
                "replacement_event": result["replacement_event"],
                "source_unused": bool(opts.get("source_unused")), "source_fate": result.get("fate"),
            },
            notes=notes,
        )
        db.add(audit)
        db.commit()
        db.refresh(item)

        logger.info(f"Profile offcut corrected for order {order_id} item {item_id} by {current_user.userId}")
        return result
    except HTTPException:
        raise
    except ValueError as e:
        db.rollback()
        raise HTTPException(status_code=422, detail=str(e))
    except Exception as e:
        db.rollback()
        logger.error(f"Error correcting profile offcut for order {order_id}: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail="Something went wrong while correcting the offcut. Please try again.")


def preview_profile_offcut_correction(order_id: int, body, db: Session, current_user) -> dict:
    """1D analogue of preview_offcut_correction."""
    from core.inventory import cutCorrection as cc

    opts = body.model_dump(include={"source_unused", "source_fate", "remeasure", "force_new_source", "use_original",
                                    "original_part", "assignments"})
    try:
        item, details, line_items, product, variant = _correction_target(
            order_id, body.item_id, body.line_idx, body.event_idx, db, current_user)
        event = line_items[body.line_idx]["offcut_sources"][body.event_idx]
        wants_replacement = bool(opts.get("source_unused") or body.replace_source)

        def candidates():
            if opts.get("source_unused"):
                original_rows, exclude_row = _returned_for_listing(db, product, variant, event, False, opts)
            else:
                # The recorded source stays consumed; never offer it back.
                original_rows, exclude_row = [], event.get("offcut_id")
            return cc.profile_candidates(db, product, variant, float(event.get("length_used") or 0),
                                         original_rows, exclude_row)

        listing, error = _dry_run(db, candidates) if wants_replacement else (None, None)
        out = {"event": None, "candidates": listing, "original": None, "error": error}
        if error is None and wants_replacement:
            res, error = _dry_run(db, lambda: _apply_profile_correction(
                db, item, details, line_items, body.line_idx, body.event_idx, product, variant,
                body.new_remainder_length, body.replace_source, body.forced_offcut_id, opts))
            out["error"] = error
            if res is not None:
                out["event"], out["original"] = res["replacement_event"], res.get("original")
        return out
    finally:
        db.rollback()  # dry run only — never persist


@stock_operation(OP_CUTTING_REPORT, order_arg=None)
def mark_cutting_complete_batch(item_ids: list, db: Session, current_user) -> dict:
    """
    Batch "report finished" action: floor staff don't report each finished cut
    immediately — someone periodically reports a batch of already-finished
    items at once. Flips cutting_completed=True/cutting_completed_at=now() for
    every id in item_ids that's currently pending; silently skips ids that are
    already done or don't exist — this reports what's done, it isn't a strict
    per-id transaction.
    """
    require_role(["manager", "cashier", "ceo", "admin"], current_user)

    # Items of a cancelled order are not cut work any more.
    items = db.exec(
        select(OrderItem).join(Order, Order.orderId == OrderItem.order_id)
        .where(OrderItem.item_id.in_(item_ids), OrderItem.cutting_completed == False,  # noqa: E712
               Order.status != "cancelled", visible_orders())
    ).all()
    now = nairobi_now()
    updated = []
    for item in items:
        item.cutting_completed = True
        item.cutting_completed_at = now
        db.add(item)
        updated.append(item.item_id)

    db.commit()
    return {"updated": updated}


@stock_operation(OP_CUTTING_REPORT, order_arg=None)
def mark_cutting_complete_for_orders_batch(order_ids: list, db: Session, current_user, item_ids: list | None = None) -> dict:
    """
    Order-queue batch action: the queue is checked off a whole order at a time,
    not one item at a time — floor staff confirm an entire order's cutting is
    done, so every still-pending item across the given orders is flipped
    cutting_completed=True/cutting_completed_at=now() (offcuts sourced from them
    stop carrying a pending_source_notice — see glassOffcutService._apply_candidate,
    which keys off OrderItem.cutting_completed directly). Silently skips order ids
    that don't exist.

    Deliberately does NOT touch Order.status. It used to also set status="completed",
    which conflated two different facts — "the metal has been cut" and "this sale is
    finished" — and made every cut order permanently uneditable, since update_order
    refuses a completed order. Nothing ever read status=="completed" (the only status
    any code compares against is "cancelled"), and this queue filters on
    OrderItem.cutting_completed rather than the order's status, so orders still leave
    the queue exactly as before. Completing an order is now only ever a human action,
    through update_order_status.
    """
    require_role(["manager", "cashier", "ceo", "admin"], current_user)

    # A cancelled order is skipped: it may have been cancelled while the queue was open, and
    # flagging its items "cut" would mislead any later reversal.
    orders = db.exec(select(Order).where(Order.orderId.in_(order_ids), Order.status != "cancelled", visible_orders())).all()
    shown = set(item_ids) if item_ids is not None else None
    now = nairobi_now()
    updated_items = []
    updated_orders = []  # orders processed — their workflow status is left untouched
    for order in orders:
        for item in order.orderItems:
            if not item.cutting_completed and (shown is None or item.item_id in shown):
                item.cutting_completed = True
                item.cutting_completed_at = now
                db.add(item)
                updated_items.append(item.item_id)
        updated_orders.append(order.orderId)

    db.commit()
    return {"updated_orders": updated_orders, "updated_items": updated_items}


def mark_cutting_complete_for_order(order_id: int, db: Session, current_user) -> dict:
    """Single-order convenience wrapper around mark_cutting_complete_for_orders_batch
    (e.g. the cashier reporting "this order's been cut" from the order summary page)."""
    get_visible_order_or_404(db, order_id)
    result = mark_cutting_complete_for_orders_batch([order_id], db, current_user)
    return {"updated": result["updated_items"]}


def get_pending_cutting_orders(db: Session, current_user, skip: int = 0, limit: int = 100) -> list:
    """
    Orders with at least one item still awaiting a cutting report — the queue is
    checked off a whole order at a time (see mark_cutting_complete_for_orders_batch),
    so each row here is one order carrying every one of its still-pending items
    (id/product name/lineItems needed to render CuttingInstructions), not one row
    per item.
    """
    require_role(["manager", "cashier", "ceo", "admin"], current_user)

    stmt = (
        select(Order)
        .join(OrderItem, OrderItem.order_id == Order.orderId)
        # visible_orders(): an open sale window is not cut before it is paid for.
        .where(OrderItem.cutting_completed == False, Order.status != "cancelled", visible_orders())  # noqa: E712
        .distinct()
        .order_by(Order.created_at.asc())
        .offset(skip).limit(limit)
    )
    # Each order's items and their products in two queries, not one per order and per item.
    orders = db.exec(stmt.options(selectinload(Order.orderItems).selectinload(OrderItem.product))).all()
    results = []
    for order in orders:
        pending_items = [oi for oi in order.orderItems if not oi.cutting_completed]
        results.append({
            "orderId": order.orderId,
            "orderNo": order.order_no,
            "customerName": order.customer_name,
            "items": [
                {"itemId": oi.item_id, "productName": oi.product.name, "details": oi.details}
                for oi in pending_items
            ],
        })
    return results


ORDER_ENTITY_TYPES = {"order", "order_undo", "offcut_correction", "profile_offcut_correction",
                      "order_status", "order_cancellation", "cutting_report"}


def get_audit_history(
    entity_type: str | None,
    db: Session,
    skip: int = 0,
    limit: int = 100,
    user_id: str | None = None,
    since: str | None = None,
    until: str | None = None,
) -> list[model.EditHistoryResponse]:
    """Cross-module CEO activity feed — edit_history already spans every
    module that writes to it (restocks, stock-batch sessions, offcut
    corrections, order edits/status changes/cancellations), so omitting
    entity_type already returns everything. since/until are inclusive
    YYYY-MM-DD date-only bounds on edited_at."""
    from entities.editHistory import EditHistory
    from entities.users import User

    stmt = select(EditHistory).order_by(EditHistory.edited_at.desc()).offset(skip).limit(limit)
    if entity_type:
        stmt = stmt.where(EditHistory.entity_type == entity_type)
    if user_id:
        stmt = stmt.where(EditHistory.edited_by == user_id)
    if since:
        # Plain ranges on the column (index-friendly), not func.date(column).
        stmt = stmt.where(EditHistory.edited_at >= datetime.strptime(since, "%Y-%m-%d"))
    if until:
        stmt = stmt.where(EditHistory.edited_at < datetime.strptime(until, "%Y-%m-%d") + timedelta(days=1))

    rows = db.exec(stmt).all()

    usernames: dict = {}
    def _username(uid) -> str:
        if uid not in usernames:
            user = db.get(User, uid)
            usernames[uid] = user.username if user else str(uid)
        return usernames[uid]

    # Entity types whose entity_id is an order's internal id: shown to people by its number.
    order_nos: dict = {}
    def _order_no(r):
        if r.entity_type not in ORDER_ENTITY_TYPES:
            return None
        if r.entity_id not in order_nos:
            order = db.get(Order, r.entity_id)
            order_nos[r.entity_id] = order.order_no if order else None
        return order_nos[r.entity_id]

    return [
        model.EditHistoryResponse(
            id=r.id,
            entity_type=r.entity_type,
            entity_id=r.entity_id,
            order_no=_order_no(r),
            edited_by=_username(r.edited_by),
            edited_at=r.edited_at.isoformat(),
            action=r.action,
            before_snapshot=r.before_snapshot or {},
            after_snapshot=r.after_snapshot or {},
            notes=r.notes,
        )
        for r in rows
    ]


def get_orders_with_balance(db: Session, skip: int = 0, limit: int = 200) -> list[model.OrderResponse]:
    """Orders with money still owed — feeds the Cashier's Collect Payments page."""
    try:
        statement = (
            select(Order)
            .where(Order.balance > 0.01, Order.status != "cancelled", visible_orders())
            .order_by(Order.created_at.asc())
            .offset(skip)
            .limit(limit)
        )
        orders = db.exec(statement.options(*_SHALLOW_LOAD)).all()
        return [_order_to_shallow_response(order) for order in orders]
    except Exception as e:
        logger.error(f"Error retrieving orders with balance: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail="Internal server error")


def _restore_and_cancel(
    db: Session,
    order: Order,
    current_user=None,
    refund_method: str | None = None,
    refund_details: dict | None = None,
    cut_decisions=None,
) -> dict:
    """
    Restore stock/offcuts for every item on an order, refund whatever was
    already collected against it, void any outstanding balance, and flip the
    order to cancelled. Idempotent — a no-op if the order is already
    cancelled, so callers can't accidentally double-restore stock (or
    double-refund) by cancelling twice.

    refund_method/refund_details: the cashier's explicit choice of how the
    refund is being handed back (see CancelOrderModal) — falls back to
    whatever method this order was last paid through if not given, for
    callers that don't collect one.

    cut_decisions: the operator's per-cut-line physical confirmation (Phase 3) — see
    core/inventory/reversalPlan.py. None means every line falls back to what its chain
    says on its own.

    Returns a small dict of what happened financially, for the caller's audit
    log — {"amount_refunded": float, "refund_method": str | None}.
    """
    from core.inventory.inventoryService import restore_stock_for_order_item
    from core.financials.PaymentService import _sync_credit_for_order

    if order.status == "cancelled":
        return {"amount_refunded": 0.0, "refund_method": None}

    # Newest item first (item_id is creation order, which position no longer implies): a
    # later item can be cut from an earlier item's remainder, and undoing it first is what
    # lets the earlier one recombine a bar that was never actually cut.
    items = db.exec(
        select(OrderItem).where(OrderItem.order_id == order.orderId).order_by(OrderItem.item_id.desc())
    ).all()
    for item in items:
        restore_stock_for_order_item(db, item, decisions=cut_decisions)

    # Cancelling voids any outstanding balance regardless of whether anything
    # was ever paid — the goods were never delivered, so the customer doesn't
    # owe for them any more.
    order.balance = 0.0

    amount_paid = order.amountPayed or 0
    resolved_method = None
    if amount_paid > 0.10:
        from entities.payments import Payment

        resolved_method = (refund_method or "").lower() or None
        resolved_details = refund_details
        if resolved_method not in {"cash", "mpesa", "split", "number"}:
            # No explicit choice given — fall back to whatever this order was
            # last paid through, same default CheckoutPage uses ('cash') when
            # there's nothing more specific to go on.
            latest_payment = max(order.payments, key=lambda p: p.payed_at) if order.payments else None
            resolved_method = (latest_payment.payment_method if latest_payment else None) or "cash"
            resolved_details = None
            if resolved_method == "split" and latest_payment and latest_payment.payment_details:
                resolved_details = {k: -float(v or 0) for k, v in latest_payment.payment_details.items()}

        db.add(Payment(
            orderId=order.orderId,
            amount=-float(amount_paid),
            payment_method=resolved_method,
            reason="refund",
            # Signed like the row (the modal sends what goes back as positive amounts).
            payment_details=normalize_payment_details(resolved_method, resolved_details, -float(amount_paid)),
            recorded_by=current_user.userId if current_user else None,
        ))
        order.amountPayed = 0.0

    order.payment_status = "Unpaid"
    order.status = "cancelled"
    db.add(order)

    # Close out any Credit row so a cancelled order stops showing as an
    # outstanding debt on the Dues page.
    _sync_credit_for_order(db, order)

    return {"amount_refunded": float(amount_paid) if amount_paid > 0.10 else 0.0, "refund_method": resolved_method}


def get_reversal_plan(order_id: int, db: Session, current_user, incoming_items=None) -> dict:
    """What reversing this order's cut lines would do, and what still needs confirming.

    Read-only — builds nothing, writes nothing. The edit/cancel screens call this first
    so the operator sees the constraints (which bars can come back whole, which are
    committed to a later order, which need a floor check) before committing to anything,
    instead of hitting a refusal at save time.
    """
    from core.inventory import reversalPlan

    require_role(["manager", "ceo", "admin"], current_user)

    order = get_visible_order_or_404(db, order_id)

    # Given the cart an edit is about to submit, narrow the question to the items that edit
    # will actually disturb — matched exactly the way update_order will match them, so the
    # operator is never asked about a line that then turns out not to move (or vice versa).
    reversing_item_ids = None
    if incoming_items is not None:
        _assert_cart_is_this_orders(db, order_id, incoming_items)
        existing = db.exec(select(OrderItem).where(OrderItem.order_id == order_id)).all()
        _, reversing, _ = _match_items(existing, incoming_items)
        reversing_item_ids = {oi.item_id for oi in reversing}

    plan = reversalPlan.build_plan(db, order, reversing_item_ids=reversing_item_ids)
    plan["can_cancel"] = (
        order.status != "cancelled"
        and _order_age(db, order) <= CANCEL_WINDOW
    )
    plan["can_edit"] = order.status not in ("cancelled", "completed")
    return plan


@stock_operation(OP_STATUS)
def update_order_status(
    order_id: int,
    new_status: str,
    db: Session = Depends(get_session),
    current_user=Depends(get_current_user)
) -> model.OrderStatusUpdateResponse:
    """
    Update the workflow status of an existing order (pending → confirmed → ready → completed).
    Cancelling an order is a separate, PIN-protected action — see cancel_order_with_pin.
    """
    try:
        require_role(["manager", "cashier", "ceo", "admin"], current_user)

        if new_status == "cancelled":
            raise HTTPException(
                status_code=400,
                detail="Cancelling an order requires the cancel PIN — use PUT /orders/{id}/cancel instead.",
            )

        if new_status in HIDDEN_STATUSES:
            raise HTTPException(status_code=400, detail=f"An order cannot be set to '{new_status}'.")
        order = get_visible_order_or_404(db, order_id)

        old_status = order.status
        order.status = new_status
        db.add(order)

        if old_status != new_status:
            db.add(EditHistory(
                entity_type="order_status",
                entity_id=order_id,
                edited_by=current_user.userId,
                action="status_change",
                before_snapshot={"status": old_status},
                after_snapshot={"status": new_status},
                notes=current_user.username,
            ))

        db.commit()
        db.refresh(order)

        logger.info(f"Order {order_id} workflow status updated to {new_status} by {current_user.userId}.")
        return model.OrderStatusUpdateResponse(
            message=f"{order_label(db, order_id).capitalize()} status updated to {new_status}."
        )
    except HTTPException:
        raise
    except Exception as e:
        db.rollback()
        logger.error(f"Error updating order {order_id} status: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail="Internal server error")


def cancel_order_with_pin(
    order_id: int,
    pin: str,
    db: Session = Depends(get_session),
    current_user=Depends(get_current_user),
    refund_method: str | None = None,
    refund_details: dict | None = None,
    cut_confirmations: dict | None = None,
    plan_token: str | None = None,
    expected_refund: float | None = None,
) -> model.OrderStatusUpdateResponse:
    """
    Cancel an order from Order History. Requires the CEO-configured 4-digit PIN.
    Restores stock/offcuts for every item; idempotent if already cancelled.

    One cancel is one operation (core/audit/opContext) and one transaction; the work is
    apply_cancel, which never commits, so the undo tool can re-run a cancel with corrected
    cut answers inside the undo's transaction.
    """
    from core.settings.service import check_cancel_pin, cancel_pin_is_configured

    require_role(["manager", "ceo", "admin"], current_user)
    if not cancel_pin_is_configured(db):
        raise HTTPException(
            status_code=400,
            detail="No cancel PIN has been set up yet. Ask the CEO to configure one.",
        )
    if not check_cancel_pin(db, pin, current_user):
        raise HTTPException(status_code=403, detail="Incorrect PIN.")

    try:
        with operation(db, OP_CANCEL, actor=current_user, order_id=order_id, request={
            "refund_method": refund_method, "refund_details": refund_details,
            "cut_confirmations": cut_confirmations, "plan_token": plan_token,
        }):
            apply_cancel(order_id, db, current_user, refund_method, refund_details,
                         cut_confirmations, plan_token, expected_refund=expected_refund)
        db.commit()
    except HTTPException:
        db.rollback()
        raise
    except Exception as e:
        db.rollback()
        logger.error(f"Error cancelling order {order_id}: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail="Internal server error")

    logger.info(f"Order {order_id} cancelled (PIN-verified) by {current_user.userId}.")
    return model.OrderStatusUpdateResponse(message=f"{order_label(db, order_id).capitalize()} cancelled.")


def apply_cancel(
    order_id: int,
    db: Session,
    current_user,
    refund_method: str | None = None,
    refund_details: dict | None = None,
    cut_confirmations: dict | None = None,
    plan_token: str | None = None,
    enforce_window: bool = True,
    expected_refund: float | None = None,
) -> dict:
    """Cancel an order without committing (see cancel_order_with_pin).

    cut_confirmations: {line_ref: {physicalState, resolution, laterCuts}} - the operator's
    answer per cut line (see core/inventory/reversalPlan.py). An already-cut line is never
    recombined into a whole bar. Lines needing no judgement fall back to their prefilled
    default, so cancelling an order nothing has been cut for needs no payload.

    `enforce_window=False` is for the undo tool re-running a cancel that was allowed when it
    was first made.

    `expected_refund`: the amount the cashier was shown as going back. The refund is always
    what the order has actually been paid, so when that changed meanwhile (a debt collected
    on another till) the cancel is refused rather than refunding a figure nobody saw.
    """
    from core.inventory import reversalPlan

    # Locked, like the edit: the refund is worked out from amountPayed, and a debt payment
    # committed meanwhile must either be counted or wait - never be missed.
    order = db.exec(select(Order).where(Order.orderId == order_id).with_for_update()).first()
    if order is None or order.status in HIDDEN_STATUSES:
        raise HTTPException(status_code=404, detail="Order not found")
    if enforce_window and order.status != "cancelled" and _order_age(db, order) > CANCEL_WINDOW:
        raise HTTPException(status_code=400, detail="This order is more than a week old and can no longer be cancelled.")
    if (expected_refund is not None and order.status != "cancelled"
            and abs(float(order.amountPayed or 0) - float(expected_refund)) > 0.5):
        raise HTTPException(
            status_code=409,
            detail=(f"This order has now been paid KSH {float(order.amountPayed or 0):,.0f}, not "
                    f"KSH {float(expected_refund):,.0f}. Close this and open the cancel again to refund the right amount."),
        )

    # Already-cut orders used to be refused outright here. They can now be cancelled, one
    # confirmed cut line at a time - the material just doesn't come back as whole bars.
    # Skipped for an already-cancelled order, which _restore_and_cancel no-ops on.
    cut_decisions = None
    reversal_plan = None
    if order.status != "cancelled":
        reversal_plan = reversalPlan.build_plan(db, order)
        try:
            reversalPlan.assert_plan_fresh(db, reversal_plan, plan_token)
            cut_decisions = reversalPlan.validate_decisions(reversal_plan, cut_confirmations)
        except reversalPlan.PlanStaleError as e:
            raise HTTPException(status_code=409, detail={"message": str(e), "plan": e.fresh_plan})
        except ValueError as e:
            raise HTTPException(status_code=422, detail=str(e))
        # Lock the pieces before any stock moves - see apply_order_edit.
        reversalPlan.lock_decision_pieces(db, reversal_plan)

    old_status = order.status
    try:
        result = _restore_and_cancel(db, order, current_user, refund_method, refund_details,
                                     cut_decisions=cut_decisions)
        if cut_decisions is not None:
            reversalPlan.apply_later_cut_answers(db, reversal_plan, cut_decisions, order_id)
    except ValueError as e:
        raise HTTPException(status_code=422, detail=str(e))

    audit_id = None
    if old_status != "cancelled":
        refund_note = (
            f"Refunded KSH {result['amount_refunded']:.2f} via {result['refund_method']}"
            if result["amount_refunded"] > 0 else "Nothing was collected against this order"
        )
        summary = (reversalPlan.decisions_summary(reversal_plan, cut_decisions)
                   if cut_decisions is not None else [])
        op = current_op()
        audit = EditHistory(
            entity_type="order_cancellation",
            entity_id=order_id,
            edited_by=current_user.userId,
            action="cancel",
            before_snapshot={"status": old_status},
            after_snapshot={
                "status": "cancelled",
                "amount_refunded": result["amount_refunded"],
                "refund_method": result["refund_method"],
                "cut_confirmations": summary,
                "op_id": op.op_id if op else None,
            },
            notes=f"{current_user.username} - {refund_note}",
        )
        db.add(audit)
        db.flush()
        audit_id = audit.id
        if op is not None and op.row is not None:
            op.row.edit_history_id = audit.id
        record_summary(op, cut_confirmations=summary, refunded=result["amount_refunded"],
                       returned=op.returned if op else {})
    return {"order_id": order_id, "edit_history_id": audit_id, **result}


def projected_offcuts(order_id: int, item_id: int, answers: Optional[dict], variant_id: Optional[int],
                      db: Session, current_user) -> dict:
    """The offcut pool as it will be once this item's cuts are reversed with these answers -
    what the calculator's offcut picker shows while an order is being edited.

    Pieces the reversal hands back (the line's own cut piece, the offcut it came from, or the
    uncut length joined back onto what is left of the bar) are listed with a `ref` the cart
    sends back as `returned_ref`; the edit resolves it to the piece it really produces.
    Read-only: runs in a SAVEPOINT that is always rolled back.
    """
    from core.inventory import reversalPlan
    from core.inventory.inventoryService import restore_stock_for_order_item
    from core.inventory.products.service import get_offcuts_for_product
    from core.inventory import offcutLedger as ledger
    from entities.offcuts import Offcut as _Offcut

    require_role(["manager", "ceo", "admin"], current_user)
    order = db.get(Order, order_id)
    item = db.get(OrderItem, item_id)
    if order is None or order.status in HIDDEN_STATUSES or item is None or item.order_id != order_id:
        raise HTTPException(status_code=404, detail="Order item not found on this order")

    variant_id = variant_id or item.variant_id
    before_rows = {r.offcutId for r in get_offcuts_for_product(item.product_id, db, variant_id)}
    variant = db.get(Variant, item.variant_id) if item.variant_id else None
    stock_before = variant.stock_quantity if variant else 0

    savepoint = db.begin_nested()
    try:
        with operation(db, OP_EDIT, actor=current_user, order_id=order_id, persist=False) as op:
            plan = reversalPlan.build_plan(db, order, reversing_item_ids={item_id})
            try:
                decisions = reversalPlan.validate_decisions(plan, answers or {}, lenient=True)
            except ValueError as e:
                raise HTTPException(status_code=422, detail=str(e))
            restore_stock_for_order_item(db, item, decisions=decisions)
            db.flush()
            by_row: dict = {}
            flat = []
            for line_ref, entries in op.returned.items():
                for i, e in enumerate(entries):
                    piece = ledger.get_piece(db, e["piece_id"])
                    if piece is None or piece.state != "available" or not piece.offcut_row_id:
                        continue
                    info = {"ref": f"{line_ref}#{i}", "kind": e["kind"], "label": e["label"],
                            "length": piece.length, "width": piece.width, "height": piece.height}
                    by_row.setdefault(piece.offcut_row_id, []).append(info)
                    flat.append(info)
            rows = []
            for r in get_offcuts_for_product(item.product_id, db, variant_id):
                rows.append({
                    "offcutId": r.offcutId if r.offcutId in before_rows else None,
                    "rowKey": r.offcutId,
                    "product_id": r.product_id, "variant_id": r.variant_id,
                    "length": r.length, "width": r.width, "height": r.height,
                    "status": r.status, "quantity": r.quantity,
                    "returned": by_row.get(r.offcutId, []),
                })
            db.refresh(variant) if variant else None
            stock_back = (variant.stock_quantity - stock_before) if variant else 0
        return {"offcuts": rows, "returned": flat, "stock_returned": stock_back}
    finally:
        savepoint.rollback()
