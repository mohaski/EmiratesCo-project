"""
The operation currently in progress — who is doing what to which order.

Every stock-moving service opens one (`with operation(db, OP_EDIT, actor=user, order_id=...)`)
and everything that runs inside it — ledger events, journal rows, pieces minted by a
reversal — is stamped with it automatically. That is what makes a piece's history
answerable ("which edit returned this 13ft offcut, and who confirmed the answers?") without
threading an actor/order/op id through every function between the endpoint and the engine.

A ContextVar rather than a module global: the API serves requests concurrently, and each
request's work runs in its own context (FastAPI runs sync endpoints on a worker thread with
a copied context), so two cashiers editing at once never see each other's operation.
"""
import uuid
from contextlib import contextmanager
from contextvars import ContextVar
from typing import Any, Dict, List, Optional

from sqlalchemy.orm.attributes import flag_modified


class OpContext:
    """In-memory state of the running operation.

    `returned` is filled by the reversal paths: for each cut line reversed, the piece(s) it
    handed back to the pool and how ("own" cut piece, "joined" onto the bar's leftover,
    "source" offcut released, "rejoined" glass). The re-cut that follows uses it twice:
    a cashier's pick of a returned piece is resolved through it, and a new cut that is
    satisfied exactly by the line's own already-cut piece needs no cutting.
    """

    __slots__ = ("op_id", "kind", "actor_id", "actor_name", "order_id", "row",
                 "returned", "precut_items", "notes")

    def __init__(self, op_id: str, kind: str, actor_id=None, actor_name=None, order_id=None, row=None):
        self.op_id = op_id
        self.kind = kind
        self.actor_id = actor_id
        self.actor_name = actor_name
        self.order_id = order_id
        self.row = row
        self.returned: Dict[str, List[dict]] = {}
        # item_id -> True while every cut it made came from an exact already-cut piece
        self.precut_items: Dict[int, bool] = {}
        self.notes: List[str] = []

    # ── what the reversal handed back ────────────────────────────────────────
    def add_returned(self, line_ref: Optional[str], piece, kind: str, label: str = "") -> None:
        if piece is None or not line_ref:
            return
        self.returned.setdefault(line_ref, []).append({
            "piece_id": piece.piece_id, "kind": kind, "label": label,
        })

    def returned_piece_ids(self) -> set:
        return {r["piece_id"] for entries in self.returned.values() for r in entries}

    def returned_own_piece_ids(self) -> set:
        return {r["piece_id"] for entries in self.returned.values() for r in entries
                if r["kind"] == "own"}


_current: ContextVar[Optional[OpContext]] = ContextVar("stock_operation", default=None)


def current() -> Optional[OpContext]:
    return _current.get()


def current_op_id() -> Optional[str]:
    op = _current.get()
    return op.op_id if op else None


def _actor_parts(actor):
    if actor is None:
        return None, None
    actor_id = getattr(actor, "userId", actor)
    name = getattr(actor, "username", None)
    try:
        actor_id = uuid.UUID(str(actor_id))
    except (ValueError, TypeError, AttributeError):
        actor_id = None
    return actor_id, name


@contextmanager
def operation(db, kind: str, *, actor=None, order_id: Optional[int] = None,
              request: Optional[dict] = None, notes: Optional[str] = None,
              persist: bool = True, new: bool = False):
    """Run the enclosed block as one operation.

    Nested use joins the outer operation (an edit calling a helper that also opens one stays
    ONE operation) unless `new=True`, which the undo tool uses to re-run an edit as its own,
    separately undoable operation inside the undo's transaction.

    `persist=False` for dry runs that are rolled back anyway (stock checks, previews): the
    stamps still apply, but there is no operation row to write.

    The operation row is added to the caller's transaction, so it commits or rolls back with
    the work it describes — there is never a record of something that did not happen.
    """
    outer = _current.get()
    if outer is not None and not new:
        if order_id is not None and outer.order_id is None:
            outer.order_id = order_id
        yield outer
        return

    from entities.opJournal import StockOperation

    actor_id, actor_name = _actor_parts(actor)
    op = OpContext(uuid.uuid4().hex, kind, actor_id, actor_name, order_id)
    if persist:
        row = StockOperation(
            op_id=op.op_id, kind=kind, actor_id=actor_id, actor_name=actor_name,
            order_id=order_id, request=_json_safe(request) if request is not None else None,
            notes=notes, summary={},
        )
        db.add(row)
        op.row = row
    token = _current.set(op)
    try:
        yield op
    finally:
        _current.reset(token)


def record_summary(op: Optional[OpContext], **fields) -> None:
    """Merge fields into the operation row's summary (no-op for a dry run)."""
    if op is None or op.row is None:
        return
    summary = dict(op.row.summary or {})
    summary.update(_json_safe(fields))
    op.row.summary = summary
    flag_modified(op.row, "summary")


def _json_safe(value: Any) -> Any:
    from core.audit.journal import json_safe
    return json_safe(value)


def stock_operation(kind: str, *, order_arg: Optional[str] = "order_id", request=None):
    """Decorator: run a service function as one operation.

    For services that already own their transaction (they commit or roll back themselves):
    the operation row is added before their commit, so it is persisted with the work, and
    discarded with it on a rollback. `db` and `current_user` are read from the call's
    arguments; `order_arg` names the argument holding the order id, if any; `request` is an
    optional function of the bound arguments returning what to store as the request.
    """
    import functools
    import inspect as _inspect

    def deco(fn):
        sig = _inspect.signature(fn)

        @functools.wraps(fn)
        def wrapper(*args, **kwargs):
            bound = sig.bind_partial(*args, **kwargs).arguments
            db = bound.get("db")
            order_id = bound.get(order_arg) if order_arg else None
            if not isinstance(order_id, int):
                order_id = None
            req = request(bound) if request else None
            with operation(db, kind, actor=bound.get("current_user"), order_id=order_id,
                           request=req):
                return fn(*args, **kwargs)
        return wrapper
    return deco


def set_order(order_id: Optional[int]) -> None:
    """Attach the order to the running operation once it exists (a sale's order id is only
    known after the order row is flushed)."""
    op = _current.get()
    if op is None or order_id is None:
        return
    op.order_id = order_id
    if op.row is not None:
        op.row.order_id = order_id


def note_cut(item_id: Optional[int], exact_own_piece: bool) -> None:
    """Record, per order item being (re)cut in this operation, whether EVERY cut so far was
    satisfied exactly by a piece this same operation returned as already cut. Such an item
    needs no cutting - its cut piece already exists - so it must not go back to the queue."""
    op = _current.get()
    if op is None or item_id is None:
        return
    op.precut_items[item_id] = op.precut_items.get(item_id, True) and bool(exact_own_piece)

