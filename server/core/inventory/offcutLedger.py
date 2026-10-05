"""
The one place that writes the offcut ledger (entities/offcutLedger.py).

Every existing offcut mutation in inventoryService.py (1D bars) and
glassOffcutService.py (2D glass) calls into here, so the engines keep their own
logic and gain piece-level history without growing ledger bookkeeping inline.

Phase 1 is deliberately OBSERVE-ONLY: nothing here changes stock, offcut rows, or
any value an existing caller reads. It only records what the engines already did,
so the tables can start accumulating real chains before the Phase 2 resolver
starts trusting them.

SCOPE — what is piece-tracked
-----------------------------
Tracked: 1D bar/profile cuts, 2D glass sheet cuts, and manually entered offcuts.
NOT tracked: the loose-pcs / open-container accessory rows. Those live in the same
`offcuts` table but abuse it differently — _add_loose_pcs stores a PIECE COUNT in
`Offcut.length` on a single row per pool (identified by width IS NULL), so they
have no per-piece geometry to give an identity to. They are created via direct
Offcut(...) construction rather than _upsert_offcut, so they fall outside these
hooks naturally; keep it that way unless pack-level chains are ever wanted.

FAILURE POLICY
--------------
Ledger writes participate in the caller's transaction and are NOT swallowed. A
failed INSERT poisons a Postgres transaction anyway, so a try/except here would
produce a half-written ledger plus a confusing downstream error rather than
safety. Instead the hooks are pure INSERTs with no reads that can conflict, and
the whole subsystem can be switched off with OFFCUT_LEDGER_ENABLED=0 if it ever
needs to be taken out of the hot path in production.
"""
import os
from datetime import datetime
from typing import Iterable, List, Optional
from uuid import UUID

from sqlmodel import Session, select

from entities.offcutLedger import (
    EVENT_CONSUMED,
    EVENT_CORRECTED,
    EVENT_CREATED,
    EVENT_JOINED,
    EVENT_RELEASED,
    EVENT_RETIRED,
    EVENT_SCRAPPED,
    EVENT_UNDONE,
    GEOM_1D,
    GEOM_2D,
    ORIGIN_CORRECTION,
    ORIGIN_CUT_REMAINDER,
    ORIGIN_LEGACY,
    ORIGIN_MANUAL_ENTRY,
    ORIGIN_REJOIN,
    ORIGIN_RESTORE_CREDIT,
    ORIGIN_STOCK_UNIT,
    STATE_AVAILABLE,
    STATE_CONSUMED,
    STATE_RETIRED,
    OffcutPiece,
    OffcutPieceEvent,
    event_retires,
)
from entities.offcuts import Offcut
from loggiing import logger
from config import nairobi_now


def ledger_enabled() -> bool:
    """Kill switch. Set OFFCUT_LEDGER_ENABLED=0 to take every hook out of the
    hot path without redeploying code; reads then find no new pieces and the
    Phase 2 resolver falls back to the legacy dimension-matching path."""
    return os.getenv("OFFCUT_LEDGER_ENABLED", "1") not in ("0", "false", "False")


# -- Geometry helpers ---------------------------------------------------------

def geom_from_offcut(offcut: Offcut) -> dict:
    """Piece geometry for an existing pooled `offcuts` row. A row with width set
    is 2D glass; anything else is a 1D bar length. (A loose-pcs row also has
    width IS NULL but holds a piece count in `length` — those rows never reach
    here; see the module docstring.)"""
    if offcut.width is not None and offcut.height is not None:
        return {"geom_kind": GEOM_2D, "length": 0.0, "width": offcut.width, "height": offcut.height}
    return {"geom_kind": GEOM_1D, "length": offcut.length, "width": None, "height": None}


def geom_1d(length: float) -> dict:
    return {"geom_kind": GEOM_1D, "length": float(length), "width": None, "height": None}


def geom_2d(width: float, height: float) -> dict:
    return {"geom_kind": GEOM_2D, "length": 0.0, "width": float(width), "height": float(height)}


# -- Event log ----------------------------------------------------------------

def _next_seq(db: Session, piece_id: int) -> int:
    rows = db.exec(
        select(OffcutPieceEvent.seq)
        .where(OffcutPieceEvent.piece_id == piece_id)
        .order_by(OffcutPieceEvent.seq.desc())
        .limit(1)
    ).first()
    return (rows or 0) + 1


def _as_uuid(value) -> Optional[UUID]:
    if value is None or isinstance(value, UUID):
        return value
    try:
        return UUID(str(value))
    except (ValueError, AttributeError, TypeError):
        return None


def _resolve_order_id(db: Session, item_id: Optional[int], order_id: Optional[int]) -> Optional[int]:
    """Denormalize the owning order onto the ledger row so the Phase 2 blocker
    query can filter live-vs-cancelled orders without a join per piece.

    Effectively free rather than a query per cut: the call sites are already
    inside the transaction that created/loaded that OrderItem, so db.get hits
    SQLAlchemy's identity map. Saves threading an order_id parameter through
    _process_line_items -> _process_cut_with_offcuts -> _fulfill_one_cut_via_best_fit
    and their 2D equivalents.
    """
    if order_id is not None or item_id is None:
        return order_id
    from entities.orderItems import OrderItem  # local: avoids an import cycle at module load

    item = db.get(OrderItem, item_id)
    return item.order_id if item else None


def _log(
    db: Session,
    piece: OffcutPiece,
    event: str,
    *,
    item_id: Optional[int] = None,
    order_id: Optional[int] = None,
    actor_id: Optional[UUID] = None,
    payload: Optional[dict] = None,
    from_state: Optional[str] = None,
) -> OffcutPieceEvent:
    # Stamp the running operation (core/audit/opContext) onto every event: who did it, as
    # part of which order's action, and which operation. Explicit arguments win; the context
    # only fills in what the call site didn't know.
    from core.audit.opContext import current as _current_op

    op = _current_op()
    order_id = _resolve_order_id(db, item_id, order_id)
    if order_id is None and op is not None:
        order_id = op.order_id
    if actor_id is None and op is not None:
        actor_id = op.actor_id
    row = OffcutPieceEvent(
        piece_id=piece.piece_id,
        seq=_next_seq(db, piece.piece_id),
        event=event,
        item_id=item_id,
        order_id=order_id,
        op_id=op.op_id if op is not None else None,
        from_state=from_state,
        # Call sites disagree about the type: some hold current_user.userId as a
        # UUID, others as the string form (products/service.py's add_offcuts_bulk
        # does UUID(current_user.userId)). Normalize rather than make every caller
        # remember, and never let a malformed id fail a stock operation over an
        # audit field.
        actor_id=_as_uuid(actor_id),
        payload=payload,
    )
    db.add(row)
    return row


# -- Writes -------------------------------------------------------------------

def mint_piece(
    db: Session,
    *,
    product_id: int,
    variant_id: Optional[int],
    pool_key: str,
    geom: dict,
    origin: str = ORIGIN_CUT_REMAINDER,
    parent: Optional[OffcutPiece] = None,
    produced_by_item_id: Optional[int] = None,
    produced_by_order_id: Optional[int] = None,
    offcut_row_id: Optional[int] = None,
    is_scrap: bool = False,
    actor_id: Optional[UUID] = None,
    notes: Optional[str] = None,
    payload: Optional[dict] = None,
) -> Optional[OffcutPiece]:
    """Record a new physical piece and its `created` event.

    `parent` is the piece this one was cut out of — that link is the whole point
    of the ledger, so pass it wherever the call site knows it. Omitting it makes
    the new piece a chain root, which is correct for a fresh stock unit or a
    manually entered offcut and wrong (but harmless, just unreconstructable) for
    a remainder whose source wasn't threaded through.
    """
    if not ledger_enabled():
        return None

    from core.audit.opContext import current as _current_op

    op = _current_op()
    produced_by_order_id = _resolve_order_id(db, produced_by_item_id, produced_by_order_id)
    if produced_by_order_id is None and op is not None:
        produced_by_order_id = op.order_id
    piece = OffcutPiece(
        parent_piece_id=parent.piece_id if parent else None,
        depth=(parent.depth + 1) if parent else 0,
        product_id=product_id,
        variant_id=variant_id,
        pool_key=pool_key or "",
        origin=origin,
        state=STATE_AVAILABLE,
        is_scrap=is_scrap,
        produced_by_item_id=produced_by_item_id,
        produced_by_order_id=produced_by_order_id,
        offcut_row_id=offcut_row_id,
        notes=notes,
        produced_by_op_id=op.op_id if op is not None else None,
        **geom,
    )
    db.add(piece)
    db.flush()  # need piece_id for the self-referencing root link and the event row

    # A root points at itself, so "every piece from this one bar" is one indexed
    # equality query at any depth.
    piece.root_piece_id = parent.root_piece_id if (parent and parent.root_piece_id) else piece.piece_id
    db.add(piece)

    _log(db, piece, EVENT_CREATED, item_id=produced_by_item_id, order_id=produced_by_order_id,
         actor_id=actor_id, payload=payload)
    if is_scrap:
        _log(db, piece, EVENT_SCRAPPED, item_id=produced_by_item_id, actor_id=actor_id,
             payload={"reason": "below min_usable at creation"})
    return piece


def consume_piece(
    db: Session,
    piece: Optional[OffcutPiece],
    *,
    item_id: Optional[int] = None,
    order_id: Optional[int] = None,
    cut_geom: Optional[dict] = None,
    actor_id: Optional[UUID] = None,
    payload: Optional[dict] = None,
) -> None:
    """Mark a piece as cut up / sold. Reversible — see release_piece."""
    if not ledger_enabled() or piece is None:
        return
    order_id = _resolve_order_id(db, item_id, order_id)
    prior = piece.state
    piece.state = STATE_CONSUMED
    piece.consumed_by_item_id = item_id
    piece.consumed_by_order_id = order_id
    piece.consumed_at = nairobi_now()
    db.add(piece)
    body = dict(payload or {})
    if cut_geom:
        body["cut"] = cut_geom
    _log(db, piece, EVENT_CONSUMED, item_id=item_id, order_id=order_id, actor_id=actor_id,
         payload=body or None, from_state=prior)


def release_piece(
    db: Session,
    piece: Optional[OffcutPiece],
    *,
    item_id: Optional[int] = None,
    reason: Optional[str] = None,
    actor_id: Optional[UUID] = None,
) -> None:
    """The undo of consume_piece: an order edit/cancel giving a piece back to the
    pool. History is never rewritten — the original `consumed` event stays and a
    `released` event is appended after it."""
    if not ledger_enabled() or piece is None:
        return
    prior = piece.state
    piece.state = STATE_AVAILABLE
    piece.consumed_by_item_id = None
    piece.consumed_by_order_id = None
    piece.consumed_at = None
    db.add(piece)
    _log(db, piece, EVENT_RELEASED, item_id=item_id, actor_id=actor_id,
         payload={"reason": reason} if reason else None, from_state=prior)


def retire_piece(
    db: Session,
    piece: Optional[OffcutPiece],
    *,
    reason: str,
    item_id: Optional[int] = None,
    actor_id: Optional[UUID] = None,
) -> None:
    """Gone for good — fully cut away, or deleted by the CEO. Unlike `consumed`
    this is not expected to be released again."""
    if not ledger_enabled() or piece is None:
        return
    prior = piece.state
    piece.state = STATE_RETIRED
    piece.consumed_at = piece.consumed_at or nairobi_now()
    db.add(piece)
    _log(db, piece, EVENT_RETIRED, item_id=item_id, actor_id=actor_id, payload={"reason": reason},
         from_state=prior)


def record_correction(
    db: Session,
    old_piece: Optional[OffcutPiece],
    new_pieces: Iterable[OffcutPiece],
    *,
    actor_id: Optional[UUID] = None,
    notes: Optional[str] = None,
) -> None:
    """A manager offcut correction: point the old piece at its replacement and log
    it on both sides. The old piece is never edited in place or deleted."""
    if not ledger_enabled() or old_piece is None:
        return
    replacements = [p for p in new_pieces if p is not None]
    prior = old_piece.state
    old_piece.superseded_by_piece_id = replacements[0].piece_id if replacements else None
    old_piece.state = STATE_RETIRED
    db.add(old_piece)
    _log(db, old_piece, EVENT_CORRECTED, actor_id=actor_id, from_state=prior, payload={
        "replaced_by": [p.piece_id for p in replacements],
        "notes": notes,
    })


# -- Claiming: pooled row -> one physical piece --------------------------------

def mint_pieces_for_row(
    db: Session,
    offcut: Offcut,
    *,
    origin: str,
    actor_id: Optional[UUID] = None,
    notes: Optional[str] = None,
) -> List[OffcutPiece]:
    """Mint one piece per unit of a freshly created pooled row.

    Manual offcut entry (Stock Control's offcut lines, the manager bulk-add
    endpoint) creates ONE `offcuts` row with quantity=N to mean N separate
    physical pieces, so the ledger needs N identities — otherwise a chain rooted
    at one of them could not be told from its siblings. They are chain roots with
    no parentage: a hand-measured piece genuinely has no recorded history before
    it was entered.
    """
    if not ledger_enabled():
        return []
    geom = geom_from_offcut(offcut)
    out = []
    for _ in range(max(1, int(offcut.quantity or 1))):
        piece = mint_piece(
            db,
            product_id=offcut.product_id,
            variant_id=offcut.variant_id,
            pool_key=offcut.pool_key or "",
            geom=geom,
            origin=origin,
            offcut_row_id=offcut.offcutId,
            is_scrap=(offcut.status == "scrap"),
            actor_id=actor_id,
            notes=notes,
        )
        if piece is not None:
            out.append(piece)
    return out


def claim_available_piece(
    db: Session,
    offcut: Offcut,
    *,
    mint_if_missing: bool = True,
) -> Optional[OffcutPiece]:
    """Decide WHICH physical piece of a pooled `offcuts` row is being consumed.

    A pooled row aggregates N interchangeable same-size pieces, so any available
    one is physically as good as another — but they differ in parentage, which is
    what the reversal resolver needs. Oldest-first (FIFO) matches real stock
    rotation and the aging preference the 2D scorer already applies
    (glassOffcutService._score_aging).

    Lookup order:
      1. an available piece already linked to this exact offcut row;
      2. an available piece of the same geometry in the same pool with no row link
         (e.g. minted before its row was known, or relinked by a merge);
      3. mint a `legacy_bootstrap` root — an offcut that predates the ledger, or
         one whose chain was never recorded. Its history is unknown but its
         identity from here on is not, so the chain starts at this point.
    """
    if not ledger_enabled():
        return None

    g = geom_from_offcut(offcut)
    base = [
        OffcutPiece.state == STATE_AVAILABLE,
        OffcutPiece.product_id == offcut.product_id,
        OffcutPiece.pool_key == (offcut.pool_key or ""),
        OffcutPiece.geom_kind == g["geom_kind"],
    ]

    piece = db.exec(
        select(OffcutPiece)
        .where(*base, OffcutPiece.offcut_row_id == offcut.offcutId)
        .order_by(OffcutPiece.produced_at.asc(), OffcutPiece.piece_id.asc())
        .limit(1)
    ).first()

    if piece is None:
        piece = db.exec(
            select(OffcutPiece)
            .where(*base, OffcutPiece.offcut_row_id.is_(None), *_geom_match(g))
            .order_by(OffcutPiece.produced_at.asc(), OffcutPiece.piece_id.asc())
            .limit(1)
        ).first()

    if piece is None and mint_if_missing:
        piece = mint_piece(
            db,
            product_id=offcut.product_id,
            variant_id=offcut.variant_id,
            pool_key=offcut.pool_key or "",
            geom=g,
            origin=ORIGIN_LEGACY,
            offcut_row_id=offcut.offcutId,
            is_scrap=(offcut.status == "scrap"),
            notes="bootstrapped on first consumption — no ledger history for this offcut",
        )
    return piece


def _geom_match(g: dict) -> list:
    """Geometry equality within the same tolerances the engines use for pooling
    (1mm for 1D via _upsert_offcut, OFFCUT_MATCH_TOLERANCE_MM for 2D)."""
    if g["geom_kind"] == GEOM_2D:
        tol = 2.0
        return [
            OffcutPiece.width >= g["width"] - tol, OffcutPiece.width <= g["width"] + tol,
            OffcutPiece.height >= g["height"] - tol, OffcutPiece.height <= g["height"] + tol,
        ]
    tol = 0.01
    return [OffcutPiece.length >= g["length"] - tol, OffcutPiece.length <= g["length"] + tol]


def find_piece_by_geometry(
    db: Session,
    *,
    product_id: int,
    pool_key: str,
    geom: dict,
    state: str = STATE_AVAILABLE,
) -> Optional[OffcutPiece]:
    """Best-effort lookup for the legacy call sites that only know a size (the
    dimension-matching restore paths). Phase 2's resolver uses piece ids instead
    and should not need this."""
    if not ledger_enabled():
        return None
    return db.exec(
        select(OffcutPiece)
        .where(
            OffcutPiece.state == state,
            OffcutPiece.product_id == product_id,
            OffcutPiece.pool_key == (pool_key or ""),
            OffcutPiece.geom_kind == geom["geom_kind"],
            *_geom_match(geom),
        )
        .order_by(OffcutPiece.produced_at.desc(), OffcutPiece.piece_id.desc())
        .limit(1)
    ).first()


def detach_offcut_row(db: Session, offcut_row_id: Optional[int]) -> None:
    """Null the advisory offcut_row_id on every piece pointing at a pooled row
    that is about to be DELETEd (see poolKey.safe_delete_offcut). The pieces and
    their history survive; only the pointer to a now-gone projection row goes."""
    if not ledger_enabled() or offcut_row_id is None:
        return
    for piece in db.exec(select(OffcutPiece).where(OffcutPiece.offcut_row_id == offcut_row_id)).all():
        piece.offcut_row_id = None
        db.add(piece)


# -- Reads: the chain (the Phase 2 resolver's input) ---------------------------

def get_piece(db: Session, piece_id: Optional[int]) -> Optional[OffcutPiece]:
    """Fetch a recorded piece by the `source_piece_id` an offcut_sources entry
    carries. None for a pre-ledger (legacy) entry, which has no piece id — those
    call sites keep their existing dimension-matching behaviour."""
    if not ledger_enabled() or not piece_id:
        return None
    return db.get(OffcutPiece, piece_id)


def retire_pieces_for_row(db: Session, offcut_row_id: Optional[int], *, reason: str,
                          actor_id: Optional[UUID] = None) -> int:
    """Retire every still-available piece a pooled row was projecting, because that row is
    being removed outright rather than consumed down to nothing.

    Different from detach_offcut_row, which only clears the pointer: there the pieces were
    already consumed, so they survive as history. Here the material itself is being declared
    gone (a mis-entered stock line, a CEO correction), so the pieces must stop being
    available or a later reversal would treat them as material it can hand back.
    """
    if not ledger_enabled() or offcut_row_id is None:
        return 0
    pieces = db.exec(
        select(OffcutPiece).where(
            OffcutPiece.offcut_row_id == offcut_row_id,
            OffcutPiece.state == STATE_AVAILABLE,
        )
    ).all()
    for piece in pieces:
        retire_piece(db, piece, reason=reason, actor_id=actor_id)
    return len(pieces)


def resync_row_pieces(db: Session, offcut: Offcut, *, reason: str,
                      actor_id: Optional[UUID] = None) -> dict:
    """Bring a pooled row's pieces back in line with the row after it was edited by hand.

    Used by the CEO offcut correction endpoint, which rewrites a row's measured size and/or
    piece count directly. Geometry is corrected IN PLACE on the existing pieces rather than
    replacing them: it is the same physical material, re-measured. A reduced count retires
    the surplus; an increased count mints the difference.
    """
    if not ledger_enabled():
        return {"updated": 0, "minted": 0, "retired": 0}

    geom = geom_from_offcut(offcut)
    pieces = db.exec(
        select(OffcutPiece).where(
            OffcutPiece.offcut_row_id == offcut.offcutId,
            OffcutPiece.state == STATE_AVAILABLE,
        ).order_by(OffcutPiece.piece_id.asc())
    ).all()

    target = max(0, int(offcut.quantity or 0))
    updated = minted = retired = 0

    for piece in pieces[:target]:
        changed = (piece.geom_kind != geom["geom_kind"] or piece.length != geom["length"]
                   or piece.width != geom["width"] or piece.height != geom["height"]
                   or piece.is_scrap != (offcut.status == "scrap"))
        if changed:
            for k, v in geom.items():
                setattr(piece, k, v)
            piece.is_scrap = (offcut.status == "scrap")
            db.add(piece)
            _log(db, piece, EVENT_CORRECTED, actor_id=actor_id, from_state=piece.state,
                 payload={"reason": reason, "geom": geom})
            updated += 1

    for piece in pieces[target:]:
        retire_piece(db, piece, reason=reason, actor_id=actor_id)
        retired += 1

    for _ in range(target - len(pieces)):
        mint_piece(
            db,
            product_id=offcut.product_id,
            variant_id=offcut.variant_id,
            pool_key=offcut.pool_key or "",
            geom=geom,
            origin=ORIGIN_MANUAL_ENTRY,
            offcut_row_id=offcut.offcutId,
            is_scrap=(offcut.status == "scrap"),
            actor_id=actor_id,
            notes=reason,
        )
        minted += 1

    return {"updated": updated, "minted": minted, "retired": retired}


def children(db: Session, piece_id: int) -> List[OffcutPiece]:
    return list(db.exec(select(OffcutPiece).where(OffcutPiece.parent_piece_id == piece_id)).all())


def descendants(db: Session, piece_id: int) -> List[OffcutPiece]:
    """Every piece cut out of this one, at any depth. Breadth-first over
    parent_piece_id rather than a root_piece_id sweep, because a subtree — not a
    whole bar — is what a single cut's reversal is responsible for."""
    out: List[OffcutPiece] = []
    frontier = [piece_id]
    seen = {piece_id}
    while frontier:
        batch = db.exec(select(OffcutPiece).where(OffcutPiece.parent_piece_id.in_(frontier))).all()
        frontier = []
        for p in batch:
            if p.piece_id in seen:
                continue  # defensive: a cycle would otherwise hang the walk
            seen.add(p.piece_id)
            out.append(p)
            frontier.append(p.piece_id)
    return out


def ancestors(db: Session, piece: OffcutPiece) -> List[OffcutPiece]:
    """Walk up to the root — nearest parent first."""
    out: List[OffcutPiece] = []
    seen = {piece.piece_id}
    current = piece
    while current.parent_piece_id and current.parent_piece_id not in seen:
        parent = db.get(OffcutPiece, current.parent_piece_id)
        if parent is None:
            break
        seen.add(parent.piece_id)
        out.append(parent)
        current = parent
    return out


def chain_for(db: Session, piece_id: int) -> dict:
    """The whole physical unit this piece belongs to, for the reversal preview and
    the UI's chain visualisation."""
    piece = db.get(OffcutPiece, piece_id)
    if piece is None:
        return {}
    root_id = piece.root_piece_id or piece.piece_id
    all_pieces = db.exec(select(OffcutPiece).where(OffcutPiece.root_piece_id == root_id)).all()
    return {
        "root_piece_id": root_id,
        "piece_id": piece_id,
        "pieces": sorted(all_pieces, key=lambda p: (p.depth, p.piece_id)),
    }


def blockers_for(
    db: Session,
    piece_ids: Iterable[int],
    *,
    exclude_item_ids: Iterable[int] = (),
) -> List[OffcutPiece]:
    """Pieces of this material now committed to an order OTHER than the one being
    reversed — i.e. the reason a whole bar/sheet cannot be handed back.

    Pass the remainder piece(s) the cut being reversed produced. Each given piece
    is checked as well as everything below it, because the commonest blocker is the
    remainder ITSELF having been consumed by the next order through the door — one
    level down only appears once that order also left a remainder behind.

    This is the query the current dimension-matching restore cannot express, and
    the reason the ledger exists. Cancelled orders are NOT blockers: cancelling
    emits `released`, which flips the piece back to available and drops it out of
    this result, so a chain becomes reconstructable again on its own with no
    retroactive bookkeeping.
    """
    excluded = set(exclude_item_ids or ())
    out: List[OffcutPiece] = []
    seen = set()
    for pid in piece_ids:
        start = db.get(OffcutPiece, pid)
        candidates = ([start] if start is not None else []) + descendants(db, pid)
        for p in candidates:
            if p.piece_id in seen:
                continue
            seen.add(p.piece_id)
            if p.state != STATE_CONSUMED or p.consumed_by_item_id in excluded:
                continue
            if not _consumption_is_live(db, p):
                continue
            out.append(p)
    return out


def _consumption_is_live(db: Session, piece: OffcutPiece) -> bool:
    """Whether a consumed piece's claim on the material still stands.

    A cancelled order gave its material back, so it must not block anyone. Normally
    cancelling also emits `released` and the piece is already available — this is the
    belt-and-braces case for a piece whose release never landed (a pre-ledger
    cancellation, or a legacy chain the backfill stitched).

    A consumption whose OrderItem no longer exists is also not live: update_order
    DELETEs an order's items on every edit, and it restores stock before deleting, so
    a vanished item means that consumption was already reversed. Treated as dead
    rather than blocking, because a phantom blocker silently under-credits real stock
    on every future reversal of that chain — but logged, since it means the cached
    state drifted from the event log.
    """
    from entities.orderItems import OrderItem  # local: avoids an import cycle at module load

    order_id = piece.consumed_by_order_id
    if order_id is None and piece.consumed_by_item_id is not None:
        item = db.get(OrderItem, piece.consumed_by_item_id)
        if item is None:
            logger.warning(
                f"offcut ledger: piece {piece.piece_id} is marked consumed by item "
                f"{piece.consumed_by_item_id}, which no longer exists — not treating it "
                "as a blocker; its release was probably never recorded"
            )
            return False
        order_id = item.order_id

    if order_id is None:
        return True  # nothing to check it against; assume the claim stands

    from entities.orders import Order

    order = db.get(Order, order_id)
    if order is None:
        return True
    # "abandoned" is a sale window closed without confirming; like a cancel, it gave its
    # material back. A still-open ("held") window's claim does stand.
    return order.status not in ("cancelled", "abandoned")


def rebuild_piece_state(db: Session, piece_id: int) -> Optional[str]:
    """Re-fold the event log onto a piece's cached state — a consistency check /
    repair for the materialized columns, since the log is the source of truth."""
    piece = db.get(OffcutPiece, piece_id)
    if piece is None:
        return None
    events = db.exec(
        select(OffcutPieceEvent)
        .where(OffcutPieceEvent.piece_id == piece_id)
        .order_by(OffcutPieceEvent.seq.asc())
    ).all()

    state, item_id, order_id, consumed_at = STATE_AVAILABLE, None, None, None
    for e in events:
        if e.event == EVENT_CONSUMED:
            state, item_id, order_id, consumed_at = STATE_CONSUMED, e.item_id, e.order_id, e.at
        elif e.event == EVENT_RELEASED:
            state, item_id, order_id, consumed_at = STATE_AVAILABLE, None, None, None
        elif event_retires(e.event, e.payload):
            state = STATE_RETIRED
            consumed_at = consumed_at or e.at
        elif e.event == EVENT_UNDONE:
            to = (e.payload or {}).get("to") or {}
            state = to.get("state", state)
            item_id = to.get("consumed_by_item_id")
            order_id = to.get("consumed_by_order_id")
            consumed_at = None if state == STATE_AVAILABLE else (consumed_at or e.at)

    if (piece.state, piece.consumed_by_item_id) != (state, item_id):
        logger.warning(
            f"offcut ledger: piece {piece_id} cached state {piece.state}/{piece.consumed_by_item_id} "
            f"disagreed with its event log ({state}/{item_id}) — repaired from the log"
        )
    piece.state, piece.consumed_by_item_id = state, item_id
    piece.consumed_by_order_id, piece.consumed_at = order_id, consumed_at
    db.add(piece)
    return state


# -- Rejoin and undo ------------------------------------------------------------

def join_into(db: Session, parts: Iterable[OffcutPiece], joined: OffcutPiece, *,
              reason: str, item_id: Optional[int] = None) -> None:
    """Mark pieces as merged into `joined` - the uncut rest of a bar put back together.

    Each part is retired with a `joined` event and points at the joined piece through
    superseded_by_piece_id, so a later reversal walking this bar's chain follows the link
    to wherever the material now is (see offcutResolver.chain_leaf)."""
    if not ledger_enabled() or joined is None:
        return
    for part in parts:
        if part is None:
            continue
        prior = part.state
        part.state = STATE_RETIRED
        part.superseded_by_piece_id = joined.piece_id
        part.consumed_at = part.consumed_at or nairobi_now()
        db.add(part)
        _log(db, part, EVENT_JOINED, item_id=item_id, from_state=prior,
             payload={"joined_into": joined.piece_id, "reason": reason})


PIECE_UNDO_FIELDS = ("state", "consumed_by_item_id", "consumed_by_order_id", "consumed_at",
                     "offcut_row_id", "superseded_by_piece_id", "is_scrap",
                     "length", "width", "height")


def undo_piece(db: Session, piece: OffcutPiece, target: dict, *, undoes_op_id: str,
               reason: str) -> None:
    """Put a piece back to `target` (its image before the operation being undone).

    The piece row is updated - it is a cached fold - but the log only grows: an `undone`
    event records both states, and rebuild_piece_state knows how to fold it."""
    before = {k: _plain(getattr(piece, k)) for k in PIECE_UNDO_FIELDS}
    for key in PIECE_UNDO_FIELDS:
        if key not in target:
            continue
        value = target[key]
        if key == "consumed_at" and isinstance(value, str):
            value = datetime.fromisoformat(value)
        setattr(piece, key, value)
    db.add(piece)
    after = {k: _plain(getattr(piece, k)) for k in PIECE_UNDO_FIELDS}
    _log(db, piece, EVENT_UNDONE, from_state=before["state"], payload={
        "undoes_op": undoes_op_id, "reason": reason, "from": before, "to": after,
    })


def _plain(value):
    if isinstance(value, datetime):
        return value.isoformat()
    return value
