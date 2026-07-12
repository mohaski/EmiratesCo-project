"""
Migration: Add variants.unit_quantity — the numeric quantity carried by a
"custom" attribute value (e.g. 1000 for a "1000pcs" Unit value), stored
separately from the display string which stays in variants.attributes.

Run from the server directory:
    python migrate_variant_unit_quantity.py
"""

from sqlmodel import Session, text
from db.database import engine


def migrate():
    with Session(engine) as session:
        print("Adding variants.unit_quantity...")
        try:
            session.exec(text("ALTER TABLE variants ADD COLUMN unit_quantity FLOAT DEFAULT NULL"))
            session.commit()
            print("  Added.")
        except Exception as e:
            print(f"  Skipped: {e}")
            session.rollback()
        print("Migration complete.")


if __name__ == "__main__":
    migrate()
