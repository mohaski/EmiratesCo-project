"""Sale windows — parallel open checkouts at the till.

A cashier who is waiting for one customer to pay can park that cart in a window and serve
the next customer in another. Each window is an Order with status "held" whose stock is
REALLY deducted (by the same engines a checkout uses), so:

  * every other window, device and calculator already sees the reduced stock, with no
    availability query needing to know that windows exist;
  * an offcut a window has taken is simply gone from the pool for everyone else;
  * remainders a window produces are private to it until it closes
    (core/inventory/holdScope.py), because the bar or sheet they came from is still whole on
    the rack — nothing is cut before payment.

A window ends in one of three ways, all of which are one transaction:

  confirmed  payment recorded, gap-free order number assigned, private offcuts published,
             order becomes "confirmed" and enters the cutting queue.
  released   the cashier closed it: every item's stock is restored, the order becomes
             "abandoned" (kept for the audit trail, hidden everywhere — see visibility.py).
  expired    same as released, done by the background sweeper after IDLE_MINUTES without
             any activity on the window. There is no manager override and no extension.

Rules:
  * A cashier owns their windows; nobody else (managers included) can see or act on them.
  * At most WINDOW_LIMIT open windows per cashier.
  * Every cart write and confirm carries the version the client last saw; a stale version
    is refused with 409 rather than overwriting a newer cart.
  * A confirm carries an idempotency key, so a retried confirm can't double-charge.

Concurrency: every mutation locks the window row first, then the order row, then the
stock rows of every variant/product involved in ascending id order, before any engine
runs. Two windows touching the same products therefore queue up instead of deadlocking;
if Postgres still reports a deadlock (offcut rows are locked by the engines themselves),
the whole operation is retried from scratch.
"""
import time
from datetime import timedelta
from decimal import Decimal
from typing import Optional

from fastapi import HTTPException
from sqlalchemy import func, update
from sqlalchemy.exc import DBAPIError
from sqlalchemy.orm.attributes import flag_modified
from sqlmodel import Session, select

from db.database import engine
from entities.orders import Order
from entities.orderItems import OrderItem
from entities.products import Product
from entities.variants import Variant
from entities.offcuts import Offcut
from entities.saleWindows import SaleWindow
from entities.users import User
from core.inventory import holdScope
from loggiing import logger
from utils import require_role, ceil_amount

from . import windowModel as wm
from . import model
from .visibility import HELD, ABANDONED
from .orderNumbers import assign_order_no

WINDOW_LIMIT = 3
IDLE_MINUTES = 15
IDLE = timedelta(minutes=IDLE_MINUTES)
_ROLES = ["manager", "cashier", "ceo", "admin"]
_DEADLOCK_CODES = {"40P01", "40001"}  # deadlock_detected, serialization_failure
_MAX_ATTEMPTS = 3


# ── Helpers ───────────────────────────────────────────────────────────────────

def _db_now(db: Session):
    """The DB's local wall clock, in the same frame as last_activity_at / created_at."""
    return db.exec(select(func.localtimestamp())).one()


def _is_retryable(exc: Exception) -> bool:
    orig = getattr(exc, "orig", None)
    return getattr(orig, "pgcode", None) in _DEADLOCK_CODES


def _with_retry(db: Session, fn, *args):
    """Run fn(db, *args) as one transaction, retrying it from the top on a deadlock."""
    for attempt in range(1, _MAX_ATTEMPTS + 1):
        try:
            return fn(db, *args)
        except DBAPIError as e:
            db.rollback()
            if not _is_retryable(e):
                logger.error(f"sale window: database error ({e})", exc_info=True)
                raise HTTPException(status_code=500, detail="Something went wrong with this window. Please try again.")
            if attempt == _MAX_ATTEMPTS:
                raise HTTPException(
                    status_code=409,
                    detail="The till is busy with another sale touching the same stock. Please try again.",
                )
            logger.warning(f"sale window: deadlock on attempt {attempt}, retrying")
            time.sleep(0.05 * attempt)


def _lock_window(db: Session, window_id: int, user) -> SaleWindow:
    window = db.exec(
        select(SaleWindow).where(SaleWindow.window_id == window_id).with_for_update()
    ).first()
    # Someone else's window reads as "not found": windows are private to their cashier.
    if window is None or window.user_id != user.userId:
        raise HTTPException(status_code=404, detail="Sale window not found")
    return window


def _closed_error(db: Session, window: SaleWindow) -> HTTPException:
    if window.close_reason == "confirmed":
        order = db.get(Order, window.order_id)
        msg = f"This window was already confirmed as order #{order.order_no if order else window.order_id}."
    elif window.close_reason == "expired":
        msg = (f"This window was idle for more than {IDLE_MINUTES} minutes, so it was closed "
               "and its items were put back in stock.")
    else:
        msg = "This window has been closed and its items were put back in stock."
    return HTTPException(status_code=410, detail={"message": msg, "closeReason": window.close_reason})


def _require_open(db: Session, window: SaleWindow) -> None:
    if window.closed_at is not None:
        raise _closed_error(db, window)


def _require_version(window: SaleWindow, version: int) -> None:
    if version != window.version:
        raise HTTPException(status_code=409, detail={
            "message": "This window was changed somewhere else. Reload it before continuing.",
            "currentVersion": window.version,
        })


def _lock_order(db: Session, order_id: int) -> Order:
    return db.exec(select(Order).where(Order.orderId == order_id).with_for_update()).one()


def _prelock_stock(db: Session, product_ids, variant_ids) -> None:
    """Lock every variant, then every product, this operation will touch, in ascending id
    order, before any engine runs — the engines lock them again later, which is then a
    no-op. Without this, two windows adding the same two products in opposite orders would
    each hold one row and wait on the other."""
    v_ids = sorted({v for v in variant_ids if v})
    p_ids = sorted({p for p in product_ids if p})
    if v_ids:
        db.exec(select(Variant).where(Variant.variantId.in_(v_ids))
                .order_by(Variant.variantId).with_for_update()).all()
    if p_ids:
        db.exec(select(Product).where(Product.productId.in_(p_ids))
                .order_by(Product.productId).with_for_update()).all()


def _item_response(item: OrderItem) -> model.OrderItemResponse:
    d = item.details or {}
    return model.OrderItemResponse(
        itemId=item.item_id,
        productId=item.product_id,
        orderId=item.order_id,
        variantId=item.variant_id,
        quantity=d.get("quantity", 0),
        unitType=d.get("unitType"),
        unitPrice=d.get("unitPrice", 0),
        totalPrice=item.total_price,
        details=item.details,
        status=None,
        cuttingCompleted=item.cutting_completed,
        cuttingCompletedAt=None,
    )


def _window_response(db: Session, window: SaleWindow, now=None) -> wm.WindowResponse:
    db.refresh(window)
    order = db.get(Order, window.order_id)
    db.refresh(order)
    now = now or _db_now(db)
    expires = window.last_activity_at + IDLE
    items = db.exec(
        select(OrderItem).where(OrderItem.order_id == order.orderId)
        .order_by(OrderItem.position, OrderItem.item_id)
    ).all()
    return wm.WindowResponse(
        windowId=window.window_id,
        orderId=order.orderId,
        label=window.label,
        deviceId=window.device_id,
        version=window.version,
        openedAt=window.opened_at.isoformat(),
        lastActivityAt=window.last_activity_at.isoformat(),
        expiresAt=expires.isoformat(),
        secondsLeft=max(0, int((expires - now).total_seconds())),
        customerId=order.customerid,
        customerName=order.customer_name,
        VAT_status=order.VAT_status,
        discount=order.discount or 0.0,
        parentOrderId=order.parent_orderid,
        sourceInvoiceId=order.source_invoice_id,
        subtotal=order.subtotal or 0.0,
        total=order.total or 0.0,
        items=[_item_response(i) for i in items],
    )


def _touch(window: SaleWindow) -> None:
    window.last_activity_at = func.localtimestamp()


def require_own_held_order(db: Session, order_id: Optional[int], user) -> Optional[int]:
    """For endpoints outside this module that accept a window's order id to run in its
    hold scope (offcut picker listing, glass preview). Returns the id if it is an open
    window of this user's; anything else is refused rather than silently widening what the
    caller can see."""
    if order_id is None:
        return None
    window = db.exec(select(SaleWindow).where(SaleWindow.order_id == order_id)).first()
    if window is None or window.user_id != user.userId or window.closed_at is not None:
        raise HTTPException(status_code=404, detail="Sale window not found")
    return order_id


# ── Stock work shared by cart changes and closing ────────────────────────────

def _restore_all(db: Session, order: Order, items) -> None:
    """Give back everything the window holds, newest item first (so a later cut from an
    earlier item's remainder is undone before that remainder is, and the bar recombines).
    Runs in the window's hold scope so the engines find its private remainders."""
    from core.inventory.inventoryService import restore_stock_for_order_item

    with holdScope.holding_for(order.orderId):
        for item in sorted(items, key=lambda i: i.item_id, reverse=True):
            restore_stock_for_order_item(db, item)
    db.flush()


def _remap_own_picks(db: Session, order_id: int, selection, old_sources, held_before: dict, remap) -> list:
    """Keep a hand-picked offcut valid across this window's own rebuild — and only that.

    Two kinds of pick can be invalidated by the teardown, both the window's own doing:
      * an offcut THIS window had consumed: followed to wherever the teardown put it back
        (update_order's _remap_offcut_selection, which drops it if it can't be traced);
      * one of this window's own held remainders (`held_before`: row id -> length, taken
        before the teardown): the teardown un-creates it and the rebuild re-creates it as a
        NEW row, so the pick is repointed at the window's current held row of that length.
        Dropped if there is none (yet) — the automatic path then covers the length.
    A pick of anything else is left exactly as the cashier made it: if another window has
    taken that offcut, the engine must refuse the cart ("no longer exists" / "held by
    another open sale") rather than quietly cutting from something else.
    """
    consumed_rows = {int(s["offcut_id"]) for s in old_sources
                     if isinstance(s, dict) and s.get("source") == "offcut" and s.get("offcut_id")}
    consumed, held, foreign = [], [], []
    for e in selection or []:
        row_id = int(e["offcut_id"]) if isinstance(e, dict) and e.get("offcut_id") else None
        if row_id in held_before:
            held.append(e)
        elif row_id in consumed_rows:
            consumed.append(e)
        else:
            foreign.append(e)

    out = remap(db, consumed, old_sources) if consumed else []
    claimed: dict = {}
    for e in held:
        length = held_before[int(e["offcut_id"])]
        rows = db.exec(select(Offcut).where(
            Offcut.held_by_order_id == order_id,
            Offcut.length >= length - 0.01, Offcut.length <= length + 0.01,
            Offcut.quantity > 0,
        ).order_by(Offcut.offcutId)).all()
        row = next((r for r in rows if r.quantity - claimed.get(r.offcutId, 0) >= 1), None)
        if row is not None:
            claimed[row.offcutId] = claimed.get(row.offcutId, 0) + 1
            out.append({**e, "offcut_id": row.offcutId})
    return out + foreign


def _rebuild_items(db: Session, window: SaleWindow, order: Order, req: wm.WindowCartRequest) -> None:
    """Replace the window's items with req.items.

    Unlike update_order (which diffs, to avoid re-cutting material a confirmed order may
    already have cut), a held window is torn down and rebuilt whenever its material
    changes. Nothing in a window has been cut, so re-resolving the whole cart from scratch
    is always physically right, and it lets the engines pick the best source for the cart
    as a whole — exactly what a single checkout of this cart would have chosen.
    """
    from core.inventory.inventoryService import deduct_stock_for_order_item
    from .orderService import _match_items, _remap_offcut_selection, _calculate_complex_item_total

    existing = db.exec(select(OrderItem).where(OrderItem.order_id == order.orderId)).all()
    reused, reversing, unmatched = _match_items(existing, req.items)

    product_ids = [i.product_id for i in existing] + [r.productId for r in req.items]
    variant_ids = [i.variant_id for i in existing] + [r.variantId for r in req.items]
    _prelock_stock(db, product_ids, variant_ids)

    prods = db.exec(select(Product).where(Product.productId.in_(product_ids))).all() if product_ids else []
    vars_ = db.exec(select(Variant).where(Variant.variantId.in_([v for v in variant_ids if v]))).all()
    products_cache = {p.productId: p for p in prods}
    variants_cache = {v.variantId: v for v in vars_}

    subtotal = Decimal("0.00")

    if not reversing and not unmatched:
        # Same material, possibly reordered or repriced: move nothing.
        for cart_index, item_req, kept in reused:
            item_total = ceil_amount(_calculate_complex_item_total(item_req, db, products_cache, variants_cache))
            details = dict(kept.details or {})
            details["unitPrice"] = float(item_total / Decimal(item_req.quantity)) if item_req.quantity > 0 else float(item_total)
            kept.details = details
            flag_modified(kept, "details")
            kept.total_price = float(item_total)
            kept.position = cart_index
            db.add(kept)
            subtotal += item_total
        return subtotal

    # The pick a cashier made by offcut id may have been used up by this very window and
    # come back under a new row id when it is restored; these say which piece it was.
    old_sources = [
        src
        for item in existing
        for line in (item.details or {}).get("lineItems") or []
        if isinstance(line, dict)
        for src in line.get("offcut_sources") or []
    ]

    held_before = {
        r.offcutId: r.length
        for r in db.exec(select(Offcut).where(Offcut.held_by_order_id == order.orderId,
                                              Offcut.width.is_(None))).all()
    }

    _restore_all(db, order, existing)
    doomed = [i.item_id for i in existing]
    if doomed:
        # Provenance pointers only (see update_order); the rows must not block the delete.
        db.exec(update(Offcut).where(Offcut.source_item_id.in_(doomed)).values(source_item_id=None))
    for item in existing:
        db.delete(item)
    db.flush()
    db.expire(order)

    with holdScope.holding_for(order.orderId):
        for cart_index, item_req in enumerate(req.items):
            item_total = ceil_amount(_calculate_complex_item_total(item_req, db, products_cache, variants_cache))
            details = dict(item_req.details or {})
            details["quantity"] = item_req.quantity
            details["unitType"] = item_req.unitType
            details["unitPrice"] = float(item_total / Decimal(item_req.quantity)) if item_req.quantity > 0 else float(item_total)
            for line in details.get("lineItems") or []:
                if not isinstance(line, dict):
                    continue
                if line.get("offcut_selection"):
                    line["offcut_selection"] = _remap_own_picks(
                        db, order.orderId, line["offcut_selection"], old_sources, held_before,
                        _remap_offcut_selection)
                    if not line["offcut_selection"]:
                        line.pop("offcut_selection")
                line.pop("offcut_sources", None)  # engine output, recorded afresh below

            new_item = OrderItem(
                order_id=order.orderId,
                product_id=item_req.productId,
                variant_id=item_req.variantId,
                total_price=float(item_total),
                details=details,
                position=cart_index,
            )
            db.add(new_item)
            db.flush()
            deduct_stock_for_order_item(db, new_item)
            subtotal += item_total
    return subtotal


def _close(db: Session, window: SaleWindow, reason: str) -> None:
    """Release a window: all its stock back, its order abandoned, the window closed."""
    order = _lock_order(db, window.order_id)
    items = db.exec(select(OrderItem).where(OrderItem.order_id == order.orderId)).all()
    _prelock_stock(db, [i.product_id for i in items], [i.variant_id for i in items])
    _restore_all(db, order, items)
    # Anything still tagged (e.g. a partial-credit piece) is real, unheld material now.
    holdScope.publish_held_offcuts(db, order.orderId)

    order.status = ABANDONED
    order.balance = 0.0
    db.add(order)
    window.closed_at = func.localtimestamp()
    window.close_reason = reason
    db.add(window)


# ── Public API ────────────────────────────────────────────────────────────────

def list_my_windows(db: Session, user) -> list:
    require_role(_ROLES, user)
    windows = db.exec(
        select(SaleWindow)
        .where(SaleWindow.user_id == user.userId, SaleWindow.closed_at.is_(None))
        .order_by(SaleWindow.window_id)
    ).all()
    now = _db_now(db)
    return [_window_response(db, w, now) for w in windows]


def get_window(db: Session, window_id: int, user) -> wm.WindowResponse:
    require_role(_ROLES, user)
    window = db.get(SaleWindow, window_id)
    if window is None or window.user_id != user.userId:
        raise HTTPException(status_code=404, detail="Sale window not found")
    _require_open(db, window)
    return _window_response(db, window)


def open_window(db: Session, user, req: wm.WindowOpenRequest) -> wm.WindowResponse:
    require_role(_ROLES, user)
    try:
        # Serialise this cashier's opens so two simultaneous clicks can't both pass the limit.
        db.exec(select(User).where(User.userId == user.userId).with_for_update()).one()
        open_windows = db.exec(
            select(SaleWindow)
            .where(SaleWindow.user_id == user.userId, SaleWindow.closed_at.is_(None))
        ).all()
        if len(open_windows) >= WINDOW_LIMIT:
            raise HTTPException(
                status_code=409,
                detail=f"You already have {WINDOW_LIMIT} open windows. Confirm or close one first.",
            )

        label = (req.label or "").strip() or None
        if label is None:
            taken = {w.label for w in open_windows}
            label = next(f"Window {n}" for n in range(1, WINDOW_LIMIT + 2) if f"Window {n}" not in taken)

        order = Order(
            servedby=user.userId,
            status=HELD,
            payment_status="Unpaid",
            subtotal=0.0, total=0.0, balance=0.0, amountPayed=0.0, discount=0.0,
        )
        db.add(order)
        db.flush()
        window = SaleWindow(order_id=order.orderId, user_id=user.userId,
                            device_id=req.deviceId, label=label)
        db.add(window)
        db.commit()
    except HTTPException:
        db.rollback()
        raise
    logger.info(f"Sale window {window.window_id} (order {order.orderId}) opened by {user.userId}")
    return _window_response(db, window)


def touch_window(db: Session, window_id: int, user) -> wm.WindowResponse:
    """Activity without a cart change (the cashier switched to this window): restarts the
    idle clock."""
    require_role(_ROLES, user)
    try:
        window = _lock_window(db, window_id, user)
        _require_open(db, window)
        _touch(window)
        db.add(window)
        db.commit()
    except HTTPException:
        db.rollback()
        raise
    return _window_response(db, window)


def set_cart(db: Session, window_id: int, user, req: wm.WindowCartRequest) -> wm.WindowResponse:
    require_role(_ROLES, user)
    return _with_retry(db, _set_cart, window_id, user, req)


def _set_cart(db: Session, window_id: int, user, req: wm.WindowCartRequest) -> wm.WindowResponse:
    from .orderService import _resolve_customer_name, compute_VAT_amount

    try:
        window = _lock_window(db, window_id, user)
        _require_open(db, window)
        _require_version(window, req.version)
        order = _lock_order(db, window.order_id)

        subtotal = _rebuild_items(db, window, order, req)

        discount = Decimal(str(req.discount or 0))
        net = ceil_amount(max(subtotal - discount, Decimal("0.00")))
        total = net + (compute_VAT_amount(net) if req.VAT_status else Decimal("0.00"))

        order = db.get(Order, window.order_id)
        order.customerid = req.customerId
        order.customer_name = _resolve_customer_name(db, req.customerId, req.customerName)
        order.VAT_status = req.VAT_status
        order.discount = float(discount)
        order.parent_orderid = req.parentOrderId
        order.source_invoice_id = req.sourceInvoiceId
        order.subtotal = float(net)
        order.total = float(total)
        order.balance = float(total)
        db.add(order)

        window.version += 1
        _touch(window)
        db.add(window)
        db.commit()
    except HTTPException:
        db.rollback()
        raise
    except ValueError as e:
        # "Insufficient stock", "offcut held by another open sale", ... The rollback leaves
        # the window exactly as it was before this request, stock included.
        db.rollback()
        raise HTTPException(status_code=422, detail=str(e))
    return _window_response(db, window)


def confirm_window(db: Session, window_id: int, user, req: wm.WindowConfirmRequest) -> wm.WindowConfirmResponse:
    require_role(_ROLES, user)
    return _with_retry(db, _confirm, window_id, user, req)


def _confirm(db: Session, window_id: int, user, req: wm.WindowConfirmRequest) -> wm.WindowConfirmResponse:
    from entities.credits import Credit
    from entities.invoices import Invoice
    from entities.payments import Payment

    try:
        window = _lock_window(db, window_id, user)
        if window.closed_at is not None:
            if window.close_reason == "confirmed" and window.confirm_key == req.idempotencyKey:
                # A retry of the confirm that already went through: same answer, no new payment.
                db.rollback()
                order = db.get(Order, window.order_id)
                return wm.WindowConfirmResponse(message="Order created successfully",
                                                windowId=window.window_id,
                                                orderId=order.orderId, orderNo=order.order_no)
            raise _closed_error(db, window)
        _require_version(window, req.version)

        order = _lock_order(db, window.order_id)
        items = db.exec(select(OrderItem).where(OrderItem.order_id == order.orderId)).all()
        if not items:
            raise HTTPException(status_code=422, detail="This window's cart is empty.")

        source_inv = None
        if order.source_invoice_id:
            source_inv = db.exec(select(Invoice).where(Invoice.invoiceId == order.source_invoice_id)
                                 .with_for_update()).first()
            if source_inv is None:
                raise HTTPException(status_code=404, detail=f"Invoice {order.source_invoice_id} not found")
            if source_inv.status == "converted":
                raise HTTPException(status_code=400, detail="Invoice has already been converted to an order")

        # Money: the same rules as create_order.
        final_total = Decimal(str(order.total or 0))
        amount_paid = req.amountPaid or 0
        raw_balance = final_total - ceil_amount(Decimal(str(amount_paid)))
        balance = ceil_amount(raw_balance) if raw_balance > Decimal("0.10") else Decimal("0.00")
        order.amountPayed = amount_paid
        order.balance = float(balance)
        order.payment_status = ("Paid" if balance == 0 else ("Partial" if amount_paid > 0 else "Unpaid"))

        if balance > Decimal("0.01") and order.customerid:
            db.add(Credit(
                orderId=order.orderId, customerId=order.customerid,
                amount=float(final_total), amount_due=float(balance),
                status="Partially Paid" if amount_paid > 0 else "Pending",
            ))
        if amount_paid > 0:
            pay_method = (req.paymentMethod or "cash").lower()
            if pay_method not in {"cash", "mpesa", "split", "number"}:
                pay_method = "cash"
            db.add(Payment(
                orderId=order.orderId, amount=float(amount_paid), payment_method=pay_method,
                reason="order", payment_details=req.paymentDetails, recorded_by=user.userId,
            ))

        if source_inv is not None:
            from datetime import datetime, timezone
            source_inv.status = "converted"
            source_inv.order_id = order.orderId
            source_inv.converted_at = datetime.now(timezone.utc)
            db.add(source_inv)

        # The cut is going ahead: its remainders are real stock for everyone from now on.
        holdScope.publish_held_offcuts(db, order.orderId)

        order.status = "confirmed"
        # The sale happened now, not when the window was opened — every report is by day.
        order.created_at = func.localtimestamp()
        db.add(order)

        window.closed_at = func.localtimestamp()
        window.close_reason = "confirmed"
        window.confirm_key = req.idempotencyKey
        db.add(window)

        assign_order_no(db, order)  # last lock taken; see orderNumbers.py
        db.commit()
    except HTTPException:
        db.rollback()
        raise
    except ValueError as e:
        db.rollback()
        raise HTTPException(status_code=422, detail=str(e))

    logger.info(f"Sale window {window_id} confirmed as order {order.orderId} (no. {order.order_no}) by {user.userId}")
    return wm.WindowConfirmResponse(message="Order created successfully", windowId=window_id,
                                    orderId=order.orderId, orderNo=order.order_no)


def release_window(db: Session, window_id: int, user) -> wm.WindowReleaseResponse:
    require_role(_ROLES, user)
    return _with_retry(db, _release, window_id, user)


def _release(db: Session, window_id: int, user) -> wm.WindowReleaseResponse:
    try:
        window = _lock_window(db, window_id, user)
        if window.closed_at is not None:
            if window.close_reason in ("released", "expired"):
                db.rollback()  # already given back: closing twice is harmless
                return wm.WindowReleaseResponse(message="Window closed", windowId=window_id)
            raise _closed_error(db, window)
        _close(db, window, "released")
        db.commit()
    except HTTPException:
        db.rollback()
        raise
    logger.info(f"Sale window {window_id} released by {user.userId}")
    return wm.WindowReleaseResponse(message="Window closed and its items put back in stock",
                                    windowId=window_id)


def expire_idle_windows() -> int:
    """Close every window idle for IDLE_MINUTES. Called by the background sweeper.

    Each window is its own transaction, locked with SKIP LOCKED and with the idle condition
    re-checked under the lock: a window the cashier is acting on right now (its row is
    locked, or its clock was just reset) is simply left for the next sweep.
    """
    cutoff = func.localtimestamp() - IDLE
    with Session(engine) as db:
        ids = db.exec(
            select(SaleWindow.window_id)
            .where(SaleWindow.closed_at.is_(None), SaleWindow.last_activity_at < cutoff)
        ).all()

    expired = 0
    for window_id in ids:
        with Session(engine) as db:
            try:
                window = db.exec(
                    select(SaleWindow)
                    .where(SaleWindow.window_id == window_id,
                           SaleWindow.closed_at.is_(None),
                           SaleWindow.last_activity_at < cutoff)
                    .with_for_update(skip_locked=True)
                ).first()
                if window is None:
                    continue
                _close(db, window, "expired")
                db.commit()
                expired += 1
                logger.info(f"Sale window {window_id} expired after {IDLE_MINUTES} idle minutes; stock released")
            except Exception as e:
                db.rollback()
                logger.error(f"Could not expire sale window {window_id}: {e}", exc_info=True)
    return expired
