"""Several pieces from one pooled offcut row.

Same-size offcuts share one `offcuts` row (quantity > 1). The cashier can now pick more than
one of them for a cut: each piece is its own offcut_selection entry naming the same row. This
checks every path that consumes, keeps or gives back such picks:

  1. checkout   - each entry takes ONE unit (distinct ledger pieces, remainders per piece)
  2. too many   - more entries than the row has units is refused, nothing taken
  3. edit       - an edit that keeps the line keeps both picks (remapped through the ledger)
  4. cancel     - every piece comes back; the bar material is conserved
  5. window     - a sale window holds them, survives a rebuild, gives them back on release
  6. picks + 'rest from a new bar' - the remainder is cut from a fresh bar, not an offcut

Integrity (pool <-> ledger, stock <-> journal, TRACE) is checked after every step.
Runs on emiratesco_edit_test (DATABASE_URL). Run from server/.
"""
import logging
import os
import sys
import uuid

sys.path.insert(0, os.getcwd())
logging.disable(logging.CRITICAL)

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
from test_sale_windows import FakeUser, open_w, set_cart, release, stock  # noqa: E402
from core.audit import integrity  # noqa: E402
from core.inventory.poolKey import compute_pool_key  # noqa: E402
from core.ordering import model, orderService  # noqa: E402
from core.settings.service import set_cancel_pin  # noqa: E402

failures = []


def check(label, ok, got=None):
    print(f"  [{'PASS' if ok else 'FAIL'}] {label}" + ("" if ok else f" — got {got!r}"))
    if not ok:
        failures.append(label)


def clean(db, label, since):
    db.expire_all()
    errs = integrity.check(db, since_journal_id=since)["errors"]
    check(f"{label}: integrity clean", errs == [], errs[:4])


def pooled_row(db, product, variant, length, qty):
    row = Offcut(product_id=product.productId, variant_id=variant.variantId, pool_key=compute_pool_key(db, variant),
                 length=length, quantity=qty, status="available")
    db.add(row)
    db.commit()
    return row.offcutId


def cut_with(product, variant, length, picks):
    return model.OrderItemRequest(productId=product.productId, variantId=variant.variantId, quantity=1,
                                  unitPrice=0, unitType="ft", details={"lineItems": [{
                                      "type": "profile-cut", "qty": 1, "meta": {"length": length}, "rate": 50.0,
                                      "offcut_selection": picks}]})


def checkout(db, user, items):
    return orderService.create_order(model.OrderCreate(
        servedBy=uuid.UUID(FakeUser(user).userId), status="confirmed", items=items, amountPaid=0), db, FakeUser(user))


def row_qty(db, row_id):
    db.expire_all()
    row = db.get(Offcut, row_id)
    return row.quantity if row is not None else 0


def sources_of(db, order_id):
    db.expire_all()
    item = db.exec(select(OrderItem).where(OrderItem.order_id == order_id)).one()
    return item.details["lineItems"][0].get("offcut_sources") or []


def material(db, product, variant):
    """Bar material in feet: whole bars + every offcut row (public or held)."""
    return M.total_length(db, product, variant)


with Session(engine) as db:
    T.reset(db)
    cat = Category(name="Multi Pick", type="ke-profile", sub_categories=[])
    db.add(cat)
    alice, bob = T.seed_user(db, "win-alice"), T.seed_user(db, "win-bob")
    db.commit()
    set_cancel_pin(db, "4321", M.manager(alice))
    db.commit()

    print("1. Checkout takes one unit per pick")
    bar, bv = T.seed_product(db, cat, "MP Bar", kind="bar", stock=2)
    row = pooled_row(db, bar, bv, 6.0, 3)
    since = integrity.journal_high_water(db)
    start = material(db, bar, bv)
    o = checkout(db, alice, [cut_with(bar, bv, 10.0, [{"offcut_id": row, "length_used": 6.0},
                                                     {"offcut_id": row, "length_used": 4.0}])])
    srcs = sources_of(db, o.orderId)
    check("two sources, both from the pooled row", [s.get("offcut_id") for s in srcs] == [row, row], srcs)
    check("...from two different ledger pieces", len({s.get("source_piece_id") for s in srcs}) == 2, srcs)
    check("the row lost exactly 2 of its 3 units", row_qty(db, row) == 1, row_qty(db, row))
    check("no whole bar was touched", stock(db, bv) == 2, stock(db, bv))
    check("material conserved (10ft sold, 2ft left over from the 6ft piece)",
          abs(material(db, bar, bv) + 10.0 - start) < 1e-6, (material(db, bar, bv), start))
    clean(db, "after checkout", since)

    print("2. More picks than the row has units are refused, nothing taken")
    before = (row_qty(db, row), stock(db, bv), material(db, bar, bv))
    try:
        checkout(db, alice, [cut_with(bar, bv, 6.0, [{"offcut_id": row, "length_used": 3.0},
                                                    {"offcut_id": row, "length_used": 3.0}])])
        check("refused", False, "accepted")
    except Exception as e:
        db.rollback()
        check("refused with a reason", getattr(e, "status_code", None) in (400, 409, 422), repr(e)[:160])
    check("nothing taken", (row_qty(db, row), stock(db, bv), material(db, bar, bv)) == before,
          ((row_qty(db, row), stock(db, bv), material(db, bar, bv)), before))
    clean(db, "after refusal", since)

    print("3. An edit that keeps the line keeps both picks")
    row2 = pooled_row(db, bar, bv, 5.0, 2)
    since = integrity.journal_high_water(db)
    o2 = checkout(db, bob, [cut_with(bar, bv, 9.0, [{"offcut_id": row2, "length_used": 5.0},
                                                   {"offcut_id": row2, "length_used": 4.0}])])
    check("both 5ft pieces used", row_qty(db, row2) == 0)
    loaded = orderService.get_order_by_orderId(o2.orderId, db)
    reqs = [model.OrderItemRequest(productId=i.productId, variantId=i.variantId, quantity=i.quantity,
                                   unitPrice=i.unitPrice, unitType=i.unitType, details=dict(i.details or {}))
            for i in loaded.items]
    # Add a second line so the edit runs, leaving the picked line as it was.
    reqs.append(model.OrderItemRequest(productId=bar.productId, variantId=bv.variantId, quantity=1, unitPrice=0,
                                       unitType="ft", details={"lineItems": [{"type": "profile-full", "qty": 1, "meta": {}, "rate": 100.0}]}))
    orderService.update_order(o2.orderId, model.OrderEditRequest(servedBy=uuid.UUID(FakeUser(bob).userId), items=reqs),
                              db, M.manager(bob))
    db.expire_all()
    items = db.exec(select(OrderItem).where(OrderItem.order_id == o2.orderId).order_by(OrderItem.position)).all()
    kept = [s for s in items[0].details["lineItems"][0].get("offcut_sources") or [] if s.get("source") == "offcut"]
    check("the picked line still cuts from two 5ft pieces", sorted(s.get("offcut_length") for s in kept) == [5.0, 5.0], kept)
    clean(db, "after edit", since)

    print("4. Cancel gives every piece back")
    mat_before = material(db, bar, bv)
    M.cancel_not_cut(db, o.orderId, alice)
    db.expire_all()
    six = sum(r.quantity for r in db.exec(select(Offcut).where(Offcut.product_id == bar.productId,
                                                                 Offcut.length == 6.0)).all())
    check("all three 6ft pieces are back in the pool", six == 3, six)
    check("material: the 10ft cut came back", abs(material(db, bar, bv) - (mat_before + 10.0)) < 1e-6,
          (material(db, bar, bv), mat_before))
    clean(db, "after cancel", since)

    print("5. A sale window holds two pieces of one row, keeps them through a rebuild, gives them back")
    wb, wv = T.seed_product(db, cat, "MP Window Bar", kind="bar", stock=1)
    wrow = pooled_row(db, wb, wv, 7.0, 2)
    since = integrity.journal_high_water(db)
    start = material(db, wb, wv)
    w = set_cart(db, alice, open_w(db, alice), [cut_with(wb, wv, 12.0, [{"offcut_id": wrow, "length_used": 7.0},
                                                                       {"offcut_id": wrow, "length_used": 5.0}])])
    check("window holds both 7ft pieces", row_qty(db, wrow) == 0, row_qty(db, wrow))
    w = set_cart(db, alice, w, [T.full(wb, wv, 1)] + [cut_with(wb, wv, 12.0, [{"offcut_id": wrow, "length_used": 7.0},
                                                                            {"offcut_id": wrow, "length_used": 5.0}])])
    db.expire_all()
    held = [i for i in db.exec(select(OrderItem).where(OrderItem.order_id == w.orderId)).all()
            if (i.details["lineItems"][0]["type"] == "profile-cut")]
    hs = [s for s in held[0].details["lineItems"][0].get("offcut_sources") or [] if s.get("source") == "offcut"]
    check("after a rebuild the cut still uses two 7ft pieces", sorted(s.get("offcut_length") for s in hs) == [7.0, 7.0], hs)
    release(db, alice, w)
    db.expire_all()
    seven = sum(r.quantity for r in db.exec(select(Offcut).where(Offcut.product_id == wb.productId,
                                                                   Offcut.length == 7.0)).all())
    check("released: both 7ft pieces back", seven == 2, seven)
    check("released: material exactly as before", abs(material(db, wb, wv) - start) < 1e-6, (material(db, wb, wv), start))
    check("released: the whole bar is back", stock(db, wv) == 1, stock(db, wv))
    clean(db, "after window", since)

    print("6. Picked offcuts + 'rest from a new bar': the remainder comes from a fresh bar")
    nb, nv = T.seed_product(db, cat, "MP NewBar", kind="bar", stock=3)
    pick = pooled_row(db, nb, nv, 6.0, 1)
    spare = pooled_row(db, nb, nv, 9.0, 1)    # would fit the 4ft remainder - must NOT be used
    pick2 = pooled_row(db, nb, nv, 6.0, 1)    # for the control sale below (made before `since`)
    since = integrity.journal_high_water(db)
    from core.inventory.inventoryService import check_line_items_feasible
    from entities.products import Product
    from entities.variants import Variant
    line = {"type": "profile-cut", "qty": 1, "meta": {"length": 10.0}, "source_pref": "new",
            "offcut_selection": [{"offcut_id": pick, "length_used": 6.0}]}
    res = check_line_items_feasible(db, db.get(Product, nb.productId), db.get(Variant, nv.variantId), [dict(line)])
    db.rollback()
    check("the stock check accepts picks + new bar", res["ok"], res)
    item = model.OrderItemRequest(productId=nb.productId, variantId=nv.variantId, quantity=1, unitPrice=0,
                                  unitType="ft", details={"lineItems": [line]})
    o6 = checkout(db, alice, [item])
    srcs = sources_of(db, o6.orderId)
    check("6ft from the picked offcut, 4ft from a NEW bar", [(s.get("source"), s.get("length_used")) for s in srcs]
          == [("offcut", 6.0), ("full_bar", 4.0)], [(s.get("source"), s.get("length_used")) for s in srcs])
    check("the spare 9ft offcut is untouched", row_qty(db, spare) == 1, row_qty(db, spare))
    check("one bar taken", stock(db, nv) == 2, stock(db, nv))
    clean(db, "after picks + new bar", since)
    # Control: the same picks WITHOUT the new-bar choice fill the remainder from the 9ft offcut.
    o7 = checkout(db, alice, [model.OrderItemRequest(productId=nb.productId, variantId=nv.variantId, quantity=1,
                                                     unitPrice=0, unitType="ft", details={"lineItems": [{
                                                         "type": "profile-cut", "qty": 1, "meta": {"length": 10.0},
                                                         "offcut_selection": [{"offcut_id": pick2, "length_used": 6.0}]}]})])
    srcs = sources_of(db, o7.orderId)
    check("control: without it the remainder comes from the 9ft offcut",
          [s.get("source") for s in srcs] == ["offcut", "offcut"] and row_qty(db, spare) == 0, srcs)
    check("control: no bar taken", stock(db, nv) == 2, stock(db, nv))
    M.cancel_not_cut(db, o6.orderId, alice)
    db.expire_all()
    check("cancelling the picks + new bar sale gives the bar and the 6ft back",
          stock(db, nv) == 3 and sum(r.quantity for r in db.exec(select(Offcut).where(
              Offcut.product_id == nb.productId, Offcut.length == 6.0)).all()) == 1, stock(db, nv))
    clean(db, "after cancelling it", since)

print()
print("ALL PASS" if not failures else f"{len(failures)} FAILED: {failures}")
sys.exit(1 if failures else 0)
