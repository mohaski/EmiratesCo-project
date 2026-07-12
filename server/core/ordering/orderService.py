# services/order_service.py
from __future__ import annotations

from datetime import datetime
from decimal import Decimal, ROUND_HALF_UP

from fastapi import Depends, HTTPException, Query
from sqlmodel import Session, select

from entities.orders import Order
from entities.orderItems import OrderItem
from entities.products import Product
from entities.variants import Variant
from entities.editHistory import EditHistory
from entities.invoices import Invoice
from db.database import get_session
from loggiing import logger
from utils import require_role
from ..userManagement.authService import get_current_user
from ..inventory.inventoryService import deduct_stock_for_order_item
from . import model
from typing import List





# ---------------------------------------------------------------------------
# Shared helpers
# ---------------------------------------------------------------------------
def _order_to_response(order: Order) -> model.OrderResponse:
    """Map ORM → response Pydantic model (centralised)."""
    customer_name = None
    try:
        if order.customer:
            customer_name = order.customer.name
    except Exception:
        pass

    amount_paid = order.amountPayed or 0
    balance = order.balance or 0

    return model.OrderResponse(
        orderId=order.orderId,
        customerId=order.customerid,
        customerName=customer_name,
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
        paymentMethod=order.payment_method,
        balance=balance,
        total=order.total or 0,
        source_invoice_id=order.source_invoice_id,
        items=[
            model.OrderItemResponse(
                productId=item.product_id,
                orderId=item.order_id,
                variantId=item.variant_id,
                quantity=item.details.get("quantity", 0) if item.details else 0,
                unitType=item.details.get("unitType") if item.details else None,
                unitPrice=item.details.get("unitPrice", 0) if item.details else 0,
                totalPrice=item.total_price,
                details=item.details,
                status=None
            ) for item in order.orderItems
        ]
    )

def _order_to_shallow_response(order: Order) -> model.OrderResponse:
    """Map ORM into response Pydantic model WITHOUT loading items (to prevent N+1 list queries)."""
    customer_name = None
    try:
        if order.customer:
            customer_name = order.customer.name
    except Exception:
        pass

    amount_paid = order.amountPayed or 0
    balance = order.balance or 0

    return model.OrderResponse(
        orderId=order.orderId,
        customerId=order.customerid,
        customerName=customer_name,
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
        paymentMethod=order.payment_method,
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
    return vat.quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)

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
            servedby=order_data.servedBy,
            parent_orderid=order_data.parentOrderId,
            source_invoice_id=order_data.sourceInvoiceId,
            VAT_status=order_data.VAT_status,
            payment_status=order_data.paymentStatus,
            discount=order_data.discount,
            amountPayed=order_data.amountPaid,
            status=order_data.status or "confirmed",
            payment_method=order_data.paymentMethod,
            payment_details=order_data.paymentDetails,
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

        for item_req in order_data.items:
            item_total = _calculate_complex_item_total(item_req, db, products_cache, variants_cache)

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
                details=final_details
            )
            db.add(new_item)

            # Deduct Stock & Handle Offcuts
            deduct_stock_for_order_item(db, new_item)

            calculated_subtotal += item_total

        # 3. Apply Financials to Order
        discount_val = Decimal(str(order_data.discount or 0))
        net_subtotal = calculated_subtotal - discount_val
        if net_subtotal < 0: net_subtotal = Decimal("0.00")

        if new_order.VAT_status:
            vat_amount = compute_VAT_amount(net_subtotal)
            final_total = net_subtotal + vat_amount
        else:
            final_total = net_subtotal

        amount_paid_val = Decimal(str(order_data.amountPaid or 0))
        raw_balance = final_total - amount_paid_val
        new_balance = raw_balance if raw_balance > Decimal("0.10") else Decimal("0.00")

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
                recorded_by=current_user.userId,
            )
            db.add(new_payment_rec)

        db.commit()

        logger.info(f"Order {new_order.orderId} created (Items: {len(order_data.items)}) by {current_user.userId}.")
        return model.OrderCreateResponse(
            message="Order created successfully",
            orderId=new_order.orderId
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
                Order.VAT_status == True
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
            .where(Order.customerid == customer_id)
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
            .where(Order.servedby == user_id)
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
            Order.created_at <= f"{date} 23:59:59"
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
        statement = select(Order).where(Order.parent_orderid == parent_order_id)
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
        statement = select(Order).order_by(Order.created_at.desc()).offset(skip).limit(limit)
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
        statement = select(Order).where(Order.VAT_status == True)
        orders = db.exec(statement).all()

        return [_order_to_shallow_response(order) for order in orders]

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error retrieving VAT-included orders: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail="Internal server error")

def update_order(
    order_id: int,
    order_data: model.OrderEditRequest,
    db: Session,
    current_user,
) -> model.OrderCreateResponse:
    """
    Edit an existing order in-place:
      1. Snapshot the before state for audit.
      2. Restore stock from all old items.
      3. Delete old items.
      4. Create new items and deduct stock.
      5. Recalculate order totals.
      6. Write an EditHistory record.
    """
    from core.inventory.inventoryService import (
        deduct_stock_for_order_item,
        restore_stock_for_order_item,
    )
    from entities.editHistory import EditHistory
    from entities.products import Product
    from entities.variants import Variant

    require_role(["manager", "cashier", "ceo", "admin"], current_user)

    order = db.get(Order, order_id)
    if not order:
        raise HTTPException(status_code=404, detail="Order not found")
    if order.status in ("cancelled", "completed"):
        raise HTTPException(status_code=400, detail=f"Cannot edit a {order.status} order")

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
        }

        # ── 2. Restore stock from old items ───────────────────────────────────
        # Load into a plain list first so the loop isn't affected by deletions
        old_items = db.exec(select(OrderItem).where(OrderItem.order_id == order_id)).all()
        for old_item in old_items:
            restore_stock_for_order_item(db, old_item)
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
        calculated_subtotal = Decimal("0.00")
        new_items_snapshot = []

        for item_req in order_data.items:
            item_total = _calculate_complex_item_total(item_req, db, products_cache, variants_cache)

            store_unit_price = item_total / Decimal(item_req.quantity) if item_req.quantity > 0 else item_total
            final_details = dict(item_req.details or {})
            final_details["quantity"] = item_req.quantity
            final_details["unitType"] = item_req.unitType
            final_details["unitPrice"] = float(store_unit_price)

            new_item = OrderItem(
                order_id=order.orderId,
                product_id=item_req.productId,
                variant_id=item_req.variantId,
                total_price=float(item_total),
                details=final_details,
            )
            db.add(new_item)
            db.flush()
            deduct_stock_for_order_item(db, new_item)

            calculated_subtotal += item_total
            new_items_snapshot.append({
                "product_id": item_req.productId,
                "variant_id": item_req.variantId,
                "total_price": float(item_total),
            })

        # ── 5. Recalculate totals ─────────────────────────────────────────────
        discount_val = Decimal(str(order_data.discount or 0))
        net = max(calculated_subtotal - discount_val, Decimal("0.00"))
        vat = compute_VAT_amount(net) if order_data.VAT_status else Decimal("0.00")
        final_total = net + vat

        # Accumulate payments: add the new payment on top of what was already collected
        new_payment = Decimal(str(order_data.amountPaid))
        prior_paid = Decimal(str(order.amountPayed or 0))
        total_paid = min(prior_paid + new_payment, final_total)
        new_balance = max(final_total - total_paid, Decimal("0.00"))

        is_paid = new_balance <= Decimal("0.10")
        payment_status = "Paid" if is_paid else ("Partial" if total_paid > 0 else "Unpaid")

        order.customerid = order_data.customerId
        order.discount = float(discount_val)
        order.amountPayed = float(total_paid)
        order.subtotal = float(net)
        order.total = float(final_total)
        order.balance = float(new_balance)
        order.payment_status = payment_status
        order.payment_method = order_data.paymentMethod
        order.payment_details = order_data.paymentDetails
        order.VAT_status = order_data.VAT_status
        db.add(order)

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

        # Record the payment collected during this edit (new_payment is the delta paid now)
        if new_payment > Decimal("0"):
            from entities.payments import Payment
            pay_method = (order_data.paymentMethod or "cash").lower()
            if pay_method not in {"cash", "mpesa", "split", "number"}:
                pay_method = "cash"
            edit_payment_rec = Payment(
                orderId=order_id,
                amount=float(new_payment),
                payment_method=pay_method,
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


def get_audit_history(
    entity_type: str | None,
    db: Session,
    skip: int = 0,
    limit: int = 100,
) -> list[model.EditHistoryResponse]:
    from entities.editHistory import EditHistory

    stmt = select(EditHistory).order_by(EditHistory.edited_at.desc()).offset(skip).limit(limit)
    if entity_type:
        stmt = stmt.where(EditHistory.entity_type == entity_type)

    rows = db.exec(stmt).all()
    return [
        model.EditHistoryResponse(
            id=r.id,
            entity_type=r.entity_type,
            entity_id=r.entity_id,
            edited_by=str(r.edited_by),
            edited_at=r.edited_at.isoformat(),
            action=r.action,
            before_snapshot=r.before_snapshot or {},
            after_snapshot=r.after_snapshot or {},
            notes=r.notes,
        )
        for r in rows
    ]


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
        require_role(["manager", "cashier", "ceo", "admin"], current_user)

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


def _restore_and_cancel(db: Session, order: Order) -> None:
    """
    Restore stock/offcuts for every item on an order and flip it to cancelled.
    Idempotent — a no-op if the order is already cancelled, so callers can't
    accidentally double-restore stock by cancelling twice.
    """
    from core.inventory.inventoryService import restore_stock_for_order_item

    if order.status == "cancelled":
        return
    items = db.exec(select(OrderItem).where(OrderItem.order_id == order.orderId)).all()
    for item in items:
        restore_stock_for_order_item(db, item)
    order.status = "cancelled"
    db.add(order)


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

        order = db.get(Order, order_id)
        if not order:
            raise HTTPException(status_code=404, detail="Order not found")

        order.status = new_status
        db.add(order)
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
    current_user=Depends(get_current_user)
) -> model.OrderStatusUpdateResponse:
    """
    Cancel an order from Order History. Requires the CEO-configured 4-digit PIN.
    Restores stock/offcuts for every item; idempotent if already cancelled.
    """
    from core.settings.service import verify_cancel_pin, cancel_pin_is_configured

    try:
        require_role(["manager", "cashier", "ceo", "admin"], current_user)

        if not cancel_pin_is_configured(db):
            raise HTTPException(
                status_code=400,
                detail="No cancel PIN has been set up yet. Ask the CEO to configure one.",
            )
        if not verify_cancel_pin(db, pin):
            raise HTTPException(status_code=403, detail="Incorrect PIN.")

        order = db.get(Order, order_id)
        if not order:
            raise HTTPException(status_code=404, detail="Order not found")

        _restore_and_cancel(db, order)
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
