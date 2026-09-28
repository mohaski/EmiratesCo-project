"""
Sale windows — the full scenario matrix, against REAL Postgres.

test_sale_windows.py covers the core promises. This suite covers everything around them:

  A. every line type held and released exactly (bars full/half/multi-cut, plain items,
     packs, loose pieces from boxes, open containers, glass multi-cut and half sheets)
  B. cart round-trips: the frontend sending items back with the engines' bookkeeping,
     price/position/customer-only changes (no stock movement), partial changes, empty cart
  C. money: VAT/discount, partial payment with credit, walk-in unpaid, overpay, split,
     balances/debts/reports never counting a held window
  D. invoices converted through a window, and order numbers on every creation path
  E. every order operation refusing a held or abandoned window
  F. the confirmed order's later life: timestamp, manager edit, cancel, and an abandoned
     window never blocking a later reversal
  G. offcut endpoints: CEO listing/edit/delete, picker scope, ownership, glass preview
  H. expiry: countdown, touch, a locked window skipped, everything after expiry
  I. the window state machine: every action on every closed state
  J. concurrency: two tabs, simultaneous opens, simultaneous confirms, opposite lock
     orders, sweeper-vs-cashier, confirm-vs-release
  K. the offcut ledger switched off (legacy path)
  L. the real HTTP layer, and the sweeper running inside the app
  M. global integrity invariants, checked after every section

    DATABASE_URL=postgresql+psycopg2://postgres:<pw>@localhost/emiratesco_edit_test \
        python test_sale_windows_matrix.py
"""
import os
import threading
import time
import uuid

from fastapi import HTTPException
from sqlmodel import Session, select, text

import test_sale_windows as T
from test_sale_windows import check, expect_http, item, full, cut, glass, open_w, set_cart, confirm, release, stock, pool

from db.database import engine, DATABASE_URL
from entities.credits import Credit
from entities.customers import Customer
from entities.invoices import Invoice
from entities.offcutLedger import OffcutPiece
from entities.offcuts import Offcut
from entities.openContainers import OpenContainer
from entities.orderItems import OrderItem
from entities.orders import Order
from entities.payments import Payment
from entities.products import Category, Product
from entities.saleWindows import SaleWindow
from entities.variants import Variant

from core.financials import PaymentService, creditService
from core.inventory import offcutLedger as ledger
from core.inventory.products import service as products_service, model as products_model
from core.invoices import service as invoice_service, model as invoice_model
from core.ordering import model, orderService, orderItemService, windowService, windowModel as wm
from core.settings.service import set_cancel_pin

failures = T.failures


class Staff:
    # userId as a string, like the real TokenData from the JWT (see test_sale_windows.FakeUser).
    def __init__(self, user, role):
        self.userId, self.role, self.username = str(user.userId), role, user.username


def cashier(u): return Staff(u, "cashier")


def frozen(u):
    """A plain copy of a user row, safe to hand to another thread (an ORM instance is bound
    to the main session, which is not thread-safe)."""
    from types import SimpleNamespace
    return SimpleNamespace(userId=str(u.userId), username=u.username)
def manager(u): return Staff(u, "manager")
def ceo(u): return Staff(u, "ceo")


# ── Seeding ───────────────────────────────────────────────────────────────────

def seed_simple(db, cat, name, stock_qty):
    p = Product(name=name, category_id=cat.categoryId, stock_quantity=stock_qty, track_offcuts=False,
                has_variants=True, unit="pcs")
    db.add(p); db.flush()
    v = Variant(product_id=p.productId, name="", attributes={}, stock_quantity=stock_qty, price=40.0)
    db.add(v); db.commit()
    return p, v


def seed_boxed(db, cat, name, boxes, box=100, mode="counted"):
    qty = boxes * box if mode == "counted" else boxes
    p = Product(name=name, category_id=cat.categoryId, stock_quantity=qty, track_offcuts=False,
                has_variants=True, unit="pcs", unit_stock_mode=mode)
    db.add(p); db.flush()
    v = Variant(product_id=p.productId, name=f"Box of {box}", attributes={}, stock_quantity=qty,
                price=150.0, price_unit=2.0, unit_quantity=box)
    db.add(v); db.commit()
    return p, v


def loose(db, product):
    db.expire_all()
    rows = db.exec(select(Offcut).where(Offcut.product_id == product.productId, Offcut.width.is_(None))).all()
    return int(sum(r.length for r in rows))


def plain(product, variant, qty):
    return model.OrderItemRequest(productId=product.productId, variantId=variant.variantId,
                                  quantity=qty, unitPrice=40.0, unitType="pcs", details={})


def lines_item(product, variant, lines):
    return item(product, variant, lines)


def as_requests(win_resp):
    """What the frontend will send back after loading a window: the stored details,
    engine bookkeeping and all."""
    return [model.OrderItemRequest(productId=i.productId, variantId=i.variantId, quantity=i.quantity,
                                   unitPrice=i.unitPrice, unitType=i.unitType, details=dict(i.details or {}))
            for i in win_resp.items]


def fresh(db, user, win_id):
    return windowService.get_window(db, win_id, cashier(user))


def total_length(db, product, variant):
    """Bar material in feet: whole bars plus every offcut (public or held)."""
    db.expire_all()
    rows = db.exec(select(Offcut).where(Offcut.product_id == product.productId)).all()
    return round(db.get(Variant, variant.variantId).stock_quantity * T.FULL_BAR
                 + sum(r.length * r.quantity for r in rows), 3)


def backdate(db, window_id, minutes):
    db.exec(text("UPDATE sale_windows SET last_activity_at = LOCALTIMESTAMP - make_interval(mins => :m) "
                 "WHERE window_id = :w").bindparams(m=minutes, w=window_id))
    db.commit()


# ── M. Global invariants ──────────────────────────────────────────────────────

def invariants(db, where):
    db.expire_all()
    bad = []
    neg = db.exec(text("SELECT count(*) FROM variants WHERE stock_quantity < 0")).first()[0]
    if neg: bad.append(f"{neg} variant(s) with negative stock")
    neg = db.exec(text("SELECT count(*) FROM offcuts WHERE quantity < 0 OR length < 0")).first()[0]
    if neg: bad.append(f"{neg} offcut row(s) negative")
    stray = db.exec(text('''
        SELECT count(*) FROM offcuts oc
        LEFT JOIN sale_windows w ON w.order_id = oc.held_by_order_id
        WHERE oc.held_by_order_id IS NOT NULL AND (w.window_id IS NULL OR w.closed_at IS NOT NULL)
    ''')).first()[0]
    if stray: bad.append(f"{stray} offcut row(s) held by a closed/no window")
    held_orders = db.exec(text('''
        SELECT count(*) FROM orders o LEFT JOIN sale_windows w ON w.order_id = o."orderId"
        WHERE o.status = 'held' AND (w.window_id IS NULL OR w.closed_at IS NOT NULL)
    ''')).first()[0]
    if held_orders: bad.append(f"{held_orders} held order(s) without an open window")
    mismatched = db.exec(text('''
        SELECT count(*) FROM sale_windows w JOIN orders o ON o."orderId" = w.order_id
        WHERE (w.closed_at IS NULL AND o.status <> 'held')
           OR (w.close_reason = 'confirmed' AND (o.status = 'held' OR o.status = 'abandoned' OR o.order_no IS NULL))
           OR (w.close_reason IN ('released', 'expired') AND (o.status <> 'abandoned' OR o.order_no IS NOT NULL))
    ''')).first()[0]
    if mismatched: bad.append(f"{mismatched} window(s) whose order status disagrees with the window")
    numbered = [r[0] for r in db.exec(text("SELECT order_no FROM orders WHERE order_no IS NOT NULL ORDER BY order_no")).all()]
    if numbered and numbered != list(range(numbered[0], numbered[0] + len(numbered))):
        bad.append(f"order numbers not contiguous: {numbered}")
    counter = db.exec(text("SELECT last_no FROM order_number_counter")).first()[0]
    if numbered and counter != numbered[-1]:
        bad.append(f"counter {counter} != highest order_no {numbered[-1]}")
    live_on_dead = db.exec(text('''
        SELECT count(*) FROM offcut_pieces p JOIN orders o ON o."orderId" = p.consumed_by_order_id
        WHERE p.state = 'consumed' AND o.status = 'abandoned'
    ''')).first()[0]
    if live_on_dead: bad.append(f"{live_on_dead} piece(s) still consumed by an abandoned window")
    dangling = db.exec(text('''
        SELECT count(*) FROM offcut_pieces p LEFT JOIN offcuts oc ON oc."offcutId" = p.offcut_row_id
        WHERE p.state = 'available' AND p.offcut_row_id IS NOT NULL AND oc."offcutId" IS NULL
    ''')).first()[0]
    if dangling: bad.append(f"{dangling} available piece(s) pointing at a missing offcut row")
    over = db.exec(text('''
        SELECT count(*) FROM (
            SELECT oc."offcutId" FROM offcuts oc JOIN offcut_pieces p
              ON p.offcut_row_id = oc."offcutId" AND p.state = 'available'
            WHERE oc.width IS NOT NULL OR oc.length > 0
            GROUP BY oc."offcutId", oc.quantity HAVING count(*) > oc.quantity
        ) t
    ''')).first()[0]
    if over: bad.append(f"{over} offcut row(s) with more available pieces than their quantity")
    # The ledger's cached states must agree with its event log.
    drift = 0
    for pid, state in db.exec(text("SELECT piece_id, state FROM offcut_pieces")).all():
        if ledger.rebuild_piece_state(db, pid) != state:
            drift += 1
    db.rollback()
    if drift: bad.append(f"{drift} ledger piece(s) whose cached state disagrees with the event log")
    check(f"invariants after {where}", bad, [])


# ── A. Every line type ────────────────────────────────────────────────────────

def test_line_types(db, cat, alice, bob):
    print("\nA. Every line type is held, and released exactly")
    bar_p, bar_v = T.seed_product(db, cat, "M Bar", kind="bar", stock=10)
    wa = open_w(db, alice)
    wa = set_cart(db, alice, wa, [
        full(bar_p, bar_v, 2),
        lines_item(bar_p, bar_v, [{"type": "profile-half", "qty": 1, "meta": {}, "rate": 60.0}]),
        cut(bar_p, bar_v, 5.0, qty=2),
    ])
    check("full x2 + half + 2x5ft: 2 bars + 1 bar for the half (10.5 left) + the cuts from it",
          stock(db, bar_v), 7)
    check("material is conserved while held (21ft x 10)", total_length(db, bar_p, bar_v) + 2 * 21 + 10.5 + 10, 210.0)
    release(db, alice, wa)
    check("bars: all 10 back, no offcuts left", (stock(db, bar_v), pool(db, bar_p)), (10, []))

    simple_p, simple_v = seed_simple(db, cat, "M Plain", 9)
    wa = open_w(db, alice)
    wa = set_cart(db, alice, wa, [plain(simple_p, simple_v, 4)])
    check("item with no lineItems: 4 of 9 held", stock(db, simple_v), 5)
    expect_http("...a 6 on top is refused", 422, set_cart, db, bob, open_w(db, bob), [plain(simple_p, simple_v, 6)])
    release(db, alice, wa)
    check("...all 9 back", stock(db, simple_v), 9)
    T.close_all(db)

    box_p, box_v = seed_boxed(db, cat, "M Screws", boxes=3)
    wa, wb = open_w(db, alice), open_w(db, bob)
    wa = set_cart(db, alice, wa, [lines_item(box_p, box_v, [{"type": "accessory-unit", "qty": 1, "meta": {}, "rate": 150.0}])])
    check("a whole pack: 100 pieces sealed away", stock(db, box_v), 200)
    wb = set_cart(db, bob, wb, [lines_item(box_p, box_v, [{"type": "accessory-pcs", "qty": 30, "meta": {}, "rate": 2.0}])])
    check("30 loose: opens a box, 70 left loose", (stock(db, box_v), loose(db, box_p)), (100, 70))
    wa = set_cart(db, alice, fresh(db, alice, wa.windowId), [
        lines_item(box_p, box_v, [{"type": "accessory-unit", "qty": 1, "meta": {}, "rate": 150.0}]),
        lines_item(box_p, box_v, [{"type": "accessory-pcs", "qty": 50, "meta": {}, "rate": 2.0}])])
    check("another window's 50 loose come from B's leftover", (stock(db, box_v), loose(db, box_p)), (100, 20))
    release(db, bob, wb)
    check("B released after A drew its leftover: no phantom box, pieces conserved",
          stock(db, box_v) + loose(db, box_p), 300 - 100 - 50)
    release(db, alice, wa)
    check("both released: all 300 pieces accounted for", stock(db, box_v) + loose(db, box_p), 300)

    oc_p, oc_v = seed_boxed(db, cat, "M Rubber", boxes=2, box=50, mode="open_container")
    wa = open_w(db, alice)
    e = expect_http("open-container sale with no pack open -> refused", 422, set_cart, db, alice, wa,
                    [lines_item(oc_p, oc_v, [{"type": "accessory-pcs", "qty": 3, "meta": {}, "rate": 2.0}])])
    check("  ...saying a pack must be opened", "open pack" in str(e.detail) if e else False, True)
    pack = OpenContainer(product_id=oc_p.productId, variant_id=oc_v.variantId, pool_key="", status="open",
                         nominal_quantity=50)
    db.add(pack); db.commit()
    wa = set_cart(db, alice, fresh(db, alice, wa.windowId),
                  [lines_item(oc_p, oc_v, [{"type": "accessory-pcs", "qty": 3, "meta": {}, "rate": 2.0}])])
    db.refresh(pack)
    check("open-container: tallied against the pack, sealed packs untouched", (pack.units_sold, stock(db, oc_v)), (3.0, 2))
    release(db, alice, wa)
    db.refresh(pack)
    check("  ...release takes the tally back", pack.units_sold, 0.0)

    g_p, g_v = T.seed_product(db, cat, "M Glass", kind="glass", stock=4)
    wa = open_w(db, alice)
    wa = set_cart(db, alice, wa, [item(g_p, g_v, [
        {"type": "glass-cut", "qty": 2, "meta": {"l": 600, "w": 900, "u": "mm", "area": 5.8}, "rate": 12.0},
        {"type": "glass-cut", "qty": 1, "meta": {"l": 1000, "w": 800, "u": "mm", "area": 8.6}, "rate": 12.0}]),
        lines_item(g_p, g_v, [{"type": "sheet-half", "qty": 1, "meta": {"halfSide": "width"}, "rate": 60.0}])])
    check("glass: 3 cuts + a half sheet held", stock(db, g_v) < 4, True)
    check("  ...every glass remainder private", pool(db, g_p), [])
    release(db, alice, wa)
    check("  ...release: all 4 sheets back, nothing left over", (stock(db, g_v), pool(db, g_p)), (4, []))
    T.close_all(db)
    invariants(db, "A")


# ── B. Cart round-trips ───────────────────────────────────────────────────────

def test_round_trips(db, cat, alice, bob):
    print("\nB. Cart round-trips and material-neutral changes")
    p, v = T.seed_product(db, cat, "RT Bar", kind="bar", stock=10)
    wa = open_w(db, alice)
    wa = set_cart(db, alice, wa, [cut(p, v, 5.0), full(p, v, 1)])
    ids = [i.itemId for i in wa.items]
    base = (stock(db, v), pool(db, p, held=wa.orderId))

    wa2 = set_cart(db, alice, wa, as_requests(wa))
    check("sending the loaded cart back unchanged moves nothing", (stock(db, v), pool(db, p, held=wa.orderId)), base)
    check("  ...keeps the same rows", [i.itemId for i in wa2.items], ids)
    check("  ...but bumps the version", wa2.version, wa.version + 1)

    reqs = as_requests(wa2)
    for r in reqs:
        for line in r.details.get("lineItems", []):
            line["rate"] = 999.0
    wa3 = set_cart(db, alice, wa2, reqs)
    check("price-only change moves nothing", ([i.itemId for i in wa3.items], stock(db, v)), (ids, base[0]))

    wa4 = set_cart(db, alice, wa3, list(reversed(as_requests(wa3))))
    check("reordering moves nothing but the positions",
          ([i.itemId for i in wa4.items], stock(db, v)), (list(reversed(ids)), base[0]))

    wa5 = set_cart(db, alice, wa4, as_requests(wa4), customerName="Ali", VAT_status=True, discount=50.0)
    # full 1 x 100 + 5ft x 50 = 350; less 50 = 300; +16% VAT = 348
    check("customer/VAT/discount change: totals recomputed, no stock moved",
          (wa5.customerName, wa5.subtotal, wa5.total, stock(db, v)), ("Ali", 300.0, 348.0, base[0]))

    reqs = as_requests(wa5)
    changed = cut(p, v, 7.0)
    wa6 = set_cart(db, alice, wa5, [changed if "cut" in (r.details["lineItems"][0]["type"]) else r for r in reqs])
    check("one line changed with stale bookkeeping on the rest: re-resolved correctly (1 bar cut + 1 full)",
          (stock(db, v), pool(db, p, held=wa6.orderId)), (8, [(14.0, 0, 0, 1)]))

    wa7 = set_cart(db, alice, wa6, [])
    check("empty cart: everything back, window stays open",
          (stock(db, v), pool(db, p, held=wa7.orderId), wa7.total, len(windowService.list_my_windows(db, cashier(alice))) >= 1),
          (10, [], 0.0, True))
    wa8 = set_cart(db, alice, wa7, [full(p, v, 3)])
    check("  ...and it can be refilled", stock(db, v), 7)

    before = stock(db, v)
    expect_http("a cart that can't be filled -> 422", 422, set_cart, db, alice, wa8, [full(p, v, 50)])
    after = fresh(db, alice, wa8.windowId)
    check("  ...leaves the previous cart, stock and version exactly as they were",
          (stock(db, v), len(after.items), after.version), (before, 1, wa8.version))
    T.close_all(db)
    invariants(db, "B")


# ── C. Money ──────────────────────────────────────────────────────────────────

def test_money(db, cat, alice, bob):
    print("\nC. Money: payments, credit, balances, reports")
    p, v = T.seed_product(db, cat, "Money Bar", kind="bar", stock=20)
    cust = Customer(name="Registered Ltd", phoneNumber=f"07{uuid.uuid4().int % 10**8:08d}", type="individual")
    db.add(cust); db.commit()

    wa = open_w(db, alice)
    wa = set_cart(db, alice, wa, [full(p, v, 1), cut(p, v, 5.0)], customerId=cust.customerId, VAT_status=True, discount=50.0)
    check("held window carries a balance...", wa.total, 348.0)
    owing = [o.orderId for o in orderService.get_orders_with_balance(db)]
    check("  ...but is NOT in Collect Payments", wa.orderId in owing, False)
    check("  ...nor a debt (no credit row until it is confirmed)",
          db.exec(select(Credit).where(Credit.orderId == wa.orderId)).first(), None)
    expect_http("  ...and can't be paid against", 404, PaymentService.record_payment, wa.orderId, 10.0, "cash", db, manager(alice))
    summary_before = PaymentService.get_financial_summary("day", None, db)
    check("  ...and isn't counted in the day's report", "held" in summary_before.status_counts, False)

    res = confirm(db, alice, wa, paid=100.0)
    db.expire_all()
    order = db.get(Order, res.orderId)
    check("partial payment: Partial, balance 248", (order.payment_status, order.balance), ("Partial", 248.0))
    cred = db.exec(select(Credit).where(Credit.orderId == res.orderId)).first()
    check("  ...a credit row for the registered customer", (cred.amount_due, cred.status) if cred else None, (248.0, "Partially Paid"))
    check("  ...now in Collect Payments", res.orderId in [o.orderId for o in orderService.get_orders_with_balance(db)], True)
    PaymentService.record_payment(res.orderId, 248.0, "mpesa", db, manager(alice))
    db.expire_all()
    check("  ...and the debt can be paid off as for any order", db.get(Order, res.orderId).payment_status, "Paid")

    wb = open_w(db, bob)
    wb = set_cart(db, bob, wb, [full(p, v, 1)], customerName="Walk In")
    res = confirm(db, bob, wb, paid=0.0)
    db.expire_all()
    order = db.get(Order, res.orderId)
    check("walk-in, nothing paid: Unpaid, full balance, no credit row",
          (order.payment_status, order.balance, db.exec(select(Credit).where(Credit.orderId == res.orderId)).first()),
          ("Unpaid", 100.0, None))
    check("  ...no payment row for a zero payment", db.exec(select(Payment).where(Payment.orderId == res.orderId)).all(), [])

    wc = open_w(db, bob)
    wc = set_cart(db, bob, wc, [full(p, v, 1)])
    res = windowService.confirm_window(db, wc.windowId, cashier(bob), wm.WindowConfirmRequest(
        version=wc.version, idempotencyKey=uuid.uuid4().hex, amountPaid=120.0, paymentMethod="split",
        paymentDetails={"cash": 70.0, "mpesa": 50.0}))
    db.expire_all()
    order = db.get(Order, res.orderId)
    pay = db.exec(select(Payment).where(Payment.orderId == res.orderId)).one()
    check("overpaid: Paid with no balance", (order.payment_status, order.balance), ("Paid", 0.0))
    check("  ...split recorded with its breakdown", (pay.payment_method, pay.payment_details), ("split", {"cash": 70.0, "mpesa": 50.0}))

    wd = open_w(db, bob)
    wd = set_cart(db, bob, wd, [full(p, v, 1)])
    windowService.confirm_window(db, wd.windowId, cashier(bob), wm.WindowConfirmRequest(
        version=wd.version, idempotencyKey=uuid.uuid4().hex, amountPaid=10.0, paymentMethod="bitcoin"))
    pay = db.exec(select(Payment).join(Order, Order.orderId == Payment.orderId)
                  .where(Order.orderId == wd.orderId)).one()
    check("unknown payment method falls back to cash (as checkout does)", pay.payment_method, "cash")

    we = open_w(db, bob); we = set_cart(db, bob, we, [full(p, v, 1)]); release(db, bob, we)
    summary = PaymentService.get_financial_summary("day", None, db)
    check("report: abandoned and held windows never counted",
          ("held" in summary.status_counts, "abandoned" in summary.status_counts), (False, False))
    T.close_all(db)
    invariants(db, "C")


# ── D. Invoices and numbering on every path ───────────────────────────────────

def new_invoice(db, user, number):
    inv = Invoice(invoice_number=number, created_by=user.userId, items=[], status="draft",
                  subtotal=0.0, total=0.0)
    db.add(inv); db.commit()
    return inv


def counter(db):
    return db.exec(text("SELECT last_no FROM order_number_counter")).first()[0]


def test_invoices_and_numbering(db, cat, alice, bob):
    print("\nD. Invoices through a window; order numbers on every creation path")
    p, v = T.seed_product(db, cat, "Inv Bar", kind="bar", stock=20)
    inv = new_invoice(db, alice, "INV-W-1")
    wa, wb = open_w(db, alice), open_w(db, bob)
    wa = set_cart(db, alice, wa, [full(p, v, 1)], sourceInvoiceId=inv.invoiceId)
    wb = set_cart(db, bob, wb, [full(p, v, 1)], sourceInvoiceId=inv.invoiceId)
    res = confirm(db, alice, wa)
    db.expire_all()
    inv = db.get(Invoice, inv.invoiceId)
    check("confirming converts the invoice and links it", (inv.status, inv.order_id), ("converted", res.orderId))
    n = counter(db)
    expect_http("a second window converting the same invoice -> refused", 400, confirm, db, bob, wb)
    check("  ...without using up an order number", counter(db), n)
    check("  ...and the window is still open with its bar held (20 - A's - B's)",
          (fresh(db, bob, wb.windowId).windowId, stock(db, v)), (wb.windowId, 18))
    release(db, bob, wb)

    direct = orderService.create_order(model.OrderCreate(
        servedBy=alice.userId, paymentStatus="Unpaid", status="confirmed",
        items=[full(p, v, 1)]), db, cashier(alice))
    check("direct checkout (POST /orders) gets the next number", direct.orderNo, n + 1)
    expect_http("POST /orders can't create a held order", 422, orderService.create_order, model.OrderCreate(
        servedBy=alice.userId, paymentStatus="Unpaid", status="held", items=[]), db, cashier(alice))
    expect_http("  ...nor an abandoned one", 422, orderService.create_order, model.OrderCreate(
        servedBy=alice.userId, paymentStatus="Unpaid", status="abandoned", items=[]), db, cashier(alice))

    inv2 = new_invoice(db, alice, "INV-W-2")
    conv = invoice_service.convert_invoice_to_order(inv2.invoiceId, invoice_model.InvoiceConvertRequest(), str(alice.userId), db)
    db.expire_all()
    check("invoice conversion path gets the next number", db.get(Order, conv.orderId).order_no, n + 2)
    check("order responses carry orderNo", orderService.get_order_by_orderId(direct.orderId, db).orderNo, n + 1)
    T.close_all(db)
    invariants(db, "D")


# ── E. Every order operation refuses a held / abandoned window ────────────────

def test_blocked_operations(db, cat, alice, bob):
    print("\nE. Order operations refuse held and abandoned windows")
    p, v = T.seed_product(db, cat, "Block Bar", kind="bar", stock=10)
    set_cancel_pin(db, "4321", manager(alice))
    held = open_w(db, alice)
    held = set_cart(db, alice, held, [cut(p, v, 5.0)], customerName="Blocked")
    gone = open_w(db, alice)
    gone = set_cart(db, alice, gone, [cut(p, v, 4.0)])
    release(db, alice, gone)
    mgr = manager(alice)
    edit_req = model.OrderEditRequest(servedBy=alice.userId, paymentStatus="Unpaid", items=[])
    held_item = held.items[0].itemId

    for label, oid in (("held", held.orderId), ("abandoned", gone.orderId)):
        expect_http(f"{label}: GET /orders/{{id}}", 404, orderService.get_order_by_orderId, oid, db)
        expect_http(f"{label}: manager edit", 404, orderService.update_order, oid, edit_req, db, mgr)
        expect_http(f"{label}: cancel with PIN", 404, orderService.cancel_order_with_pin, oid, "4321", db, mgr)
        expect_http(f"{label}: workflow status", 404, orderService.update_order_status, oid, "ready", db, mgr)
        expect_http(f"{label}: record payment", 404, PaymentService.record_payment, oid, 5.0, "cash", db, mgr)
        expect_http(f"{label}: reversal plan", 404, orderService.get_reversal_plan, oid, db, mgr)
        expect_http(f"{label}: glass offcut correction", 404, orderService.correct_offcut_for_order_item,
                    oid, held_item, 0, 0, [], [], None, None, db, mgr)
        expect_http(f"{label}: profile offcut correction", 404, orderService.correct_profile_offcut_for_order_item,
                    oid, held_item, 0, 0, 1.0, False, None, None, db, mgr)
        expect_http(f"{label}: order items", 404, orderItemService.get_orderItems_by_orderId, oid, db)
        expect_http(f"{label}: mark this order cut", 404, orderService.mark_cutting_complete_for_order, oid, db, mgr)
        check(f"{label}: batch 'orders cut' skips it",
              orderService.mark_cutting_complete_for_orders_batch([oid], db, mgr)["updated_items"], [])

    check("held: batch 'items cut' skips its items", orderService.mark_cutting_complete_batch([held_item], db, mgr)["updated"], [])
    db.expire_all()
    check("  ...the item really is still uncut (it is cut after payment)", db.get(OrderItem, held_item).cutting_completed, False)

    real = confirm(db, bob, set_cart(db, bob, open_w(db, bob), [full(p, v, 1)], customerName="Real"))
    expect_http("a real order can't be moved to 'held'", 400, orderService.update_order_status, real.orderId, "held", db, mgr)
    expect_http("  ...or 'abandoned'", 400, orderService.update_order_status, real.orderId, "abandoned", db, mgr)

    hidden = {held.orderId, gone.orderId}
    uid = alice.userId
    listings = {
        "all orders": orderService.get_all_orders(db, 0, 500),
        "by served-by": orderService.get_orders_by_servedby(uid, db, 0, 100),
        "today": orderService.get_orders_for_certain_day(db.exec(text("SELECT CURRENT_DATE")).first()[0].isoformat(), db),
        "VAT-excluded period": orderService.get_orders_for_period_vatExcluded("2000-01-01", "2100-01-01", db, 0, 100),
        "VAT included (all)": orderService.getAll_orders_VatIncluded(db),
        "cutting queue": [type("o", (), {"orderId": o["orderId"]}) for o in orderService.get_pending_cutting_orders(db, mgr, 0, 500)],
    }
    for name, rows in listings.items():
        check(f"'{name}' never lists a window", hidden & {r.orderId for r in rows}, set())
    check("the confirmed order does show in 'all orders'", real.orderId in {r.orderId for r in listings["all orders"]}, True)
    T.close_all(db)
    invariants(db, "E")


# ── F. The confirmed order's later life ───────────────────────────────────────

def cancel_not_cut(db, order_id, user):
    """Cancel as the cancel screen does: answer 'not cut' for every line the plan asks about."""
    from core.inventory import reversalPlan as rp
    plan = orderService.get_reversal_plan(order_id, db, manager(user))
    answers = {l["line_ref"]: {"physicalState": rp.PHYS_NOT_CUT} for l in plan["lines"]}
    return orderService.cancel_order_with_pin(order_id, "4321", db, manager(user),
                                              cut_confirmations=answers, plan_token=plan.get("plan_token"))


def test_after_confirm(db, cat, alice, bob):
    print("\nF. After confirming: timestamps, edits, cancel, abandoned windows never block")
    p, v = T.seed_product(db, cat, "After Bar", kind="bar", stock=10)
    wa = open_w(db, alice)
    wa = set_cart(db, alice, wa, [cut(p, v, 5.0)], customerName="Later")
    db.exec(text('UPDATE orders SET created_at = created_at - interval \'2 days\' WHERE "orderId" = :o').bindparams(o=wa.orderId))
    db.commit()
    res = confirm(db, alice, fresh(db, alice, wa.windowId))
    db.expire_all()
    age = db.exec(text('SELECT LOCALTIMESTAMP - created_at FROM orders WHERE "orderId" = :o').bindparams(o=res.orderId)).first()[0]
    check("the order is dated when it was confirmed, not when the window opened", age.total_seconds() < 60, True)

    loaded = orderService.get_order_by_orderId(res.orderId, db)
    reqs = [model.OrderItemRequest(productId=i.productId, variantId=i.variantId, quantity=i.quantity,
                                   unitPrice=i.unitPrice, unitType=i.unitType, details=dict(i.details or {}))
            for i in loaded.items]
    reqs[0].details["lineItems"][0]["meta"]["length"] = 6.0
    orderService.update_order(res.orderId, model.OrderEditRequest(servedBy=alice.userId, paymentStatus="Unpaid",
                                                                   customerName="Later", items=reqs), db, manager(alice))
    check("manager can edit it like any order (5ft -> 6ft, same bar)", (stock(db, v), pool(db, p)), (9, [(15.0, 0, 0, 1)]))
    cancel_not_cut(db, res.orderId, alice)
    check("cancelling it recombines the bar", (stock(db, v), pool(db, p)), (10, []))

    # An abandoned window that cut into a confirmed order's remainder must not block that order later.
    o = confirm(db, alice, set_cart(db, alice, open_w(db, alice), [cut(p, v, 5.0)]))
    check("confirmed order O leaves a public 16ft", pool(db, p), [(16.0, 0, 0, 1)])
    ww = set_cart(db, bob, open_w(db, bob), [cut(p, v, 4.0)])
    check("window W cuts its 4ft from O's public 16ft (no new bar)", (stock(db, v), pool(db, p, held=ww.orderId)), (9, [(12.0, 0, 0, 1)]))
    release(db, bob, ww)
    check("W abandoned: the 16ft is back", pool(db, p), [(16.0, 0, 0, 1)])
    cancel_not_cut(db, o.orderId, alice)
    check("cancelling O afterwards still recombines the whole bar", (stock(db, v), pool(db, p)), (10, []))

    # While W is still open it DOES hold part of O's bar; cancelling O then credits only O's cut.
    o = confirm(db, alice, set_cart(db, alice, open_w(db, alice), [cut(p, v, 5.0)]))
    ww = set_cart(db, bob, open_w(db, bob), [cut(p, v, 4.0)])
    cancel_not_cut(db, o.orderId, alice)
    check("O cancelled while W holds part of its bar: no bar comes back (it is shared)", stock(db, v), 9)
    release(db, bob, ww)
    check("  ...and after W closes all 210ft of material is still accounted for", total_length(db, p, v), 210.0)
    T.close_all(db)
    invariants(db, "F")


# ── G. Offcut endpoints ───────────────────────────────────────────────────────

def test_offcut_endpoints(db, cat, alice, bob):
    print("\nG. Offcut listing, picker scope, CEO edit/delete, glass preview")
    p, v = T.seed_product(db, cat, "Endpoint Bar", kind="bar", stock=10)
    wa = set_cart(db, alice, open_w(db, alice), [cut(p, v, 5.0)])
    held_row = db.exec(select(Offcut).where(Offcut.held_by_order_id == wa.orderId)).one()
    ceo_u = ceo(alice)

    listed = {r.offcutId for r in products_service.list_all_offcuts(db, ceo_u)}
    check("CEO offcut screen doesn't list a held remainder", held_row.offcutId in listed, False)
    expect_http("CEO can't edit a held remainder", 409, products_service.update_offcut_admin, held_row.offcutId,
                products_model.OffcutAdminUpdate(quantity=2), db, ceo_u)
    expect_http("CEO can't delete a held remainder", 409, products_service.bulk_delete_offcuts, [held_row.offcutId], db, ceo_u)

    public = {o.offcutId for o in products_service.get_offcuts_for_product(p.productId, db, v.variantId)}
    own = {o.offcutId for o in products_service.get_offcuts_for_product(p.productId, db, v.variantId, wa.orderId)}
    check("picker, public: no held remainder", held_row.offcutId in public, False)
    check("picker, in A's window: A's remainder offered", held_row.offcutId in own, True)
    check("ownership check: own open window accepted",
          windowService.require_own_held_order(db, wa.orderId, cashier(alice)), wa.orderId)
    check("ownership check: no window -> no scope", windowService.require_own_held_order(db, None, cashier(alice)), None)
    expect_http("ownership check: someone else's window refused", 404, windowService.require_own_held_order,
                db, wa.orderId, cashier(bob))
    expect_http("ownership check: a real order's id refused", 404, windowService.require_own_held_order,
                db, confirm(db, bob, set_cart(db, bob, open_w(db, bob), [full(p, v, 1)])).orderId, cashier(bob))

    pick = [{"offcut_id": held_row.offcutId, "length_used": 4.0}]
    wa2 = set_cart(db, alice, wa, [cut(p, v, 5.0), cut(p, v, 4.0, selection=pick)])
    check("A can hand-pick its own held remainder", (stock(db, v), pool(db, p, held=wa.orderId)), (8, [(12.0, 0, 0, 1)]))
    expect_http("B can't hand-pick A's held remainder", 422, set_cart, db, bob, open_w(db, bob),
                [cut(p, v, 4.0, selection=[{"offcut_id": pool_row_id(db, wa.orderId), "length_used": 4.0}])])
    release(db, alice, wa2)
    expect_http("ownership check: a closed window refused", 404, windowService.require_own_held_order,
                db, wa.orderId, cashier(alice))
    T.close_all(db)

    g_p, g_v = T.seed_product(db, cat, "Endpoint Glass", kind="glass", stock=3)
    wg = set_cart(db, alice, open_w(db, alice), [glass(g_p, g_v, 1000, 1830)])
    cuts = [products_model.GlassCutPreviewCut(l=800, w=1000, qty=1, u="mm")]
    pub = products_service.preview_glass_cuts(g_p.productId, cuts, db, g_v.variantId)
    mine = products_service.preview_glass_cuts(g_p.productId, cuts, db, g_v.variantId, wg.orderId)
    check("glass preview (public) would open a fresh sheet", [g["source"] for g in pub["groups"]], ["sheet"])
    check("glass preview in A's window uses A's own remainder", [g["source"] for g in mine["groups"]], ["offcut"])
    check("  ...and previews change nothing", (stock(db, g_v), len(pool(db, g_p, held=wg.orderId)) > 0), (2, True))
    T.close_all(db)
    invariants(db, "G")


def pool_row_id(db, order_id):
    return db.exec(select(Offcut.offcutId).where(Offcut.held_by_order_id == order_id)).first()


# ── H. Expiry ─────────────────────────────────────────────────────────────────

def test_expiry(db, cat, alice, bob):
    print("\nH. Expiry")
    p, v = T.seed_product(db, cat, "Expiry Bar", kind="bar", stock=10)
    wa = open_w(db, alice)
    check("a fresh window has ~15 minutes left", 890 <= wa.secondsLeft <= 900, True)
    wa = set_cart(db, alice, wa, [cut(p, v, 5.0)])

    backdate(db, wa.windowId, 16)
    windowService.touch_window(db, wa.windowId, cashier(alice))
    check("touching an idle window restarts its clock (not expired)", windowService.expire_idle_windows(), 0)
    check("  ...secondsLeft back near 900", fresh(db, alice, wa.windowId).secondsLeft >= 890, True)

    backdate(db, wa.windowId, 14)
    check("14 minutes idle: not expired", windowService.expire_idle_windows(), 0)
    backdate(db, wa.windowId, 16)
    check("  ...secondsLeft reads 0 once past due", fresh(db, alice, wa.windowId).secondsLeft, 0)

    with Session(engine) as other:
        other.exec(select(SaleWindow).where(SaleWindow.window_id == wa.windowId).with_for_update()).one()
        t0 = time.time()
        n = windowService.expire_idle_windows()
        check("a window the cashier is acting on right now is skipped, not waited on",
              (n, time.time() - t0 < 5), (0, True))
        other.rollback()
    check("  ...and expired on the next sweep", windowService.expire_idle_windows(), 1)

    check("expired: its stock is back", (stock(db, v), pool(db, p), pool(db, p, held=wa.orderId)), (10, [], []))
    check("expired: gone from the cashier's list", wa.windowId in [w.windowId for w in windowService.list_my_windows(db, cashier(alice))], False)
    expect_http("expired: cart write -> 410", 410, set_cart, db, alice, wa, [full(p, v, 1)])
    expect_http("expired: confirm -> 410", 410, confirm, db, alice, wa)
    expect_http("expired: touch -> 410", 410, windowService.touch_window, db, wa.windowId, cashier(alice))
    expect_http("expired: get -> 410", 410, windowService.get_window, db, wa.windowId, cashier(alice))
    check("expired: release is harmless", release(db, alice, wa).windowId, wa.windowId)
    check("expired: nothing given back twice", stock(db, v), 10)

    ws = [open_w(db, alice) for _ in range(3)]
    backdate(db, ws[0].windowId, 20)
    windowService.expire_idle_windows()
    check("an expired window frees a slot under the 3-window limit", open_w(db, alice).label, ws[0].label)
    check("an empty idle window expires too (nothing to give back)",
          db.get(SaleWindow, ws[0].windowId).close_reason, "expired")
    T.close_all(db)
    invariants(db, "H")


# ── I. State machine ──────────────────────────────────────────────────────────

def test_state_machine(db, cat, alice, bob):
    print("\nI. Every action on every closed state")
    p, v = T.seed_product(db, cat, "State Bar", kind="bar", stock=10)

    rel = set_cart(db, alice, open_w(db, alice), [full(p, v, 1)])
    release(db, alice, rel)
    check("released: releasing again is harmless", release(db, alice, rel).windowId, rel.windowId)
    check("  ...and gives nothing back twice", stock(db, v), 10)
    expect_http("released: confirm -> 410", 410, confirm, db, alice, rel)
    expect_http("released: cart -> 410", 410, set_cart, db, alice, rel, [full(p, v, 1)])
    e = expect_http("released: get -> 410", 410, windowService.get_window, db, rel.windowId, cashier(alice))
    check("  ...saying released", (e.detail or {}).get("closeReason") if e else None, "released")

    con = set_cart(db, alice, open_w(db, alice), [full(p, v, 1)])
    stale = con
    con = set_cart(db, alice, con, [full(p, v, 2)])
    n = counter(db)
    expect_http("confirm with a stale version -> 409", 409, confirm, db, alice, stale)
    check("  ...no number used, no payment", (counter(db), db.exec(select(Payment).where(Payment.orderId == con.orderId)).all()), (n, []))
    confirm(db, alice, con)
    e = expect_http("confirmed: release -> 410", 410, release, db, alice, con)
    check("  ...saying which order it became", "order #" in str((e.detail or {}).get("message")) if e else False, True)
    expect_http("confirmed: cart -> 410", 410, set_cart, db, alice, con, [])
    expect_http("confirmed: touch -> 410", 410, windowService.touch_window, db, con.windowId, cashier(alice))

    mine = open_w(db, alice)
    for label, fn, args in (("get", windowService.get_window, (db, mine.windowId, cashier(bob))),
                            ("touch", windowService.touch_window, (db, mine.windowId, cashier(bob))),
                            ("cart", set_cart, (db, bob, mine, [])),
                            ("confirm", confirm, (db, bob, mine)),
                            ("release", release, (db, bob, mine))):
        expect_http(f"another cashier: {label} -> 404", 404, fn, *args)
    expect_http("a window id that doesn't exist -> 404", 404, windowService.get_window, db, 999999, cashier(alice))
    check("another cashier's list doesn't show it", mine.windowId in [w.windowId for w in windowService.list_my_windows(db, cashier(bob))], False)
    T.close_all(db)
    invariants(db, "I")


# ── J. Concurrency ────────────────────────────────────────────────────────────

def parallel(*fns):
    barrier = threading.Barrier(len(fns))
    out = [None] * len(fns)

    def run(i, fn):
        with Session(engine) as s:
            barrier.wait()
            try:
                out[i] = ("ok", fn(s))
            except HTTPException as e:
                out[i] = (e.status_code, e.detail)
            except Exception as e:  # anything else is a bug: a 500, a deadlock that escaped
                out[i] = ("CRASH", repr(e))

    threads = [threading.Thread(target=run, args=(i, fn)) for i, fn in enumerate(fns)]
    for t in threads: t.start()
    for t in threads: t.join()
    return out


def codes(out):
    return sorted(str(o[0]) for o in out)


def test_concurrency(db, cat, alice, bob):
    print("\nJ. Concurrency")
    alice, bob = frozen(alice), frozen(bob)
    p, v = T.seed_product(db, cat, "Conc Bar", kind="bar", stock=20)
    q, w = T.seed_product(db, cat, "Conc Bar 2", kind="bar", stock=20)

    wa = open_w(db, alice)
    out = parallel(lambda s: set_cart(s, alice, wa, [full(p, v, 1)]), lambda s: set_cart(s, alice, wa, [full(p, v, 2)]))
    check("two tabs saving the same window at once: one wins, one gets 409", codes(out), ["409", "ok"])
    won = next(o[1] for o in out if o[0] == "ok")
    check("  ...stock matches the winner exactly", stock(db, v), 20 - won.items[0].details["lineItems"][0]["qty"])
    T.close_all(db)

    out = parallel(*[lambda s: windowService.open_window(s, cashier(bob), wm.WindowOpenRequest()) for _ in range(4)])
    check("4 simultaneous opens by one cashier: exactly 3 succeed", codes(out), ["409", "ok", "ok", "ok"])
    check("  ...with distinct labels", sorted(o[1].label for o in out if o[0] == "ok"), ["Window 1", "Window 2", "Window 3"])
    T.close_all(db)

    w1 = set_cart(db, alice, open_w(db, alice), [full(p, v, 1)])
    w2 = set_cart(db, bob, open_w(db, bob), [full(q, w, 1)])
    out = parallel(lambda s: confirm(s, alice, w1), lambda s: confirm(s, bob, w2))
    nums = sorted(o[1].orderNo for o in out if o[0] == "ok")
    check("two simultaneous confirms: both succeed with consecutive numbers", (codes(out), nums[1] - nums[0] if len(nums) == 2 else None), (["ok", "ok"], 1))

    for rnd in range(5):
        x, y = open_w(db, alice), open_w(db, bob)
        out = parallel(lambda s: set_cart(s, alice, x, [full(p, v, 1), full(q, w, 1)]),
                       lambda s: set_cart(s, bob, y, [full(q, w, 1), full(p, v, 1)]))
        if codes(out) != ["ok", "ok"]:
            check(f"opposite product order, round {rnd}: no deadlock/crash", out, "both ok")
            break
        T.close_all(db)
    else:
        check("opposite product order x5: never a deadlock or crash", True, True)
    T.close_all(db)

    base = stock(db, v)
    for rnd in range(3):
        z = set_cart(db, alice, open_w(db, alice), [full(p, v, 1)])
        backdate(db, z.windowId, 20)
        out = parallel(lambda s: set_cart(s, alice, z, [full(p, v, 3)]), lambda s: windowService.expire_idle_windows())
        db.expire_all()
        win = db.get(SaleWindow, z.windowId)
        held = 3 if win.closed_at is None else 0
        check(f"sweeper vs cashier race {rnd}: stock always matches the outcome ({'cart won' if held else 'expiry won'})",
              (stock(db, v), "CRASH" in codes(out)), (base - held, False))
        T.close_all(db)

    z = set_cart(db, alice, open_w(db, alice), [full(p, v, 1)])
    out = parallel(lambda s: confirm(s, alice, z), lambda s: release(s, alice, z))
    check("confirm vs release on the same window: exactly one happens", codes(out), ["410", "ok"])
    db.expire_all()
    win = db.get(SaleWindow, z.windowId)
    check("  ...and stock matches whichever it was", stock(db, v), base - (1 if win.close_reason == "confirmed" else 0))
    T.close_all(db)
    invariants(db, "J")


# ── K. Ledger switched off ────────────────────────────────────────────────────

def test_ledger_off(db, cat, alice, bob):
    print("\nK. Offcut ledger disabled (legacy size-matching path)")
    p, v = T.seed_product(db, cat, "Legacy Bar", kind="bar", stock=10)
    os.environ["OFFCUT_LEDGER_ENABLED"] = "0"
    try:
        wa = set_cart(db, alice, open_w(db, alice), [cut(p, v, 5.0)])
        wa = set_cart(db, alice, wa, [cut(p, v, 5.0), cut(p, v, 4.0)])
        check("held and reused its own remainder", (stock(db, v), pool(db, p, held=wa.orderId)), (9, [(12.0, 0, 0, 1)]))
        wb = set_cart(db, bob, open_w(db, bob), [cut(p, v, 3.0)])
        check("another window still can't touch it", (stock(db, v), pool(db, p, held=wb.orderId)), (8, [(18.0, 0, 0, 1)]))
        release(db, alice, wa)
        release(db, bob, wb)
        check("released: all bars back whole, no offcuts", (stock(db, v), pool(db, p)), (10, []))
    finally:
        os.environ.pop("OFFCUT_LEDGER_ENABLED", None)
    T.close_all(db)
    invariants(db, "K")


# ── L. HTTP layer + sweeper inside the app ────────────────────────────────────

def test_http(db, cat, alice, bob):
    print("\nL. The real HTTP endpoints, and the sweeper running in the app")
    from fastapi.testclient import TestClient
    import main
    from core.userManagement.authService import get_current_user

    p, v = T.seed_product(db, cat, "HTTP Bar", kind="bar", stock=10)
    who = {"u": cashier(alice)}
    main.app.dependency_overrides[get_current_user] = lambda: who["u"]
    main.WINDOW_SWEEP_SECONDS = 1
    body = lambda it: it.model_dump() if hasattr(it, "model_dump") else it.dict()
    try:
        with TestClient(main.app) as c:
            r = c.post("/windows/", json={"deviceId": "till-1"})
            check("POST /windows/ -> 200", r.status_code, 200)
            win = r.json()
            check("  ...response has the countdown", 890 <= win["secondsLeft"] <= 900, True)
            r = c.put(f"/windows/{win['windowId']}/cart", json={"version": win["version"], "items": [body(cut(p, v, 5.0))]})
            check("PUT cart -> 200", r.status_code, 200)
            win2 = r.json()
            r = c.put(f"/windows/{win['windowId']}/cart", json={"version": win["version"], "items": []})
            check("PUT cart, stale version -> 409 with currentVersion", (r.status_code, r.json()["detail"].get("currentVersion")),
                  (409, win2["version"]))
            r = c.put(f"/windows/{win['windowId']}/cart", json={"version": win2["version"], "items": [body(full(p, v, 99))]})
            check("PUT cart, not enough stock -> 422", r.status_code, 422)
            check("GET /windows/ lists it", [w["windowId"] for w in c.get("/windows/").json()], [win["windowId"]])
            check("GET /orders/{held} -> 404", c.get(f"/orders/{win['orderId']}").status_code, 404)
            check("GET offcuts in own window scope -> 200",
                  c.get(f"/products/{p.productId}/offcuts", params={"variant_id": v.variantId, "hold_order_id": win["orderId"]}).status_code, 200)
            r = c.post(f"/products/{p.productId}/cut-feasibility",
                       json={"variant_id": v.variantId, "edit_order_id": win["orderId"],
                             "line_items": [{"type": "profile-cut", "qty": 1, "meta": {"length": 15.0}}]})
            check("cut-feasibility accepts a window's order id", (r.status_code, r.json().get("ok")), (200, True))
            check("POST touch -> 200", c.post(f"/windows/{win['windowId']}/touch").status_code, 200)
            key = uuid.uuid4().hex
            r = c.post(f"/windows/{win['windowId']}/confirm", json={"version": win2["version"], "idempotencyKey": key, "amountPaid": 250})
            check("POST confirm -> 200 with orderNo", (r.status_code, isinstance(r.json().get("orderNo"), int)), (200, True))
            r2 = c.post(f"/windows/{win['windowId']}/confirm", json={"version": win2["version"], "idempotencyKey": key, "amountPaid": 250})
            check("retried confirm over HTTP -> same order", r2.json().get("orderNo"), r.json().get("orderNo"))
            check("confirm with a too-short key -> 422", c.post(f"/windows/{win['windowId']}/confirm",
                  json={"version": 1, "idempotencyKey": "x"}).status_code, 422)
            r = c.get(f"/windows/{win['windowId']}")
            check("GET a confirmed window -> 410 with closeReason", (r.status_code, r.json()["detail"]["closeReason"]), (410, "confirmed"))

            who["u"] = cashier(bob)
            check("another cashier: GET offcuts with alice's window scope -> 404",
                  c.get(f"/products/{p.productId}/offcuts", params={"hold_order_id": win["orderId"]}).status_code, 404)
            check("another cashier: DELETE alice's window -> 404", c.delete(f"/windows/{win['windowId']}").status_code, 404)

            idle = c.post("/windows/", json={}).json()
            c.put(f"/windows/{idle['windowId']}/cart", json={"version": idle["version"], "items": [body(full(p, v, 2))]})
            before = stock(db, v)
            backdate(db, idle["windowId"], 20)
            time.sleep(3.5)
            db.expire_all()
            check("the app's own sweeper expired the idle window within seconds",
                  db.get(SaleWindow, idle["windowId"]).close_reason, "expired")
            check("  ...and gave its 2 bars back", stock(db, v), before + 2)
            r = c.delete(f"/windows/{idle['windowId']}")
            check("DELETE an expired window -> 200 (harmless)", r.status_code, 200)
    finally:
        main.app.dependency_overrides.clear()
        main.WINDOW_SWEEP_SECONDS = 30
    T.close_all(db)
    invariants(db, "L")


def main():
    name = DATABASE_URL.rsplit("/", 1)[-1]
    if name == "EmiratesCo_Database":
        raise SystemExit("Refusing to run against the live database - set DATABASE_URL to emiratesco_edit_test.")
    with Session(engine) as db:
        T.reset(db)
        cat = Category(name="Window Matrix", type="ke-profile", sub_categories=[])
        db.add(cat)
        alice, bob = T.seed_user(db, "win-alice"), T.seed_user(db, "win-bob")
        db.commit()
        for fn in (test_line_types, test_round_trips, test_money, test_invoices_and_numbering,
                   test_blocked_operations, test_after_confirm, test_offcut_endpoints, test_expiry,
                   test_state_machine, test_concurrency, test_ledger_off, test_http):
            try:
                fn(db, cat, alice, bob)
            except Exception as e:  # a crash is a failure, but keep going so every section reports
                import traceback
                traceback.print_exc()
                failures.append(f"{fn.__name__} CRASHED: {e!r}")
                db.rollback()
                T.close_all(db)

    print("\n" + "=" * 68)
    if failures:
        print(f"{len(failures)} FAILURE(S):")
        for f in failures:
            print(f"   - {f}")
        raise SystemExit(1)
    print("All sale-window matrix checks passed.")


if __name__ == "__main__":
    main()
