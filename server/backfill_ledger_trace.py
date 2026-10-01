"""
Fill in what the offcut ledger can still recover about its own past, and retire phantoms.

Runs as one maintenance operation (so everything it changes is itself journaled and traced),
in one transaction:

  1. events.order_id    from the item the event names, where that item still exists
  2. created events     order_id from the piece's own producing order
  3. restore credits    produced_by_item/order from the reversal that minted them: a credit is
                        minted in the same instant its parent is retired by that reversal, and
                        the parent's retire event names the item
  4. phantom pieces     `available` pieces with no pool row behind them are retired - the
                        material is gone (e.g. deleted in Offcut Management before that
                        endpoint updated the ledger)
  5. surplus pieces     a pool row with more available pieces than units: the extra pieces
                        are retired, pre-ledger ones first so pieces with a history are kept

What stays empty is genuinely unknown: an offcut entered before the ledger has no recorded
producer, a 1D piece has no width, a piece on the shelf has no consumer.

The event log is otherwise append-only; steps 1-2 only fill a denormalized column that the
event's own item already determines.

    python backfill_ledger_trace.py --dry-run
    python backfill_ledger_trace.py
    python backfill_ledger_trace.py --db emiratesco_edit_test
"""
import sys
from datetime import timedelta

from sqlmodel import Session, create_engine, select, text

import entities  # noqa: F401
from config import settings
from core.audit.opContext import operation
from core.inventory import offcutLedger as ledger
from entities.offcutLedger import OffcutPiece, OffcutPieceEvent
from entities.opJournal import OP_MAINTENANCE


def main():
    dry = "--dry-run" in sys.argv
    url = settings.get_database_url()
    if "--db" in sys.argv:
        url = url.rpartition("/")[0] + "/" + sys.argv[sys.argv.index("--db") + 1]
    engine = create_engine(url)

    with Session(engine) as db:
        with operation(db, OP_MAINTENANCE, notes="backfill_ledger_trace"):
            conn = db.connection()
            n1 = conn.execute(text('''
                UPDATE offcut_piece_events e SET order_id = i.order_id
                FROM orderitems i WHERE e.order_id IS NULL AND e.item_id = i.item_id
            ''')).rowcount
            n2 = conn.execute(text('''
                UPDATE offcut_piece_events e SET order_id = p.produced_by_order_id
                FROM offcut_pieces p
                WHERE e.piece_id = p.piece_id AND e.order_id IS NULL AND e.event = 'created'
                  AND p.produced_by_order_id IS NOT NULL
            ''')).rowcount
            print(f"1. events given their order from the item: {n1}")
            print(f"2. created events given the producing order: {n2}")

            n3 = 0
            credits = db.exec(select(OffcutPiece).where(
                OffcutPiece.origin == ledger.ORIGIN_RESTORE_CREDIT,
                OffcutPiece.produced_by_item_id.is_(None),
                OffcutPiece.parent_piece_id.is_not(None),
            )).all()
            for piece in credits:
                ev = db.exec(select(OffcutPieceEvent).where(
                    OffcutPieceEvent.piece_id == piece.parent_piece_id,
                    OffcutPieceEvent.event == ledger.EVENT_RETIRED,
                    OffcutPieceEvent.item_id.is_not(None),
                    OffcutPieceEvent.at >= piece.produced_at - timedelta(seconds=5),
                    OffcutPieceEvent.at <= piece.produced_at + timedelta(seconds=5),
                )).first()
                if ev is None:
                    continue
                parent = db.get(OffcutPiece, piece.parent_piece_id)
                piece.produced_by_item_id = ev.item_id
                piece.produced_by_order_id = ev.order_id or (parent.consumed_by_order_id if parent else None)
                db.add(piece)
                conn.execute(text('''
                    UPDATE offcut_piece_events SET item_id = :i, order_id = :o
                    WHERE piece_id = :p AND event = 'created' AND item_id IS NULL
                '''), {"i": ev.item_id, "o": piece.produced_by_order_id, "p": piece.piece_id})
                n3 += 1
            print(f"3. restore credits linked to the reversal that made them: {n3} of {len(credits)}")

            phantoms = db.exec(text('''
                SELECT p.piece_id FROM offcut_pieces p
                LEFT JOIN offcuts o ON o."offcutId" = p.offcut_row_id
                WHERE p.state = 'available' AND o."offcutId" IS NULL ORDER BY p.piece_id
            ''')).all()
            relinked = retired = 0
            for (pid,) in phantoms:
                piece = db.get(OffcutPiece, pid)
                # Before declaring it gone: a same-size row in the same pool with a unit no piece
                # accounts for is this piece's material under a row id the pointer lost track
                # of. Re-link it rather than retire real stock.
                row = conn.execute(text('''
                    SELECT o."offcutId" FROM offcuts o
                    WHERE o.product_id = :pr AND o.pool_key = :pk AND o.quantity > 0
                      AND ((:w IS NULL AND o.width IS NULL AND abs(o.length - :l) <= 0.01)
                           OR (:w IS NOT NULL AND abs(o.width - :w) <= 2 AND abs(o.height - :h) <= 2))
                      AND o.quantity > (SELECT count(*) FROM offcut_pieces q
                                        WHERE q.offcut_row_id = o."offcutId" AND q.state = 'available')
                    ORDER BY o."offcutId" LIMIT 1
                '''), {"pr": piece.product_id, "pk": piece.pool_key, "w": piece.width,
                        "h": piece.height, "l": piece.length}).scalar()
                if row is not None:
                    piece.offcut_row_id = row
                    db.add(piece)
                    db.flush()
                    relinked += 1
                    continue
                ledger.retire_piece(db, piece,
                                    reason="reconcile: no pool row holds this piece - the material is gone")
                retired += 1
            print(f"4. phantom pieces: {relinked} re-linked to their pool row, {retired} retired")

            surplus = db.exec(text('''
                SELECT o."offcutId", o.quantity FROM offcuts o
                JOIN offcut_pieces p ON p.offcut_row_id = o."offcutId" AND p.state = 'available'
                GROUP BY o."offcutId" HAVING count(*) > o.quantity
            ''')).all()
            n5 = 0
            for row_id, qty in surplus:
                pieces = db.exec(select(OffcutPiece).where(
                    OffcutPiece.offcut_row_id == row_id, OffcutPiece.state == "available",
                )).all()
                # keep the pieces with the most history: pre-ledger ones go first, newest first
                pieces.sort(key=lambda p: (p.origin != ledger.ORIGIN_LEGACY, p.produced_at), reverse=False)
                extra = len(pieces) - int(qty)
                for p in pieces[:extra]:
                    ledger.retire_piece(db, p, reason=f"reconcile: pool row {row_id} holds only {qty} unit(s)")
                    n5 += 1
            print(f"5. surplus pieces retired: {n5}")

        if dry:
            db.rollback()
            print("dry run - nothing written")
        else:
            db.commit()
            print("committed")


if __name__ == "__main__":
    main()
