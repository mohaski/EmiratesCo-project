"""
Offcut ledger (Phase 1) — chain construction and the blocker query.

Unlike test_offcut_logic.py / test_glass_offcut_logic.py, this runs against an
in-memory SQLite database rather than the dev Postgres, so it never touches real
stock. Only the tables these paths actually read are created; `users` is left out
because it maps its id through the postgresql-specific UUID type, which will not
compile on SQLite. Nothing here needs it — SQLite does not enforce the
orders -> users FK, so an order can name a servedby id with no user row behind it.
`orders` itself IS needed: _pending_source_notice looks up the order behind a
not-yet-cut source item to name its customer.

What it proves:
  1. A cut off a fresh bar builds a chain:  bar(root) -> remainder
  2. A LATER order cutting that remainder extends the same chain, one bar deep
  3. blockers_for() reports the later order's consumption — i.e. "order A can no
     longer be given a whole bar back". This is the question the current
     dimension-matching restore cannot answer, and the reason the ledger exists.
  4. Cancelling the later order clears the blocker, so order A becomes
     reconstructable again with no retroactive bookkeeping.
  5. Phase 1 is behaviour-neutral: after both orders are reversed, stock and the
     pooled `offcuts` rows are exactly back where they started.

    python test_offcut_ledger.py
"""
from uuid import uuid4

from sqlmodel import Session, SQLModel, create_engine, select

from entities.attributes import AttributeClass
from entities.offcutLedger import (
    ORIGIN_CUT_REMAINDER,
    ORIGIN_STOCK_UNIT,
    STATE_AVAILABLE,
    STATE_CONSUMED,
    STATE_RETIRED,
    OffcutPiece,
    OffcutPieceEvent,
)
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
CUT_A = 1.8   # order A takes this off a fresh bar -> 4.2 remainder
CUT_B = 1.5   # order B (later) takes this off the 4.2 -> 2.7 remainder

failures = []


def check(label, got, want):
    ok = got == want
    print(f"  [{'PASS' if ok else 'FAIL'}] {label}: got {got!r}, want {want!r}")
    if not ok:
        failures.append(label)


def check_true(label, got):
    ok = bool(got)
    print(f"  [{'PASS' if ok else 'FAIL'}] {label}: {got!r}")
    if not ok:
        failures.append(label)


def make_db() -> Session:
    engine = create_engine("sqlite://")
    # SQLite recycles the rowid of a deleted max row; Postgres SERIAL never does.
    # Without AUTOINCREMENT, an offcut row deleted when a cut fully consumes it
    # (safe_delete_offcut) hands its id straight to the NEXT remainder row, and
    # restore_specific_offcut_sources' db.get(Offcut, oc_id) then silently
    # reattaches to an unrelated piece of material — a harness artifact that
    # cannot happen in production. Force monotonic ids so the test measures the
    # code rather than the dialect.
    SQLModel.metadata.tables["offcuts"].dialect_options["sqlite"]["autoincrement"] = True
    tables = [
        SQLModel.metadata.tables[name]
        for name in ("products", "variants", "attribute_classes", "offcuts",
                     "orders", "orderitems", "offcut_pieces", "offcut_piece_events",
                     # safe_delete_offcut detaches Stock Control lines before deleting a row
                     "stock_input_session_items",
                     # every flush journals into these (core/audit/journal.py)
                     "stock_operations", "stock_journal")
    ]
    SQLModel.metadata.create_all(engine, tables=tables)
    return Session(engine)


def make_order(db, order_id):
    """A minimal order row: _pending_source_notice resolves the customer name
    through it when a later cut consumes a still-uncut item's remainder."""
    order = Order(orderId=order_id, servedby=uuid4(), customer_name=f"Customer {order_id}",
                  subtotal=0, total=0, status="confirmed", payment_status="Unpaid")
    db.add(order)
    db.flush()
    return order


def cut_item(db, product, variant, order_id, length):
    item = OrderItem(
        order_id=order_id,
        product_id=product.productId,
        variant_id=variant.variantId,
        total_price=0.0,
        status="purchased",
        details={"lineItems": [{"type": "accessory-cut", "qty": 1, "meta": {"length": length}}]},
    )
    db.add(item)
    db.flush()
    deduct_stock_for_order_item(db, item)
    db.flush()
    return item


def pieces_of(db, product):
    return db.exec(
        select(OffcutPiece)
        .where(OffcutPiece.product_id == product.productId)
        .order_by(OffcutPiece.piece_id.asc())
    ).all()


# ── 2D glass ──────────────────────────────────────────────────────────────────

SHEET_W, SHEET_H = 2440.0, 1830.0
GLASS_A = (1200.0, 900.0)   # order C takes this off a fresh sheet
GLASS_B = (600.0, 400.0)    # order D (later) takes this out of one of C's remainders


def glass_item(db, product, variant, order_id, w, h):
    item = OrderItem(
        order_id=order_id,
        product_id=product.productId,
        variant_id=variant.variantId,
        total_price=0.0,
        status="purchased",
        details={"lineItems": [{"type": "glass-cut", "qty": 1,
                                "meta": {"l": w, "w": h, "u": "mm"}}]},
    )
    db.add(item)
    db.flush()
    deduct_stock_for_order_item(db, item)
    db.flush()
    return item


def glass_scenario(db):
    """The 2D analogue of the 1D chain: a sheet is guillotined into remainders, a
    later order cuts one of them, and the reversal has to tell the two apart."""
    print("\n--- 7. Glass: sheet -> remainders -> a later order cuts one ---")

    product = Product(name="Ledger Test Glass", category_id=1, stock_quantity=5,
                      track_offcuts=True, has_variants=True, has_dimensions=True)
    db.add(product)
    db.flush()
    # Sheet size lives in Variant.length x Variant.width, in mm — see
    # glassOffcutService._get_full_dims.
    variant = Variant(product_id=product.productId, name="", attributes={},
                      stock_quantity=5, price=100.0,
                      length=SHEET_W, width=SHEET_H, min_usable=200.0)
    db.add(variant)
    db.flush()
    start_stock = variant.stock_quantity

    make_order(db, 401)
    item_c = glass_item(db, product, variant, 401, *GLASS_A)

    pieces = pieces_of(db, product)
    sheet = next(p for p in pieces if p.origin == ORIGIN_STOCK_UNIT)
    remainders = [p for p in pieces if p.origin == ORIGIN_CUT_REMAINDER]

    check("sheet recorded as a root", (sheet.width, sheet.height), (SHEET_W, SHEET_H))
    check("sheet consumed by order C", sheet.consumed_by_item_id, item_c.item_id)
    check_true("guillotine left remainders", len(remainders) >= 1)
    check("every remainder hangs off the sheet",
          sorted({p.parent_piece_id for p in remainders}), [sheet.piece_id])
    check("remainders share the chain root",
          sorted({p.root_piece_id for p in remainders}), [sheet.piece_id])
    check("one sheet drawn from stock", variant.stock_quantity, start_stock - 1)

    src_c = item_c.details["lineItems"][0]["offcut_sources"][0]
    check("order C cut a fresh sheet", src_c["source"], "sheet")
    check("order C recorded its source piece", src_c["source_piece_id"], sheet.piece_id)
    check("recorded remainders match the ledger",
          len(src_c["remainders_created"]), len(remainders))

    # A later order cuts one of those remainders.
    make_order(db, 402)
    item_d = glass_item(db, product, variant, 402, *GLASS_B)

    src_d = item_d.details["lineItems"][0]["offcut_sources"][0]
    check("order D reused a remainder, no new sheet", src_d["source"], "offcut")
    check("no second sheet drawn", variant.stock_quantity, start_stock - 1)

    consumed = ledger.get_piece(db, src_d["source_piece_id"])
    check_true("order D consumed a piece of order C's sheet",
               consumed is not None and consumed.root_piece_id == sheet.piece_id)

    blockers = ledger.blockers_for(db, [p.piece_id for p in remainders],
                                   exclude_item_ids={item_c.item_id})
    check("order C is blocked by order D", len(blockers), 1)
    check("blocker names order D's item", blockers[0].consumed_by_item_id, item_d.item_id)

    # ── Cancel the later order, then the first ───────────────────────────────
    print("\n--- 8. Glass: cancel the later order, then the first ---")
    restore_stock_for_order_item(db, item_d)
    db.flush()
    blockers = ledger.blockers_for(db, [p.piece_id for p in remainders],
                                   exclude_item_ids={item_c.item_id})
    check("order C reconstructable again", len(blockers), 0)

    restore_stock_for_order_item(db, item_c)
    db.flush()
    db.refresh(variant)
    db.refresh(sheet)
    check("sheet back in stock", variant.stock_quantity, start_stock)
    check("the drawn sheet is retired", sheet.state, STATE_RETIRED)
    leftover = db.exec(
        select(Offcut).where(Offcut.product_id == product.productId, Offcut.quantity > 0)
    ).all()
    check("no orphan glass offcut rows", len(leftover), 0)


def main():
    db = make_db()

    product = Product(name="Ledger Test Bar", category_id=1, stock_quantity=5,
                      track_offcuts=True, has_variants=True)
    db.add(product)
    db.flush()
    variant = Variant(product_id=product.productId, name="", attributes={},
                      stock_quantity=5, price=100.0, length=FULL_BAR, min_usable=0.5)
    db.add(variant)
    db.flush()
    start_stock = variant.stock_quantity

    # ── 1. Order A cuts 1.8 off a fresh bar ───────────────────────────────────
    print(f"\n--- 1. Order A cuts {CUT_A} from a fresh {FULL_BAR} bar ---")
    make_order(db, 101)
    item_a = cut_item(db, product, variant, order_id=101, length=CUT_A)

    all_pieces = pieces_of(db, product)
    check("pieces recorded", len(all_pieces), 2)
    root = next(p for p in all_pieces if p.origin == ORIGIN_STOCK_UNIT)
    rem_a = next(p for p in all_pieces if p.origin == ORIGIN_CUT_REMAINDER)

    check("root is the whole bar", root.length, FULL_BAR)
    check("root consumed by order A's item", root.consumed_by_item_id, item_a.item_id)
    check("root state", root.state, STATE_CONSUMED)
    check("root is its own chain root", root.root_piece_id, root.piece_id)
    check("root depth", root.depth, 0)

    check("remainder length", round(rem_a.length, 4), round(FULL_BAR - CUT_A, 4))
    check("remainder's parent is the bar", rem_a.parent_piece_id, root.piece_id)
    check("remainder shares the chain root", rem_a.root_piece_id, root.piece_id)
    check("remainder depth", rem_a.depth, 1)
    check("remainder available", rem_a.state, STATE_AVAILABLE)
    check("order id denormalized onto the piece", rem_a.produced_by_order_id, 101)

    srcs_a = item_a.details["lineItems"][0]["offcut_sources"]
    check("order A source kind", srcs_a[0]["source"], "full_bar")
    check("order A recorded its source piece", srcs_a[0]["source_piece_id"], root.piece_id)

    # ── 2. Order B (later) cuts 1.5 off order A's remainder ───────────────────
    print(f"\n--- 2. Order B (later) cuts {CUT_B} from the {FULL_BAR - CUT_A} remainder ---")
    make_order(db, 202)
    item_b = cut_item(db, product, variant, order_id=202, length=CUT_B)

    db.refresh(rem_a)
    all_pieces = pieces_of(db, product)
    check("pieces recorded", len(all_pieces), 3)
    rem_b = next(p for p in all_pieces if p.depth == 2)

    srcs_b = item_b.details["lineItems"][0]["offcut_sources"]
    check("order B consumed an offcut, not a bar", srcs_b[0]["source"], "offcut")
    check("order B consumed order A's remainder", srcs_b[0]["source_piece_id"], rem_a.piece_id)
    check("order A's remainder now consumed", rem_a.state, STATE_CONSUMED)
    check("consumed by order B's item", rem_a.consumed_by_item_id, item_b.item_id)
    check("order B's remainder length", round(rem_b.length, 4), round(FULL_BAR - CUT_A - CUT_B, 4))
    check("chain is 3 deep off ONE bar", rem_b.root_piece_id, root.piece_id)
    check("stock only ever drew one bar", variant.stock_quantity, start_stock - 1)

    # ── 3. The blocker query: can order A still be given a whole bar back? ────
    print("\n--- 3. Blocker query for reversing order A ---")
    blockers = ledger.blockers_for(db, [rem_a.piece_id], exclude_item_ids={item_a.item_id})
    check("order A is blocked", len(blockers), 1)
    check("blocked by order B's item", blockers[0].consumed_by_item_id, item_b.item_id)
    # rem_a itself is the piece order B consumed, so the blocker surfaces one level up too.
    root_blockers = ledger.blockers_for(db, [root.piece_id], exclude_item_ids={item_a.item_id})
    check_true("walking from the bar finds it too", len(root_blockers) >= 1)

    descendants = ledger.descendants(db, root.piece_id)
    check("bar has 2 descendants", len(descendants), 2)
    chain = ledger.chain_for(db, rem_b.piece_id)
    check("chain_for returns the whole bar", len(chain["pieces"]), 3)
    check("chain roots at the bar", chain["root_piece_id"], root.piece_id)

    # ── 4. Cancel order B — the blocker should clear itself ───────────────────
    print("\n--- 4. Cancel order B ---")
    restore_stock_for_order_item(db, item_b)
    db.flush()
    db.refresh(rem_a)
    db.refresh(rem_b)

    check("order A's remainder released", rem_a.state, STATE_AVAILABLE)
    check("released, not still owned", rem_a.consumed_by_item_id, None)
    check("order B's remainder retired", rem_b.state, STATE_RETIRED)

    blockers = ledger.blockers_for(db, [rem_a.piece_id], exclude_item_ids={item_a.item_id})
    check("order A is reconstructable again", len(blockers), 0)

    events = db.exec(
        select(OffcutPieceEvent)
        .where(OffcutPieceEvent.piece_id == rem_a.piece_id)
        .order_by(OffcutPieceEvent.seq.asc())
    ).all()
    check("history appended, never rewritten",
          [e.event for e in events], ["created", "consumed", "released"])

    # ── 5. Cancel order A too — everything back where it started ─────────────
    print("\n--- 5. Cancel order A (behaviour-neutrality check) ---")
    restore_stock_for_order_item(db, item_a)
    db.flush()
    db.refresh(root)
    db.refresh(variant)

    check("bar back in stock", variant.stock_quantity, start_stock)
    check("the drawn bar is retired", root.state, STATE_RETIRED)
    leftover = db.exec(
        select(Offcut).where(Offcut.product_id == product.productId, Offcut.quantity > 0)
    ).all()
    check("no orphan offcut rows left behind", len(leftover), 0)
    check("no piece still claims to be available",
          len([p for p in pieces_of(db, product) if p.state == STATE_AVAILABLE]), 0)

    # ── 6. Kill switch ───────────────────────────────────────────────────────
    print("\n--- 6. Kill switch ---")
    import os
    os.environ["OFFCUT_LEDGER_ENABLED"] = "0"
    try:
        check("ledger disabled", ledger.ledger_enabled(), False)
        before = len(pieces_of(db, product))
        make_order(db, 303)
        item_c = cut_item(db, product, variant, order_id=303, length=CUT_A)
        check("no pieces written while off", len(pieces_of(db, product)), before)
        check("the cut itself still worked",
              item_c.details["lineItems"][0]["offcut_sources"][0]["source"], "full_bar")
    finally:
        os.environ["OFFCUT_LEDGER_ENABLED"] = "1"

    glass_scenario(db)

    print("\n" + "=" * 62)
    if failures:
        print(f"{len(failures)} FAILURE(S): " + ", ".join(failures))
        raise SystemExit(1)
    print("All ledger checks passed.")


if __name__ == "__main__":
    main()
