"""
Glass: popular sizes entered once per pool, and small offcuts used up first.

  - Popular sizes belong to an offcut POOL (one glass type and thickness, every sheet size):
    saved on one sheet size they apply to all of them, a sheet size added later inherits them,
    and the engine reads them pool-wide (glassOffcutService.popular_ranges).
  - A range matches a piece either way round (rotation allowed): the shop's 520-650 x 1050-1190
    used to match only pieces 1050mm WIDE, never a 600x1100 pane.
  - With popular sizes set, an offcut too small for every one of them is used before any
    popular-size offcut or a sheet: the biggest piece goes to the smallest small offcut that
    fits it (glassOffcutService._clear_small_offcut). No sizes set: nothing changes.

Every scenario also runs the consistency check (core/audit/integrity.py). The last section is
a randomised property test over many pools and orders.

Runs against emiratesco_edit_test only (it truncates tables):

    python test_glass_small_offcuts.py
"""
import copy
import random
import uuid

from sqlmodel import Session, select, text

import test_order_edit_matrix as M
import test_sale_windows as T
from _testdb_guard import require_test_db
from core.audit import integrity
from core.audit.opContext import operation
from core.inventory import glassOffcutService as g
from core.inventory import reversalPlan as rp
from core.inventory.glassOffcutService import _upsert_glass_offcut
from core.inventory.products import model as pmodel
from core.inventory.products import service as product_service
from core.ordering import model, orderService
from entities.offcuts import Offcut
from entities.orderItems import OrderItem
from entities.products import Product
from entities.variants import Variant

check = M.check
failures = M.failures
NOT_CUT = {"physicalState": rp.PHYS_NOT_CUT}
PANE = {"min_w": 520.0, "max_w": 650.0, "min_h": 1050.0, "max_h": 1190.0}   # the shop's O/w Blue entry


class World:
    """A glass product with 4mm in two sheet sizes (one pool) and 5mm (another pool)."""

    def __init__(self, ranges=None, min_usable=150.0):
        self.engine = M.engine_for_test_db()
        require_test_db(self.engine)
        self.db = Session(self.engine)
        M.reset(self.db)
        self.db.exec(text("TRUNCATE stock_operations, stock_journal RESTART IDENTITY"))
        self.db.commit()
        self.cat, self.user = M.seed_base(self.db)
        self.fu = M.FakeUser(self.user.userId)
        p = Product(name=f"Small-first glass {uuid.uuid4().hex[:4]}", category_id=self.cat.categoryId,
                    stock_quantity=60, track_offcuts=True, has_variants=True, has_dimensions=True, unit="mm",
                    pool_ignored_attributes=["Dimensions"])
        self.db.add(p)
        self.db.flush()
        self.prod = p
        self.v4a, self.v4b, self.v5 = [self._variant(th, L, W, min_usable) for th, L, W in
                                       (("4mm", 1830, 2440), ("4mm", 1650, 2140), ("5mm", 1830, 2440))]
        if ranges is not None:
            self.v4a.popular_size_ranges = ranges
            self.db.add(self.v4a)
        self.db.commit()
        M.rebaseline(self.db)

    def _variant(self, th, L, W, mu):
        v = Variant(product_id=self.prod.productId, name=f"{th} {L}x{W}", attributes={"Thickness": th, "Dimensions": f"{L}x{W}mm"},
                    stock_quantity=20, price=6000.0, price_half=3200.0, price_unit=180.0, length=L, width=W, min_usable=mu)
        self.db.add(v)
        self.db.flush()
        return v

    def offcut(self, w, h, variant=None):
        rid = _upsert_glass_offcut(self.db, self.prod, variant or self.v4a, float(w), float(h), "available",
                                   origin="manual_entry")
        self.db.commit()
        return rid

    def sale(self, *cuts, variant=None, lines=None):
        order = M.new_order(self.db, self.user)
        item = M.add_item(self.db, order, self.prod, variant or self.v4a,
                          lines or [M.line_cut_2d(w, h, qty=q) for w, h, q in cuts])
        self.db.commit()
        return order, item

    def sources(self, item):
        """(kind, offcut size or None) for every owning event of an item."""
        self.db.expire_all()
        it = self.db.get(OrderItem, item.item_id)
        out = []
        for line in it.details["lineItems"]:
            for e in line.get("offcut_sources") or []:
                if e.get("owns_consumption", True):
                    out.append(("sheet", None) if e["source"] == "sheet"
                               else ("offcut", tuple(sorted((round(e["offcut_width"]), round(e["offcut_height"]))))))
        return sorted(out, key=lambda x: (x[0], x[1] or ()))

    def pool(self):
        self.db.expire_all()
        rows = self.db.exec(select(Offcut).where(Offcut.product_id == self.prod.productId, Offcut.quantity > 0)).all()
        return sorted(((round(min(r.width, r.height)), round(max(r.width, r.height)), r.status, r.pool_key)
                       for r in rows for _ in range(r.quantity)))

    def stock(self, variant=None):
        return M.stock_of(self.db, variant or self.v4a)

    def cancel(self, order):
        plan = orderService.get_reversal_plan(order.orderId, self.db, self.fu)
        conf = {l["line_ref"]: NOT_CUT for l in plan["lines"]}
        with operation(self.db, "cancel", actor=self.fu, order_id=order.orderId, request={}):
            orderService.apply_cancel(order.orderId, self.db, self.fu, cut_confirmations=conf, enforce_window=False)
        self.db.commit()

    def ok(self, label):
        self.db.expire_all()
        check(f"{label}: consistency", integrity.check(self.db)["errors"], [])

    def close(self):
        self.db.close()


def mm(*dims):
    return tuple(sorted(dims))


# ── 1. A range matches either way round ──────────────────────────────────────────────────
def t_orientation():
    print("\n--- 1. Popular sizes match either way round ---")
    w = World(ranges=[PANE])
    popular = lambda d, v=w.v4a: g._meets_popular_threshold(d, v)
    check("600x1100 is a popular pane", popular((600, 1100)), True)
    check("1100x600 (turned) too", popular((1100, 600)), True)
    check("500x1100 is too narrow", popular((500, 1100)), False)
    check("600x1000 is too short", popular((600, 1000)), False)
    check("a whole sheet is popular-or-larger", popular((1830, 2440)), True)
    w.v4a.allow_rotation = False
    check("rotation not allowed: 600x1100 as entered still matches", popular((600, 1100)), True)
    check("...but not turned the other way", popular((1100, 600)), False)
    w.db.rollback()
    w.close()


# ── 2. Entered once per pool ─────────────────────────────────────────────────────────────
def t_pool_wide():
    print("\n--- 2. Popular sizes are the pool's: entered once, shared by every sheet size ---")
    w = World()
    upd = lambda v, ranges: product_service.update_variant(
        v.variantId, pmodel.VariantUpdate(popular_size_ranges=[pmodel.PopularSizeRange(**r) for r in ranges]),
        w.db, current_user=w.fu)
    upd(w.v4a, [PANE])
    w.db.expire_all()
    check("saved on 4mm 1830x2440 -> 4mm 1650x2140 has it too",
          w.db.get(Variant, w.v4b.variantId).popular_size_ranges, [PANE])
    check("5mm (another pool) is untouched", w.db.get(Variant, w.v5.variantId).popular_size_ranges, [])
    check("the engine reads it from either sheet size",
          (g._meets_popular_threshold((600, 1100), w.db.get(Variant, w.v4b.variantId)),
           g._meets_popular_threshold((600, 1100), w.db.get(Variant, w.v5.variantId))), (True, False))

    new = product_service.add_variant(w.prod.productId, pmodel.VariantCreate(
        attributes={"Thickness": "4mm", "Dimensions": "1220x1830mm"}, stock_quantity=0, price=3000, price_half=0,
        price_unit=180, length=1220, width=1830), w.db)
    check("a sheet size added later inherits the pool's sizes",
          w.db.get(Variant, new.variantId).popular_size_ranges, [PANE])
    bulk = product_service.add_variants_bulk(w.prod.productId, [pmodel.VariantCreate(
        attributes={"Thickness": "5mm", "Dimensions": "1220x1830mm"}, stock_quantity=0, price=3000, price_half=0,
        price_unit=180, length=1220, width=1830)], w.db)
    check("...and one added to a pool without any gets none", w.db.get(Variant, bulk[0].variantId).popular_size_ranges, [])

    upd(w.v4a, [PANE, PANE])
    w.db.expire_all()
    check("the same range entered twice is stored once", w.db.get(Variant, w.v4b.variantId).popular_size_ranges, [PANE])

    upd(w.v4b, [])
    w.db.expire_all()
    check("clearing them on one size clears the whole pool",
          [w.db.get(Variant, v).popular_size_ranges for v in (w.v4a.variantId, w.v4b.variantId, new.variantId)],
          [[], [], []])

    # Sizes saved before they were shared (one variant only) still count pool-wide.
    w.db.exec(text('UPDATE variants SET popular_size_ranges = :r WHERE "variantId" = :v')
              .bindparams(r='[{"min_w": 520, "max_w": 650, "min_h": 1050, "max_h": 1190}]', v=w.v4b.variantId))
    w.db.commit()
    w.db.expire_all()
    check("a pool with sizes on one variant only: the other reads them",
          g.popular_ranges(w.db.get(Variant, w.v4a.variantId)), [PANE])
    w.close()


# ── 3. Small offcuts first ───────────────────────────────────────────────────────────────
def t_clearing():
    print("\n--- 3a. Order 269: two 552x914 - the small 1018x571 takes one, the big offcut stays big ---")
    w = World(ranges=[PANE])
    w.offcut(1018, 571)
    w.offcut(1830, 1038)
    o, i = w.sale((552, 914, 2))
    check("one from the small offcut, one from the popular one",
          w.sources(i), [("offcut", (571, 1018)), ("offcut", (1038, 1830))])
    check("the small offcut is used up", (571, 1018) in [p[:2] for p in w.pool()], False)
    check("no sheet", w.stock(), 20)
    w.ok("3a")
    w.close()

    print("\n--- 3b. Order 301: two 350x524 - the 560x700 is used up, not the long 351x1613 strip ---")
    w = World(ranges=[PANE])
    w.offcut(351, 1613)
    w.offcut(560, 700)
    w.offcut(1650, 1094)
    o, i = w.sale((350, 524, 2))
    check("cut from the 560x700", w.sources(i), [("offcut", (560, 700))])
    check("the strip and the popular offcut are untouched",
          [p[:2] for p in w.pool() if p[2] == "available"], [(351, 1613), (1094, 1650)])
    w.ok("3b")
    w.close()

    print("\n--- 3c. Best fit: the big piece gets the small offcut it needs, the tiny piece the tiniest ---")
    w = World(ranges=[PANE])
    w.offcut(520, 520)
    w.offcut(170, 170)
    w.offcut(900, 900)
    o, i = w.sale((500, 500, 1), (150, 150, 1))
    check("500x500 from the 520x520, 150x150 from the 170x170",
          w.sources(i), [("offcut", (170, 170)), ("offcut", (520, 520))])
    check("the 900x900 is untouched", (900, 900) in [p[:2] for p in w.pool()], True)
    w.ok("3c")
    w.close()

    print("\n--- 3c2. Two pieces that use one offcut up aren't split over two offcuts ---")
    w = World(ranges=[PANE])
    w.offcut(300, 400)
    w.offcut(620, 400)
    o, i = w.sale((300, 400, 2))
    check("both from the 620x400 (used up), the 300x400 stays", w.sources(i), [("offcut", (400, 620))])
    check("the 300x400 is untouched", (300, 400) in [p[:2] for p in w.pool()], True)
    w.close()

    print("\n--- 3d. A piece no offcut fits takes a sheet; the small piece still clears a small offcut ---")
    w = World(ranges=[PANE])
    w.offcut(320, 320)
    o, i = w.sale((1200, 1700, 1), (300, 300, 1))
    check("300x300 from the 320x320, the big piece from a sheet", w.sources(i), [("offcut", (320, 320)), ("sheet", None)])
    check("one sheet", w.stock(), 19)
    w.db.expire_all()
    sheet_cuts = [c for l in w.db.get(OrderItem, i.item_id).details["lineItems"] for e in l["offcut_sources"]
                  if e["source"] == "sheet" for c in e["cuts"]]
    check("the sheet holds only the big piece - its leftover isn't cut into for the small one",
          [mm(c["width"], c["height"]) for c in sheet_cuts], [(1200, 1700)])
    w.ok("3d")
    w.close()

    print("\n--- 3e. Only popular offcuts fit: they are used as before, sheets still last ---")
    w = World(ranges=[PANE])
    w.offcut(300, 300)
    w.offcut(1000, 1200)
    o, i = w.sale((600, 1100, 1))
    check("the pane from the 1000x1200", w.sources(i), [("offcut", (1000, 1200))])
    check("no sheet", w.stock(), 20)
    w.ok("3e")
    w.close()

    print("\n--- 3f. Sizes set on the OTHER sheet size of the pool still drive the choice ---")
    w = World()
    w.v4b.popular_size_ranges = [PANE]
    w.db.add(w.v4b)
    w.db.commit()
    w.offcut(1018, 571)
    w.offcut(1830, 1038)
    o, i = w.sale((552, 914, 2))
    check("a sale on 4mm 1830x2440 clears the small offcut", w.sources(i), [("offcut", (571, 1018)), ("offcut", (1038, 1830))])
    w.close()


# ── 4. No popular sizes: nothing changes ─────────────────────────────────────────────────
def t_no_ranges():
    print("\n--- 4. No popular sizes set: the engine behaves as before ---")
    w = World()
    w.offcut(1018, 571)
    w.offcut(1830, 1038)
    o, i = w.sale((552, 914, 2))
    check("both pieces from the one offcut that takes both (as before)", w.sources(i), [("offcut", (1038, 1830))])
    w.ok("4")
    w.close()


# ── 5. The preview shows what the sale does ──────────────────────────────────────────────
def t_preview():
    print("\n--- 5. Cut preview picks the same small offcut ---")
    w = World(ranges=[PANE])
    small = w.offcut(560, 700)
    w.offcut(351, 1613)
    cuts = [pmodel.GlassCutPreviewCut(l=350, w=524, qty=2, u="mm")]
    res = product_service.preview_glass_cuts(w.prod.productId, cuts, w.db, variant_id=w.v4a.variantId)
    check("preview cuts from the 560x700", [gr.get("offcut_id") for gr in res["groups"]], [small])
    check("and reports the small offcuts cleared",
          [t["small_offcuts_used"] for t in res["optimization"]["trials"] if t["won"]], [1])
    check("preview saved nothing", len(w.pool()), 2)
    w.close()


# ── 6. Edit, cancel, correction ──────────────────────────────────────────────────────────
def t_reversals():
    print("\n--- 6a. Cancel 'not cut' gives the small offcuts back exactly ---")
    w = World(ranges=[PANE])
    for d in ((520, 520), (170, 170), (900, 900), (1830, 1038)):
        w.offcut(*d)
    before, stock = w.pool(), w.stock()
    o, i = w.sale((500, 500, 1), (150, 150, 1))
    w.cancel(o)
    check("pool and stock exactly as before the sale", (w.pool(), w.stock()), (before, stock))
    w.ok("6a")
    w.close()

    print("\n--- 6b. Edit: a changed size is re-cut small-first, the old cut given back ---")
    w = World(ranges=[PANE])
    for d in ((560, 700), (420, 600), (1650, 1094)):
        w.offcut(*d)
    o, i = w.sale((350, 524, 1))
    check("sold from the 420x600 (smallest that fits)", w.sources(i), [("offcut", (420, 600))])
    plan = orderService.get_reversal_plan(o.orderId, w.db, w.fu,
                                          incoming_items=[M.req_from_item(i, lines=[M.line_cut_2d(500, 650)])])
    conf = {l["line_ref"]: NOT_CUT for l in plan["lines"]}
    M.edit(w.db, o, w.user, [M.req_from_item(i, lines=[M.line_cut_2d(500, 650)])], confirmations=conf)
    w.db.commit()
    new_item = w.db.exec(select(OrderItem).where(OrderItem.order_id == o.orderId)).first()
    check("500x650 now from the 560x700 (the 420x600 is back, too small for it)",
          w.sources(new_item), [("offcut", (560, 700))])
    check("the 420x600 is back in the pool", (420, 600) in [p[:2] for p in w.pool()], True)
    w.ok("6b")
    w.close()

    print("\n--- 6c. A missed cut is re-supplied from a small offcut first ---")
    w = World(ranges=[PANE])
    o, i = w.sale((600, 400, 2))
    check("sold from a sheet (no offcuts yet)", w.sources(i), [("sheet", None)])
    small = w.offcut(610, 410)      # smaller than the sheet's own 630x400 leftover: the best fit
    ev = i.details["lineItems"][0]["offcut_sources"][0]
    rems = [{"width": r["width"], "height": r["height"]} for r in ev["remainders_created"]]
    orderService.correct_offcut_for_order_item(o.orderId, i.item_id, 0, 0, [model.OffcutRemainderInput(**r) for r in rems],
                                               [model.FailedCutRef(line_idx=0, cut_idx=1)], None, "probe", w.db, w.fu)
    line = w.db.get(OrderItem, i.item_id).details["lineItems"][0]
    check("the replacement is the smallest small offcut it uses up (610x410)", (line["offcut_sources"][-1]["source"], line["offcut_sources"][-1]["offcut_id"]),
          ("offcut", small))
    w.ok("6c")
    w.close()


# ── 7. Sale windows ──────────────────────────────────────────────────────────────────────
def t_windows():
    print("\n--- 7. A sale window clears the small offcut; releasing gives it back ---")
    with Session(T.engine) as db:
        require_test_db(T.engine)
        T.reset(db)
        db.exec(text("TRUNCATE stock_operations, stock_journal RESTART IDENTITY"))
        db.commit()
        cat = M.seed_base(db)[0]
        alice = T.seed_user(db, "small-first-alice")
        p = Product(name="Window small-first glass", category_id=cat.categoryId, stock_quantity=10, track_offcuts=True,
                    has_variants=True, has_dimensions=True, unit="mm", pool_ignored_attributes=["Dimensions"])
        db.add(p)
        db.flush()
        v = Variant(product_id=p.productId, name="4mm", attributes={"Thickness": "4mm", "Dimensions": "1830x2440mm"},
                    stock_quantity=10, price=6000, price_half=3200, price_unit=180, length=1830, width=2440,
                    min_usable=150, popular_size_ranges=[PANE])
        db.add(v)
        db.commit()
        M.rebaseline(db)
        for d in ((560, 700), (351, 1613), (1650, 1094)):
            _upsert_glass_offcut(db, p, v, float(d[0]), float(d[1]), "available", origin="manual_entry")
        db.commit()

        def public_pool():
            db.expire_all()
            return sorted((round(min(r.width, r.height)), round(max(r.width, r.height)))
                          for r in db.exec(select(Offcut).where(Offcut.product_id == p.productId, Offcut.quantity > 0,
                                                                Offcut.held_by_order_id.is_(None),
                                                                Offcut.status == "available")).all())
        before = public_pool()
        win = T.open_w(db, alice)
        two = T.glass(p, v, 350, 524)
        two.details["lineItems"][0]["qty"] = 2          # one item, two panes
        win = T.set_cart(db, alice, win, [two])
        check("the window took the small 560x700", (560, 700) in public_pool(), False)
        check("the strip and the popular offcut are untouched", [(351, 1613), (1094, 1650)] == [x for x in public_pool()
                                                                                                if x != (560, 700)], True)
        T.release(db, alice, win)
        check("released: the pool is as before", public_pool(), before)
        check("consistency", integrity.check(db)["errors"], [])
        win = T.open_w(db, alice)
        win = T.set_cart(db, alice, win, [T.glass(p, v, 350, 524)])
        T.confirm(db, alice, win)
        check("confirmed: the 560x700 is used, nothing else", [x for x in public_pool() if x[0] >= 351],
              [(351, 1613), (1094, 1650)])
        check("consistency after confirm", integrity.check(db)["errors"], [])
        db.exec(text("UPDATE system_settings SET value = 'false' WHERE key = 'sale_windows_enabled'"))
        db.commit()


# ── 8. An empty cell in a grid layout is glass, not nothing ──────────────────────────────
def t_grid_hole():
    print("\n--- 8. Three pieces laid out 2x2: the empty cell is a leftover (orders 108, 211) ---")
    one = [{"line_idx": 0, "piece_w": 600.0, "piece_h": 500.0, "remaining": 3}]
    res = g._pack_rect_multi(1250, 1050, one, True, g.DEFAULT_STRATEGY, 150)
    area = sum(c["width"] * c["height"] for c in res["placed"]) + sum(r["width"] * r["height"] for r in res["remainders"])
    check("every mm2 of the offcut is a piece or a leftover", 1250 * 1050 - area, 0)
    check("the empty 600x500 cell is a leftover", (600.0, 500.0) in [(r["width"], r["height"]) for r in res["remainders"]], True)
    two = one + [{"line_idx": 1, "piece_w": 550.0, "piece_h": 450.0, "remaining": 1}]
    check("another piece can be cut from it", len(g._pack_rect_multi(1250, 1050, two, True, g.DEFAULT_STRATEGY, 150)["placed"]), 4)
    w = World()
    w.offcut(1250, 1050)
    o, i = w.sale((600, 500, 3))
    check("a real sale puts the 600x500 in the pool", (500, 600, "available", "Thickness=4mm") in w.pool(), True)
    w.ok("8")
    w.cancel(o)
    check("and cancelling it gives the offcut back whole", [p[:2] for p in w.pool()], [(1050, 1250)])
    w.ok("8 cancel")
    w.close()


# ── 9. The first cut: a big piece is also tried first ────────────────────────────────────
def t_first_cut():
    print("\n--- 9. Order 386: half sheet + 2 x 500x1040 - the half sheet goes first, the leftover stays big ---")
    half = {"type": "sheet-half", "qty": 1, "meta": {"halfSide": "width"}, "label": "Half", "rate": 3200, "total": 3200}
    for typed in ((500, 1040), (1040, 500)):
        w = World()
        o, i = w.sale(lines=[dict(half), M.line_cut_2d(*typed, qty=2)])
        check(f"one sheet (cut typed {typed[0]}x{typed[1]})", w.stock(), 19)
        check("keeps 830x1220 and 1000x180 - not 830x1040 and 1830x180",
              sorted(p[:2] for p in w.pool()), [(180, 1000), (830, 1220)])
        w.ok("9")
        w.close()


# ── 10. A thin sliver is worth one bigger leftover ───────────────────────────────────────
def t_sliver_for_bigger_leftover():
    print("\n--- 10. Order 351: 414x263 from a 440x820 keeps 440x557 (+ a 26mm sliver), not 440x406 + a 177mm strip ---")
    for typed in ((263, 414), (414, 263)):
        w = World()
        w.offcut(440, 820)
        o, i = w.sale((typed[0], typed[1], 1))
        check(f"cut from the 440x820 (typed {typed[0]}x{typed[1]})", w.sources(i), [("offcut", (440, 820))])
        check("keeps one 440x557", [p[:2] for p in w.pool() if p[2] == "available"], [(440, 557)])
        check("the 26mm sliver is scrap", [p[:2] for p in w.pool() if p[2] == "scrap"], [(26, 263)])
        w.ok("10")
        w.close()

    print("\n--- 10b. Order 322: four panes from a 1650x2140 sheet keep one 533x2140, not 542x1080 + 524x1060 ---")
    w = World()
    o, i = w.sale((563, 1060, 2), (554, 1059, 2), variant=w.v4b)
    check("one sheet", w.stock(w.v4b), 19)
    check("one long leftover", [p[:2] for p in w.pool() if p[2] == "available"], [(533, 2140)])
    w.ok("10b")
    w.close()

    print("\n--- 10b2. The pick between strategies makes the same trade (else it undoes it) ---")
    w = World()
    o, i = w.sale((990, 910, 1), (1145, 927, 1), (439, 1211, 1))
    check("one sheet", w.stock(), 19)
    check("keeps a full-length 619x2440, not 685x2001 + strips",
          (619, 2440) in [p[:2] for p in w.pool() if p[2] == "available"], True)
    w.ok("10b2")
    w.close()

    print("\n--- 10c. A bigger leftover never wins at a higher cost in scrap ---")
    tidy = {"placed": [{"width": 100, "height": 100}], "remainders": [{"width": 400, "height": 250}]}          # 100,000, no scrap
    costly = {"placed": [{"width": 100, "height": 100}], "remainders": [{"width": 400, "height": 300},        # 120,000 ...
                                                                       {"width": 100, "height": 500}]}       # ... + 50,000 scrap
    check("the tidy layout wins", g._pack_result_key(tidy, 150) < g._pack_result_key(costly, 150), True)
    fair = {"placed": [{"width": 100, "height": 100}], "remainders": [{"width": 400, "height": 300},
                                                                     {"width": 10, "height": 500}]}           # 120,000 + 5,000 scrap
    check("...and a sliver smaller than the gain is worth it", g._pack_result_key(fair, 150) < g._pack_result_key(tidy, 150), True)


# ── 11. A later cut with no order item doesn't break a cancel or edit ────────────────────
def t_later_cut_without_item():
    print("\n--- 11. A later cut recorded without an order item (early-October corrections) ---")
    w = World()
    o, i = w.sale((600, 400, 1))
    decisions = rp.ReversalDecisions({(i.item_id, 0): {"physical_state": rp.PHYS_NOT_CUT, "resolution": None,
                                                       "later_cuts": {None: rp.PHYS_ALREADY_CUT}}})
    try:
        marked = rp.apply_later_cut_answers(w.db, None, decisions, o.orderId)
    except Exception as e:      # was: int(None) - the whole cancel/edit failed (order #219)
        marked = f"{type(e).__name__}: {e}"
    check("answered 'already cut': nothing to mark, no error", marked, [])
    w.db.rollback()
    w.close()


# ── 12. Randomised property test ──────────────────────────────────────────────────────────
def fits(piece, rect):
    return max(piece) <= max(rect) + 1e-6 and min(piece) <= min(rect) + 1e-6


def t_random(rounds=60, seed=20261009):
    print(f"\n--- 8. Random pools and orders ({rounds} rounds) ---")
    rnd = random.Random(seed)
    w = World(ranges=[PANE])
    w.v4a.stock_quantity = 500
    w.db.add(w.v4a)
    w.db.commit()
    bad = {"small first": [], "sheets last": [], "area kept": [], "cancel restores": [], "consistency": []}
    for n in range(rounds):
        with_ranges = n % 4 != 3          # every 4th round: no popular sizes (old behaviour)
        w.v4a.popular_size_ranges = [PANE] if with_ranges else []
        w.v4b.popular_size_ranges = []
        w.db.add_all([w.v4a, w.v4b])
        w.db.commit()
        for _ in range(rnd.randint(0, 4)):                       # top up the pool
            w.offcut(rnd.randint(160, 1800), rnd.randint(160, 1300))
        cuts = [(rnd.randint(150, 1400), rnd.randint(150, 1700), rnd.randint(1, 3)) for _ in range(rnd.randint(1, 3))]
        pool_before, stock_before = w.pool(), w.stock()
        before_rows = {r.offcutId: (r.width, r.height, r.quantity) for r in
                       w.db.exec(select(Offcut).where(Offcut.product_id == w.prod.productId, Offcut.quantity > 0,
                                                      Offcut.status == "available")).all()}
        try:
            o, i = w.sale(*cuts)
        except Exception as e:  # a cut bigger than the sheet: refused, nothing moved
            w.db.rollback()
            if w.pool() != pool_before or w.stock() != stock_before:
                bad["area kept"].append((n, "a refused sale moved material", str(e)[:60]))
            continue
        w.db.expire_all()
        item = w.db.get(OrderItem, i.item_id)
        events = [e for l in item.details["lineItems"] for e in l["offcut_sources"]]
        used = {e["offcut_id"] for e in events if e["source"] == "offcut"}
        after_rows = {r.offcutId: r.quantity for r in
                      w.db.exec(select(Offcut).where(Offcut.product_id == w.prod.productId, Offcut.quantity > 0)).all()}
        # offcuts that existed before the sale and are still there, unused
        left = [(wd, ht) for rid, (wd, ht, q) in before_rows.items() if rid not in used and after_rows.get(rid, 0) >= q]
        small_left = [r for r in left if not g._meets_popular_threshold(r, w.v4a)] if with_ranges else []
        groups = {}
        for e in events:
            groups.setdefault(e["group_id"], []).append(e)
        for gid, evs in groups.items():
            owner = next(e for e in evs if e.get("owns_consumption", True))
            pieces = [(c["width"], c["height"]) for e in evs for c in e["cuts"]]
            src_small = owner["source"] == "offcut" and with_ranges and not g._meets_popular_threshold(
                (owner["offcut_width"], owner["offcut_height"]), w.v4a)
            if not src_small and any(fits(pc, r) for pc in pieces for r in small_left):
                bad["small first"].append((n, owner["source"], pieces, small_left))
            if owner["source"] == "sheet" and any(fits(pc, r) for pc in pieces for r in left):
                bad["sheets last"].append((n, pieces, left))
        # glass in = glass out: pool before + sheets drawn = pool after + pieces sold
        area = lambda pool: sum(a * b for a, b, *_ in pool)
        sheets = stock_before - w.stock()
        sold = sum(c["width"] * c["height"] for e in events for c in e["cuts"])
        # A leftover within 1mm of an existing row joins it (OFFCUT_MATCH_TOLERANCE_MM), so the
        # pool may be off by up to 1mm along each side of each leftover made.
        slack = sum(r["width"] + r["height"] for e in events for r in e["remainders_created"]) + 1
        if abs(area(pool_before) + sheets * 1830 * 2440 - area(w.pool()) - sold) > slack:
            bad["area kept"].append((n, area(pool_before), sheets, area(w.pool()), sold))
        errs = integrity.check(w.db)["errors"]
        if errs:
            bad["consistency"].append((n, errs[:2]))
        if n % 3 == 0:                                            # some orders are cancelled at once
            w.cancel(o)
            if (w.pool(), w.stock()) != (pool_before, stock_before):
                bad["cancel restores"].append((n, cuts))
    for rule, cases in bad.items():
        check(f"random: {rule}", cases[:3], [])
    w.close()


def main():
    t_orientation()
    t_pool_wide()
    t_clearing()
    t_no_ranges()
    t_preview()
    t_reversals()
    t_windows()
    t_grid_hole()
    t_first_cut()
    t_sliver_for_bigger_leftover()
    t_later_cut_without_item()
    t_random()
    print("\n" + "=" * 68)
    if failures:
        print(f"{len(failures)} FAILED:")
        for f in failures:
            print(f"  - {f}")
        raise SystemExit(1)
    print("All small-offcut checks passed.")


if __name__ == "__main__":
    main()
