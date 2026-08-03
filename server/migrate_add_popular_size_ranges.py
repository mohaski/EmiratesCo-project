"""
Migration: Add CEO-configured "popular size" ranges for glass products.

  - products.popular_size_ranges — JSON, defaults to '[]'
      List of {"min_w","max_w","min_h","max_h"} bands (mm, canonical wide/narrow).
      Drives the small-offcut-first / protect-popular-or-larger tiering in
      glassOffcutService.py's _fulfill_pool (see _meets_popular_threshold).

Backfills every existing has_dimensions=True (glass) product with one range —
min_w=500, max_w=650, min_h=1020, max_h=1150 — per explicit instruction, so the
new tiering has real data to work with immediately instead of every existing
product silently falling back to "no ranges configured" behavior.

Additive/non-destructive. Run from the server directory:
    python migrate_add_popular_size_ranges.py
"""

import json

from sqlmodel import Session, text
from db.database import engine

BACKFILL_RANGE = {"min_w": 500, "max_w": 650, "min_h": 1020, "max_h": 1150}


def migrate():
    with Session(engine) as session:
        print("Adding products.popular_size_ranges...")
        try:
            session.exec(text("ALTER TABLE products ADD COLUMN popular_size_ranges JSON DEFAULT '[]'"))
            session.commit()
            print("  OK: products.popular_size_ranges added")
        except Exception as e:
            print(f"  Skipped: ({e})")
            session.rollback()

        print(f"Backfilling has_dimensions=True products with {BACKFILL_RANGE}...")
        result = session.exec(
            text(
                "UPDATE products SET popular_size_ranges = :ranges "
                "WHERE has_dimensions = TRUE "
                "AND (popular_size_ranges IS NULL OR popular_size_ranges::text = '[]')"
            ),
            params={"ranges": json.dumps([BACKFILL_RANGE])},
        )
        session.commit()
        print(f"  Updated {result.rowcount} product(s).")

        print("Migration complete.")


if __name__ == "__main__":
    migrate()
