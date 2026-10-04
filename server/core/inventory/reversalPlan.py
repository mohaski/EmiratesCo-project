"""
Phase 3 — per-cut-line physical-cut confirmation.

Before this, order edit and cancel simply refused any order whose cutting had been
reported (orderService.update_order / cancel_order_with_pin both raised
"This order has already been cut and can no longer be edited or cancelled."). That is
too blunt in both directions: `cutting_completed` defaults to True for an item with
nothing to cut, a bar is routinely cut on the floor hours before anyone taps the batch
button in the cutting queue, and an order with three cut lines may have two done and one
untouched.

So the question moves to the operator, ONE CUT LINE AT A TIME, because that is the unit a
floor answer actually applies to — one line is one cut job on one bar/sheet:

    NOT_CUT       the material is still whole. The chain decides what comes back
                  (offcutResolver): a whole bar/sheet if nothing else has claimed it,
                  otherwise just this cut's own length.

    ALREADY_CUT   the pieces physically exist and nothing can un-cut them. The bar is
                  NEVER recombined, whatever the chain says. The operator picks what
                  happens to the piece:
                      return_to_pool     back into the offcut pool (default)
                      scrap              tracked as waste, no pickable stock
                      customer_retained  the customer kept it; no credit at all

    UNKNOWN       nobody knows. Refused, by line, rather than guessed — a wrong answer
                  here silently corrupts stock, and the floor can answer in a minute.

WHY ALREADY_CUT NEVER RECOMBINES
--------------------------------
This is the distinction the whole feature exists for. A NOT_CUT reversal can hand back a
whole bar because the metal was never touched. Once the saw has run, that bar is two
pieces forever; crediting a whole one back would invent stock exactly the way the
size-matching bug did (see offcutResolver's docstring). So ALREADY_CUT forces the
own-piece-only path and retires the source piece, which no longer physically exists.

DEFAULTS
--------
`default_physical_state` is prefilled from the item's cutting flags, whose meaning is
documented on entities/orderItems.py:

    cutting_completed_at set     -> ALREADY_CUT   (explicitly reported done)
    cutting_completed False      -> NOT_CUT       (still sitting in the cutting queue)
    neither                      -> UNKNOWN       (a cut line that nothing ever flagged,
                                                   e.g. predating cutting tracking)

The prefill is a suggestion. `requires_explicit_answer` marks the lines where it must not
be taken on trust: an UNKNOWN state, a line already reported cut, or a line whose chain
has blockers. Everything else can be auto-applied so cancelling a two-minute-old order
does not turn into an interrogation.

The default resolution for ALREADY_CUT is RETURN_TO_POOL: the physically conservative
assumption is that material is still in the shop unless somebody says otherwise. Change
DEFAULT_ALREADY_CUT_RESOLUTION if that is wrong for this business.
"""
from typing import List, Optional

from sqlmodel import Session, select

from entities.offcutLedger import OffcutPiece
from entities.orderItems import OrderItem
from entities.orders import Order
from entities.products import Product
from entities.variants import Variant

from core.inventory import offcutLedger as ledger
from core.inventory import offcutResolver as resolver
from config import nairobi_now

# ── Physical state of a cut line, as confirmed by the operator ────────────────
PHYS_NOT_CUT = "not_cut"
PHYS_ALREADY_CUT = "already_cut"
PHYS_UNKNOWN = "unknown"
PHYSICAL_STATES = (PHYS_NOT_CUT, PHYS_ALREADY_CUT, PHYS_UNKNOWN)

# ── What happens to an already-cut piece ─────────────────────────────────────
RES_RETURN_TO_POOL = "return_to_pool"
RES_SCRAP = "scrap"
RES_CUSTOMER_RETAINED = "customer_retained"

# Every resolution validate_decisions will accept. SCRAP and CUSTOMER_RETAINED are kept
# as working API values (and stay covered by test_offcut_confirmation) but are NOT offered
# to the operator — see OFFERED_RESOLUTIONS.
RESOLUTIONS = (RES_RETURN_TO_POOL, RES_SCRAP, RES_CUSTOMER_RETAINED)

# What the confirmation screen actually shows. Already-cut material goes back into the
# offcut pool; scrapping it or writing it off is not a choice the cashier makes at
# cancel/edit time. Single source of truth for the UI — the modal renders whatever this
# advertises, so re-offering one is a change here, not in the frontend.
OFFERED_RESOLUTIONS = (RES_RETURN_TO_POOL,)

DEFAULT_ALREADY_CUT_RESOLUTION = RES_RETURN_TO_POOL

# Line types that carry a cutting job, i.e. the ones this confirmation applies to.
CUT_LINE_TYPES_2D = ("glass-cut", "sheet-half")


def is_cut_line(line: dict) -> bool:
    """A line needing physical confirmation: it went through a cut-resolution engine
    and recorded what it consumed. A full-unit or accessory line has nothing to
    confirm — reversing it is just putting units back."""
    if not isinstance(line, dict):
        return False
    return bool(line.get("offcut_sources"))


def default_physical_state(item: OrderItem) -> str:
    """See the module docstring — derived from the cutting flags, never trusted blindly."""
    if item.cutting_completed_at is not None:
        return PHYS_ALREADY_CUT
    if not item.cutting_completed:
        return PHYS_NOT_CUT
    return PHYS_UNKNOWN


def line_ref(item_id: int, line_idx: int) -> str:
    """Stable handle for one cut line, for the confirmation payload."""
    return f"{item_id}:{line_idx}"


def parse_line_ref(ref: str) -> tuple:
    item_id, line_idx = ref.split(":")
    return int(item_id), int(line_idx)


def _cut_description(line: dict) -> str:
    qty = int(line.get("qty") or 1)
    l_type = line.get("type", "")
    meta = line.get("meta") or {}
    if l_type in CUT_LINE_TYPES_2D:
        w, h, unit = meta.get("l"), meta.get("w"), meta.get("u", "mm")
        if w and h:
            return f"{qty} x {w}x{h}{unit}"
        return f"{qty} x sheet piece"
    if "half" in l_type:
        # meta.length on a half line is the BAR's length ("19ft"), not the cut. Printing it
        # as "1 x 19ft" told the operator a whole bar had been cut (order 201's Mosquito).
        used = next((s.get("length_used") for s in line.get("offcut_sources") or []
                     if isinstance(s, dict) and s.get("length_used")), None)
        return f"{qty} x half bar" + (f" ({float(used):.2f})" if used else "")
    length = meta.get("length")
    if length not in (None, ""):
        # Real data carries this both ways: a number from the calculators, but also a
        # display string with the unit baked in ("21ft") from older/manual entry. This is
        # a label for the operator, so show whatever is there rather than failing the
        # whole plan on a format assumption.
        try:
            return f"{qty} x {float(length):.2f}"
        except (TypeError, ValueError):
            return f"{qty} x {length}"
    return f"{qty} x {l_type or 'cut'}"


def _piece_summary(piece: OffcutPiece, db: Session) -> dict:
    """One node of the chain, shaped for the UI's bar/sheet visualisation."""
    holder = None
    if piece.consumed_by_order_id:
        order = db.get(Order, piece.consumed_by_order_id)
        holder = {
            "order_id": piece.consumed_by_order_id,
            "customer_name": order.customer_name if order else None,
        }
    return {
        "piece_id": piece.piece_id,
        "parent_piece_id": piece.parent_piece_id,
        "depth": piece.depth,
        "size": (f"{piece.width:.0f}x{piece.height:.0f}mm"
                 if piece.geom_kind == ledger.GEOM_2D else f"{piece.length:.2f}"),
        "state": piece.state,
        "is_scrap": piece.is_scrap,
        "origin": piece.origin,
        "holder": holder,
    }


def _chain_for_line(db: Session, sources: list) -> Optional[dict]:
    """This line's own lineage, for the preview: every piece it was cut from, their parents
    up to the original bar/sheet, and everything since cut from those pieces.

    Only THIS line's lineage. It used to draw the whole family of the root — on order 202 a
    line that cut two 456x1050 pieces showed 14 rows: every other piece ever taken off that
    sheet, retired ones included. It also used only the first source, so a line cut from two
    different offcuts showed half its history.
    """
    lineage: dict = {}
    for src in sources:
        if not isinstance(src, dict):
            continue
        piece = ledger.get_piece(db, src.get("source_piece_id"))
        if piece is None:
            continue
        lineage[piece.piece_id] = piece
        for p in ledger.ancestors(db, piece):
            lineage[p.piece_id] = p
        for p in ledger.descendants(db, piece.piece_id):
            lineage[p.piece_id] = p
    if not lineage:
        return None
    # Pieces an undone operation created never physically existed once it was undone - they
    # are history, not material, and would only confuse the operator reading this chain.
    from entities.opJournal import STATUS_UNDONE, StockOperation
    op_ids = {p.produced_by_op_id for p in lineage.values() if p.produced_by_op_id}
    undone = set()
    if op_ids:
        undone = {o.op_id for o in db.exec(select(StockOperation).where(
            StockOperation.op_id.in_(op_ids), StockOperation.status == STATUS_UNDONE)).all()}
    lineage = {pid: p for pid, p in lineage.items()
               if not (p.state == "retired" and p.produced_by_op_id in undone)}
    ordered = _tree_order(list(lineage.values()))
    return {
        "root_piece_id": ordered[0].root_piece_id or ordered[0].piece_id,
        "pieces": [_piece_summary(p, db) for p in ordered],
    }


def _tree_order(pieces: list) -> list:
    """Depth-first, so every piece is immediately followed by its own children.

    The chain used to be sorted by (depth, piece_id). The view indents by depth only, so
    siblings from different parents interleaved and a child was drawn under the wrong
    parent — on order 201 the 6.00 and 1.50 cut from the 11.00 appeared under the 8.00.
    """
    by_parent: dict = {}
    for p in pieces:
        by_parent.setdefault(p.parent_piece_id, []).append(p)
    for kids in by_parent.values():
        kids.sort(key=lambda p: p.piece_id)
    ids = {p.piece_id for p in pieces}
    roots = [p for p in pieces if p.parent_piece_id is None or p.parent_piece_id not in ids]

    out, seen = [], set()

    def walk(p):
        if p.piece_id in seen:
            return
        seen.add(p.piece_id)
        out.append(p)
        for child in by_parent.get(p.piece_id, []):
            walk(child)

    for root in sorted(roots, key=lambda p: p.piece_id):
        walk(root)
    return out


def _decision_piece_ids(db: Session, sources: list, is_2d: bool) -> List[int]:
    """Every piece whose state the line's verdict actually depends on.

    Not the whole chain: the display chain includes ancestors and siblings that have no
    bearing on whether this cut can be reversed. What matters is the piece this cut
    consumed, the remainders it produced, and everything cut out of those — that last set
    is where blockers come from.

    Used for two things: the plan token's fingerprint, and the row locks taken before the
    reversal is applied.
    """
    ids: List[int] = []
    for src in sources:
        if src.get("owns_consumption") is False:
            continue
        src_piece = ledger.get_piece(db, src.get("source_piece_id"))
        if src_piece is None:
            continue
        ids.append(src_piece.piece_id)
        rem_ids = ([r.get("piece_id") for r in (src.get("remainders_created") or [])]
                   if is_2d else [src.get("remainder_piece_id")])
        for rid in rem_ids:
            if not rid:
                continue
            ids.append(rid)
            ids.extend(p.piece_id for p in ledger.descendants(db, rid))
    return sorted(set(ids))


def _later_cuts_and_returns(db: Session, item: OrderItem, line: dict, sources: list,
                            reversals: list, is_2d: bool) -> tuple:
    """Cuts later orders took from this line's leftovers, and - for each possible answer - the
    pieces that would come back (the same rules the reversal applies)."""
    later: list = []
    seen_items = set()
    back_not_cut: list = []
    back_cut: list = []
    owned = [s for s in sources if isinstance(s, dict) and s.get("owns_consumption") is not False]
    for src, rev in zip(owned, reversals):
        if rev.is_legacy:
            continue
        # What "not cut" gives back is decided by the not-cut verdict (it can differ: a
        # leftover deleted by hand doesn't hold the source back when nothing was cut).
        rev = resolver.resolve_source(db, src, item_id=item.item_id, is_2d=is_2d,
                                      physical_state=PHYS_NOT_CUT)
        if is_2d:
            for r in src.get("remainders_created") or []:
                piece = ledger.get_piece(db, r.get("piece_id"))
                if piece is not None and piece.state == ledger.STATE_CONSUMED \
                        and piece.consumed_by_item_id != item.item_id \
                        and ledger._consumption_is_live(db, piece):
                    info = resolver.later_cut_info(db, piece)
                    if info["item_id"] not in seen_items:
                        seen_items.add(info["item_id"])
                        later.append(info)
            cuts = ", ".join(f"{c.get('width', 0):.0f}x{c.get('height', 0):.0f}mm" for c in src.get("cuts") or [])
            back_cut.append(cuts or "the cut pieces")
            if rev.reversible:
                back_not_cut.append("the whole sheet back to stock" if rev.kind == resolver.KIND_FULL_UNIT
                                    else f"the {rev.source_piece.width:.0f}x{rev.source_piece.height:.0f}mm offcut it came from, whole")
            else:
                from core.inventory.glassOffcutService import preview_rejoin_2d
                rects = preview_rejoin_2d(db, src, item.item_id)
                back_not_cut.append(", ".join(rects) if rects else (cuts or "the cut pieces"))
        else:
            used = float(src.get("length_used") or 0)
            back_cut.append(f"{used:.2f}")
            rem = ledger.get_piece(db, src.get("remainder_piece_id"))
            consumers, leaf = resolver.chain_walk(db, rem, exclude_item_ids={item.item_id}) if rem else ([], None)
            for c in consumers:
                info = resolver.later_cut_info(db, c)
                if info["item_id"] not in seen_items:
                    seen_items.add(info["item_id"])
                    later.append(info)
            if rev.reversible:
                back_not_cut.append("the whole bar back to stock" if rev.kind == resolver.KIND_FULL_UNIT
                                    else f"the {rev.source_piece.length:.2f} offcut it came from, whole")
            elif leaf is not None:
                back_not_cut.append(f"{leaf.length + used:.2f} ({used:.2f} never cut + {leaf.length:.2f} left on the bar)")
            else:
                back_not_cut.append(f"{used:.2f}")
    # A line whose pieces were packed onto a sheet another line of this item owns: its own
    # pieces come back if cut; if not, its glass is part of that sheet's answer.
    for src in sources:
        if isinstance(src, dict) and src.get("owns_consumption") is False:
            cuts = ", ".join(f"{c.get('width', 0):.0f}x{c.get('height', 0):.0f}mm" for c in src.get("cuts") or [])
            back_cut.append(cuts or "the cut pieces")
            if not owned:
                back_not_cut.append("rejoined with the rest of its sheet (see the line it shares the sheet with)")
    returns = {}
    if back_not_cut:
        returns[PHYS_NOT_CUT] = back_not_cut
    if back_cut:
        returns[PHYS_ALREADY_CUT] = back_cut
    return later, returns


def plan_line(db: Session, item: OrderItem, line_idx: int, line: dict,
              product: Optional[Product], variant: Optional[Variant]) -> dict:
    """Everything the operator needs to decide one cut line, plus everything
    apply_reversal needs to execute their answer."""
    l_type = line.get("type", "")
    is_2d = l_type in CUT_LINE_TYPES_2D
    sources = line.get("offcut_sources") or []

    reversals = [
        resolver.resolve_source(db, src, item_id=item.item_id, is_2d=is_2d)
        for src in sources
        if src.get("owns_consumption") is not False
    ]

    blockers: List[dict] = []
    for rev in reversals:
        blockers.extend(rev.blockers)

    legacy = bool(reversals) and all(r.is_legacy for r in reversals)
    # Only a clean sweep counts: one blocked event in a multi-cut line means that line
    # cannot hand back everything it took.
    reconstructable = bool(reversals) and all(r.reversible for r in reversals)

    default_state = default_physical_state(item)
    later_cuts, returns = _later_cuts_and_returns(db, item, line, sources, reversals, is_2d)
    requires_answer = (
        default_state == PHYS_UNKNOWN
        or default_state == PHYS_ALREADY_CUT
        or bool(blockers)
        or legacy
        # Later cuts from the same bar/sheet are always asked about - the answer decides the
        # cutting instruction and marks those orders cut.
        or bool(later_cuts)
    )

    if legacy:
        effect_not_cut = ("recorded before the offcut ledger — reversed by matching "
                          "offcut sizes, so confirm on the floor before trusting it")
    elif reconstructable:
        effect_not_cut = "the whole bar/sheet goes back to stock" if any(
            r.kind == resolver.KIND_FULL_UNIT for r in reversals
        ) else "the offcut this cut came from goes back to the pool"
    else:
        why = "; ".join(dict.fromkeys(r.detail for r in reversals if not r.reversible))
        effect_not_cut = f"only this cut's own material comes back — {why}"

    return {
        "line_ref": line_ref(item.item_id, line_idx),
        "item_id": item.item_id,
        "line_idx": line_idx,
        "product_id": item.product_id,
        "product_name": product.name if product else None,
        "variant_name": variant.name if variant else None,
        "line_type": l_type,
        "is_2d": is_2d,
        "cut_description": _cut_description(line),
        "event_count": len(reversals),
        "default_physical_state": default_state,
        "requires_explicit_answer": requires_answer,
        "allowed_resolutions": list(OFFERED_RESOLUTIONS),
        "default_resolution": DEFAULT_ALREADY_CUT_RESOLUTION,
        "reconstructable": reconstructable,
        "legacy": legacy,
        "blockers": blockers,
        "effect_if_not_cut": effect_not_cut,
        "effect_if_already_cut": (
            "the pieces already exist — the bar/sheet is not recombined; this cut's "
            "own material is returned to the pool, scrapped, or written off"
        ),
        "chain": _chain_for_line(db, sources),
        # The physical sheets this line was cut from (group_id of each consumption). Lines
        # sharing one are the SAME piece of glass, so they share one cut/not-cut answer —
        # build_plan turns this into `sheet_group`, and the modal answers them together.
        "_groups": sorted({src.get("group_id") for src in sources
                           if isinstance(src, dict) and src.get("group_id")}),
        # Whether this edit actually disturbs the line. Always True for a cancel; set False
        # by build_plan for an item the incoming cart still contains unchanged.
        "will_reverse": True,
        "later_cuts": later_cuts,
        "returns": returns,
        # Internal: the pieces this line's verdict depends on. Feeds the plan token and
        # the row locks. Dropped from the API response by ReversalPlanResponse.
        "_piece_ids": _decision_piece_ids(db, sources, is_2d),
    }


def public_plan(plan: dict) -> dict:
    """The plan as it may be sent to a client: without the internal `_piece_ids`.

    The preview endpoint strips it through ReversalPlanResponse; this is for the paths that
    return a plan inside an HTTPException detail (the 409 on a stale token), which bypass
    the response model and would otherwise leak it.
    """
    return {
        **plan,
        "lines": [{k: v for k, v in line.items() if k != "_piece_ids"} for line in plan["lines"]],
    }


def plan_fingerprint(db: Session, plan: dict) -> str:
    """Canonical description of everything the plan's verdicts rest on.

    Deliberately NOT including stock quantities: they change constantly in a POS and have
    no bearing on whether a given bar can be handed back, so folding them in would produce
    spurious conflicts. What matters is each involved piece's lifecycle state and who holds
    it, plus the set of lines itself — so a line appearing or disappearing also invalidates
    the token.
    """
    parts: List[str] = [f"order={plan['order_id']}"]
    for line in plan["lines"]:
        # Only lines this action actually reverses. A line an edit leaves untouched isn't
        # affected by its chain moving, so fingerprinting it just forced a pointless
        # re-confirmation whenever another sale used an offcut from an untouched item.
        if line.get("will_reverse") is False:
            continue
        parts.append(f"line={line['line_ref']}")
        for pid in line.get("_piece_ids") or []:
            piece = db.get(OffcutPiece, pid)
            if piece is None:
                parts.append(f"p{pid}=gone")
            else:
                parts.append(f"p{pid}={piece.state}:{piece.consumed_by_item_id or 0}")
    return "|".join(parts)


def sign_plan(fingerprint: str) -> str:
    """HMAC the fingerprint so a stale token can't simply be hand-edited to match.

    This is a staleness tag, not an authorization check — the caller is already
    authenticated and role-checked by the endpoint. Signing just keeps it opaque and
    tamper-evident.
    """
    import hashlib
    import hmac

    from config import settings

    secret = (getattr(settings, "SECRET_KEY", "") or
              getattr(settings, "JWT_SECRET_KEY", "") or
              "offcut-reversal-plan")
    return hmac.new(secret.encode(), fingerprint.encode(), hashlib.sha256).hexdigest()[:32]


class PlanStaleError(Exception):
    """The chain moved between the preview and the commit.

    Carries the freshly built plan so the endpoint can hand it straight back and the
    operator re-confirms against what is true now, rather than being told to start over
    with no explanation.
    """

    def __init__(self, fresh_plan: dict):
        fresh_plan = public_plan(fresh_plan)
        super().__init__(
            "The cut material on this order changed while you were confirming it — "
            "another sale may have used one of these offcuts. Review the updated "
            "details and confirm again."
        )
        self.fresh_plan = fresh_plan


def assert_plan_fresh(db: Session, plan: dict, submitted_token: Optional[str]) -> None:
    """Reject a confirmation built against a plan that no longer describes reality.

    A missing token is accepted: the confirmation payload is optional in the first place
    (an order with nothing cut needs none), and older clients predate this field. The
    lines themselves are still validated by validate_decisions, and nothing can be
    applied to a line that has vanished.
    """
    if not submitted_token:
        return
    if submitted_token != sign_plan(plan_fingerprint(db, plan)):
        raise PlanStaleError(plan)


def lock_decision_pieces(db: Session, plan: dict) -> None:
    """Take row locks on every piece the reversal is about to touch.

    Ordered by piece_id so two concurrent reversals that overlap can't deadlock by
    grabbing the same rows in opposite orders. Called after the token check and before
    anything is written, inside the caller's transaction — which is what makes a batch of
    per-line answers apply all-or-nothing.
    """
    ids = sorted({pid for line in plan["lines"] for pid in (line.get("_piece_ids") or [])})
    if not ids:
        return
    db.exec(
        select(OffcutPiece)
        .where(OffcutPiece.piece_id.in_(ids))
        .order_by(OffcutPiece.piece_id.asc())
        .with_for_update()
    ).all()


def _assign_sheet_groups(lines: list) -> None:
    """Give lines cut from the same physical sheet a shared `sheet_group` (else None).

    Whether a sheet has been cut is one fact about one piece of glass, but the operator
    answers per line. Letting two lines on the same sheet disagree is what put a cut 5mm
    sheet back in stock on order 201. The backend now treats a sheet as cut if any of its
    lines is (glassOffcutService.restore_glass_cut_lines); this lets the modal stop the
    contradiction being entered in the first place. Lines are linked transitively, since
    one line can span two sheets that each share with a different line.
    """
    parent = {}

    def find(x):
        while parent.setdefault(x, x) != x:
            parent[x] = parent[parent[x]]
            x = parent[x]
        return x

    for line in lines:
        groups = line.get("_groups") or []
        for g in groups[1:]:
            parent[find(g)] = find(groups[0])

    members: dict = {}
    for line in lines:
        groups = line.get("_groups") or []
        if groups:
            members.setdefault(find(groups[0]), []).append(line)
    for root, group_lines in members.items():
        shared = len(group_lines) > 1
        for line in group_lines:
            line["sheet_group"] = f"sheet:{root[:10]}" if shared else None
    for line in lines:
        line.setdefault("sheet_group", None)
        line.pop("_groups", None)


def build_plan(db: Session, order: Order, reversing_item_ids=None) -> dict:
    """Plan the reversal of every cut line on an order.

    Read-only: nothing here writes. This is what the preview endpoint serves and what a
    submitted set of answers is validated against, so the operator is never asked about a
    line that is not actually there.

    `reversing_item_ids` narrows the question to the items an edit will actually disturb
    (orderService.update_order works this out by comparing the incoming cart against the
    order). Lines on items being kept untouched are still listed, flagged
    `will_reverse: False`, and never require an answer -- their material is not moving, so
    asking about it would be noise. Left None (a cancel, which reverses everything) every
    line is in scope.
    """
    items = list(order.orderItems)
    lines: List[dict] = []
    products: dict = {}
    variants: dict = {}

    for item in items:
        if item.product_id not in products:
            products[item.product_id] = db.get(Product, item.product_id)
        if item.variant_id and item.variant_id not in variants:
            variants[item.variant_id] = db.get(Variant, item.variant_id)

        for line_idx, line in enumerate((item.details or {}).get("lineItems") or []):
            if not is_cut_line(line):
                continue
            planned = plan_line(
                db, item, line_idx, line,
                products.get(item.product_id),
                variants.get(item.variant_id) if item.variant_id else None,
            )
            if reversing_item_ids is not None and item.item_id not in reversing_item_ids:
                planned["will_reverse"] = False
                planned["requires_explicit_answer"] = False
            lines.append(planned)

    _assign_sheet_groups(lines)

    warnings: List[str] = []
    if any(l["legacy"] for l in lines):
        warnings.append(
            "Some cuts were recorded before offcut history was tracked. What comes back "
            "for those is worked out by matching offcut sizes and should be checked "
            "physically."
        )
    if any(l["blockers"] for l in lines):
        warnings.append(
            "Part of the material on this order has since been cut into by another "
            "order, so a whole bar/sheet cannot be returned for those lines."
        )

    plan = {
        "order_id": order.orderId,
        "order_status": order.status,
        "has_cut_lines": bool(lines),
        # True when every line could be applied from its prefilled default. ADVISORY ONLY:
        # the UI shows the confirmation for any order with cut lines regardless, because
        # the cutting flags are a prefill rather than evidence — a bar is routinely cut
        # hours before anyone taps the report button. The modal uses this to soften its
        # copy ("nothing here is reported as cut yet"), not to decide whether to appear.
        #
        # validate_decisions stays tolerant of a missing answer on these lines, so a
        # programmatic caller can still cancel without a confirmation payload; the UI
        # simply always sends one now.
        "all_defaults_safe": all(not l["requires_explicit_answer"] for l in lines),
        "lines": lines,
        "warnings": warnings,
    }
    # Optimistic-concurrency tag over the chain state every verdict above was computed
    # from. Submitted back with the edit/cancel and re-derived there; if another cashier
    # consumed one of these pieces in between, the token no longer matches and the
    # operator is shown a fresh plan instead of a silently wrong reversal.
    plan["plan_token"] = sign_plan(plan_fingerprint(db, plan))
    return plan


class ReversalDecisions:
    """The operator's confirmed answers, validated against a freshly built plan.

    Batch semantics: every cut line is answered independently, but they are validated
    together and either all apply or none do — the caller runs this inside the single
    transaction that also moves stock, money and order status.
    """

    def __init__(self, by_line: dict):
        self.by_line = by_line  # {(item_id, line_idx): {"physical_state", "resolution"}}

    def for_line(self, item_id: int, line_idx: int) -> Optional[dict]:
        return self.by_line.get((item_id, line_idx))

    def __bool__(self) -> bool:
        return bool(self.by_line)


def validate_decisions(plan: dict, submitted: Optional[dict], *, lenient: bool = False) -> ReversalDecisions:
    """Turn a submitted {line_ref: {physicalState, resolution}} payload into decisions.

    Raises ValueError, which the order endpoints surface as a 422, when:
      - a line that requires an explicit answer did not get one
      - an answer names an unknown line, state or resolution
      - any line is answered (or defaults to) UNKNOWN

    A line that does not require an explicit answer falls back to its prefilled default,
    so the common case — cancelling an order nothing has been cut for yet — needs no
    payload at all and behaves exactly as it did before Phase 3.
    """
    submitted = submitted or {}
    known = {l["line_ref"]: l for l in plan["lines"]}

    unknown_refs = [ref for ref in submitted if ref not in known]
    if unknown_refs:
        raise ValueError(
            "These cut lines are not part of this order (it may have changed since the "
            f"confirmation screen was opened): {', '.join(sorted(unknown_refs))}. "
            "Reopen the order and confirm again."
        )

    by_line = {}
    missing = []
    unresolved = []

    for ref, line in known.items():
        # A line on an item the edit leaves untouched isn't moving, so it needs no decision
        # at all — not even its prefilled default. Evaluating the default here used to REFUSE
        # the whole edit whenever an untouched line happened to default to UNKNOWN (any item
        # created before cutting tracking existed), even though nothing was asked of it.
        if line.get("will_reverse") is False:
            continue

        answer = submitted.get(ref) or {}
        state = answer.get("physicalState") or answer.get("physical_state")
        resolution = answer.get("resolution")
        # Recorded in the audit trail. Without it a prefilled default is indistinguishable from
        # an answer somebody gave, and the record then claims the floor confirmed a cut that
        # nobody was ever asked about (order 190: cancelled from a stale page that skipped the
        # confirmation, yet logged as three confirmed "not cut" lines).
        answered_by = "operator" if state is not None else "default"

        if state is None:
            if line["requires_explicit_answer"] and not lenient:
                missing.append(f"{line['product_name'] or 'item'} ({line['cut_description']})")
                continue
            state = line["default_physical_state"]
            if lenient and state == PHYS_UNKNOWN:
                state = PHYS_NOT_CUT

        if state not in PHYSICAL_STATES:
            raise ValueError(f"Unknown cut status '{state}' for {ref}.")

        if state == PHYS_UNKNOWN:
            unresolved.append(f"{line['product_name'] or 'item'} ({line['cut_description']})")
            continue

        if state == PHYS_ALREADY_CUT:
            resolution = resolution or line["default_resolution"]
            if resolution not in RESOLUTIONS:
                raise ValueError(f"Unknown resolution '{resolution}' for {ref}.")
        else:
            # Irrelevant for an uncut line — the chain decides, there is no piece to
            # dispose of. Normalised away so apply_reversal never reads a stale value.
            resolution = None

        # Later cuts from the same bar/sheet: each one answered cut / not cut.
        later_answers = {}
        given = answer.get("laterCuts") or answer.get("later_cuts") or {}
        for lc in line.get("later_cuts") or []:
            key = str(lc["item_id"])
            lc_state = given.get(key) or given.get(lc["item_id"])
            if lc_state is None:
                lc_state = lc.get("default_state")
                if lc_state in (None, PHYS_UNKNOWN):
                    if lenient:
                        lc_state = PHYS_NOT_CUT
                    else:
                        missing.append(f"order #{lc.get('order_id')}'s {lc.get('cut')} cut from the same material")
                        continue
            if lc_state not in (PHYS_NOT_CUT, PHYS_ALREADY_CUT):
                raise ValueError(f"Unknown cut status '{lc_state}' for order #{lc.get('order_id')}'s cut.")
            later_answers[lc["item_id"]] = lc_state

        by_line[(line["item_id"], line["line_idx"])] = {
            "physical_state": state,
            "resolution": resolution,
            "line_ref": ref,
            "answered_by": answered_by,
            "later_cuts": later_answers,
        }

    if missing:
        raise ValueError(
            "Confirm whether the cutting has been done for: " + "; ".join(missing) + "."
        )
    if unresolved:
        raise ValueError(
            "These cuts are marked as needing a floor check, so the order can't be "
            "changed yet: " + "; ".join(unresolved) +
            ". Check the material and confirm whether it has been cut."
        )

    return ReversalDecisions(by_line)


def decisions_summary(plan: dict, decisions: ReversalDecisions) -> list:
    """Compact record of what was confirmed, for the EditHistory audit snapshot."""
    out = []
    for line in plan["lines"]:
        d = decisions.for_line(line["item_id"], line["line_idx"]) or {}
        out.append({
            "line_ref": line["line_ref"],
            "product": line["product_name"],
            "cut": line["cut_description"],
            "physical_state": d.get("physical_state"),
            "resolution": d.get("resolution"),
            # "operator" = confirmed on the floor; "default" = the prefill was applied because
            # no answer was sent. Read the physical_state accordingly.
            "answered_by": d.get("answered_by"),
            "later_cuts": {str(k): v for k, v in (d.get("later_cuts") or {}).items()},
            "reconstructable": line["reconstructable"],
            "blockers": [
                {"order_id": b["order_id"], "customer_name": b["customer_name"]}
                for b in line["blockers"]
            ],
            "legacy": line["legacy"],
        })
    return out


def apply_later_cut_answers(db: Session, plan: Optional[dict], decisions, order_id: int) -> list:
    """Act on the operator's answers about LATER cuts from the same bar/sheet: a cut confirmed
    made is marked cut on that other order, so its item leaves the cutting queue instead of
    being cut a second time. A cut confirmed NOT made is left exactly as it is.

    Each change is written to that order's history, naming the order whose edit/cancel
    confirmed it. Returns the item ids marked."""
    from datetime import datetime as _dt

    from entities.editHistory import EditHistory
    from core.audit.opContext import current as current_op

    if decisions is None:
        return []
    op = current_op()
    marked = []
    for (_item_id, _line_idx), d in decisions.by_line.items():
        for later_item_id, state in (d.get("later_cuts") or {}).items():
            if state != PHYS_ALREADY_CUT or later_item_id in marked:
                continue
            later_item = db.get(OrderItem, int(later_item_id))
            if later_item is None or later_item.cutting_completed:
                continue
            later_item.cutting_completed = True
            later_item.cutting_completed_at = nairobi_now()
            db.add(later_item)
            marked.append(later_item.item_id)
            db.add(EditHistory(
                entity_type="cutting_report",
                entity_id=later_item.order_id,
                edited_by=op.actor_id if op else None,
                action="marked_cut",
                before_snapshot={"item_id": later_item.item_id, "cutting_completed": False},
                after_snapshot={"item_id": later_item.item_id, "cutting_completed": True,
                                "confirmed_during_order": order_id,
                                "op_id": op.op_id if op else None},
                notes=f"Confirmed cut while order #{order_id} was being changed",
            ))
    return marked
