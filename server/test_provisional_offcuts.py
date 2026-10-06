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
from test_sale_windows import open_w, set_cart, release, stock, cut, FakeUser, FULL_BAR  # noqa: E402
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

    print("\n" + "=" * 68)
    if failures:
        print(f"{len(failures)} FAILURE(S):")
        for f in failures:
            print(f"   - {f}")
        raise SystemExit(1)
    print("All provisional-offcut checks passed.")


if __name__ == "__main__":
    main()
