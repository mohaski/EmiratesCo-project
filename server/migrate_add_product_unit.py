"""
Migration: Add products.unit — the measurement unit label (e.g. "ft", "mm",
"pcs") used to display this product's dimensions and per-unit pricing.

Run from the server directory:
    python migrate_add_product_unit.py
"""

from sqlmodel import Session, text
from db.database import engine


def migrate():
    with Session(engine) as session:
        print("Adding products.unit...")
        try:
            session.exec(text("ALTER TABLE products ADD COLUMN unit VARCHAR DEFAULT 'ft'"))
            session.commit()
            print("  Added.")
        except Exception as e:
            print(f"  Skipped: {e}")
            session.rollback()
        print("Migration complete.")


if __name__ == "__main__":
    migrate()
