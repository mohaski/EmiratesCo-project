"""1D cut engine basics: best-fit offcut reuse, fresh-bar fallback, manual selections.

  1  3ft cut from an empty pool: a fresh 10ft bar, 7ft left
  2  6ft cut: taken from the 7ft offcut (best fit), stock unchanged, 1ft left
  3  5ft cut: nothing fits, a fresh bar, 5ft left beside the 1ft
  4  manual pick of 4ft from a 5ft offcut for a 9ft cut: the 5ft shortfall is topped up
     from a fresh bar; the two 1ft leftovers pool together
  5  a pick longer than the cut is refused
  6  a shortfall longer than a whole bar is refused
  7  the shortfall uses an unpicked offcut that fits before opening a bar

Runs against emiratesco_edit_test (it writes orders). Exits 1 on any failure.
"""
import os
import sys

from sqlmodel import Session, create_engine, select

from db.database import DATABASE_URL
from entities.offcuts import Offcut
from entities.orderItems import OrderItem
from entities.orders import Order
from entities.products import Category, Product
from entities.users import User
from entities.variants import Variant
from core.inventory.inventoryService import apply_manual_cut_selection, deduct_stock_for_order_item

failures = []


def check(label, got, want):
    ok = got == want
    print(f"  [{'PASS' if ok else 'FAIL'}] {label}" + ("" if ok else f" — got {got!r}, want {want!r}"))
    if not ok:
        failures.append(label)


def _clear(db, offs):
    # Through safe_delete_offcut with the ledger's pieces retired first, not a bare
    # db.delete: a raw delete leaves the pieces 'available' against a row that no longer
    # exists, which the reversal resolver would then treat as material it can hand back.
    from core.inventory import offcutLedger as _ledger
    from core.inventory.poolKey import safe_delete_offcut as _safe_delete
    for o in offs:
        _ledger.retire_pieces_for_row(db, o.offcutId, reason="test teardown")
        _safe_delete(db, o)


def _refuse_live_database():
    """These tests create REAL orders wherever DATABASE_URL points. Against the live
    database they land in the floor's cutting queue next to real work. Point DATABASE_URL
    at emiratesco_edit_test, or set ALLOW_LIVE_TESTS=1 to run against live deliberately."""
    from sqlalchemy import text
    from db.database import engine as _engine
    with _engine.connect() as c:
        name = c.execute(text("SELECT current_database()")).scalar()
    if name == "EmiratesCo_Database" and os.getenv("ALLOW_LIVE_TESTS") != "1":
        raise SystemExit(
            f"Refusing to run against the live database ({name}): this suite writes real "
            "orders into it. Set DATABASE_URL to emiratesco_edit_test, or ALLOW_LIVE_TESTS=1."
        )


def pool(db, product):
    """(length, quantity, status) of every row with stock, sorted."""
    db.expire_all()
    return sorted((round(o.length, 3), o.quantity, o.status)
                  for o in db.exec(select(Offcut).where(Offcut.product_id == product.productId,
                                                        Offcut.quantity > 0)).all())


def cut_item(db, order, p, v, length):
    item = OrderItem(order_id=order.orderId, product_id=p.productId, variant_id=v.variantId,
                     total_price=0, status="purchased",
                     details={"lineItems": [{"type": "accessory-cut", "qty": 1, "meta": {"length": length}}]})
    db.add(item)
    deduct_stock_for_order_item(db, item)
    db.commit()
    return item


def stock(db, v):
    db.expire_all()
    return db.get(Variant, v.variantId).stock_quantity


def seed_pool(db, p, v, stock_qty, lengths):
    _clear(db, db.exec(select(Offcut).where(Offcut.product_id == p.productId)).all())
    v.stock_quantity = stock_qty
    db.add(v)
    for length in lengths:
        db.add(Offcut(product_id=p.productId, variant_id=v.variantId, length=length, quantity=1))
    db.commit()


def row_of(db, p, length):
    return db.exec(select(Offcut).where(Offcut.product_id == p.productId, Offcut.quantity > 0,
                                        Offcut.length >= length - 0.01, Offcut.length <= length + 0.01)).first()


def test_logic():
    engine = create_engine(DATABASE_URL)
    with Session(engine) as db:
        # Just the id column: some old user rows carry a role value the enum no longer has.
        servedby = db.exec(select(User.userId)).first()
        if not servedby:
            raise RuntimeError("No users in the test DB - seed it first (tests/seed_ui_test_db.py)")
        cat = db.exec(select(Category)).first()
        if cat is None:
            cat = Category(name="Test Category", type="ke-profile", sub_categories=[])
            db.add(cat)
            db.commit()

        order = Order(servedby=servedby, subtotal=0, total=0)
        db.add(order)
        db.commit()

        p = db.exec(select(Product).where(Product.name == "Test Offcut Bar")).first()
        if not p:
            p = Product(name="Test Offcut Bar", category_id=cat.categoryId, stock_quantity=10,
                        track_offcuts=True, has_variants=True)
            db.add(p)
            db.commit()
        v = db.exec(select(Variant).where(Variant.product_id == p.productId)).first()
        if not v:
            v = Variant(product_id=p.productId, name="", attributes={}, stock_quantity=10, price=100.0)
        # min_usable must be set: the entity default is 150 (the 2D/mm default), which files
        # every bar remainder under 150ft as scrap. The app sets bars to 2ft; 1ft here keeps
        # the 1ft leftovers of tests 2 and 4 usable.
        v.stock_quantity, v.length, v.min_usable = 10, 10.0, 1.0
        p.stock_quantity = 10
        db.add_all([p, v])
        _clear(db, db.exec(select(Offcut).where(Offcut.product_id == p.productId)).all())
        db.commit()

        print("1  3ft cut from an empty pool")
        cut_item(db, order, p, v, 3.0)
        check("a fresh bar: stock 10 -> 9", stock(db, v), 9)
        check("7ft left", pool(db, p), [(7.0, 1, "available")])

        print("2  6ft cut")
        cut_item(db, order, p, v, 6.0)
        check("cut from the 7ft offcut: stock unchanged", stock(db, v), 9)
        check("1ft left", pool(db, p), [(1.0, 1, "available")])

        print("3  5ft cut")
        cut_item(db, order, p, v, 5.0)
        check("nothing fits: a fresh bar, stock 9 -> 8", stock(db, v), 8)
        check("1ft and 5ft left", pool(db, p), [(1.0, 1, "available"), (5.0, 1, "available")])

        print("4  Manual pick of 4ft from a 5ft offcut for a 9ft cut")
        seed_pool(db, p, v, 8, [1.0, 5.0])
        sources = apply_manual_cut_selection(
            db, p, v, selected_sources=[{"offcut_id": row_of(db, p, 5.0).offcutId, "length_used": 4.0}],
            required_total_length=9.0, full_length=10.0)
        db.commit()
        check("sources: the 5ft offcut, then a fresh bar",
              [(s["source"], s["length_used"]) for s in sources], [("offcut", 4.0), ("full_bar", 5.0)])
        check("the top-up drew one bar: stock 8 -> 7", stock(db, v), 7)
        check("the two 1ft leftovers pool together; the bar leaves 5ft",
              pool(db, p), [(1.0, 2, "available"), (5.0, 1, "available")])

        print("5  A pick longer than the cut")
        before = (stock(db, v), pool(db, p))
        try:
            apply_manual_cut_selection(
                db, p, v, selected_sources=[{"offcut_id": row_of(db, p, 1.0).offcutId, "length_used": 1.0}],
                required_total_length=0.5, full_length=10.0)
            check("refused", "accepted", "refused")
        except ValueError:
            db.rollback()
            check("refused", "refused", "refused")
        check("nothing moved", (stock(db, v), pool(db, p)), before)

        print("6  A shortfall longer than a whole bar")
        try:
            apply_manual_cut_selection(db, p, v, selected_sources=[], required_total_length=15.0, full_length=10.0)
            check("refused", "accepted", "refused")
        except ValueError:
            db.rollback()
            check("refused", "refused", "refused")
        check("nothing moved", (stock(db, v), pool(db, p)), before)

        print("7  The shortfall uses an unpicked offcut that fits")
        seed_pool(db, p, v, 8, [3.0, 6.0])
        sources = apply_manual_cut_selection(
            db, p, v, selected_sources=[{"offcut_id": row_of(db, p, 3.0).offcutId, "length_used": 3.0}],
            required_total_length=9.0, full_length=10.0)
        db.commit()
        check("sources: the picked 3ft, then the unpicked 6ft (no bar)",
              [(s["source"], s["length_used"]) for s in sources], [("offcut", 3.0), ("offcut", 6.0)])
        check("stock unchanged", stock(db, v), 8)
        check("both offcuts used up exactly", pool(db, p), [])


if __name__ == "__main__":
    _refuse_live_database()
    test_logic()
    print("\n" + ("All offcut-logic checks passed." if not failures else f"{len(failures)} FAILED: {failures}"))
    sys.exit(1 if failures else 0)
