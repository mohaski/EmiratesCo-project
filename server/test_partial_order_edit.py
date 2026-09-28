"""
Editing one cut line must not disturb the others.

update_order used to tear down every item and rebuild it, so editing one line reversed and
re-cut ALL of them. Because a freshly created item starts with cutting_completed=False,
an already-cut line went straight back into the cutting queue for the floor to cut a second
time. It now matches the incoming cart against the order (_stock_signature) and only
touches items that actually changed.

Runs the REAL update_order through its whole path — financials, audit row, payment
recording — against in-memory SQLite, so this covers the rebuild as a whole and not just
the matcher.

    python test_partial_order_edit.py
"""
from datetime import datetime
from uuid import uuid4

from sqlmodel import Session, SQLModel, create_engine, select

from entities.offcuts import Offcut
from entities.orderItems import OrderItem
from entities.orders import Order
from entities.products import Product
from entities.variants import Variant

from core.inventory import reversalPlan as rp
from core.inventory.inventoryService import deduct_stock_for_order_item
from core.ordering import model, orderService

FULL_BAR = 6.0
START_STOCK = 20

failures = []


def check(label, got, want):
    ok = got == want
    print(f"    [{'PASS' if ok else 'FAIL'}] {label}: got {got!r}, want {want!r}")
    if not ok:
        failures.append(label)


class FakeUser:
    role = "manager"
    userId = uuid4()
    username = "tester"


def make_db() -> Session:
    engine = create_engine("sqlite://")
    # SQLite recycles the rowid of a deleted max row; Postgres SERIAL never does. Without
    # this, the replacement OrderItem is handed the id of the row the edit just deleted and
    # "was it replaced?" becomes unanswerable. Same reason as test_offcut_ledger does it for
    # offcuts.
    for t in ("offcuts", "orderitems"):
        SQLModel.metadata.tables[t].dialect_options["sqlite"]["autoincrement"] = True
    names = ("products", "variants", "attribute_classes", "offcuts", "orders", "orderitems",
             "offcut_pieces", "offcut_piece_events", "stock_input_session_items",
             "edit_history", "payments", "credits", "customers")
    SQLModel.metadata.create_all(engine, tables=[SQLModel.metadata.tables[n] for n in names])
    return Session(engine)


def seed_product(db, name):
    product = Product(name=name, category_id=1, stock_quantity=START_STOCK,
                      track_offcuts=True, has_variants=True)
    db.add(product)
    db.flush()
    variant = Variant(product_id=product.productId, name="", attributes={},
                      stock_quantity=START_STOCK, price=100.0, length=FULL_BAR, min_usable=0.4)
    db.add(variant)
    db.flush()
    return product, variant


def cut_line(length):
    return {"type": "accessory-cut", "qty": 1, "meta": {"length": length}}


def make_item(db, order_id, product, variant, length, price=500.0):
    item = OrderItem(
        order_id=order_id, product_id=product.productId, variant_id=variant.variantId,
        total_price=price, status="purchased",
        details={"lineItems": [cut_line(length)], "quantity": 1,
                 "unitType": "pcs", "unitPrice": price},
    )
    db.add(item)
    db.flush()
    deduct_stock_for_order_item(db, item)
    db.flush()
    return item


def item_request(product, variant, length, price=500.0):
    """The shape OrderContext.mapItemForBackend sends. Note it round-trips `details`
    straight back from the loaded order, offcut_sources and all — which is exactly why
    _stock_signature has to ignore those keys."""
    return model.OrderItemRequest(
        productId=product.productId, variantId=variant.variantId, quantity=1,
        unitPrice=price, unitType="pcs",
        details={"lineItems": [cut_line(length)], "quantity": 1,
                 "unitType": "pcs", "unitPrice": price},
    )


def edit_request(items, **kw):
    return model.OrderEditRequest(
        customerId=None, customerName="Edit Test", amountPaid=0.0, servedBy=FakeUser.userId,
        VAT_status=False, discount=0.0, paymentStatus="Unpaid", items=items, **kw)


def pool(db, product):
    rows = db.exec(select(Offcut).where(Offcut.product_id == product.productId,
                                       Offcut.quantity > 0).order_by(Offcut.length)).all()
    return [(round(r.length, 4), r.quantity) for r in rows]


def main():
    print("\n--- Two cut items, only the second is edited ---")
    db = make_db()
    prod_a, var_a = seed_product(db, "Bar A")
    prod_b, var_b = seed_product(db, "Bar B")

    order = Order(orderId=3001, servedby=FakeUser.userId, customer_name="Edit Test",
                  subtotal=1000, total=1000, amountPayed=1000, balance=0,
                  status="confirmed", payment_status="Paid")
    db.add(order)
    db.flush()

    item_a = make_item(db, 3001, prod_a, var_a, 1.8)   # left alone by the edit
    item_b = make_item(db, 3001, prod_b, var_b, 2.5)   # changed to 3.0
    for it in (item_a, item_b):
        it.cutting_completed = True
        it.cutting_completed_at = datetime.utcnow()
        db.add(it)
    db.commit()

    a_id, b_id = item_a.item_id, item_b.item_id
    a_pool_before, b_pool_before = pool(db, prod_a), pool(db, prod_b)
    a_stock_before, b_stock_before = var_a.stock_quantity, var_b.stock_quantity
    a_sources_before = item_a.details["lineItems"][0]["offcut_sources"]

    # The plan the edit itself builds: only item B is changing, so only B needs an answer.
    reused, reversing, unmatched = orderService._match_items(
        [item_a, item_b], [item_request(prod_a, var_a, 1.8), item_request(prod_b, var_b, 3.0)])
    # _match_items now also carries each request's cart index, so the order can record
    # OrderItem.position instead of leaving callers to infer it from item_id.
    check("item A is matched as unchanged", [oi.item_id for _, _, oi in reused], [a_id])
    check("item B is the only one being reversed", [oi.item_id for oi in reversing], [b_id])
    check("and the only request needing a fresh cut", len(unmatched), 1)

    plan = rp.build_plan(db, order, reversing_item_ids={b_id})
    by_item = {l["item_id"]: l for l in plan["lines"]}
    check("both cut lines are still listed", sorted(by_item), sorted([a_id, b_id]))
    check("item A's line is flagged as not reversing", by_item[a_id]["will_reverse"], False)
    check("so it needs no answer", by_item[a_id]["requires_explicit_answer"], False)
    check("item B's line does reverse", by_item[b_id]["will_reverse"], True)
    check("and must be answered", by_item[b_id]["requires_explicit_answer"], True)

    # Run the real edit.
    orderService.update_order(
        3001,
        edit_request(
            [item_request(prod_a, var_a, 1.8), item_request(prod_b, var_b, 3.0)],
            cutConfirmations={by_item[b_id]["line_ref"]: {
                "physicalState": rp.PHYS_ALREADY_CUT, "resolution": rp.RES_RETURN_TO_POOL}},
        ),
        db, FakeUser(),
    )

    items = {i.item_id: i for i in db.exec(select(OrderItem).where(OrderItem.order_id == 3001)).all()}
    print()
    check("item A's row survived the edit", a_id in items, True)
    check("item B's row was replaced", b_id in items, False)
    check("the order still has two items", len(items), 2)

    kept = items[a_id]
    check("item A is STILL marked cut — not re-queued for the floor",
          kept.cutting_completed, True)
    check("and kept its cutting timestamp", kept.cutting_completed_at is not None, True)
    check("its offcut_sources are intact", kept.details["lineItems"][0]["offcut_sources"],
          a_sources_before)
    check("product A's stock was never touched", var_a.stock_quantity, a_stock_before)
    check("product A's offcut pool is unchanged", pool(db, prod_a), a_pool_before)

    fresh = [i for k, i in items.items() if k != a_id][0]
    check("the replacement item needs cutting", fresh.cutting_completed, False)
    check("it cut the new 3.0 length",
          fresh.details["lineItems"][0]["meta"]["length"], 3.0)
    check("product B's pool did change", pool(db, prod_b) != b_pool_before, True)
    # B's reversal returned its cut 2.5 to the pool and left its 3.5 remainder alone; the
    # new 3.0 cut then fits that 3.5, so no fresh bar is drawn. This is the reuse the whole
    # confirmation flow is meant to enable, not a missed deduction.
    check("B reused the material its own reversal freed, drawing no new bar",
          var_b.stock_quantity, b_stock_before)
    check("leaving the returned 2.5 and the 3.0 cut's 0.5 remainder",
          pool(db, prod_b), [(0.5, 1), (2.5, 1)])

    # The cutting queue should now show this order for B only.
    pending = orderService.get_pending_cutting_orders(db, FakeUser())
    pending_items = [i["itemId"] for o in pending for i in o["items"]]
    check("only the replacement item is queued for cutting", pending_items, [fresh.item_id])

    # A price-only change must not move material either.
    print("\n--- A price-only edit moves no material ---")
    a_pool, b_pool = pool(db, prod_a), pool(db, prod_b)
    a_stock, b_stock = var_a.stock_quantity, var_b.stock_quantity
    orderService.update_order(
        3001,
        edit_request([item_request(prod_a, var_a, 1.8, price=900.0),
                      item_request(prod_b, var_b, 3.0, price=900.0)]),
        db, FakeUser(),
    )
    check("product A's pool is untouched by a reprice", pool(db, prod_a), a_pool)
    check("product B's pool is untouched by a reprice", pool(db, prod_b), b_pool)
    check("no stock moved for A", var_a.stock_quantity, a_stock)
    check("no stock moved for B", var_b.stock_quantity, b_stock)
    still = {i.item_id: i for i in db.exec(select(OrderItem).where(OrderItem.order_id == 3001)).all()}
    check("item A survived again", a_id in still, True)
    check("and is still marked cut", still[a_id].cutting_completed, True)

    print("\n" + "=" * 64)
    if failures:
        print(f"{len(failures)} FAILURE(S): " + ", ".join(failures))
        raise SystemExit(1)
    print("All partial-edit checks passed.")


if __name__ == "__main__":
    main()
