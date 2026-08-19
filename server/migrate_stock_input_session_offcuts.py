"""
Migration: stock_input_session_items gains offcut-line support.

Stock Control's batch-finalize feature originally only recorded restock lines.
It now also lets a manager add manually-entered offcuts to the same cart and
finalize both together (see core/inventory/stockSessions/service.py) — each
row is tagged `line_type` ('restock' | 'offcut'), and offcut rows populate a
new set of columns instead of stock_before/stock_after (which no longer apply
to them, so those two become nullable).

create_db_and_tables() only creates missing tables, never alters an existing
one — since stock_input_session_items was already created by an earlier
restart under the old (restock-only) schema, it needs this one-off ALTER
rather than a fresh create_all().

Run from the server directory:
    python migrate_stock_input_session_offcuts.py
"""
from sqlalchemy import text

from db.database import engine


def _has_column(conn, table: str, column: str) -> bool:
    row = conn.execute(text(
        "SELECT 1 FROM information_schema.columns WHERE table_name=:t AND column_name=:c"
    ), {"t": table, "c": column}).fetchone()
    return row is not None


def migrate():
    with engine.connect() as conn:
        if _has_column(conn, "stock_input_session_items", "line_type"):
            print("stock_input_session_items already has line_type — nothing to migrate.")
            return

        print("Adding line_type + offcut columns to stock_input_session_items...")
        conn.execute(text(
            "ALTER TABLE stock_input_session_items "
            "ADD COLUMN line_type VARCHAR NOT NULL DEFAULT 'restock'"
        ))
        conn.execute(text(
            "CREATE INDEX IF NOT EXISTS ix_stock_input_session_items_line_type "
            "ON stock_input_session_items (line_type)"
        ))
        conn.execute(text(
            "ALTER TABLE stock_input_session_items ALTER COLUMN stock_before DROP NOT NULL"
        ))
        conn.execute(text(
            "ALTER TABLE stock_input_session_items ALTER COLUMN stock_after DROP NOT NULL"
        ))
        conn.execute(text(
            "ALTER TABLE stock_input_session_items ADD COLUMN offcut_length DOUBLE PRECISION"
        ))
        conn.execute(text(
            "ALTER TABLE stock_input_session_items ADD COLUMN offcut_width DOUBLE PRECISION"
        ))
        conn.execute(text(
            "ALTER TABLE stock_input_session_items ADD COLUMN offcut_height DOUBLE PRECISION"
        ))
        conn.execute(text(
            "ALTER TABLE stock_input_session_items ADD COLUMN offcut_quantity INTEGER"
        ))
        conn.execute(text(
            "ALTER TABLE stock_input_session_items ADD COLUMN created_offcut_id INTEGER "
            'REFERENCES offcuts("offcutId")'
        ))
        conn.commit()
        print("Done.")

    print("\nMigration complete.")


if __name__ == "__main__":
    migrate()
