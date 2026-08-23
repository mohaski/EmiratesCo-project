"""
Migration: Remove the deprecated product-level offcut-tuning columns —
products.min_usable_dimension, products.allow_rotation, products.popular_size_ranges.
These were superseded when offcut tuning moved to per-variant granularity
(see migrate_variant_glass_tuning.py) and have been write-only dead columns
ever since: nothing reads them anymore, only Variant.min_usable/allow_rotation/
popular_size_ranges do.

Run from the server directory:
    python migrate_remove_product_offcut_tuning.py
"""

from sqlmodel import Session, text
from db.database import engine


def migrate():
    with Session(engine) as session:
        print("Dropping deprecated products offcut-tuning columns...")
        try:
            session.exec(text('ALTER TABLE products DROP COLUMN IF EXISTS min_usable_dimension'))
            session.exec(text('ALTER TABLE products DROP COLUMN IF EXISTS allow_rotation'))
            session.exec(text('ALTER TABLE products DROP COLUMN IF EXISTS popular_size_ranges'))
            session.commit()
            print("  Dropped.")
        except Exception as e:
            print(f"  Skipped: {e}")
            session.rollback()
        print("Migration complete.")


if __name__ == "__main__":
    migrate()
