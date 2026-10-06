"""Private offcuts for open sale windows.

A sale window (core/ordering/windowService.py) really deducts its stock, so other windows
see the reduced figures for free. Remainders are the exception. If window A cuts 5ft off a
21ft bar, the 16ft remainder exists only on paper — the bar is still whole on the rack,
because nothing is cut before payment. Were that 16ft public, window B could sell 4ft of
it; then if A is abandoned the bar can never go back to stock whole (B holds part of it),
and the ledger ends up recording pieces that don't physically exist.

So an offcut row produced while a window is being built is tagged
Offcut.held_by_order_id = that window's order, and only that window can see it. It
becomes public when the window closes, whether confirmed (the cut is going to happen) or
released (its stock was just handed back).

The "which window am I working for" question is answered by a context variable rather
than an extra argument, because the queries that need it are six calls deep in the 1D and
2D cut engines, and every existing caller (checkout, order edit, cancel, manager
corrections, stock sessions) must keep behaving exactly as before, which is scope None:
see only public rows, create only public rows.
"""
from contextlib import contextmanager
from contextvars import ContextVar
from typing import Optional

from sqlalchemy import or_
from sqlmodel import select

from entities.offcuts import Offcut

_current_hold: ContextVar[Optional[int]] = ContextVar("offcut_hold_scope", default=None)


@contextmanager
def holding_for(order_id: Optional[int]):
    """Run the enclosed stock work on behalf of the held order `order_id`."""
    token = _current_hold.set(order_id)
    try:
        yield
    finally:
        _current_hold.reset(token)


def current_hold() -> Optional[int]:
    return _current_hold.get()


def visible_to_scope():
    """WHERE clause for offcuts this scope may consume or offer: public rows, plus the
    current window's own."""
    hold = current_hold()
    if hold is None:
        return Offcut.held_by_order_id.is_(None)
    return or_(Offcut.held_by_order_id.is_(None), Offcut.held_by_order_id == hold)


def own_rows_first():
    """ORDER BY term for a geometry lookup that finds a remainder to UN-create: prefer the
    current window's own row (False sorts before True) over a public twin of the same size."""
    return Offcut.held_by_order_id.is_(None)


def same_scope():
    """WHERE clause for merging a new remainder into an existing row. Only a row in exactly
    this scope qualifies — a held remainder must never merge into a public row (or another
    window's), or it could not be told apart from them again."""
    hold = current_hold()
    if hold is None:
        return Offcut.held_by_order_id.is_(None)
    return Offcut.held_by_order_id == hold


def assert_usable(offcut: Offcut) -> None:
    """Refuse a hand-picked offcut that belongs to another open window."""
    held_by = offcut.held_by_order_id
    if held_by is not None and held_by != current_hold():
        raise ValueError(f"Offcut #{offcut.offcutId} is being held by another open sale")


def held_elsewhere(db, piece) -> bool:
    """Is this ledger piece's pool row another open window's private remainder? A reversal
    must never merge material into such a piece: it is only on paper (its bar is still whole
    on the rack) and belongs to that window, which gives it back when it closes."""
    row_id = getattr(piece, "offcut_row_id", None) if piece is not None else None
    if not row_id:
        return False
    row = db.get(Offcut, row_id)
    return row is not None and row.held_by_order_id is not None and row.held_by_order_id != current_hold()


def hold_for_new_row(db, produced_by_item_id: Optional[int] = None) -> Optional[int]:
    """held_by_order_id for a row being created right now.

    In window scope a row is held by default — it is a remainder of this window's cut. The
    exception is a piece going BACK to where it came from during a window's cart change:
    a public offcut the window had consumed must return to the public pool, not become
    private to the window. `produced_by_item_id` (the piece's provenance) tells them apart:
    only material produced by one of this window's own items stays held.
    """
    hold = current_hold()
    if hold is None:
        return None
    if produced_by_item_id is None:
        return None
    from entities.orderItems import OrderItem
    item = db.get(OrderItem, produced_by_item_id)
    return hold if item is not None and item.order_id == hold else None


def publish_held_offcuts(db, order_id: int) -> int:
    """Make every offcut row held by `order_id` public. Called when a window closes, in the
    same transaction. Returns how many rows were published.

    Rows are untagged in place, never merged into a public twin of the same size. The
    window's cut records (offcut_sources) name these rows by id, and the printed cutting
    worksheet and later reversals rely on those ids staying valid; merging would delete
    the row they point at. The cost is that the pool can briefly list two rows of the same
    size, which every picker already copes with.
    """
    rows = db.exec(
        select(Offcut).where(Offcut.held_by_order_id == order_id)
        .order_by(Offcut.offcutId).with_for_update()
    ).all()
    for row in rows:
        row.held_by_order_id = None
        db.add(row)
    db.flush()
    return len(rows)


# ── Provisional offcuts switch (PROVISIONAL_OFFCUTS_PLAN.md) ─────────────────
#
# Off unless switched on. It only changes while NO sale window is open, so every window lives
# its whole life under one rule (private remainders, or provisional ones) and nothing ever has
# to convert a window's rows from one to the other. open_window takes the shared side of an
# advisory lock and the switch the exclusive side, so a window can't open between the switch
# counting open windows and committing.

PROVISIONAL_FLAG_KEY = "provisional_offcuts_enabled"
_SWITCH_LOCK = 7_310_021  # pg advisory lock id: the switch vs. opening a window


def provisional_enabled(db) -> bool:
    """Read on every 1D remainder write (one identity-map lookup after the first). Always off
    off Postgres: the marks are a Postgres array and sale windows are Postgres-only - the
    in-memory SQLite suites don't even create system_settings."""
    from entities.settings import SystemSetting

    if db.get_bind().dialect.name != "postgresql":
        return False
    row = db.get(SystemSetting, PROVISIONAL_FLAG_KEY)
    return row is not None and row.value == "true"


def lock_switch_shared(db) -> None:
    """Opening a window: wait out a switch in progress (held to the end of the transaction)."""
    from sqlmodel import text

    db.exec(text("SELECT pg_advisory_xact_lock_shared(:k)").bindparams(k=_SWITCH_LOCK))


def set_provisional_enabled(db, enabled: bool, user) -> dict:
    """CEO/admin. Refused while any sale window is open: unlike the windows switch it never
    releases a customer's sale on its own - the cashiers finish or release theirs first."""
    from fastapi import HTTPException
    from sqlmodel import text

    from entities.saleWindows import SaleWindow
    from entities.settings import SystemSetting
    from utils import require_role

    require_role(["ceo", "admin"], user)
    db.exec(text("SELECT pg_advisory_xact_lock(:k)").bindparams(k=_SWITCH_LOCK))
    current = provisional_enabled(db)
    if current != enabled:
        open_count = len(db.exec(select(SaleWindow.window_id)
                                 .where(SaleWindow.closed_at.is_(None))).all())
        if open_count:
            db.rollback()
            raise HTTPException(
                status_code=409,
                detail=(f"{open_count} sale window(s) are open. Ask the cashiers to confirm or "
                        "release them, then switch again."),
            )
    row = db.get(SystemSetting, PROVISIONAL_FLAG_KEY) or SystemSetting(key=PROVISIONAL_FLAG_KEY, value="false")
    row.value = "true" if enabled else "false"
    try:
        row.updated_by = user.get_uuid() if hasattr(user, "get_uuid") else None
    except (ValueError, TypeError):
        row.updated_by = None
    db.add(row)
    db.commit()
    return {"enabled": enabled}


# ── Provisional marks (switch on) ────────────────────────────────────────────
#
# With the switch on, a 1D remainder an open window produces is NOT held: every till sees it
# and may cut from it. It carries Offcut.provisional_for instead - the open windows whose
# uncut cut this material depends on - so it can be shown as provisional, and so the window's
# confirm/release knows what to unmark. Glass (2D) keeps the private hold above.
#
# Marks are DERIVED, never copied from the caller: a piece depends on every open window that
# consumed one of its ancestors (the bar it came from, the offcut that bar's leftover was cut
# from, ...), because until those windows are paid none of that cutting has happened. Deriving
# them from the piece ledger keeps them right whoever writes the row - a window, a checkout
# cutting from a provisional piece, an edit or cancel handing a piece back, a rejoin.

def _held_consumers(db, pieces) -> list:
    """Sorted ids of the open windows that consumed any of `pieces`."""
    from core.ordering.visibility import HELD
    from entities.offcutLedger import STATE_CONSUMED
    from entities.orders import Order

    ids = {p.consumed_by_order_id for p in pieces
           if p is not None and p.state == STATE_CONSUMED and p.consumed_by_order_id}
    if not ids:
        return []
    return sorted(db.exec(select(Order.orderId).where(Order.orderId.in_(ids),
                                                      Order.status == HELD)).all())


def marks_for_new_piece(db, parent, ignore_piece_id=None) -> list:
    """Marks for a piece about to be cut out of `parent` (None: a fresh root, no marks).

    `ignore_piece_id`: a consumption being reversed right now (a restore credit or a rejoin
    hangs the returned material off the very piece the reversing item had consumed). That
    claim is being given up, so it must not mark what comes back."""
    from core.inventory import offcutLedger as ledger

    if parent is None or not provisional_enabled(db):
        return []
    chain = [parent] + ledger.ancestors(db, parent)
    return _held_consumers(db, [p for p in chain if p.piece_id != ignore_piece_id])


def marks_for_piece(db, piece) -> list:
    """Marks for an existing piece (one going back into the pool): its ancestors' consumers."""
    from core.inventory import offcutLedger as ledger

    if piece is None or not provisional_enabled(db):
        return []
    return _held_consumers(db, ledger.ancestors(db, piece))


def placement_1d(db, marks: list) -> tuple:
    """(held_by_order_id, provisional_for) for a 1D row being created now with `marks`.
    Switch off: today's rule (held by the current window, if any). On: never held."""
    if not provisional_enabled(db):
        return current_hold(), []
    return None, list(marks)


def same_placement_1d(db, held_by, marks: list):
    """WHERE clause for merging a new 1D remainder into an existing row: the same hold and,
    with the switch on, exactly the same marks - a provisional piece must never disappear
    into an ordinary row (or one marked by other windows), or it could not be unmarked
    correctly. Off, marks are always empty and not compared (no array SQL on SQLite)."""
    from sqlalchemy import and_

    hold_clause = Offcut.held_by_order_id.is_(None) if held_by is None else Offcut.held_by_order_id == held_by
    if not provisional_enabled(db):
        return hold_clause
    return and_(hold_clause, Offcut.provisional_for == list(marks))


def clear_marks(db, order_id: int) -> int:
    """Window `order_id` closed (confirmed, or released after its stock went back): it no
    longer holds anything up. Row by row through the ORM - a bulk UPDATE would bypass the
    stock journal, and with it undo and the integrity trace. Returns how many rows changed."""
    if not provisional_enabled(db):
        return 0  # the switch can't change while a window is open, so nothing is marked
    rows = db.exec(
        select(Offcut).where(Offcut.provisional_for.contains([order_id]))
        .order_by(Offcut.offcutId).with_for_update()
    ).all()
    for row in rows:
        row.provisional_for = [m for m in row.provisional_for if m != order_id]
        db.add(row)
    db.flush()
    return len(rows)
