"""
Append-only offcut ledger — physical-piece identity and parentage.

WHY THIS EXISTS
---------------
`offcuts` (entities/offcuts.py) is a *pooled, mutable availability projection*:
_upsert_offcut / _upsert_glass_offcut merge every same-size piece in a pool into
ONE row with quantity++, consumption decrements it, and safe_delete_offcut deletes
the row at zero. That is fast and correct for "what can I cut from right now", but
it destroys the identity of individual physical pieces — which is exactly what
order edit/cancel needs. Today's restore paths (restore_specific_offcut_sources,
glassOffcutService._restore_one_source) therefore have to *guess*: they look for
"an offcut of roughly the remainder's size in this pool" and treat a hit as "the
remainder is still intact, so the whole bar can come back". A same-size piece from
an unrelated bar reads as intact (-> phantom stock credited), and a remainder a
manager has since corrected reads as gone (-> under-credit).

This ledger records what actually happened, so a reversal can *know*:

  offcut_pieces        one row per physical piece that has ever existed, with a
                       parent_piece_id link to the piece it was cut from. Rows are
                       NEVER deleted. The parent chain is the linked list that lets
                       a reversal walk forward from a cut's remainder and see
                       whether a LATER order has already consumed part of it.

  offcut_piece_events  append-only log of everything that happened to a piece
                       (created / consumed / released / scrapped / retired /
                       corrected). Insert-only: never updated, never deleted.

OffcutPiece.state and .consumed_by_item_id are a materialized FOLD of that log,
cached so ordinary reads don't replay events; the log stays the source of truth
and can rebuild the fold (see core/inventory/offcutLedger.rebuild_piece_state).

`offcuts` is deliberately left exactly as it is — there are 44 select(Offcut)
sites and only 3 filter quantity > 0, so making that table append-only would
silently expose depleted rows to 41 query sites. The link the other way
(offcut_row_id) is advisory and nullable, so deleting a pooled row never damages
the ledger.

NO FOREIGN KEYS TO orderitems — ON PURPOSE
------------------------------------------
orderService.update_order DELETEs an order's OrderItem rows and recreates them on
every edit; that is already why it has to null offcuts.source_item_id first
("A pooled/scrap Offcut row can outlive the item that last produced it..."). A
historical ledger must OUTLIVE the rows it describes, so item/order/actor
references here are plain indexed integers with no FK constraint. The
self-referencing parent/root links DO carry real FKs — piece rows are never
deleted, so those can never dangle.

Timestamps use config.nairobi_now(), the same Africa/Nairobi wall-clock frame as
offcuts.created_at, orderitems.cutting_completed_at and every server_default now()
column (the DB session TZ is pinned to Africa/Nairobi), so they compare directly.
"""
from datetime import datetime
from typing import Any, Dict, Optional
from uuid import UUID

from sqlalchemy import JSON, Column
from sqlmodel import Field, SQLModel
from config import nairobi_now

# -- Vocabulary ---------------------------------------------------------------

# OffcutPiece.state — lifecycle of one physical piece
STATE_AVAILABLE = "available"   # exists, nothing has claimed it
STATE_CONSUMED = "consumed"     # cut up / sold; reversible via a `released` event
STATE_RETIRED = "retired"       # gone for good (fully cut away, or manually deleted)

# OffcutPiece.origin — how the piece came into existence
ORIGIN_STOCK_UNIT = "stock_unit"              # a fresh whole bar/sheet pulled from stock
ORIGIN_CUT_REMAINDER = "cut_remainder"        # left over after a cut
ORIGIN_MANUAL_ENTRY = "manual_entry"          # keyed in via Stock Control / offcut entry
ORIGIN_RESTORE_CREDIT = "restore_credit"      # credited back by an order edit/cancel
ORIGIN_CORRECTION = "correction_replacement"  # a manager offcut correction
ORIGIN_LEGACY = "legacy_bootstrap"            # inferred by the backfill migration
# An uncut section of a bar put back onto the leftover the bar still has (1D), or uncut glass
# merged back with the sheet's untouched leftovers along the cuts that were never made (2D).
ORIGIN_REJOIN = "rejoin"

# OffcutPieceEvent.event
EVENT_CREATED = "created"
EVENT_CONSUMED = "consumed"
EVENT_RELEASED = "released"    # the undo of `consumed` — what an edit/cancel emits
EVENT_SCRAPPED = "scrapped"
EVENT_RETIRED = "retired"
# Written for two different things - see event_retires below.
EVENT_CORRECTED = "corrected"
# The piece was merged into a rejoined piece (see ORIGIN_REJOIN); superseded_by_piece_id
# names it. Terminal, like retired.
EVENT_JOINED = "joined"
# An undo put the piece back to the state it had before the undone operation. The payload
# carries both states; the event log stays append-only.
EVENT_UNDONE = "undone"


def event_retires(event: str, payload: Optional[Dict[str, Any]]) -> bool:
    """Whether a logged event ends the piece's life (state -> retired) when the log is folded.

    `corrected` means two different things: record_correction logs it when a piece is REPLACED
    by new ones (payload has `replaced_by`; the old piece is retired), and resync_row_pieces logs
    it when the CEO re-measures a pooled row IN PLACE (payload has the new `geom`; it is the same
    material and keeps its state). Folding every `corrected` as retired made re-measured pieces
    look retired to the integrity check, rebuild_piece_state and vanished_leftover.
    """
    if event in (EVENT_RETIRED, EVENT_JOINED):
        return True
    if event == EVENT_CORRECTED:
        return "replaced_by" in (payload or {})
    return False


GEOM_1D = "1d"   # bars/profiles — `length` only
GEOM_2D = "2d"   # glass sheets — `width` x `height`


class OffcutPiece(SQLModel, table=True):
    """One physical piece of material. Rows are never deleted."""

    __tablename__ = "offcut_pieces"

    piece_id: Optional[int] = Field(default=None, primary_key=True)

    # -- The linked list ------------------------------------------------------
    # The piece this one was cut out of. NULL means this IS a root (a whole bar or
    # sheet drawn from stock, a manually entered offcut, or a legacy bootstrap row
    # whose real history predates the ledger).
    parent_piece_id: Optional[int] = Field(
        default=None, foreign_key="offcut_pieces.piece_id", index=True
    )
    # The original stock unit at the top of this piece's chain — denormalized so
    # "everything that came out of this one bar" is a single indexed query instead
    # of a recursive walk. A root piece points at itself.
    root_piece_id: Optional[int] = Field(
        default=None, foreign_key="offcut_pieces.piece_id", index=True
    )
    depth: int = Field(default=0, nullable=False)  # generations below the root

    # -- What / where --------------------------------------------------------
    product_id: int = Field(foreign_key="products.productId", nullable=False, index=True)
    # Provenance only, same as Offcut.variant_id — availability is scoped by pool_key.
    variant_id: Optional[int] = Field(default=None, foreign_key="variants.variantId")
    pool_key: str = Field(default="", nullable=False, index=True)

    geom_kind: str = Field(default=GEOM_1D, nullable=False)
    length: float = Field(default=0.0, nullable=False)   # 1D
    width: Optional[float] = Field(default=None)         # 2D
    height: Optional[float] = Field(default=None)        # 2D

    # Below the variant's min_usable threshold — tracked for waste reporting,
    # never offered as pickable. Mirrors Offcut.status == "scrap".
    is_scrap: bool = Field(default=False, nullable=False)

    # -- Lifecycle (a cached fold of offcut_piece_events) --------------------
    origin: str = Field(default=ORIGIN_CUT_REMAINDER, nullable=False, index=True)
    state: str = Field(default=STATE_AVAILABLE, nullable=False, index=True)

    # Plain ints, no FK — see the module docstring.
    produced_by_item_id: Optional[int] = Field(default=None, index=True)
    produced_by_order_id: Optional[int] = Field(default=None, index=True)
    consumed_by_item_id: Optional[int] = Field(default=None, index=True)
    consumed_by_order_id: Optional[int] = Field(default=None, index=True)

    # The operation (entities/opJournal.StockOperation) that brought this piece into
    # existence — a sale, an edit's reversal, a stock entry. NULL for pieces older than the
    # operation journal.
    produced_by_op_id: Optional[str] = Field(default=None, index=True, max_length=32)

    produced_at: datetime = Field(default_factory=nairobi_now, nullable=False)
    consumed_at: Optional[datetime] = Field(default=None)

    # Which pooled `offcuts` row this piece currently contributes a unit to.
    # Advisory and nullable: that row is deleted once its quantity hits zero
    # (safe_delete_offcut nulls this), and several pieces share one row.
    offcut_row_id: Optional[int] = Field(default=None, index=True)

    # A manager correction never overwrites a piece — it points the old piece here
    # and mints the replacement(s). See correct_profile_offcut_event /
    # correct_glass_offcut_event.
    superseded_by_piece_id: Optional[int] = Field(
        default=None, foreign_key="offcut_pieces.piece_id"
    )

    notes: Optional[str] = Field(default=None)


class OffcutPieceEvent(SQLModel, table=True):
    """Append-only: insert only, never update, never delete."""

    __tablename__ = "offcut_piece_events"

    id: Optional[int] = Field(default=None, primary_key=True)
    piece_id: int = Field(foreign_key="offcut_pieces.piece_id", nullable=False, index=True)
    seq: int = Field(default=1, nullable=False)  # 1-based, per piece

    event: str = Field(nullable=False, index=True)

    # Plain ints / UUID, no FK — see the module docstring.
    item_id: Optional[int] = Field(default=None, index=True)
    order_id: Optional[int] = Field(default=None, index=True)
    actor_id: Optional[UUID] = Field(default=None)

    at: datetime = Field(default_factory=nairobi_now, nullable=False, index=True)

    # The operation this event was part of, and the piece's state just before it — together
    # they answer "what did edit X do to this piece, and what was it before?".
    op_id: Optional[str] = Field(default=None, index=True, max_length=32)
    from_state: Optional[str] = Field(default=None)

    # Cut geometry, the resolution an operator chose, a reversal's plan token,
    # free-form reason text — whatever the emitting call site knows.
    payload: Optional[Dict[str, Any]] = Field(default=None, sa_column=Column(JSON))
