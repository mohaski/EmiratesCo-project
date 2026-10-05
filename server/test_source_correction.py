"""
"New bar / new sheet" (source_pref) and the "source never used" correction - and what they
must NOT change in edits, cancels, undo and the consistency invariants.

Runs against emiratesco_edit_test only (it truncates tables):

    python test_source_correction.py
"""
import copy
from datetime import datetime

from fastapi import HTTPException
from sqlmodel import Session, select, text

import test_order_edit_matrix as M
from core.audit import integrity
from core.audit import undo as undo_engine
from core.audit.opContext import operation
from core.inventory import reversalPlan as rp
from core.inventory.products import service as product_service
from core.ordering import model, orderService
from entities.offcuts import Offcut
from entities.offcutLedger import OffcutPiece
from entities.opJournal import StockOperation
from entities.orderItems import OrderItem

check = M.check
failures = M.failures
CUT = {"physicalState": rp.PHYS_ALREADY_CUT, "resolution": rp.RES_RETURN_TO_POOL}
NOT_CUT = {"physicalState": rp.PHYS_NOT_CUT}


class World:
    def __init__(self, kind="bar"):
        self.db = Session(M.engine_for_test_db())
        M.reset(self.db)
        self.db.exec(text("TRUNCATE stock_operations, stock_journal RESTART IDENTITY"))
        self.db.commit()
        self.cat, self.user = M.seed_base(self.db)
        self.prod, self.var = M.seed_product(self.db, self.cat, f"SC {kind}", kind=kind)
        if kind == "bar":
            self.var.length = 6.0
            self.db.add(self.var)
        self.db.commit()
        self.fu = M.FakeUser(self.user.userId)

    # -- material ------------------------------------------------------------------------
    def offcut(self, length=None, w=None, h=None, status="available"):
        from core.inventory.glassOffcutService import _upsert_glass_offcut
        from core.inventory.inventoryService import _upsert_offcut
        if w is not None:
            rid = _upsert_glass_offcut(self.db, self.prod, self.var, w, h, status, origin="manual_entry")
        else:
            rid = _upsert_offcut(self.db, self.prod, self.var, length, status=status, origin="manual_entry")
        self.db.commit()
        return rid

    def stock(self):
        return M.stock_of(self.db, self.var)

    def pool(self):
        self.db.expire_all()
        rows = self.db.exec(select(Offcut).where(Offcut.product_id == self.prod.productId, Offcut.quantity > 0)).all()
        out = []
        for r in rows:
            size = round(r.length, 2) if not r.width else (round(r.width), round(r.height))
            out += [(size, r.status)] * r.quantity
        return sorted(out, key=str)

    # -- orders --------------------------------------------------------------------------
    def sale(self, lines, cut_done=False):
        order = M.new_order(self.db, self.user)
        item = M.add_item(self.db, order, self.prod, self.var, lines)
        if cut_done:
            item.cutting_completed = True
            item.cutting_completed_at = datetime.utcnow()
            self.db.add(item)
        self.db.commit()
        return order, item

    def item(self, order):
        self.db.expire_all()
        return self.db.exec(select(OrderItem).where(OrderItem.order_id == order.orderId)).all()[0]

    def edit(self, order, item, lines, answer=None):
        conf = None
        if answer is not None:
            plan = orderService.get_reversal_plan(
                order.orderId, self.db, self.fu, incoming_items=[M.req_from_item(item, lines=lines)])
            conf = {l["line_ref"]: answer for l in plan["lines"] if l["item_id"] == item.item_id and l.get("will_reverse", True)}
        M.edit(self.db, order, self.user, [M.req_from_item(item, lines=copy.deepcopy(lines))], confirmations=conf)
        self.db.commit()

    def cancel(self, order, item, answer):
        plan = orderService.get_reversal_plan(order.orderId, self.db, self.fu)
        conf = {l["line_ref"]: answer for l in plan["lines"] if l["item_id"] == item.item_id}
        with operation(self.db, "cancel", actor=self.fu, order_id=order.orderId, request={}):
            orderService.apply_cancel(order.orderId, self.db, self.fu, cut_confirmations=conf, enforce_window=False)
        self.db.commit()

    # -- corrections ---------------------------------------------------------------------
    def correct_1d(self, order, item, line_idx=0, event_idx=0, *, new_remainder_length=0.0, replace_source=False,
                   forced_offcut_id=None, **opts):
        return orderService.correct_profile_offcut_for_order_item(
            order.orderId, item.item_id, line_idx, event_idx, new_remainder_length, replace_source,
            forced_offcut_id, "test", self.db, self.fu, **opts)

    def correct_2d(self, order, item, line_idx=0, event_idx=0, *, new_remainders=None, failed_cuts=(),
                   forced_offcut_id=None, **opts):
        refs = [model.FailedCutRef(line_idx=a, cut_idx=b) for a, b in failed_cuts]
        rem = [model.OffcutRemainderInput(**r) for r in (new_remainders or [])]
        return orderService.correct_offcut_for_order_item(
            order.orderId, item.item_id, line_idx, event_idx, rem, refs, forced_offcut_id, "test",
            self.db, self.fu, **opts)

    def ok(self, label):
        self.db.expire_all()
        check(f"{label}: consistency", integrity.check(self.db)["errors"], [])

    def close(self):
        self.db.close()


def new_bar_line(length):
    line = M.line_cut_1d(length)
    line["source_pref"] = "new"
    return line


def new_sheet_line(w, h, qty=1):
    line = M.line_cut_2d(w, h, qty)
    line["source_pref"] = "new"
    return line


def holder(w, event):
    """The order item the ledger says holds the piece an event consumed."""
    piece = w.db.get(OffcutPiece, event.get("source_piece_id"))
    return piece.consumed_by_item_id if piece else None


def refused(fn, *needles):
    try:
        fn()
    except HTTPException as e:
        detail = str(e.detail)
        return all(n in detail for n in needles), detail
    return False, "not refused"


# ── A. Sale-time "new bar / new sheet" ───────────────────────────────────────────
def a_sales():
    print("\n--- A1. Profile cut marked 'new bar' ignores a fitting offcut ---")
    w = World("bar")
    w.offcut(5.0)
    _, item = w.sale([new_bar_line(4.0)])
    check("a bar was drawn", w.stock(), 39)
    check("the 5.0 offcut is untouched, new 2.0 remainder", w.pool(), [(2.0, "available"), (5.0, "available")])
    check("recorded source is a full bar", item.details["lineItems"][0]["offcut_sources"][0]["source"], "full_bar")
    _, item2 = w.sale([M.line_cut_1d(4.0)])
    check("an unmarked cut still takes the offcut", item2.details["lineItems"][0]["offcut_sources"][0]["source"], "offcut")
    w.ok("A1")

    print("\n--- A2. The stock check honours 'new bar' when no full bar is left ---")
    w.var.stock_quantity = 0
    w.db.add(w.var)
    w.db.commit()
    res = product_service.check_cut_feasibility(w.prod.productId, [new_bar_line(1.0)], w.db, w.var.variantId)
    check("new bar with no stock is refused", res["ok"], False)
    res = product_service.check_cut_feasibility(w.prod.productId, [M.line_cut_1d(1.0)], w.db, w.var.variantId)
    check("the same cut from an offcut is fine", res["ok"], True)
    w.close()

    print("\n--- A3. Glass line marked 'new sheet' skips a fitting offcut; its sibling doesn't ---")
    w = World("glass")
    w.offcut(w=1000.0, h=1000.0)
    _, item = w.sale([new_sheet_line(600, 600), M.line_cut_2d(400, 400)])
    srcs = [l["offcut_sources"] for l in item.details["lineItems"]]
    check("flagged line cut from a sheet", [e["source"] for e in srcs[0]], ["sheet"])
    check("one sheet drawn", w.stock(), 39)
    check("unflagged line used the offcut", [e["source"] for e in srcs[1]], ["offcut"])
    w.ok("A3")
    w.close()


# ── B. Editing around the flag ───────────────────────────────────────────────────
def b_edits():
    print("\n--- B1. Saving an order back unchanged moves nothing (flag on and off) ---")
    w = World("bar")
    o1, i1 = w.sale([M.line_cut_1d(4.0)])
    o2, i2 = w.sale([new_bar_line(3.0)])
    before = (w.stock(), w.pool())
    w.edit(o1, i1, i1.details["lineItems"])
    w.edit(o2, i2, i2.details["lineItems"])
    check("same items kept", (w.item(o1).item_id, w.item(o2).item_id), (i1.item_id, i2.item_id))
    check("no stock moved", (w.stock(), w.pool()), before)

    print("\n--- B2. Turning the flag on in an edit counts as a change ---")
    w.offcut(5.0)
    o3, i3 = w.sale([M.line_cut_1d(2.0)])
    check("unflagged sale took the 5.0", i3.details["lineItems"][0]["offcut_sources"][0]["source"], "offcut")
    stock = w.stock()
    w.edit(o3, i3, [new_bar_line(2.0)], NOT_CUT)
    new = w.item(o3)
    check("item re-cut", new.item_id != i3.item_id, True)
    check("now from a new bar", new.details["lineItems"][0]["offcut_sources"][0]["source"], "full_bar")
    check("one more bar drawn", w.stock(), stock - 1)
    check("the 5.0 offcut came back whole", (5.0, "available") in w.pool(), True)
    w.ok("B2")
    w.close()

    print("\n--- B3. Already-cut 'new bar' line edited 4 -> 3 trims its own piece (no new bar) ---")
    w = World("bar")
    w.offcut(5.0)
    o, i = w.sale([new_bar_line(4.0)], cut_done=True)
    stock = w.stock()
    w.edit(o, i, [new_bar_line(3.0)], CUT)
    new = w.item(o)
    src = new.details["lineItems"][0]["offcut_sources"][0]
    check("re-cut from its own 4.0 piece", (src["source"], src.get("offcut_length")), ("offcut", 4.0))
    check("no new bar", w.stock(), stock)
    check("the other 5.0 offcut still untouched", (5.0, "available") in w.pool(), True)
    w.ok("B3")
    w.close()

    print("\n--- B4. Glass: cut 'new sheet' line kept on its own glass when a sibling changes ---")
    w = World("glass")
    w.offcut(w=1000.0, h=1000.0)
    o, i = w.sale([new_sheet_line(600, 600), M.line_cut_2d(300, 300)], cut_done=True)
    stock = w.stock()
    w.edit(o, i, [new_sheet_line(600, 600), M.line_cut_2d(300, 400)], CUT)
    new = w.item(o)
    first = new.details["lineItems"][0]["offcut_sources"]
    check("flagged line re-supplied from its own 600x600", [(e["source"], e["offcut_width"], e["offcut_height"]) for e in first],
          [("offcut", 600.0, 600.0)])
    check("no extra sheet", w.stock(), stock)
    w.ok("B4")
    w.close()


# ── C. "Source never used" - profiles ───────────────────────────────────────────
def c_profile():
    print("\n--- C1. New bar never used: bar back to STOCK, cut re-supplied, cancel credits once ---")
    w = World("bar")
    o, i = w.sale([M.line_cut_1d(4.0)])
    w.offcut(5.0)
    check("start", (w.stock(), w.pool()), (39, [(2.0, "available"), (5.0, "available")]))
    res = w.correct_1d(o, i, source_unused=True)
    check("bar back, 2.0 leftover gone, cut from the 5.0", (w.stock(), w.pool()), (40, [(1.0, "available")]))
    it = w.item(o)
    line = it.details["lineItems"][0]
    check("event moved to voided_sources", (len(line["voided_sources"]), line["voided_sources"][0]["source"]), (1, "full_bar"))
    check("replacement recorded", [e["source"] for e in line["offcut_sources"]], ["offcut"])
    check("result names the replacement", res["replacement_event"]["offcut_length"], 5.0)
    w.ok("C1 correction")
    w.cancel(o, it, NOT_CUT)
    check("cancel returns only the replacement", (w.stock(), w.pool()), (40, [(5.0, "available")]))
    w.ok("C1 cancel")
    w.close()

    print("\n--- C2. Offcut 'not for this order': returned, replacement from a new bar, flag survives edits ---")
    w = World("bar")
    w.offcut(5.0)
    o, i = w.sale([M.line_cut_1d(4.0)])
    check("sale took the 5.0", (w.stock(), w.pool()), (40, [(1.0, "available")]))
    w.correct_1d(o, i, source_unused=True, source_fate="avoid")
    check("5.0 back, 1.0 gone, 4.0 from a new bar", (w.stock(), w.pool()), (39, [(2.0, "available"), (5.0, "available")]))
    it = w.item(o)
    check("line now new-bar only", (it.details["lineItems"][0].get("source_pref"), it.details.get("sourcePref")), ("new", "new"))
    before = (w.stock(), w.pool())
    w.edit(o, it, it.details["lineItems"])
    check("unchanged save keeps the item", (w.item(o).item_id, (w.stock(), w.pool())), (it.item_id, before))
    it = w.item(o)
    lines = copy.deepcopy(it.details["lineItems"])
    lines[0]["meta"]["length"] = 3.0
    w.edit(o, it, lines, NOT_CUT)
    src = w.item(o).details["lineItems"][0]["offcut_sources"][0]
    check("edit re-cut still avoids the 5.0", (src["source"], (5.0, "available") in w.pool()), ("full_bar", True))
    w.ok("C2")
    w.close()

    print("\n--- C3. Fates: scrap / missing / re-measured ---")
    for fate, extra, want in (("scrap", {}, (5.0, "scrap")), ("missing", {}, None),
                              ("remeasure", {"remeasure": {"length": 4.5}}, (4.5, "available"))):
        w = World("bar")
        w.offcut(5.0)
        o, i = w.sale([M.line_cut_1d(4.0)])
        w.correct_1d(o, i, source_unused=True, source_fate=fate, **extra)
        pool = w.pool()
        got = [p for p in pool if p[0] in (4.5, 5.0)]
        check(f"{fate}: original ends up as", got, [want] if want else [])
        w.ok(f"C3 {fate}")
        w.close()

    print("\n--- C4. Refused when a later order cut the leftover ---")
    w = World("bar")
    oa, ia = w.sale([M.line_cut_1d(4.0)])
    ob, ib = w.sale([M.line_cut_1d(1.5)])
    before = (w.stock(), w.pool())
    # Named by its order number (what people see on the receipt), not the internal id.
    ok, detail = refused(lambda: w.correct_1d(oa, ia, source_unused=True), f"order #{ob.order_no or ob.orderId}")
    w.db.rollback()
    check("refused naming the later order", ok, True)
    check("nothing moved", (w.stock(), w.pool()), before)
    w.close()

    print("\n--- C5. The original chosen on purpose; and 'new bar' as a plain replacement ---")
    w = World("bar")
    w.offcut(5.0)
    o, i = w.sale([M.line_cut_1d(4.0)])
    w.correct_1d(o, i, source_unused=True, use_original=True)
    check("cut from the 5.0 again", (w.stock(), w.pool()), (40, [(1.0, "available")]))
    w.ok("C5 original")
    w.offcut(5.0)
    o2, i2 = w.sale([M.line_cut_1d(2.0)])
    w.correct_1d(o2, i2, new_remainder_length=3.0, replace_source=True, force_new_source=True)
    src = w.item(o2).details["lineItems"][0]["offcut_sources"][-1]
    check("replace_source + new bar draws a bar", src["source"], "full_bar")
    check("replace_source: the new bar is held by the item", holder(w, src), i2.item_id)
    w.ok("C5 new bar")
    w.close()

    print("\n--- C5b. Bar damaged with two usable parts; the cut taken from part 2 ---")
    w = World("bar")
    w.offcut(5.0)
    o, i = w.sale([M.line_cut_1d(2.0)])
    ok, _ = refused(lambda: w.correct_1d(o, i, source_unused=True, source_fate="remeasure",
                                         remeasure=[{"length": 3.0}, {"length": 2.5}]), "more than")
    w.db.rollback()
    check("parts longer than the source are refused", ok, True)
    w.correct_1d(o, i, source_unused=True, source_fate="remeasure",
                 remeasure=[{"length": 2.0}, {"length": 2.5}], use_original=True, original_part=1)
    check("2.0 part kept, 2.5 part cut leaves 0.5", w.pool(), [(0.5, "available"), (2.0, "available")])
    w.ok("C5b")
    w.close()

    print("\n--- C5c. A correction's replacement is held by its order: another order's edit names it ---")
    w = World("bar")
    w.offcut(3.5)
    oy, iy = w.sale([M.line_cut_1d(3.0)])          # Y takes the 3.5
    ox, ix = w.sale([M.line_cut_1d(2.0)])          # X opens a bar, leaves 4.0
    w.correct_1d(oy, iy, source_unused=True)       # Y's cut re-supplied from X's 4.0
    rep = w.item(oy).details["lineItems"][0]["offcut_sources"][-1]
    check("Y's replacement came from X's leftover", (rep["source"], rep["offcut_length"]), ("offcut", 4.0))
    check("the ledger names Y's item as holding it", holder(w, rep), iy.item_id)
    plan = orderService.get_reversal_plan(ox.orderId, w.db, w.fu)
    check("X's plan names order Y's later cut", [lc["order_id"] for lc in plan["lines"][0]["later_cuts"]], [oy.orderId])
    w.cancel(ox, w.item(ox), NOT_CUT)
    w.ok("C5c cancel X")
    w.cancel(oy, w.item(oy), NOT_CUT)
    w.ok("C5c cancel Y")
    # Neither order cut anything, so all the material comes back: X's uncut 2.0 rejoins the
    # leftover Y held, and Y's 3.0 rejoins that - one whole 6.0 piece (the rejoin engine hands
    # rejoined material back as an offcut, not a stock bar - see test_edit_scenarios S2), plus the 3.5.
    check("all material back: the bar rejoined whole, and the 3.5", (w.stock(), w.pool()),
          (39, [(3.5, "available"), (6.0, "available")]))
    w.close()

    print("\n--- C6. Corrections stay outside Undo (unchanged): refused, nothing moves ---")
    w = World("bar")
    w.offcut(5.0)
    o, i = w.sale([M.line_cut_1d(4.0)])
    w.correct_1d(o, i, source_unused=True, source_fate="avoid")
    after = (w.stock(), w.pool(), copy.deepcopy(w.item(o).details))
    op = w.db.exec(select(StockOperation).where(StockOperation.order_id == o.orderId)
                   .order_by(StockOperation.created_at.desc())).first()
    check("the correction is journaled as its own operation", op.kind, "cut_correction")
    try:
        undo_engine.undo_operation(w.db, op.op_id, actor=w.fu, reason="test")
        check("undo refused", False, True)
    except undo_engine.UndoRefused:
        w.db.rollback()
        check("undo refused", True, True)
    check("nothing moved", (w.stock(), w.pool(), w.item(o).details), after)
    w.ok("C6")
    w.close()


# ── D. "Source never used" - glass ─────────────────────────────────────────────
def d_glass():
    print("\n--- D1. Shared sheet never used: every line re-supplied, sheet back, cancel credits once ---")
    w = World("glass")
    o, i = w.sale([M.line_cut_2d(600, 600), M.line_cut_2d(400, 400)])
    check("one sheet for both lines", (w.stock(), [e["group_id"] for l in i.details["lineItems"] for e in l["offcut_sources"]][0] is not None), (39, True))
    w.offcut(w=1000.0, h=1000.0)
    owner = next(n for n, l in enumerate(i.details["lineItems"]) if l["offcut_sources"][0].get("owns_consumption"))
    w.correct_2d(o, i, owner, 0, source_unused=True)
    it = w.item(o)
    check("both lines voided", [len(l.get("voided_sources") or []) for l in it.details["lineItems"]], [1, 1])
    check("both lines re-supplied", all(l["offcut_sources"] for l in it.details["lineItems"]), True)
    check("every replacement held by the item", {holder(w, e) for l in it.details["lineItems"] for e in l["offcut_sources"]}, {i.item_id})
    check("sheet back in stock", w.stock(), 40)
    w.ok("D1 correction")
    w.cancel(o, it, NOT_CUT)
    check("cancel: stock and pool as before the sale", (w.stock(), w.pool()), (40, [((1000, 1000), "available")]))
    w.ok("D1 cancel")
    w.close()

    print("\n--- D2. Preview: only offcuts that fit, original flagged, nothing saved ---")
    w = World("glass")
    w.offcut(w=700.0, h=700.0)
    o, i = w.sale([M.line_cut_2d(600, 600)])
    w.offcut(w=300.0, h=300.0)     # too small for the 600x600
    w.offcut(w=900.0, h=800.0)     # fits
    before = (w.stock(), w.pool())
    body = model.CorrectOffcutRequest(item_id=i.item_id, line_idx=0, event_idx=0, new_remainders=[], source_unused=True)
    prev = orderService.preview_offcut_correction(o.orderId, body, w.db, w.fu)
    sizes = [(c["width"], c["height"], c["original"], c["fits"]) for c in prev["candidates"]["offcuts"]]
    check("listed: the original first, then the 900x800; never the 300x300", sizes,
          [(700.0, 700.0, 0, [0]), (900.0, 800.0, None, [0])])
    check("auto replacement is not the original", [(e["source"], e["offcut_width"]) for e in prev["events"]], [("offcut", 900.0)])
    check("new sheet offered", prev["candidates"]["sheet"], {"fits": [0], "stock": 40.0})
    check("preview saved nothing", (w.stock(), w.pool()), before)
    body.source_fate = "avoid"
    prev = orderService.preview_offcut_correction(o.orderId, body, w.db, w.fu)
    check("'not for this order' hides the original", [c["original"] for c in prev["candidates"]["offcuts"]], [None])
    body.source_fate, body.force_new_source = "available", True
    prev = orderService.preview_offcut_correction(o.orderId, body, w.db, w.fu)
    check("'new sheet' preview uses a sheet", [e["source"] for e in prev["events"]], ["sheet"])
    w.ok("D2")
    w.close()

    print("\n--- D3. Missed-cut correction (existing path): remainders keep piece ids, new sheet works ---")
    w = World("glass")
    o, i = w.sale([M.line_cut_2d(600, 600, 2)])
    ev = i.details["lineItems"][0]["offcut_sources"][0]
    rems = [{"width": r["width"], "height": r["height"]} for r in ev["remainders_created"]]
    w.offcut(w=1000.0, h=1000.0)
    w.correct_2d(o, i, new_remainders=rems, failed_cuts=[(0, 1)], force_new_source=True)
    line = w.item(o).details["lineItems"][0]
    check("corrected remainders carry piece ids", all(r.get("piece_id") for r in line["offcut_sources"][0]["remainders_created"]), True)
    check("missed piece re-supplied from a sheet", line["offcut_sources"][-1]["source"], "sheet")
    check("missed-cut replacement held by the item", holder(w, line["offcut_sources"][-1]), i.item_id)
    w.ok("D3")
    w.close()

    print("\n--- D3b. Missed cuts, one choice per piece ---")
    w = World("glass")
    o, i = w.sale([M.line_cut_2d(600, 600, 2)])
    ev = i.details["lineItems"][0]["offcut_sources"][0]
    rems = [{"width": r["width"], "height": r["height"]} for r in ev["remainders_created"]]
    a = w.offcut(w=650.0, h=650.0)
    b = w.offcut(w=700.0, h=700.0)
    w.correct_2d(o, i, new_remainders=rems, failed_cuts=[(0, 0), (0, 1)], assignments=[
        {"line_idx": 0, "cut_idx": 0, "source": str(b)}, {"line_idx": 0, "cut_idx": 1, "source": str(a)}])
    srcs = sorted(e["offcut_id"] for e in w.item(o).details["lineItems"][0]["offcut_sources"][1:])
    check("each missed piece from the offcut picked for it", srcs, sorted([a, b]))
    check("per-piece replacements held by the item", {holder(w, e) for e in w.item(o).details["lineItems"][0]["offcut_sources"][1:]}, {i.item_id})
    w.ok("D3b")
    w.close()

    print("\n--- D4. One choice per piece: each piece from the source picked for it ---")
    w = World("glass")
    o, i = w.sale([M.line_cut_2d(600, 600), M.line_cut_2d(400, 400)])
    big = w.offcut(w=700.0, h=700.0)      # holds either piece
    small = w.offcut(w=500.0, h=500.0)    # holds only the 400x400
    owner = next(n for n, l in enumerate(i.details["lineItems"]) if l["offcut_sources"][0].get("owns_consumption"))
    body = model.CorrectOffcutRequest(item_id=i.item_id, line_idx=owner, event_idx=0, new_remainders=[], source_unused=True)
    prev = orderService.preview_offcut_correction(o.orderId, body, w.db, w.fu)
    pieces = prev["candidates"]["pieces"]
    pos = {(p["width"], p["height"]): n for n, p in enumerate(pieces)}
    fits = {c["offcutId"]: c["fits"] for c in prev["candidates"]["offcuts"]}
    check("700x700 listed for both pieces", sorted(fits[big]), sorted(pos.values()))
    check("500x500 listed only for the 400x400", fits[small], [pos[(400.0, 400.0)]])
    by_size = {(p["width"], p["height"]): p for p in pieces}
    pick = lambda size, src: {"line_idx": by_size[size]["line_idx"], "cut_idx": by_size[size]["cut_idx"], "source": src}
    ok, detail = refused(lambda: w.correct_2d(o, i, owner, 0, source_unused=True, assignments=[
        pick((600.0, 600.0), str(small)), pick((400.0, 400.0), "new")]), "Offcut #")
    w.db.rollback()
    check("a piece given an offcut too small for it is refused", ok, True)
    w.correct_2d(o, i, owner, 0, source_unused=True, assignments=[
        pick((600.0, 600.0), str(big)), pick((400.0, 400.0), "new")])
    it = w.item(o)
    got = {}
    for line in it.details["lineItems"]:
        for e in line["offcut_sources"]:
            for c in e["cuts"]:
                got[tuple(sorted((c["width"], c["height"])))] = (e["source"], e["offcut_id"])
    check("600x600 from the 700x700, 400x400 from a new sheet", got,
          {(600.0, 600.0): ("offcut", big), (400.0, 400.0): ("sheet", None)})
    check("the 500x500 untouched", ((500, 500), "available") in w.pool(), True)
    w.ok("D4")
    w.close()

    print("\n--- D5. Damaged with several usable parts; one part chosen for the re-cut ---")
    w = World("glass")
    w.offcut(w=1000.0, h=1000.0)
    o, i = w.sale([M.line_cut_2d(400, 900)])
    ok, _ = refused(lambda: w.correct_2d(o, i, source_unused=True, source_fate="remeasure",
                                         remeasure=[{"width": 1000, "height": 900}, {"width": 1000, "height": 500}]),
                    "more glass")
    w.db.rollback()
    check("parts adding up to more than the source are refused", ok, True)
    w.correct_2d(o, i, source_unused=True, source_fate="remeasure",
                 remeasure=[{"width": 500, "height": 1000}, {"width": 450, "height": 1000}],
                 assignments=[{"line_idx": 0, "cut_idx": 0, "source": "original:1"}])
    src = w.item(o).details["lineItems"][0]["offcut_sources"][0]
    check("cut from part 2 (450x1000)", (src["source"], sorted((src["offcut_width"], src["offcut_height"]))), ("offcut", [450.0, 1000.0]))
    check("part 1 (500x1000) is in the pool", ((500, 1000), "available") in w.pool(), True)
    w.ok("D5")
    w.close()


# ── E. Over HTTP, with exactly the JSON the modals send ─────────────────────────
def e_http():
    print("\n--- E1. Routes, request validation and response shapes ---")
    from fastapi.testclient import TestClient
    import main
    from core.userManagement.authService import get_current_user
    from db.database import get_session

    w = World("glass")
    w.offcut(w=700.0, h=700.0)
    o, i = w.sale([M.line_cut_2d(600, 600)])
    main.app.dependency_overrides[get_session] = lambda: w.db
    main.app.dependency_overrides[get_current_user] = lambda: w.fu
    client = TestClient(main.app)
    try:
        modal = {"item_id": i.item_id, "line_idx": 0, "event_idx": 0, "new_remainders": [], "failed_cuts": [],
                 "forced_offcut_id": None, "force_new_source": False, "use_original": False,
                 "source_unused": True, "source_fate": "available", "remeasure": None}
        r = client.post(f"/orders/{o.orderId}/correct-offcut/preview", json=modal)
        check("glass preview 200", r.status_code, 200)
        check("glass preview lists the original", [c["original"] for c in r.json()["candidates"]["offcuts"]], [0])
        r = client.put(f"/orders/{o.orderId}/correct-offcut", json={**modal, "notes": "x", "assignments": [
            {"line_idx": 0, "cut_idx": 0, "source": "original:0"}]})
        check("glass save 200", (r.status_code, r.json().get("message")), (200, "Offcut corrected"))
        w.ok("E1 glass")

        old_style = {"item_id": i.item_id, "line_idx": 0, "event_idx": 0,
                     "new_remainders": [{"width": 100, "height": 700}], "failed_cuts": [], "forced_offcut_id": None, "notes": None}
        r = client.put(f"/orders/{o.orderId}/correct-offcut", json=old_style)
        check("a payload without the new fields still works", r.status_code, 200)
        w.close()

        w = World("bar")
        main.app.dependency_overrides[get_session] = lambda: w.db
        main.app.dependency_overrides[get_current_user] = lambda: w.fu
        o, i = w.sale([M.line_cut_1d(4.0)])
        modal = {"item_id": i.item_id, "line_idx": 0, "event_idx": 0, "new_remainder_length": 0, "replace_source": False,
                 "forced_offcut_id": None, "force_new_source": True, "use_original": False,
                 "source_unused": True, "source_fate": "available", "remeasure": None}
        r = client.post(f"/orders/{o.orderId}/correct-profile-offcut/preview", json=modal)
        check("profile preview 200 + new bar", (r.status_code, r.json()["event"]["source"], r.json()["candidates"]["bar"]["stock"]),
              (200, "full_bar", 40.0))
        r = client.put(f"/orders/{o.orderId}/correct-profile-offcut", json={**modal, "notes": None})
        check("profile save 200, no 'after' for never-used", (r.status_code, r.json().get("after")), (200, None))
        r = client.post(f"/orders/{o.orderId}/correct-profile-offcut/preview",
                        json={**modal, "event_idx": 0, "source_unused": False, "replace_source": False})
        check("nothing to replace: empty preview", (r.status_code, r.json()["candidates"]), (200, None))
        w.ok("E1 profile")
    finally:
        main.app.dependency_overrides.clear()
        w.close()


def main():
    a_sales()
    b_edits()
    c_profile()
    d_glass()
    e_http()
    print("\n" + "=" * 68)
    if failures:
        print(f"{len(failures)} FAILED:")
        for f in failures:
            print(f"  - {f}")
        raise SystemExit(1)
    print("All source-correction checks passed.")


if __name__ == "__main__":
    main()
