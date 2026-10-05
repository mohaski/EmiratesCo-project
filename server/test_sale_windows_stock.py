"""Sale windows vs the rest of the stock system (plan T7, T9-T17).

  A  T9   window items are never marked cut; a confirmed window is in the cutting queue once
  B  T10  a cart built in a window ends exactly where a checkout of that cart does
  C  T7   random window/checkout/cancel sequences: integrity check clean after EVERY step
          (pool<->ledger, stock<->journal, TRACE), bar material conserved, no stray holds
  D  T11  restock racing a window save loses neither
  E  T12  the sweeper racing a save: one wins, never half of each
  F  T13  the sweeper does nothing while a failover push/receive is running
  G  T14  undo of an edit whose returned piece a window then used is refused, and stays safe
  H  T15  a window-confirmed order lives on like any order: edit, cutting report, cancel
  I  T16  open-container sales: an abandoned window never invents pieces or revenue
  J  T17  order numbers stay unique and gap-free under concurrent confirms and checkouts

Runs on emiratesco_edit_test (DATABASE_URL). Run from server/.
"""
import logging
import os
import random
import sys
import threading
import uuid

sys.path.insert(0, os.getcwd())
logging.disable(logging.CRITICAL)

from sqlmodel import Session, select, text

import entities  # noqa: F401
from db.database import engine
from entities.offcuts import Offcut
from entities.opJournal import StockOperation
from entities.orderItems import OrderItem
from entities.orders import Order
from entities.products import Category
from entities.saleWindows import SaleWindow
from entities.variants import Variant

with Session(engine) as _db:
    assert _db.exec(text("select current_database()")).one()[0] == "emiratesco_edit_test", "test DB only"

import test_sale_windows as T  # noqa: E402
import test_sale_windows_matrix as M  # noqa: E402
from test_sale_windows import open_w, set_cart, confirm, release, stock, pool, cut, full, glass, FakeUser  # noqa: E402
from core.audit import integrity, undo as undo_engine  # noqa: E402
from core.ordering import model, orderService, windowService  # noqa: E402
from core.settings.service import set_cancel_pin  # noqa: E402

failures = []


def check(label, ok, got=None):
    print(f"  [{'PASS' if ok else 'FAIL'}] {label}" + ("" if ok else f" — got {got!r}"))
    if not ok:
        failures.append(label)


def rebaseline(db):
    """Stock counters as they stand now become the integrity check's baseline (test DB only)."""
    db.exec(text("DELETE FROM stock_baseline"))
    last = db.exec(text("SELECT coalesce(max(id), 0) FROM stock_journal")).one()[0]
    for table, col in (("variants", '"variantId"'), ("products", '"productId"')):
        db.exec(text(f"INSERT INTO stock_baseline (table_name, row_pk, quantity, taken_at, after_journal_id) "
                     f"SELECT '{table}', {col}::text, coalesce(stock_quantity, 0), now() at time zone 'utc', :last "
                     f"FROM {table}").bindparams(last=last))
    db.commit()
    return last


def clean(db, label, since):
    db.expire_all()
    res = integrity.check(db, since_journal_id=since)
    check(f"{label}: integrity clean", res["errors"] == [], res["errors"][:5])
    return res


def window_invariants(db, label):
    """The matrix's structural checks (stray holds, status agreement, numbering, dead consumers)."""
    before = len(T.failures)    # the matrix reports through test_sale_windows.check
    M.invariants(db, label)
    if len(T.failures) > before:
        failures.extend(T.failures[before:])


def checkout(db, user, items, **kw):
    """A normal checkout of `items` (what POST /orders/ does)."""
    return orderService.create_order(model.OrderCreate(
        servedBy=uuid.UUID(FakeUser(user).userId), status="confirmed", items=items, amountPaid=0, **kw),
        db, FakeUser(user))


def sources(db, order_id):
    """Each item's recorded cut sources, normalised (what was cut from what, what was left)."""
    db.expire_all()
    out = []
    for it in db.exec(select(OrderItem).where(OrderItem.order_id == order_id).order_by(OrderItem.position)).all():
        for line in (it.details or {}).get("lineItems") or []:
            for s in line.get("offcut_sources") or []:
                out.append((s.get("source"), round(float(s.get("length_used", 0) or 0), 3),
                            round(float(s.get("remainder_created", 0) or 0), 3),
                            tuple(sorted((round(c.get("w", 0)), round(c.get("h", 0))) for c in s.get("cuts") or []))))
    return out


def run():
    with Session(engine) as db:
        T.reset(db)
        cat = Category(name="Window Stock", type="ke-profile", sub_categories=[])
        db.add(cat)
        alice, bob = T.seed_user(db, "win-alice"), T.seed_user(db, "win-bob")
        db.commit()
        set_cancel_pin(db, "4321", M.manager(alice))
        db.commit()
        since = rebaseline(db)

        # ── A. cutting state ─────────────────────────────────────────────────
        print("A. A window's items are never cut; a confirmed window is queued once (T9)")
        bar, bv = T.seed_product(db, cat, "A Bar", kind="bar", stock=5)
        since = rebaseline(db)
        w = set_cart(db, alice, open_w(db, alice), [cut(bar, bv, 5.0), cut(bar, bv, 3.0)])
        w = set_cart(db, alice, w, [cut(bar, bv, 3.0), cut(bar, bv, 7.0)])   # rebuild path
        db.expire_all()
        items = db.exec(select(OrderItem).where(OrderItem.order_id == w.orderId)).all()
        check("no window item is marked cut after a rebuild", items and not any(i.cutting_completed for i in items),
              [i.cutting_completed for i in items])
        queue = orderService.get_pending_cutting_orders(db, M.manager(alice))
        check("the window is not in the cutting queue", w.orderId not in [o["orderId"] for o in queue])
        res = confirm(db, alice, w)
        queue = orderService.get_pending_cutting_orders(db, M.manager(alice))
        check("confirmed: in the cutting queue exactly once", [o["orderId"] for o in queue].count(res.orderId) == 1)
        clean(db, "A", since)

        # ── B. same result as checkout ───────────────────────────────────────
        print("B. A cart built in a window ends where a checkout of it does (T10)")

        def set_of(tag):
            b, bvv = T.seed_product(db, cat, f"B Bar {tag}", kind="bar", stock=6)
            g, gv = T.seed_product(db, cat, f"B Glass {tag}", kind="glass", stock=3)
            return b, bvv, g, gv

        def state(b, bvv, g, gv):
            return (stock(db, bvv), pool(db, b), stock(db, gv), pool(db, g))

        def lines(b, bvv, g, gv):
            return [cut(b, bvv, 7.0), cut(b, bvv, 5.5, qty=2), glass(g, gv, 900, 600), cut(b, bvv, 4.0),
                    glass(g, gv, 600, 400), full(b, bvv, 1)]

        s1, s2 = set_of("checkout"), set_of("window")
        s3, s4 = set_of("checkout-2"), set_of("window-2")
        since = rebaseline(db)   # products are seeded outside any operation; measure from here
        o1 = checkout(db, alice, lines(*s1))
        w = open_w(db, bob)
        built = []
        for ln in lines(*s2):                       # appended one at a time: the append path
            built.append(ln)
            w = set_cart(db, bob, w, list(built))
        o2 = confirm(db, bob, w)
        check("append path: stock and pools identical to checkout", state(*s1) == state(*s2), (state(*s1), state(*s2)))
        check("append path: same cut sources item by item", sources(db, o1.orderId) == sources(db, o2.orderId),
              (sources(db, o1.orderId), sources(db, o2.orderId)))

        final = lambda b, bvv, g, gv: [glass(g, gv, 900, 600), cut(b, bvv, 4.0), cut(b, bvv, 9.0)]
        o3 = checkout(db, alice, final(*s3))
        b, bvv, g, gv = s4
        w = set_cart(db, bob, open_w(db, bob), [cut(b, bvv, 9.0), glass(g, gv, 900, 600)])
        w = set_cart(db, bob, w, [glass(g, gv, 900, 600)])                        # remove
        w = set_cart(db, bob, w, [glass(g, gv, 900, 600), cut(b, bvv, 6.0)])     # add
        w = set_cart(db, bob, w, final(*s4))                                       # change + add
        o4 = confirm(db, bob, w)
        check("rebuild path: stock and pools identical to checkout", state(*s3) == state(*s4), (state(*s3), state(*s4)))
        check("rebuild path: same cut sources item by item", sources(db, o3.orderId) == sources(db, o4.orderId),
              (sources(db, o3.orderId), sources(db, o4.orderId)))
        clean(db, "B", since)

        # ── C. random sequences ──────────────────────────────────────────────
        print("C. Random window/checkout/cancel sequences keep every invariant (T7)")
        rb, rbv = T.seed_product(db, cat, "R Bar", kind="bar", stock=8)
        rg, rgv = T.seed_product(db, cat, "R Glass", kind="glass", stock=4)
        rw, rwv = T.seed_product(db, cat, "R Widget", kind="plain", stock=40)
        since = rebaseline(db)
        start_len = M.total_length(db, rb, rbv)
        rng = random.Random(20261005)
        open_by = {alice.username: [], bob.username: []}
        users = {alice.username: alice, bob.username: bob}
        confirmed = []

        def live_cut_length():
            db.expire_all()
            total = 0.0
            for it in db.exec(select(OrderItem).join(Order, Order.orderId == OrderItem.order_id).where(
                    OrderItem.product_id == rb.productId,
                    Order.status.notin_(("cancelled", "abandoned")))).all():
                for ln in (it.details or {}).get("lineItems") or []:
                    if ln.get("type") == "profile-cut":
                        total += float(ln["meta"]["length"]) * int(ln.get("qty", 1))
                    elif ln.get("type") == "profile-full":
                        total += T.FULL_BAR * int(ln.get("qty", 1))
            return round(total, 3)

        def live_widgets():
            db.expire_all()
            return sum(int(ln.get("qty", 0)) for it in db.exec(
                select(OrderItem).join(Order, Order.orderId == OrderItem.order_id).where(
                    OrderItem.product_id == rw.productId, Order.status.notin_(("cancelled", "abandoned")))).all()
                for ln in (it.details or {}).get("lineItems") or [])

        def random_line():
            k = rng.random()
            if k < 0.5:
                return cut(rb, rbv, rng.choice([2.0, 3.5, 5.0, 7.0, 9.5, 12.0]))
            if k < 0.6:
                return full(rb, rbv, 1)
            if k < 0.8:
                return glass(rg, rgv, rng.choice([500, 900, 1200]), rng.choice([400, 600, 800]))
            return T.item(rw, rwv, [{"type": "accessory-full", "qty": rng.randint(1, 4), "meta": {}, "rate": 100.0}])

        steps = 70
        for step in range(steps):
            name = rng.choice(list(users))
            user = users[name]
            mine = open_by[name]
            action = rng.choice(["open", "add", "add", "add", "remove", "release", "confirm", "checkout", "cancel"])
            try:
                if action == "open" and len(mine) < 3:
                    mine.append(open_w(db, user))
                elif action == "add" and mine:
                    w = rng.choice(mine)
                    cur = windowService.get_window(db, w.windowId, FakeUser(user))
                    reqs = [model.OrderItemRequest(productId=i.productId, variantId=i.variantId, quantity=i.quantity,
                                                   unitPrice=i.unitPrice, unitType=i.unitType, details=i.details)
                            for i in cur.items]
                    mine[mine.index(w)] = set_cart(db, user, cur, reqs + [random_line()], customerName="Rand")
                elif action == "remove" and mine:
                    w = rng.choice(mine)
                    cur = windowService.get_window(db, w.windowId, FakeUser(user))
                    if cur.items:
                        reqs = [model.OrderItemRequest(productId=i.productId, variantId=i.variantId, quantity=i.quantity,
                                                       unitPrice=i.unitPrice, unitType=i.unitType, details=i.details)
                                for i in cur.items]
                        reqs.pop(rng.randrange(len(reqs)))
                        mine[mine.index(w)] = set_cart(db, user, cur, reqs, customerName="Rand")
                elif action == "release" and mine:
                    w = mine.pop(rng.randrange(len(mine)))
                    release(db, user, w)
                elif action == "confirm" and mine:
                    w = rng.choice(mine)
                    cur = windowService.get_window(db, w.windowId, FakeUser(user))
                    if cur.items:
                        mine.remove(w)
                        confirmed.append(confirm(db, user, cur).orderId)
                elif action == "checkout":
                    confirmed.append(checkout(db, user, [random_line()]).orderId)
                elif action == "cancel" and confirmed:
                    M.cancel_not_cut(db, confirmed.pop(rng.randrange(len(confirmed))), user)
            except Exception as e:  # refusals (not enough stock, ...) are legitimate outcomes
                db.rollback()
                if "500" in str(getattr(e, "status_code", "")):
                    check(f"step {step} {action}: no server error", False, repr(e))
            res = integrity.check(db, since_journal_id=since)
            if res["errors"]:
                check(f"step {step} ({action} by {name}): integrity clean", False, res["errors"][:3])
                break
            got = round(M.total_length(db, rb, rbv) + live_cut_length(), 3)
            if abs(got - start_len) > 1e-6:
                check(f"step {step} ({action}): bar material conserved", False, (got, start_len))
                break
            if stock(db, rwv) + live_widgets() != 40:
                check(f"step {step} ({action}): widgets conserved", False, (stock(db, rwv), live_widgets()))
                break
        else:
            check(f"{steps} random steps: integrity clean, bar length and widget count conserved after every one", True)
        window_invariants(db, "C (open windows)")
        T.close_all(db)
        check("all windows closed: bar material = start minus live cuts",
              abs(M.total_length(db, rb, rbv) + live_cut_length() - start_len) < 1e-6)
        window_invariants(db, "C (closed)")
        clean(db, "C end", since)

        # ── D. restock racing a window save ──────────────────────────────────
        print("D. Restock racing a window save loses neither (T11)")
        from core.inventory.stockSessions import service as ss, model as ssm
        dp, dv = T.seed_product(db, cat, "D Widget", kind="plain", stock=20)
        since = rebaseline(db)
        mgr = M.manager(alice)
        for _ in range(5):
            w = open_w(db, bob)
            barrier = threading.Barrier(2)

            def do_restock():
                with Session(engine) as s:
                    barrier.wait()
                    ss.finalize_stock_input_session(ssm.StockInputSessionCreate(stock_lines=[ssm.StockInputLineCreate(
                        product_id=dp.productId, variant_id=dv.variantId, entered_quantity=5)]), s, mgr)

            def do_save():
                with Session(engine) as s:
                    barrier.wait()
                    windowService.set_cart(s, w.windowId, FakeUser(bob), T.wm.WindowCartRequest(
                        version=w.version, items=[T.item(dp, dv, [{"type": "accessory-full", "qty": 1, "meta": {}, "rate": 100.0}])]))

            before = stock(db, dv)
            ts = [threading.Thread(target=do_restock), threading.Thread(target=do_save)]
            [t.start() for t in ts]
            [t.join() for t in ts]
            check("stock = before + 5 restocked - 1 held", stock(db, dv) == before + 4, (before, stock(db, dv)))
            release(db, bob, windowService.get_window(db, w.windowId, FakeUser(bob)))
        clean(db, "D", since)

        # ── E. sweeper racing a save ─────────────────────────────────────────
        print("E. The sweeper racing a save: one wins, never half of each (T12)")
        ep, ev = T.seed_product(db, cat, "E Bar", kind="bar", stock=10)
        since = rebaseline(db)
        for n in range(6):
            w = set_cart(db, alice, open_w(db, alice), [cut(ep, ev, 4.0)])
            M.backdate(db, w.windowId, 16)
            barrier = threading.Barrier(2)
            outcome = {}

            def do_save():
                with Session(engine) as s:
                    barrier.wait()
                    try:
                        windowService.set_cart(s, w.windowId, FakeUser(alice), T.wm.WindowCartRequest(
                            version=w.version, items=[cut(ep, ev, 4.0), cut(ep, ev, 6.0)]))
                        outcome["save"] = "ok"
                    except Exception as e:
                        outcome["save"] = getattr(e, "status_code", repr(e))

            def do_sweep():
                barrier.wait()
                outcome["swept"] = windowService.expire_idle_windows()

            ts = [threading.Thread(target=do_save), threading.Thread(target=do_sweep)]
            [t.start() for t in ts]
            [t.join() for t in ts]
            db.expire_all()
            win = db.get(SaleWindow, w.windowId)
            order = db.get(Order, w.orderId)
            n_items = len(db.exec(select(OrderItem).where(OrderItem.order_id == w.orderId)).all())
            if win.closed_at is None:
                ok = outcome["save"] == "ok" and n_items == 2 and order.status == "held"
            else:
                ok = outcome["save"] in (410, "ok") and win.close_reason == "expired" and order.status == "abandoned" \
                    and stock(db, ev) == 10 - 0 and not pool(db, ep, held=w.orderId)
            check(f"race {n + 1}: consistent ({outcome}, closed={win.closed_at is not None})", ok,
                  (outcome, win.close_reason, order.status, n_items, stock(db, ev)))
            T.close_all(db)
        clean(db, "E", since)

        # ── F. sweeper during failover ───────────────────────────────────────
        print("F. The sweeper does nothing while a failover push/receive runs (T13)")
        import main as app_main
        from core.failover.service import _operation_lock
        w = set_cart(db, alice, open_w(db, alice), [cut(ep, ev, 4.0)])
        M.backdate(db, w.windowId, 16)
        with _operation_lock:
            n = app_main.sweep_idle_windows_once()
        db.expire_all()
        check("during failover: nothing expired", n == 0 and db.get(SaleWindow, w.windowId).closed_at is None, n)
        n = app_main.sweep_idle_windows_once()
        db.expire_all()
        check("after failover: the idle window expires", n == 1 and db.get(SaleWindow, w.windowId).close_reason == "expired", n)

        # ── G. undo interplay ────────────────────────────────────────────────
        print("G. Undo of an edit whose returned piece a window then used (T14)")
        gp, gv2 = T.seed_product(db, cat, "G Bar", kind="bar", stock=3)
        since = rebaseline(db)
        o = checkout(db, alice, [cut(gp, gv2, 5.0)])
        loaded = orderService.get_order_by_orderId(o.orderId, db)
        reqs = [model.OrderItemRequest(productId=i.productId, variantId=i.variantId, quantity=i.quantity,
                                       unitPrice=i.unitPrice, unitType=i.unitType, details=dict(i.details or {}))
                for i in loaded.items]
        reqs[0].details["lineItems"][0]["meta"]["length"] = 3.0
        orderService.update_order(o.orderId, model.OrderEditRequest(servedBy=uuid.UUID(FakeUser(alice).userId),
                                                                    items=reqs), db, M.manager(alice))
        # Newest: reset() restarts order ids but keeps earlier runs' operation rows.
        edit_op = db.exec(select(StockOperation).where(StockOperation.order_id == o.orderId,
                                                       StockOperation.kind == "edit")
                          .order_by(StockOperation.created_at.desc())).first()
        check("before any window: the edit can be undone", undo_engine.analyse(db, edit_op.op_id)["reasons"] == [],
              undo_engine.analyse(db, edit_op.op_id)["reasons"])
        db.rollback()
        public = pool(db, gp)
        biggest = max(r[0] for r in public) if public else 0
        w = set_cart(db, bob, open_w(db, bob), [cut(gp, gv2, biggest - 1.0)])
        reasons = undo_engine.analyse(db, edit_op.op_id)["reasons"]
        db.rollback()
        check("a window using the returned piece blocks the undo, saying so",
              any("sale window" in r for r in reasons), reasons)
        release(db, bob, w)
        reasons = undo_engine.analyse(db, edit_op.op_id)["reasons"]
        db.rollback()
        if reasons:
            check("after the window closes: still refused (safe)", True)
        else:
            undo_engine.undo_operation(db, edit_op.op_id, actor=M.manager(alice), reason="test")
            db.commit()
            check("after the window closes: the undo applies", True)
        clean(db, "G", since)

        # ── H. a window-confirmed order's later life ─────────────────────────
        print("H. A window-confirmed order: edit, cutting report, cancel (T15)")
        hp, hv = T.seed_product(db, cat, "H Bar", kind="bar", stock=4)
        hg, hgv = T.seed_product(db, cat, "H Glass", kind="glass", stock=2)
        since = rebaseline(db)
        start = M.total_length(db, hp, hv)
        o = confirm(db, alice, set_cart(db, alice, open_w(db, alice),
                                        [cut(hp, hv, 6.0), glass(hg, hgv, 1000, 800)]))
        loaded = orderService.get_order_by_orderId(o.orderId, db)
        reqs = [model.OrderItemRequest(productId=i.productId, variantId=i.variantId, quantity=i.quantity,
                                       unitPrice=i.unitPrice, unitType=i.unitType, details=dict(i.details or {}))
                for i in loaded.items]
        reqs[0].details["lineItems"][0]["meta"]["length"] = 8.0
        orderService.update_order(o.orderId, model.OrderEditRequest(servedBy=uuid.UUID(FakeUser(alice).userId),
                                                                    items=reqs), db, M.manager(alice))
        clean(db, "H edit", since)
        orderService.mark_cutting_complete_for_order(o.orderId, db, M.manager(alice))
        clean(db, "H cutting report", since)
        db.expire_all()
        check("cutting reported", all(i.cutting_completed for i in db.exec(
            select(OrderItem).where(OrderItem.order_id == o.orderId)).all()))
        o2 = confirm(db, alice, set_cart(db, alice, open_w(db, alice), [cut(hp, hv, 5.0)]))
        M.cancel_not_cut(db, o2.orderId, alice)
        clean(db, "H cancel", since)
        check("bar material: start = stock + 8ft still sold", abs(M.total_length(db, hp, hv) + 8.0 - start) < 1e-6,
              (M.total_length(db, hp, hv), start))

        # ── I. open containers ───────────────────────────────────────────────
        print("I. Open-container sales: an abandoned window invents nothing (T16)")
        from entities.products import Product
        from core.inventory.openContainers import service as ocs, model as ocm
        from core.inventory.openContainers.utilization import container_usage
        cp = Product(name="I Sealant", category_id=cat.categoryId, stock_quantity=3, has_variants=True, unit="pcs",
                     unit_stock_mode="open_container")
        db.add(cp)
        db.flush()
        cv = Variant(product_id=cp.productId, name="", attributes={}, stock_quantity=3, price=500.0,
                     price_unit=60.0, unit_quantity=10)
        db.add(cv)
        db.commit()
        since = rebaseline(db)
        cont = ocs.open_container(cp.productId, ocm.OpenContainerCreate(variant_id=cv.variantId), db, M.manager(alice))
        pcs = lambda q: T.item(cp, cv, [{"type": "accessory-pcs", "qty": q, "meta": {}, "rate": 60.0}])
        wa = set_cart(db, alice, open_w(db, alice), [pcs(3)])
        wb = confirm(db, bob, set_cart(db, bob, open_w(db, bob), [pcs(5)]))
        release(db, alice, wa)
        usage = container_usage(cont.id, db)
        sold = usage.total_units
        check("usage lists only the confirmed window's order", [l.order_id for l in usage.lines] == [wb.orderId],
              [l.order_id for l in usage.lines])
        db.expire_all()
        from entities.openContainers import OpenContainer
        oc = db.get(OpenContainer, cont.id)
        check("container: only the confirmed 5 pieces are sold", oc.units_sold == 5, oc.units_sold)
        check("usage counts only the confirmed 5 pieces", sold == 5, sold)
        clean(db, "I", since)

        # ── J. order numbers under concurrency ───────────────────────────────
        print("J. Order numbers: unique and gap-free under concurrency (T17)")
        jp, jv = T.seed_product(db, cat, "J Widget", kind="plain", stock=500)
        start_no = db.exec(text("SELECT last_no FROM order_number_counter")).one()[0]
        wins = [set_cart(db, alice if i % 2 else bob, open_w(db, alice if i % 2 else bob),
                         [T.item(jp, jv, [{"type": "accessory-full", "qty": 1, "meta": {}, "rate": 100.0}])])
                for i in range(6)]
        barrier = threading.Barrier(12)
        errors = []

        def conf(w, u):
            with Session(engine) as s:
                barrier.wait()
                try:
                    windowService.confirm_window(s, w.windowId, FakeUser(u), T.wm.WindowConfirmRequest(
                        version=w.version, idempotencyKey=uuid.uuid4().hex, amountPaid=0))
                except Exception as e:
                    errors.append(repr(e))

        def chk(u):
            with Session(engine) as s:
                barrier.wait()
                try:
                    checkout(s, u, [T.item(jp, jv, [{"type": "accessory-full", "qty": 1, "meta": {}, "rate": 100.0}])])
                except Exception as e:
                    errors.append(repr(e))

        def rolled_back():
            with Session(engine) as s:
                barrier.wait()
                from core.ordering.orderNumbers import next_order_no
                next_order_no(s)
                s.rollback()   # a sale that fails after taking its number

        ts = [threading.Thread(target=conf, args=(w, alice if i % 2 else bob)) for i, w in enumerate(wins)]
        ts += [threading.Thread(target=chk, args=(alice,)) for _ in range(4)]
        ts += [threading.Thread(target=rolled_back) for _ in range(2)]
        [t.start() for t in ts]
        [t.join() for t in ts]
        check("every confirm and checkout went through", errors == [], errors)
        nos = sorted(r[0] for r in db.exec(text("SELECT order_no FROM orders WHERE order_no > :s").bindparams(s=start_no)).all())
        check("10 new numbers, contiguous, no duplicates", nos == list(range(start_no + 1, start_no + 11)), nos)
        check("counter = highest number", db.exec(text("SELECT last_no FROM order_number_counter")).one()[0] == start_no + 10)


# The baseline is shared with every other suite on this database (they restart the journal at
# id 1 and rely on it): keep a copy and put it back however this run ends.
with Session(engine) as _db:
    _saved_baseline = _db.exec(text("SELECT table_name, row_pk, quantity, taken_at, after_journal_id FROM stock_baseline")).all()
try:
    run()
finally:
    with Session(engine) as _db:
        _db.exec(text("DELETE FROM stock_baseline"))
        for r in _saved_baseline:
            _db.exec(text("INSERT INTO stock_baseline (table_name, row_pk, quantity, taken_at, after_journal_id) "
                          "VALUES (:t, :p, :q, :at, :j)").bindparams(t=r[0], p=r[1], q=r[2], at=r[3], j=r[4]))
        _db.commit()
print()
print("ALL PASS" if not failures else f"{len(failures)} FAILED: {failures}")
sys.exit(1 if failures else 0)
