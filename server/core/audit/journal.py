"""
Automatic before/after journal of every stock-affecting row change.

A SQLAlchemy `after_flush` hook on every Session: whatever code path changed a tracked row —
the 1D and 2D cut engines, the reversal paths, accessory pack logic, a manager correction,
something written next year — the change is journaled with the operation that was active
(core/audit/opContext). Nothing has to remember to call it, which is the whole point: stock
is written from more than forty places, and a journal that relies on each of them opting in
is how the offcut ledger ended up with actor_id empty on every row.

What it cannot see: Core-level bulk statements (`session.exec(update(...))`) bypass the ORM
unit of work. There is exactly one in the stock paths (update_order clearing
offcuts.source_item_id, provenance only). The integrity check (core/audit/integrity.py)
compares stock counters to baseline + journaled deltas, so any future untracked write shows
up there instead of silently.

after_flush (not before_flush): primary keys of inserted rows exist by then, and the
session's new/dirty/deleted lists and attribute histories still describe the flush that just
ran. The journal rows go straight to the flush's connection as a Core INSERT, so they are
part of the same transaction and never re-enter the unit of work.
"""
import copy
import datetime as _dt
import decimal
import uuid
from typing import Any, Dict, Optional

from sqlalchemy import event, inspect
from sqlalchemy.orm import Session as _SASession

from entities.offcutLedger import OffcutPiece
from entities.offcuts import Offcut
from entities.openContainers import OpenContainer
from entities.orderItems import OrderItem
from entities.orders import Order
from entities.payments import Payment
from entities.products import Product
from entities.variants import Variant
from entities.opJournal import JournalEntry

# class -> (table name, columns to journal on UPDATE; None = every column)
TRACKED = {
    Variant: ("variants", ("stock_quantity",)),
    Product: ("products", ("stock_quantity",)),
    Offcut: ("offcuts", None),
    OffcutPiece: ("offcut_pieces", None),
    OrderItem: ("orderitems", None),
    Order: ("orders", None),
    Payment: ("payments", None),
    OpenContainer: ("open_containers", None),
}

# JSON columns whose previous value SQLAlchemy cannot report: code mutates them in place and
# calls flag_modified(), which also discards the attribute's history. A deep copy is kept
# from the moment the row is loaded (and after every flush) and journaled as the before-image.
_JSON_COLUMNS = {OrderItem: ("details",)}

_enabled = True


def set_enabled(value: bool) -> None:
    """Only for a bulk maintenance script that must not journal (never the app)."""
    global _enabled
    _enabled = value


def json_safe(value: Any) -> Any:
    if value is None or isinstance(value, (bool, int, str)):
        return value
    if isinstance(value, float):
        return value
    if isinstance(value, decimal.Decimal):
        return float(value)
    if isinstance(value, (_dt.datetime, _dt.date)):
        return value.isoformat()
    if isinstance(value, uuid.UUID):
        return str(value)
    if isinstance(value, dict):
        return {str(k): json_safe(v) for k, v in value.items()}
    if isinstance(value, (list, tuple, set)):
        return [json_safe(v) for v in value]
    return str(value)


def _columns(cls):
    return [attr.key for attr in inspect(cls).column_attrs]


def _pk(obj) -> Optional[str]:
    # A just-inserted row has no identity key yet inside after_flush (the identity map is
    # updated afterwards), but its primary-key attributes are already populated.
    ident = inspect(obj).identity or inspect(type(obj)).primary_key_from_instance(obj)
    if not ident or all(v is None for v in ident):
        return None
    return str(ident[0]) if len(ident) == 1 else "|".join(str(v) for v in ident)


def _image(obj, cols) -> Dict[str, Any]:
    """Loaded column values only — never triggers a lazy load (a deleted row can't be
    reloaded, and an expired attribute has no value to journal anyway)."""
    state_dict = inspect(obj).dict
    return {c: json_safe(state_dict[c]) for c in cols if c in state_dict}


def _stash(target) -> None:
    state = inspect(target)
    for col in _JSON_COLUMNS.get(type(target), ()):
        if col in state.dict:
            state.info[f"journal_orig:{col}"] = copy.deepcopy(state.dict[col])


@event.listens_for(OrderItem, "load")
def _stash_on_load(target, context):
    _stash(target)


@event.listens_for(OrderItem, "refresh")
def _stash_on_refresh(target, context, attrs):
    _stash(target)


@event.listens_for(_SASession, "before_flush")
def _load_unknown_befores(session, flush_context, instances):
    """A column assigned while its row was EXPIRED (e.g. after a commit) has no previous value
    in its attribute history - SQLAlchemy never loaded it. Read it from the database now,
    while the row still holds it, so the journal's before-image is never a guess (an undo
    computes its inverse from it)."""
    if not _enabled:
        return
    from sqlalchemy import select as _select

    for obj in list(session.dirty):
        spec = TRACKED.get(type(obj))
        if spec is None:
            continue
        state = inspect(obj)
        if state.key is None:
            continue
        cols = [c for c in (spec[1] or _columns(type(obj)))
                if c not in _JSON_COLUMNS.get(type(obj), ())]
        missing = []
        for col in cols:
            hist = state.attrs[col].history
            if hist.added and not hist.deleted and not hist.unchanged:
                missing.append(col)
        if not missing:
            continue
        mapper = inspect(type(obj))
        table = mapper.local_table
        pk_cols = mapper.primary_key
        row = session.connection().execute(
            _select(*[table.c[mapper.get_property(c).columns[0].name] for c in missing])
            .where(*[pk == v for pk, v in zip(pk_cols, state.identity)])
        ).first()
        if row is not None:
            for col, value in zip(missing, row):
                state.info[f"journal_orig:{col}"] = value


@event.listens_for(_SASession, "after_flush")
def _journal_after_flush(session, flush_context):
    if not _enabled:
        return
    from core.audit.opContext import current_op_id

    op_id = current_op_id()
    now = _dt.datetime.utcnow()
    rows = []

    for obj in session.new:
        spec = TRACKED.get(type(obj))
        if spec is None:
            continue
        table, _ = spec
        rows.append({"op_id": op_id, "table_name": table, "row_pk": str(_pk(obj)),
                     "action": "insert", "before": None,
                     "after": _image(obj, _columns(type(obj))), "at": now})

    for obj in session.dirty:
        spec = TRACKED.get(type(obj))
        if spec is None or obj in session.deleted:
            continue
        table, cols = spec
        state = inspect(obj)
        before, after = {}, {}
        for col in (cols or _columns(type(obj))):
            hist = state.attrs[col].history
            if not hist.has_changes():
                continue
            if hist.deleted:
                old = hist.deleted[0]
            elif col in _JSON_COLUMNS.get(type(obj), ()):
                old = state.info.get(f"journal_orig:{col}")
            else:
                old = state.info.pop(f"journal_orig:{col}", None)
            new = hist.added[0] if hist.added else state.dict.get(col)
            if old == new and not isinstance(new, (dict, list)):
                continue
            before[col] = json_safe(old)
            after[col] = json_safe(new)
        if before or after:
            rows.append({"op_id": op_id, "table_name": table, "row_pk": str(_pk(obj)),
                         "action": "update", "before": before, "after": after, "at": now})

    for obj in session.deleted:
        spec = TRACKED.get(type(obj))
        if spec is None:
            continue
        table, _ = spec
        rows.append({"op_id": op_id, "table_name": table, "row_pk": str(_pk(obj)),
                     "action": "delete", "before": _image(obj, _columns(type(obj))),
                     "after": None, "at": now})

    if rows:
        session.connection().execute(JournalEntry.__table__.insert(), rows)

    # What was just written is the committed value from here on.
    for obj in list(session.new) + list(session.dirty):
        if type(obj) in _JSON_COLUMNS and obj not in session.deleted:
            _stash(obj)
