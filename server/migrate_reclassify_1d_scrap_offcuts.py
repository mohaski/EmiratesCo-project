"""
Migration: Reclassify existing 1D (bar/profile) offcuts as scrap where they
fall below their variant's min_usable threshold.

inventoryService._is_scrap_1d (added alongside the min_usable rename) only
applies to offcuts created going forward — every 1D remainder created before
that change was unconditionally "available", regardless of size. This
one-time backfill reclassifies the pre-existing rows so a cashier's "Choose
Offcuts" list stops offering slivers too short to actually use (see
glassOffcutService._is_scrap for the 2D equivalent, which has always applied
retroactively since offcuts.status existed from the start there).

Only touches offcuts whose variant_id is known (the vast majority — every
_upsert_offcut call records it); a handful of legacy rows with no variant_id
are left for manual review since there's no reliable single threshold to
judge them by.

Run from the server directory:
    python migrate_reclassify_1d_scrap_offcuts.py
"""

from sqlmodel import Session, text
from db.database import engine


def migrate():
    with Session(engine) as session:
        print("Reclassifying under-threshold 1D offcuts as scrap...")
        try:
            result = session.exec(text("""
                UPDATE offcuts o
                SET status = 'scrap'
                FROM variants v, products p
                WHERE o.variant_id = v."variantId"
                  AND o.product_id = p."productId"
                  AND p.has_dimensions = false
                  AND o.status = 'available'
                  AND o.length < v.min_usable
            """))
            session.commit()
            print(f"  Reclassified {result.rowcount} offcut(s).")
        except Exception as e:
            print(f"  Skipped: {e}")
            session.rollback()

        skipped = session.exec(text("""
            SELECT count(*) FROM offcuts o
            JOIN products p ON o.product_id = p."productId"
            WHERE p.has_dimensions = false AND o.status = 'available' AND o.variant_id IS NULL
        """)).first()
        if skipped and skipped[0]:
            print(f"  Note: {skipped[0]} legacy offcut(s) with no variant_id were left untouched (manual review).")
        print("Migration complete.")


if __name__ == "__main__":
    migrate()
