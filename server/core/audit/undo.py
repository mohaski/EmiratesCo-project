"""
Undo an order edit/cancel exactly, or re-run it with corrected cut answers.

Built on the operation journal (entities/opJournal.py): every row the operation changed was
journaled with its before- and after-image, so the undo is the exact inverse, not a
re-derivation. Everything happens in the caller's transaction; nothing here commits.

WHAT IS RESTORED
  offcut pieces     each back to its state before the operation (an `undone` event is added;
                    pieces the operation created are retired - rows are never deleted)
  offcut rows       quantities put back; rows the operation emptied and deleted are recreated
                    under their original id
  stock counters    the operation's net change reversed
  order items       items it deleted come back under their original ids (so every ledger
                    reference to them stays valid); items it created are removed; items it
                    changed get their previous values back
  the order         totals/status back as they were

WHAT IS NOT: money that actually changed hands. A refund paid or an extra payment collected by
the edit really happened, so its Payment row stays and the order's paid amount keeps counting
it - the balance is recomputed against the restored total, and the preview says so.

REFUSED (all-or-nothing, with the reason) when an exact inverse is not possible:
  - a later change to the same order that is still in effect (undo that first)
  - a piece this operation touched has since been touched by something else - e.g. the
    offcut the edit returned was cut for another order
  - an order item it created was changed by something other than a cutting report
  - a stock counter or offcut row would go below zero
  - the operation predates the journal (nothing recorded to invert)
"""
import datetime as _dt
import uuid
from collections import OrderedDict
from typing import Dict, List, Optional

from sqlalchemy import inspect as sa_inspect
from sqlmodel import Session, select, text, update

from entities.editHistory import EditHistory
from entities.offcutLedger import OffcutPiece
from entities.offcuts import Offcut
from entities.openContainers import OpenContainer
from entities.opJournal import (
    OP_CANCEL,
    OP_CUTTING_REPORT,
    OP_EDIT,
    OP_UNDO,
    STATUS_APPLIED,
    STATUS_UNDONE,
    UNDOABLE_KINDS,
    JournalEntry,
    StockOperation,
)
from entities.orderItems import OrderItem
from entities.orders import Order
from entities.products import Product
from entities.variants import Variant

from core.audit.opContext import operation, record_summary
from core.inventory import offcutLedger as ledger

# Order-level operation kinds that change what an order IS. A later one still in effect
# blocks undoing an earlier one (last in, first out).
ORDER_CHANGING_KINDS = (OP_EDIT, OP_CANCEL, "sale", "cut_correction", "status_change", OP_UNDO)

CUT_FLAG_COLUMNS = {"cutting_completed", "cutting_completed_at"}
MONEY_COLUMNS = {"amountPayed", "balance", "payment_status"}


class UndoRefused(Exception):
    def __init__(self, reasons: List[str]):
        super().__init__("; ".join(reasons))
        self.reasons = reasons


# ── reading the journal ─────────────────────────────────────────────────────────

def _entries(db: Session, op_id: str) -> List[JournalEntry]:
    return list(db.exec(select(JournalEntry).where(JournalEntry.op_id == op_id)
                        .order_by(JournalEntry.id.asc())).all())


def _net_by_row(entries: List[JournalEntry]) -> "OrderedDict[tuple, dict]":
    """Per changed row: its image before the operation's first change and after its last."""
    out: "OrderedDict[tuple, dict]" = OrderedDict()
    for e in entries:
        key = (e.table_name, e.row_pk)
        rec = out.get(key)
        if rec is None:
            rec = out[key] = {"first": e, "last": e, "actions": [], "changed": set(),
                              "before": dict(e.before or {}) if e.action != "insert" else None}
        rec["last"] = e
        rec["actions"].append(e.action)
        if e.action == "delete":
            # The full row as it stood when deleted - the only complete image of a row the
            # operation updated first (an update entry carries just the changed columns).
            rec["full"] = dict(e.before or {})
        if e.action == "update":
            for col in (e.after or {}):
                rec["changed"].add(col)
                if rec["before"] is not None and col not in rec["before"]:
                    rec["before"][col] = (e.before or {}).get(col)
    for rec in out.values():
        rec["inserted"] = rec["actions"][0] == "insert"
        rec["deleted"] = rec["actions"][-1] == "delete"
    return out


def _later_entries(db: Session, key: tuple, after_id: int, exclude_ops: set) -> List[JournalEntry]:
    rows = db.exec(select(JournalEntry).where(
        JournalEntry.table_name == key[0], JournalEntry.row_pk == key[1], JournalEntry.id > after_id,
    ).order_by(JournalEntry.id.asc())).all()
    if not rows:
        return []
    op_ids = {r.op_id for r in rows if r.op_id}
    undone = set()
    if op_ids:
        undone = {o.op_id for o in db.exec(select(StockOperation).where(
            StockOperation.op_id.in_(op_ids), StockOperation.status == STATUS_UNDONE)).all()}
    return [r for r in rows if r.op_id not in exclude_ops and r.op_id not in undone]


def _qty(image: Optional[dict], col: str = "quantity") -> float:
    if not image:
        return 0.0
    return float(image.get(col) or 0)


def _coerce(cls, image: dict) -> dict:
    """Turn a journaled (JSON-safe) row image back into constructor values."""
    out = {}
    columns = {c.key: c for c in sa_inspect(cls).column_attrs}
    for key, value in image.items():
        attr = columns.get(key)
        if attr is None:
            continue
        col_type = attr.columns[0].type
        python_type = None
        try:
            python_type = col_type.python_type
        except NotImplementedError:
            pass
        if value is not None and python_type is _dt.datetime and isinstance(value, str):
            value = _dt.datetime.fromisoformat(value)
        elif value is not None and python_type is uuid.UUID and isinstance(value, str):
            value = uuid.UUID(value)
        out[key] = value
    return out


# ── analysis ────────────────────────────────────────────────────────────────────

def _describe_piece(p: Optional[OffcutPiece]) -> str:
    if p is None:
        return "a piece"
    if p.geom_kind == ledger.GEOM_2D:
        return f"the {p.width:.0f}x{p.height:.0f}mm piece"
    return f"the {p.length:.2f} piece"


def _op_label(db: Session, op_id: Optional[str]) -> str:
    if not op_id:
        return "a change made outside any recorded operation"
    op = db.get(StockOperation, op_id)
    if op is None:
        return "another operation"
    what = {"sale": "a sale", OP_EDIT: "an edit", OP_CANCEL: "a cancellation",
            "cut_correction": "a cutting correction", OP_CUTTING_REPORT: "a cutting report",
            "offcut_admin": "Offcut Management", "stock_session": "Stock Control",
            OP_UNDO: "an undo"}.get(op.kind, op.kind)
    order = f" on order #{op.order_id}" if op.order_id else ""
    who = f" by {op.actor_name}" if op.actor_name else ""
    return f"{what}{order}{who}"


def _is_neutral_undo(db: Session, later: StockOperation, target: StockOperation) -> bool:
    """An undo of something made AFTER `target`: that pair cancels out, so neither it nor its
    journal rows stand in the way of undoing `target`."""
    if later.kind != OP_UNDO or not later.undoes_op_id:
        return False
    undone = db.get(StockOperation, later.undoes_op_id)
    return undone is not None and undone.created_at > target.created_at


def analyse(db: Session, op_id: str) -> dict:
    """What undoing `op_id` would involve, and every reason it can't be done exactly."""
    op = db.get(StockOperation, op_id)
    if op is None:
        raise UndoRefused(["That change was made before changes were recorded, so it can't be undone automatically."])
    reasons: List[str] = []
    if op.kind not in UNDOABLE_KINDS:
        reasons.append("Only order edits and cancellations can be undone here.")
    if op.status != STATUS_APPLIED:
        reasons.append("This change has already been undone.")

    entries = _entries(db, op_id)
    if not entries and op.kind in UNDOABLE_KINDS:
        reasons.append("Nothing was recorded for this change.")
    rows = _net_by_row(entries)
    last_id = entries[-1].id if entries else 0

    # Later changes to the same order that are still in effect: last in, first out.
    neutral: set = set()
    if op.order_id is not None:
        later_ops = db.exec(select(StockOperation).where(
            StockOperation.order_id == op.order_id,
            StockOperation.created_at > op.created_at,
            StockOperation.status == STATUS_APPLIED,
            StockOperation.kind.in_(ORDER_CHANGING_KINDS),
            StockOperation.op_id != op.op_id,
        )).all()
        for later in later_ops:
            if _is_neutral_undo(db, later, op):
                neutral.add(later.op_id)
                continue
            reasons.append(f"Order #{op.order_id} was changed again afterwards ({_op_label(db, later.op_id)}) - undo that first.")

    exclude = {op_id} | neutral
    for key, rec in rows.items():
        table = key[0]
        later = _later_entries(db, key, last_id, exclude)
        if not later:
            continue
        if table == "offcut_pieces":
            piece = db.get(OffcutPiece, int(key[1]))
            by = _op_label(db, later[0].op_id)
            reasons.append(f"{_describe_piece(piece).capitalize()} this change touched has since been used ({by}).")
        elif table == "orderitems":
            cols = set()
            for e in later:
                cols |= set((e.after or {}).keys()) if e.action == "update" else {"*"}
            if cols - CUT_FLAG_COLUMNS:
                reasons.append(f"An order item this change touched was changed again ({_op_label(db, later[0].op_id)}).")
        elif table == "orders":
            cols = set()
            for e in later:
                cols |= set((e.after or {}).keys()) if e.action == "update" else {"*"}
            if "status" in cols or "*" in cols:
                reasons.append(f"Order #{key[1]}'s status changed afterwards ({_op_label(db, later[0].op_id)}).")
        elif table == "open_containers":
            cols = set()
            for e in later:
                cols |= set((e.after or {}).keys()) if e.action == "update" else {"*"}
            if cols - {"units_sold"}:
                reasons.append("An open container this change used was closed or changed afterwards.")
        # variants / products / offcuts / payments: counters and money - see apply.

    return {"op": op, "rows": rows, "reasons": reasons, "last_id": last_id}


# ── applying ────────────────────────────────────────────────────────────────────

def money_moved(db: Session, op_id: str) -> float:
    """Money the operation recorded as changing hands (+ collected, - refunded)."""
    rows = _net_by_row(_entries(db, op_id))
    return round(sum(_qty(rec["last"].after, "amount") for key, rec in rows.items()
                     if key[0] == "payments" and rec["inserted"]), 2)


def undo_operation(db: Session, op_id: str, *, actor, reason: str,
                   money_handled: Optional[bool] = None) -> StockOperation:
    """Reverse `op_id` exactly (see module docstring). Returns the undo operation row.
    Raises UndoRefused with every reason if it can't be done exactly. Does not commit."""
    from core.financials.PaymentService import _sync_credit_for_order

    info = analyse(db, op_id)
    if info["reasons"]:
        raise UndoRefused(info["reasons"])
    target: StockOperation = info["op"]
    rows = info["rows"]
    problems: List[str] = []

    with operation(db, OP_UNDO, actor=actor, order_id=target.order_id, new=True,
                   request={"undoes": op_id, "reason": reason},
                   notes=f"undo of {target.kind} {op_id}: {reason}") as undo_op:

        def rows_of(table):
            return [(key, rec) for key, rec in rows.items() if key[0] == table]

        # 1. order items the operation deleted come back first (offcut rows may point at them)
        doomed_items = []
        for key, rec in rows_of("orderitems"):
            if rec["inserted"] and not rec["deleted"]:
                doomed_items.append(int(key[1]))
            elif rec["deleted"] and not rec["inserted"]:
                if db.get(OrderItem, int(key[1])) is None:
                    image = dict(rec.get("full") or {})
                    image.update(rec["before"] or {})
                    db.add(OrderItem(**_coerce(OrderItem, image)))
        db.flush()
        if doomed_items:
            db.exec(update(Offcut).where(Offcut.source_item_id.in_(doomed_items)).values(source_item_id=None))
        restored_items = {int(key[1]) for key, rec in rows_of("orderitems") if rec["deleted"] and not rec["inserted"]}

        # 2. pooled offcut rows: counters, recreating rows the operation emptied
        for key, rec in rows_of("offcuts"):
            before_img = rec["before"] if not rec["inserted"] else None
            after_img = rec["last"].after if not rec["deleted"] else None
            net = _qty(after_img) - _qty(before_img)
            if net == 0:
                continue
            row = db.get(Offcut, int(key[1]))
            if row is None:
                if net > 0:
                    problems.append("an offcut this change added is no longer in the pool")
                    continue
                image = dict(rec.get("full") or {})
                image.update(rec["before"] or {})
                image["quantity"] = -net
                if image.get("source_item_id") in doomed_items:
                    image["source_item_id"] = None
                db.add(Offcut(**_coerce(Offcut, image)))
                continue
            new_q = (row.quantity or 0) - net
            if new_q < 0:
                problems.append(f"offcut row {row.offcutId} would go below zero")
                continue
            if new_q == 0:
                from core.inventory.poolKey import safe_delete_offcut
                safe_delete_offcut(db, row)
            else:
                row.quantity = new_q
                db.add(row)
        db.flush()

        # 2b. the producer links the operation cleared (only a bulk UPDATE touched them, so
        # they are in its summary, not the journal)
        for offcut_id, item_id in (target.summary or {}).get("provenance") or []:
            row = db.get(Offcut, offcut_id)
            if row is not None and row.source_item_id is None and item_id in restored_items:
                row.source_item_id = item_id
                db.add(row)
        # 2c. rows the operation re-pointed at one of its own items (a piece returned onto an
        # existing row): back to the item they came from. Only when the link is now empty or
        # still points at an item this undo removes - a later re-link is left alone.
        for key, rec in rows_of("offcuts"):
            if rec["inserted"] or "source_item_id" not in rec["changed"]:
                continue
            was = (rec["before"] or {}).get("source_item_id")
            row = db.get(Offcut, int(key[1]))
            if row is None or row.source_item_id == was or not (
                    row.source_item_id is None or row.source_item_id in doomed_items):
                continue
            if was is None or db.get(OrderItem, int(was)) is not None:
                row.source_item_id = was
                db.add(row)
        db.flush()

        # 3. ledger pieces, each back to its prior state (append-only: an `undone` event)
        for key, rec in rows_of("offcut_pieces"):
            piece = db.get(OffcutPiece, int(key[1]))
            if piece is None:
                continue
            if rec["inserted"]:
                target_img = {"state": ledger.STATE_RETIRED, "offcut_row_id": None}
            else:
                target_img = {k: v for k, v in (rec["before"] or {}).items() if k in ledger.PIECE_UNDO_FIELDS}
            ledger.undo_piece(db, piece, target_img, undoes_op_id=op_id, reason=reason)
        db.flush()

        # 4. stock counters
        for table, cls in (("variants", Variant), ("products", Product)):
            for key, rec in rows_of(table):
                if rec["inserted"] or rec["deleted"]:
                    continue
                net = _qty(rec["last"].after, "stock_quantity") - _qty(rec["before"], "stock_quantity")
                if net == 0:
                    continue
                obj = db.get(cls, int(key[1]))
                new_q = (obj.stock_quantity or 0) - net
                if new_q < 0:
                    problems.append(f"stock of {getattr(obj, 'name', '') or table[:-1]} #{key[1]} would go below zero")
                    continue
                obj.stock_quantity = new_q
                db.add(obj)

        # 5. open containers: the dispensed tally
        for key, rec in rows_of("open_containers"):
            if rec["inserted"] or rec["deleted"]:
                continue
            net = _qty(rec["last"].after, "units_sold") - _qty(rec["before"], "units_sold")
            if net:
                c = db.get(OpenContainer, int(key[1]))
                c.units_sold = max(0.0, (c.units_sold or 0) - net)
                db.add(c)

        # 6. order items: remove the ones it created, give changed ones their old values
        for item_id in doomed_items:
            item = db.get(OrderItem, item_id)
            if item is not None:
                db.delete(item)
        for key, rec in rows_of("orderitems"):
            if rec["inserted"] or rec["deleted"]:
                continue
            item = db.get(OrderItem, int(key[1]))
            if item is None:
                continue
            restored = _coerce(OrderItem, {c: rec["before"].get(c) for c in rec["changed"]})
            for col, value in restored.items():
                setattr(item, col, value)
            db.add(item)
        db.flush()

        # 7. the order: everything back, except money that really moved
        money_note = None
        order = db.get(Order, target.order_id) if target.order_id else None
        if order is not None:
            order_rec = rows.get(("orders", str(order.orderId)))
            if order_rec and not order_rec["inserted"]:
                before = order_rec["before"] or {}
                restored = _coerce(Order, {c: before.get(c) for c in order_rec["changed"]
                                           if c not in MONEY_COLUMNS})
                for col, value in restored.items():
                    setattr(order, col, value)
                paid_delta = _qty(order_rec["last"].after, "amountPayed") - _qty(before, "amountPayed")
                moved = sum(_qty(rec["last"].after, "amount") for key, rec in rows_of("payments")
                            if rec["inserted"])
                if moved and money_handled is False:
                    # The refund was never handed back / the extra never collected: record the
                    # opposite amount, so the day's cash totals and the order are both right.
                    from entities.payments import Payment
                    first = next(rec for key, rec in rows_of("payments") if rec["inserted"])
                    db.add(Payment(
                        orderId=order.orderId, amount=-moved,
                        payment_method=(first["last"].after or {}).get("payment_method") or "cash",
                        reason="order" if -moved > 0 else "refund",
                        recorded_by=undo_op.actor_id,
                    ))
                    moved = 0.0
                new_paid = max(0.0, float(order.amountPayed or 0) - paid_delta + moved)
                order.amountPayed = new_paid
                total = float(order.total or 0)
                order.balance = max(0.0, round(total - new_paid, 2))
                order.payment_status = ("Paid" if order.balance <= 0.10
                                        else ("Partial" if new_paid > 0 else "Unpaid"))
                if new_paid > total + 0.10:
                    money_note = f"The customer has paid KSH {new_paid - total:.2f} more than the restored total - settle it through Payments."
                elif abs(moved) > 0.01:
                    money_note = (f"KSH {abs(moved):.2f} was {'refunded' if moved < 0 else 'collected'} by the undone change "
                                  "and stays recorded; the balance is worked out against the restored total.")
                db.add(order)
                _sync_credit_for_order(db, order)

        if problems:
            raise UndoRefused(problems)

        target.status = STATUS_UNDONE
        target.undone_by_op_id = undo_op.op_id
        db.add(target)
        undo_op.row.undoes_op_id = op_id

        audit = EditHistory(
            entity_type="order_undo",
            entity_id=target.order_id or 0,
            edited_by=undo_op.actor_id,
            action=f"undo_{target.kind}",
            before_snapshot={"op_id": op_id, "kind": target.kind,
                             "summary": target.summary or {}},
            after_snapshot={"op_id": undo_op.op_id, "money_note": money_note},
            notes=reason,
        )
        db.add(audit)
        db.flush()
        undo_op.row.edit_history_id = audit.id
        record_summary(undo_op, undoes=op_id, money_note=money_note)
        return undo_op.row


def correct_operation(db: Session, op_id: str, *, actor, reason: str, cut_confirmations: dict) -> dict:
    """Undo `op_id`, then run the same edit/cancel again with corrected cut answers - one
    transaction. The re-run is its own operation, so it can itself be undone later."""
    from core.ordering import model
    from core.ordering.orderService import apply_cancel, apply_order_edit

    target = db.get(StockOperation, op_id)
    if target is None:
        raise UndoRefused(["That change was made before changes were recorded, so it can't be corrected automatically."])
    request = dict(target.request or {})
    undo_row = undo_operation(db, op_id, actor=actor, reason=reason)

    if target.kind == OP_EDIT:
        # A hand-picked piece that the ORIGINAL answers handed back (the joined bar, the cut
        # piece...) may not exist under the corrected ones - those picks fall back to the
        # automatic choice. Picks of ordinary offcuts are kept.
        dropped = 0
        for item in request.get("items") or []:
            for line in ((item.get("details") or {}).get("lineItems") or []):
                sel = line.get("offcut_selection") if isinstance(line, dict) else None
                if sel:
                    kept = [e for e in sel if not (isinstance(e, dict) and e.get("returned_ref"))]
                    dropped += len(sel) - len(kept)
                    if kept:
                        line["offcut_selection"] = kept
                    else:
                        line.pop("offcut_selection", None)
        req = model.OrderEditRequest(**request)
        # The money was already handled by the original edit and survives the undo; the
        # re-run only has to rebuild the goods.
        req.amountPaid = 0.0
        req.planToken = None
        req.orderVersion = None
        req.cutConfirmations = cut_confirmations
        with operation(db, OP_EDIT, actor=actor, order_id=target.order_id, new=True,
                       request=req.model_dump(mode="json"),
                       notes=f"re-run of {op_id} with corrected cut answers") as rerun:
            apply_order_edit(target.order_id, req, db, actor)
            if dropped:
                record_summary(rerun, money_note=None, picks_note=(
                    f"{dropped} hand-picked returned piece(s) replaced by the automatic choice"))
    elif target.kind == OP_CANCEL:
        with operation(db, OP_CANCEL, actor=actor, order_id=target.order_id, new=True,
                       request={**request, "cut_confirmations": cut_confirmations},
                       notes=f"re-run of {op_id} with corrected cut answers") as rerun:
            apply_cancel(target.order_id, db, actor, request.get("refund_method"),
                         request.get("refund_details"), cut_confirmations, None,
                         enforce_window=False)
    else:
        raise UndoRefused(["Only order edits and cancellations can be corrected."])
    return {"undo_op_id": undo_row.op_id, "rerun_op_id": rerun.op_id}


# ── previews ────────────────────────────────────────────────────────────────────

def describe_ops(db: Session, op_ids: List[str]) -> dict:
    """Net, human-readable effect of one or more operations (read from their journal)."""
    entries = [e for oid in op_ids for e in _entries(db, oid)]
    stock: Dict[str, float] = {}
    offcuts: Dict[str, float] = {}
    items_added, items_removed = [], []
    for key, rec in _net_by_row(entries).items():
        table = key[0]
        if table == "variants":
            net = _qty(rec["last"].after, "stock_quantity") - _qty(rec["before"], "stock_quantity")
            if net and not rec["inserted"]:
                v = db.get(Variant, int(key[1]))
                p = db.get(Product, v.product_id) if v else None
                label = f"{p.name if p else 'Product'} {v.name if v and v.name else ''}".strip()
                stock[label] = stock.get(label, 0) + net
        elif table == "offcuts":
            before_img = rec["before"] if not rec["inserted"] else None
            after_img = rec["last"].after if not rec["deleted"] else None
            net = _qty(after_img) - _qty(before_img)
            if net:
                img = after_img or before_img or {}
                p = db.get(Product, img.get("product_id")) if img.get("product_id") else None
                size = (f"{img['width']:.0f}x{img['height']:.0f}mm" if img.get("width")
                        else f"{float(img.get('length') or 0):.2f}")
                label = f"{p.name if p else 'offcut'} {size}"
                offcuts[label] = offcuts.get(label, 0) + net
        elif table == "orderitems":
            # An inserted row's full image is its insert entry; later entries carry only the
            # columns they changed.
            img = rec["first"].after if rec["inserted"] else (rec.get("full") or rec["before"])
            p = db.get(Product, (img or {}).get("product_id")) if img else None
            name = p.name if p else "item"
            if rec["inserted"] and not rec["deleted"]:
                items_added.append(name)
            elif rec["deleted"] and not rec["inserted"]:
                items_removed.append(name)
    lines = []
    for label, n in stock.items():
        if abs(n) > 1e-9:
            lines.append(f"Stock {label}: {n:+g}")
    for label, n in offcuts.items():
        if abs(n) > 1e-9:
            lines.append(f"Offcut {label}: {n:+g}")
    return {"lines": lines, "stock": stock, "offcuts": offcuts,
            "items_added": items_added, "items_removed": items_removed}


def preview(db: Session, fn) -> dict:
    """Run `fn` (an undo or correction) inside a SAVEPOINT, describe what it did, roll back."""
    savepoint = db.begin_nested()
    try:
        result = fn()
        db.flush()
        op_ids = []
        if isinstance(result, StockOperation):
            op_ids = [result.op_id]
        elif isinstance(result, dict):
            op_ids = [v for k, v in result.items() if k.endswith("op_id") and v]
        effects = describe_ops(db, op_ids)
        money = None
        if len(op_ids) == 1:
            row = db.get(StockOperation, op_ids[0])
            money = (row.summary or {}).get("money_note") if row is not None else None
        else:
            # A correction: only the end state matters - the re-run rebuilds the same cart, so
            # money normally doesn't move at all.
            row = db.get(StockOperation, op_ids[-1])
            order = db.get(Order, row.order_id) if row is not None and row.order_id else None
            if order is not None and float(order.amountPayed or 0) > float(order.total or 0) + 0.10:
                money = (f"The customer has paid KSH {float(order.amountPayed) - float(order.total):.2f} "
                         "more than the corrected total - settle it through Payments.")
            notes = [(db.get(StockOperation, oid).summary or {}).get("picks_note") for oid in op_ids]
            picks = next((n for n in notes if n), None)
            if picks:
                effects["lines"].append(picks)
        effects["money_note"] = money
        # The money the UNDONE change moved (the undo op itself records none unless told to).
        target_id = result.undoes_op_id if isinstance(result, StockOperation) else None
        effects["money_moved"] = money_moved(db, target_id) if target_id else 0.0
        return effects
    finally:
        savepoint.rollback()
