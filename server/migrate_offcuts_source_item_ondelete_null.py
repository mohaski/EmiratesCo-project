"""
Migration: offcuts.source_item_id FK -> ON DELETE SET NULL.

Editing an order deletes its old OrderItem rows and recreates them. A pooled/
scrap Offcut row can outlive the item that last produced it (restore only
decrements its quantity when other unrelated cuts still own the rest of it),
leaving offcuts.source_item_id dangling at an item that's about to be
deleted. The FK previously had no ON DELETE behavior (defaults to RESTRICT),
so Postgres blocked the delete outright — see orderService.update_order's
"Error editing order N: ForeignKeyViolation ... offcuts_source_item_id_fkey".

source_item_id is provenance/advisory metadata only (drives the "still
awaiting cutting" notice) — never load-bearing for stock accounting — so
auto-nulling it when its OrderItem is deleted is safe. orderService.py now
also proactively nulls it before deleting old items on an edit; this
constraint change is defense-in-depth for any other/future deletion path.

Also nulls out any currently-dangling rows caused by this bug so far.

Run from the server directory:
    python migrate_offcuts_source_item_ondelete_null.py
"""

from sqlmodel import Session, text
from db.database import engine


def migrate():
    with Session(engine) as session:
        print("Altering offcuts_source_item_id_fkey to ON DELETE SET NULL...")
        try:
            session.exec(text(
                "ALTER TABLE offcuts DROP CONSTRAINT offcuts_source_item_id_fkey"
            ))
            session.exec(text("""
                ALTER TABLE offcuts
                ADD CONSTRAINT offcuts_source_item_id_fkey
                FOREIGN KEY (source_item_id) REFERENCES orderitems(item_id)
                ON DELETE SET NULL
            """))
            session.commit()
            print("  Constraint updated.")
        except Exception as e:
            print(f"  Skipped: {e}")
            session.rollback()

        print("Clearing any currently-dangling source_item_id references...")
        try:
            result = session.exec(text("""
                UPDATE offcuts o
                SET source_item_id = NULL
                WHERE o.source_item_id IS NOT NULL
                  AND NOT EXISTS (
                      SELECT 1 FROM orderitems oi WHERE oi.item_id = o.source_item_id
                  )
            """))
            session.commit()
            print(f"  Cleared {result.rowcount} dangling row(s).")
        except Exception as e:
            print(f"  Skipped: {e}")
            session.rollback()
        print("Migration complete.")


if __name__ == "__main__":
    migrate()
