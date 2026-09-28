# services/order_service.py
from __future__ import annotations

import json
from datetime import datetime, timedelta
from decimal import Decimal

from fastapi import Depends, HTTPException, Query
from sqlmodel import Session, select, update
from sqlalchemy import func
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
from ..inventory.inventoryService import deduct_stock_for_order_item
from . import model
from .visibility import HIDDEN_STATUSES, visible_orders, get_visible_order_or_404
from .orderNumbers import assign_order_no
from typing import List, Optional





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

        # 1. Validate source invoice (if converting) before touching anything
        source_inv = None
        if order_data.sourceInvoiceId:
            source_inv = db.get(Invoice, order_data.sourceInvoiceId)
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
            payment_status=order_data.paymentStatus,
            discount=order_data.discount,
            amountPayed=order_data.amountPaid,
            status=order_data.status or "confirmed",
            subtotal=0.0,
            balance=0.0,
            total=0.0
        )
        
        db.add(new_order)
        db.flush()  # Generate orderId without committing

        # Pre-fetch Products and Variants for performance (N+1 fix)
        product_ids = [item.productId for item in order_data.items]
        variant_ids = [item.variantId for item in order_data.items if item.variantId]

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

            final_details = item_req.details or {}
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

        amount_paid_val = ceil_amount(Decimal(str(order_data.amountPaid or 0)))
        raw_balance = final_total - amount_paid_val
        new_balance = ceil_amount(raw_balance) if raw_balance > Decimal("0.10") else Decimal("0.00")

        new_order.subtotal = float(net_subtotal)
        new_order.total = float(final_total)
        new_order.balance = float(new_balance)

        db.add(new_order)

        # Mark source invoice as converted in the same transaction
        if source_inv is not None:
            from datetime import datetime, timezone
            source_inv.status = "converted"
            source_inv.order_id = new_order.orderId
            source_inv.converted_at = datetime.now(timezone.utc)
            db.add(source_inv)

        # Auto-create credit record when there is an outstanding balance for a known customer
        if new_order.balance > 0.01 and new_order.customerid:
            from entities.credits import Credit
            credit_status = "Partially Paid" if (order_data.amountPaid or 0) > 0 else "Pending"
            new_credit = Credit(
                orderId=new_order.orderId,
                customerId=new_order.customerid,
                amount=float(final_total),
                amount_due=float(new_order.balance),
                status=credit_status,
            )
            db.add(new_credit)
            logger.info(
                f"Credit record created for order {new_order.orderId}: "
                f"amount={float(final_total):.2f}, due={float(new_order.balance):.2f}, status={credit_status}"
            )

        # Record payment when money was actually collected
        if (order_data.amountPaid or 0) > 0:
            from entities.payments import Payment
            pay_method = (order_data.paymentMethod or "cash").lower()
            if pay_method not in {"cash", "mpesa", "split", "number"}:
                pay_method = "cash"
            new_payment_rec = Payment(
                orderId=new_order.orderId,
                amount=float(order_data.amountPaid),
                payment_method=pay_method,
                reason="order",
                payment_details=order_data.paymentDetails,
                recorded_by=current_user.userId,
            )
            db.add(new_payment_rec)

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
        raise
    except ValueError as e:
        db.rollback()
        raise HTTPException(status_code=422, detail=str(e))
    except Exception as e:
        db.rollback()
        logger.error(f"Error creating transactional order: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail="Something went wrong while creating the order. Please try again.")
    
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
        orders = db.exec(statement).all()
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
        orders = db.exec(statement).all()
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
        orders = db.exec(statement).all()
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
        orders = db.exec(statement).all()
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
        orders = db.exec(statement).all()
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
        orders = db.exec(statement).all()
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
) -> list[model.OrderResponse]:
    """
    Retrieve all orders in the system with pagination, newest first.
    """
    try:
        statement = select(Order).where(visible_orders()).order_by(Order.created_at.desc()).offset(skip).limit(limit)
        orders = db.exec(statement).all()

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
        orders = db.exec(statement).all()

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
# `meta` is also left alone even though _process_line_items enriches it for a sheet-half
# line (injecting l/w/u from the variant's sheet size). It carries the real cut dimensions,
# so it has to be compared; the enrichment only risks a FALSE "changed", which errs the
# safe way — the line gets reversed and re-cut, which is correct, just not optimal.
#
# These also drift under the order's feet: a manager offcut correction, or a container
# being finished and reopened, rewrites them on the stored item while a cashier has the
# order open. Comparing them would then reverse and re-deduct material nobody touched.
_ENGINE_WRITTEN_LINE_KEYS = ("offcut_sources", "stock_sources", "_resolved_as_2d")

# Per-line pricing and display, written by the frontend calculators. Excluded for the same
# reason as the item's own unitPrice: money does not describe a different consumption, and
# the backend reprices from the DB anyway (_calculate_complex_item_total). Comparing them
# would reverse and re-cut real material over a tariff change.
_PRICE_AND_DISPLAY_LINE_KEYS = ("rate", "total", "label")

_IGNORED_LINE_KEYS = _ENGINE_WRITTEN_LINE_KEYS + _PRICE_AND_DISPLAY_LINE_KEYS


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
        return json.dumps(keep, sort_keys=True, default=str)

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
    to subtract it from datetime.utcnow(), which made every order look three hours younger
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

    reused, unmatched = [], []
    for cart_index, req in enumerate(item_requests):
        sig = _stock_signature(
            req.productId, req.variantId, req.unitType, req.quantity,
            (req.details or {}).get("lineItems"),
        )
        pool = buckets.get(sig)
        if pool:
            reused.append((cart_index, req, pool.pop(0)))
        else:
            unmatched.append((cart_index, req))

    reversing = [oi for pool in buckets.values() for oi in pool]
    return reused, reversing, unmatched


def update_order(
    order_id: int,
    order_data: model.OrderEditRequest,
    db: Session,
    current_user,
) -> model.OrderCreateResponse:
    """
    Edit an existing order in-place:
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

    order = get_visible_order_or_404(db, order_id)
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
    existing_items = db.exec(select(OrderItem).where(OrderItem.order_id == order_id)).all()
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
        if doomed_ids:
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
            item_total = ceil_amount(_calculate_complex_item_total(item_req, db, products_cache, variants_cache))
            store_unit_price = item_total / Decimal(item_req.quantity) if item_req.quantity > 0 else item_total

            # Price only. `details` keeps the STORED copy, because it holds the offcut_sources
            # this item's real consumption recorded -- the incoming request either lacks them
            # or carries a stale round-tripped copy. Overwriting would orphan the chain and
            # break any later reversal of this item.
            kept_details = dict(kept_item.details or {})
            kept_details["unitPrice"] = float(store_unit_price)
            kept_item.details = kept_details
            flag_modified(kept_item, "details")
            kept_item.total_price = float(item_total)
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
        if new_payment != Decimal("0"):
            from entities.payments import Payment
            pay_method = (order_data.paymentMethod or "cash").lower()
            if pay_method not in {"cash", "mpesa", "split", "number"}:
                pay_method = "cash"
            edit_payment_rec = Payment(
                orderId=order_id,
                amount=float(new_payment),
                payment_method=pay_method,
                reason="refund" if new_payment < Decimal("0") else "order",
                payment_details=order_data.paymentDetails,
                recorded_by=current_user.userId,
            )
            db.add(edit_payment_rec)

        db.commit()

        logger.info(f"Order {order_id} edited by {current_user.userId}")
        return model.OrderCreateResponse(message="Order updated successfully", orderId=order_id)

    except HTTPException:
        raise
    except ValueError as e:
        db.rollback()
        raise HTTPException(status_code=422, detail=str(e))
    except Exception as e:
        db.rollback()
        logger.error(f"Error editing order {order_id}: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail="Something went wrong while updating the order. Please try again.")


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
    """
    from sqlalchemy.orm.attributes import flag_modified
    from core.inventory.glassOffcutService import correct_glass_offcut_event

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

    details = item.details or {}
    line_items = details.get("lineItems") or []
    if not (0 <= line_idx < len(line_items)):
        raise HTTPException(status_code=422, detail="Invalid line_idx for this order item")

    offcut_sources = line_items[line_idx].get("offcut_sources") or []
    if not (0 <= event_idx < len(offcut_sources)):
        raise HTTPException(status_code=422, detail="Invalid event_idx for this cutting line")

    event = offcut_sources[event_idx]

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

    product = db.get(Product, item.product_id)
    if not product:
        raise HTTPException(status_code=404, detail="Product not found")
    variant = db.get(Variant, item.variant_id) if item.variant_id else None

    failed_cut_refs = [{"line_idx": fc.line_idx, "cut_idx": fc.cut_idx} for fc in failed_cuts]

    try:
        result = correct_glass_offcut_event(
            db, product, variant, event, [r.model_dump() for r in new_remainders],
            failed_cut_refs, forced_offcut_id,
            sibling_events=sibling_events, owner_line_idx=line_idx,
        )
        for origin_idx, rep_events in result["replacement_events_by_line"].items():
            target_idx = origin_idx if isinstance(origin_idx, int) and 0 <= origin_idx < len(line_items) else line_idx
            target_sources = line_items[target_idx].get("offcut_sources")
            if target_sources is None:
                target_sources = []
                line_items[target_idx]["offcut_sources"] = target_sources
            target_sources.extend(rep_events)

        item.details = {**details, "lineItems": line_items}
        flag_modified(item, "details")
        db.add(item)

        audit = EditHistory(
            entity_type="offcut_correction",
            entity_id=order_id,
            edited_by=current_user.userId,
            action="correct",
            before_snapshot={"item_id": item_id, "line_idx": line_idx, "event_idx": event_idx, "remainders": result["before"]},
            after_snapshot={
                "item_id": item_id, "line_idx": line_idx, "event_idx": event_idx, "remainders": result["after"],
                "failed_cuts": failed_cut_refs, "replacement_events": result["replacement_events"],
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
) -> dict:
    """
    Manager correction for a single 1D (bar/profile) cutting event on a past
    order — the 1D analogue of correct_offcut_for_order_item. See
    inventoryService.correct_profile_offcut_event for the actual offcut
    inventory mutation (remainder-only edit vs. full source replacement).
    """
    from sqlalchemy.orm.attributes import flag_modified
    from core.inventory.inventoryService import correct_profile_offcut_event

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

    details = item.details or {}
    line_items = details.get("lineItems") or []
    if not (0 <= line_idx < len(line_items)):
        raise HTTPException(status_code=422, detail="Invalid line_idx for this order item")

    offcut_sources = line_items[line_idx].get("offcut_sources") or []
    if not (0 <= event_idx < len(offcut_sources)):
        raise HTTPException(status_code=422, detail="Invalid event_idx for this cutting line")

    event = offcut_sources[event_idx]

    product = db.get(Product, item.product_id)
    if not product:
        raise HTTPException(status_code=404, detail="Product not found")
    variant = db.get(Variant, item.variant_id) if item.variant_id else None

    try:
        result = correct_profile_offcut_event(
            db, product, variant, event, new_remainder_length, replace_source, forced_offcut_id,
        )
        if result["replacement_event"]:
            offcut_sources.append(result["replacement_event"])

        item.details = {**details, "lineItems": line_items}
        flag_modified(item, "details")
        db.add(item)

        audit = EditHistory(
            entity_type="profile_offcut_correction",
            entity_id=order_id,
            edited_by=current_user.userId,
            action="correct",
            before_snapshot={"item_id": item_id, "line_idx": line_idx, "event_idx": event_idx, "event": result["before"]},
            after_snapshot={
                "item_id": item_id, "line_idx": line_idx, "event_idx": event_idx, "event": result["after"],
                "replacement_event": result["replacement_event"],
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

    items = db.exec(
        select(OrderItem)
        .join(Order, Order.orderId == OrderItem.order_id)
        # An open sale window's items are not in the cutting queue (no cutting before
        # payment), so they can't be reported cut either.
        .where(OrderItem.item_id.in_(item_ids), OrderItem.cutting_completed == False, visible_orders())  # noqa: E712
    ).all()
    now = datetime.utcnow()
    updated = []
    for item in items:
        item.cutting_completed = True
        item.cutting_completed_at = now
        db.add(item)
        updated.append(item.item_id)

    db.commit()
    return {"updated": updated}


def mark_cutting_complete_for_orders_batch(order_ids: list, db: Session, current_user) -> dict:
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

    orders = db.exec(select(Order).where(Order.orderId.in_(order_ids), visible_orders())).all()
    now = datetime.utcnow()
    updated_items = []
    updated_orders = []  # orders processed — their workflow status is left untouched
    for order in orders:
        for item in order.orderItems:
            if not item.cutting_completed:
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
    order = db.get(Order, order_id)
    if not order or order.status in HIDDEN_STATUSES:
        raise HTTPException(status_code=404, detail="Order not found")
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
    orders = db.exec(stmt).all()
    results = []
    for order in orders:
        pending_items = [oi for oi in order.orderItems if not oi.cutting_completed]
        results.append({
            "orderId": order.orderId,
            "customerName": order.customer_name,
            "items": [
                {"itemId": oi.item_id, "productName": oi.product.name, "details": oi.details}
                for oi in pending_items
            ],
        })
    return results


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
        stmt = stmt.where(func.date(EditHistory.edited_at) >= datetime.strptime(since, "%Y-%m-%d").date())
    if until:
        stmt = stmt.where(func.date(EditHistory.edited_at) <= datetime.strptime(until, "%Y-%m-%d").date())

    rows = db.exec(stmt).all()

    usernames: dict = {}
    def _username(uid) -> str:
        if uid not in usernames:
            user = db.get(User, uid)
            usernames[uid] = user.username if user else str(uid)
        return usernames[uid]

    return [
        model.EditHistoryResponse(
            id=r.id,
            entity_type=r.entity_type,
            entity_id=r.entity_id,
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
        orders = db.exec(statement).all()
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
            payment_details=resolved_details,
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
            message=f"Order {order_id} status updated to {new_status}."
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
) -> model.OrderStatusUpdateResponse:
    """
    Cancel an order from Order History. Requires the CEO-configured 4-digit PIN.
    Restores stock/offcuts for every item; idempotent if already cancelled.
    refund_method/refund_details: how the cashier is handing back whatever was
    already collected — the cashier picks this explicitly when there's
    something to refund (see CancelOrderModal); _restore_and_cancel falls
    back to the order's last payment method if left unset.

    cut_confirmations: {line_ref: {physicalState, resolution}} — the operator's answer
    per cut line (see core/inventory/reversalPlan.py). An already-cut line is never
    recombined into a whole bar; what happens to its piece is the operator's choice.
    Lines needing no judgement fall back to their prefilled default, so cancelling an
    order nothing has been cut for needs no payload.
    """
    from core.settings.service import verify_cancel_pin, cancel_pin_is_configured
    from core.inventory import reversalPlan

    try:
        require_role(["manager", "ceo", "admin"], current_user)

        if not cancel_pin_is_configured(db):
            raise HTTPException(
                status_code=400,
                detail="No cancel PIN has been set up yet. Ask the CEO to configure one.",
            )
        if not verify_cancel_pin(db, pin):
            raise HTTPException(status_code=403, detail="Incorrect PIN.")

        order = get_visible_order_or_404(db, order_id)
        if order.status != "cancelled" and _order_age(db, order) > CANCEL_WINDOW:
            raise HTTPException(status_code=400, detail="This order is more than a week old and can no longer be cancelled.")

        # Already-cut orders used to be refused outright here. They can now be cancelled,
        # one confirmed cut line at a time — the material just doesn't come back as whole
        # bars. Skipped for an already-cancelled order, which _restore_and_cancel no-ops on.
        cut_decisions = None
        if order.status != "cancelled":
            reversal_plan = reversalPlan.build_plan(db, order)
            try:
                reversalPlan.assert_plan_fresh(db, reversal_plan, plan_token)
                cut_decisions = reversalPlan.validate_decisions(reversal_plan, cut_confirmations)
            except reversalPlan.PlanStaleError as e:
                raise HTTPException(status_code=409, detail={"message": str(e), "plan": e.fresh_plan})
            except ValueError as e:
                raise HTTPException(status_code=422, detail=str(e))
            # Lock the pieces before any stock moves — see update_order.
            reversalPlan.lock_decision_pieces(db, reversal_plan)

        old_status = order.status
        result = _restore_and_cancel(db, order, current_user, refund_method, refund_details,
                                     cut_decisions=cut_decisions)

        if old_status != "cancelled":
            refund_note = (
                f"Refunded KSH {result['amount_refunded']:.2f} via {result['refund_method']}"
                if result["amount_refunded"] > 0 else "Nothing was collected against this order"
            )
            db.add(EditHistory(
                entity_type="order_cancellation",
                entity_id=order_id,
                edited_by=current_user.userId,
                action="cancel",
                before_snapshot={"status": old_status},
                after_snapshot={
                    "status": "cancelled",
                    "amount_refunded": result["amount_refunded"],
                    "refund_method": result["refund_method"],
                    "cut_confirmations": (
                        reversalPlan.decisions_summary(reversal_plan, cut_decisions)
                        if cut_decisions is not None else []
                    ),
                },
                notes=f"{current_user.username} — {refund_note}",
            ))

        db.commit()
        db.refresh(order)

        logger.info(f"Order {order_id} cancelled (PIN-verified) by {current_user.userId}.")
        return model.OrderStatusUpdateResponse(message=f"Order {order_id} cancelled.")
    except HTTPException:
        raise
    except Exception as e:
        db.rollback()
        logger.error(f"Error cancelling order {order_id}: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail="Internal server error")
