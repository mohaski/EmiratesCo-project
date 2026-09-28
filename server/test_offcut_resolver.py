"""
Offcut resolver (Phase 2) — proves the chain resolver fixes reversals the size-matching
code gets wrong.

Each scenario runs TWICE against identical starting state: once with the ledger on (the
resolver decides) and once with OFFCUT_LEDGER_ENABLED=0 (every event resolves as legacy,
so the old size-matching path runs). The assertions are on the DIFFERENCE, so each one
is a concrete statement about a bug that exists in production today.

  Scenario 1 — the phantom bar.
      Two bars each cut down to an identical 1.5 remainder, which the pooled `offcuts`
      table merges into one row {len 1.5, qty 2}. A later order cuts into ONE of them.
      Cancel the order whose remainder was eaten:
        legacy  -> finds a 1.5 row (the OTHER bar's), calls the remainder intact,
                   credits a whole 6.0 bar back and deletes the other bar's remainder
        ledger  -> sees its own remainder is held by a live order, credits only the
                   4.5 this cut actually used, and leaves the other bar alone

  Scenario 2 — the double-counted offcut.
      A 4.2 offcut is cut to 1.5 (remainder 2.7); a later order cuts the 2.7 down to
      1.7. Cancel the first:
        legacy  -> restores the whole 4.2 offcut AND leaves the later order's 1.7,
                   so 5.9 of material exists where there was 4.2. Caught by the
                   material-conservation check below.
        ledger  -> credits only the 1.5, conserving material exactly.

In-memory SQLite, same harness as test_offcut_ledger.py (including the AUTOINCREMENT
fix — without it SQLite recycles a deleted offcut row's id and the restore path
reattaches to unrelated material, which would mask exactly what is being measured).

    python test_offcut_resolver.py
"""
import os
from uuid import uuid4

from sqlmodel import Session, SQLModel, create_engine, select

from entities.offcutLedger import STATE_AVAILABLE, OffcutPiece
from entities.offcuts import Offcut
from entities.orderItems import OrderItem
from entities.orders import Order
from entities.products import Product
from entities.variants import Variant

from core.inventory import offcutLedger as ledger
from core.inventory.inventoryService import (
    deduct_stock_for_order_item,
    restore_stock_for_order_item,
)

FULL_BAR = 6.0
MIN_USABLE = 0.4
START_STOCK = 10

failures = []


def check(label, got, want):
    ok = got == want
    print(f"    [{'PASS' if ok else 'FAIL'}] {label}: got {got!r}, want {want!r}")
    if not ok:
        failures.append(label)


def make_db() -> Session:
    engine = create_engine("sqlite://")
    # See test_offcut_ledger.make_db: SQLite recycles the rowid of a deleted max row,
    # which Postgres SERIAL never does.
    SQLModel.metadata.tables["offcuts"].dialect_options["sqlite"]["autoincrement"] = True
    names = ("products", "variants", "attribute_classes", "offcuts", "orders",
             "orderitems", "offcut_pieces", "offcut_piece_events",
             "stock_input_session_items")
    SQLModel.metadata.create_all(engine, tables=[SQLModel.metadata.tables[n] for n in names])
    return Session(engine)


def seed(db, *, stock=START_STOCK):
    product = Product(name="Resolver Test Bar", category_id=1, stock_quantity=stock,
                      track_offcuts=True, has_variants=True)
    db.add(product)
    db.flush()
    variant = Variant(product_id=product.productId, name="", attributes={},
                      stock_quantity=stock, price=100.0, length=FULL_BAR,
                      min_usable=MIN_USABLE)
    db.add(variant)
    db.flush()
    return product, variant


def cut(db, product, variant, order_id, length):
    order = Order(orderId=order_id, servedby=uuid4(), customer_name=f"Customer {order_id}",
                  subtotal=0, total=0, status="confirmed", payment_status="Unpaid")
    db.add(order)
    db.flush()
    item = OrderItem(
        order_id=order_id, product_id=product.productId, variant_id=variant.variantId,
        total_price=0.0, status="purchased",
        details={"lineItems": [{"type": "accessory-cut", "qty": 1, "meta": {"length": length}}]},
    )
    db.add(item)
    db.flush()
    deduct_stock_for_order_item(db, item)
    db.flush()
    return item


def pool(db, product):
    """Every physical piece the pooled table currently claims, as (length, qty) pairs.
    Scrap counts — it is still material sitting in the shop."""
    rows = db.exec(
        select(Offcut).where(Offcut.product_id == product.productId, Offcut.quantity > 0)
        .order_by(Offcut.length.asc())
    ).all()
    return [(round(r.length, 4), r.quantity) for r in rows]


def pool_total(db, product) -> float:
    return round(sum(l * q for l, q in pool(db, product)), 4)


def sold_total(db, product) -> float:
    """Length committed to order items that are still live."""
    total = 0.0
    items = db.exec(select(OrderItem).where(OrderItem.product_id == product.productId)).all()
    for item in items:
        order = db.get(Order, item.order_id)
        if order is not None and order.status == "cancelled":
            continue
        for line in (item.details or {}).get("lineItems") or []:
            for src in line.get("offcut_sources") or []:
                total += float(src.get("length_used") or 0)
    return round(total, 4)


def conservation(db, product, variant, *, initial_pool: float) -> dict:
    """Material can be created or destroyed only by drawing bars from stock.

        initial_pool + bars_drawn * FULL_BAR  ==  pool_now + committed_to_live_orders

    A mismatch means the system's books disagree with the metal on the floor.
    """
    drawn = (START_STOCK - variant.stock_quantity) * FULL_BAR
    have = pool_total(db, product) + sold_total(db, product)
    return {"expected": round(initial_pool + drawn, 4), "actual": round(have, 4),
            "stock": variant.stock_quantity}


# ── Scenario 1: the phantom bar ───────────────────────────────────────────────

def scenario_phantom_bar(ledger_on: bool) -> dict:
    db = make_db()
    product, variant = seed(db)

    item_a = cut(db, product, variant, 501, 4.5)   # bar 1 -> remainder 1.5
    item_c = cut(db, product, variant, 502, 4.5)   # 1.5 can't fit 4.5 -> bar 2 -> remainder 1.5
    item_b = cut(db, product, variant, 503, 1.0)   # eats ONE of the two 1.5s -> remainder 0.5

    before = {
        "pool": pool(db, product),
        "stock": variant.stock_quantity,
        "conservation": conservation(db, product, variant, initial_pool=0.0),
    }

    # Which 1.5 did order B actually consume? claim_available_piece is FIFO, so it is
    # order A's (created first). Recorded here so the assertions can name it.
    a_rem_id = item_a.details["lineItems"][0]["offcut_sources"][0].get("remainder_piece_id")
    c_rem_id = item_c.details["lineItems"][0]["offcut_sources"][0].get("remainder_piece_id")

    restore_stock_for_order_item(db, item_a)
    db.get(Order, 501).status = "cancelled"
    db.flush()

    c_rem = db.get(OffcutPiece, c_rem_id) if c_rem_id else None
    return {
        "before": before,
        "pool": pool(db, product),
        "stock": variant.stock_quantity,
        "conservation": conservation(db, product, variant, initial_pool=0.0),
        "c_remainder_still_available": (c_rem.state == STATE_AVAILABLE) if c_rem else None,
        "a_rem_id": a_rem_id,
        "c_rem_id": c_rem_id,
        "b_item": item_b.item_id,
    }


# ── Scenario 2: the double-counted offcut ─────────────────────────────────────

def scenario_double_count(ledger_on: bool) -> dict:
    db = make_db()
    product, variant = seed(db)

    starting = Offcut(product_id=product.productId, variant_id=variant.variantId,
                      pool_key="", length=4.2, quantity=1, status="available")
    db.add(starting)
    db.flush()
    if ledger_on:
        ledger.mint_pieces_for_row(db, starting, origin=ledger.ORIGIN_MANUAL_ENTRY,
                                   notes="test seed")
        db.flush()

    item_a = cut(db, product, variant, 601, 1.5)   # consumes the 4.2 -> remainder 2.7
    cut(db, product, variant, 602, 1.0)            # consumes the 2.7 -> remainder 1.7

    restore_stock_for_order_item(db, item_a)
    db.get(Order, 601).status = "cancelled"
    db.flush()

    return {
        "pool": pool(db, product),
        "stock": variant.stock_quantity,
        "conservation": conservation(db, product, variant, initial_pool=4.2),
    }


def run(fn, ledger_on: bool):
    os.environ["OFFCUT_LEDGER_ENABLED"] = "1" if ledger_on else "0"
    try:
        return fn(ledger_on)
    finally:
        os.environ["OFFCUT_LEDGER_ENABLED"] = "1"


def main():
    print("=" * 70)
    print("SCENARIO 1 - the phantom bar")
    print("=" * 70)
    legacy = run(scenario_phantom_bar, False)
    modern = run(scenario_phantom_bar, True)

    print(f"\n  State before cancelling order A (identical in both runs):")
    print(f"    stock={modern['before']['stock']} pool={modern['before']['pool']}")
    print(f"    order B consumed order A's remainder (piece {modern['a_rem_id']}), "
          f"order C's (piece {modern['c_rem_id']}) is the same size and untouched")

    print(f"\n  LEGACY (size matching)  stock={legacy['stock']} pool={legacy['pool']}")
    print(f"  LEDGER (chain resolver) stock={modern['stock']} pool={modern['pool']}")

    print("\n  Legacy behaviour - the bug as it exists today:")
    check("legacy invents a whole bar in stock", legacy["stock"], 9)
    check("legacy deletes order C's untouched 1.5 remainder",
          [l for l, _ in legacy["pool"] if abs(l - 1.5) < 0.01], [])

    print("\n  Ledger behaviour - the fix:")
    check("stock is not credited a bar that does not exist", modern["stock"], 8)
    check("order C's 1.5 remainder is left alone",
          modern["c_remainder_still_available"], True)
    check("order A gets its own 4.5 back as an offcut instead",
          [l for l, _ in modern["pool"] if abs(l - 4.5) < 0.01], [4.5])
    check("ledger run conserves material",
          modern["conservation"]["actual"], modern["conservation"]["expected"])

    print("\n" + "=" * 70)
    print("SCENARIO 2 - the double-counted offcut")
    print("=" * 70)
    legacy2 = run(scenario_double_count, False)
    modern2 = run(scenario_double_count, True)

    print(f"\n  A 4.2 offcut was cut to 1.5 (rem 2.7); a later order cut that to 1.7.")
    print(f"  LEGACY  pool={legacy2['pool']} -> {legacy2['conservation']}")
    print(f"  LEDGER  pool={modern2['pool']} -> {modern2['conservation']}")

    print("\n  Legacy behaviour:")
    lc = legacy2["conservation"]
    check("legacy breaks material conservation", lc["actual"] > lc["expected"], True)
    check("legacy conjures 2.7 of extra material",
          round(lc["actual"] - lc["expected"], 4), 2.7)

    print("\n  Ledger behaviour:")
    mc = modern2["conservation"]
    check("ledger conserves material exactly", mc["actual"], mc["expected"])
    check("only this cut's own 1.5 is credited back",
          sorted(l for l, _ in modern2["pool"]), [1.5, 1.7])
    check("no bar was drawn from stock at any point", modern2["stock"], START_STOCK)

    print("\n" + "=" * 70)
    if failures:
        print(f"{len(failures)} FAILURE(S): " + ", ".join(failures))
        raise SystemExit(1)
    print("All resolver checks passed.")


if __name__ == "__main__":
    main()
