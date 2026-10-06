"""
Migration: indexes on the lookups every sale, list and report makes (backend audit B3).

Declared in the entities too (so a fresh database gets them from create_all), but create_all
never adds an index to a table that already exists - which is also why orders.created_at and
orders.servedby, declared long ago, were missing.

Built with CREATE INDEX CONCURRENTLY: no table lock, safe with the app running. Each statement
runs on its own (CONCURRENTLY can't run inside a transaction). Re-runnable: IF NOT EXISTS.

    python migrate_indexes.py            # the database in .env / DATABASE_URL
"""
from sqlalchemy import text

from db.database import engine

INDEXES = [
    ("ix_orderitems_order_id", 'orderitems (order_id)'),
    ("ix_payments_orderId", 'payments ("orderId")'),
    ("ix_credits_orderId", 'credits ("orderId")'),
    ("ix_payments_payed_at", 'payments (payed_at)'),
    ("ix_variants_product_id", 'variants (product_id)'),
    ("ix_offcuts_product_id", 'offcuts (product_id)'),
    ("ix_orders_customerid", 'orders (customerid)'),
    ("ix_orders_created_at", 'orders (created_at)'),
    ("ix_orders_servedby", 'orders (servedby)'),
    ("ix_orders_VAT_status", 'orders ("VAT_status")'),
    ("ix_orders_status", 'orders (status)'),
    ("ix_stock_journal_row_history", 'stock_journal (table_name, row_pk, id)'),
]


def migrate():
    with engine.connect().execution_options(isolation_level="AUTOCOMMIT") as conn:
        db = conn.execute(text("select current_database()")).scalar()
        print(f"Indexes on {db}:")
        for name, target in INDEXES:
            # A failed CONCURRENTLY build leaves an INVALID index behind that IF NOT EXISTS
            # would then skip forever - drop such a leftover first.
            invalid = conn.execute(text(
                "select 1 from pg_index i join pg_class c on c.oid = i.indexrelid "
                "where c.relname = :n and not i.indisvalid"), {"n": name}).first()
            if invalid:
                conn.execute(text(f'DROP INDEX CONCURRENTLY IF EXISTS "{name}"'))
                print(f"  dropped an invalid leftover of {name}")
            conn.execute(text(f'CREATE INDEX CONCURRENTLY IF NOT EXISTS "{name}" ON {target}'))
            print(f"  OK {name}")
    print("Done.")


if __name__ == "__main__":
    migrate()
