"""
Migration: Rename variants.min_usable_dimension -> variants.min_usable, and
extend it from a 2D (glass) -only concept to 1D (bar/profile) products too —
see inventoryService._is_scrap_1d, now wired into the bar-cutting remainder
logic the same way glassOffcutService._is_scrap already works for glass.

Backfills every variant belonging to a 1D (has_dimensions=False) product that
still sits on the untouched old universal default of 150 (a glass-oriented mm
value that was never CEO-configured for a bar/profile product, since there
was no UI for it there before now) to the new 1D default of 2 (feet).

Run from the server directory:
    python migrate_variant_min_usable_rename.py
"""

from sqlmodel import Session, text
from db.database import engine


def migrate():
    with Session(engine) as session:
        print("Renaming variants.min_usable_dimension -> variants.min_usable...")
        try:
            session.exec(text(
                'ALTER TABLE variants RENAME COLUMN min_usable_dimension TO min_usable'
            ))
            session.commit()
            print("  Renamed.")
        except Exception as e:
            print(f"  Skipped rename: {e}")
            session.rollback()

        print("Backfilling 1D (bar/profile) variants still on the untouched 150 default to 2...")
        try:
            session.exec(text("""
                UPDATE variants v
                SET min_usable = 2
                FROM products p
                WHERE v.product_id = p."productId"
                  AND p.has_dimensions = false
                  AND v.min_usable = 150
            """))
            session.commit()
            print("  Backfilled.")
        except Exception as e:
            print(f"  Skipped backfill: {e}")
            session.rollback()
        print("Migration complete.")


if __name__ == "__main__":
    migrate()
