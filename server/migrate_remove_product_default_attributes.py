"""
Migration: Remove products.default_attributes — the per-attribute default
value picker was decided not worth keeping; nothing reads this column anymore.

Run from the server directory:
    python migrate_remove_product_default_attributes.py
"""

from sqlmodel import Session, text
from db.database import engine


def migrate():
    with Session(engine) as session:
        print("Dropping products.default_attributes...")
        try:
            session.exec(text('ALTER TABLE products DROP COLUMN IF EXISTS default_attributes'))
            session.commit()
            print("  Dropped.")
        except Exception as e:
            print(f"  Skipped: {e}")
            session.rollback()
        print("Migration complete.")


if __name__ == "__main__":
    migrate()
