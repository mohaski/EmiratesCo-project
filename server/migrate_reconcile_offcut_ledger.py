"""
Reconcile the offcut ledger against the pooled `offcuts` table.

Run this after ANY change made to `offcuts` outside the application — a pgAdmin delete, a
hand-written UPDATE, a restore from backup. Application code keeps the two in step
(safe_delete_offcut detaches, the engines retire and mint as they cut), but a direct SQL
statement cannot be intercepted by anything in Python, so the ledger is left describing
material that is no longer in the pool.

WHY IT MATTERS
--------------
The invariant the reversal resolver relies on is: an `available` piece means a real physical
piece sitting in the pool. A piece left `available` after its pooled row was deleted breaks
that — offcutResolver would see a cut's remainder as intact and conclude the whole bar can
be handed back, crediting stock that does not exist. That is the same over-crediting bug the
ledger was built to stop, arriving by a different route.

WHAT IT DOES
------------
Retires every `available` piece whose `offcut_row_id` points at a row that no longer exists.
Retiring (not deleting) keeps the piece and its history, so any chain running through it
still reads correctly — it simply stops counting as material.

Deliberately conservative. It does NOT touch:
  - pieces whose row still exists (those are checked and reported, never changed)
  - pieces with a NULL row pointer, which is the normal state for a piece whose row was
    consumed down to nothing through the app; matching those back by geometry would be
    guesswork of exactly the kind the ledger exists to replace
  - anything about `offcuts` itself

    python migrate_reconcile_offcut_ledger.py --dry-run   # report only
    python migrate_reconcile_offcut_ledger.py             # apply
"""
import sys

from sqlmodel import Session, select, text

from db.database import engine

import entities  # noqa: F401 — registers every table on SQLModel.metadata
from entities.offcutLedger import STATE_AVAILABLE, OffcutPiece

from core.inventory import offcutLedger as ledger

ORPHANS = text('''
    SELECT p.piece_id
    FROM offcut_pieces p
    LEFT JOIN offcuts o ON p.offcut_row_id = o."offcutId"
    WHERE p.state = 'available'
      AND p.offcut_row_id IS NOT NULL
      AND o."offcutId" IS NULL
    ORDER BY p.piece_id
''')

BUCKETS = text('''
    SELECT CASE WHEN p.offcut_row_id IS NULL THEN 'no row pointer (normal)'
                WHEN o."offcutId" IS NULL   THEN 'row deleted outside the app'
                ELSE 'row exists' END AS bucket,
           count(*)
    FROM offcut_pieces p
    LEFT JOIN offcuts o ON p.offcut_row_id = o."offcutId"
    WHERE p.state = 'available'
    GROUP BY 1 ORDER BY 2 DESC
''')

# Rows projecting more units than the ledger has pieces for. Not repaired here:
# claim_available_piece already bootstraps an identity the first time such a row is cut, so
# this is reported for visibility rather than fixed.
UNDER_COVERED = text('''
    SELECT count(*) FROM (
        SELECT o."offcutId", o.quantity, count(p.piece_id) AS pieces
        FROM offcuts o
        LEFT JOIN offcut_pieces p
          ON p.offcut_row_id = o."offcutId" AND p.state = 'available'
        GROUP BY o."offcutId", o.quantity
        HAVING count(p.piece_id) < o.quantity
    ) t
''')

OVER_COVERED = text('''
    SELECT count(*) FROM (
        SELECT o."offcutId", o.quantity, count(p.piece_id) AS pieces
        FROM offcuts o
        LEFT JOIN offcut_pieces p
          ON p.offcut_row_id = o."offcutId" AND p.state = 'available'
        GROUP BY o."offcutId", o.quantity
        HAVING count(p.piece_id) > o.quantity
    ) t
''')


def reconcile(dry_run: bool) -> None:
    with Session(engine) as session:
        print("Available ledger pieces, by whether their pooled row is still there:")
        for bucket, count in session.exec(BUCKETS).all():
            print(f"   {bucket:32s} {count}")

        under = session.exec(UNDER_COVERED).first()
        over = session.exec(OVER_COVERED).first()
        print(f"\nPooled rows with FEWER ledger pieces than units: "
              f"{under[0] if under else 0}  (self-heals on first cut)")
        print(f"Pooled rows with MORE ledger pieces than units : "
              f"{over[0] if over else 0}  (should be 0)")

        orphan_ids = [row[0] for row in session.exec(ORPHANS).all()]
        print(f"\nAvailable pieces whose pooled row was deleted outside the app: {len(orphan_ids)}")

        if not orphan_ids:
            print("\nNothing to reconcile.")
            return
        if dry_run:
            print(f"\n--dry-run: would retire {len(orphan_ids)} piece(s); nothing written.")
            return

        retired = 0
        for piece_id in orphan_ids:
            piece = session.get(OffcutPiece, piece_id)
            if piece is None or piece.state != STATE_AVAILABLE:
                continue
            ledger.retire_piece(
                session, piece,
                reason="reconcile: pooled offcut row was deleted outside the application",
            )
            retired += 1
            if retired % 250 == 0:
                session.commit()
        session.commit()

        print(f"Retired {retired} stale piece(s).")
        print("\nAfter reconciling:")
        for bucket, count in session.exec(BUCKETS).all():
            print(f"   {bucket:32s} {count}")


if __name__ == "__main__":
    reconcile(dry_run="--dry-run" in set(sys.argv[1:]))
