"""
Sale windows — parallel open checkouts, against REAL Postgres.

Covers what the window system promises (core/ordering/windowService.py):

  * a held quantity is gone for every other window (11 in stock, 5 held -> others see 6)
  * an offcut one window took can't be taken, or hand-picked, by another
  * a remainder a window produces is private to it (the bar isn't cut yet), usable by the
    window itself, and public once the window closes
  * releasing / expiring gives every piece back exactly (bars recombine, pool unchanged)
  * confirming records payment once (idempotent retry), assigns a gap-free order number,
    and only then puts the order in the cutting queue and the reports
  * version conflicts, the 3-window limit, and privacy between cashiers

The service's own sweeper opens its own sessions on db.database.engine, so this suite must
be pointed at the throwaway database through DATABASE_URL (it refuses the live one):

    DATABASE_URL=postgresql+psycopg2://postgres:<pw>@localhost/emiratesco_edit_test \
        python test_sale_windows.py

The test database needs migrate_sale_windows.py applied (same DATABASE_URL).
"""
import uuid

from fastapi import HTTPException
from sqlmodel import Session, select, text

from db.database import engine, DATABASE_URL
from entities.attributes import AttributeClass  # noqa: F401 - registers the table
from entities.offcuts import Offcut
from entities.orderItems import OrderItem
from entities.orders import Order
from entities.payments import Payment
from entities.products import Category, Product
from entities.saleWindows import SaleWindow
from entities.users import User
from entities.variants import Variant

from core.ordering import model, orderService, windowService, windowModel as wm
from core.inventory import inventoryService
from core.financials import PaymentService

FULL_BAR = 21.0
SHEET_W, SHEET_H = 2440.0, 1830.0
failures = []


def check(label, got, want):
    ok = got == want
    print(f"    [{'PASS' if ok else 'FAIL'}] {label}: got {got!r}, want {want!r}")
    if not ok:
        failures.append(label)


def expect_http(label, status, fn, *args):
    try:
        fn(*args)
    except HTTPException as e:
        check(label, e.status_code, status)
        return e
    check(label, "no error", status)
    return None


class FakeUser:
    def __init__(self, user):
        self.userId = user.userId
        self.role = "cashier"
        self.username = user.username


# ── Seeding ───────────────────────────────────────────────────────────────────

def reset(db):
    db.exec(text(
        "TRUNCATE sale_windows, offcut_piece_events, offcut_pieces, offcuts, orderitems, "
        "edit_history, payments, credits, orders, variants, products, categories "
        "RESTART IDENTITY CASCADE"
    ))
    db.exec(text("INSERT INTO order_number_counter (id, last_no) VALUES (1, 100) "
                 "ON CONFLICT (id) DO UPDATE SET last_no = 100"))
    db.commit()


def seed_user(db, name):
    user = db.exec(select(User).where(User.username == name)).first()
    if user is None:
        user = User(userId=uuid.uuid4(), firstName=name, phoneNumber=f"07{uuid.uuid4().int % 10**8:08d}",
                    role="cashier", email=f"{name}@test.local", username=name, password="x",
                    mustChangePassword=False, isActive=True)
        db.add(user)
        db.flush()
    return user


def seed_product(db, cat, name, *, kind, stock):
    product = Product(name=name, category_id=cat.categoryId, stock_quantity=stock,
                      track_offcuts=kind in ("bar", "glass"), has_variants=True,
                      has_dimensions=(kind == "glass"), unit="ft" if kind == "bar" else "pcs")
    db.add(product)
    db.flush()
    if kind == "glass":
        variant = Variant(product_id=product.productId, name="", attributes={}, stock_quantity=stock,
                          price=100.0, price_unit=12.0, price_half=60.0,
                          length=SHEET_W, width=SHEET_H, min_usable=200.0)
    else:
        variant = Variant(product_id=product.productId, name="", attributes={}, stock_quantity=stock,
                          price=100.0, price_unit=50.0, price_half=60.0,
                          length=FULL_BAR, min_usable=1.0)
    db.add(variant)
    db.commit()
    return product, variant


def public_offcut(db, product, variant, length):
    row = Offcut(product_id=product.productId, variant_id=variant.variantId, pool_key="",
                 length=length, quantity=1, status="available")
    db.add(row)
    db.commit()
    return row


# ── Cart helpers ──────────────────────────────────────────────────────────────

def item(product, variant, lines):
    return model.OrderItemRequest(productId=product.productId, variantId=variant.variantId,
                                  quantity=1, unitPrice=0, unitType="pcs",
                                  details={"lineItems": lines})


def full(product, variant, qty):
    return item(product, variant, [{"type": "profile-full", "qty": qty, "meta": {}, "rate": 100.0}])


def cut(product, variant, length, qty=1, selection=None):
    line = {"type": "profile-cut", "qty": qty, "meta": {"length": length}, "rate": 50.0}
    if selection:
        line["offcut_selection"] = selection
    return item(product, variant, [line])


def glass(product, variant, w, h):
    area = round((w / 304.8) * (h / 304.8), 3)
    return item(product, variant, [{"type": "glass-cut", "qty": 1,
                                    "meta": {"l": w, "w": h, "u": "mm", "area": area}, "rate": 12.0}])


def open_w(db, user):
    return windowService.open_window(db, FakeUser(user), wm.WindowOpenRequest(deviceId="till-test"))


def set_cart(db, user, win, items, **kw):
    return windowService.set_cart(db, win.windowId, FakeUser(user),
                                  wm.WindowCartRequest(version=win.version, items=items, **kw))


def confirm(db, user, win, key=None, paid=0.0):
    return windowService.confirm_window(db, win.windowId, FakeUser(user), wm.WindowConfirmRequest(
        version=win.version, idempotencyKey=key or uuid.uuid4().hex, amountPaid=paid,
        paymentMethod="cash"))


def release(db, user, win):
    return windowService.release_window(db, win.windowId, FakeUser(user))


def stock(db, variant):
    db.expire_all()
    return db.get(Variant, variant.variantId).stock_quantity


def pool(db, product, held=None):
    """(length, qty) of offcuts: held=None public only, held=<order id> that window's."""
    db.expire_all()
    stmt = select(Offcut).where(Offcut.product_id == product.productId, Offcut.quantity > 0)
    stmt = stmt.where(Offcut.held_by_order_id.is_(None) if held is None else Offcut.held_by_order_id == held)
    return sorted((round(r.length or 0, 3), round(r.width or 0, 1), round(r.height or 0, 1), r.quantity)
                  for r in db.exec(stmt).all())


def close_all(db):
    for w in db.exec(select(SaleWindow).where(SaleWindow.closed_at.is_(None))).all():
        windowService._close(db, w, "released")
    db.commit()


# ── Tests ─────────────────────────────────────────────────────────────────────

def test_quantity_hold(db, cat, alice, bob):
    print("\n1. A held quantity is gone for every other window")
    product, variant = seed_product(db, cat, "Win Full Bar", kind="bar", stock=11)
    wa, wb = open_w(db, alice), open_w(db, bob)
    wa = set_cart(db, alice, wa, [full(product, variant, 5)])
    check("11 in stock, 5 held -> 6 left", stock(db, variant), 6)
    e = expect_http("other window asks for 7 -> refused", 422, set_cart, db, bob, wb, [full(product, variant, 7)])
    check("  ...with an insufficient-stock message", "Insufficient" in str(e.detail) if e else False, True)
    check("  ...and the refused cart held nothing", stock(db, variant), 6)
    wb = set_cart(db, bob, windowService.get_window(db, wb.windowId, FakeUser(bob)), [full(product, variant, 6)])
    check("other window takes the remaining 6", stock(db, variant), 0)
    release(db, alice, wa)
    check("closing the first window gives its 5 back", stock(db, variant), 5)
    release(db, bob, wb)
    check("closing the second gives all 11 back", stock(db, variant), 11)
    check("released windows are abandoned orders",
          db.get(Order, wa.orderId).status, "abandoned")


def test_offcut_taken_by_one_window(db, cat, alice, bob):
    print("\n2. An offcut one window took is unavailable to another")
    product, variant = seed_product(db, cat, "Win Offcut Bar", kind="bar", stock=5)
    oc = public_offcut(db, product, variant, 8.0)
    wa, wb = open_w(db, alice), open_w(db, bob)
    wa = set_cart(db, alice, wa, [cut(product, variant, 5.0, selection=[{"offcut_id": oc.offcutId, "length_used": 5.0}])])
    check("window A used the 8ft offcut, not a bar", stock(db, variant), 5)
    listing = [o.offcutId for o in __import__("core.inventory.products.service", fromlist=["x"])
               .get_offcuts_for_product(product.productId, db, variant.variantId)]
    check("B's picker no longer lists offcut #8ft", oc.offcutId in listing, False)
    e = expect_http("B hand-picking that offcut -> refused", 422, set_cart, db, bob, wb,
                    [cut(product, variant, 5.0, selection=[{"offcut_id": oc.offcutId, "length_used": 5.0}])])
    print(f"      ({e.detail if e else ''})")
    wa = set_cart(db, alice, wa, [cut(product, variant, 5.0, selection=[{"offcut_id": oc.offcutId, "length_used": 5.0}]),
                                  full(product, variant, 1)])
    check("A adds a line: its own pick still cuts from the 8ft offcut (1 bar for the full line only)",
          stock(db, variant), 4)
    check("A's 3ft remainder is private to A", pool(db, product, held=wa.orderId), [(3.0, 0, 0, 1)])
    check("...and not in the public pool", pool(db, product), [])
    release(db, alice, wa)
    check("after A closes, the 8ft offcut is back whole and public", pool(db, product), [(8.0, 0, 0, 1)])
    check("no rows left held by A", pool(db, product, held=wa.orderId), [])
    release(db, bob, wb)


def test_private_remainder(db, cat, alice, bob):
    print("\n3. A window's remainder is private to it, usable by it, whole again on release")
    product, variant = seed_product(db, cat, "Win Remainder Bar", kind="bar", stock=10)
    wa, wb = open_w(db, alice), open_w(db, bob)
    wa = set_cart(db, alice, wa, [cut(product, variant, 5.0)])
    check("A drew one bar", stock(db, variant), 9)
    check("A's 16ft remainder is held by A", pool(db, product, held=wa.orderId), [(16.0, 0, 0, 1)])
    set_cart(db, bob, wb, [cut(product, variant, 4.0)])
    check("B's 4ft cut takes a fresh bar, not A's 16ft", stock(db, variant), 8)
    wa = set_cart(db, alice, wa, [cut(product, variant, 5.0), cut(product, variant, 4.0)])
    check("A's second cut comes out of its own remainder (no new bar)", stock(db, variant), 8)
    check("A now holds a 12ft remainder", pool(db, product, held=wa.orderId), [(12.0, 0, 0, 1)])
    wa = set_cart(db, alice, wa, [cut(product, variant, 4.0)])
    check("dropping a line re-resolves the cart: still one bar", stock(db, variant), 8)
    check("...leaving a 17ft remainder", pool(db, product, held=wa.orderId), [(17.0, 0, 0, 1)])
    release(db, alice, wa)
    check("A released: its bar is back in stock whole", stock(db, variant), 9)
    check("...and no remainder of it anywhere", pool(db, product, held=wa.orderId) + pool(db, product), [])
    close_all(db)


def test_confirm(db, cat, alice, bob):
    print("\n4. Confirming: payment once, gap-free number, then queue + reports + public offcuts")
    product, variant = seed_product(db, cat, "Win Confirm Bar", kind="bar", stock=10)
    wa = open_w(db, alice)
    wa = set_cart(db, alice, wa, [cut(product, variant, 5.0)], customerName="Walk-in")
    queue_ids = [o["orderId"] for o in orderService.get_pending_cutting_orders(db, FakeUser(alice))]
    check("a held window is NOT in the cutting queue", wa.orderId in queue_ids, False)
    listed = [o.orderId for o in orderService.get_all_orders(db, 0, 500)]
    check("a held window is NOT in order history", wa.orderId in listed, False)
    expect_http("a held window can't be fetched as an order", 404, orderService.get_order_by_orderId, wa.orderId, db)

    counter = db.exec(text("SELECT last_no FROM order_number_counter")).first()[0]
    key = uuid.uuid4().hex
    res = confirm(db, alice, wa, key=key, paid=float(wa.total))
    check("confirmed order gets the next number", res.orderNo, counter + 1)
    again = confirm(db, alice, wa, key=key, paid=float(wa.total))
    check("retried confirm (same key) returns the same order", (again.orderId, again.orderNo), (res.orderId, res.orderNo))
    payments = db.exec(select(Payment).where(Payment.orderId == res.orderId)).all()
    check("...and recorded exactly one payment", len(payments), 1)
    expect_http("a confirm with a different key on a closed window -> 410", 410, confirm, db, alice, wa)

    db.expire_all()
    order = db.get(Order, res.orderId)
    check("order is confirmed", order.status, "confirmed")
    check("order is paid", order.payment_status, "Paid")
    queue_ids = [o["orderId"] for o in orderService.get_pending_cutting_orders(db, FakeUser(alice))]
    check("confirmed order IS in the cutting queue", res.orderId in queue_ids, True)
    check("its 16ft remainder is now public", pool(db, product), [(16.0, 0, 0, 1)])
    summary = PaymentService.get_financial_summary("day", None, db)
    check("the day's report counts it", summary.order_count >= 1, True)

    # Gap-free: an abandoned window in between, then a failed confirm, then a good one.
    wx = open_w(db, bob)
    wx = set_cart(db, bob, wx, [full(product, variant, 1)])
    release(db, bob, wx)
    wy = open_w(db, bob)
    expect_http("confirming an empty cart -> refused", 422, confirm, db, bob, wy)
    wy = set_cart(db, bob, windowService.get_window(db, wy.windowId, FakeUser(bob)), [full(product, variant, 1)])
    res2 = confirm(db, bob, wy)
    check("abandoned window and failed confirm leave no gap", res2.orderNo, res.orderNo + 1)
    check("orderId did skip (the reason order_no exists)", res2.orderId > res.orderId + 1, True)


def test_expiry(db, cat, alice, bob):
    print("\n5. Idle windows expire and give their stock back")
    product, variant = seed_product(db, cat, "Win Expiry Bar", kind="bar", stock=10)
    wa, wb = open_w(db, alice), open_w(db, alice)
    set_cart(db, alice, wa, [cut(product, variant, 5.0)])
    wb = set_cart(db, alice, wb, [full(product, variant, 2)])
    check("both windows holding", stock(db, variant), 7)
    db.exec(text("UPDATE sale_windows SET last_activity_at = LOCALTIMESTAMP - interval '16 minutes' "
                 "WHERE window_id = :w").bindparams(w=wa.windowId))
    db.exec(text("UPDATE sale_windows SET last_activity_at = LOCALTIMESTAMP - interval '14 minutes' "
                 "WHERE window_id = :w").bindparams(w=wb.windowId))
    db.commit()
    n = windowService.expire_idle_windows()
    check("only the window idle >15 min expired", n, 1)
    check("its bar is back in stock", stock(db, variant), 8)
    check("its remainder is gone", pool(db, product) + pool(db, product, held=wa.orderId), [])
    e = expect_http("using an expired window -> 410", 410, windowService.touch_window, db, wa.windowId, FakeUser(alice))
    check("  ...saying it expired", (e.detail or {}).get("closeReason") if e else None, "expired")
    check("the 14-minute window is untouched", windowService.get_window(db, wb.windowId, FakeUser(alice)).version, wb.version)
    close_all(db)


def test_rules(db, cat, alice, bob):
    print("\n6. Versions, the 3-window limit, privacy between cashiers")
    product, variant = seed_product(db, cat, "Win Rules Bar", kind="bar", stock=10)
    w1 = open_w(db, alice)
    set_cart(db, alice, w1, [full(product, variant, 1)])
    expect_http("a cart write with a stale version -> 409", 409, set_cart, db, alice, w1, [full(product, variant, 3)])
    check("...and nothing moved", stock(db, variant), 9)
    expect_http("another cashier can't see the window", 404, windowService.get_window, db, w1.windowId, FakeUser(bob))
    expect_http("...or close it", 404, release, db, bob, w1)
    w2, w3 = open_w(db, alice), open_w(db, alice)
    check("windows are labelled 1-3", sorted(w.label for w in windowService.list_my_windows(db, FakeUser(alice))),
          ["Window 1", "Window 2", "Window 3"])
    expect_http("a 4th open window -> 409", 409, open_w, db, alice)
    release(db, alice, w2)
    w4 = open_w(db, alice)
    check("closing one frees a slot, reusing its label", w4.label, "Window 2")
    close_all(db)


def test_glass(db, cat, alice, bob):
    print("\n7. Glass: a window's sheet remainder is private too")
    product, variant = seed_product(db, cat, "Win Glass", kind="glass", stock=5)
    wa, wb = open_w(db, alice), open_w(db, bob)
    wa = set_cart(db, alice, wa, [glass(product, variant, 1000, 1830)])
    check("A drew one sheet", stock(db, variant), 4)
    check("A's remainder is held, not public",
          (len(pool(db, product, held=wa.orderId)) > 0, pool(db, product)), (True, []))
    set_cart(db, bob, wb, [glass(product, variant, 800, 1000)])
    check("B's cut (would fit A's remainder) takes a fresh sheet", stock(db, variant), 3)
    release(db, alice, wa)
    check("A released: its sheet is back whole", stock(db, variant), 4)
    check("no A remainder anywhere", pool(db, product, held=wa.orderId), [])
    close_all(db)


def test_feasibility_in_window_scope(db, cat, alice, bob):
    print("\n8. The calculator's stock check sees the window's own remainder")
    product, variant = seed_product(db, cat, "Win Feasible Bar", kind="bar", stock=1)
    wa = open_w(db, alice)
    wa = set_cart(db, alice, wa, [cut(product, variant, 5.0)])
    lines = [{"type": "profile-cut", "qty": 1, "meta": {"length": 10.0}}]
    p, v = db.get(Product, product.productId), db.get(Variant, variant.variantId)
    public = inventoryService.check_line_items_feasible(db, p, v, lines)
    check("public check: no bars left, 16ft remainder is A's -> not feasible", public["ok"], False)
    p, v = db.get(Product, product.productId), db.get(Variant, variant.variantId)
    own = inventoryService.check_line_items_feasible(db, p, v, lines, edit_order_id=wa.orderId)
    check("A's own check -> feasible", own["ok"], True)
    close_all(db)


def _race(user_a, user_b, win_a, win_b, make_items):
    """Two tills submit at the same instant, each on its own connection."""
    import threading
    barrier = threading.Barrier(2)
    results = {}

    def run(tag, user, win):
        with Session(engine) as s:
            barrier.wait()
            try:
                set_cart(s, user, win, make_items())
                results[tag] = "ok"
            except HTTPException as e:
                results[tag] = e.status_code

    threads = [threading.Thread(target=run, args=("a", user_a, win_a)),
               threading.Thread(target=run, args=("b", user_b, win_b))]
    for t in threads:
        t.start()
    for t in threads:
        t.join()
    return sorted(map(str, results.values()))


def test_concurrent_race(db, cat, alice, bob):
    print("\n9. Two tills racing for the last unit / the same offcut")
    product, variant = seed_product(db, cat, "Win Race Bar", kind="bar", stock=1)
    wa, wb = open_w(db, alice), open_w(db, bob)
    got = _race(alice, bob, wa, wb, lambda: [full(product, variant, 1)])
    check("last bar: exactly one till gets it, the other is told no", got, ["422", "ok"])
    check("stock never goes negative", stock(db, variant), 0)
    close_all(db)

    product, variant = seed_product(db, cat, "Win Race Offcut", kind="bar", stock=0)
    oc = public_offcut(db, product, variant, 8.0)
    wa, wb = open_w(db, alice), open_w(db, bob)
    pick = [{"offcut_id": oc.offcutId, "length_used": 5.0}]
    got = _race(alice, bob, wa, wb, lambda: [cut(product, variant, 5.0, selection=pick)])
    check("same hand-picked offcut: exactly one till gets it", got, ["422", "ok"])
    held = pool(db, product, held=wa.orderId) + pool(db, product, held=wb.orderId)
    check("one 3ft remainder, held by the winner only", held, [(3.0, 0, 0, 1)])
    close_all(db)
    check("after both close the 8ft offcut is back, once", pool(db, product), [(8.0, 0, 0, 1)])


def main():
    name = DATABASE_URL.rsplit("/", 1)[-1]
    if name == "EmiratesCo_Database":
        raise SystemExit("Refusing to run against the live database - set DATABASE_URL to emiratesco_edit_test.")
    with Session(engine) as db:
        reset(db)
        cat = Category(name="Window Tests", type="ke-profile", sub_categories=[])
        db.add(cat)
        alice, bob = seed_user(db, "win-alice"), seed_user(db, "win-bob")
        db.commit()
        for fn in (test_quantity_hold, test_offcut_taken_by_one_window, test_private_remainder,
                   test_confirm, test_expiry, test_rules, test_glass, test_feasibility_in_window_scope,
                   test_concurrent_race):
            fn(db, cat, alice, bob)

    print("\n" + "=" * 68)
    if failures:
        print(f"{len(failures)} FAILURE(S):")
        for f in failures:
            print(f"   - {f}")
        raise SystemExit(1)
    print("All sale-window checks passed.")


if __name__ == "__main__":
    main()
