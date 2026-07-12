"""
Migration: Consolidate product pricing/dimensions onto variants, then drop the
now-redundant columns from `products`.

Every product is now required to have at least one variant — price, stock,
length, width and height live on the variant, not the product. This script:

  1. Backfills a variant for any product that has none, carrying over its
     price_full/price_half/price_unit/length/width/height/stock_quantity.
  2. Backfills any NULL/zero variant field (length/width/height/price_half/
     price_unit/price) from the parent product's value, so nothing is lost.
  3. (After confirmation) drops price_full, price_half, price_unit, length,
     width, height from `products`.

Steps 1-2 are safe/additive and always run. Step 3 is destructive and
requires typed confirmation.

Run from the server directory:
    python migrate_consolidate_variants.py
"""

import sys
import os

sys.path.append(os.path.dirname(os.path.abspath(__file__)))

from sqlalchemy import text
from db.database import engine


def backfill():
    print("=== Phase 1: Backfill variants from product-level data ===\n")

    with engine.begin() as conn:
        # 1a. Products with zero variants -> create one variant carrying the old data
        rows = conn.execute(text('''
            SELECT p."productId", p.price_full, p.price_half, p.price_unit,
                   p.length, p.width, p.height, p.stock_quantity
            FROM products p
            LEFT JOIN variants v ON v.product_id = p."productId"
            WHERE v."variantId" IS NULL
        ''')).fetchall()

        print(f"Products with no variants: {len(rows)}")
        for r in rows:
            pid, price_full, price_half, price_unit, length, width, height, stock_qty = r
            conn.execute(text('''
                INSERT INTO variants
                    (product_id, name, attributes, stock_quantity, price, price_half, price_unit, length, width, height)
                VALUES
                    (:pid, '', '{}', :stock, :price, :price_half, :price_unit, :length, :width, :height)
            '''), {
                "pid": pid,
                "stock": stock_qty or 0,
                "price": price_full or 0,
                "price_half": price_half,
                "price_unit": price_unit,
                "length": length,
                "width": width,
                "height": height,
            })
            conn.execute(text('UPDATE products SET has_variants = true WHERE "productId" = :pid'), {"pid": pid})
            print(f"  + created variant for product {pid}")

        # 1b. Existing variants missing a field that the product still had set — fill the gap
        backfill_cols = ["length", "width", "height", "price_half", "price_unit"]
        for col in backfill_cols:
            result = conn.execute(text(f'''
                UPDATE variants v
                SET {col} = p.{col}
                FROM products p
                WHERE v.product_id = p."productId" AND v.{col} IS NULL AND p.{col} IS NOT NULL
            '''))
            if result.rowcount:
                print(f"  ~ backfilled variant.{col} on {result.rowcount} row(s) from product.{col}")

        result = conn.execute(text('''
            UPDATE variants v
            SET price = p.price_full
            FROM products p
            WHERE v.product_id = p."productId" AND (v.price IS NULL OR v.price = 0)
              AND p.price_full IS NOT NULL AND p.price_full > 0
        '''))
        if result.rowcount:
            print(f"  ~ backfilled variant.price on {result.rowcount} row(s) from product.price_full")

    print("\nPhase 1 complete.\n")


def drop_columns():
    print("=== Phase 2: Drop product-level price/dimension columns ===\n")

    cols = ["price_full", "price_half", "price_unit", "length", "width", "height"]

    with engine.connect() as conn:
        result = conn.execute(text("""
            SELECT column_name, data_type
            FROM information_schema.columns
            WHERE table_name = 'products' AND column_name = ANY(:cols)
            ORDER BY ordinal_position
        """), {"cols": cols})
        existing = result.fetchall()

    if not existing:
        print("Columns already dropped — nothing to do.")
        return

    print("Columns to drop from products:")
    for r in existing:
        print(f"  {r[0]:15s} {r[1]}")

    confirm = input("\nDrop these columns from products? Type YES to continue: ")
    if confirm.strip() != "YES":
        print("Aborted (columns left in place).")
        return

    with engine.begin() as conn:
        for col in cols:
            conn.execute(text(f'ALTER TABLE products DROP COLUMN IF EXISTS {col}'))
            print(f"  - dropped products.{col}")

    print("\nPhase 2 complete.")


if __name__ == "__main__":
    backfill()
    drop_columns()
