"""
Migration: Move glass (2D) offcut tuning from Product to Variant granularity —
adds variants.min_usable_dimension, variants.allow_rotation, variants.popular_size_ranges.
Different sheet sizes/thicknesses of the same product can now be tuned independently
instead of sharing one product-wide setting (see glassOffcutService.py).

Backfills each variant from its parent product's current (soon-to-be-unused)
product-level columns, so any glass product already tuned at the product level
carries that tuning down to its variants rather than silently resetting to defaults.

Run from the server directory:
    python migrate_variant_glass_tuning.py
"""

from sqlmodel import Session, text
from db.database import engine


def migrate():
    with Session(engine) as session:
        print("Adding variants glass-tuning columns...")
        try:
            session.exec(text("ALTER TABLE variants ADD COLUMN IF NOT EXISTS min_usable_dimension FLOAT DEFAULT 150.0"))
            session.exec(text("ALTER TABLE variants ADD COLUMN IF NOT EXISTS allow_rotation BOOLEAN DEFAULT TRUE"))
            session.exec(text("ALTER TABLE variants ADD COLUMN IF NOT EXISTS popular_size_ranges JSON DEFAULT '[]'"))
            session.exec(text("""
                UPDATE variants v
                SET min_usable_dimension = p.min_usable_dimension,
                    allow_rotation = p.allow_rotation,
                    popular_size_ranges = p.popular_size_ranges
                FROM products p
                WHERE v.product_id = p."productId" AND p.has_dimensions = true
            """))
            session.commit()
            print("  Added.")
        except Exception as e:
            print(f"  Skipped: {e}")
            session.rollback()
        print("Migration complete.")


if __name__ == "__main__":
    migrate()
