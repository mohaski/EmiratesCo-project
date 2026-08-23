"""
Standalone smoke tests for the 2D glass offcut decision engine
(core/inventory/glassOffcutService.py), following the same direct-DB-session
pattern as test_offcut_logic.py.

Test fixture mirrors real has_dimensions=True products (perspex, Clear glass, etc.):
sheet size lives on Variant.length x Variant.width, always in millimeters,
regardless of what Product.unit says.

Run from the server directory:
    python test_glass_offcut_logic.py
"""

import time
from sqlmodel import Session, create_engine, select
from db.database import DATABASE_URL
from entities.products import Product
from entities.variants import Variant
from entities.offcuts import Offcut
from entities.orders import Order
from entities.orderItems import OrderItem
from entities.users import User
import core.inventory.glassOffcutService as gos
from core.inventory.products import service as products_service
from core.inventory.products.model import GlassCutPreviewCut


def _reset_product(db: Session):
    p = db.exec(select(Product).where(Product.name == "Test Glass Sheet")).first()
    if not p:
        p = Product(
            name="Test Glass Sheet", category_id=1, stock_quantity=10,
            track_offcuts=True, has_variants=True, has_dimensions=True, unit="mm",
        )
        db.add(p)
        db.commit()
        db.refresh(p)
    else:
        p.stock_quantity = 10
        p.track_offcuts = True
        p.has_dimensions = True
        db.add(p)
        db.commit()

    v = db.exec(select(Variant).where(Variant.product_id == p.productId)).first()
    if not v:
        # A realistic 2440x1830mm sheet (~8x6ft), matching real has_dimensions products.
        # min_usable/allow_rotation/popular_size_ranges are per-VARIANT (see
        # glassOffcutService.py) — this fixture's single variant carries all the
        # offcut-tuning knobs individual tests below configure.
        v = Variant(
            product_id=p.productId, name='', attributes={}, stock_quantity=10, price=100.0, length=2440.0, width=1830.0,
            min_usable=150.0, allow_rotation=True, popular_size_ranges=[],
        )
        db.add(v)
        db.commit()
        db.refresh(v)
    else:
        v.stock_quantity = 10
        v.length = 2440.0
        v.width = 1830.0
        v.min_usable = 150.0
        v.allow_rotation = True
        v.popular_size_ranges = []  # reset in case a prior interrupted run left this set
        db.add(v)
        db.commit()

    _clear_offcuts(db, p)
    db.refresh(p)
    db.refresh(v)
    return p, v


def _clear_offcuts(db: Session, p: Product):
    offs = db.exec(select(Offcut).where(Offcut.product_id == p.productId)).all()
    for o in offs:
        db.delete(o)
    db.commit()


def _mk_line(l, w, qty=1, unit="mm"):
    return {"type": "glass-cut", "qty": qty, "meta": {"l": l, "w": w, "u": unit}}


def test_1_uses_existing_offcut(db, p, v):
    print("\n--- Test 1: Cut fits inside an existing offcut ---")
    _clear_offcuts(db, p)
    db.add(Offcut(product_id=p.productId, variant_id=v.variantId, width=500.0, height=300.0, length=0.0, quantity=1, status="available"))
    db.commit()
    db.refresh(v)
    stock_before = v.stock_quantity

    line = _mk_line(300, 200)
    lines = [line]
    gos.resolve_glass_cut_lines(db, p, v, lines)
    db.commit()
    db.refresh(v)

    src = line["offcut_sources"][0]
    print(f"Source: {src}")
    assert src["source"] == "offcut", f"Expected offcut source, got {src['source']}"
    assert v.stock_quantity == stock_before, "Sheet stock should be untouched when an offcut covers the cut"

    remaining = db.exec(select(Offcut).where(Offcut.product_id == p.productId)).all()
    total_area = sum((o.width or 0) * (o.height or 0) * o.quantity for o in remaining)
    print(f"Remainders: {[(o.width, o.height, o.quantity, o.status) for o in remaining]}")
    expected_area = 500.0 * 300.0 - 300 * 200
    assert abs(total_area - expected_area) < 1.0, f"Area not conserved: {total_area} vs {expected_area}"
    print("PASS")


def test_2_falls_back_to_fresh_sheet(db, p, v):
    print("\n--- Test 2: No offcut fits -> fresh sheet consumed, remainder(s) created ---")
    _clear_offcuts(db, p)
    db.refresh(v)
    stock_before = v.stock_quantity

    line = _mk_line(1200, 800)  # fits the 2440x1830 sheet but no offcuts exist
    lines = [line]
    gos.resolve_glass_cut_lines(db, p, v, lines)
    db.commit()
    db.refresh(v)

    src = line["offcut_sources"][0]
    print(f"Source: {src}")
    assert src["source"] == "sheet"
    assert v.stock_quantity == stock_before - 1, f"Expected sheet stock -1, got {v.stock_quantity}"
    remaining = db.exec(select(Offcut).where(Offcut.product_id == p.productId)).all()
    print(f"Remainders: {[(o.width, o.height, o.status) for o in remaining]}")
    assert len(remaining) > 0, "Expected at least one remainder offcut from the fresh sheet"
    print("PASS")


def test_3_scrap_classification(db, p, v):
    print("\n--- Test 3: Sliver below min_usable is recorded as scrap ---")
    _clear_offcuts(db, p)
    db.refresh(v)

    # Cutting the full 2440mm length x 1800mm leaves a 2440x30mm strip on the only
    # possible split — well below the 150mm minimum usable dimension.
    line = _mk_line(2440, 1800)
    lines = [line]
    gos.resolve_glass_cut_lines(db, p, v, lines)
    db.commit()

    remaining = db.exec(select(Offcut).where(Offcut.product_id == p.productId)).all()
    print(f"Remainders: {[(o.width, o.height, o.status) for o in remaining]}")
    scrap = [o for o in remaining if o.status == "scrap"]
    assert len(scrap) >= 1, "Expected a scrap-classified remainder"
    for o in scrap:
        assert (o.width or 9999) < 150.0 or (o.height or 9999) < 150.0
    print("PASS")


def test_4_sales_history_no_longer_protects_offcuts(db, p, v, servedby):
    print("\n--- Test 4: sales history alone no longer protects an offcut (ProtectPopularStockAgent removed) ---")
    _clear_offcuts(db, p)

    # Same setup that used to prove ProtectPopularStockAgent worked: seed
    # purchase history so 400x300mm cuts have "sold" 5 times. With that agent
    # removed, this history must NOT influence which offcut gets cut — CEO
    # popular_size_ranges (see test_30/31) are the only thing that can protect
    # an offcut now, and none are configured on this product for this test.
    order = Order(servedby=servedby, subtotal=0, total=0)
    db.add(order)
    db.commit()
    db.refresh(order)
    seed_item = OrderItem(
        order_id=order.orderId, product_id=p.productId, variant_id=v.variantId,
        total_price=0, status="purchased",
        details={"lineItems": [{"type": "glass-cut", "qty": 5, "meta": {"l": 400, "w": 300, "u": "mm"}}]},
    )
    db.add(seed_item)
    db.commit()

    formerly_popular = Offcut(product_id=p.productId, variant_id=v.variantId, width=400.0, height=300.0, length=0.0, quantity=1, status="available")
    other = Offcut(product_id=p.productId, variant_id=v.variantId, width=450.0, height=300.0, length=0.0, quantity=1, status="available")
    db.add(formerly_popular)
    db.add(other)
    db.commit()
    db.refresh(formerly_popular)
    db.refresh(other)

    line = _mk_line(200, 200)
    lines = [line]
    gos.resolve_glass_cut_lines(db, p, v, lines)
    db.commit()

    src = line["offcut_sources"][0]
    print(f"Source: {src}")
    # No longer asserting avoidance of the historically-popular offcut — just
    # confirming the resolution succeeds and picks SOME valid offcut, proving
    # nothing crashes now that _score_protect_popular is gone.
    assert src["offcut_id"] in (formerly_popular.offcutId, other.offcutId)
    print("PASS")


def test_5_batches_largest_first(db, p, v):
    print("\n--- Test 5: Batch resolves largest cut first regardless of input order ---")
    _clear_offcuts(db, p)
    db.refresh(v)
    stock_before = v.stock_quantity

    # Sized so NEITHER assignment (big->offcut or small->offcut) produces a
    # remainder under the 150mm scrap threshold — isolates "largest first"
    # ordering behavior from scrap-avoidance (already covered by test_3), since
    # a scrap-producing assignment would otherwise get out-competed regardless
    # of which cut is larger.
    db.add(Offcut(product_id=p.productId, variant_id=v.variantId, width=1500.0, height=900.0, length=0.0, quantity=1, status="available"))
    db.commit()

    small_line = _mk_line(900, 600, qty=1)   # area 540000mm2 — listed FIRST in the array
    big_line = _mk_line(1200, 600, qty=1)    # area 720000mm2 — listed SECOND, but should resolve FIRST
    lines = [small_line, big_line]
    gos.resolve_glass_cut_lines(db, p, v, lines)
    db.commit()
    db.refresh(v)

    print(f"Small cut (900x600) source: {small_line['offcut_sources'][0]['source']}")
    print(f"Big cut (1200x600) source:   {big_line['offcut_sources'][0]['source']}")
    assert big_line["offcut_sources"][0]["source"] == "offcut", "Larger cut should claim the offcut when batched"
    assert small_line["offcut_sources"][0]["source"] == "sheet", "Smaller cut should fall back to a fresh sheet"
    assert v.stock_quantity == stock_before - 1
    print("PASS")


def test_6_restore(db, p, v):
    print("\n--- Test 6: Restore path reverses stock + offcut state ---")
    _clear_offcuts(db, p)
    db.refresh(v)
    stock_before = v.stock_quantity

    line = _mk_line(600, 300)  # forces a fresh sheet (no offcuts exist)
    lines = [line]
    gos.resolve_glass_cut_lines(db, p, v, lines)
    db.commit()
    db.refresh(v)
    assert v.stock_quantity == stock_before - 1

    offcuts_after_cut = {(o.width, o.height): o.quantity for o in db.exec(select(Offcut).where(Offcut.product_id == p.productId)).all()}
    print(f"Offcuts after cut: {offcuts_after_cut}")

    gos.restore_glass_cut_lines(db, p, v, lines)
    db.commit()
    db.refresh(v)

    assert v.stock_quantity == stock_before, f"Expected stock restored to {stock_before}, got {v.stock_quantity}"
    remaining = db.exec(select(Offcut).where(Offcut.product_id == p.productId)).all()
    print(f"Offcuts after restore: {[(o.width, o.height, o.quantity) for o in remaining]}")
    assert len(remaining) == 0, "Expected all remainder offcuts removed after restore"
    print("PASS")


def test_7_unit_conversion(db, p, v):
    print("\n--- Test 7: A cut entered in ft/inch converts to mm before matching an mm-native offcut ---")
    _clear_offcuts(db, p)
    db.refresh(v)
    stock_before = v.stock_quantity

    # 500mm x 300mm offcut. A cashier cut of "1ft x 0.5ft" (~304.8mm x 152.4mm)
    # should match against it after mm conversion, not be compared as raw "1x0.5".
    db.add(Offcut(product_id=p.productId, variant_id=v.variantId, width=500.0, height=300.0, length=0.0, quantity=1, status="available"))
    db.commit()

    line = _mk_line(1, 0.5, unit="ft")
    lines = [line]
    gos.resolve_glass_cut_lines(db, p, v, lines)
    db.commit()
    db.refresh(v)

    src = line["offcut_sources"][0]
    print(f"Source: {src} (cuts[0].width/height should be ~304.8/~152.4mm, not 1/0.5)")
    assert src["source"] == "offcut", f"Expected the ft-denominated cut to match the mm offcut, got {src['source']}"
    assert abs(src["cuts"][0]["width"] - 304.79999025) < 0.01
    assert v.stock_quantity == stock_before
    print("PASS")


def test_8_grid_packs_identical_pieces(db, p, v):
    print("\n--- Test 8: N identical pieces are grid-packed into one source, not split off one at a time ---")
    _clear_offcuts(db, p)

    # Reproduces the reported case exactly: a 2140x1650mm sheet, 2x 550x1200mm pieces
    # requested via one line's qty. Efficient nesting keeps them as ONE consumption
    # event (a shared 550x1200 -> effectively 1100x1200 grid block) leaving exactly
    # 2 remainders, not the 3 fragmented ones the old one-at-a-time path produced.
    v.length = 2140.0
    v.width = 1650.0
    db.add(v)
    db.commit()
    db.refresh(v)
    stock_before = v.stock_quantity

    line = _mk_line(550, 1200, qty=2)
    lines = [line]
    gos.resolve_glass_cut_lines(db, p, v, lines)
    db.commit()
    db.refresh(v)

    events = line["offcut_sources"]
    print(f"Events: {len(events)}")
    for e in events:
        print(f"  {e}")

    assert len(events) == 1, f"Expected both pieces packed into ONE event, got {len(events)}"
    event = events[0]
    assert event["source"] == "sheet"
    assert len(event["cuts"]) == 2, f"Expected 2 pieces in the single event, got {len(event['cuts'])}"
    assert v.stock_quantity == stock_before - 1, "Only one sheet should be consumed for both pieces"

    remaining = db.exec(select(Offcut).where(Offcut.product_id == p.productId)).all()
    print(f"Remainders: {[(o.width, o.height, o.status) for o in remaining]}")
    assert len(remaining) == 2, f"Expected exactly 2 remainder pieces (efficient nesting), got {len(remaining)}"

    # Restore the sheet's original dims so later fixture resets aren't affected
    v.length = 2440.0
    v.width = 1830.0
    db.add(v)
    db.commit()
    print("PASS")


def test_9_order_independent_of_lw_swap(db, p, v):
    print("\n--- Test 9: Swapping L and W for the same physical piece produces the identical cut layout ---")
    v.length = 2140.0
    v.width = 1650.0
    db.add(v)
    db.commit()
    db.refresh(v)

    def resolve(l, w):
        _clear_offcuts(db, p)
        line = _mk_line(l, w, qty=2)
        lines = [line]
        gos.resolve_glass_cut_lines(db, p, v, lines)
        db.rollback()  # discard — only comparing the computed layout, not persisting
        return line["offcut_sources"]

    events_a = resolve(550, 1200)   # L=550, W=1200
    events_b = resolve(1200, 550)   # L=1200, W=550 — same physical piece, swapped input

    def normalize(events):
        out = []
        for e in events:
            cuts_norm = sorted((round(c["width"]), round(c["height"]), round(c["x"]), round(c["y"])) for c in e["cuts"])
            rem_norm = sorted((r["status"], round(r["width"]), round(r["height"]), round(r["x"]), round(r["y"])) for r in e["remainders_created"])
            out.append((e["source"], cuts_norm, rem_norm))
        return out

    norm_a, norm_b = normalize(events_a), normalize(events_b)
    print(f"L=550,W=1200  -> {norm_a}")
    print(f"L=1200,W=550  -> {norm_b}")
    assert norm_a == norm_b, "Swapping L/W for the same physical piece should not change the computed cut layout"

    v.length = 2440.0
    v.width = 1830.0
    db.add(v)
    db.commit()
    _clear_offcuts(db, p)
    print("PASS")


def test_10_recursive_packing_fits_all_on_one_sheet(db, p, v):
    print("\n--- Test 10: Recursive packing mixes orientations to fit all pieces on ONE sheet ---")
    _clear_offcuts(db, p)

    # Reported case: a 2140x1650mm sheet, 4x 1200x550mm pieces via one line's qty.
    # A single uniform-orientation grid only fits 3 (leaving 1 that doesn't fit either
    # of its 2 remainders) — the old algorithm opened a SECOND sheet for the 4th piece.
    # Recursive packing (mixing orientations across levels) fits all 4 on one sheet,
    # matching cutlistoptimizer.com's reference layout (891,000mm2 total waste).
    v.length = 2140.0
    v.width = 1650.0
    db.add(v)
    db.commit()
    db.refresh(v)
    stock_before = v.stock_quantity

    line = _mk_line(1200, 550, qty=4)
    lines = [line]
    gos.resolve_glass_cut_lines(db, p, v, lines)
    db.commit()
    db.refresh(v)

    events = line["offcut_sources"]
    print(f"Events: {len(events)}")
    for e in events:
        print(f"  {e}")

    assert len(events) == 1, f"Expected all 4 pieces packed into ONE event, got {len(events)}"
    event = events[0]
    assert event["source"] == "sheet"
    assert len(event["cuts"]) == 4, f"Expected 4 pieces in the single event, got {len(event['cuts'])}"
    assert v.stock_quantity == stock_before - 1, "Only ONE sheet should be consumed for all 4 pieces"

    total_remainder_area = sum(r["width"] * r["height"] for r in event["remainders_created"])
    expected_waste = 2140.0 * 1650.0 - 4 * 1200.0 * 550.0
    print(f"Total remainder area: {total_remainder_area} (expected {expected_waste})")
    assert abs(total_remainder_area - expected_waste) < 1.0

    remaining = db.exec(select(Offcut).where(Offcut.product_id == p.productId)).all()
    print(f"Remainders in DB: {[(o.width, o.height, o.status) for o in remaining]}")

    v.length = 2440.0
    v.width = 1830.0
    db.add(v)
    db.commit()
    print("PASS")


def test_11_preview_consolidates_synthetic_offcut_chains(db, p, v):
    print("\n--- Test 11: Preview merges a same-preview offcut chain into one sheet, not two containers ---")
    _clear_offcuts(db, p)
    v.length = 2140.0
    v.width = 1650.0
    v.stock_quantity = 10
    db.add(v)
    db.commit()
    db.refresh(v)

    # Two separately-added cut lines where the second one's best source is a
    # remainder the first one's resolution just created within this SAME preview
    # (no pre-existing offcuts). The preview should show this as ONE sheet with
    # both pieces on it, not "New Sheet" + a second "Offcut #N" container.
    cuts = [
        GlassCutPreviewCut(l=1400, w=822, qty=2, u="mm"),
        GlassCutPreviewCut(l=542, w=1400, qty=1, u="mm"),
    ]
    response = products_service.preview_glass_cuts(p.productId, cuts, db, v.variantId)
    groups = response["groups"]
    print(f"Groups: {len(groups)}")
    for g in groups:
        print(f"  {g}")
    print(f"Optimization: winning_strategy={response['optimization']['winning_strategy']}, strategies_tried={response['optimization']['strategies_tried']}")

    assert len(groups) == 1, f"Expected both cut lines merged into ONE physical-sheet group, got {len(groups)}"
    group = groups[0]
    assert group["source"] == "sheet"
    assert len(group["cuts"]) == 3, f"Expected all 3 pieces (2+1) pooled into the one group, got {len(group['cuts'])}"

    # No two cuts should overlap once positions are translated into the sheet's own coordinates
    def overlaps(a, b):
        return not (
            a["x"] + a["width"] <= b["x"] or b["x"] + b["width"] <= a["x"]
            or a["y"] + a["height"] <= b["y"] or b["y"] + b["height"] <= a["y"]
        )
    cuts_flat = group["cuts"]
    for i in range(len(cuts_flat)):
        for j in range(i + 1, len(cuts_flat)):
            assert not overlaps(cuts_flat[i], cuts_flat[j]), f"Overlapping cuts after consolidation: {cuts_flat[i]} vs {cuts_flat[j]}"

    total_area = sum(c["width"] * c["height"] for c in group["cuts"]) + sum(r["width"] * r["height"] for r in group["remainders_created"])
    assert abs(total_area - 2140.0 * 1650.0) < 1.0, f"Area doesn't conserve after consolidation: {total_area}"

    v.length = 2440.0
    v.width = 1830.0
    db.add(v)
    db.commit()
    _clear_offcuts(db, p)
    print("PASS")


def test_12_joint_packing_shares_one_sheet_across_lines(db, p, v):
    print("\n--- Test 12: Two different-shape lines jointly share one sheet instead of opening two ---")
    _clear_offcuts(db, p)
    v.length = 2140.0
    v.width = 1650.0
    v.stock_quantity = 10
    db.add(v)
    db.commit()
    db.refresh(v)
    stock_before = v.stock_quantity

    # Exact reported scenario: line 1 (2x741x1345mm) + line 2 (2x905x650mm), no
    # pre-existing offcuts. The old sequential-per-line resolver opened a SECOND
    # sheet for line 2 because it could only reuse line 1's leftover for 1 of its
    # 2 pieces, and "fresh sheet satisfies both at once" used to outrank that —
    # zero sharing at all. Joint packing (a bounded greedy heuristic, not an
    # optimal nesting solver — see glassOffcutService module docstring) manages
    # to place 3 of the 4 pieces on one sheet here (both of line 1's plus one of
    # line 2's); the 4th doesn't fit that sheet's single remaining pocket and
    # legitimately needs a second sheet. What's guaranteed and asserted here is
    # that genuine cross-line sharing happens — not a specific final sheet count,
    # since that depends on how well pieces happen to nest for a given order.
    line1 = _mk_line(741, 1345, qty=2)
    line2 = _mk_line(905, 650, qty=2)
    lines = [line1, line2]
    gos.resolve_glass_cut_lines(db, p, v, lines)
    db.commit()
    db.refresh(v)

    print(f"Line 1 events: {line1['offcut_sources']}")
    print(f"Line 2 events: {line2['offcut_sources']}")

    # At least one of line 2's events must be a "shared" (non-owning) event
    # referencing the SAME group_id as one of line 1's events — proving they
    # came from one joint packing operation, not two fully independent sheets.
    line1_group_ids = {e["group_id"] for e in line1["offcut_sources"]}
    line2_group_ids = {e["group_id"] for e in line2["offcut_sources"]}
    shared_group_ids = line1_group_ids & line2_group_ids
    assert shared_group_ids, "Expected line 1 and line 2 to share at least one physical sheet-opening event"

    shared_line2_events = [e for e in line2["offcut_sources"] if not e["owns_consumption"]]
    assert shared_line2_events, "Expected at least one of line 2's events to be a non-owning (shared) event"

    sheets_consumed = stock_before - v.stock_quantity
    print(f"Sheets consumed: {sheets_consumed} (down from 2 with zero sharing, before this fix)")

    total_pieces = sum(len(e["cuts"]) for e in line1["offcut_sources"]) + sum(len(e["cuts"]) for e in line2["offcut_sources"])
    assert total_pieces == 4, f"Expected all 4 pieces (2+2) accounted for, got {total_pieces}"

    v.length = 2440.0
    v.width = 1830.0
    db.add(v)
    db.commit()
    _clear_offcuts(db, p)
    print("PASS")


def test_13_restore_after_joint_packing(db, p, v):
    print("\n--- Test 13: Restoring a joint-packed order item returns to the exact pre-order state ---")
    _clear_offcuts(db, p)
    v.length = 2140.0
    v.width = 1650.0
    v.stock_quantity = 10
    db.add(v)
    db.commit()
    db.refresh(v)
    stock_before = v.stock_quantity
    offcuts_before = sorted((o.width, o.height, o.quantity, o.status) for o in db.exec(select(Offcut).where(Offcut.product_id == p.productId)).all())

    line1 = _mk_line(741, 1345, qty=2)
    line2 = _mk_line(905, 650, qty=2)
    lines = [line1, line2]
    gos.resolve_glass_cut_lines(db, p, v, lines)
    db.commit()
    db.refresh(v)
    print(f"Stock after resolve: {v.stock_quantity} (before: {stock_before})")

    gos.restore_glass_cut_lines(db, p, v, lines)
    db.commit()
    db.refresh(v)

    offcuts_after = sorted((o.width, o.height, o.quantity, o.status) for o in db.exec(select(Offcut).where(Offcut.product_id == p.productId)).all())
    print(f"Stock after restore: {v.stock_quantity} (expected {stock_before})")
    print(f"Offcuts after restore: {offcuts_after} (expected {offcuts_before})")
    assert v.stock_quantity == stock_before, "Stock should return to exactly the pre-order value"
    assert offcuts_after == offcuts_before, "Offcuts should return to exactly the pre-order state"

    v.length = 2440.0
    v.width = 1830.0
    db.add(v)
    db.commit()
    print("PASS")


def test_14_multi_strategy_never_worse_than_baseline(db, p, v):
    print("\n--- Test 14: Multi-strategy search never uses more sheets than the baseline strategy alone ---")
    _clear_offcuts(db, p)
    v.length = 2140.0
    v.width = 1650.0
    v.stock_quantity = 10
    db.add(v)
    db.commit()
    db.refresh(v)
    stock_before = v.stock_quantity

    # Run the single baseline strategy directly (bypassing the multi-strategy
    # orchestrator) to establish what the OLD single-pass behavior would give.
    baseline_lines = [_mk_line(741, 1345, qty=2), _mk_line(905, 650, qty=2)]
    gos._resolve_with_strategy(db, p, v, baseline_lines, gos.DEFAULT_STRATEGY)
    baseline_sheets = stock_before - v.stock_quantity
    db.rollback()
    db.refresh(v)
    print(f"Baseline (single strategy) sheets consumed: {baseline_sheets}")

    # Now run the real multi-strategy orchestrator on the identical scenario.
    lines = [_mk_line(741, 1345, qty=2), _mk_line(905, 650, qty=2)]
    gos.resolve_glass_cut_lines(db, p, v, lines)
    db.commit()
    db.refresh(v)
    multi_sheets = stock_before - v.stock_quantity
    print(f"Multi-strategy sheets consumed: {multi_sheets}")

    assert multi_sheets <= baseline_sheets, (
        f"Multi-strategy search should never do worse than the single baseline strategy "
        f"({multi_sheets} sheets vs baseline's {baseline_sheets})"
    )
    if multi_sheets < baseline_sheets:
        print(f"Multi-strategy search improved on the baseline: saved {baseline_sheets - multi_sheets:.0f} sheet(s)")
    else:
        print("Multi-strategy search matched the baseline for this scenario (no strategy found a better layout)")

    v.length = 2440.0
    v.width = 1830.0
    db.add(v)
    db.commit()
    _clear_offcuts(db, p)
    print("PASS")


def test_15_savepoint_trials_leave_no_trace(db, p, v):
    print("\n--- Test 15: Rolled-back strategy trials leave no stray rows behind ---")
    _clear_offcuts(db, p)
    v.length = 2140.0
    v.width = 1650.0
    v.stock_quantity = 10
    db.add(v)
    db.commit()
    db.refresh(v)

    line1 = _mk_line(741, 1345, qty=2)
    line2 = _mk_line(905, 650, qty=2)
    lines = [line1, line2]
    gos.resolve_glass_cut_lines(db, p, v, lines)
    db.commit()
    db.refresh(v)

    # Every offcut actually in the DB must be traceable to a remainder recorded
    # by an OWNING event in the final result — nothing left over from any of the
    # 4 losing (rolled-back) strategy trials that ran before the winner.
    expected_ids = set()
    for line in lines:
        for e in line["offcut_sources"]:
            if e.get("owns_consumption", True):
                for r in e.get("remainders_created", []):
                    expected_ids.add(r["offcut_id"])

    actual = db.exec(select(Offcut).where(Offcut.product_id == p.productId)).all()
    actual_ids = {o.offcutId for o in actual}
    print(f"Expected offcut ids from the winning strategy's events: {sorted(expected_ids)}")
    print(f"Actual offcut ids in the DB: {sorted(actual_ids)}")
    assert actual_ids == expected_ids, "DB contains offcuts not accounted for by the winning strategy (stray trial rows) or is missing expected ones"

    gos.restore_glass_cut_lines(db, p, v, lines)
    db.commit()
    v.length = 2440.0
    v.width = 1830.0
    db.add(v)
    db.commit()
    _clear_offcuts(db, p)
    print("PASS")


def test_16_multi_strategy_timing_sanity(db, p, v):
    print("\n--- Test 16: Multi-strategy resolution timing sanity check ---")
    _clear_offcuts(db, p)
    v.length = 2140.0
    v.width = 1650.0
    v.stock_quantity = 20
    db.add(v)
    db.commit()
    db.refresh(v)

    lines = [_mk_line(741, 1345, qty=2), _mk_line(905, 650, qty=2), _mk_line(300, 400, qty=3)]
    start = time.perf_counter()
    gos.resolve_glass_cut_lines(db, p, v, lines)
    elapsed = time.perf_counter() - start
    db.commit()
    db.refresh(v)

    print(f"Multi-strategy resolution (5 strategies x multi-line pool) took {elapsed*1000:.1f}ms")
    assert elapsed < 5.0, f"Resolution took {elapsed:.2f}s — unexpectedly slow for a POS checkout path"

    v.length = 2440.0
    v.width = 1830.0
    db.add(v)
    db.commit()
    _clear_offcuts(db, p)
    print("PASS")


def test_17_multi_strategy_order_independent_of_lw_swap(db, p, v):
    print("\n--- Test 17: Multi-strategy search stays L/W-order-independent for a multi-line pool ---")
    v.length = 2140.0
    v.width = 1650.0
    v.stock_quantity = 10
    db.add(v)
    db.commit()
    db.refresh(v)

    # The multi-strategy need_key functions rank DIFFERENT LINES against each
    # other (unlike the earlier single-need fix, which only had to worry about
    # orientation tie-breaks within one need) — a real regression risk: if a
    # need_key uses raw piece_w/piece_h instead of canonical max/min, swapping
    # L/W on just ONE line changes its ranking relative to the other line,
    # changing which strategy wins overall.
    def resolve(l1, w1, l2, w2):
        _clear_offcuts(db, p)
        line1 = _mk_line(l1, w1, qty=2)
        line2 = _mk_line(l2, w2, qty=2)
        lines = [line1, line2]
        gos.resolve_glass_cut_lines(db, p, v, lines)
        db.rollback()
        return lines

    def normalize(lines):
        out = []
        for line in lines:
            for e in line["offcut_sources"]:
                cuts = sorted((round(c["width"]), round(c["height"]), round(c["x"]), round(c["y"])) for c in e["cuts"])
                out.append((e["source"], cuts, e["owns_consumption"]))
        return sorted(out, key=str)

    lines_a = resolve(741, 1345, 905, 650)
    lines_b = resolve(1345, 741, 905, 650)  # line 1's L/W swapped, same physical piece

    norm_a, norm_b = normalize(lines_a), normalize(lines_b)
    print(f"L=741,W=1345  -> {norm_a}")
    print(f"L=1345,W=741  -> {norm_b}")
    assert norm_a == norm_b, "Swapping L/W on one line should not change the multi-strategy result"

    v.length = 2440.0
    v.width = 1830.0
    db.add(v)
    db.commit()
    _clear_offcuts(db, p)
    print("PASS")


def test_18_sellability_score_reflects_ceo_popular_ranges(db, p, v):
    print("\n--- Test 18: total_sellability_score/is_popular reflect CEO popular_size_ranges, not sales history ---")
    _clear_offcuts(db, p)
    v.length = 2440.0
    v.width = 1830.0
    v.stock_quantity = 10
    v.popular_size_ranges = []
    db.add(v)
    db.add(p)
    db.commit()
    db.refresh(v)
    db.refresh(p)

    # Baseline: no CEO popular_size_ranges configured -> sellability score must
    # be exactly 0. Cutting 1200x800 from the 2440x1830 sheet leaves remainders
    # (2440x1030) and (1240x800).
    line = _mk_line(1200, 800, qty=1)
    metrics_before = gos._resolve_with_strategy(db, p, v, [dict(line)], gos.DEFAULT_STRATEGY)
    db.rollback()
    print(f"No ranges configured: total_sellability_score={metrics_before['total_sellability_score']} (expected 0)")
    assert metrics_before["total_sellability_score"] == 0.0

    # Configure a CEO range low enough that the 1240x800 remainder clears it
    # (_meets_popular_threshold only checks the lower bound -- "popular-sized
    # or larger", not a ceiling -- so this is a deliberately permissive range).
    v.popular_size_ranges = [{"min_w": 1200, "max_w": 1300, "min_h": 750, "max_h": 850}]
    db.add(v)
    db.commit()
    db.refresh(v)

    line2 = _mk_line(1200, 800, qty=1)
    metrics_after = gos._resolve_with_strategy(db, p, v, [dict(line2)], gos.DEFAULT_STRATEGY)
    db.rollback()
    print(f"With CEO range configured: total_sellability_score={metrics_after['total_sellability_score']} (expected > 0)")
    assert metrics_after["total_sellability_score"] > 0.0

    # And the full resolve_glass_cut_lines path should also expose it per-trial
    # in the optimization summary, and tag the matching remainder is_popular=True.
    line3 = _mk_line(1200, 800, qty=1)
    lines = [line3]
    summary = gos.resolve_glass_cut_lines(db, p, v, lines)
    db.commit()
    db.refresh(v)
    print(f"Optimization summary trial scores: {[(t['name'], t['total_sellability_score']) for t in summary['trials']]}")
    assert any(t["total_sellability_score"] > 0 for t in summary["trials"])

    popular_remainders = [r for e in line3["offcut_sources"] for r in e.get("remainders_created", []) if r.get("is_popular")]
    print(f"Remainders tagged is_popular: {popular_remainders}")
    assert popular_remainders, "Expected at least one remainder tagged is_popular under the CEO range"

    gos.restore_glass_cut_lines(db, p, v, lines)
    db.commit()
    v.popular_size_ranges = []
    db.add(v)
    db.commit()
    _clear_offcuts(db, p)
    print("PASS")


def test_19_small_offcut_before_large_offcut(db, p, v):
    print("\n--- Test 19: A small matching offcut is used before a large one, which is left mostly whole ---")
    _clear_offcuts(db, p)
    db.refresh(v)

    # Reported case: a 1650x1020mm offcut and a 450x1120mm offcut both exist, and
    # an order needs two 400x1070mm cuts. The 450x1120 offcut only fits ONE such
    # cut; the 1650x1020 offcut (rotated) fits BOTH. Before this fix, the engine
    # always grabbed whichever offcut could place the most pieces at once, so
    # both cuts came from the large offcut and the small one sat untouched.
    # Desired: one cut from each offcut, and the large offcut ends up as ONE
    # big remaining piece (not fragmented into two by taking both cuts).
    small = Offcut(product_id=p.productId, variant_id=v.variantId, width=450.0, height=1120.0, length=0.0, quantity=1, status="available")
    large = Offcut(product_id=p.productId, variant_id=v.variantId, width=1650.0, height=1020.0, length=0.0, quantity=1, status="available")
    db.add(small)
    db.add(large)
    db.commit()
    db.refresh(small)
    db.refresh(large)

    line = _mk_line(400, 1070, qty=2)
    lines = [line]
    gos.resolve_glass_cut_lines(db, p, v, lines)
    db.commit()

    events = [e for e in line["offcut_sources"] if e.get("owns_consumption", True)]
    print(f"Events: {events}")
    sources_used = {e["offcut_id"] for e in events}
    assert sources_used == {small.offcutId, large.offcutId}, (
        f"Expected one event from each offcut ({small.offcutId}, {large.offcutId}), got sources {sources_used}"
    )

    small_event = next(e for e in events if e["offcut_id"] == small.offcutId)
    large_event = next(e for e in events if e["offcut_id"] == large.offcutId)
    assert len(small_event["cuts"]) == 1, f"Expected exactly 1 cut from the small offcut, got {len(small_event['cuts'])}"
    assert len(large_event["cuts"]) == 1, f"Expected exactly 1 cut from the large offcut, got {len(large_event['cuts'])}"

    remaining = db.exec(select(Offcut).where(Offcut.product_id == p.productId)).all()
    print(f"Remainders in DB: {[(o.width, o.height, o.status) for o in remaining]}")
    large_remainders = large_event["remainders_created"]
    biggest = max((r["width"] * r["height"] for r in large_remainders), default=0)
    print(f"Large offcut's biggest remaining piece: {biggest}mm2")
    assert biggest > 500_000, "Expected the large offcut to be left mostly whole as one big remaining piece"
    print("PASS")


def test_20_correct_offcut_event(db, p, v):
    print("\n--- Test 20: Manager correction reverses the old remainder, applies the corrected one ---")
    _clear_offcuts(db, p)
    db.refresh(v)

    line = _mk_line(600, 300)  # forces a fresh sheet, leaves one big remainder
    lines = [line]
    gos.resolve_glass_cut_lines(db, p, v, lines)
    db.commit()

    event = next(e for e in line["offcut_sources"] if e.get("owns_consumption", True))
    old_remainders = list(event["remainders_created"])
    assert len(old_remainders) >= 1, "Expected at least one remainder to correct"

    # Manager says: the sheet actually cracked and only a smaller piece was salvageable
    new_remainders = [{"width": 400.0, "height": 250.0, "status": "available"}]
    result = gos.correct_glass_offcut_event(db, p, v, event, new_remainders)
    db.commit()
    print(f"Before: {result['before']}")
    print(f"After: {result['after']}")

    remaining = db.exec(select(Offcut).where(Offcut.product_id == p.productId)).all()
    print(f"Offcuts in DB after correction: {[(o.width, o.height, o.quantity, o.status) for o in remaining]}")

    for r in old_remainders:
        match = [
            o for o in remaining
            if o.status == r.get("status", "available")
            and abs((o.width or 0) - r["width"]) < 1.0 and abs((o.height or 0) - r["height"]) < 1.0
        ]
        assert not match, f"Old remainder {r} should have been reversed, found {match}"

    corrected = [
        o for o in remaining
        if o.status == "available" and abs((o.width or 0) - 400.0) < 1.0 and abs((o.height or 0) - 250.0) < 1.0
    ]
    assert corrected and corrected[0].quantity == 1, "Expected the corrected 400x250 offcut to exist with quantity 1"
    assert event["remainders_created"] == result["after"], "Event should be mutated in place to the corrected remainders"
    print("PASS")


def test_21_correct_offcut_rejects_invalid_input(db, p, v):
    print("\n--- Test 21: Correction rejects non-2D events, non-owner events, and bad dimensions ---")
    _clear_offcuts(db, p)

    try:
        gos.correct_glass_offcut_event(db, p, v, {"remainders_created": []}, [{"width": 100, "height": 100}])
        assert False, "Expected ValueError for a non-2D event (missing 'cuts')"
    except ValueError:
        pass

    fake_event = {"cuts": [], "remainders_created": [{"width": 100, "height": 100, "status": "available"}], "owns_consumption": False}
    try:
        gos.correct_glass_offcut_event(db, p, v, fake_event, [{"width": 100, "height": 100}])
        assert False, "Expected ValueError for a non-owning event"
    except ValueError:
        pass

    owner_event = {"cuts": [], "remainders_created": [], "owns_consumption": True}
    try:
        gos.correct_glass_offcut_event(db, p, v, owner_event, [{"width": 0, "height": 100}])
        assert False, "Expected ValueError for a non-positive dimension"
    except ValueError:
        pass

    print("PASS")


def test_22_no_forced_split_when_neither_scrap_nor_big_waste_is_at_stake(db, p, v):
    print("\n--- Test 22: A small offcut is NOT used when the big offcut's remainder is neither scrap nor a big-waste chunk ---")
    _clear_offcuts(db, p)
    db.refresh(v)

    # One 400x300 cut. The 450x850 offcut leaves a scrap sliver (50x300) plus a
    # perfectly ordinary 450x550 remainder -- non-scrap, but ALSO under the
    # SNUB_WASTE_HEIGHT_MM=600 threshold, so it doesn't count as a "big,
    # mostly-unused chunk" either. Neither the original scrap-avoidance
    # condition nor the newer snub-big-waste condition is triggered, so there's
    # nothing worth protecting by going elsewhere -- the big offcut should just
    # be used directly, and the smaller 410x310 offcut (which would itself be
    # reduced entirely to scrap slivers if used) should be left untouched.
    small = Offcut(product_id=p.productId, variant_id=v.variantId, width=410.0, height=310.0, length=0.0, quantity=1, status="available")
    big = Offcut(product_id=p.productId, variant_id=v.variantId, width=450.0, height=850.0, length=0.0, quantity=1, status="available")
    db.add(small)
    db.add(big)
    db.commit()
    db.refresh(small)
    db.refresh(big)

    line = _mk_line(400, 300, qty=1)
    lines = [line]
    gos.resolve_glass_cut_lines(db, p, v, lines)
    db.commit()

    events = [e for e in line["offcut_sources"] if e.get("owns_consumption", True)]
    print(f"Events: {events}")
    assert len(events) == 1
    assert events[0]["offcut_id"] == big.offcutId, f"Expected the cut from the 450x850 offcut, got {events[0]['offcut_id']}"

    untouched = db.exec(select(Offcut).where(Offcut.offcutId == small.offcutId)).first()
    print(f"Small offcut still in DB untouched: {untouched}")
    assert untouched is not None and untouched.quantity == 1, "The small offcut should not have been used"
    print("PASS")


def test_23_big_waste_redirects_even_when_remainder_resembles_the_cut(db, p, v):
    print("\n--- Test 23: big-waste still redirects to the closer offcut even when the big one's remainder resembles the cut ---")
    _clear_offcuts(db, p)
    db.refresh(v)

    # One 400x1070 cut. The 850x1070 offcut leaves a single non-scrap remainder
    # (450x1070) -- which happens to be within 100mm of the cut's own size on
    # both sides (_remainder_basically_same_as_cut). That coincidence used to
    # suppress the redirect entirely (as if there were nothing worth
    # protecting), but the 850x1070 offcut is still using only ~47% of its own
    # area for this cut (450mm of unused width, past SNUB_WASTE_WIDTH_MM=99) --
    # a real excess that has nothing to do with what the leftover looks like.
    # The closer, snug-fitting 420x1090 offcut should be used instead, even
    # though it ends up fully reduced to scrap slivers doing it.
    small = Offcut(product_id=p.productId, variant_id=v.variantId, width=420.0, height=1090.0, length=0.0, quantity=1, status="available")
    big = Offcut(product_id=p.productId, variant_id=v.variantId, width=850.0, height=1070.0, length=0.0, quantity=1, status="available")
    db.add(small)
    db.add(big)
    db.commit()
    db.refresh(small)
    db.refresh(big)

    line = _mk_line(400, 1070, qty=1)
    lines = [line]
    gos.resolve_glass_cut_lines(db, p, v, lines)
    db.commit()

    events = [e for e in line["offcut_sources"] if e.get("owns_consumption", True)]
    print(f"Events: {events}")
    assert len(events) == 1
    assert events[0]["offcut_id"] == small.offcutId, f"Expected the cut from the closer 420x1090 offcut, got {events[0]['offcut_id']}"

    untouched = db.exec(select(Offcut).where(Offcut.offcutId == big.offcutId)).first()
    print(f"Big offcut still in DB untouched: {untouched}")
    assert untouched is not None and untouched.quantity == 1, "The big offcut should not have been used"
    print("PASS")


def test_24_resolve_replacement_pieces_auto(db, p, v):
    print("\n--- Test 24: resolve_replacement_pieces auto-resolves via _fulfill_pool, combining multiple pieces onto one source ---")
    _clear_offcuts(db, p)
    db.refresh(v)
    stock_before = v.stock_quantity

    events = gos.resolve_replacement_pieces(db, p, v, [(600.0, 400.0), (500.0, 300.0)])
    db.commit()
    db.refresh(v)

    total_cuts = sum(len(e["cuts"]) for e in events)
    assert total_cuts == 2, f"Expected 2 replacement cuts placed, got {total_cuts}"
    owners = [e for e in events if e.get("owns_consumption", True)]
    assert len(owners) == 1, f"Expected exactly one physical source consumed for both pieces, got {len(owners)}"
    assert v.stock_quantity == stock_before - 1, "Expected exactly one fresh sheet consumed (no offcuts existed)"
    print("PASS")


def test_25_resolve_replacement_pieces_forced_offcut(db, p, v):
    print("\n--- Test 25: forced_offcut_id restricts resolution to a specific offcut, raises if it doesn't fit ---")
    _clear_offcuts(db, p)
    db.refresh(v)

    oc = Offcut(product_id=p.productId, variant_id=v.variantId, width=700.0, height=500.0, length=0.0, quantity=1, status="available")
    db.add(oc)
    db.commit()
    db.refresh(oc)

    events = gos.resolve_replacement_pieces(db, p, v, [(600.0, 400.0)], forced_offcut_id=oc.offcutId)
    db.commit()
    assert len(events) == 1
    assert events[0]["source"] == "offcut" and events[0]["offcut_id"] == oc.offcutId, \
        f"Expected the forced offcut #{oc.offcutId} to be used, got {events[0]}"
    print(f"Forced replacement used offcut #{oc.offcutId} as expected")

    _clear_offcuts(db, p)
    small = Offcut(product_id=p.productId, variant_id=v.variantId, width=100.0, height=100.0, length=0.0, quantity=1, status="available")
    db.add(small)
    db.commit()
    db.refresh(small)
    try:
        gos.resolve_replacement_pieces(db, p, v, [(600.0, 400.0)], forced_offcut_id=small.offcutId)
        assert False, "Expected ValueError when the forced offcut doesn't fit any piece"
    except ValueError:
        pass
    print("PASS")


def test_26_correct_glass_offcut_event_with_failed_cuts(db, p, v):
    print("\n--- Test 26: correct_glass_offcut_event trims a missed cut and resolves a replacement source for it ---")
    _clear_offcuts(db, p)
    db.refresh(v)

    line = _mk_line(400, 300, qty=2)  # two identical pieces, grid-packed onto one fresh sheet
    lines = [line]
    gos.resolve_glass_cut_lines(db, p, v, lines)
    db.commit()

    event = next(e for e in line["offcut_sources"] if e.get("owns_consumption", True))
    assert len(event["cuts"]) == 2, f"Expected both pieces grid-packed into one event, got {len(event['cuts'])}"

    result = gos.correct_glass_offcut_event(db, p, v, event, event["remainders_created"], failed_cut_indices=[0])
    db.commit()

    assert len(event["cuts"]) == 1, "The missed cut should have been removed from the original event"
    assert result["replacement_events"], "Expected at least one replacement event for the missed cut"
    replacement_cuts = [c for e in result["replacement_events"] for c in e["cuts"]]
    assert len(replacement_cuts) == 1, f"Expected exactly 1 replacement cut, got {len(replacement_cuts)}"
    c = replacement_cuts[0]
    matches_missed_dims = (
        (abs(c["width"] - 400.0) < 1.0 and abs(c["height"] - 300.0) < 1.0)
        or (abs(c["width"] - 300.0) < 1.0 and abs(c["height"] - 400.0) < 1.0)
    )
    assert matches_missed_dims, f"Replacement cut should match the missed piece's dims, got {c}"
    print("PASS")


def test_27_correct_glass_offcut_event_rejects_bad_cut_index(db, p, v):
    print("\n--- Test 27: correct_glass_offcut_event rejects an out-of-range failed_cut_indices entry ---")
    event = {"cuts": [{"width": 100, "height": 100, "x": 0, "y": 0, "rotated": False}], "remainders_created": [], "owns_consumption": True}
    try:
        gos.correct_glass_offcut_event(db, p, v, event, [], failed_cut_indices=[5])
        assert False, "Expected ValueError for an out-of-range cut index"
    except ValueError:
        pass
    print("PASS")


def test_28_pending_source_notice_on_cross_order_consumption(db, p, v, servedby):
    print("\n--- Test 28: consuming another order's not-yet-cut offcut attaches a pending_source_notice ---")
    _clear_offcuts(db, p)

    # item_a: cutting NOT reported done yet — its predicted remainder is still "pending"
    order_a = Order(servedby=servedby, subtotal=0, total=0)
    db.add(order_a)
    db.commit()
    db.refresh(order_a)
    item_a = OrderItem(
        order_id=order_a.orderId, product_id=p.productId, variant_id=v.variantId,
        total_price=0, status="purchased", cutting_completed=False,
        details={"lineItems": [{"type": "glass-cut", "qty": 1, "meta": {"l": 2000, "w": 1500, "u": "mm"}}]},
    )
    db.add(item_a)
    db.commit()
    db.refresh(item_a)

    # A remainder "produced by" item_a's (still pending) cutting job
    pending_offcut = Offcut(
        product_id=p.productId, variant_id=v.variantId, width=700.0, height=500.0, length=0.0,
        quantity=1, status="available", source_item_id=item_a.item_id,
    )
    db.add(pending_offcut)
    db.commit()

    # item_b: a different order's cut that happens to fit inside item_a's still-pending offcut
    order_b = Order(servedby=servedby, subtotal=0, total=0)
    db.add(order_b)
    db.commit()
    db.refresh(order_b)
    item_b = OrderItem(order_id=order_b.orderId, product_id=p.productId, variant_id=v.variantId, total_price=0, status="purchased")
    db.add(item_b)
    db.commit()
    db.refresh(item_b)

    line = _mk_line(600, 400)
    gos.resolve_glass_cut_lines(db, p, v, [line], item_id=item_b.item_id)
    db.commit()

    event = line["offcut_sources"][0]
    print(f"Event: {event}")
    assert event["source"] == "offcut" and event["offcut_id"] == pending_offcut.offcutId, "Expected the cut to come from item_a's pending offcut"
    notice = event.get("pending_source_notice")
    assert notice is not None, "Expected a pending_source_notice since item_a hasn't reported cutting done"
    assert notice["order_id"] == order_a.orderId and notice["item_id"] == item_a.item_id, f"Notice points at the wrong source: {notice}"

    # The new remainder this consumption left behind should itself be tagged to item_b
    remaining = db.exec(select(Offcut).where(Offcut.product_id == p.productId, Offcut.source_item_id == item_b.item_id)).all()
    assert remaining, "Expected the new remainder to be tagged with item_b as its producer"
    print("PASS")


def test_29_no_notice_once_source_marked_done(db, p, v, servedby):
    print("\n--- Test 29: no pending_source_notice once the producing item is marked cut ---")
    _clear_offcuts(db, p)

    order_a = Order(servedby=servedby, subtotal=0, total=0)
    db.add(order_a)
    db.commit()
    db.refresh(order_a)
    item_a = OrderItem(
        order_id=order_a.orderId, product_id=p.productId, variant_id=v.variantId,
        total_price=0, status="purchased", cutting_completed=True,  # already reported done
        details={"lineItems": []},
    )
    db.add(item_a)
    db.commit()
    db.refresh(item_a)

    offcut = Offcut(
        product_id=p.productId, variant_id=v.variantId, width=700.0, height=500.0, length=0.0,
        quantity=1, status="available", source_item_id=item_a.item_id,
    )
    db.add(offcut)
    db.commit()

    order_c = Order(servedby=servedby, subtotal=0, total=0)
    db.add(order_c)
    db.commit()
    db.refresh(order_c)
    item_c = OrderItem(order_id=order_c.orderId, product_id=p.productId, variant_id=v.variantId, total_price=0, status="purchased")
    db.add(item_c)
    db.commit()
    db.refresh(item_c)

    line = _mk_line(600, 400)
    gos.resolve_glass_cut_lines(db, p, v, [line], item_id=item_c.item_id)
    db.commit()

    event = line["offcut_sources"][0]
    assert event["source"] == "offcut" and event["offcut_id"] == offcut.offcutId
    assert "pending_source_notice" not in event, f"Expected no notice once item_a is marked cut, got {event.get('pending_source_notice')}"
    print("PASS")


def test_30_ceo_popular_range_drives_tiering_without_sales_history(db, p, v):
    print("\n--- Test 30: CEO popular_size_ranges alone (no sales history) still splits small/large ---")
    _clear_offcuts(db, p)
    db.refresh(v)

    # Same physical scenario as test_19, but this time NO sales history is
    # seeded at all — the only thing making the 1650x1020 offcut "protected"
    # is the CEO-configured range below. Proves the new range-based tier is
    # actually driving the split, not the pre-existing sales-history signal.
    v.popular_size_ranges = [{"min_w": 900, "max_w": 1700, "min_h": 900, "max_h": 1200}]
    db.add(v)
    db.commit()
    db.refresh(v)

    small = Offcut(product_id=p.productId, variant_id=v.variantId, width=450.0, height=1120.0, length=0.0, quantity=1, status="available")
    large = Offcut(product_id=p.productId, variant_id=v.variantId, width=1650.0, height=1020.0, length=0.0, quantity=1, status="available")
    db.add(small)
    db.add(large)
    db.commit()
    db.refresh(small)
    db.refresh(large)

    line = _mk_line(400, 1070, qty=2)
    gos.resolve_glass_cut_lines(db, p, v, [line])
    db.commit()

    events = [e for e in line["offcut_sources"] if e.get("owns_consumption", True)]
    sources_used = {e["offcut_id"] for e in events}
    print(f"Sources used: {sources_used}")
    assert sources_used == {small.offcutId, large.offcutId}, (
        f"Expected one event from each offcut ({small.offcutId}, {large.offcutId}), got sources {sources_used}"
    )
    large_event = next(e for e in events if e["offcut_id"] == large.offcutId)
    assert len(large_event["cuts"]) == 1, f"Expected exactly 1 cut from the popular-range large offcut, got {len(large_event['cuts'])}"

    v.popular_size_ranges = []
    db.add(v)
    db.commit()
    print("PASS")


def test_31_small_tier_consolidates_before_splitting(db, p, v):
    print("\n--- Test 31: within the small/unpopular tier, one offcut serving both cuts wins over splitting ---")
    _clear_offcuts(db, p)
    db.refresh(v)

    # A high, unreachable popular threshold puts BOTH offcuts below it — i.e.
    # both are "small/unpopular" tier. Offcut A fits only one 300x400 cut;
    # offcut B fits both side by side. Desired: both cuts come from B in one
    # event (maximize consolidation within the tier), A stays untouched —
    # NOT one cut from each, even though A also technically fits one.
    v.popular_size_ranges = [{"min_w": 2000, "max_w": 3000, "min_h": 2000, "max_h": 3000}]
    db.add(v)
    db.commit()
    db.refresh(v)

    a = Offcut(product_id=p.productId, variant_id=v.variantId, width=300.0, height=400.0, length=0.0, quantity=1, status="available")
    b = Offcut(product_id=p.productId, variant_id=v.variantId, width=620.0, height=400.0, length=0.0, quantity=1, status="available")
    db.add(a)
    db.add(b)
    db.commit()
    db.refresh(a)
    db.refresh(b)

    line = _mk_line(300, 400, qty=2)
    gos.resolve_glass_cut_lines(db, p, v, [line])
    db.commit()

    events = [e for e in line["offcut_sources"] if e.get("owns_consumption", True)]
    print(f"Events: {events}")
    assert len(events) == 1, f"Expected both cuts consolidated into ONE event, got {len(events)}"
    assert events[0]["offcut_id"] == b.offcutId, f"Expected the consolidating offcut B (#{b.offcutId}), got #{events[0]['offcut_id']}"
    assert len(events[0]["cuts"]) == 2, f"Expected both cuts in the single event, got {len(events[0]['cuts'])}"

    remaining_a = db.exec(select(Offcut).where(Offcut.offcutId == a.offcutId)).first()
    assert remaining_a is not None and remaining_a.quantity == 1, "Offcut A should be untouched"

    v.popular_size_ranges = []
    db.add(v)
    db.commit()
    print("PASS")


def test_32_snubs_big_waste_even_when_consolidating_makes_less_total_scrap(db, p, v):
    print("\n--- Test 32: a source left with too much unused width/height for the cut is snubbed for a closer offcut ---")
    _clear_offcuts(db, p)
    db.refresh(v)

    # Same two cuts and offcuts as the ORIGINAL test 22 scenario. Consolidating
    # both cuts into the 1650x900 offcut only uses a 1070x800 footprint,
    # leaving 580mm of unused width -- past SNUB_WASTE_WIDTH_MM (99mm) -- even
    # though the resulting scrap area is technically less than splitting would
    # produce. So it's snubbed anyway: one cut goes to the closer 450x1120
    # offcut instead (even though that offcut ends up entirely reduced to
    # scrap), and the big offcut keeps only the ONE cut it's asked for.
    small = Offcut(product_id=p.productId, variant_id=v.variantId, width=450.0, height=1120.0, length=0.0, quantity=1, status="available")
    large = Offcut(product_id=p.productId, variant_id=v.variantId, width=1650.0, height=900.0, length=0.0, quantity=1, status="available")
    db.add(small)
    db.add(large)
    db.commit()
    db.refresh(small)
    db.refresh(large)

    line = _mk_line(400, 1070, qty=2)
    lines = [line]
    gos.resolve_glass_cut_lines(db, p, v, lines)
    db.commit()

    events = [e for e in line["offcut_sources"] if e.get("owns_consumption", True)]
    print(f"Events: {events}")
    sources_used = {e["offcut_id"] for e in events}
    assert sources_used == {small.offcutId, large.offcutId}, (
        f"Expected one event from each offcut ({small.offcutId}, {large.offcutId}), got sources {sources_used}"
    )
    large_event = next(e for e in events if e["offcut_id"] == large.offcutId)
    assert len(large_event["cuts"]) == 1, f"Expected exactly 1 cut from the large offcut (snubbed for the second), got {len(large_event['cuts'])}"
    print("PASS")


def run():
    engine = create_engine(DATABASE_URL)
    with Session(engine) as db:
        p, v = _reset_product(db)
        # Select just the userId column (not full User rows) — some existing user
        # rows carry a stale `role` value predating migrate_rename_roles.py that
        # doesn't match the current enum, which would blow up a full-row fetch.
        servedby = db.exec(select(User.userId)).first()
        if not servedby:
            raise RuntimeError("No users found in DB — need at least one user to seed a test order (Test 4)")

        failures = []
        for name, fn in [
            ("test_1_uses_existing_offcut", lambda: test_1_uses_existing_offcut(db, p, v)),
            ("test_2_falls_back_to_fresh_sheet", lambda: test_2_falls_back_to_fresh_sheet(db, p, v)),
            ("test_3_scrap_classification", lambda: test_3_scrap_classification(db, p, v)),
            ("test_4_sales_history_no_longer_protects_offcuts", lambda: test_4_sales_history_no_longer_protects_offcuts(db, p, v, servedby)),
            ("test_5_batches_largest_first", lambda: test_5_batches_largest_first(db, p, v)),
            ("test_6_restore", lambda: test_6_restore(db, p, v)),
            ("test_7_unit_conversion", lambda: test_7_unit_conversion(db, p, v)),
            ("test_8_grid_packs_identical_pieces", lambda: test_8_grid_packs_identical_pieces(db, p, v)),
            ("test_9_order_independent_of_lw_swap", lambda: test_9_order_independent_of_lw_swap(db, p, v)),
            ("test_10_recursive_packing_fits_all_on_one_sheet", lambda: test_10_recursive_packing_fits_all_on_one_sheet(db, p, v)),
            ("test_11_preview_consolidates_synthetic_offcut_chains", lambda: test_11_preview_consolidates_synthetic_offcut_chains(db, p, v)),
            ("test_12_joint_packing_shares_one_sheet_across_lines", lambda: test_12_joint_packing_shares_one_sheet_across_lines(db, p, v)),
            ("test_13_restore_after_joint_packing", lambda: test_13_restore_after_joint_packing(db, p, v)),
            ("test_14_multi_strategy_never_worse_than_baseline", lambda: test_14_multi_strategy_never_worse_than_baseline(db, p, v)),
            ("test_15_savepoint_trials_leave_no_trace", lambda: test_15_savepoint_trials_leave_no_trace(db, p, v)),
            ("test_16_multi_strategy_timing_sanity", lambda: test_16_multi_strategy_timing_sanity(db, p, v)),
            ("test_17_multi_strategy_order_independent_of_lw_swap", lambda: test_17_multi_strategy_order_independent_of_lw_swap(db, p, v)),
            ("test_18_sellability_score_reflects_ceo_popular_ranges", lambda: test_18_sellability_score_reflects_ceo_popular_ranges(db, p, v)),
            ("test_19_small_offcut_before_large_offcut", lambda: test_19_small_offcut_before_large_offcut(db, p, v)),
            ("test_20_correct_offcut_event", lambda: test_20_correct_offcut_event(db, p, v)),
            ("test_21_correct_offcut_rejects_invalid_input", lambda: test_21_correct_offcut_rejects_invalid_input(db, p, v)),
            ("test_22_no_forced_split_when_neither_scrap_nor_big_waste_is_at_stake", lambda: test_22_no_forced_split_when_neither_scrap_nor_big_waste_is_at_stake(db, p, v)),
            ("test_23_big_waste_redirects_even_when_remainder_resembles_the_cut", lambda: test_23_big_waste_redirects_even_when_remainder_resembles_the_cut(db, p, v)),
            ("test_24_resolve_replacement_pieces_auto", lambda: test_24_resolve_replacement_pieces_auto(db, p, v)),
            ("test_25_resolve_replacement_pieces_forced_offcut", lambda: test_25_resolve_replacement_pieces_forced_offcut(db, p, v)),
            ("test_26_correct_glass_offcut_event_with_failed_cuts", lambda: test_26_correct_glass_offcut_event_with_failed_cuts(db, p, v)),
            ("test_27_correct_glass_offcut_event_rejects_bad_cut_index", lambda: test_27_correct_glass_offcut_event_rejects_bad_cut_index(db, p, v)),
            ("test_28_pending_source_notice_on_cross_order_consumption", lambda: test_28_pending_source_notice_on_cross_order_consumption(db, p, v, servedby)),
            ("test_29_no_notice_once_source_marked_done", lambda: test_29_no_notice_once_source_marked_done(db, p, v, servedby)),
            ("test_30_ceo_popular_range_drives_tiering_without_sales_history", lambda: test_30_ceo_popular_range_drives_tiering_without_sales_history(db, p, v)),
            ("test_31_small_tier_consolidates_before_splitting", lambda: test_31_small_tier_consolidates_before_splitting(db, p, v)),
            ("test_32_snubs_big_waste_even_when_consolidating_makes_less_total_scrap", lambda: test_32_snubs_big_waste_even_when_consolidating_makes_less_total_scrap(db, p, v)),
        ]:
            try:
                fn()
            except Exception as e:
                db.rollback()
                failures.append((name, e))
                print(f"{name} FAILED: {e}")

        print("\n" + "=" * 60)
        if failures:
            print(f"{len(failures)} test(s) FAILED:")
            for name, e in failures:
                print(f"  - {name}: {e}")
        else:
            print("All tests PASSED.")


if __name__ == "__main__":
    run()
