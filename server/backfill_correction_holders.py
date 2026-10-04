"""
Name the order item holding material a manager correction took, for corrections made before
the corrections recorded it (2026-10-03).

Until then a correction's replacement source - the offcut/sheet/bar it re-cut a piece from -
was consumed in the ledger with no item. Stock was right, and the order's own edit/cancel was
right (it reads the piece from its own offcut_sources), but any OTHER order whose leftover that
replacement used could not name who held it: its edit/cancel asked "Confirm whether the cutting
has been done for: order #None's ... cut" and could not be answered.

For each consumed piece with no holder that exactly ONE line of a live order names as the source
it consumed (offcut_sources[].source_piece_id, owning event), this fills in the holder on the
piece and on its `consumed` event - the denormalized columns that event's own consumption
determines. Pieces named by no line or by several are left alone and listed.

Runs as one maintenance operation, in one transaction, and refuses to commit if the
consistency check reports any error afterwards.

    python backfill_correction_holders.py --dry-run
    python backfill_correction_holders.py
    python backfill_correction_holders.py --db <copy of the database>
"""
import sys

from sqlmodel import Session, create_engine, select

import entities  # noqa: F401
from config import settings
from core.audit import integrity
from core.audit.opContext import operation
from entities.offcutLedger import OffcutPiece, OffcutPieceEvent
from entities.opJournal import OP_MAINTENANCE
from entities.orderItems import OrderItem
from entities.orders import Order


def main():
    dry = "--dry-run" in sys.argv
    url = settings.get_database_url()
    if "--db" in sys.argv:
        url = url.rpartition("/")[0] + "/" + sys.argv[sys.argv.index("--db") + 1]
    engine = create_engine(url)

    with Session(engine) as db:
        unheld = {p.piece_id: p for p in db.exec(select(OffcutPiece).where(
            OffcutPiece.state == "consumed", OffcutPiece.consumed_by_item_id.is_(None))).all()}
        owners: dict = {}
        for it in db.exec(select(OrderItem)).all():
            order = db.get(Order, it.order_id)
            if order is None or order.status == "cancelled":
                continue
            for line in (it.details or {}).get("lineItems") or []:
                if not isinstance(line, dict):
                    continue
                for ev in line.get("offcut_sources") or []:
                    pid = ev.get("source_piece_id") if isinstance(ev, dict) else None
                    if pid in unheld and ev.get("owns_consumption", True):
                        owners.setdefault(pid, set()).add((it.order_id, it.item_id))

        fixed, skipped = [], []
        with operation(db, OP_MAINTENANCE, notes="backfill_correction_holders"):
            for pid, piece in sorted(unheld.items()):
                found = owners.get(pid) or set()
                if len(found) != 1:
                    skipped.append((pid, sorted(found)))
                    continue
                order_id, item_id = next(iter(found))
                consumed = db.exec(select(OffcutPieceEvent).where(
                    OffcutPieceEvent.piece_id == pid, OffcutPieceEvent.event == "consumed")
                    .order_by(OffcutPieceEvent.seq.desc())).first()
                if consumed is None or consumed.item_id is not None:
                    skipped.append((pid, f"consumed event {'missing' if consumed is None else 'already names an item'}"))
                    continue
                piece.consumed_by_item_id, piece.consumed_by_order_id = item_id, order_id
                consumed.item_id, consumed.order_id = item_id, order_id
                db.add(piece)
                db.add(consumed)
                fixed.append((pid, order_id, item_id))
            db.flush()
            errors = integrity.check(db)["errors"]

        for pid, order_id, item_id in fixed:
            print(f"  piece {pid}: held by order #{order_id} item {item_id}")
        for pid, why in skipped:
            print(f"  piece {pid}: left alone ({why})")
        print(f"{len(fixed)} piece(s) given their holder, {len(skipped)} left alone")
        if errors:
            db.rollback()
            print("consistency check failed - nothing written:")
            for e in errors:
                print("  ", e)
            sys.exit(1)
        if dry:
            db.rollback()
            print("dry run - nothing written")
        else:
            db.commit()
            print("committed")


if __name__ == "__main__":
    main()
