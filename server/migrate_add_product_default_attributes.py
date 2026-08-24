"""
Migration: Add products.default_attributes back — the CEO-chosen default value
per attribute class (e.g. {"Color": "White"}), used by ManageVariantsModal to
pre-select the sales-modal calculators instead of them defaulting to whichever
value happens to sort first.

Run from the server directory:
    python migrate_add_product_default_attributes.py
"""

from sqlmodel import Session, text
from db.database import engine


def migrate():
    with Session(engine) as session:
        print("Adding products.default_attributes...")
        try:
            session.exec(text('ALTER TABLE products ADD COLUMN IF NOT EXISTS default_attributes JSON'))
            session.commit()
            print("  Added.")
        except Exception as e:
            print(f"  Skipped: {e}")
            session.rollback()
        print("Migration complete.")


if __name__ == "__main__":
    migrate()
