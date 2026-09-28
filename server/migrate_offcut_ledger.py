"""
Migration: the append-only offcut ledger (Phase 1).

Creates:
  offcut_pieces        one row per physical piece ever to exist, with a
                       parent_piece_id link to the piece it was cut from
  offcut_piece_events  append-only log of what happened to each piece

Then backfills, in two passes:

  PASS A (bootstrap)  one `legacy_bootstrap` piece per UNIT of every existing
                      offcuts.quantity — so every currently-pickable piece has an
                      identity from today onward. These are parentless: their real
                      history predates the ledger and cannot be invented.

  PASS B (stitch)     walks orderitems oldest-first and reads the offcut_sources /
                      remainders_created already recorded in details.lineItems, which
                      carry offcut_id + geometry. That is enough to reconstruct real
                      parentage for recent orders: the remainder a cut produced is
                      linked to the piece it came out of, and consumed pieces are
                      marked consumed by the item that consumed them. Recent chains
                      therefore work on day one instead of after weeks of new orders.

Additive and non-destructive: `offcuts` is not touched, no existing column changes,
and re-running is safe (both passes skip what they have already written, so an
interrupted run can simply be repeated).

Run from the server directory:
    python migrate_offcut_ledger.py            # create tables + backfill
    python migrate_offcut_ledger.py --tables   # create tables only
    python migrate_offcut_ledger.py --verify   # report coverage, write nothing
"""
import sys
from datetime import datetime

from sqlmodel import Session, select, text

from db.database import engine

# Importing the package registers every table on SQLModel.metadata, which the
# self-referencing FKs in offcut_pieces need in order to resolve.
import entities  # noqa: F401
from entities.offcutLedger import (
    EVENT_CONSUMED,
    EVENT_CREATED,
    GEOM_1D,
    GEOM_2D,
    ORIGIN_CUT_REMAINDER,
    ORIGIN_LEGACY,
    ORIGIN_STOCK_UNIT,
    STATE_AVAILABLE,
    STATE_CONSUMED,
    OffcutPiece,
    OffcutPieceEvent,
)
from entities.offcuts import Offcut
from entities.orderItems import OrderItem
from entities.orders import Order

TOL_1D = 0.01
TOL_2D = 2.0


# ── Schema ────────────────────────────────────────────────────────────────────

DDL = [
    """
    CREATE TABLE IF NOT EXISTS offcut_pieces (
        piece_id                SERIAL PRIMARY KEY,
        parent_piece_id         INTEGER REFERENCES offcut_pieces(piece_id),
        root_piece_id           INTEGER REFERENCES offcut_pieces(piece_id),
        depth                   INTEGER NOT NULL DEFAULT 0,
        product_id              INTEGER NOT NULL REFERENCES products("productId"),
        variant_id              INTEGER REFERENCES variants("variantId"),
        pool_key                VARCHAR NOT NULL DEFAULT '',
        geom_kind               VARCHAR NOT NULL DEFAULT '1d',
        length                  DOUBLE PRECISION NOT NULL DEFAULT 0,
        width                   DOUBLE PRECISION,
        height                  DOUBLE PRECISION,
        is_scrap                BOOLEAN NOT NULL DEFAULT FALSE,
        origin                  VARCHAR NOT NULL DEFAULT 'cut_remainder',
        state                   VARCHAR NOT NULL DEFAULT 'available',
        produced_by_item_id     INTEGER,
        produced_by_order_id    INTEGER,
        consumed_by_item_id     INTEGER,
        consumed_by_order_id    INTEGER,
        produced_at             TIMESTAMP NOT NULL DEFAULT NOW(),
        consumed_at             TIMESTAMP,
        offcut_row_id           INTEGER,
        superseded_by_piece_id  INTEGER REFERENCES offcut_pieces(piece_id),
        notes                   VARCHAR
    )
    """,
    """
    CREATE TABLE IF NOT EXISTS offcut_piece_events (
        id        SERIAL PRIMARY KEY,
        piece_id  INTEGER NOT NULL REFERENCES offcut_pieces(piece_id),
        seq       INTEGER NOT NULL DEFAULT 1,
        event     VARCHAR NOT NULL,
        item_id   INTEGER,
        order_id  INTEGER,
        actor_id  UUID,
        at        TIMESTAMP NOT NULL DEFAULT NOW(),
        payload   JSON
    )
    """,
    # produced/consumed item + order ids are deliberately FK-free: update_order
    # DELETEs an order's items on every edit, and a historical ledger must outlive
    # the rows it describes (see entities/offcutLedger.py).
    "CREATE INDEX IF NOT EXISTS ix_offcut_pieces_parent ON offcut_pieces (parent_piece_id)",
    "CREATE INDEX IF NOT EXISTS ix_offcut_pieces_root ON offcut_pieces (root_piece_id)",
    "CREATE INDEX IF NOT EXISTS ix_offcut_pieces_product ON offcut_pieces (product_id)",
    "CREATE INDEX IF NOT EXISTS ix_offcut_pieces_pool ON offcut_pieces (pool_key)",
    "CREATE INDEX IF NOT EXISTS ix_offcut_pieces_state ON offcut_pieces (state)",
    "CREATE INDEX IF NOT EXISTS ix_offcut_pieces_origin ON offcut_pieces (origin)",
    "CREATE INDEX IF NOT EXISTS ix_offcut_pieces_row ON offcut_pieces (offcut_row_id)",
    "CREATE INDEX IF NOT EXISTS ix_offcut_pieces_prod_item ON offcut_pieces (produced_by_item_id)",
    "CREATE INDEX IF NOT EXISTS ix_offcut_pieces_cons_item ON offcut_pieces (consumed_by_item_id)",
    "CREATE INDEX IF NOT EXISTS ix_offcut_pieces_prod_order ON offcut_pieces (produced_by_order_id)",
    "CREATE INDEX IF NOT EXISTS ix_offcut_pieces_cons_order ON offcut_pieces (consumed_by_order_id)",
    # The hot path for the Phase 2 resolver's availability lookups.
    "CREATE INDEX IF NOT EXISTS ix_offcut_pieces_pool_state ON offcut_pieces (pool_key, state)",
    "CREATE INDEX IF NOT EXISTS ix_offcut_piece_events_piece ON offcut_piece_events (piece_id)",
    "CREATE INDEX IF NOT EXISTS ix_offcut_piece_events_event ON offcut_piece_events (event)",
    "CREATE INDEX IF NOT EXISTS ix_offcut_piece_events_item ON offcut_piece_events (item_id)",
    "CREATE INDEX IF NOT EXISTS ix_offcut_piece_events_order ON offcut_piece_events (order_id)",
    "CREATE INDEX IF NOT EXISTS ix_offcut_piece_events_at ON offcut_piece_events (at)",
    # One event row per (piece, seq) — the append-only log's ordering invariant.
    "CREATE UNIQUE INDEX IF NOT EXISTS uq_offcut_piece_events_seq ON offcut_piece_events (piece_id, seq)",
]


def create_tables(session: Session) -> None:
    print("Creating offcut_pieces / offcut_piece_events...")
    for stmt in DDL:
        label = " ".join(stmt.split())[:78]
        try:
            session.exec(text(stmt))
            session.commit()
            print(f"  OK: {label}")
        except Exception as e:
            print(f"  Skipped: {label} ({e})")
            session.rollback()


# ── Helpers ───────────────────────────────────────────────────────────────────

def _geom_of(offcut: Offcut) -> dict:
    if offcut.width is not None and offcut.height is not None:
        return {"geom_kind": GEOM_2D, "length": 0.0, "width": offcut.width, "height": offcut.height}
    return {"geom_kind": GEOM_1D, "length": offcut.length, "width": None, "height": None}


def _is_loose_pcs_row(offcut: Offcut) -> bool:
    """Loose-pcs / open-container rows store a PIECE COUNT in `length` on a single
    per-pool row (width IS NULL), not a physical length — they are not piece-tracked
    (see core/inventory/offcutLedger.py's scope note). Distinguished from a real 1D
    bar offcut by having no variant dimensions to be a length of; the heuristic that
    holds across existing data is quantity == 1 with a whole-number length used as a
    counter. Erring toward skipping is safe: a skipped row simply gets no identity,
    and claim_available_piece bootstraps one if it is ever genuinely cut.
    """
    return offcut.width is None and offcut.height is None and offcut.length <= 0


def _insert_piece(session: Session, **kwargs) -> OffcutPiece:
    """Insert a piece and settle its self-referencing root link, which needs the
    generated piece_id. `_parent_root` (not a column) carries the root to inherit
    when this piece belongs to an existing chain; without it the piece is its own
    root."""
    parent_root = kwargs.pop("_parent_root", None)
    piece = OffcutPiece(**kwargs)
    session.add(piece)
    session.flush()
    piece.root_piece_id = parent_root or piece.piece_id
    session.add(piece)
    return piece


def _log(session: Session, piece: OffcutPiece, event: str, seq: int, **kwargs) -> None:
    session.add(OffcutPieceEvent(piece_id=piece.piece_id, seq=seq, event=event, **kwargs))


# ── Pass A: bootstrap identities for everything currently in the pool ─────────

def backfill_bootstrap(session: Session) -> int:
    print("\nPASS A — bootstrapping identities for existing offcuts...")
    already = set(
        session.exec(
            select(OffcutPiece.offcut_row_id).where(OffcutPiece.offcut_row_id.isnot(None))
        ).all()
    )
    minted = 0
    skipped_loose = 0

    for offcut in session.exec(select(Offcut).order_by(Offcut.offcutId.asc())).all():
        if offcut.offcutId in already:
            continue  # re-run: this row already has identities
        if _is_loose_pcs_row(offcut):
            skipped_loose += 1
            continue

        geom = _geom_of(offcut)
        for _ in range(max(1, int(offcut.quantity or 1))):
            piece = _insert_piece(
                session,
                product_id=offcut.product_id,
                variant_id=offcut.variant_id,
                pool_key=offcut.pool_key or "",
                origin=ORIGIN_LEGACY,
                state=STATE_AVAILABLE,
                is_scrap=(offcut.status == "scrap"),
                produced_by_item_id=offcut.source_item_id,
                produced_at=offcut.created_at or datetime.utcnow(),
                offcut_row_id=offcut.offcutId,
                notes="bootstrapped by migrate_offcut_ledger — history predates the ledger",
                **geom,
            )
            _log(session, piece, EVENT_CREATED, 1, item_id=offcut.source_item_id,
                 at=offcut.created_at or datetime.utcnow(),
                 payload={"backfill": "bootstrap", "offcut_row_id": offcut.offcutId})
            minted += 1

        if minted % 500 == 0:
            session.commit()

    session.commit()
    print(f"  Minted {minted} bootstrap piece(s); skipped {skipped_loose} loose-pcs row(s).")
    return minted


# ── Pass B: stitch real parentage out of recorded offcut_sources ───────────────

def _iter_sources(item: OrderItem):
    """Yield (line, source_event) for every recorded consumption on this item."""
    details = item.details or {}
    for line in details.get("lineItems") or []:
        if not isinstance(line, dict):
            continue
        for src in line.get("offcut_sources") or []:
            if isinstance(src, dict):
                yield line, src


def backfill_stitch(session: Session) -> dict:
    print("\nPASS B — stitching parentage from recorded offcut_sources...")
    stats = {"items": 0, "roots": 0, "remainders": 0, "consumed": 0, "unmatched": 0}

    # Skip cancelled orders. Their consumption was already reversed, but the
    # offcut_sources stay behind in details (restore_stock_for_order_item doesn't
    # clear them), so stitching them would mark pieces consumed by an order that
    # gave the material back — phantom blockers on every chain they touched.
    cancelled_orders = set(
        session.exec(select(Order.orderId).where(Order.status == "cancelled")).all()
    )
    items = session.exec(select(OrderItem).order_by(OrderItem.item_id.asc())).all()
    skipped_cancelled = 0

    for item in items:
        sources = list(_iter_sources(item))
        if not sources:
            continue
        if item.order_id in cancelled_orders:
            skipped_cancelled += 1
            continue
        # Re-run guard: every stitched source marks its piece consumed by this item,
        # on both the fresh-unit and the existing-offcut branch — so this catches a
        # partially completed previous run whichever branch it took. (Guarding on
        # produced_by_item_id instead would miss an item that only ever consumed
        # offcuts and minted no root of its own, and re-stitching would then
        # duplicate its chain.)
        if session.exec(
            select(OffcutPiece.piece_id)
            .where(OffcutPiece.consumed_by_item_id == item.item_id)
            .limit(1)
        ).first():
            continue

        stats["items"] += 1

        for line, src in sources:
            if src.get("owns_consumption") is False:
                # A shared 2D event: the material is accounted for by the owning
                # event of the same physical consumption (see _apply_candidate).
                continue

            is_2d = src.get("offcut_width") is not None or bool(src.get("remainders_created"))
            parent = _stitch_one(session, item, src, is_2d, stats)
            if parent is None:
                stats["unmatched"] += 1

        session.commit()

    print(f"  Stitched {stats['items']} item(s): {stats['roots']} root(s), "
          f"{stats['remainders']} remainder link(s), {stats['consumed']} consumption(s), "
          f"{stats['unmatched']} unmatched source(s).")
    print(f"  Skipped {skipped_cancelled} item(s) on cancelled orders.")
    return stats


def _find_bootstrap_piece(session: Session, product_id: int, pool_key: str, geom: dict):
    """A still-available bootstrapped piece matching this geometry — the identity a
    consumed source should be attached to, when the pooled row it came from is still
    around."""
    conds = [
        OffcutPiece.state == STATE_AVAILABLE,
        OffcutPiece.product_id == product_id,
        OffcutPiece.pool_key == (pool_key or ""),
        OffcutPiece.geom_kind == geom["geom_kind"],
    ]
    if geom["geom_kind"] == GEOM_2D:
        conds += [
            OffcutPiece.width >= geom["width"] - TOL_2D, OffcutPiece.width <= geom["width"] + TOL_2D,
            OffcutPiece.height >= geom["height"] - TOL_2D, OffcutPiece.height <= geom["height"] + TOL_2D,
        ]
    else:
        conds += [
            OffcutPiece.length >= geom["length"] - TOL_1D,
            OffcutPiece.length <= geom["length"] + TOL_1D,
        ]
    return session.exec(
        select(OffcutPiece).where(*conds).order_by(OffcutPiece.piece_id.asc()).limit(1)
    ).first()


def _stitch_one(session: Session, item: OrderItem, src: dict, is_2d: bool, stats: dict):
    """Rebuild one consumption event's piece + parentage.

    The source piece: for a "full_bar"/"sheet" event, a fresh stock unit that no
    longer exists as an offcut row — minted here as a consumed root. For an
    "offcut" event, the piece it consumed; matched against a still-available
    bootstrap piece of the same geometry when one exists, otherwise minted as a
    consumed legacy root (the pooled row it came from has since been deleted).
    """
    pool_key = ""
    row = session.get(Offcut, src.get("offcut_id")) if src.get("offcut_id") else None
    if row is not None:
        pool_key = row.pool_key or ""

    kind = src.get("source")
    is_fresh_unit = kind in ("full_bar", "sheet")

    if is_2d:
        src_w, src_h = src.get("offcut_width"), src.get("offcut_height")
        if not src_w or not src_h:
            return None
        src_geom = {"geom_kind": GEOM_2D, "length": 0.0, "width": src_w, "height": src_h}
    else:
        src_len = float(src.get("offcut_length") or 0)
        if src_len <= 0:
            return None
        src_geom = {"geom_kind": GEOM_1D, "length": src_len, "width": None, "height": None}

    source_piece = None
    if not is_fresh_unit:
        source_piece = _find_bootstrap_piece(session, item.product_id, pool_key, src_geom)

    if source_piece is None:
        source_piece = _insert_piece(
            session,
            product_id=item.product_id,
            variant_id=item.variant_id,
            pool_key=pool_key,
            origin=ORIGIN_STOCK_UNIT if is_fresh_unit else ORIGIN_LEGACY,
            state=STATE_AVAILABLE,
            produced_by_item_id=item.item_id if is_fresh_unit else None,
            produced_by_order_id=item.order_id if is_fresh_unit else None,
            notes="reconstructed by migrate_offcut_ledger from a recorded offcut_source",
            **src_geom,
        )
        _log(session, source_piece, EVENT_CREATED, 1,
             payload={"backfill": "stitch", "source": kind})
        stats["roots"] += 1

    # Mark it consumed by this item.
    next_seq = (session.exec(
        select(OffcutPieceEvent.seq).where(OffcutPieceEvent.piece_id == source_piece.piece_id)
        .order_by(OffcutPieceEvent.seq.desc()).limit(1)
    ).first() or 0) + 1
    source_piece.state = STATE_CONSUMED
    source_piece.consumed_by_item_id = item.item_id
    source_piece.consumed_by_order_id = item.order_id
    source_piece.consumed_at = source_piece.consumed_at or datetime.utcnow()
    session.add(source_piece)
    _log(session, source_piece, EVENT_CONSUMED, next_seq,
         item_id=item.item_id, order_id=item.order_id,
         payload={"backfill": "stitch"})
    stats["consumed"] += 1

    # Re-parent the remainder(s) this cut produced onto it. The bootstrap pass
    # already gave those pooled rows identities; this pass supplies the parentage
    # the bootstrap could not know.
    remainders = src.get("remainders_created") if is_2d else None
    if is_2d and remainders:
        for r in remainders:
            geom = {"geom_kind": GEOM_2D, "length": 0.0,
                    "width": r.get("width"), "height": r.get("height")}
            if not geom["width"] or not geom["height"]:
                continue
            if _attach_remainder(session, item, source_piece, pool_key, geom, r.get("offcut_id")):
                stats["remainders"] += 1
    elif not is_2d:
        rem = float(src.get("remainder_created") or 0)
        if rem > TOL_1D:
            geom = {"geom_kind": GEOM_1D, "length": rem, "width": None, "height": None}
            if _attach_remainder(session, item, source_piece, pool_key, geom, None):
                stats["remainders"] += 1

    return source_piece


def _attach_remainder(session, item, parent, pool_key, geom, offcut_row_id) -> bool:
    """Link an existing bootstrapped piece to its real parent, or mint the remainder
    if its pooled row has since been consumed away."""
    existing = None
    if offcut_row_id:
        existing = session.exec(
            select(OffcutPiece).where(
                OffcutPiece.offcut_row_id == offcut_row_id,
                OffcutPiece.parent_piece_id.is_(None),
                OffcutPiece.state == STATE_AVAILABLE,
            ).order_by(OffcutPiece.piece_id.asc()).limit(1)
        ).first()
    if existing is None:
        existing = _find_bootstrap_piece(session, item.product_id, pool_key, geom)
        if existing is not None and existing.parent_piece_id is not None:
            existing = None  # already stitched to a different parent; don't steal it

    if existing is not None:
        existing.parent_piece_id = parent.piece_id
        existing.root_piece_id = parent.root_piece_id or parent.piece_id
        existing.depth = (parent.depth or 0) + 1
        existing.origin = ORIGIN_CUT_REMAINDER
        existing.produced_by_item_id = existing.produced_by_item_id or item.item_id
        existing.produced_by_order_id = existing.produced_by_order_id or item.order_id
        session.add(existing)
        return True

    # The remainder no longer exists as an offcut row (a later cut consumed it).
    # Record it anyway, already consumed: the chain needs the intermediate node for
    # a deeper descendant to hang off.
    piece = _insert_piece(
        session,
        product_id=item.product_id,
        variant_id=item.variant_id,
        pool_key=pool_key,
        origin=ORIGIN_CUT_REMAINDER,
        state=STATE_AVAILABLE,
        produced_by_item_id=item.item_id,
        produced_by_order_id=item.order_id,
        notes="reconstructed remainder — its pooled row was already consumed",
        _parent_root=parent.root_piece_id or parent.piece_id,
        **geom,
    )
    piece.parent_piece_id = parent.piece_id
    piece.depth = (parent.depth or 0) + 1
    session.add(piece)
    _log(session, piece, EVENT_CREATED, 1, item_id=item.item_id, order_id=item.order_id,
         payload={"backfill": "stitch-remainder"})
    return True


# ── Verify ────────────────────────────────────────────────────────────────────

def verify(session: Session) -> None:
    print("\nCoverage report")
    print("-" * 60)
    pieces = session.exec(select(OffcutPiece)).all()
    events = session.exec(select(OffcutPieceEvent)).all()
    offcut_rows = session.exec(select(Offcut)).all()

    pool_units = sum(max(1, int(o.quantity or 1)) for o in offcut_rows if not _is_loose_pcs_row(o))
    available = [p for p in pieces if p.state == STATE_AVAILABLE]
    by_origin: dict = {}
    for p in pieces:
        by_origin[p.origin] = by_origin.get(p.origin, 0) + 1

    print(f"  offcut rows (piece-tracked)   : {len([o for o in offcut_rows if not _is_loose_pcs_row(o)])}")
    print(f"  physical units in those rows  : {pool_units}")
    print(f"  ledger pieces total           : {len(pieces)}")
    print(f"  ledger pieces available       : {len(available)}")
    print(f"  ledger events                 : {len(events)}")
    print("  by origin:")
    for origin, n in sorted(by_origin.items(), key=lambda kv: -kv[1]):
        print(f"    {origin:24s} {n}")

    with_parent = len([p for p in pieces if p.parent_piece_id])
    print(f"  pieces with real parentage    : {with_parent} "
          f"({(100.0 * with_parent / len(pieces)) if pieces else 0:.0f}%)")

    orphan_roots = len([p for p in pieces if p.root_piece_id is None])
    if orphan_roots:
        print(f"  WARNING: {orphan_roots} piece(s) have no root_piece_id")

    drift = len(available) - pool_units
    if drift:
        print(f"  NOTE: available pieces differ from pooled units by {drift:+d}. Expected "
              f"non-zero while pass B reconstructs pieces whose rows are already gone, "
              f"and after any manual offcut edits.")
    print("-" * 60)


def main() -> None:
    args = set(sys.argv[1:])
    with Session(engine) as session:
        if "--verify" in args:
            verify(session)
            return

        create_tables(session)
        if "--tables" in args:
            print("\nTables only — skipping backfill.")
            return

        backfill_bootstrap(session)
        backfill_stitch(session)
        verify(session)
        print("\nMigration complete.")


if __name__ == "__main__":
    main()
