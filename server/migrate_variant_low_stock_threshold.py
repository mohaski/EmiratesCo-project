"""
Migration: Add variants.low_stock_threshold — the CEO-configured per-variant
low-stock alarm (0 = no alarm). Replaces the old product-level alarm_quantity
as the source of the Stock Control "low stock" indicator, which is now shown
per variant instead of per product.

Also resets any row still sitting on the column's old (pre-this-feature)
default of 10.0 back to 0 — those values were never CEO-configured through
any UI (the field was unwired until this feature shipped), so they're stale
defaults, not real settings, and left alone they'd falsely flag most
0-stock variants as "low stock" everywhere on Stock Control.

Run from the server directory:
    python migrate_variant_low_stock_threshold.py
"""

from sqlmodel import Session, text
from db.database import engine


def migrate():
    with Session(engine) as session:
        print("Adding variants.low_stock_threshold...")
        try:
            session.exec(text("ALTER TABLE variants ADD COLUMN IF NOT EXISTS low_stock_threshold FLOAT DEFAULT 0"))
            session.exec(text("ALTER TABLE variants ALTER COLUMN low_stock_threshold SET DEFAULT 0"))
            session.exec(text("UPDATE variants SET low_stock_threshold = 0 WHERE low_stock_threshold IS NULL OR low_stock_threshold = 10.0"))
            session.commit()
            print("  Added.")
        except Exception as e:
            print(f"  Skipped: {e}")
            session.rollback()
        print("Migration complete.")


if __name__ == "__main__":
    migrate()
