"""
Phase 2 — the chain resolver.

Answers one question exactly, where the code used to guess:

    "If I reverse this recorded cut, what material actually comes back?"

THE BUG THIS REPLACES
---------------------
restore_specific_offcut_sources (1D) and glassOffcutService._restore_one_source (2D)
decide whether a whole bar/sheet can be credited back by asking whether an offcut of
the remainder's size still exists in the pool:

    remainder_intact = remainder <= 0.01 or _remove_offcut(db, ..., remainder, pool_key)

`offcuts` rows are pooled by size, so that lookup cannot tell one bar's remainder from
another's. Two bars each cut 1.8 off 6.0 leave a single row {len 4.2, qty 2}. A later
order cuts into ONE of them. Cancel the order whose remainder was consumed and the
lookup still finds a 4.2 row — the other bar's — so a whole 6.0 bar gets credited that
does not physically exist. The mirror case under-credits: a remainder a manager
correction resized no longer matches, so a genuinely intact bar is refused.

This module decides from the ledger instead: the remainder is identified by piece id,
and "still intact" means that exact piece is still available and nothing below it is
claimed by a live order.

BEHAVIOUR WHEN THE LEDGER CANNOT ANSWER
---------------------------------------
Deductions recorded before Phase 1 carry no piece ids. Those resolve to
`KIND_LEGACY`, and the caller keeps its existing dimension-matching path unchanged —
this module never makes a pre-ledger reversal worse than it already was. As of the
Phase 1 backfill only ~5% of pieces had recoverable parentage, so the legacy path
stays live for a long time and is not a temporary shim.

SAFETY DIRECTION
----------------
Where the two failure modes are not symmetric, this errs toward crediting LESS. An
under-credit leaves a real offcut in the pool that a manager can correct; an
over-credit invents a whole bar that nobody can see is missing until a cut fails on
the floor.
"""
from typing import List, Optional

from sqlmodel import Session

from entities.offcutLedger import STATE_AVAILABLE, OffcutPiece
from entities.orderItems import OrderItem
from entities.orders import Order

from core.inventory import offcutLedger as ledger
from loggiing import logger

# Reversal.kind
KIND_FULL_UNIT = "full_unit"          # a whole bar/sheet goes back to stock
KIND_RELEASE_PARENT = "release_parent"  # the consumed offcut piece returns to the pool
KIND_PARTIAL_CREDIT = "partial_credit"  # only this cut's own piece comes back
KIND_NO_CREDIT = "no_credit"          # nothing comes back (the customer kept the piece)
KIND_LEGACY = "legacy"                # no piece ids — caller keeps its old behaviour


class Reversal:
    """What reversing one recorded consumption event will actually do.

    Phase 2 consumes this inside the restore paths. Phases 3-5 serve the same object
    to the operator as a preview (`describe`, `blockers`) before anything is written,
    which is why it carries human-facing detail rather than only a boolean.
    """

    __slots__ = ("kind", "reversible", "blockers", "source_piece", "remainder_pieces",
                 "detail", "unit_geom", "credit_as_scrap", "retire_source")

    def __init__(self, kind: str, *, reversible: bool, source_piece=None,
                 remainder_pieces=None, blockers=None, detail: str = "", unit_geom=None,
                 credit_as_scrap: bool = False, retire_source: bool = False):
        self.kind = kind
        self.reversible = reversible
        self.source_piece: Optional[OffcutPiece] = source_piece
        self.remainder_pieces: List[OffcutPiece] = remainder_pieces or []
        self.blockers: List[dict] = blockers or []
        self.detail = detail
        self.unit_geom = unit_geom
        # Set when the operator chose SCRAP for an already-cut piece: the material comes
        # back as waste-tracked scrap rather than pickable stock.
        self.credit_as_scrap = credit_as_scrap
        # Set for an already-cut line: the source piece physically no longer exists (the
        # saw has run), so it is retired rather than left merely `consumed`. Its
        # remainders are untouched — they are real pieces sitting in the shop.
        self.retire_source = retire_source

    @property
    def is_legacy(self) -> bool:
        return self.kind == KIND_LEGACY

    def __repr__(self) -> str:  # pragma: no cover - diagnostics only
        return (f"<Reversal {self.kind} reversible={self.reversible} "
                f"blockers={len(self.blockers)} detail={self.detail!r}>")


def _describe_blocker(db: Session, piece: OffcutPiece) -> dict:
    """Blocker detail for the operator: which order holds the material, and who for.
    Phase 4's preview shows this instead of a bare refusal."""
    order_id = piece.consumed_by_order_id
    item_id = piece.consumed_by_item_id
    if order_id is None and item_id is not None:
        item = db.get(OrderItem, item_id)
        order_id = item.order_id if item else None

    customer_name = None
    if order_id is not None:
        order = db.get(Order, order_id)
        customer_name = order.customer_name if order else None

    if piece.geom_kind == "2d":
        size = f"{piece.width:.0f}x{piece.height:.0f}mm"
    else:
        size = f"{piece.length:.2f}"

    return {
        "piece_id": piece.piece_id,
        "order_id": order_id,
        "item_id": item_id,
        "customer_name": customer_name,
        "size": size,
        "depth": piece.depth,
    }


def _remainder_pieces_for(db: Session, src: dict, is_2d: bool) -> tuple:
    """The remainder piece(s) this consumption recorded producing.

    Returns (pieces, all_ids_present). `all_ids_present` is False when the event
    recorded a remainder but no piece id for it — a partially-ledgered event, which
    must not be treated as fully resolvable.
    """
    pieces: List[OffcutPiece] = []
    all_present = True

    if is_2d:
        for r in src.get("remainders_created") or []:
            pid = r.get("piece_id")
            if not pid:
                all_present = False
                continue
            piece = ledger.get_piece(db, pid)
            if piece is None:
                all_present = False
                continue
            pieces.append(piece)
    else:
        if float(src.get("remainder_created") or 0) > 0.01:
            pid = src.get("remainder_piece_id")
            piece = ledger.get_piece(db, pid) if pid else None
            if piece is None:
                all_present = False
            else:
                pieces.append(piece)

    return pieces, all_present


def resolve_source(
    db: Session,
    src: dict,
    *,
    item_id: Optional[int],
    is_2d: bool = False,
    physical_state: Optional[str] = None,
    resolution: Optional[str] = None,
) -> Reversal:
    """Plan the reversal of ONE recorded consumption event (one `offcut_sources` entry).

    `src` is the dict the deduction engines wrote: source kind, geometry, and — for
    anything cut after Phase 1 — `source_piece_id` plus the remainder piece id(s).
    `item_id` is the OrderItem being reversed; its own consumptions are never treated
    as blocking itself.

    `physical_state` / `resolution` are the operator's Phase 3 confirmation for this
    line (see core/inventory/reversalPlan.py). ALREADY_CUT OVERRIDES the chain verdict:
    once the saw has run the bar is two pieces forever, so it is never recombined no
    matter how clean the chain looks. Left None (a direct call, or a caller that has not
    collected a confirmation) the chain decides on its own, which is exactly the Phase 2
    behaviour.
    """
    from core.inventory import reversalPlan as plan

    source_piece = ledger.get_piece(db, src.get("source_piece_id"))

    # ALREADY_CUT is decided BEFORE the legacy check, and needs no ledger history at all:
    # once the saw has run, the bar/sheet is in pieces, and all that comes back is this
    # cut's own material. This used to come after the legacy check, so on any event recorded
    # before the ledger existed (most historical orders) an "already cut" answer was ignored
    # and the size-matching path put a WHOLE bar/sheet back in stock that no longer existed.
    # source_piece may be None here; the restore paths treat that as "no piece to retire".
    if physical_state == plan.PHYS_ALREADY_CUT:
        if resolution == plan.RES_CUSTOMER_RETAINED:
            return Reversal(
                KIND_NO_CREDIT,
                reversible=False,
                source_piece=source_piece,
                retire_source=source_piece is not None,
                detail="already cut and kept by the customer — nothing returns to stock",
            )
        return Reversal(
            KIND_PARTIAL_CREDIT,
            reversible=False,
            source_piece=source_piece,
            credit_as_scrap=(resolution == plan.RES_SCRAP),
            retire_source=source_piece is not None,
            detail=("already cut — returned to the offcut pool as scrap"
                    if resolution == plan.RES_SCRAP
                    else "already cut — this cut's own piece returns to the offcut pool"),
        )

    if source_piece is None:
        return Reversal(
            KIND_LEGACY,
            reversible=False,
            detail="recorded before the offcut ledger — reversed by size matching",
        )

    remainder_pieces, all_ids_present = _remainder_pieces_for(db, src, is_2d)

    # Anything still hanging off the remainders, or the remainders themselves, that a
    # live order has claimed. Walking from the remainders (not the source) is right:
    # the source piece is the one THIS cut consumed, and its own consumption is what
    # we are undoing.
    blocker_pieces = ledger.blockers_for(
        db,
        [p.piece_id for p in remainder_pieces],
        exclude_item_ids={item_id} if item_id else set(),
    )
    blockers = [_describe_blocker(db, p) for p in blocker_pieces]

    # A remainder that is no longer available was consumed, scrapped or retired by
    # something else; either way the material is not ours to hand back.
    not_available = [p for p in remainder_pieces if p.state != STATE_AVAILABLE]

    intact = not blockers and not not_available and all_ids_present

    is_fresh_unit = src.get("source") in ("full_bar", "sheet")

    if not intact:
        why = []
        if blockers:
            holders = ", ".join(
                f"order #{b['order_id']}" + (f" ({b['customer_name']})" if b["customer_name"] else "")
                for b in blockers
            )
            why.append(f"committed to {holders}")
        if not_available:
            why.append(f"{len(not_available)} remainder(s) no longer in the pool")
        if not all_ids_present:
            why.append("remainder identity was not fully recorded")
        return Reversal(
            KIND_PARTIAL_CREDIT,
            reversible=False,
            source_piece=source_piece,
            remainder_pieces=remainder_pieces,
            blockers=blockers,
            detail="only this cut's own piece comes back — " + "; ".join(why),
        )

    if is_fresh_unit:
        return Reversal(
            KIND_FULL_UNIT,
            reversible=True,
            source_piece=source_piece,
            remainder_pieces=remainder_pieces,
            detail="whole unit returns to stock",
            unit_geom=(source_piece.width, source_piece.height) if is_2d else source_piece.length,
        )

    return Reversal(
        KIND_RELEASE_PARENT,
        reversible=True,
        source_piece=source_piece,
        remainder_pieces=remainder_pieces,
        detail="the offcut this cut consumed returns to the pool",
    )


def resolve_item(db: Session, item: OrderItem) -> List[dict]:
    """Plan every recorded consumption on one OrderItem.

    Returns one entry per cut line per event:
        {line_idx, event_idx, line_type, is_2d, src, reversal}

    Phase 2 does not call this — the restore paths resolve each source as they walk it,
    so the existing control flow is untouched. It exists for the Phase 4 preview
    endpoint, which needs the whole item planned before anything is written, and it is
    what makes a batch of independent per-line confirmations possible.
    """
    out: List[dict] = []
    details = item.details or {}
    for line_idx, line in enumerate(details.get("lineItems") or []):
        if not isinstance(line, dict):
            continue
        l_type = line.get("type", "")
        is_2d = l_type in ("glass-cut", "sheet-half")
        for event_idx, src in enumerate(line.get("offcut_sources") or []):
            if not isinstance(src, dict):
                continue
            if src.get("owns_consumption") is False:
                # A shared 2D event — the owning event of the same physical
                # consumption accounts for the material (see _apply_candidate).
                continue
            out.append({
                "line_idx": line_idx,
                "event_idx": event_idx,
                "line_type": l_type,
                "is_2d": is_2d,
                "src": src,
                "reversal": resolve_source(db, src, item_id=item.item_id, is_2d=is_2d),
            })
    return out


def log_divergence(reversal: Reversal, legacy_intact: bool, context: str) -> None:
    """Record where the ledger's verdict differs from the old size-matching one.

    Phase 2's value is exactly these lines: each one is a reversal the previous code
    would have got wrong. Worth watching in the log after rollout — a
    `legacy_intact=True, ledger=blocked` entry is a whole bar that used to be invented
    out of nothing.
    """
    if reversal.is_legacy:
        return
    if reversal.reversible == legacy_intact:
        return
    if legacy_intact and not reversal.reversible:
        logger.warning(
            f"offcut resolver [{context}]: size matching would have credited a whole unit "
            f"back, but the chain says it is not available ({reversal.detail}). "
            "Crediting the smaller, correct amount."
        )
    else:
        logger.warning(
            f"offcut resolver [{context}]: size matching found no intact remainder, but the "
            f"chain says this reversal is clean ({reversal.detail}). Crediting the whole unit."
        )
