"""
Migration: Product.pool_ignored_attributes — let the CEO explicitly declare,
at product-creation time, which of a product's own attributes should be
ignored when deciding whether two variants share an offcut/stock pool (see
core/inventory/poolKey.py), instead of always relying on the automatic rule
(ignore "Dimensions" and any custom-typed attribute).

Purely additive: the column is nullable, and every existing product gets NULL,
which keeps today's automatic behavior exactly as-is (pool_key_from_attributes
falls back to the automatic rule whenever this is NULL). No backfill needed.

Run from the server directory:
    python migrate_product_pool_ignored_attributes.py
"""
from sqlalchemy import text

from db.database import engine


def _column_exists(conn, table: str, column: str) -> bool:
    return conn.execute(text(
        "SELECT column_name FROM information_schema.columns WHERE table_name=:t AND column_name=:c"
    ), {"t": table, "c": column}).fetchone() is not None


def migrate():
    with engine.connect() as conn:
        if _column_exists(conn, "products", "pool_ignored_attributes"):
            print("Column 'pool_ignored_attributes' already exists on 'products'.")
            return
        print("Adding 'pool_ignored_attributes' column to 'products' (nullable JSON)...")
        conn.execute(text("ALTER TABLE products ADD COLUMN pool_ignored_attributes JSON"))
        conn.commit()
        print("  Column added — every existing product is NULL (keeps the automatic pooling rule).")

    print("\nDone.")


if __name__ == "__main__":
    migrate()
