"""
Migration: Add cutting-completion tracking.

  - orderitems.cutting_completed     — BOOLEAN, defaults TRUE ("nothing to cut" or "done")
  - orderitems.cutting_completed_at  — TIMESTAMP, set only when explicitly marked done
  - offcuts.source_item_id           — which orderitems row produced this remainder
                                        (permanent provenance link, used to show a
                                        pending-source notice when a not-yet-cut item's
                                        predicted offcut gets consumed by another order)

All changes are additive/non-destructive. DEFAULT TRUE on cutting_completed means existing
historical orders never retroactively show up as needing a cutting report. Run from the
server directory:
    python migrate_add_cutting_status.py
"""

from sqlmodel import Session, text
from db.database import engine


def migrate():
    with Session(engine) as session:
        print("Adding orderitems.cutting_completed / cutting_completed_at...")
        for stmt in [
            "ALTER TABLE orderitems ADD COLUMN cutting_completed BOOLEAN DEFAULT TRUE",
            "ALTER TABLE orderitems ADD COLUMN cutting_completed_at TIMESTAMP DEFAULT NULL",
        ]:
            try:
                session.exec(text(stmt))
                session.commit()
                print(f"  OK: {stmt}")
            except Exception as e:
                print(f"  Skipped: {stmt} ({e})")
                session.rollback()

        print("Adding offcuts.source_item_id...")
        for stmt in [
            "ALTER TABLE offcuts ADD COLUMN source_item_id INTEGER DEFAULT NULL REFERENCES orderitems(item_id)",
            "CREATE INDEX IF NOT EXISTS ix_offcuts_source_item_id ON offcuts (source_item_id)",
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
