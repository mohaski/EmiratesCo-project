"""
Edit/cancel scenarios with cut material shared across orders - Phases 3 and 4.

The case that prompted it: order A cuts 6 from a 21 bar, order B cuts 8 from A's leftover,
then A is edited to 8. The operator is asked about BOTH cuts; if A's cut was never made its
6 goes back onto what is left of the bar, and the new size can be cut from that.

Every scenario checks stock, the offcut pool, cutting flags and the consistency invariants
(core/audit/integrity.py). Runs against emiratesco_edit_test only (it truncates tables):

    python test_edit_scenarios.py
"""
from datetime import datetime

from sqlmodel import Session, select, text

import test_order_edit_matrix as M
from core.audit import integrity
from core.audit.opContext import operation
from core.inventory import reversalPlan as rp
from core.ordering import orderService
from entities.offcutLedger import OffcutPiece
from entities.orderItems import OrderItem

check = M.check
failures = M.failures

CUT = {"physicalState": rp.PHYS_ALREADY_CUT, "resolution": rp.RES_RETURN_TO_POOL}
NOT_CUT = {"physicalState": rp.PHYS_NOT_CUT}


class World:
    def __init__(self, bar_len=21.0):
        self.db = Session(M.engine_for_test_db())
        M.reset(self.db)
        self.db.exec(text("TRUNCATE stock_operations, stock_journal RESTART IDENTITY"))
        self.db.commit()
        self.cat, self.user = M.seed_base(self.db)
        self.bar, self.var = M.seed_product(self.db, self.cat, "Scenario Bar", kind="bar")
        self.var.length = bar_len
        self.db.add(self.var)
        self.db.commit()

    @property
    def fu(self):
        return M.FakeUser(self.user.userId)

    def sale(self, *cuts, cut_done=False, qty=1):
        order = M.new_order(self.db, self.user)
        item = M.add_item(self.db, order, self.bar, self.var, [M.line_cut_1d(c, qty=qty) for c in cuts])
        if cut_done:
            self.mark_cut(item)
        self.db.commit()
        return order, item

    def mark_cut(self, item):
        item.cutting_completed = True
        item.cutting_completed_at = datetime.utcnow()
        self.db.add(item)
        self.db.commit()

    def pool(self):
        return sorted(p[0] for p in M.pool_of(self.db, self.bar) for _ in range(p[3]))

    def stock(self):
        return M.stock_of(self.db, self.var)

    def plan_for(self, order, item, new_lines=None):
        incoming = None
        if new_lines is not None:
            incoming = [M.req_from_item(item, lines=new_lines)]
        return orderService.get_reversal_plan(order.orderId, self.db, self.fu, incoming_items=incoming)

    def edit(self, order, item, new_lines, answer, later=None, selection=None):
        plan = self.plan_for(order, item, new_lines)
        line = next(l for l in plan["lines"] if l["item_id"] == item.item_id)
        conf = dict(answer)
        if later is not None:
            conf["laterCuts"] = {str(k): v for k, v in later.items()}
        lines = [dict(l) for l in new_lines]
        if selection is not None:
            lines[0]["offcut_selection"] = selection
        M.edit(self.db, order, self.user, [M.req_from_item(item, lines=lines)],
               confirmations={line["line_ref"]: conf})
        return line

    def cancel(self, order, item, answer, later=None):
        plan = self.plan_for(order, item)
        line = next(l for l in plan["lines"] if l["item_id"] == item.item_id)
        conf = dict(answer)
        if later is not None:
            conf["laterCuts"] = {str(k): v for k, v in later.items()}
        with operation(self.db, "cancel", actor=self.fu, order_id=order.orderId, request={}):
            orderService.apply_cancel(order.orderId, self.db, self.fu,
                                      cut_confirmations={line["line_ref"]: conf}, enforce_window=False)
        self.db.commit()
        return line

    def items(self, order):
        self.db.expire_all()
        return self.db.exec(select(OrderItem).where(OrderItem.order_id == order.orderId)).all()

    def ok(self, label):
        res = integrity.check(self.db)
        check(f"{label}: consistency", res["errors"], [])

    def close(self):
        self.db.close()


# ─────────────────────────────────────────────────────────────────────────────
def s1():
    print("\n--- S1. A 6->8, B cut 8 from A's leftover; A WAS cut ---")
    w = World()
    a, ai = w.sale(6, cut_done=True)
    b, bi = w.sale(8)
    check("before: bar 1 drawn, 7 left", (w.stock(), w.pool()), (39, [7.0]))
    line = w.plan_for(a, ai, [M.line_cut_1d(8)])["lines"][0]
    check("the later cut is listed", [(lc["order_id"], lc["cut"]) for lc in line["later_cuts"]], [(b.orderId, "8.00")])
    check("it must be answered", line["requires_explicit_answer"], True)
    check("what comes back if cut", line["returns"].get("already_cut"), ["6.00"])
    check("what comes back if not cut", line["returns"].get("not_cut"), ["13.00 (6.00 never cut + 7.00 left on the bar)"])
    w.edit(a, ai, [M.line_cut_1d(8)], CUT, later={bi.item_id: rp.PHYS_ALREADY_CUT})
    check("6 back as an offcut, 8 from a new bar", (w.stock(), w.pool()), (38, [6.0, 7.0, 13.0]))
    check("B marked cut (confirmed)", w.db.get(OrderItem, bi.item_id).cutting_completed, True)
    w.ok("S1")
    w.close()


def s2():
    print("\n--- S2. Same, A NOT cut, B cut: 7 + 6 = 13, the 8 comes from it ---")
    w = World()
    a, ai = w.sale(6)
    b, bi = w.sale(8)
    w.edit(a, ai, [M.line_cut_1d(8)], NOT_CUT, later={bi.item_id: rp.PHYS_ALREADY_CUT})
    check("no new bar; the 8 cut from the joined 13 leaves 5", (w.stock(), w.pool()), (39, [5.0]))
    check("B marked cut", w.db.get(OrderItem, bi.item_id).cutting_completed, True)
    new_item = w.items(a)[0]
    check("the new 8 needs cutting", new_item.cutting_completed, False)
    joined = w.db.exec(select(OffcutPiece).where(OffcutPiece.origin == "rejoin")).all()
    check("one rejoined 13.00 piece recorded", [round(p.length, 2) for p in joined], [13.0])
    check("it names the order that produced it", joined[0].produced_by_order_id, a.orderId)
    w.ok("S2")
    w.close()


def s3():
    print("\n--- S3. Neither cut: same stock as S2, B stays in the cutting queue ---")
    w = World()
    a, ai = w.sale(6)
    b, bi = w.sale(8)
    w.edit(a, ai, [M.line_cut_1d(8)], NOT_CUT, later={bi.item_id: rp.PHYS_NOT_CUT})
    check("stock/pool as S2", (w.stock(), w.pool()), (39, [5.0]))
    check("B not marked cut", w.db.get(OrderItem, bi.item_id).cutting_completed, False)
    w.ok("S3")
    # S8: B cancelled afterwards, not cut: its 8 goes back onto what is left (A's 5)
    print("\n--- S8. Then B cancelled, not cut: its 8 joins what's left (5 -> 13) ---")
    line = w.plan_for(b, bi)["lines"][0]
    check("B's plan asks about A's new 8 from the same bar",
          [lc["order_id"] for lc in line["later_cuts"]], [a.orderId])
    w.cancel(b, bi, NOT_CUT, later={lc["item_id"]: rp.PHYS_ALREADY_CUT for lc in line["later_cuts"]})
    check("21 - A's 8 = one 13 left, no bar invented", (w.stock(), w.pool()), (39, [13.0]))
    w.ok("S8")
    w.close()


def s4():
    print("\n--- S4. Chain A -> B -> C, A not cut: joins onto C's leftover ---")
    w = World()
    a, ai = w.sale(6)
    b, bi = w.sale(8)
    c, ci = w.sale(3)
    check("before", (w.stock(), w.pool()), (39, [4.0]))
    line = w.plan_for(a, ai, [M.line_cut_1d(8)])["lines"][0]
    check("both later cuts listed in order", [lc["order_id"] for lc in line["later_cuts"]], [b.orderId, c.orderId])
    w.edit(a, ai, [M.line_cut_1d(8)], NOT_CUT,
           later={bi.item_id: rp.PHYS_ALREADY_CUT, ci.item_id: rp.PHYS_ALREADY_CUT})
    check("4 + 6 = 10, 8 cut from it, 2 left", (w.stock(), w.pool()), (39, [2.0]))
    w.ok("S4")
    w.close()


def s5():
    print("\n--- S5a. A 6->4, A cut, B cut: the 6 is trimmed to 4 (2 left) ---")
    w = World()
    a, ai = w.sale(6, cut_done=True)
    b, bi = w.sale(8)
    w.edit(a, ai, [M.line_cut_1d(4)], CUT, later={bi.item_id: rp.PHYS_ALREADY_CUT})
    check("trimmed", (w.stock(), w.pool()), (39, [2.0, 7.0]))
    check("trimming is a cut to make", w.items(a)[0].cutting_completed, False)
    w.ok("S5a")
    w.close()

    print("\n--- S5b. A 6->4, A not cut, B cut: 13 joined, 4 from it (9 left) ---")
    w = World()
    a, ai = w.sale(6)
    b, bi = w.sale(8)
    w.edit(a, ai, [M.line_cut_1d(4)], NOT_CUT, later={bi.item_id: rp.PHYS_ALREADY_CUT})
    check("joined then cut", (w.stock(), w.pool()), (39, [9.0]))
    w.ok("S5b")
    w.close()

    print("\n--- S5c. A 6->4, not cut, nobody else on the bar: whole bar back, 4 from it ---")
    w = World()
    a, ai = w.sale(6)
    w.edit(a, ai, [M.line_cut_1d(4)], NOT_CUT)
    check("bar back and re-cut", (w.stock(), w.pool()), (39, [17.0]))
    w.ok("S5c")
    w.close()


def s6():
    print("\n--- S6. A cut from an OFFCUT (not a fresh bar), B cut from A's leftover ---")
    w = World()
    z, zi = w.sale(6, cut_done=True)       # leaves a 15 offcut
    a, ai = w.sale(6)                      # from the 15 -> 9
    b, bi = w.sale(8)                      # from the 9  -> 1
    check("before", (w.stock(), w.pool()), (39, [1.0]))
    w.edit(a, ai, [M.line_cut_1d(8)], NOT_CUT, later={bi.item_id: rp.PHYS_ALREADY_CUT})
    check("1 + 6 = 7 is too short for 8: new bar, 7 kept", (w.stock(), w.pool()), (38, [7.0, 13.0]))
    w.ok("S6")
    w.close()


def s7():
    print("\n--- S7. 2 x 6 already cut, edited to 1 x 6: one cut piece reused as-is ---")
    w = World()
    a, ai = w.sale(6, cut_done=True, qty=2)
    check("before", (w.stock(), w.pool()), (39, [9.0]))
    w.edit(a, ai, [M.line_cut_1d(6, qty=1)], CUT)
    check("one 6 reused, one 6 back in the pool", (w.stock(), w.pool()), (39, [6.0, 9.0]))
    check("reusing the existing cut piece needs no cutting", w.items(a)[0].cutting_completed, True)
    w.ok("S7")
    w.close()


def s9():
    print("\n--- S9. Cashier picks the joined piece in the calculator (returned_ref) ---")
    w = World()
    a, ai = w.sale(6)
    b, bi = w.sale(8)
    ref = f"{ai.item_id}:0#0"
    proj = orderService.projected_offcuts(a.orderId, ai.item_id,
                                          {f"{ai.item_id}:0": {**NOT_CUT, "laterCuts": {str(bi.item_id): "already_cut"}}},
                                          None, w.db, w.fu)
    check("projection lists the joined 13", [(r["length"], [x["ref"] for x in r["returned"]]) for r in proj["offcuts"]],
          [(13.0, [ref])])
    check("projection leaves the database untouched", w.pool(), [7.0])
    w.edit(a, ai, [M.line_cut_1d(8)], NOT_CUT, later={bi.item_id: rp.PHYS_ALREADY_CUT},
           selection=[{"offcut_id": None, "returned_ref": ref, "length_used": 8, "returned_label": "13.00 joined"}])
    new_item = w.items(a)[0]
    src = new_item.details["lineItems"][0]["offcut_sources"][0]
    joined = w.db.exec(select(OffcutPiece).where(OffcutPiece.origin == "rejoin")).first()
    check("the picked piece is the one consumed", src.get("source_piece_id"), joined.piece_id)
    check("result", (w.stock(), w.pool()), (39, [5.0]))
    w.ok("S9")
    w.close()

    print("\n--- S9b. A pick that the answers don't produce is refused with a reason ---")
    w = World()
    a, ai = w.sale(6, cut_done=True)
    b, bi = w.sale(8)
    try:
        w.edit(a, ai, [M.line_cut_1d(8)], CUT, later={bi.item_id: rp.PHYS_ALREADY_CUT},
               selection=[{"offcut_id": None, "returned_ref": f"{ai.item_id}:0#0", "length_used": 8}])
        check("refused", False, True)
    except Exception as e:
        w.db.rollback()
        check("refused with a clear reason", "too short" in str(getattr(e, "detail", e)), True)
    check("nothing moved", (w.stock(), w.pool()), (39, [7.0]))
    w.close()


def s10():
    print("\n--- S10. Glass: sheet shared with a later order, cancelled 'not cut' ---")
    db = Session(M.engine_for_test_db())
    M.reset(db)
    db.exec(text("TRUNCATE stock_operations, stock_journal RESTART IDENTITY"))
    db.commit()
    cat, user = M.seed_base(db)
    glass, gvar = M.seed_product(db, cat, "Scenario Glass", kind="glass")
    db.commit()
    fu = M.FakeUser(user.userId)
    sheet_area = M.SHEET_W * M.SHEET_H
    a = M.new_order(db, user)
    ai = M.add_item(db, a, glass, gvar, [M.line_cut_2d(1220, 1830), M.line_cut_2d(600, 500)])
    db.commit()
    b = M.new_order(db, user)
    bi = M.add_item(db, b, glass, gvar, [M.line_cut_2d(400, 300)])
    db.commit()
    plan = orderService.get_reversal_plan(a.orderId, db, fu)
    owner = [l for l in plan["lines"] if l["returns"].get("not_cut")]
    check("the plan lists B's cut on this sheet", any(l["later_cuts"] for l in plan["lines"]), True)
    preview = owner[0]["returns"]["not_cut"] if owner else []
    check("the plan previews rejoined pieces", bool(preview), True)
    b_taken = db.exec(select(OffcutPiece).where(OffcutPiece.consumed_by_item_id == bi.item_id)).all()
    taken_area = 400 * 300  # only B's own cut leaves the sheet; its leftovers stay in the pool
    root_id = b_taken[0].root_piece_id if b_taken else None
    conf = {}
    for l in plan["lines"]:
        conf[l["line_ref"]] = {**NOT_CUT, "laterCuts": {str(lc["item_id"]): "already_cut" for lc in l["later_cuts"]}}
    with operation(db, "cancel", actor=fu, order_id=a.orderId, request={}):
        orderService.apply_cancel(a.orderId, db, fu, cut_confirmations=conf, enforce_window=False)
    db.commit()
    avail = db.exec(select(OffcutPiece).where(OffcutPiece.root_piece_id == root_id,
                                              OffcutPiece.state == "available")).all()
    got_area = sum(p.width * p.height for p in avail)
    check("no glass invented or lost: available + B's piece = the sheet",
          round(got_area + taken_area), round(sheet_area))
    rejoined = [p for p in avail if p.origin == "rejoin"]
    check("uncut glass was merged with the untouched leftover", bool(rejoined), True)
    labels = sorted(f"{p.width:.0f}x{p.height:.0f}" for p in avail if p.origin in ("rejoin", "restore_credit"))
    check("what came back matches the preview", labels,
          sorted(part.split("mm")[0] for x in preview for part in x.split(", ")))
    res = integrity.check(db)
    check("S10: consistency", res["errors"], [])
    db.close()


def s13():
    print("\n--- S13. Glass item re-cut only because another line changed: already-cut piece reused ---")
    db = Session(M.engine_for_test_db())
    M.reset(db)
    db.exec(text("TRUNCATE stock_operations, stock_journal RESTART IDENTITY"))
    db.commit()
    cat, user = M.seed_base(db)
    glass, gvar = M.seed_product(db, cat, "Scenario Glass 2", kind="glass")
    db.commit()
    a = M.new_order(db, user)
    ai = M.add_item(db, a, glass, gvar, [M.line_full(1), M.line_cut_2d(600, 500)])
    ai.cutting_completed = True
    ai.cutting_completed_at = datetime.utcnow()
    db.add(ai)
    db.commit()
    plan = orderService.get_reversal_plan(a.orderId, db, M.FakeUser(user.userId),
                                          incoming_items=[M.req_from_item(ai, lines=[M.line_full(2), M.line_cut_2d(600, 500)])])
    conf = {l["line_ref"]: CUT for l in plan["lines"] if l["will_reverse"]}
    M.edit(db, a, user, [M.req_from_item(ai, lines=[M.line_full(2), M.line_cut_2d(600, 500)])], confirmations=conf)
    db.expire_all()
    new_item = db.exec(select(OrderItem).where(OrderItem.order_id == a.orderId)).first()
    check("the 600x500 already exists - item stays cut", new_item.cutting_completed, True)
    res = integrity.check(db)
    check("S13: consistency", res["errors"], [])
    db.close()


def s14():
    print("\n--- S14. Two identical items: the one the cashier changed is the one reversed ---")
    w = World()
    order = M.new_order(w.db, w.user)
    first = M.add_item(w.db, order, w.bar, w.var, [M.line_cut_1d(6)])
    second = M.add_item(w.db, order, w.bar, w.var, [M.line_cut_1d(6)])
    w.mark_cut(first)   # only the FIRST has been cut
    w.db.commit()
    keep = M.req_from_item(first)
    keep.details = {**keep.details, "_sourceItemId": first.item_id}
    change = M.req_from_item(second, lines=[M.line_cut_1d(4)])
    change.details = {**change.details, "_sourceItemId": second.item_id}
    plan = orderService.get_reversal_plan(order.orderId, w.db, w.fu, incoming_items=[keep, change])
    check("only the second (named) item is reversed",
          [l["item_id"] for l in plan["lines"] if l["will_reverse"]], [second.item_id])
    ref = next(l["line_ref"] for l in plan["lines"] if l["will_reverse"])
    M.edit(w.db, order, w.user, [keep, change], confirmations={ref: NOT_CUT})
    items = w.items(order)
    check("the cut item survived untouched", first.item_id in [i.item_id for i in items], True)
    check("and is still cut", w.db.get(OrderItem, first.item_id).cutting_completed, True)
    check("the stored item doesn't keep the cart's source id",
          any("_sourceItemId" in (i.details or {}) for i in items), False)
    w.ok("S14")
    w.close()


def s15():
    print("\n--- S15. Leftover deleted in Offcut Management, cut NOT made: the bar comes back whole ---")
    from core.inventory.products import service as product_service
    w = World()
    a, ai = w.sale(6)
    check("before: 15 left", (w.stock(), w.pool()), (39, [15.0]))
    from entities.offcuts import Offcut
    row = w.db.exec(select(Offcut).where(Offcut.product_id == w.bar.productId, Offcut.quantity > 0)).first()
    ceo = M.FakeUser(str(w.user.userId))
    ceo.role = "ceo"
    product_service.bulk_delete_offcuts([row.offcutId], w.db, ceo)
    check("the 15 was deleted by hand", w.pool(), [])
    line = w.plan_for(a, ai)["lines"][0]
    check("'not cut' promises the whole bar", line["returns"].get("not_cut"), ["the whole bar back to stock"])
    w.cancel(a, ai, NOT_CUT)
    check("the whole bar is back in stock", (w.stock(), w.pool()), (40, []))
    w.ok("S15")
    w.close()

    print("\n--- S15b. Same, but the cut WAS made: only the cut piece comes back ---")
    w = World()
    a, ai = w.sale(6, cut_done=True)
    row = w.db.exec(select(Offcut).where(Offcut.product_id == w.bar.productId, Offcut.quantity > 0)).first()
    ceo = M.FakeUser(str(w.user.userId))
    ceo.role = "ceo"
    product_service.bulk_delete_offcuts([row.offcutId], w.db, ceo)
    w.cancel(a, ai, CUT)
    check("the 6 comes back, the deleted 15 stays gone", (w.stock(), w.pool()), (39, [6.0]))
    w.ok("S15b")
    w.close()


def s16():
    print("\n--- S16. Glass preview while editing: uses the offcut the order hands back ---")
    from core.inventory.products import service as product_service, model as product_model
    db = Session(M.engine_for_test_db())
    M.reset(db)
    db.exec(text("TRUNCATE stock_operations, stock_journal RESTART IDENTITY"))
    db.commit()
    cat, user = M.seed_base(db)
    glass, gvar = M.seed_product(db, cat, "Scenario Glass 3", kind="glass")
    db.commit()
    z = M.new_order(db, user)                       # leaves a 1240x1830 offcut
    M.add_item(db, z, glass, gvar, [M.line_cut_2d(1200, 1830)])
    a = M.new_order(db, user)                       # cut from that offcut
    ai = M.add_item(db, a, glass, gvar, [M.line_cut_2d(1000, 1000)])
    db.commit()
    src = ai.details["lineItems"][0]["offcut_sources"][0]["source"]
    check("A was cut from the offcut", src, "offcut")
    plan = orderService.get_reversal_plan(a.orderId, db, M.FakeUser(user.userId))
    line = plan["lines"][0]
    cuts = [product_model.GlassCutPreviewCut(l=1100, w=1100, qty=1, u="mm")]
    plain = product_service.preview_glass_cuts(glass.productId, cuts, db, gvar.variantId)
    check("a plain preview can't see A's offcut: new sheet", [g.get("source") for g in plain["groups"]], ["sheet"])
    edit = product_service.preview_glass_cuts(
        glass.productId, cuts, db, gvar.variantId, edit_order_id=a.orderId, edit_item_id=ai.item_id,
        edit_answers={line["line_ref"]: {"physicalState": "not_cut", "laterCuts": {}}})
    check("the edit preview uses the offcut A gives back", [g.get("source") for g in edit["groups"]], ["offcut"])
    res = integrity.check(db)
    check("S16: previews wrote nothing", res["errors"], [])
    db.close()


def s17():
    print("\n--- S17. A save made against an older version of the order is refused ---")
    from core.ordering.orderService import order_version
    w = World()
    a, ai = w.sale(6)
    with operation(w.db, "sale", actor=w.fu, order_id=a.orderId):
        pass
    w.db.commit()
    v_opened = order_version(w.db, a.orderId)
    # another device edits the order in between
    M.edit(w.db, a, w.user, [M.req_from_item(ai, lines=[M.line_cut_1d(5)])],
           confirmations={f"{ai.item_id}:0": NOT_CUT})
    stale_item = w.items(a)[0]
    req = M.model.OrderEditRequest(customerId=None, customerName="Edit Matrix", amountPaid=0.0,
                                   servedBy=w.user.userId, VAT_status=False, discount=0.0,
                                   paymentStatus="Unpaid", items=[M.req_from_item(stale_item, lines=[M.line_cut_1d(4)])],
                                   orderVersion=v_opened)
    try:
        orderService.update_order(a.orderId, req, w.db, w.fu)
        check("the stale save is refused", False, True)
    except Exception as e:
        w.db.rollback()
        check("the stale save is refused (409)", getattr(e, "status_code", None), 409)
    check("nothing changed", float(w.items(a)[0].details["lineItems"][0]["meta"]["length"]), 5.0)
    req.orderVersion = order_version(w.db, a.orderId)
    req.cutConfirmations = {f"{stale_item.item_id}:0": NOT_CUT}
    orderService.update_order(a.orderId, req, w.db, w.fu)
    check("the same save against the current version goes through",
          float(w.items(a)[0].details["lineItems"][0]["meta"]["length"]), 4.0)
    w.ok("S17")
    w.close()


def s18():
    print("\n--- S18. An unchanged cut delivered as two pieces survives an edit of its item ---")
    w = World()
    z1, _ = w.sale(14, cut_done=True)           # leaves 7
    z2, _ = w.sale(18, cut_done=True)           # leaves 3
    from entities.offcuts import Offcut
    rows = {round(r.length): r.offcutId for r in w.db.exec(select(Offcut).where(
        Offcut.product_id == w.bar.productId, Offcut.quantity > 0)).all()}
    order = M.new_order(w.db, w.user)
    cut8 = dict(M.line_cut_1d(8), offcut_selection=[{"offcut_id": rows[7], "length_used": 6},
                                                      {"offcut_id": rows[3], "length_used": 2}])
    item = M.add_item(w.db, order, w.bar, w.var, [cut8])
    w.mark_cut(item)
    w.var.stock_quantity = 0                     # nothing on the shelf, like order 117
    w.db.add(w.var)
    w.db.commit()
    before = (w.stock(), w.pool())
    req = M.req_from_item(item, quantity=2)      # the item changes; its cut does not
    req.details = {**req.details, "_sourceItemId": item.item_id}
    plan = orderService.get_reversal_plan(order.orderId, w.db, w.fu, incoming_items=[req])
    ref = plan["lines"][0]["line_ref"]
    M.edit(w.db, order, w.user, [req], confirmations={ref: CUT})
    new = w.items(order)[0]
    srcs = new.details["lineItems"][0]["offcut_sources"]
    check("edit went through, using the two existing pieces", sorted(s["length_used"] for s in srcs), [2, 6])
    check("no stock or offcut moved", (w.stock(), w.pool()), before)
    check("and the item is still cut", new.cutting_completed, True)
    w.ok("S18")
    w.close()


def s19():
    print("\n--- S19. Undo asks about money: a refund never handed back is reversed ---")
    from core.audit import undo as undo_engine
    from entities.orders import Order
    for handed in (True, False):
        w = World()
        a, ai = w.sale(6)
        o = w.db.get(Order, a.orderId)
        o.total, o.amountPayed, o.balance, o.payment_status = 1000.0, 1000.0, 0.0, "Paid"
        w.db.add(o)
        w.db.commit()
        w.cancel(a, ai, NOT_CUT)                  # refunds the 1000
        from entities.opJournal import StockOperation
        op = w.db.exec(select(StockOperation).where(StockOperation.order_id == a.orderId,
                                                    StockOperation.kind == "cancel")).first()
        effects = undo_engine.preview(w.db, lambda: undo_engine.undo_operation(w.db, op.op_id, actor=w.fu, reason="preview"))
        check(f"[{handed}] the preview reports the refund", effects["money_moved"], -1000.0)
        undo_engine.undo_operation(w.db, op.op_id, actor=w.fu, reason="t", money_handled=handed)
        w.db.commit()
        o = w.db.get(Order, a.orderId)
        want = (0.0, 1000.0, "Unpaid") if handed else (1000.0, 0.0, "Paid")
        check(f"[{handed}] paid/balance/status after undo", (o.amountPayed, o.balance, o.payment_status), want)
        w.ok(f"S19 {handed}")
        w.close()


def main():
    for fn in (s1, s2, s3, s4, s5, s6, s7, s9, s10, s13, s14, s15, s16, s17, s18, s19):
        fn()
    print("\n" + "=" * 68)
    if failures:
        print(f"{len(failures)} FAILURE(S):")
        for f in failures:
            print(f"   - {f}")
        raise SystemExit(1)
    print("All edit scenarios passed.")


if __name__ == "__main__":
    main()
