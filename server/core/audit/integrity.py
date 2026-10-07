"""
Consistency checks between the stock counters, the offcut pool, the offcut ledger and the
operation journal. Read-only.

Every test scenario and the live audit run this after each step. The invariants:

  POOL <-> LEDGER
    - an `available` piece is a real piece in the pool: it points at an offcut row that
      exists (a piece with no row, or a dangling pointer, is a phantom)
    - a row never has MORE available pieces than units (the reverse is allowed: units from
      before the ledger get a piece when they are first used - claim_available_piece)

  LEDGER <-> ITS OWN LOG
    - a piece's cached state equals the fold of its events (rebuild_piece_state's rule)

  STOCK <-> JOURNAL
    - every stock counter equals its baseline plus every journaled change since - i.e.
      nothing changed stock behind the journal's back

  TRACE
    - ledger events written since journaling began carry the operation that wrote them
"""
import json
from collections import defaultdict
from typing import Dict, List

from sqlmodel import Session, select, text

from entities.offcutLedger import event_retires
from entities.orders import Order


def _fold(events: List[dict]) -> tuple:
    state, item = "available", None
    for e in events:
        ev = e["event"]
        if ev == "consumed":
            state, item = "consumed", e["item_id"]
        elif ev == "released":
            state, item = "available", None
        elif event_retires(ev, e["payload"]):
            state = "retired"
        elif ev == "undone":
            to = (e["payload"] or {}).get("to") or {}
            state = to.get("state", state)
            item = to.get("consumed_by_item_id")
    return state, item


def check(db: Session, *, since_journal_id: int = None, product_ids=None) -> Dict[str, list]:
    errors: List[str] = []
    warnings: List[str] = []
    conn = db.connection()
    prod_filter = ""
    params = {}
    if product_ids:
        prod_filter = " AND o.product_id = ANY(:pids)"
        params["pids"] = list(product_ids)

    # ── pool <-> ledger ─────────────────────────────────────────────────────
    rows = conn.execute(text(f'''
        SELECT o."offcutId" AS row_id, o.product_id, o.quantity, o.length, o.width, o.height,
               count(p.piece_id) FILTER (WHERE p.state = 'available') AS pieces
        FROM offcuts o
        JOIN products pr ON pr."productId" = o.product_id AND pr.track_offcuts
        LEFT JOIN offcut_pieces p ON p.offcut_row_id = o."offcutId"
        WHERE o.quantity > 0 {prod_filter}
        GROUP BY o."offcutId"
    '''), params).fetchall()
    legacy_units = 0
    for r in rows:
        if r.pieces > r.quantity:
            size = f"{r.width:.0f}x{r.height:.0f}" if r.width else f"{r.length:.2f}"
            errors.append(f"offcut row {r.row_id} ({size}) has {r.pieces} available pieces "
                          f"but only {r.quantity} unit(s)")
        elif r.pieces < r.quantity:
            legacy_units += r.quantity - r.pieces
    if legacy_units:
        warnings.append(f"{legacy_units} pooled unit(s) predate the ledger (no piece yet - "
                        "one is minted when first used)")

    pfilter = " AND p.product_id = ANY(:pids)" if product_ids else ""
    phantoms = conn.execute(text(f'''
        SELECT p.piece_id, p.length, p.width, p.height, p.offcut_row_id
        FROM offcut_pieces p
        LEFT JOIN offcuts o ON o."offcutId" = p.offcut_row_id
        WHERE p.state = 'available' AND o."offcutId" IS NULL {pfilter}
    '''), params).fetchall()
    for p in phantoms:
        size = f"{p.width:.0f}x{p.height:.0f}" if p.width else f"{p.length:.2f}"
        errors.append(f"piece {p.piece_id} ({size}) is available but no pool row holds it")

    # ── ledger <-> its log ──────────────────────────────────────────────────
    ev_rows = conn.execute(text(f'''
        SELECT e.piece_id, e.event, e.item_id, e.payload
        FROM offcut_piece_events e JOIN offcut_pieces p USING (piece_id)
        WHERE TRUE {pfilter}
        ORDER BY e.piece_id, e.seq
    '''), params).fetchall()
    by_piece = defaultdict(list)
    for e in ev_rows:
        by_piece[e.piece_id].append({"event": e.event, "item_id": e.item_id, "payload": e.payload})
    cached = conn.execute(text(f'''
        SELECT p.piece_id, p.state, p.consumed_by_item_id FROM offcut_pieces p WHERE TRUE {pfilter}
    '''), params).fetchall()
    for c in cached:
        state, item = _fold(by_piece.get(c.piece_id, []))
        if state != c.state or (state == "consumed" and item != c.consumed_by_item_id):
            errors.append(f"piece {c.piece_id}: cached {c.state}/{c.consumed_by_item_id} but "
                          f"its events say {state}/{item}")

    # ── stock <-> journal ───────────────────────────────────────────────────
    base = {(b.table_name, b.row_pk): (b.quantity, b.after_journal_id)
            for b in conn.execute(text("SELECT table_name, row_pk, quantity, after_journal_id FROM stock_baseline"))}
    if base:
        start = min(v[1] for v in base.values())
        journal = conn.execute(text('''
            SELECT table_name, row_pk, action, before, after, id FROM stock_journal
            WHERE id > :start AND table_name IN ('variants', 'products') ORDER BY id
        '''), {"start": start}).fetchall()
        expected: Dict[tuple, float] = {k: v[0] for k, v in base.items()}
        for j in journal:
            key = (j.table_name, j.row_pk)
            if j.action == "insert":
                expected[key] = float((j.after or {}).get("stock_quantity") or 0)
            elif j.action == "update" and "stock_quantity" in (j.after or {}):
                if key in expected and j.id > base.get(key, (0, 0))[1]:
                    expected[key] += float(j.after["stock_quantity"] or 0) - float(j.before.get("stock_quantity") or 0)
            elif j.action == "delete":
                expected.pop(key, None)
        actual = {}
        for t, col in (("variants", '"variantId"'), ("products", '"productId"')):
            for r in conn.execute(text(f"SELECT {col}::text AS pk, stock_quantity FROM {t}")):
                actual[(t, r.pk)] = float(r.stock_quantity or 0)
        for key, want in expected.items():
            have = actual.get(key)
            if have is not None and abs(have - want) > 1e-6:
                errors.append(f"{key[0]} {key[1]}: stock is {have:g} but baseline + journal says {want:g}")

    # ── trace ───────────────────────────────────────────────────────────────
    if since_journal_id is not None:
        untraced = conn.execute(text('''
            SELECT count(*) FROM stock_journal WHERE id > :s AND op_id IS NULL
        '''), {"s": since_journal_id}).scalar()
        if untraced:
            errors.append(f"{untraced} journaled change(s) since {since_journal_id} ran outside any operation")

    # ── provisional offcuts (PROVISIONAL_OFFCUTS_PLAN.md) ────────────────────
    _check_provisional(db, conn, errors, prod_filter, params)

    return {"errors": errors, "warnings": warnings}


def _marks_of(value) -> list:
    """offcuts.provisional_for as read raw: a list on Postgres, JSON text on SQLite."""
    if isinstance(value, str):
        value = json.loads(value or "[]")
    return sorted(int(v) for v in (value or []))


def _check_provisional(db: Session, conn, errors: List[str], prod_filter: str, params: dict) -> None:
    """PROVISIONAL marks agree with the open windows and the ledger; no bar sits whole in the pool.

      - a mark names an OPEN sale window (a closed one must have been cleared)
      - switch off: no marks at all; switch on: no 1D row is held (they are marked instead)
      - a row's marks equal what its pieces' ancestry says (holdScope.marks_for_piece): the
        stored marks are a cache of that, refreshed on every write
      - no available piece is a whole bar drawn from stock sitting in the pool as an "offcut"
        (rejoins put a whole bar back in stock - the R1 bug, guarded here)
    """
    from core.inventory import holdScope
    from core.ordering.visibility import HELD
    from entities.offcutLedger import OffcutPiece, STATE_AVAILABLE

    rows = conn.execute(text(f'''
        SELECT o."offcutId" AS row_id, o.width, o.held_by_order_id, o.provisional_for
        FROM offcuts o WHERE o.quantity > 0 {prod_filter}
    '''), params).fetchall()
    on = holdScope.provisional_enabled(db)
    marked = {r.row_id: _marks_of(r.provisional_for) for r in rows}
    named = sorted({m for ms in marked.values() for m in ms})
    open_windows = set()
    if named:
        open_windows = {r[0] for r in conn.execute(text('''
            SELECT o."orderId" FROM orders o JOIN sale_windows w ON w.order_id = o."orderId"
            WHERE o.status = :held AND w.closed_at IS NULL
        '''), {"held": HELD})}
    for r in rows:
        marks = marked[r.row_id]
        if marks and not on:
            errors.append(f"offcut row {r.row_id} is marked provisional {marks} but provisional offcuts are off")
        stale = [m for m in marks if m not in open_windows]
        if stale:
            errors.append(f"offcut row {r.row_id} is marked provisional for {stale}, not an open sale window")
        if on and not r.width and r.held_by_order_id is not None:
            errors.append(f"offcut row {r.row_id} (1D) is held by order {r.held_by_order_id} with provisional offcuts on")

    if on:
        # Rows that should carry marks: those holding a descendant of a piece an open window
        # consumed, plus every row that does carry some. Each is re-derived from its pieces.
        held_claims = db.exec(select(OffcutPiece).where(OffcutPiece.state == "consumed",
                                                        OffcutPiece.consumed_by_order_id.in_(
                                                            select(Order.orderId).where(Order.status == HELD)))).all()
        candidates = {rid for rid, ms in marked.items() if ms}
        for claim in held_claims:
            for d in ledger_descendants(db, claim.piece_id):
                if d.state == STATE_AVAILABLE and d.offcut_row_id in marked:
                    candidates.add(d.offcut_row_id)
        for rid in sorted(candidates):
            pieces = db.exec(select(OffcutPiece).where(OffcutPiece.offcut_row_id == rid,
                                                       OffcutPiece.state == STATE_AVAILABLE)).all()
            if not pieces or any(p.width for p in pieces):
                continue
            derived = sorted({m for p in pieces for m in holdScope.marks_for_piece(db, p)})
            if derived != marked[rid]:
                errors.append(f"offcut row {rid}: marked provisional {marked[rid]} but its pieces depend on {derived}")

    pfilter = " AND p.product_id = ANY(:pids)" if prod_filter else ""
    for p in conn.execute(text(f'''
        SELECT p.piece_id, p.length, r.length AS bar FROM offcut_pieces p
        JOIN offcut_pieces r ON r.piece_id = p.root_piece_id
        WHERE p.state = 'available' AND p.geom_kind = '1d' AND r.origin = 'stock_unit'
          AND p.piece_id <> r.piece_id AND p.length >= r.length - 0.01 {pfilter}
    '''), params).fetchall():
        errors.append(f"piece {p.piece_id} is a whole {p.bar:g} bar sitting in the offcut pool - it belongs in stock")


def ledger_descendants(db: Session, piece_id: int) -> list:
    from core.inventory import offcutLedger as ledger
    return ledger.descendants(db, piece_id)


def journal_high_water(db: Session) -> int:
    return db.connection().execute(text("SELECT coalesce(max(id), 0) FROM stock_journal")).scalar()
