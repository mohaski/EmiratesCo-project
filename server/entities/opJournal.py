"""
Operation journal: who changed stock, when, as part of what — and exactly what changed.

WHY THIS EXISTS
---------------
The offcut ledger (entities/offcutLedger.py) records what happened to each physical piece,
but stock counters, pooled offcut rows, order items and order money were changed with no
record of their before-state. That made two things impossible:

  - tracing a complication back to the action that caused it (the ledger's actor_id was
    never filled, and a restore credit could not say which edit produced it), and
  - undoing a mistaken edit/cancel exactly — you cannot invert a change you did not record.

  stock_operations   one row per business action that can move stock: a sale, an order edit,
                     a cancel, a cutting correction, an offcut admin change, an undo. Holds
                     the actor, the order, and the full request, so an edit can be re-run
                     with corrected answers.

  stock_journal      one row per changed database row, written automatically by a SQLAlchemy
                     after_flush hook (core/audit/journal.py) — before-image and after-image,
                     tagged with the operation that was active. Nothing has to remember to
                     call it, which is the point: stock is written from 40+ places.

  stock_baseline     stock counters as they stood when journaling began, so the integrity
                     check can prove current stock == baseline + every journaled delta
                     (i.e. that nothing is changing stock behind the journal's back).

All three are append-only in practice. An undo is itself an operation whose journal rows
invert the original's; nothing is ever deleted or rewritten.
"""
from datetime import datetime
from typing import Any, Dict, Optional
from uuid import UUID

from sqlalchemy import JSON, Column, Index
from sqlmodel import Field, SQLModel
from config import nairobi_now

OP_SALE = "sale"
OP_EDIT = "edit"
OP_CANCEL = "cancel"
OP_UNDO = "undo"
OP_CUT_CORRECTION = "cut_correction"
OP_CUTTING_REPORT = "cutting_report"
OP_OFFCUT_ADMIN = "offcut_admin"
OP_OFFCUT_ENTRY = "offcut_entry"
OP_STOCK_SESSION = "stock_session"
OP_RESTOCK = "restock"
OP_OPEN_CONTAINER = "open_container"
OP_STATUS = "status_change"
OP_MAINTENANCE = "maintenance"   # migrations / backfills run by hand
# Sale windows (core/ordering/windowService.py): building a held cart, and giving its stock
# back when the window is closed or idles out. Never undoable - a window is not a sale; its
# confirm is recorded as an OP_SALE like any checkout.
OP_WINDOW_CART = "window_cart"
OP_WINDOW_RELEASE = "window_release"
OP_WINDOW_EXPIRE = "window_expire"
WINDOW_KINDS = (OP_WINDOW_CART, OP_WINDOW_RELEASE, OP_WINDOW_EXPIRE)

# Operations whose effects the undo tool can reverse.
UNDOABLE_KINDS = (OP_EDIT, OP_CANCEL)

STATUS_APPLIED = "applied"
STATUS_UNDONE = "undone"


class StockOperation(SQLModel, table=True):
    __tablename__ = "stock_operations"

    op_id: str = Field(primary_key=True, max_length=32)
    kind: str = Field(nullable=False, index=True)
    status: str = Field(default=STATUS_APPLIED, nullable=False, index=True)

    # Plain values, no FKs: the journal must outlive anything it describes.
    actor_id: Optional[UUID] = Field(default=None, index=True)
    actor_name: Optional[str] = Field(default=None)
    order_id: Optional[int] = Field(default=None, index=True)

    created_at: datetime = Field(default_factory=nairobi_now, nullable=False, index=True)

    # The request as submitted (edit cart + cut answers, cancel answers...), so a mistaken
    # edit can be re-run with corrected answers against exactly the same cart.
    request: Optional[Dict[str, Any]] = Field(default=None, sa_column=Column(JSON))
    # Operation-specific results worth keeping: the plan the answers were given against,
    # which pieces each cut line returned, the money moved.
    summary: Optional[Dict[str, Any]] = Field(default=None, sa_column=Column(JSON))

    edit_history_id: Optional[int] = Field(default=None, index=True)
    undoes_op_id: Optional[str] = Field(default=None, index=True)
    undone_by_op_id: Optional[str] = Field(default=None)
    notes: Optional[str] = Field(default=None)


class JournalEntry(SQLModel, table=True):
    __tablename__ = "stock_journal"
    # Undo's "was this row changed again later?" (core/audit/undo._later_entries) and the
    # integrity check walk one row's history in id order.
    __table_args__ = (Index("ix_stock_journal_row_history", "table_name", "row_pk", "id"),)

    id: Optional[int] = Field(default=None, primary_key=True)
    # NULL when a row changed outside any operation — the integrity check reports those,
    # and the undo tool treats them as a later change it cannot see past.
    op_id: Optional[str] = Field(default=None, index=True, max_length=32)
    table_name: str = Field(nullable=False, index=True)
    row_pk: str = Field(nullable=False, index=True)
    action: str = Field(nullable=False)  # insert | update | delete
    before: Optional[Dict[str, Any]] = Field(default=None, sa_column=Column(JSON))
    after: Optional[Dict[str, Any]] = Field(default=None, sa_column=Column(JSON))
    at: datetime = Field(default_factory=nairobi_now, nullable=False, index=True)


class StockBaseline(SQLModel, table=True):
    __tablename__ = "stock_baseline"

    id: Optional[int] = Field(default=None, primary_key=True)
    table_name: str = Field(nullable=False)   # variants | products
    row_pk: str = Field(nullable=False)
    quantity: float = Field(nullable=False)
    taken_at: datetime = Field(default_factory=nairobi_now, nullable=False)
    # The journal id that was current when this was taken — deltas after it count.
    after_journal_id: int = Field(default=0, nullable=False)
