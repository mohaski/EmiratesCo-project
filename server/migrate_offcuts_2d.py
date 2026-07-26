"""
Migration: Add 2D (glass) offcut support.

  - offcuts.width, offcuts.height  — rectangular dimensions for glass offcuts
  - offcuts.status                 — "available" | "scrap"
  - offcuts.length                 — relax to nullable-with-default (existing 1D
                                      bar/profile offcuts keep using it as before)
  - products.min_usable_dimension  — below this, a glass remainder is scrap
  - products.allow_rotation        — whether a cut piece may be rotated 90° to fit

All changes are additive/non-destructive. Run from the server directory:
    python migrate_offcuts_2d.py
"""

from sqlmodel import Session, text
from db.database import engine


def migrate():
    with Session(engine) as session:
        print("Adding offcuts.width / offcuts.height / offcuts.status...")
        for stmt in [
            "ALTER TABLE offcuts ADD COLUMN width FLOAT DEFAULT NULL",
            "ALTER TABLE offcuts ADD COLUMN height FLOAT DEFAULT NULL",
            "ALTER TABLE offcuts ADD COLUMN status VARCHAR DEFAULT 'available'",
            "ALTER TABLE offcuts ALTER COLUMN length SET DEFAULT 0.0",
        ]:
            try:
                session.exec(text(stmt))
                session.commit()
                print(f"  OK: {stmt}")
            except Exception as e:
                print(f"  Skipped: {stmt} ({e})")
                session.rollback()

        print("Adding products.min_usable_dimension / products.allow_rotation...")
        for stmt in [
            "ALTER TABLE products ADD COLUMN min_usable_dimension FLOAT DEFAULT 0.5",
            "ALTER TABLE products ADD COLUMN allow_rotation BOOLEAN DEFAULT TRUE",
        ]:
            try:
                session.exec(text(stmt))
                session.commit()
                print(f"  OK: {stmt}")
            except Exception as e:
                print(f"  Skipped: {stmt} ({e})")
                session.rollback()

        print("Migration complete.")


if __name__ == "__main__":
    migrate()
