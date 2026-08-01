"""
2D (glass) offcut decision engine.

Glass is sold as full sheet, half sheet, or a custom L×W cut. When a cut is sold,
it must come from either an existing offcut or a fresh sheet, and the leftover
material forms up to two new rectangular offcuts (a "guillotine" cut). Instead of
a single-factor "smallest offcut that fits" rule, the choice is scored by several
small, independent, deterministic "decision agents" and the highest-scoring
candidate wins. Deterministic and synchronous by design — this runs inline in the
POS checkout path (deduct_stock_for_order_item), so no LLM/network call belongs here.

The agents from the design brief map to:
  1. WasteAgent            -> _score_waste            (minimize scrap area)
  2. SellabilityAgent      -> _score_sellability       (reward remainders close to
                                                         historically popular sizes)
  3. ProtectPopularStockAgent -> _score_protect_popular (don't cut into an offcut
                                                         whose own size already sells well)
  4. AgingAgent            -> _score_aging             (use up older offcuts first)
  5. FreshSheetPenaltyAgent -> _score_fresh_penalty    (prefer offcuts over a new sheet)
  6. MinUsableSizeAgent    -> _is_scrap                (classifier, not a weighted score:
                                                         decides what counts as "scrap" for
                                                         agents 1 and 2 below the minimum
                                                         usable size)
  7. SizeMatchAgent        -> _score_size_fit          (reward a source whose dimensions
                                                         closely match the pieces placed in
                                                         it -- a snug small offcut over a
                                                         needlessly large one when both fit
                                                         the same pieces; weighted low so it
                                                         only breaks near-ties, never
                                                         overrides waste/protect_popular)

Source tiering (see _fulfill_pool): the engine only splits a pool of cuts across
two offcuts when doing so protects something worth protecting. It first finds
the "consolidated" choice -- whichever offcut the normal weighted score would
pick with no size preference at all -- and only reaches past it for a smaller
offcut when cutting the consolidated one would leave a genuinely good,
non-scrap remainder that's meaningfully bigger than the cut itself (not just
barely so) AND a smaller offcut is available to take the cut instead. If
cutting the consolidated offcut would leave scrap anyway, or would leave next
to nothing beyond the cut itself, there's nothing worth preserving by going
elsewhere, so it's used as-is regardless of what other offcuts exist. This is
what makes two same-size cuts against a small offcut and a large offcut each
claim one -- the small, already-marginal offcut absorbs a cut it can only just
fit, and the large offcut is only asked for what's left afterward, surviving as
one large (easier to sell, less backlog) remainder instead of being grid-packed
down into several medium ones -- while a large offcut that could easily serve
the whole order alone (with no smaller offcut worth diverting to, or nothing
distinctive left to protect) is simply used as-is. An offcut whose own whole
size already sells well (see ProtectPopularStockAgent) is excluded from being
the "consolidated" pick entirely -- it's only reached for if no other offcut
can do the job -- so protecting popular stock always wins over this.

Mirrors the 1D bar/profile system in inventoryService.py (_fulfill_one_cut_via_best_fit /
apply_manual_cut_selection / restore_specific_offcut_sources) but generalizes a single
length comparison into a weighted multi-factor score, and a single remainder into up to
two rectangular remainders.

All glass-cut lines belonging to one OrderItem are packed jointly, not one line at a
time (see resolve_glass_cut_lines/_pack_rect_multi): when a source gets opened, every
other line's still-unmet pieces are also considered for its leftover space, so two
different cut sizes can end up sharing one sheet if they happen to nest together — not
just multiple identical copies of the same size (_grid_arrangement). A candidate's
score always maximizes total pieces placed per source first, since splitting pieces
off one at a time (or opening a needless second sheet when the first still has usable
room) fragments material into more, smaller, worse-shaped remainders than packing them
together would, even though the total wasted area can be identical either way.

Canonical unit: millimeters, always. `Product.unit` is a display/pricing label (and is
not reliable as a physical-dimension unit — e.g. a product can be labeled unit="ft" while
its variant dimensions are plainly mm-scale numbers). What IS reliable, confirmed against
real data: every has_dimensions=True product stores its sheet size in Variant.length x
Variant.width (NOT Variant.width x Variant.height — `height` is unused/dead on every
existing product), always in millimeters. So sheet/offcut geometry always happens in mm;
only the cashier's cut input (in ft/inch/mm, from GlassCalculator's per-cut unit dropdown)
needs converting, into mm, before comparison.
"""

import time
import uuid
from datetime import datetime
from typing import Optional

from sqlmodel import Session, select

from entities.offcuts import Offcut
from entities.products import Product
from entities.variants import Variant
from entities.orderItems import OrderItem
from loggiing import logger


# ── Unit normalization ────────────────────────────────────────────────────────

MM_PER_FOOT = 304.79999025
MM_PER_INCH = 25.4


def _cut_dims_to_mm(l: float, w: float, unit: str) -> tuple:
    """Converts a cashier-entered cut (in ft/inch/mm) into millimeters — the
    canonical unit sheet/offcut dimensions are always stored in. No rounding is
    applied here: the half-foot rounding in GlassCalculator.jsx's getArea() is a
    square-foot PRICING convention only, unrelated to the actual physical size of
    the piece being cut and tracked in inventory."""
    if unit == "ft":
        return l * MM_PER_FOOT, w * MM_PER_FOOT
    if unit == "inch":
        return l * MM_PER_INCH, w * MM_PER_INCH
    return float(l), float(w)  # 'mm' (default/native)


# ── Geometry ───────────────────────────────────────────────────────────────────

def _grid_arrangement(src_w: float, src_h: float, piece_w: float, piece_h: float, needed: int) -> Optional[dict]:
    """
    How many copies of (piece_w x piece_h) fit in (src_w x src_h) as one axis-aligned
    grid sharing a single guillotine split, up to `needed`. Shelf-packs left-to-right,
    then top-to-bottom, using as many pieces as fit per row before starting a new row.
    Always maximizes pieces-per-source (up to `needed`) rather than exploring smaller
    grids — packing more identical pieces into one source in one operation directly
    produces fewer, larger remainders than resolving them one at a time would.
    Returns None if not even one piece fits.
    """
    if piece_w <= 1e-6 or piece_h <= 1e-6:
        return None
    tol = 1e-6  # absorbs unit-conversion float noise (e.g. 3ft -> 914.39997075mm)
    max_cols = int((src_w + tol) // piece_w)
    max_rows = int((src_h + tol) // piece_h)
    capacity = max_cols * max_rows
    if capacity < 1:
        return None

    k = min(capacity, needed)
    cols = min(k, max_cols)
    rows = -(-k // cols)  # ceil division, guaranteed <= max_rows since k <= capacity

    positions = []
    remaining = k
    for r in range(rows):
        row_count = min(cols, remaining)
        for c in range(row_count):
            positions.append((c * piece_w, r * piece_h))
        remaining -= row_count

    return {"k": k, "grid_w": cols * piece_w, "grid_h": rows * piece_h, "positions": positions}


def _orientations(w: float, h: float, allow_rotation: bool):
    """Yields (cut_w, cut_h, rotated) — both orientations if rotation is allowed
    and the piece isn't square (rotating a square changes nothing)."""
    orientations = [(w, h, False)]
    if allow_rotation and abs(w - h) > 1e-6:
        orientations.append((h, w, True))
    return orientations


def _get_full_dims(variant: Optional[Variant]) -> tuple:
    """The sheet's full size, in mm. Every has_dimensions=True product stores this
    as Variant.length x Variant.width (Variant.height is unused/dead — see module
    docstring), regardless of what Product.unit is labeled."""
    if variant and variant.length and variant.width:
        return float(variant.length), float(variant.width)
    return 0.0, 0.0


# ── Packing strategies ───────────────────────────────────────────────────────
# Multiple tie-break heuristics are tried per resolution (see resolve_glass_cut_lines)
# and the best FULL result is kept — dedicated nesting tools get better results
# mainly through this kind of breadth-of-search (many strategies, keep the best),
# not one fundamentally cleverer algorithm. Each strategy only varies two decision
# points inside _pack_rect_multi: which pending need to try first at a level, and
# which guillotine split direction to take.
#
# Known gap, tried and reverted (see git history / conversation record): a
# "grab one unit at a time, re-evaluate the whole pool between placements"
# variant was tried to let two copies of the same shape land in different
# orientations (needed for layouts where e.g. one pane lies flat and its twin
# stands rotated in a column to free space for a different line). It didn't
# find that layout even with the tie-break flipped both ways, because the
# choice is fundamentally a lookahead problem — a locally-greedy rule, however
# it's tie-broken, can't see that the SECOND placement should differ from the
# first. Real fix would need bounded backtracking/branching search, which is a
# materially different (and costlier) approach than this portfolio-of-greedy-
# heuristics one; not implemented since the two attempted variants added ~35%
# latency for zero measured benefit.

def _need_key_area(need: dict) -> float:
    return -(need["piece_w"] * need["piece_h"])


def _need_key_longest_side(need: dict) -> float:
    # max()/min() here — NOT raw piece_w/piece_h — is deliberate: piece_w/piece_h
    # are literally whichever of L/W the cashier typed first for that line, so
    # ranking lines against each other by the raw (non-canonical) value would
    # make the multi-line packing order depend on which axis was typed first,
    # even though the physical piece (and every valid orientation of it — see
    # _orientations) is identical either way. Same class of bug already fixed
    # once for single-need tie-breaks (_candidate_sort_key/_pack_rect_multi's own
    # orientation choice) — this is the same fix applied to cross-line ranking.
    return -max(need["piece_w"], need["piece_h"])


def _need_key_shortest_side(need: dict) -> float:
    return -min(need["piece_w"], need["piece_h"])


def _need_key_perimeter(need: dict) -> float:
    return -(need["piece_w"] + need["piece_h"])  # already symmetric in w/h, no fix needed


def _prefer_larger_remainder(rect_a_h: dict, rect_b_h: dict, rect_a_v: dict, rect_b_v: dict) -> bool:
    """True picks the horizontal split — whichever direction leaves the larger
    single remainder, keeping leftover material consolidated."""
    max_h = max(rect_a_h["width"] * rect_a_h["height"], rect_b_h["width"] * rect_b_h["height"])
    max_v = max(rect_a_v["width"] * rect_a_v["height"], rect_b_v["width"] * rect_b_v["height"])
    return max_h >= max_v


def _prefer_smaller_remainder(rect_a_h: dict, rect_b_h: dict, rect_a_v: dict, rect_b_v: dict) -> bool:
    max_h = max(rect_a_h["width"] * rect_a_h["height"], rect_b_h["width"] * rect_b_h["height"])
    max_v = max(rect_a_v["width"] * rect_a_v["height"], rect_b_v["width"] * rect_b_v["height"])
    return max_h < max_v


DEFAULT_STRATEGY = {"name": "area_desc_larger_remainder", "need_key": _need_key_area, "prefer_horizontal": _prefer_larger_remainder}

STRATEGIES = [
    DEFAULT_STRATEGY,
    {"name": "area_desc_smaller_remainder", "need_key": _need_key_area, "prefer_horizontal": _prefer_smaller_remainder},
    {"name": "longest_side_desc", "need_key": _need_key_longest_side, "prefer_horizontal": _prefer_larger_remainder},
    {"name": "shortest_side_desc", "need_key": _need_key_shortest_side, "prefer_horizontal": _prefer_larger_remainder},
    {"name": "perimeter_desc", "need_key": _need_key_perimeter, "prefer_horizontal": _prefer_larger_remainder},
]


# ── Recursive packing ────────────────────────────────────────────────────────

def _pack_rect_multi(w: float, h: float, needs: list, allow_rotation: bool, strategy: dict = DEFAULT_STRATEGY, depth: int = 0, max_depth: int = 5) -> dict:
    """
    Greedily packs pieces from a POOL of possibly-different pending needs (each
    {"line_idx", "piece_w", "piece_h", "remaining"}) into (w x h) — not just one
    shape. At each level: try needs in the order `strategy["need_key"]` ranks
    them, use the first one that actually fits (so a smaller pending need still
    gets a chance when the top-ranked one doesn't fit anymore), place as many of
    it as fit, guillotine-split (direction chosen by `strategy["prefer_horizontal"]`),
    then recurse into the leftover with the SAME shared pool (updated) — so the
    next level reconsiders every other still-unmet need, including different
    shapes. This is what lets two different order lines share one sheet-opening
    operation when their pieces happen to nest together, instead of each line
    only ever getting to reuse whatever a fully-independent earlier line left.

    Returns {"placed": [{"line_idx","x","y","width","height","rotated"}, ...],
    "remainders": [{width,height,x,y}, ...]} — coordinates local to (w, h).
    Does not mutate the input `needs` list. Bounded by max_depth (a safety cap,
    not expected to bind for realistic order sizes).
    """
    eps = 1e-6
    active = [n for n in needs if n["remaining"] > 0]
    if not active or w <= eps or h <= eps or depth >= max_depth:
        remainders = [{"width": w, "height": h, "x": 0.0, "y": 0.0}] if w > eps and h > eps else []
        return {"placed": [], "remainders": remainders}

    # Try needs in the strategy's ranked order; use the first that actually fits
    # here — ties within one need broken by grid area then the orientation's own
    # width value, never by which one _orientations happened to yield first
    # (keeps results independent of which of L/W a cashier typed).
    active.sort(key=strategy["need_key"])
    chosen, chosen_need = None, None
    for need in active:
        best = None
        for ow, oh, rotated in _orientations(need["piece_w"], need["piece_h"], allow_rotation):
            arrangement = _grid_arrangement(w, h, ow, oh, need["remaining"])
            if not arrangement:
                continue
            key = (arrangement["k"], arrangement["grid_w"] * arrangement["grid_h"], ow)
            if best is None or key > best["_key"]:
                arrangement.update(ow=ow, oh=oh, rotated=rotated, _key=key)
                best = arrangement
        if best is not None:
            chosen, chosen_need = best, need
            break

    if chosen is None:
        return {"placed": [], "remainders": [{"width": w, "height": h, "x": 0.0, "y": 0.0}]}

    placed = [
        {"line_idx": chosen_need["line_idx"], "x": px, "y": py, "width": chosen["ow"], "height": chosen["oh"], "rotated": chosen["rotated"]}
        for (px, py) in chosen["positions"]
    ]
    grid_w, grid_h = chosen["grid_w"], chosen["grid_h"]

    rect_a_h, rect_b_h = _layout_remainder_rects(w, h, grid_w, grid_h, "horizontal")
    rect_a_v, rect_b_v = _layout_remainder_rects(w, h, grid_w, grid_h, "vertical")
    rect_a, rect_b = (rect_a_h, rect_b_h) if strategy["prefer_horizontal"](rect_a_h, rect_b_h, rect_a_v, rect_b_v) else (rect_a_v, rect_b_v)

    next_needs = [
        {**n, "remaining": n["remaining"] - chosen["k"]} if n is chosen_need else n
        for n in needs
    ]

    all_placed = list(placed)
    all_remainders = []
    for rect in sorted((rect_a, rect_b), key=lambda r: -(r["width"] * r["height"])):
        if rect["width"] <= eps or rect["height"] <= eps:
            continue
        sub = _pack_rect_multi(rect["width"], rect["height"], next_needs, allow_rotation, strategy, depth + 1, max_depth)
        for c in sub["placed"]:
            all_placed.append({**c, "x": c["x"] + rect["x"], "y": c["y"] + rect["y"]})
        for r in sub["remainders"]:
            all_remainders.append({**r, "x": r["x"] + rect["x"], "y": r["y"] + rect["y"]})
        if sub["placed"]:
            consumed_by_line = {}
            for c in sub["placed"]:
                consumed_by_line[c["line_idx"]] = consumed_by_line.get(c["line_idx"], 0) + 1
            next_needs = [
                {**n, "remaining": n["remaining"] - consumed_by_line.get(n["line_idx"], 0)}
                for n in next_needs
            ]

    return {"placed": all_placed, "remainders": all_remainders}


# ── Candidate generation ────────────────────────────────────────────────────────

def _generate_candidates(db: Session, product: Product, variant: Optional[Variant], needs: list, full_w: float, full_h: float, strategy: dict = DEFAULT_STRATEGY) -> list:
    """
    One candidate = one source (an existing offcut or the fresh sheet), each
    already recursively packed (see _pack_rect_multi) with as many pieces from the
    whole `needs` pool as that source can hold — possibly mixing pieces from
    different order lines when they nest together. Orientation, splits, which
    need gets placed where, and any nested recursion into leftover space are all
    decided internally by _pack_rect_multi, using the given `strategy`.
    """
    candidates = []
    allow_rotation = product.allow_rotation

    stmt = select(Offcut).where(
        Offcut.product_id == product.productId,
        Offcut.status == "available",
        Offcut.quantity > 0,
        Offcut.width.isnot(None),
        Offcut.height.isnot(None),
    )
    stmt = stmt.where(Offcut.variant_id == variant.variantId) if variant else stmt.where(Offcut.variant_id == None)  # noqa: E711
    offcuts = db.exec(stmt).all()

    for oc in offcuts:
        pack = _pack_rect_multi(oc.width, oc.height, needs, allow_rotation, strategy)
        if not pack["placed"]:
            continue
        candidates.append({
            "source_kind": "offcut", "source_id": oc.offcutId,
            "source_w": oc.width, "source_h": oc.height,
            "source_created_at": oc.created_at,
            "placed": pack["placed"], "remainders": pack["remainders"],
        })

    if full_w > 0 and full_h > 0:
        pack = _pack_rect_multi(full_w, full_h, needs, allow_rotation, strategy)
        if pack["placed"]:
            candidates.append({
                "source_kind": "sheet", "source_id": None,
                "source_w": full_w, "source_h": full_h,
                "source_created_at": None,
                "placed": pack["placed"], "remainders": pack["remainders"],
            })

    return candidates


# ── Decision agents ─────────────────────────────────────────────────────────────

AGENT_WEIGHTS = {
    "waste": 10.0,
    "sellability": 6.0,
    "protect_popular": 8.0,
    "aging": 2.0,
    "fresh_penalty": 4.0,
    "size_fit": 1.5,
}
AGING_CAP_DAYS = 60.0
FRESH_SHEET_PENALTY = 1.0
POPULARITY_TOLERANCE_MM = 25.0  # sizes within 25mm are treated as "the same size"
USABLE_REMAINDER_BONUS = 0.5
MM2_PER_M2 = 1_000_000.0  # area normalizer so weights stay meaningful at mm scale
REMAINDER_SIMILAR_TO_CUT_TOLERANCE_MM = 100.0  # a remainder within this of the cut
# piece's own size isn't a meaningfully distinct leftover worth protecting — cutting
# that offcut basically consumes it whole, so there's nothing to redirect elsewhere
# to preserve (see _remainder_basically_same_as_cut / _fulfill_pool).


def _is_scrap(dims: Optional[tuple], product: Product) -> bool:
    """MinUsableSizeAgent — classifies a remainder as unsellable scrap if either
    side falls below the product's configured minimum usable dimension. This is a
    classifier feeding the other agents, not itself a weighted score."""
    if dims is None:
        return False
    w, h = dims
    m = product.min_usable_dimension or 0.0
    return w < m or h < m


def _popularity_of(dims: Optional[tuple], product: Product, popularity: dict) -> float:
    if dims is None or not popularity:
        return 0.0
    w, h = dims
    if product.allow_rotation:
        # A rectangle rotated 90° is the same physical piece — compare canonically
        # so a size's popularity is recognized regardless of which side was called
        # width vs height (both when it was recorded and when it's being looked up).
        w, h = max(w, h), min(w, h)
    best = 0
    for (pw, ph), count in popularity.items():
        if abs(pw - w) <= POPULARITY_TOLERANCE_MM and abs(ph - h) <= POPULARITY_TOLERANCE_MM:
            best = max(best, count)
    return float(best)


def _score_waste(candidate: dict, product: Product) -> float:
    """WasteAgent — penalize area that ends up as unsellable scrap (in m², so the
    weight stays meaningful regardless of the mm-scale magnitudes involved)."""
    scrap_area_mm2 = 0.0
    for r in candidate["remainders"]:
        dims = (r["width"], r["height"])
        if _is_scrap(dims, product):
            scrap_area_mm2 += r["width"] * r["height"]
    return -(scrap_area_mm2 / MM2_PER_M2)


def _score_sellability(candidate: dict, product: Product, popularity: dict) -> float:
    """SellabilityAgent — reward remainders close to historically popular sizes
    (and give any usable-but-unmatched remainder a small flat bonus, so new
    products with no sales history aren't scored as if every remainder is waste)."""
    score = 0.0
    for r in candidate["remainders"]:
        dims = (r["width"], r["height"])
        if not _is_scrap(dims, product):
            score += USABLE_REMAINDER_BONUS + _popularity_of(dims, product, popularity)
    return score


def _score_protect_popular(candidate: dict, product: Product, popularity: dict) -> float:
    """ProtectPopularStockAgent — penalize cutting into an offcut whose own size
    already sells well on its own. This is the concrete case from the brief:
    don't sacrifice an easily-sellable offcut to save a fresh sheet."""
    if candidate["source_kind"] != "offcut":
        return 0.0
    return -_popularity_of((candidate["source_w"], candidate["source_h"]), product, popularity)


def _score_aging(candidate: dict, now: datetime) -> float:
    """AgingAgent — reward consuming older offcuts first (reduce dead stock)."""
    if candidate["source_kind"] != "offcut" or not candidate.get("source_created_at"):
        return 0.0
    age_days = max(0.0, (now - candidate["source_created_at"]).total_seconds() / 86400.0)
    return min(age_days, AGING_CAP_DAYS)


def _score_fresh_penalty(candidate: dict) -> float:
    """FreshSheetPenaltyAgent — prefer an existing offcut over opening a new sheet, all else equal."""
    return -FRESH_SHEET_PENALTY if candidate["source_kind"] == "sheet" else 0.0


def _score_size_fit(candidate: dict) -> float:
    """SizeMatchAgent — rewards how snugly the placed pieces fill this source
    (placed area / source area, 0..1). A source whose dimensions are close to
    the pieces cut from it scores near 1; a needlessly large source holding the
    same pieces scores lower. Weighted low (see AGENT_WEIGHTS) — this only
    nudges near-ties, it never outweighs waste/protect_popular on its own; the
    actual "use small offcuts before large ones" behavior lives in the source
    tiering done by _fulfill_pool, not in this score."""
    source_area = candidate["source_w"] * candidate["source_h"]
    if source_area <= 0:
        return 0.0
    placed_area = sum(p["width"] * p["height"] for p in candidate["placed"])
    return placed_area / source_area


def _remainder_common_sellable(candidate: dict, product: Product) -> bool:
    """Whether cutting this candidate would leave ONLY non-scrap remainder(s) —
    used as a "common, easy-to-sell size" signal per SellabilityAgent. A fresh
    product has no sales history to check real popularity against yet, so "not
    scrap" (an ordinary, usable offcut size) stands in for "commonly sellable";
    a real popular-size match (see _popularity_of) only ever strengthens this,
    never weakens it, so it isn't re-checked here."""
    if not candidate["remainders"]:
        return False
    return all(not _is_scrap((r["width"], r["height"]), product) for r in candidate["remainders"])


def _remainder_basically_same_as_cut(candidate: dict) -> bool:
    """Whether this candidate's remainder(s) are within
    REMAINDER_SIMILAR_TO_CUT_TOLERANCE_MM of the piece actually cut — i.e.
    there's no leftover meaningfully bigger than the cut itself, so cutting
    this offcut basically consumes it whole and there's nothing distinct left
    worth protecting from a smaller offcut."""
    if not candidate["placed"]:
        return False
    cut_w, cut_h = candidate["placed"][0]["width"], candidate["placed"][0]["height"]
    tol = REMAINDER_SIMILAR_TO_CUT_TOLERANCE_MM
    for r in candidate["remainders"]:
        if (abs(r["width"] - cut_w) <= tol and abs(r["height"] - cut_h) <= tol) or \
           (abs(r["width"] - cut_h) <= tol and abs(r["height"] - cut_w) <= tol):
            return True
    return False


def _score_candidate(candidate: dict, product: Product, popularity: dict, now: datetime) -> float:
    return (
        AGENT_WEIGHTS["waste"] * _score_waste(candidate, product)
        + AGENT_WEIGHTS["sellability"] * _score_sellability(candidate, product, popularity)
        + AGENT_WEIGHTS["protect_popular"] * _score_protect_popular(candidate, product, popularity)
        + AGENT_WEIGHTS["aging"] * _score_aging(candidate, now)
        + AGENT_WEIGHTS["fresh_penalty"] * _score_fresh_penalty(candidate)
        + AGENT_WEIGHTS["size_fit"] * _score_size_fit(candidate)
    )


def _candidate_sort_key(candidate: dict, product: Product, popularity: dict, now: datetime):
    """
    Fully deterministic ordering: every field used here is a property of the
    candidate's own computed geometry/score — never its position in the list
    _generate_candidates happened to build it in. That matters because a cashier
    typing "L=1200, W=550" vs "L=550, W=1200" for the identical physical piece
    makes _orientations() explore the same two (w,h)/(h,w) candidates either way,
    just in the opposite order — without this, an exact tie between two distinct,
    equally-good candidates (e.g. a horizontal split of orientation A vs a vertical
    split of orientation B, scoring identically) would resolve to whichever one
    happened to be generated first, silently flipping the chosen layout depending
    on which dimension the cashier typed first.

    Order: prefer an existing offcut over opening a fresh sheet FIRST — an offcut
    is already-sunk, otherwise-idle material, so using even part of it is better
    than leaving it idle and opening a new sheet, regardless of whether the sheet
    could place more total pieces at once (a sheet trivially "wins" on raw piece
    count just by being bigger; that shouldn't make the engine ignore usable
    material sitting in the offcut pool). Then maximize total pieces placed per
    event (across every order line, not just one shape) — satisfying more of the
    whole pool in one guillotine operation directly avoids the fragmentation this
    engine exists to prevent. Then the weighted agent score, then source area
    ascending (a small offcut beats an equally-scored large one — see
    SizeMatchAgent/_fulfill_pool for the primary "small offcuts first" behavior,
    this is only the residual tiebreak for candidates the tiering left tied).
    Remaining ties are broken by criteria intrinsic to the candidate (largest
    single remainder, then fewest total remainder pieces — less fragmentation)
    rather than insertion order.
    """
    score = _score_candidate(candidate, product, popularity, now)
    prefer_offcut = 0 if candidate["source_kind"] == "offcut" else 1  # offcut always beats sheet
    tiebreak_id = candidate["source_id"] or 0
    source_area = candidate["source_w"] * candidate["source_h"]
    largest_remainder_area = max(
        (r["width"] * r["height"] for r in candidate["remainders"]), default=0.0
    )
    return (
        prefer_offcut, -len(candidate["placed"]), -score, source_area, tiebreak_id,
        -largest_remainder_area, len(candidate["remainders"]),
    )


# ── Popularity lookup (historical demand, used as a sellability proxy) ─────────

_popularity_cache: dict = {}
POPULARITY_CACHE_TTL = 300  # seconds
POPULARITY_HISTORY_LIMIT = 500


def _get_popularity_lookup(db: Session, product: Product, variant: Optional[Variant]) -> dict:
    cache_key = (product.productId, variant.variantId if variant else None)
    cached = _popularity_cache.get(cache_key)
    now_ts = time.time()
    if cached and now_ts - cached[0] < POPULARITY_CACHE_TTL:
        return cached[1]

    stmt = (
        select(OrderItem)
        .where(OrderItem.product_id == product.productId, OrderItem.status == "purchased")
        .order_by(OrderItem.item_id.desc())
        .limit(POPULARITY_HISTORY_LIMIT)
    )
    if variant:
        stmt = stmt.where(OrderItem.variant_id == variant.variantId)
    items = db.exec(stmt).all()

    popularity: dict = {}
    for item in items:
        details = item.details or {}
        for line in details.get("lineItems", []) or []:
            l_type = line.get("type", "")
            meta = line.get("meta", {}) or {}
            qty = int(line.get("qty", 1)) or 1
            w = h = None
            if l_type == "glass-cut":
                l_val, w_val, unit = meta.get("l"), meta.get("w"), meta.get("u", "mm")
                if l_val is not None and w_val is not None:
                    w, h = _cut_dims_to_mm(float(l_val), float(w_val), unit)
            elif l_type in ("sheet-full", "sheet-half") and variant and variant.length and variant.width:
                w, h = float(variant.length), float(variant.width)
            if w is None or h is None:
                continue
            # Bucket to the nearest 10mm so near-identical historical sizes count as one popular size
            key_w, key_h = round(w / 10.0) * 10.0, round(h / 10.0) * 10.0
            if product.allow_rotation:
                # Same physical size rotated 90° — fold into one canonical bucket
                # (matched symmetrically by _popularity_of at lookup time too).
                key_w, key_h = max(key_w, key_h), min(key_w, key_h)
            key = (key_w, key_h)
            popularity[key] = popularity.get(key, 0) + qty

    _popularity_cache[cache_key] = (now_ts, popularity)
    return popularity


OFFCUT_MATCH_TOLERANCE_MM = 1.0  # sizes within 1mm are "the same offcut" (absorbs unit-conversion float noise)


# ── Stock/offcut mutation primitives ────────────────────────────────────────────

def _lock_variant(db: Session, variant: Variant) -> Variant:
    return db.exec(select(Variant).where(Variant.variantId == variant.variantId).with_for_update()).first()


def _lock_product(db: Session, product: Product) -> Product:
    return db.exec(select(Product).where(Product.productId == product.productId).with_for_update()).first()


def _deduct_sheet_stock(db: Session, product: Product, variant: Optional[Variant], qty: int) -> None:
    if variant:
        variant = _lock_variant(db, variant)
        if variant.stock_quantity < qty:
            raise ValueError(
                f"Insufficient sheet stock for '{variant.name or product.name}'. "
                f"Available: {variant.stock_quantity}, requested: {qty}"
            )
        variant.stock_quantity -= qty
        db.add(variant)
        product = _lock_product(db, product)
        product.stock_quantity = max(0, (product.stock_quantity or 0) - qty)
        db.add(product)
    else:
        product = _lock_product(db, product)
        if product.stock_quantity < qty:
            raise ValueError(f"Insufficient sheet stock for '{product.name}'. Available: {product.stock_quantity}, requested: {qty}")
        product.stock_quantity -= qty
        db.add(product)


def _restore_sheet_stock(db: Session, product: Product, variant: Optional[Variant], qty: int) -> None:
    if variant:
        variant.stock_quantity += qty
        db.add(variant)
        product.stock_quantity = (product.stock_quantity or 0) + qty
        db.add(product)
    else:
        product.stock_quantity = (product.stock_quantity or 0) + qty
        db.add(product)


def _upsert_glass_offcut(db: Session, product: Product, variant: Optional[Variant], width: float, height: float, status: str = "available") -> int:
    """Creates or increments a matching offcut row and returns its id — callers
    attach this to the remainder's audit record so later code (e.g. the cut
    preview's consolidation of same-session offcut chains) can tell whether a
    later event consumed a genuinely pre-existing offcut or one just created."""
    stmt = select(Offcut).where(
        Offcut.product_id == product.productId,
        Offcut.status == status,
        Offcut.width.isnot(None),
        Offcut.height.isnot(None),
        Offcut.width >= width - OFFCUT_MATCH_TOLERANCE_MM, Offcut.width <= width + OFFCUT_MATCH_TOLERANCE_MM,
        Offcut.height >= height - OFFCUT_MATCH_TOLERANCE_MM, Offcut.height <= height + OFFCUT_MATCH_TOLERANCE_MM,
    ).with_for_update()
    stmt = stmt.where(Offcut.variant_id == variant.variantId) if variant else stmt.where(Offcut.variant_id == None)  # noqa: E711
    existing = db.exec(stmt).first()
    if existing:
        existing.quantity += 1
        db.add(existing)
        return existing.offcutId
    else:
        new_offcut = Offcut(
            product_id=product.productId,
            variant_id=variant.variantId if variant else None,
            width=width, height=height, length=0.0,
            quantity=1, status=status,
        )
        db.add(new_offcut)
        db.flush()  # assign a real id immediately, not just on the next autoflush
        return new_offcut.offcutId


def _remove_glass_offcut(db: Session, product: Product, variant: Optional[Variant], width: float, height: float, status: str = "available") -> None:
    stmt = select(Offcut).where(
        Offcut.product_id == product.productId,
        Offcut.status == status,
        Offcut.width >= width - OFFCUT_MATCH_TOLERANCE_MM, Offcut.width <= width + OFFCUT_MATCH_TOLERANCE_MM,
        Offcut.height >= height - OFFCUT_MATCH_TOLERANCE_MM, Offcut.height <= height + OFFCUT_MATCH_TOLERANCE_MM,
    ).with_for_update()
    stmt = stmt.where(Offcut.variant_id == variant.variantId) if variant else stmt.where(Offcut.variant_id == None)  # noqa: E711
    existing = db.exec(stmt).first()
    if existing:
        if existing.quantity <= 1:
            db.delete(existing)
        else:
            existing.quantity -= 1
            db.add(existing)


def _layout_remainder_rects(src_w: float, src_h: float, grid_w: float, grid_h: float, split: str) -> tuple:
    """The two ways to guillotine-cut a grid_w x grid_h occupied block (positioned
    at (0, 0)) out of a src_w x src_h rectangle, each leaving up to two positioned
    remainders (may be zero-area on one side — callers filter those out). The
    occupied block may hold 1+ pieces (see _grid_arrangement/_pack_rect)."""
    if split == "horizontal":
        rect_a = {"x": 0.0, "y": grid_h, "width": src_w, "height": src_h - grid_h}
        rect_b = {"x": grid_w, "y": 0.0, "width": src_w - grid_w, "height": grid_h}
    else:  # vertical
        rect_a = {"x": grid_w, "y": 0.0, "width": src_w - grid_w, "height": src_h}
        rect_b = {"x": 0.0, "y": grid_h, "width": grid_w, "height": src_h - grid_h}
    return rect_a, rect_b


def _apply_candidate(db: Session, product: Product, variant: Optional[Variant], candidate: dict) -> dict:
    """
    Consumes ONE source unit (an offcut row or one sheet) and returns
    {line_idx: event, ...} — one event per order line that got a piece from this
    source. candidate['placed'] may mix pieces from several different lines when
    they nest together (see _pack_rect_multi); exactly one line "owns" the actual
    stock/offcut consumption and the recorded final remainders
    (owns_consumption=True) — the others get owns_consumption=False events
    carrying only their own cuts, since the material they used is already fully
    accounted for by the owning event. Restoring a non-owning event is a no-op
    (see _restore_one_source) — safe because resolve/restore always operate on
    every line of one OrderItem together, so owner and non-owner events for the
    same physical source are always reversed in the same pass.
    """
    if candidate["source_kind"] == "offcut":
        locked = db.exec(select(Offcut).where(Offcut.offcutId == candidate["source_id"]).with_for_update()).first()
        if not locked or locked.quantity < 1:
            raise ValueError(f"Offcut #{candidate['source_id']} is no longer available")
        locked.quantity -= 1
        if locked.quantity == 0:
            db.delete(locked)
        else:
            db.add(locked)
    else:
        _deduct_sheet_stock(db, product, variant, 1)

    popularity = _get_popularity_lookup(db, product, variant)  # TTL-cached — cheap to call again here
    remainders_created = []
    for r in candidate["remainders"]:
        dims = (r["width"], r["height"])
        status = "scrap" if _is_scrap(dims, product) else "available"
        offcut_id = _upsert_glass_offcut(db, product, variant, r["width"], r["height"], status)
        remainders_created.append({
            "width": r["width"], "height": r["height"], "status": status, "x": r["x"], "y": r["y"], "offcut_id": offcut_id,
            "is_popular": status == "available" and _popularity_of(dims, product, popularity) > 0,
        })

    owner_line_idx = candidate["placed"][0]["line_idx"]
    cuts_by_line: dict = {}
    for piece in candidate["placed"]:
        cuts_by_line.setdefault(piece["line_idx"], []).append({
            "x": piece["x"], "y": piece["y"], "width": piece["width"], "height": piece["height"], "rotated": piece["rotated"],
        })

    group_id = uuid.uuid4().hex  # links owner + shared events from this one physical consumption
    events = {}
    for line_idx, cuts in cuts_by_line.items():
        is_owner = line_idx == owner_line_idx
        events[line_idx] = {
            "source": candidate["source_kind"],
            "offcut_id": candidate["source_id"],
            "offcut_width": candidate["source_w"],
            "offcut_height": candidate["source_h"],
            "cuts": cuts,
            "remainders_created": remainders_created if is_owner else [],
            "owns_consumption": is_owner,
            "group_id": group_id,
        }
    return events


def _fulfill_pool(db: Session, product: Product, variant: Optional[Variant], needs: list, full_w: float, full_h: float, strategy: dict = DEFAULT_STRATEGY) -> dict:
    """Fulfils as much of the whole `needs` pool as possible from a single
    source, packing pieces from potentially several different order lines into
    it at once when they nest together (see _pack_rect_multi / _generate_candidates).
    Returns {line_idx: event, ...}; the caller loops with the updated pool if
    anything is still unmet afterward.

    Source selection only splits demand across offcuts when doing so actually
    protects something worth protecting — it never fragments an offcut across
    two sources just for the sake of it:
      1. Find the "consolidated" candidate: among existing offcuts that aren't
         individually a popular whole size (see ProtectPopularStockAgent),
         whichever one the normal weighted score/pieces-placed ranking would
         pick on its own — i.e. what the engine would do with no size
         preference at all.
      2. Only reach past it for a SMALLER offcut if BOTH:
         a. cutting the consolidated candidate would leave ONLY non-scrap,
            "commonly sellable" remainder(s) (_remainder_common_sellable) —
            if it would leave scrap anyway, there's nothing worth protecting
            by going elsewhere, so just accept it and cut from the
            consolidated candidate regardless of what other offcuts exist; AND
         b. that remainder is meaningfully bigger than the cut itself, not
            just barely more than the piece being cut
            (_remainder_basically_same_as_cut) — if it isn't, the offcut is
            basically being consumed whole anyway and there's no distinct
            leftover left to preserve; AND
         c. a smaller offcut is actually available to take the cut instead.
         When all three hold, the smaller offcut is used for THIS cut, leaving
         the consolidated candidate's good remainder untouched for now — this
         is what makes two same-size cuts against a small offcut and a large
         offcut each claim one: the small, already-marginal offcut absorbs a
         cut it can only just fit, and the large offcut is only asked for
         what's left afterward, surviving as one large (easier to sell, less
         backlog) remainder instead of being grid-packed down into several.
      3. Only once no offcut fits at all is the fresh sheet used.
    Ties within a comparison still go through the full weighted score
    (_candidate_sort_key) — waste, sellability, protecting popular stock,
    aging, fresh-sheet avoidance, and size-fit all still apply.
    """
    candidates = _generate_candidates(db, product, variant, needs, full_w, full_h, strategy)
    if not candidates:
        largest = max((n for n in needs if n["remaining"] > 0), key=lambda n: n["piece_w"] * n["piece_h"])
        raise ValueError(
            f"Cut {largest['piece_w']:.1f}x{largest['piece_h']:.1f}mm doesn't fit any offcut or the full sheet "
            f"({full_w:.1f}x{full_h:.1f}mm) for product '{product.name}'"
        )

    popularity = _get_popularity_lookup(db, product, variant)
    now = datetime.utcnow()

    offcut_candidates = [c for c in candidates if c["source_kind"] == "offcut"]
    if offcut_candidates:
        unprotected = [
            c for c in offcut_candidates
            if _popularity_of((c["source_w"], c["source_h"]), product, popularity) <= 0
        ]
        pool = unprotected or offcut_candidates
        consolidated = min(pool, key=lambda c: _candidate_sort_key(c, product, popularity, now))

        smaller_fits = [
            c for c in pool
            if c is not consolidated and c["source_w"] * c["source_h"] < consolidated["source_w"] * consolidated["source_h"]
        ]
        worth_protecting = (
            _remainder_common_sellable(consolidated, product)
            and not _remainder_basically_same_as_cut(consolidated)
        )
        if worth_protecting and smaller_fits:
            best = min(smaller_fits, key=lambda c: (
                c["source_w"] * c["source_h"],
                _candidate_sort_key(c, product, popularity, now),
            ))
        else:
            best = consolidated
    else:
        sheet_candidates = [c for c in candidates if c["source_kind"] == "sheet"]
        best = min(sheet_candidates, key=lambda c: _candidate_sort_key(c, product, popularity, now))

    return _apply_candidate(db, product, variant, best)


# ── Public entry points ─────────────────────────────────────────────────────────

def _line_piece_dims_mm(line: dict) -> Optional[tuple]:
    meta = line.get("meta", {}) or {}
    l_val, w_val = meta.get("l"), meta.get("w")
    qty = int(line.get("qty", 0))
    if l_val is None or w_val is None or qty <= 0:
        return None
    cut_w, cut_h = _cut_dims_to_mm(float(l_val), float(w_val), meta.get("u", "mm"))
    if cut_w <= 0 or cut_h <= 0:
        return None
    return cut_w, cut_h, qty


def _resolve_with_strategy(db: Session, product: Product, variant: Optional[Variant], glass_cut_lines: list, strategy: dict) -> dict:
    """
    Runs one full resolution pass of `glass_cut_lines` using a single fixed
    tie-break strategy — the actual packing engine. resolve_glass_cut_lines
    (below) calls this once per candidate strategy and keeps whichever result is
    best. All lines' remaining needs are pooled and resolved jointly (see
    _fulfill_pool/_pack_rect_multi): when a source gets opened for one line's
    pieces, other lines' pending pieces are also packed into it if they nest
    together — e.g. one line's 2 identical panes plus a different line's smaller
    panes sharing one sheet — rather than each line only ever getting to reuse
    whatever a fully-independent earlier line happened to leave over.

    Mutates each line dict in place, adding 'offcut_sources' — a list of
    consumption *events* (each covering 1+ physical pieces from one source,
    possibly shared with other lines — see _apply_candidate's owns_consumption),
    for restore-on-cancel. Returns comparison metrics: {"sheets_consumed",
    "total_scrap_area", "total_sellability_score", "total_remainder_pieces"}.
    total_sellability_score rewards strategies whose remainders land on sizes
    that have actually sold before — given a fixed number of sheets is needed
    to fit the pieces, this is what steers which SPECIFIC leftover shapes get
    produced, so the resulting offcuts are ones likely to sell, not just "small
    in total area."
    """
    full_w, full_h = _get_full_dims(variant)

    needs = []  # [{"line_idx", "piece_w", "piece_h", "remaining"}, ...]
    for idx, line in enumerate(glass_cut_lines):
        dims = _line_piece_dims_mm(line)
        if not dims:
            logger.warning(f"glass-cut line missing l/w or qty; skipping deduction: {line}")
            continue
        cut_w, cut_h, qty = dims
        needs.append({"line_idx": idx, "piece_w": cut_w, "piece_h": cut_h, "remaining": qty})

    sources_by_line = {idx: [] for idx in range(len(glass_cut_lines))}
    while any(n["remaining"] > 0 for n in needs):
        events_by_line = _fulfill_pool(db, product, variant, needs, full_w, full_h, strategy)
        for line_idx, event in events_by_line.items():
            sources_by_line[line_idx].append(event)
        for n in needs:
            event = events_by_line.get(n["line_idx"])
            if event:
                n["remaining"] -= len(event["cuts"])

    for idx, line in enumerate(glass_cut_lines):
        line["offcut_sources"] = sources_by_line[idx]

    popularity = _get_popularity_lookup(db, product, variant)  # TTL-cached — cheap here
    sheets_consumed = 0
    total_scrap_area = 0.0
    total_remainder_pieces = 0
    total_sellability_score = 0.0
    for events in sources_by_line.values():
        for e in events:
            if not e.get("owns_consumption", True):
                continue  # shared events don't independently consume/create anything
            if e["source"] == "sheet":
                sheets_consumed += 1
            for r in e.get("remainders_created", []):
                total_remainder_pieces += 1
                if r.get("status") == "scrap":
                    total_scrap_area += r["width"] * r["height"]
                else:
                    total_sellability_score += _popularity_of((r["width"], r["height"]), product, popularity)

    return {
        "sheets_consumed": sheets_consumed,
        "total_scrap_area": total_scrap_area,
        "total_sellability_score": total_sellability_score,
        "total_remainder_pieces": total_remainder_pieces,
    }


def resolve_glass_cut_lines(db: Session, product: Product, variant: Optional[Variant], glass_cut_lines: list) -> dict:
    """
    Batches all glass-cut lineItems belonging to one OrderItem together and
    resolves them jointly. Tries each heuristic in STRATEGIES (see "Packing
    strategies" above) inside a Postgres SAVEPOINT — so a losing trial's
    stock/offcut mutations are fully undone (ROLLBACK TO SAVEPOINT also releases
    any row locks it took, so it can't block the next trial or the final real
    run) — compares the full outcomes, and re-runs whichever strategy produced
    the best one (fewest sheets, then least scrap, then least fragmentation) for
    real. This is the same technique dedicated nesting tools rely on for better
    results: breadth of search over several heuristics, not one cleverer
    algorithm — see module docstring.

    Returns an "optimization" summary — {"winning_strategy", "strategies_tried",
    "trials": [{"name", "sheets_consumed", "total_scrap_area", "total_remainder_pieces", "won"}, ...]}
    — so callers (currently the cut preview endpoint) can show that this search
    actually happened and what it found, not just apply it silently. Existing
    callers that ignore the return value (e.g. inventoryService.py, which only
    needs the offcut_sources mutated onto glass_cut_lines) are unaffected.
    """
    trials = []
    for strategy in STRATEGIES:
        trial_lines = [{**line} for line in glass_cut_lines]
        savepoint = db.begin_nested()
        try:
            metrics = _resolve_with_strategy(db, product, variant, trial_lines, strategy)
            trials.append((metrics, strategy))
        except ValueError:
            pass  # this strategy couldn't fulfil the pool at all — skip it
        finally:
            savepoint.rollback()

    if not trials:
        # No strategy could resolve the pool — re-run the baseline for real so it
        # raises its own informative ValueError instead of failing silently here.
        _resolve_with_strategy(db, product, variant, glass_cut_lines, DEFAULT_STRATEGY)
        return {"winning_strategy": DEFAULT_STRATEGY["name"], "strategies_tried": 0, "trials": []}

    # Priority: fewest sheets (the dominant raw-material cost) > least true scrap
    # (material that literally cannot be sold) > most sellable remainders (given
    # the sheet count and scrap are already settled, prefer whichever strategy's
    # leftover pieces land on sizes that have actually sold before, rather than
    # just being "small in total area" — this is the fix for "if a sheet can only
    # provide 3 pieces, make sure the waste it produces is easy to sell") > fewest
    # total remainder pieces (least fragmentation) as a final tiebreak.
    best_metrics, best_strategy = min(
        trials, key=lambda t: (
            t[0]["sheets_consumed"], t[0]["total_scrap_area"], -t[0]["total_sellability_score"], t[0]["total_remainder_pieces"],
        )
    )
    _resolve_with_strategy(db, product, variant, glass_cut_lines, best_strategy)

    return {
        "winning_strategy": best_strategy["name"],
        "strategies_tried": len(trials),
        "trials": [
            {
                "name": strategy["name"],
                "sheets_consumed": metrics["sheets_consumed"],
                "total_scrap_area": metrics["total_scrap_area"],
                "total_sellability_score": metrics["total_sellability_score"],
                "total_remainder_pieces": metrics["total_remainder_pieces"],
                "won": strategy["name"] == best_strategy["name"],
            }
            for metrics, strategy in trials
        ],
    }


def restore_glass_cut_lines(db: Session, product: Product, variant: Optional[Variant], glass_cut_lines: list) -> None:
    """Reverses resolve_glass_cut_lines — restores stock/offcuts for an edited or cancelled order."""
    for line in glass_cut_lines:
        for src in (line.get("offcut_sources") or []):
            _restore_one_source(db, product, variant, src)


def _restore_one_source(db: Session, product: Product, variant: Optional[Variant], src: dict) -> None:
    if not src.get("owns_consumption", True):
        # A "shared" event — this line's pieces came from a sheet/offcut another
        # line in this same OrderItem owns the consumption for. That owning event
        # is always restored in the same pass (resolve/restore always operate on
        # every glass-cut line of one OrderItem together — see module docstring),
        # so undoing it already reverses this line's share of the material. Nothing
        # to do here; defaults to True for older event shapes that predate this field.
        return

    if src.get("source") == "offcut":
        oc_id = src.get("offcut_id")
        existing = db.get(Offcut, oc_id) if oc_id else None
        if existing:
            existing.quantity += 1
            db.add(existing)
        else:
            db.add(Offcut(
                product_id=product.productId,
                variant_id=variant.variantId if variant else None,
                width=src.get("offcut_width"), height=src.get("offcut_height"),
                length=0.0, quantity=1, status="available",
            ))
    else:
        _restore_sheet_stock(db, product, variant, 1)

    for r in src.get("remainders_created", []):
        _remove_glass_offcut(db, product, variant, r["width"], r["height"], r.get("status", "available"))


def apply_manual_glass_selection(db: Session, product: Product, variant: Optional[Variant], cut_l: float, cut_w: float, unit: str, forced_offcut_id: Optional[int] = None) -> dict:
    """
    Backend hook for a future cashier-override UI (the 2D analogue of
    OffcutSelectorModal.jsx). Resolves ONE cut, forced to a specific existing
    offcut if forced_offcut_id is given (raises if it doesn't fit); otherwise
    falls back to the automatic agent-scored pick. Unlike the 1D system, a 2D
    piece can't be spliced together from multiple offcuts, so there's no
    multi-source blending here — one cut comes from exactly one source. Goes
    through the same pool-based path as resolve_glass_cut_lines, just with a
    pool of exactly one need, so it behaves identically to a single-piece line.
    """
    cut_w_mm, cut_h_mm = _cut_dims_to_mm(cut_l, cut_w, unit)
    full_w, full_h = _get_full_dims(variant)
    needs = [{"line_idx": 0, "piece_w": cut_w_mm, "piece_h": cut_h_mm, "remaining": 1}]
    candidates = _generate_candidates(db, product, variant, needs, full_w, full_h)

    if forced_offcut_id is not None:
        candidates = [c for c in candidates if c["source_kind"] == "offcut" and c["source_id"] == forced_offcut_id]
        if not candidates:
            raise ValueError(f"Offcut #{forced_offcut_id} doesn't fit a {cut_w_mm:.1f}x{cut_h_mm:.1f}mm cut")

    if not candidates:
        raise ValueError(
            f"Cut {cut_w_mm:.1f}x{cut_h_mm:.1f}mm doesn't fit any offcut or the full sheet "
            f"({full_w:.1f}x{full_h:.1f}mm) for product '{product.name}'"
        )

    popularity = _get_popularity_lookup(db, product, variant)
    now = datetime.utcnow()
    best = min(candidates, key=lambda c: _candidate_sort_key(c, product, popularity, now))
    return _apply_candidate(db, product, variant, best)[0]


def resolve_replacement_pieces(db: Session, product: Product, variant: Optional[Variant], pieces: list, forced_offcut_id: Optional[int] = None) -> list:
    """
    Manager-facing correction for a "the cutter missed" scenario: one or more
    delivered pieces never actually came out of their recorded source, so a
    replacement source has to supply them instead. `pieces` is a flat list of
    (width_mm, height_mm) tuples — already mm, taken straight from a cutting
    event's own `cuts` entries, no unit conversion needed.

    Groups identical dims into one pool and runs the exact same multi-source
    loop resolve_glass_cut_lines/_resolve_with_strategy uses (repeatedly
    calling _fulfill_pool until every piece is placed) — so if one replacement
    can't hold everything, a second is opened automatically, and whatever THAT
    leaves behind is handled by the same remainder-upsert path every other cut
    already goes through. No bespoke recursion needed.

    If forced_offcut_id is given, the first pass is restricted to that offcut
    (raises if none of the pieces fit it); any pieces still unplaced after that
    fall through to normal auto-resolution — same forced-then-fallback shape as
    the 1D apply_manual_cut_selection. Uses DEFAULT_STRATEGY only (no 5-way
    strategy search), consistent with apply_manual_glass_selection.

    Performs real DB mutations (offcut decrement/sheet deduction, new remainder
    upserts) via _apply_candidate — the caller controls whether this rides the
    outer transaction (confirm) or gets rolled back (preview).
    """
    full_w, full_h = _get_full_dims(variant)

    groups: dict = {}
    for width, height in pieces:
        key = (round(float(width), 3), round(float(height), 3))
        groups[key] = groups.get(key, 0) + 1
    needs = [
        {"line_idx": idx, "piece_w": w, "piece_h": h, "remaining": qty}
        for idx, ((w, h), qty) in enumerate(groups.items())
    ]

    events = []
    forced_pending = forced_offcut_id is not None
    while any(n["remaining"] > 0 for n in needs):
        if forced_pending:
            candidates = _generate_candidates(db, product, variant, needs, full_w, full_h)
            candidates = [c for c in candidates if c["source_kind"] == "offcut" and c["source_id"] == forced_offcut_id]
            if not candidates:
                raise ValueError(f"Offcut #{forced_offcut_id} doesn't fit any of the corrected pieces")
            popularity = _get_popularity_lookup(db, product, variant)
            now = datetime.utcnow()
            best = min(candidates, key=lambda c: _candidate_sort_key(c, product, popularity, now))
            events_by_line = _apply_candidate(db, product, variant, best)
            forced_pending = False
        else:
            events_by_line = _fulfill_pool(db, product, variant, needs, full_w, full_h)

        for event in events_by_line.values():
            events.append(event)
        for n in needs:
            event = events_by_line.get(n["line_idx"])
            if event:
                n["remaining"] -= len(event["cuts"])

    return events


def correct_glass_offcut_event(
    db: Session, product: Product, variant: Optional[Variant], event: dict, new_remainders: list,
    failed_cut_indices: Optional[list] = None, forced_offcut_id: Optional[int] = None,
) -> dict:
    """
    Manager-facing correction for a single owning offcut_sources event: physical
    cutting sometimes produces a different remainder than the system predicted
    (a crack, a chip, a measurement error) — handled by reversing exactly the
    remainders this event recorded (same call _restore_one_source makes) and
    re-applying the manager-supplied replacement list.

    Separately, one or more of this event's own delivered `cuts` may have been
    missed entirely (the piece never actually came out of this source) — for
    each index in failed_cut_indices, that cut is removed from `event["cuts"]`
    and resolve_replacement_pieces finds (or is told, via forced_offcut_id) a
    replacement source for it. The event's own `source`/`offcut_id` (what THIS
    source actually consumed/left behind) is otherwise untouched.

    Returns {"before", "after", "replacement_events"} — before/after describe
    the remainder correction (as before), replacement_events is the (possibly
    empty) list of new offcut_sources-shaped entries the caller should append
    to the same lineItem's offcut_sources.
    """
    if "cuts" not in event or "remainders_created" not in event:
        raise ValueError("This cutting event isn't a correctable 2D glass-cut event")
    if not event.get("owns_consumption", True):
        raise ValueError("This event doesn't own the consumption for its source — correct the owning event instead")

    before = list(event["remainders_created"])

    for size in new_remainders:
        width = float(size.get("width", 0))
        height = float(size.get("height", 0))
        if width <= 0 or height <= 0:
            raise ValueError(f"Corrected remainder dimensions must be positive (got {width}x{height})")

    for r in before:
        _remove_glass_offcut(db, product, variant, r["width"], r["height"], r.get("status", "available"))

    after = []
    for size in new_remainders:
        width = float(size["width"])
        height = float(size["height"])
        status = size.get("status") or ("scrap" if _is_scrap((width, height), product) else "available")
        offcut_id = _upsert_glass_offcut(db, product, variant, width, height, status)
        after.append({"width": width, "height": height, "status": status, "offcut_id": offcut_id})

    event["remainders_created"] = after

    replacement_events = []
    if failed_cut_indices:
        cuts = event.get("cuts", [])
        bad = [i for i in failed_cut_indices if not (0 <= i < len(cuts))]
        if bad:
            raise ValueError(f"Invalid cut index/indices for this event: {bad}")
        failed_set = set(failed_cut_indices)
        failed_pieces = [(cuts[i]["width"], cuts[i]["height"]) for i in failed_cut_indices]
        event["cuts"] = [c for i, c in enumerate(cuts) if i not in failed_set]
        replacement_events = resolve_replacement_pieces(db, product, variant, failed_pieces, forced_offcut_id)

    return {"before": before, "after": after, "replacement_events": replacement_events}
