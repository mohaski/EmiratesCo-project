"""
Operation journal + ledger trace columns (see entities/opJournal.py).

  - creates stock_operations, stock_journal, stock_baseline
  - adds offcut_piece_events.op_id / from_state and offcut_pieces.produced_by_op_id
  - snapshots every variant/product stock counter into stock_baseline (once), so the
    integrity check can prove current stock == baseline + journaled deltas from here on

Idempotent: safe to run again, and on the test database.

    python migrate_op_journal.py                          # the app's database
    python migrate_op_journal.py --db emiratesco_edit_test
"""
import sys

from sqlmodel import SQLModel, create_engine, text

import entities  # noqa: F401 - registers every table
from config import settings
from entities.opJournal import JournalEntry, StockBaseline, StockOperation


def engine_for(db_name=None):
    url = settings.get_database_url()
    if db_name:
        base, _, _ = url.rpartition("/")
        url = f"{base}/{db_name}"
    return create_engine(url, echo=False)


DDL = [
    "ALTER TABLE offcut_piece_events ADD COLUMN IF NOT EXISTS op_id VARCHAR(32)",
    "ALTER TABLE offcut_piece_events ADD COLUMN IF NOT EXISTS from_state VARCHAR",
    "CREATE INDEX IF NOT EXISTS ix_offcut_piece_events_op_id ON offcut_piece_events (op_id)",
    "ALTER TABLE offcut_pieces ADD COLUMN IF NOT EXISTS produced_by_op_id VARCHAR(32)",
    "CREATE INDEX IF NOT EXISTS ix_offcut_pieces_produced_by_op_id ON offcut_pieces (produced_by_op_id)",
]


def main():
    db_name = sys.argv[sys.argv.index("--db") + 1] if "--db" in sys.argv else None
    engine = engine_for(db_name)
    SQLModel.metadata.create_all(engine, tables=[
        StockOperation.__table__, JournalEntry.__table__, StockBaseline.__table__,
    ])
    with engine.begin() as conn:
        for stmt in DDL:
            conn.execute(text(stmt))
        has_baseline = conn.execute(text("SELECT count(*) FROM stock_baseline")).scalar()
        if not has_baseline:
            last = conn.execute(text("SELECT coalesce(max(id), 0) FROM stock_journal")).scalar()
            conn.execute(text(
                'INSERT INTO stock_baseline (table_name, row_pk, quantity, taken_at, after_journal_id) '
                'SELECT \'variants\', "variantId"::text, coalesce(stock_quantity, 0), now() at time zone \'utc\', :last FROM variants'
            ), {"last": last})
            conn.execute(text(
                'INSERT INTO stock_baseline (table_name, row_pk, quantity, taken_at, after_journal_id) '
                'SELECT \'products\', "productId"::text, coalesce(stock_quantity, 0), now() at time zone \'utc\', :last FROM products'
            ), {"last": last})
            print(f"baseline taken after journal id {last}")
        else:
            print("baseline already present - left alone")
    print(f"operation journal ready on {db_name or 'the app database'}")


if __name__ == "__main__":
    main()
