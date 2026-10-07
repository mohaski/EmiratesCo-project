"""Provisional offcuts (PROVISIONAL_OFFCUTS_PLAN.md) - phase 0: the reversals sharing a bar relies on.

  T1  A bar opened by order X, order Y cuts from X's leftover; both reversed as "not cut".
      X first used to rejoin into a full-length piece that landed in the offcut pool as a
      21ft "offcut" while stock stayed a bar short (seen on the 2026-10-06 data). Either
      order must now put the whole bar back in stock. A cut that really was made keeps the
      bar out of stock.
  T2  A window releases after another order cut from its remainder: the window's uncut
      length is joined onto what is left of the bar, not credited as a separate piece.

Phase 1 - the data model and the switch:
  P1  offcuts.provisional_for: empty by default (ORM and plain SQL inserts), journaled like
      any column so undo can put it back.
  P2  The switch: off by default, CEO/admin only, refused while a sale window is open, and a
      window can't open while the switch is being changed.

Phase 2 - marks, switch ON (plan section 4):
  T3  the 2026-10-06 incident: a window opens a bar, another order cuts from its provisional
      leftover, the window confirms -> one bar, marks gone
  T4  same, window released -> the bar is handed over (recorded), then back to stock whole
  T5  window -> window, confirmed in either order: one bar, marks shrink as each confirms
  T6  both released, in either order: the bar back in stock, nothing left
  T7  the borrower cancelled while the window is open: the piece goes back STILL provisional
  T10 a provisional remainder never merges with an ordinary offcut of the same length
  T12 idle expiry behaves like a release
  T9  the window drops its cut after a borrow: the rest of the bar is not provisional any more
  T13 a new pick of the window's own remainder survives a cart rebuild

Phase 3 - choosing and locking, switch ON:
  T11 an ordinary offcut beats a tighter provisional one; a provisional one beats a new bar
  R4  un-creating a remainder by its length never takes another open window's provisional twin
  T14 a cancel racing a checkout on the same bar never deadlocks
  T15 a correction racing a sale on the same variant never loses the sale's stock change

Phase 4 - what people see, switch ON:
  T16 the till's listing badges a provisional piece with its window and cashier; a reopened
      window line still never sees its own leftover (marked, not held)
  T17 Offcut Management lists provisional pieces but refuses to edit or delete them, saying
      why; once the window confirms they are ordinary and editable
  T18 a correction's replacement list badges provisional pieces and puts them after ordinary
  T19 managers' list of provisional pieces
  T20 the worksheet notice is worked out when shown: window -> take the whole bar; released ->
      the bar was never cut; confirmed -> its receipt number; cut -> no notice

Phase 5 - tills are told:
  T21 a released window whose bar another order cut from queues one "bar_handed_over" notice,
      only once the release commits, naming that order and who served it; a dry run or a
      plain release queues nothing

Phase 6 - the integrity check knows the provisional rules (each corruption must be reported):
  I1 a mark naming a closed window      I2 marks out of step with the pieces' ancestry
  I3 a held 1D row with the switch on   I4 marks while the switch is off
  I5 a whole bar sitting in the offcut pool

Runs on emiratesco_edit_test (DATABASE_URL). Run from server/.
"""
import logging
import os
import sys
import uuid

sys.path.insert(0, os.getcwd())
logging.disable(logging.CRITICAL)

from fastapi import HTTPException
from sqlmodel import Session, select, text

import entities  # noqa: F401
from db.database import engine
from entities.offcuts import Offcut
from entities.orderItems import OrderItem
from entities.products import Category

with Session(engine) as _db:
    assert _db.exec(text("select current_database()")).one()[0] == "emiratesco_edit_test", "test DB only"

import test_sale_windows as T  # noqa: E402
import test_sale_windows_matrix as M  # noqa: E402
from test_sale_windows import open_w, set_cart, confirm, release, stock, cut, FakeUser, FULL_BAR  # noqa: E402
from entities.opJournal import StockOperation  # noqa: E402
from core.ordering import windowService  # noqa: E402
from core.audit import integrity  # noqa: E402
from core.audit.opContext import operation  # noqa: E402
from core.inventory import holdScope  # noqa: E402
from core.inventory import reversalPlan as rp  # noqa: E402
from core.ordering import model, orderService  # noqa: E402

failures = []


def check(label, ok, got=None):
    print(f"  [{'PASS' if ok else 'FAIL'}] {label}" + ("" if ok else f" — got {got!r}"))
    if not ok:
        failures.append(label)


def rebaseline(db):
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


def offcuts(db, product):
    """Every pooled unit, public or held, as (length, status) - sorted longest first."""
    db.expire_all()
    rows = db.exec(select(Offcut).where(Offcut.product_id == product.productId, Offcut.quantity > 0)).all()
    return sorted(((round(r.length, 3), r.status) for r in rows for _ in range(r.quantity)), reverse=True)


def no_full_bar_offcut(db, product):
    return all(length < FULL_BAR - 0.01 for length, _ in offcuts(db, product))


def checkout(db, user, items):
    return orderService.create_order(model.OrderCreate(
        servedBy=uuid.UUID(FakeUser(user).userId), status="confirmed", items=items, amountPaid=0),
        db, FakeUser(user))


def item_of(db, order_id):
    db.expire_all()
    return db.exec(select(OrderItem).where(OrderItem.order_id == order_id)).first()


def cancel_not_cut(db, user, order_id, later="not_cut"):
    """Cancel answering every line "not cut" and every later cut on its bar with `later`."""
    fu = M.manager(user)
    plan = orderService.get_reversal_plan(order_id, db, fu)
    conf = {l["line_ref"]: {"physicalState": rp.PHYS_NOT_CUT,
                            "laterCuts": {str(lc["item_id"]): later for lc in l["later_cuts"]}}
            for l in plan["lines"]}
    with operation(db, "cancel", actor=fu, order_id=order_id, request={}):
        orderService.apply_cancel(order_id, db, fu, cut_confirmations=conf, enforce_window=False)
    db.commit()


def opener_and_borrower(db, cat, user, name, borrow):
    """A 21ft bar: X cuts 2ft from it, Y cuts `borrow` from X's 19ft leftover."""
    bar, bv = T.seed_product(db, cat, name, kind="bar", stock=3)
    since = rebaseline(db)
    x = checkout(db, user, [cut(bar, bv, 2.0)])
    y = checkout(db, user, [cut(bar, bv, borrow)])
    src = (item_of(db, y.orderId).details["lineItems"][0]["offcut_sources"] or [{}])[0]
    check(f"{name}: Y cut from X's 19ft leftover", (src.get("source"), src.get("offcut_length")) == ("offcut", 19.0), src)
    check(f"{name}: one bar out of stock", stock(db, bv) == 2, stock(db, bv))
    return bar, bv, x, y, since


def t1(db, cat, user):
    print("T1  Two 'not cut' reversals on one bar give the whole bar back to stock")

    for first, label in (("x", "opener first"), ("y", "borrower first")):
        bar, bv, x, y, since = opener_and_borrower(db, cat, user, f"T1 {label}", 18.5)
        order = (x, y) if first == "x" else (y, x)
        for o in order:
            cancel_not_cut(db, user, o.orderId)
        check(f"{label}: bar back in stock", stock(db, bv) == 3, stock(db, bv))
        check(f"{label}: no full-length offcut in the pool", no_full_bar_offcut(db, bar), offcuts(db, bar))
        check(f"{label}: nothing left in the pool", offcuts(db, bar) == [], offcuts(db, bar))
        clean(db, label, since)

    # The same with room to spare on the bar: 2 + 5 + the 14 left = 21.
    bar, bv, x, y, since = opener_and_borrower(db, cat, user, "T1 partial borrow", 5.0)
    cancel_not_cut(db, user, x.orderId)
    check("partial borrow: X's 2ft joined onto the 14 left -> 16", offcuts(db, bar) == [(16.0, "available")], offcuts(db, bar))
    check("partial borrow: bar still out (Y holds it)", stock(db, bv) == 2, stock(db, bv))
    cancel_not_cut(db, user, y.orderId)
    check("partial borrow: bar back in stock", stock(db, bv) == 3, stock(db, bv))
    check("partial borrow: pool empty", offcuts(db, bar) == [], offcuts(db, bar))
    clean(db, "partial borrow", since)

    # Control: Y's cut really was made - the bar is in pieces, so it must NOT come back whole.
    bar, bv, x, y, since = opener_and_borrower(db, cat, user, "T1 borrower already cut", 5.0)
    orderService.mark_cutting_complete_batch([item_of(db, y.orderId).item_id], db, FakeUser(user))
    db.commit()
    cancel_not_cut(db, user, x.orderId, later="already_cut")
    check("borrower cut: X's 2ft joins the 14 left -> 16", offcuts(db, bar) == [(16.0, "available")], offcuts(db, bar))
    check("borrower cut: bar stays out of stock", stock(db, bv) == 2, stock(db, bv))
    clean(db, "borrower already cut", since)


def t2(db, cat, user):
    print("T2  A window released after another order cut from its remainder")
    bar, bv = T.seed_product(db, cat, "T2 Bar", kind="bar", stock=3)
    since = rebaseline(db)
    win = set_cart(db, user, open_w(db, user), [cut(bar, bv, 2.0)])
    check("window opened a bar", stock(db, bv) == 2, stock(db, bv))
    # Phase 0 has no provisional sharing yet: stand in for it by making the window's 19ft
    # leftover public, so another order can cut from it as it will once phase 2 lands.
    with operation(db, "maintenance", actor=FakeUser(user)):
        db.exec(text("UPDATE offcuts SET held_by_order_id = NULL WHERE held_by_order_id = :o")
                .bindparams(o=win.orderId))
    db.commit()
    y = checkout(db, user, [cut(bar, bv, 18.5)])
    src = (item_of(db, y.orderId).details["lineItems"][0]["offcut_sources"] or [{}])[0]
    check("Y cut from the window's 19ft", src.get("offcut_length") == 19.0, src)

    release(db, user, win)
    check("released: the bar stays out (Y carries it)", stock(db, bv) == 2, stock(db, bv))
    check("released: window's 2ft joined to Y's 0.5 -> one 2.5 piece",
          offcuts(db, bar) == [(2.5, "available")], offcuts(db, bar))

    cancel_not_cut(db, user, y.orderId)
    check("then Y cancelled: the bar is back in stock", stock(db, bv) == 3, stock(db, bv))
    check("then Y cancelled: pool empty", offcuts(db, bar) == [], offcuts(db, bar))
    clean(db, "T2", since)


def set_flag_raw(db, value):
    """Test setup only: the switch's stored value, whatever a previous run left behind."""
    db.exec(text("INSERT INTO system_settings (key, value) VALUES (:k, :v) "
                 "ON CONFLICT (key) DO UPDATE SET value = :v")
            .bindparams(k=holdScope.PROVISIONAL_FLAG_KEY, v=value))
    db.commit()


def p1(db, cat, user):
    print("P1  offcuts.provisional_for")
    bar, bv = T.seed_product(db, cat, "P1 Bar", kind="bar", stock=1)
    orm_row = T.public_offcut(db, bar, bv, 7.0)
    db.refresh(orm_row)
    check("ORM insert: empty", orm_row.provisional_for == [], orm_row.provisional_for)
    sql_id = db.exec(text("INSERT INTO offcuts (product_id, variant_id, pool_key, length, quantity, status, created_at) "
                          "VALUES (:p, :v, '', 5.0, 1, 'available', now()) RETURNING \"offcutId\"")
                     .bindparams(p=bar.productId, v=bv.variantId)).one()[0]
    db.commit()
    db.expire_all()
    check("plain SQL insert: empty (server default)", db.get(Offcut, sql_id).provisional_for == [],
          db.get(Offcut, sql_id).provisional_for)

    with operation(db, "maintenance", actor=FakeUser(user)) as op:
        row = db.get(Offcut, orm_row.offcutId)
        row.provisional_for = [41, 42]
        db.add(row)
        db.flush()
        op_id = op.op_id
    db.commit()
    db.expire_all()
    check("stored as an integer list", db.get(Offcut, orm_row.offcutId).provisional_for == [41, 42],
          db.get(Offcut, orm_row.offcutId).provisional_for)
    entry = db.exec(text("SELECT before, after FROM stock_journal WHERE op_id = :o AND table_name = 'offcuts'")
                    .bindparams(o=op_id)).first()
    check("journaled before/after", entry is not None and (entry[0] or {}).get("provisional_for") == []
          and (entry[1] or {}).get("provisional_for") == [41, 42], entry)
    with operation(db, "maintenance", actor=FakeUser(user)):
        row = db.get(Offcut, orm_row.offcutId)
        row.provisional_for = []
        db.add(row)
    db.commit()


def p2(db, cat, user):
    print("P2  The switch")
    set_flag_raw(db, "false")
    ceo, cashier = M.ceo(user), M.cashier(user)
    check("off by default", holdScope.provisional_enabled(db) is False)
    try:
        holdScope.set_provisional_enabled(db, True, cashier)
        check("a cashier can't switch it", False, "allowed")
    except HTTPException as e:
        db.rollback()
        check("a cashier can't switch it", e.status_code == 403, e.status_code)
    check("on, with no window open", holdScope.set_provisional_enabled(db, True, ceo) == {"enabled": True})
    check("reads on", holdScope.provisional_enabled(db) is True)

    win = open_w(db, user)
    try:
        holdScope.set_provisional_enabled(db, False, ceo)
        check("refused while a window is open", False, "allowed")
    except HTTPException as e:
        check("refused while a window is open", e.status_code == 409 and "1 sale window" in e.detail, e.detail)
    db.expire_all()
    check("still on after the refusal", holdScope.provisional_enabled(db) is True)
    check("setting it to what it already is is allowed", holdScope.set_provisional_enabled(db, True, ceo) == {"enabled": True})
    release(db, user, win)
    check("off once the window is closed", holdScope.set_provisional_enabled(db, False, ceo) == {"enabled": False})

    # A window can't open while the switch is mid-change: hold the switch's lock in another
    # session and give the open a short lock_timeout - it must wait, not slip through.
    with Session(engine) as switching, Session(engine) as till:
        switching.exec(text("SELECT pg_advisory_xact_lock(:k)").bindparams(k=holdScope._SWITCH_LOCK))
        till.exec(text("SET lock_timeout = '300ms'"))
        try:
            open_w(till, user)
            check("open waits for the switch", False, "opened")
        except Exception as e:
            till.rollback()
            check("open waits for the switch", "lock timeout" in str(e).lower(), str(e)[:120])
        switching.rollback()
    win = open_w(db, user)
    check("opens normally once the switch is done", win.windowId is not None)
    release(db, user, win)
    set_flag_raw(db, "false")


# ── Phase 2: switch on ───────────────────────────────────────────────────────

def rows(db, product):
    """Every pooled row: (length, held_by, marks, quantity), longest first."""
    db.expire_all()
    rs = db.exec(select(Offcut).where(Offcut.product_id == product.productId, Offcut.quantity > 0,
                                      Offcut.status == "available")).all()
    return sorted(((round(r.length, 3), r.held_by_order_id, tuple(r.provisional_for or ()), r.quantity)
                   for r in rs), reverse=True)


def window_cut(db, user, length, new_bar=False, win=None, extra=()):
    """Open a window (or reuse `win`) with one cut, plus `extra` items."""
    it = cut(*CURRENT, length)
    if new_bar:
        it.details["lineItems"][0]["source_pref"] = "new"
    return set_cart(db, user, win or open_w(db, user), [it, *extra])


CURRENT = [None, None]  # (product, variant) the phase-2 helpers cut from


def bar_for(db, cat, name, stock_qty=3):
    bar, bv = T.seed_product(db, cat, name, kind="bar", stock=stock_qty)
    CURRENT[0], CURRENT[1] = bar, bv
    return bar, bv, rebaseline(db)


def op_summary(db, kind, order_id):
    db.expire_all()
    op = db.exec(select(StockOperation).where(StockOperation.kind == kind, StockOperation.order_id == order_id)
                 .order_by(StockOperation.created_at.desc())).first()
    return (op.summary or {}) if op else None


def t3(db, cat, alice, bob):
    print("T3  The incident: a window's bar shared with another order, window confirms")
    bar, bv, since = bar_for(db, cat, "T3 Bar")
    w = window_cut(db, alice, 3.0)
    check("window opened a bar", stock(db, bv) == 2, stock(db, bv))
    check("its 18ft leftover is public, marked for the window", rows(db, bar) == [(18.0, None, (w.orderId,), 1)], rows(db, bar))
    y = checkout(db, bob, [cut(bar, bv, 3.0)])
    src = item_of(db, y.orderId).details["lineItems"][0]["offcut_sources"][0]
    check("the other order cut from the provisional 18ft - no second bar",
          (src["source"], src["offcut_length"], stock(db, bv)) == ("offcut", 18.0, 2), (src["source"], src["offcut_length"], stock(db, bv)))
    check("its 15ft leftover still depends on the window", rows(db, bar) == [(15.0, None, (w.orderId,), 1)], rows(db, bar))
    confirm(db, alice, w)
    check("window confirmed: an ordinary 15ft, one bar used", (rows(db, bar), stock(db, bv)) == ([(15.0, None, (), 1)], 2),
          (rows(db, bar), stock(db, bv)))
    clean(db, "T3", since)


def t4(db, cat, alice, bob):
    print("T4  Same, but the window is released: the bar is handed over")
    bar, bv, since = bar_for(db, cat, "T4 Bar")
    w = window_cut(db, alice, 3.0)
    y = checkout(db, bob, [cut(bar, bv, 3.0)])
    release(db, alice, w)
    check("released: the bar stays out, carried by the other order", stock(db, bv) == 2, stock(db, bv))
    check("released: 3ft never cut + 15ft = one ordinary 18ft", rows(db, bar) == [(18.0, None, (), 1)], rows(db, bar))
    summary = op_summary(db, "window_release", w.orderId) or {}
    handed = summary.get("bar_handed_over") or []
    check("the release records the handover to the other order",
          len(handed) == 1 and handed[0]["to_orders"] == [y.orderId] and handed[0]["length"] == 18.0, summary)
    cancel_not_cut(db, bob, y.orderId)
    check("then the other order cancelled: the whole bar back in stock", (stock(db, bv), rows(db, bar)) == (3, []),
          (stock(db, bv), rows(db, bar)))
    clean(db, "T4", since)


def t5(db, cat, alice, bob):
    print("T5  Window -> window, confirmed in either order")
    for first in ("opener", "borrower"):
        bar, bv, since = bar_for(db, cat, f"T5 {first} first")
        w1 = window_cut(db, alice, 3.0)
        w2 = window_cut(db, bob, 3.0)
        check(f"{first}: second window cut from the first's 18ft",
              (stock(db, bv), rows(db, bar)) == (2, [(15.0, None, tuple(sorted((w1.orderId, w2.orderId))), 1)]),
              (stock(db, bv), rows(db, bar)))
        a, b = (w1, w2) if first == "opener" else (w2, w1)
        confirm(db, alice if a is w1 else bob, a)
        check(f"{first}: after the first confirm only the other window's mark is left",
              rows(db, bar) == [(15.0, None, (b.orderId,), 1)], rows(db, bar))
        confirm(db, alice if b is w1 else bob, b)
        check(f"{first}: both confirmed: an ordinary 15ft, one bar",
              (stock(db, bv), rows(db, bar)) == (2, [(15.0, None, (), 1)]), (stock(db, bv), rows(db, bar)))
        clean(db, f"T5 {first}", since)


def t6(db, cat, alice, bob):
    print("T6  Both windows released, in either order")
    for first in ("opener", "borrower"):
        bar, bv, since = bar_for(db, cat, f"T6 {first} first")
        w1 = window_cut(db, alice, 3.0)
        w2 = window_cut(db, bob, 3.0)
        a, b = (w1, w2) if first == "opener" else (w2, w1)
        release(db, alice if a is w1 else bob, a)
        check(f"{first}: after the first release one bar is still out", stock(db, bv) == 2, stock(db, bv))
        check(f"{first}: and an 18ft marked only for the window still open",
              rows(db, bar) == [(18.0, None, (b.orderId,), 1)], rows(db, bar))
        release(db, alice if b is w1 else bob, b)
        check(f"{first}: both released: the bar back in stock, nothing left",
              (stock(db, bv), rows(db, bar)) == (3, []), (stock(db, bv), rows(db, bar)))
        clean(db, f"T6 {first}", since)


def t7(db, cat, alice, bob):
    print("T7  The borrower cancelled while the window is open")
    bar, bv, since = bar_for(db, cat, "T7 Bar")
    w = window_cut(db, alice, 3.0)
    y = checkout(db, bob, [cut(bar, bv, 5.0)])
    check("borrower left 13ft, still provisional", rows(db, bar) == [(13.0, None, (w.orderId,), 1)], rows(db, bar))
    cancel_not_cut(db, bob, y.orderId)
    check("cancelled by a manager: the 18ft goes back STILL marked for the window",
          rows(db, bar) == [(18.0, None, (w.orderId,), 1)], rows(db, bar))
    confirm(db, alice, w)
    check("window confirmed: an ordinary 18ft", (stock(db, bv), rows(db, bar)) == (2, [(18.0, None, (), 1)]),
          (stock(db, bv), rows(db, bar)))
    clean(db, "T7", since)


def t10(db, cat, alice, bob):
    print("T10 A provisional remainder never merges with an ordinary one")
    bar, bv, since = bar_for(db, cat, "T10 Bar")
    T.public_offcut(db, bar, bv, 18.0)
    since = rebaseline(db)
    w = window_cut(db, alice, 3.0, new_bar=True)
    check("two 18ft rows: one ordinary, one provisional",
          rows(db, bar) == [(18.0, None, (w.orderId,), 1), (18.0, None, (), 1)], rows(db, bar))
    confirm(db, alice, w)
    check("after the confirm both are ordinary (left as two rows)",
          rows(db, bar) == [(18.0, None, (), 1), (18.0, None, (), 1)], rows(db, bar))
    clean(db, "T10", since)


def t12(db, cat, alice, bob):
    print("T12 Idle expiry is a release")
    bar, bv, since = bar_for(db, cat, "T12 Bar")
    w = window_cut(db, alice, 3.0)
    y = checkout(db, bob, [cut(bar, bv, 3.0)])
    db.exec(text("UPDATE sale_windows SET last_activity_at = last_activity_at - interval '2 hours' "
                 "WHERE order_id = :o").bindparams(o=w.orderId))
    db.commit()
    check("the sweeper expired it", windowService.expire_idle_windows() >= 1)
    check("expired: bar handed over, ordinary 18ft", (stock(db, bv), rows(db, bar)) == (2, [(18.0, None, (), 1)]),
          (stock(db, bv), rows(db, bar)))
    handed = (op_summary(db, "window_expire", w.orderId) or {}).get("bar_handed_over") or []
    check("the expiry records the handover", len(handed) == 1 and handed[0]["to_orders"] == [y.orderId], handed)
    clean(db, "T12", since)


def t9(db, cat, alice, bob):
    print("T9  The window drops its cut after another order borrowed from its bar")
    bar, bv, since = bar_for(db, cat, "T9 Bar")
    other, ov = T.seed_product(db, cat, "T9 Other", kind="bar", stock=3)
    since = rebaseline(db)
    w = window_cut(db, alice, 3.0)
    y = checkout(db, bob, [cut(bar, bv, 5.0)])
    check("the other order left 13ft, provisional", rows(db, bar) == [(13.0, None, (w.orderId,), 1)], rows(db, bar))
    w = set_cart(db, alice, w, [cut(other, ov, 2.0)])   # the bar cut is gone from the cart
    check("the window's 3ft rejoins the 13 -> 16, now carried by the other order: NOT provisional",
          rows(db, bar) == [(16.0, None, (), 1)], rows(db, bar))
    check("the bar stays out of stock (the other order has it)", stock(db, bv) == 2, stock(db, bv))
    handed = (op_summary(db, "window_cart", w.orderId) or {}).get("bar_handed_over") or []
    check("the cart change records the handover", len(handed) == 1 and handed[0]["to_orders"] == [y.orderId], handed)
    release(db, alice, w)
    clean(db, "T9", since)

    # The other order used ALL of the leftover: nothing to rejoin onto, so the window's 3ft
    # comes back as a piece of its own - and must not stay marked for the window either.
    bar, bv, since = bar_for(db, cat, "T9b Bar")
    other, ov = T.seed_product(db, cat, "T9b Other", kind="bar", stock=3)
    since = rebaseline(db)
    w = window_cut(db, alice, 3.0)
    y = checkout(db, bob, [cut(bar, bv, 18.0)])
    check("T9b: the other order took the whole 18ft", rows(db, bar) == [], rows(db, bar))
    w = set_cart(db, alice, w, [cut(other, ov, 2.0)])
    check("T9b: the window's 3ft comes back as an ordinary piece", rows(db, bar) == [(3.0, None, (), 1)], rows(db, bar))
    release(db, alice, w)
    clean(db, "T9b", since)


def t13(db, cat, alice, bob):
    print("T13 A new pick of the window's own remainder, saved with a change that rebuilds the cart")
    bar, bv, since = bar_for(db, cat, "T13 Bar")
    other, ov = T.seed_product(db, cat, "T13 Other", kind="bar", stock=3)
    T.public_offcut(db, bar, bv, 6.0)      # what an automatic 5ft cut would take instead
    since = rebaseline(db)
    w = window_cut(db, alice, 3.0, new_bar=True, extra=[cut(other, ov, 2.0)])
    own = db.exec(select(Offcut.offcutId).where(Offcut.product_id == bar.productId, Offcut.quantity > 0,
                                                Offcut.length == 18.0)).first()
    try:
        # The other line changes (so the whole cart is rebuilt and the 18ft re-created under a
        # new id) in the same save as the cashier's new pick of that 18ft.
        first = cut(bar, bv, 3.0)
        first.details["lineItems"][0]["source_pref"] = "new"
        w = set_cart(db, alice, w, [first, cut(other, ov, 3.0),
                                    cut(bar, bv, 5.0, selection=[{"offcut_id": own, "length_used": 5.0}])])
        check("the pick follows the window's re-created 18ft (not the public 6ft)",
              rows(db, bar) == [(13.0, None, (w.orderId,), 1), (6.0, None, (), 1)], rows(db, bar))
    except Exception as e:  # noqa: BLE001 - a refused save is the failure being tested for
        db.rollback()
        check("the pick follows the window's re-created 18ft (not the public 6ft)", False, str(e)[:120])
    release(db, alice, w)
    clean(db, "T13", since)


# ── Phase 3 ──────────────────────────────────────────────────────────────────

def t11(db, cat, alice, bob):
    print("T11 Ordinary offcuts first, then provisional, then a new bar (decision D1)")
    bar, bv, since = bar_for(db, cat, "T11 Bar")
    T.public_offcut(db, bar, bv, 8.0)                  # an ordinary 8ft
    since = rebaseline(db)
    w = window_cut(db, alice, 15.0, new_bar=True)      # the window leaves a provisional 6ft
    check("setup: ordinary 8ft, provisional 6ft", rows(db, bar) == [(8.0, None, (), 1), (6.0, None, (w.orderId,), 1)],
          rows(db, bar))
    y1 = checkout(db, bob, [cut(bar, bv, 5.0)])
    src = item_of(db, y1.orderId).details["lineItems"][0]["offcut_sources"][0]
    check("5ft: the ordinary 8ft, not the tighter provisional 6ft", (src["source"], src["offcut_length"]) == ("offcut", 8.0),
          (src["source"], src["offcut_length"]))
    y2 = checkout(db, bob, [cut(bar, bv, 5.0)])
    src = item_of(db, y2.orderId).details["lineItems"][0]["offcut_sources"][0]
    check("5ft again, no ordinary piece fits (3ft left): the provisional 6ft, not a new bar",
          (src["source"], src["offcut_length"], stock(db, bv)) == ("offcut", 6.0, 2), (src["source"], src["offcut_length"], stock(db, bv)))
    release(db, alice, w)
    clean(db, "T11", since)


def r4(db, cat, alice, bob):
    print("R4  Un-creating by length leaves another window's provisional twin alone")
    from core.inventory import inventoryService as inv
    from core.inventory import offcutLedger as ledger
    bar, bv, since = bar_for(db, cat, "R4 Bar")
    w = window_cut(db, alice, 16.0, new_bar=True)       # provisional 5ft, created FIRST (lower id)
    T.public_offcut(db, bar, bv, 5.0)                   # an ordinary 5ft (pre-ledger, no pieces)
    since = rebaseline(db)
    check("setup: two 5ft rows, the window's first", rows(db, bar) == [(5.0, None, (w.orderId,), 1), (5.0, None, (), 1)],
          rows(db, bar))
    # A pre-ledger reversal un-creates "a 5ft remainder" by its length alone.
    with operation(db, "maintenance", actor=FakeUser(bob)):
        found = inv._remove_offcut(db, bar, db.get(type(bv), bv.variantId), 5.0, "")
    db.commit()
    check("legacy un-create: took the ordinary 5ft, the window's is untouched",
          (found, rows(db, bar)) == (True, [(5.0, None, (w.orderId,), 1)]), (found, rows(db, bar)))
    # A ledger piece that lost its row pointer goes back out of the pool by length too.
    T.public_offcut(db, bar, bv, 5.0)
    with operation(db, "maintenance", actor=FakeUser(bob)):
        stray = ledger.mint_piece(db, product_id=bar.productId, variant_id=bv.variantId, pool_key="",
                                  geom=ledger.geom_1d(5.0), origin=ledger.ORIGIN_MANUAL_ENTRY, notes="test: no row")
        inv._drop_pooled_unit_for_piece(db, bar, db.get(type(bv), bv.variantId), stray, "")
        ledger.retire_piece(db, stray, reason="test")
    db.commit()
    check("piece without a row: the ordinary 5ft unit dropped, the window's untouched",
          rows(db, bar) == [(5.0, None, (w.orderId,), 1)], rows(db, bar))
    release(db, alice, w)


def t14(db, cat, alice, bob):
    print("T14 Racing a cancel against a checkout on the same bar")
    import threading
    import time
    from sqlalchemy.exc import DBAPIError
    from core.inventory import reversalPlan as plan_mod
    bar, bv, since = bar_for(db, cat, "T14 Bar", stock_qty=40)
    errors = []
    # Widen the race window deterministically: the cancel holds its piece locks for a moment
    # (as a slow request would), and the sale starts just after it. A sale that locks the stock
    # row, then the offcut row, then the piece - while the cancel holds the piece and wants
    # the row - is a deadlock unless both take their locks in one order.
    real_lock = plan_mod.lock_decision_pieces

    def slow_lock(db_, plan):
        real_lock(db_, plan)
        time.sleep(0.6)
    plan_mod.lock_decision_pieces = slow_lock
    try:
        for i in range(3):
            x = checkout(db, bob, [cut(bar, bv, 3.0)])     # X opens a bar: an 18ft, not cut yet
            barrier = threading.Barrier(2)

            def do_cancel():
                with Session(engine) as s:
                    try:
                        barrier.wait()
                        cancel_not_cut(s, bob, x.orderId)
                    except (DBAPIError, HTTPException) as e:
                        s.rollback()
                        if not isinstance(e, HTTPException) or e.status_code >= 500:
                            errors.append(f"cancel: {str(e).splitlines()[0][:120]}")

            def do_sale():
                with Session(engine) as s:
                    try:
                        barrier.wait()
                        time.sleep(0.2)
                        checkout(s, alice, [cut(bar, bv, 4.0)])
                    except (DBAPIError, HTTPException) as e:
                        s.rollback()
                        if not isinstance(e, HTTPException) or e.status_code >= 500:
                            errors.append(f"sale: {str(e).splitlines()[0][:120]}")

            threads = [threading.Thread(target=do_cancel), threading.Thread(target=do_sale)]
            [t.start() for t in threads]
            [t.join() for t in threads]
    finally:
        plan_mod.lock_decision_pieces = real_lock
    check("3 races: no deadlock or server error", errors == [], errors[:3])
    clean(db, "T14", since)


def t15(db, cat, alice, bob):
    print("T15 A correction racing a sale on the same variant (fresh sessions, as two requests)")
    import threading
    import time
    bar, bv, since = bar_for(db, cat, "T15 Bar", stock_qty=10)
    T.public_offcut(db, bar, bv, 5.0)
    since = rebaseline(db)
    x = checkout(db, bob, [cut(bar, bv, 3.0)])            # cut from the 5ft offcut: stock stays 10
    xi = item_of(db, x.orderId)
    check("setup: X cut from the offcut, stock 10", stock(db, bv) == 10, stock(db, bv))
    errors = []
    # The correction reads its order item, product and variant, then pauses (a slow request);
    # a sale of a whole bar commits meanwhile; then the correction draws its new bar. Read
    # without a lock, the correction writes back 10 - 1 and the sale's bar is lost.
    real_target = orderService._correction_target

    def slow_target(*a, **kw):
        out = real_target(*a, **kw)
        time.sleep(0.6)
        return out
    orderService._correction_target = slow_target
    try:
        def do_correct():
            with Session(engine) as s:
                try:
                    orderService.correct_profile_offcut_for_order_item(
                        x.orderId, xi.item_id, 0, 0, 18.0, True, None, "test", s, M.manager(alice),
                        source_unused=True, force_new_source=True)
                except Exception as e:  # noqa: BLE001
                    s.rollback()
                    errors.append(f"correction: {type(e).__name__}: {str(e).splitlines()[0][:120]}")

        def do_sale():
            with Session(engine) as s:
                try:
                    time.sleep(0.2)
                    checkout(s, bob, [T.full(bar, bv, 1)])
                except Exception as e:  # noqa: BLE001
                    s.rollback()
                    errors.append(f"sale: {type(e).__name__}: {str(e).splitlines()[0][:120]}")

        threads = [threading.Thread(target=do_correct), threading.Thread(target=do_sale)]
        [t.start() for t in threads]
        [t.join() for t in threads]
    finally:
        orderService._correction_target = real_target
    check("both went through", errors == [], errors)
    check("stock 10 - the correction's new bar - the sale's bar = 8", stock(db, bv) == 8, stock(db, bv))
    clean(db, "T15", since)


# ── Phase 4 ──────────────────────────────────────────────────────────────────

def listing(db, bar, bv, hold=None, for_item=None):
    from core.inventory.products import service as psvc
    db.expire_all()
    return [(r.length, r.quantity, [(m["orderId"], m["window"], m["cashier"]) for m in r.provisional])
            for r in psvc.get_offcuts_for_product(bar.productId, db, bv.variantId, hold, for_item)]


def t16(db, cat, alice, bob):
    print("T16 The till's listing: provisional badge; a reopened line never sees its own leftover")
    bar, bv, since = bar_for(db, cat, "T16 Bar")
    T.public_offcut(db, bar, bv, 4.0)
    w = window_cut(db, alice, 3.0, new_bar=True)
    label = db.exec(select(T.SaleWindow).where(T.SaleWindow.order_id == w.orderId)).one().label
    check("another till sees the 18ft badged with the window and cashier, the 4ft plain",
          listing(db, bar, bv) == [(18.0, 1, [(w.orderId, label, alice.username)]), (4.0, 1, [])], listing(db, bar, bv))
    own_item = item_of(db, w.orderId).item_id
    check("the window reopening that line is not offered its own 18ft",
          listing(db, bar, bv, w.orderId, own_item) == [(4.0, 1, [])], listing(db, bar, bv, w.orderId, own_item))
    confirm(db, alice, w)
    check("after the confirm: an ordinary 18ft", listing(db, bar, bv) == [(18.0, 1, []), (4.0, 1, [])], listing(db, bar, bv))


def t17(db, cat, alice, bob):
    print("T17 Offcut Management: provisional pieces listed, but not editable or deletable")
    from core.inventory.products import service as psvc, model as pmodel
    bar, bv, since = bar_for(db, cat, "T17 Bar")
    w = window_cut(db, alice, 3.0)
    ceo = M.ceo(alice)
    row = db.exec(select(Offcut).where(Offcut.product_id == bar.productId, Offcut.quantity > 0)).one()
    listed = [r for r in psvc.list_all_offcuts(db, ceo) if r.offcutId == row.offcutId]
    check("listed, with its window", len(listed) == 1 and [m["orderId"] for m in listed[0].provisional] == [w.orderId],
          [(r.offcutId, r.provisional) for r in listed])
    for label, call in (("edit", lambda: psvc.update_offcut_admin(row.offcutId, pmodel.OffcutAdminUpdate(length=17.0), db, ceo)),
                        ("delete", lambda: psvc.bulk_delete_offcuts([row.offcutId], db, ceo))):
        try:
            call()
            check(f"{label} refused", False, "allowed")
        except HTTPException as e:
            db.rollback()
            check(f"{label} refused (409), saying it's an open sale's uncut bar",
                  e.status_code == 409 and "provisional" in str(e.detail) and "Window" in str(e.detail), (e.status_code, e.detail))
    check("nothing changed", rows(db, bar) == [(18.0, None, (w.orderId,), 1)], rows(db, bar))
    confirm(db, alice, w)
    psvc.update_offcut_admin(row.offcutId, pmodel.OffcutAdminUpdate(length=17.5), db, ceo)
    db.commit()
    check("window confirmed: the CEO can now correct it", rows(db, bar) == [(17.5, None, (), 1)], rows(db, bar))


def t18(db, cat, alice, bob):
    print("T18 Correction candidates: provisional pieces badged, after ordinary ones")
    from core.inventory.cutCorrection import profile_candidates
    bar, bv, since = bar_for(db, cat, "T18 Bar")
    T.public_offcut(db, bar, bv, 19.0)
    w = window_cut(db, alice, 3.0, new_bar=True)
    db.expire_all()
    got = [(o["length"], [m["orderId"] for m in o["provisional"]])
           for o in profile_candidates(db, db.get(type(bar), bar.productId), db.get(type(bv), bv.variantId), 5.0)["offcuts"]]
    check("the ordinary 19ft before the tighter provisional 18ft, which is badged",
          got == [(19.0, []), (18.0, [w.orderId])], got)
    release(db, alice, w)


def t19(db, cat, alice, bob):
    print("T19 Managers' list of provisional pieces")
    bar, bv, since = bar_for(db, cat, "T19 Bar")
    w = window_cut(db, alice, 3.0)
    got = [(r["productId"], r["length"], [m["orderId"] for m in r["windows"]])
           for r in windowService.provisional_offcuts(db, M.manager(bob))]
    check("the window's 18ft, with the window", got == [(bar.productId, 18.0, [w.orderId])], got)
    try:
        windowService.provisional_offcuts(db, FakeUser(bob))
        check("cashiers can't list them", False, "allowed")
    except HTTPException as e:
        check("cashiers can't list them", e.status_code == 403, e.status_code)
    release(db, alice, w)
    check("after the release: none", windowService.provisional_offcuts(db, M.manager(bob)) == [])


def t20(db, cat, alice, bob):
    print("T20 The worksheet shows each cut's PHYSICAL source (bars are cut in confirmation order)")

    def shown(order_id, item_idx=0):
        """The first cut record of an order as the worksheet gets it."""
        db.expire_all()
        o = orderService.get_order_by_orderId(order_id, db)
        return o.items[item_idx].details["lineItems"][0]["offcut_sources"][0]

    def phys(src):
        p = src.get("physical")
        return None if p is None else (p["kind"], p["length"], p["after_order_no"], p["keep"], p["keep_status"])

    # A window cuts 3ft from a new 21ft bar (18ft provisional); a checkout cuts 4ft of it.
    for ending in ("open", "released", "confirmed later"):
        bar, bv, since = bar_for(db, cat, f"T20 {ending}")
        w = window_cut(db, alice, 3.0)
        y = checkout(db, bob, [cut(bar, bv, 4.0)])
        if ending == "released":
            release(db, alice, w)
        elif ending == "confirmed later":
            res = confirm(db, alice, w)
        src = shown(y.orderId)
        check(f"{ending}: the checkout's worksheet - New bar, CUT 4, KEEP 17, no note",
              (src["offcut_length"], phys(src), "pending_source_notice" in src) == (18.0, ("new_bar", 21.0, None, 17.0, "available"), False),
              (phys(src), src.get("pending_source_notice")))
        if ending == "confirmed later":
            wsrc = shown(w.orderId)
            y_no = db.exec(select(T.Order.order_no).where(T.Order.orderId == y.orderId)).one()
            check("confirmed later: the window's worksheet - the 17ft piece left after the checkout's cut, CUT 3, KEEP 14",
                  phys(wsrc) == ("piece", 17.0, y_no, 14.0, "available"), phys(wsrc))
        stored = item_of(db, y.orderId).details["lineItems"][0]["offcut_sources"][0]
        check(f"{ending}: the stored record is untouched", "physical" not in stored and stored.get("offcut_length") == 18.0, stored)

    print("    ...and ordinary sales read exactly as before")
    bar, bv, since = bar_for(db, cat, "T20 ordinary")
    a = checkout(db, alice, [cut(bar, bv, 3.0)])            # opens the bar: 18ft left
    b = checkout(db, bob, [cut(bar, bv, 4.0)])              # cuts from it, confirmed after
    a_no = db.exec(select(T.Order.order_no).where(T.Order.orderId == a.orderId)).one()
    sa, sb = shown(a.orderId), shown(b.orderId)
    check("ordinary: no physical override on either sale", (phys(sa), phys(sb)) == (None, None), (phys(sa), phys(sb)))
    check("ordinary: the later sale keeps the usual 'depends on Order #N' note",
          (sb.get("pending_source_notice") or {}).get("order_no") == a_no, sb.get("pending_source_notice"))
    orderService.mark_cutting_complete_batch([item_of(db, a.orderId).item_id], db, M.manager(alice))
    db.commit()
    check("ordinary: the note goes once that cut is reported", "pending_source_notice" not in shown(b.orderId), shown(b.orderId))

    bar, bv, since = bar_for(db, cat, "T20 corrected")
    a = checkout(db, alice, [cut(bar, bv, 3.0)])
    ai = item_of(db, a.orderId)
    orderService.correct_profile_offcut_for_order_item(a.orderId, ai.item_id, 0, 0, 17.0, False, None, "damaged end",
                                                      db, M.manager(alice))
    db.commit()
    b = checkout(db, bob, [cut(bar, bv, 4.0)])
    sb = shown(b.orderId)
    check("a manager-corrected leftover (18 -> 17) is not 'physically' undone", (sb["offcut_length"], phys(sb)) == (17.0, None),
          (sb["offcut_length"], phys(sb)))

    bar, bv, since = bar_for(db, cat, "T20 cancelled")
    a = checkout(db, alice, [cut(bar, bv, 3.0)])            # opens the bar
    b = checkout(db, bob, [cut(bar, bv, 4.0)])              # cuts from its 18ft
    cancel_not_cut(db, alice, a.orderId)                    # A never cut: its 3ft rejoins
    sb = shown(b.orderId)
    check("an opener cancelled 'not cut': the other sale now opens the bar - New bar, KEEP 17, no note",
          (phys(sb), "pending_source_notice" in sb) == (("new_bar", 21.0, None, 17.0, "available"), False),
          (phys(sb), sb.get("pending_source_notice")))

    print("    ...two checkouts from one window's bar")
    bar, bv, since = bar_for(db, cat, "T20 two")
    w = window_cut(db, alice, 3.0)
    b1 = checkout(db, bob, [cut(bar, bv, 4.0)])               # 18 -> 14 (provisional)
    b2 = checkout(db, bob, [cut(bar, bv, 5.0)])               # 14 -> 9 (provisional)
    b1_no = db.exec(select(T.Order.order_no).where(T.Order.orderId == b1.orderId)).one()
    check("first: New bar, CUT 4, KEEP 17", phys(shown(b1.orderId)) == ("new_bar", 21.0, None, 17.0, "available"), phys(shown(b1.orderId)))
    check("second: the 17ft piece left after the first one's cut, CUT 5, KEEP 12",
          phys(shown(b2.orderId)) == ("piece", 17.0, b1_no, 12.0, "available"), phys(shown(b2.orderId)))

    print("    ...a correction made from the worksheet as shown is not refused as 'changed'")
    displayed = shown(b1.orderId)
    try:
        orderService.correct_profile_offcut_for_order_item(
            b1.orderId, item_of(db, b1.orderId).item_id, 0, 0, 13.5, False, None, "re-measured", db, M.manager(alice),
            expected_event=displayed)
        db.commit()
        check("correction with the displayed record accepted", True)
    except HTTPException as e:
        db.rollback()
        check("correction with the displayed record accepted", False, (e.status_code, e.detail))
    release(db, alice, w)


def phase4(db, cat, alice, bob):
    set_flag_raw(db, "true")
    try:
        for fn in (t16, t17, t18, t19, t20):
            fn(db, cat, alice, bob)
    finally:
        T.close_all(db)
        set_flag_raw(db, "false")
    set_flag_raw(db, "true")
    try:
        t21(db, cat, alice, bob)
    finally:
        T.close_all(db)
        set_flag_raw(db, "false")
    phase6(db, cat, alice, bob)


# ── Phase 5 ──────────────────────────────────────────────────────────────────

def t21(db, cat, alice, bob):
    print("T21 Handover notices for the tills")
    windowService.drain_handover_notices()          # start empty
    bar, bv, since = bar_for(db, cat, "T21 Bar")
    w = window_cut(db, alice, 3.0)
    y = checkout(db, bob, [cut(bar, bv, 4.0)])
    # Emptying the cart after the borrow would hand the bar over - but a dry run is rolled back.
    res = windowService.check_cart(db, w.windowId, FakeUser(alice), T.wm.WindowCartRequest(version=w.version, items=[]))
    check("a dry run that would hand the bar over tells nobody", res["ok"] and windowService.drain_handover_notices() == [], res)
    release(db, alice, w)
    notices = windowService.drain_handover_notices()
    want_no = db.exec(select(T.Order.order_no).where(T.Order.orderId == y.orderId)).one()
    got = [(n["window"], n["cashier"], [(o["orderId"], o["orderNo"], o["servedBy"]) for p in n["pieces"] for o in p["toOrders"]])
           for n in notices]
    check("one notice: the window, its cashier, and the order that now has the bar (with who served it)",
          got == [("Window 1", alice.username, [(y.orderId, want_no, str(bob.userId))])], got)
    w2 = window_cut(db, alice, 3.0)
    release(db, alice, w2)
    check("a window nobody borrowed from tells nobody", windowService.drain_handover_notices() == [])


# ── Phase 6 ──────────────────────────────────────────────────────────────────

def phase6(db, cat, alice, bob):
    print("I   The integrity check reports every provisional corruption, and only then")
    from core.inventory import offcutLedger as ledger
    set_flag_raw(db, "true")

    def errors(label_part):
        db.expire_all()
        return [e for e in integrity.check(db)["errors"] if label_part in e]

    def poke(row_id, **fields):
        with operation(db, "maintenance", actor=FakeUser(bob)):
            row = db.get(Offcut, row_id)
            for k, v in fields.items():
                setattr(row, k, v)
            db.add(row)
        db.commit()

    try:
        bar, bv, since = bar_for(db, cat, "I Bar")
        closed = window_cut(db, bob, 2.0)
        release(db, bob, closed)
        w = window_cut(db, alice, 3.0)
        row_id = db.exec(select(Offcut.offcutId).where(Offcut.product_id == bar.productId, Offcut.quantity > 0)).one()
        check("I0 a real window's 18ft: no provisional errors", errors("provisional") == [] and errors("held by") == [],
              integrity.check(db)["errors"][:3])

        poke(row_id, provisional_for=[w.orderId, closed.orderId])
        check("I1 a mark naming a closed window is reported", any(f"[{closed.orderId}], not an open sale window" in e for e in errors("not an open")),
              errors("provisional"))
        poke(row_id, provisional_for=[])
        check("I2 marks out of step with the pieces' ancestry are reported",
              any(f"marked provisional [] but its pieces depend on [{w.orderId}]" in e for e in errors("depend on")), errors("provisional"))
        poke(row_id, provisional_for=[w.orderId], held_by_order_id=w.orderId)
        check("I3 a held 1D row with the switch on is reported", any("is held by order" in e for e in errors("held by")), errors("held"))
        poke(row_id, held_by_order_id=None)
        set_flag_raw(db, "false")
        check("I4 marks while the switch is off are reported", any("provisional offcuts are off" in e for e in errors("are off")),
              errors("provisional"))
        set_flag_raw(db, "true")
        check("put back: no provisional errors", errors("provisional") == [] and errors("held by") == [], integrity.check(db)["errors"][:3])

        with operation(db, "maintenance", actor=FakeUser(bob)):
            root = ledger.mint_piece(db, product_id=bar.productId, variant_id=bv.variantId, pool_key="",
                                     geom=ledger.geom_1d(21.0), origin=ledger.ORIGIN_STOCK_UNIT, notes="test")
            whole = ledger.mint_piece(db, product_id=bar.productId, variant_id=bv.variantId, pool_key="",
                                      geom=ledger.geom_1d(21.0), origin=ledger.ORIGIN_REJOIN, parent=root, notes="test")
        db.commit()
        check("I5 a whole bar sitting in the offcut pool is reported",
              any(f"piece {whole.piece_id} is a whole 21 bar" in e for e in errors("whole")), errors("whole"))
        with operation(db, "maintenance", actor=FakeUser(bob)):
            for piece in (whole, root):
                ledger.retire_piece(db, db.get(type(piece), piece.piece_id), reason="test cleanup")
        db.commit()
        check("cleaned up: no whole-bar error", errors("whole") == [], errors("whole"))
        release(db, alice, w)
    finally:
        T.close_all(db)
        set_flag_raw(db, "false")


def phase3(db, cat, alice, bob):
    set_flag_raw(db, "true")
    try:
        for fn in (t11, r4, t14, t15):
            fn(db, cat, alice, bob)
    finally:
        T.close_all(db)
        set_flag_raw(db, "false")
    phase4(db, cat, alice, bob)


def phase2(db, cat, alice):
    bob = T.seed_user(db, "prov-bob")
    db.commit()
    set_flag_raw(db, "true")
    try:
        for fn in (t3, t4, t5, t6, t7, t9, t10, t12, t13):
            fn(db, cat, alice, bob)
    finally:
        T.close_all(db)
        set_flag_raw(db, "false")
    phase3(db, cat, alice, bob)


def main():
    with Session(engine) as db:
        T.reset(db)
        cat = Category(name="Provisional Offcuts", type="ke-profile", sub_categories=[])
        db.add(cat)
        user = T.seed_user(db, "prov-alice")
        db.commit()
        t1(db, cat, user)
        t2(db, cat, user)
        p1(db, cat, user)
        p2(db, cat, user)
        phase2(db, cat, user)

    print("\n" + "=" * 68)
    if failures:
        print(f"{len(failures)} FAILURE(S):")
        for f in failures:
            print(f"   - {f}")
        raise SystemExit(1)
    print("All provisional-offcut checks passed.")


if __name__ == "__main__":
    main()
