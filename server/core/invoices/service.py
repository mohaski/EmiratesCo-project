from datetime import datetime, timezone
from decimal import Decimal, ROUND_HALF_UP
from typing import List, Optional

from fastapi import HTTPException, status
from sqlmodel import Session, select

from entities.invoices import Invoice
from core.financials.splitDetails import normalize_payment_details
from entities.orders import Order
from entities.orderItems import OrderItem
from entities.products import Product
from entities.variants import Variant
from loggiing import logger
from utils import ceil_amount
from . import model


# ── Helpers ──────────────────────────────────────────────────────────────────

def _generate_invoice_number(db: Session) -> str:
    """Generate next sequential invoice number: INV-000001."""
    result = db.exec(select(Invoice).order_by(Invoice.invoiceId.desc())).first()
    next_id = (result.invoiceId + 1) if result else 1
    return f"INV-{next_id:06d}"


def _snapshot_to_item_request(snap: dict, position: int):
    """A stored cart line -> the OrderItemRequest checkout prices. Mirrors the client's
    mapItemForBackend (client/src/utils/orderItemMapping.js), so a quotation is priced exactly
    as the same cart would be at checkout."""
    from core.ordering.model import OrderItemRequest

    details = snap.get("details") if isinstance(snap.get("details"), dict) else {}
    dynamic = bool(details.get("isDynamic")) and not details.get("lineItems")

    def num(*values):
        for v in values:
            try:
                if v not in (None, "") and float(v):
                    return float(v)
            except (TypeError, ValueError):
                continue
        return None

    qty = num(snap.get("qty"), snap.get("quantity"), details.get("qty") if dynamic else None)
    qty = 1.0 if qty is None else qty
    price = num(snap.get("price"), snap.get("unitPrice"))
    if price is None and dynamic and qty > 0:
        price = (num(snap.get("totalPrice")) or 0) / qty
    product_id = num(snap.get("productId"), snap.get("id"))
    if product_id is None:
        raise HTTPException(status_code=400, detail=f"Line {position + 1} of the quotation has no product.")
    variant_id = snap.get("variantId") or details.get("variantId")
    return OrderItemRequest(
        productId=int(product_id),
        variantId=int(variant_id) if variant_id else None,
        quantity=qty,
        unitPrice=price or 0,
        unitType=snap.get("unit") or "pcs",
        details=details,
    )


def _price_quotation(items: list, vat_enabled: bool, discount: float, db: Session):
    """Price a quotation on the server, the same way checkout prices the sale.

    Returns (items, subtotal, vat_amount, total, changed): the items with each line's
    totalPrice (and its calculator line totals) set to the server's price, and how many lines
    the browser had priced differently. Totals follow create_order: per-item ceil, discount off
    the subtotal, VAT on the net."""
    from core.ordering.orderService import _calculate_complex_item_total, compute_VAT_amount

    priced, subtotal, changed = [], Decimal("0.00"), 0
    for position, snap in enumerate(items or []):
        snap = dict(snap)
        req = _snapshot_to_item_request(snap, position)
        try:
            item_total = ceil_amount(_calculate_complex_item_total(req, db))
        except ValueError as e:  # a line with no price set (glass) - the cashier must see why
            raise HTTPException(status_code=422, detail=str(e))

        line_items = (req.details or {}).get("lineItems")
        if isinstance(line_items, list) and line_items:
            new_lines = []
            for line in line_items:
                line = dict(line) if isinstance(line, dict) else line
                if isinstance(line, dict):
                    one = req.model_copy(update={"details": {**req.details, "lineItems": [line]}})
                    line_total = _calculate_complex_item_total(one, db)
                    if abs(Decimal(str(line.get("total") or 0)) - line_total) > Decimal("0.005"):
                        qty = Decimal(str(line.get("qty") or 0))
                        line["total"] = float(line_total)
                        line["rate"] = float(line_total / qty) if qty else float(line_total)
                new_lines.append(line)
            snap["details"] = {**(snap.get("details") or {}), "lineItems": new_lines}

        if abs(ceil_amount(Decimal(str(snap.get("totalPrice") or 0))) - item_total) > Decimal("0.005"):
            changed += 1
            snap["totalPrice"] = float(item_total)
            if req.quantity > 0:
                snap["price"] = float(item_total / Decimal(str(req.quantity)))
        priced.append(snap)
        subtotal += item_total

    net = ceil_amount(max(subtotal - Decimal(str(discount or 0)), Decimal("0.00")))
    vat = compute_VAT_amount(net) if vat_enabled else Decimal("0.00")
    return priced, float(subtotal), float(vat), float(net + vat), changed


def _invoice_to_response(inv: Invoice) -> model.InvoiceResponse:
    return model.InvoiceResponse(
        invoiceId=inv.invoiceId,
        invoice_number=inv.invoice_number,
        customer_id=inv.customer_id,
        customer_name=inv.customer_name,
        customer_phone=inv.customer_phone,
        customer_type=inv.customer_type,
        created_by=str(inv.created_by),
        created_at=inv.created_at.isoformat() if inv.created_at else "",
        converted_at=inv.converted_at.isoformat() if inv.converted_at else None,
        subtotal=inv.subtotal,
        vat_amount=inv.vat_amount,
        total=inv.total,
        discount=inv.discount,
        vat_enabled=inv.vat_enabled,
        items=inv.items or [],
        notes=inv.notes,
        status=inv.status,
        order_id=inv.order_id,
    )


# ── CRUD ─────────────────────────────────────────────────────────────────────

def create_invoice(
    data: model.InvoiceCreate,
    created_by_id: str,
    db: Session,
) -> model.InvoiceCreateResponse:
    """Save a new invoice (quotation). The server prices it - the totals the browser sends
    are ignored, so a printed quotation matches what checkout will charge for the same cart."""
    try:
        items, subtotal, vat_amount, total, changed = _price_quotation(
            data.items, data.vat_enabled, data.discount, db)
        invoice_number = _generate_invoice_number(db)

        inv = Invoice(
            invoice_number=invoice_number,
            customer_id=data.customer.id,
            customer_name=data.customer.name,
            customer_phone=data.customer.phone,
            customer_type=data.customer.type,
            created_by=created_by_id,
            subtotal=subtotal,
            vat_amount=vat_amount,
            total=total,
            discount=data.discount,
            vat_enabled=data.vat_enabled,
            items=items,
            notes=data.notes,
            status="draft",
        )
        db.add(inv)
        db.commit()
        db.refresh(inv)

        logger.info(f"Invoice {invoice_number} created by {created_by_id}")
        return model.InvoiceCreateResponse(
            message="Invoice created",
            invoiceId=inv.invoiceId,
            invoice_number=inv.invoice_number,
            subtotal=inv.subtotal,
            vat_amount=inv.vat_amount,
            total=inv.total,
            repriced_lines=changed,
        )
    except HTTPException:
        db.rollback()
        raise
    except Exception as e:
        db.rollback()
        logger.error(f"Create invoice error: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail="Failed to create invoice")


def get_invoice(invoice_id: int, db: Session) -> model.InvoiceResponse:
    inv = db.get(Invoice, invoice_id)
    if not inv:
        raise HTTPException(status_code=404, detail="Invoice not found")
    return _invoice_to_response(inv)


def list_invoices(
    skip: int,
    limit: int,
    status_filter: Optional[str],
    db: Session,
) -> List[model.InvoiceResponse]:
    stmt = select(Invoice).order_by(Invoice.created_at.desc()).offset(skip).limit(limit)
    if status_filter:
        stmt = stmt.where(Invoice.status == status_filter)
    return [_invoice_to_response(i) for i in db.exec(stmt).all()]


def update_invoice(
    invoice_id: int,
    data: model.InvoiceUpdate,
    db: Session,
) -> model.InvoiceResponse:
    """Update a draft invoice. Converted/cancelled invoices are immutable."""
    inv = db.get(Invoice, invoice_id)
    if not inv:
        raise HTTPException(status_code=404, detail="Invoice not found")
    if inv.status in ("converted", "cancelled"):
        raise HTTPException(
            status_code=400,
            detail=f"Cannot edit a {inv.status} invoice",
        )

    # Only allow status transitions to 'sent' or 'cancelled' via this endpoint
    if data.status and data.status not in ("sent", "cancelled"):
        raise HTTPException(
            status_code=400,
            detail="Use the /convert endpoint to convert an invoice to an order",
        )

    update_dict = data.model_dump(exclude_unset=True)
    if "customer" in update_dict and update_dict["customer"]:
        c = update_dict.pop("customer")
        inv.customer_id = c.get("id")
        inv.customer_name = c.get("name")
        inv.customer_phone = c.get("phone")
        inv.customer_type = c.get("type", "guest")
    else:
        update_dict.pop("customer", None)

    # Totals are always the server's: never taken from the request, and recomputed whenever
    # what they depend on changes.
    for key in ("subtotal", "vat_amount", "total"):
        update_dict.pop(key, None)
    reprice = any(k in update_dict for k in ("items", "vat_enabled", "discount"))

    for key, value in update_dict.items():
        setattr(inv, key, value)

    if reprice:
        inv.items, inv.subtotal, inv.vat_amount, inv.total, _ = _price_quotation(
            inv.items, inv.vat_enabled, inv.discount, db)

    db.add(inv)
    db.commit()
    db.refresh(inv)
    return _invoice_to_response(inv)


def convert_invoice_to_order(
    invoice_id: int,
    data: model.InvoiceConvertRequest,
    served_by_id: str,
    db: Session,
) -> model.InvoiceConvertResponse:
    """
    Convert a draft/sent invoice into a confirmed order.

    Steps:
      1. Validate invoice state.
      2. Build an Order + OrderItems from the stored invoice items.
      3. Deduct stock via inventoryService.
      4. Link Invoice → Order (invoice.order_id) and Order → Invoice (order.source_invoice_id).
      5. Mark invoice as 'converted'.
    """
    from core.ordering.orderService import compute_VAT_amount

    inv = db.get(Invoice, invoice_id)
    if not inv:
        raise HTTPException(status_code=404, detail="Invoice not found")
    if inv.status == "converted":
        raise HTTPException(status_code=400, detail="Invoice already converted to an order")
    if inv.status == "cancelled":
        raise HTTPException(status_code=400, detail="Cannot convert a cancelled invoice")

    try:
        discount = Decimal(str(data.discount if data.discount is not None else inv.discount))
        subtotal = Decimal(str(inv.subtotal))
        net = ceil_amount(max(subtotal - discount, Decimal("0.00")))
        vat = compute_VAT_amount(net) if inv.vat_enabled else Decimal("0.00")
        final_total = net + vat
        amount_paid = ceil_amount(Decimal(str(data.amount_paid)))
        if amount_paid < 0:
            raise HTTPException(status_code=400, detail="The amount paid can't be negative.")
        if amount_paid > final_total + Decimal("1"):
            raise HTTPException(status_code=400, detail=(
                f"The amount paid (KSH {amount_paid:,.0f}) is more than the order total (KSH {final_total:,.0f})."))
        amount_paid = min(amount_paid, final_total)
        balance = final_total - amount_paid

        is_paid = balance <= Decimal("0.10")
        payment_status = "Paid" if is_paid else ("Partial" if amount_paid > 0 else "Unpaid")
        balance = Decimal("0.00") if is_paid else balance

        new_order = Order(
            customerid=inv.customer_id,
            servedby=served_by_id,
            VAT_status=inv.vat_enabled,
            payment_status=payment_status,
            discount=float(discount),
            amountPayed=float(amount_paid),
            status="confirmed",
            subtotal=float(net),
            total=float(final_total),
            balance=float(balance),
            source_invoice_id=invoice_id,
        )

        db.add(new_order)
        db.flush()  # get orderId

        # Record the payment collected at conversion time (mirrors orderService.create_order)
        if amount_paid > Decimal("0"):
            from entities.payments import Payment
            pay_method = (data.payment_method or "cash").lower()
            if pay_method not in {"cash", "mpesa", "split", "number"}:
                pay_method = "cash"
            db.add(Payment(
                orderId=new_order.orderId,
                amount=float(amount_paid),
                payment_method=pay_method,
                reason="order",
                payment_details=normalize_payment_details(pay_method, data.payment_details, float(amount_paid)),
                recorded_by=served_by_id,
            ))

        # Build OrderItems from the stored item snapshots
        for item_snap in inv.items:
            product_id = int(item_snap.get("productId") or item_snap.get("id", 0))
            variant_id = item_snap.get("variantId")
            # also check inside nested details (calculators store variantId there)
            if not variant_id and isinstance(item_snap.get("details"), dict):
                variant_id = item_snap["details"].get("variantId")
            if variant_id:
                variant_id = int(variant_id)

            total_price = float(item_snap.get("totalPrice", 0))
            qty = float(item_snap.get("qty") or item_snap.get("quantity", 1))
            unit_price = total_price / qty if qty else total_price

            details = dict(item_snap.get("details") or {})
            details["quantity"] = qty
            details["unitType"] = item_snap.get("unit", "pcs")
            details["unitPrice"] = unit_price
            details["_source"] = "invoice"
            details["_invoice_number"] = inv.invoice_number

            order_item = OrderItem(
                order_id=new_order.orderId,
                product_id=product_id,
                variant_id=variant_id,
                total_price=total_price,
                details=details,
            )
            db.add(order_item)
            # Stock is deducted only when the order is confirmed at checkout (POST /orders/)
            # Do NOT deduct here

        # Link invoice → order
        inv.order_id = new_order.orderId
        inv.status = "converted"
        inv.converted_at = datetime.now(timezone.utc)
        db.add(inv)
        # Gap-free receipt number, taken last so the counter lock is held only briefly.
        from core.ordering.orderNumbers import assign_order_no
        assign_order_no(db, new_order)
        db.commit()

        logger.info(
            f"Invoice {inv.invoice_number} converted → Order {new_order.orderId} "
            f"by {served_by_id}"
        )
        return model.InvoiceConvertResponse(
            message="Invoice converted to order",
            invoiceId=invoice_id,
            orderId=new_order.orderId,
        )
    except HTTPException:
        db.rollback()
        raise
    except Exception as e:
        db.rollback()
        logger.error(f"Invoice conversion error: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail="Failed to convert invoice to order")
