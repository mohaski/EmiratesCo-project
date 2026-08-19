"""
Migration: Variant.stock_quantity becomes a piece-count, not a pack/box-count.

For a "packaged" (count-tracked) accessory variant -- product.track_offcuts is
False and the variant carries a unit_quantity (pieces per pack, e.g. "Box of
1000pcs") -- stock_quantity used to mean "how many packs", with unit_quantity
converting to pieces only at piece-sale time (dividing). Now stock_quantity
always means "how many individual pieces" directly, a whole number always
(see core/inventory/inventoryService.py's _deduct_simple_stock_pooled and
entities/variants.py).

A bar/sheet (track_offcuts=True) variant's stock_quantity is left untouched by
step 1 below -- unit_quantity is never read for those products' deduction code
even when it happens to be populated for an unrelated reason (a numeric custom
"Length" value, e.g. "21ft" -- see entities/variants.py's docstring). Only
step 2 (rounding + column type) applies to them, and only because every
existing bar/sheet stock_quantity is already a whole number in practice (cut
sales always consume 1 whole bar/sheet at a time).

Steps:
  1. For every track_offcuts=False variant with unit_quantity set: multiply
     stock_quantity by unit_quantity (pack-count -> piece-count), and apply the
     same delta to its product's aggregate stock_quantity so the two stay in
     sync (mirrors how deduction code updates both together).
  2. Round every variant's stock_quantity (handles float noise) and cast the
     column to INTEGER.

Run from the server directory:
    python migrate_variant_stock_to_pieces.py
"""
from sqlalchemy import text
from sqlmodel import Session, select

from db.database import engine
from entities.variants import Variant
from entities.products import Product


def _column_type(conn, table: str, column: str):
    row = conn.execute(text(
        "SELECT data_type FROM information_schema.columns WHERE table_name=:t AND column_name=:c"
    ), {"t": table, "c": column}).fetchone()
    return row[0] if row else None


def migrate():
    with engine.connect() as conn:
        current_type = _column_type(conn, "variants", "stock_quantity")
        if current_type == "integer":
            print("variants.stock_quantity is already INTEGER — nothing to convert.")
            return
        print(f"variants.stock_quantity is currently '{current_type}'.")

    with Session(engine) as db:
        print("\nConverting packaged (count-tracked) variants from pack-count to piece-count...")
        products = {p.productId: p for p in db.exec(select(Product)).all()}
        variants = db.exec(select(Variant)).all()

        converted = 0
        for v in variants:
            product = products.get(v.product_id)
            if not product or product.track_offcuts or v.unit_quantity is None:
                continue
            old_stock = v.stock_quantity
            new_stock = round(old_stock * v.unit_quantity)
            delta = new_stock - old_stock
            v.stock_quantity = new_stock
            db.add(v)
            product.stock_quantity = max(0, (product.stock_quantity or 0) + round(delta))
            db.add(product)
            converted += 1
            print(f"  variant {v.variantId} ({product.name} / {v.attributes}): "
                  f"{old_stock} pack(s) x {v.unit_quantity} -> {new_stock} pcs")
        db.commit()
        print(f"Converted {converted} packaged variant(s).")

    with engine.connect() as conn:
        print("\nRounding remaining values and casting variants.stock_quantity to INTEGER...")
        conn.execute(text(
            "ALTER TABLE variants ALTER COLUMN stock_quantity TYPE INTEGER USING ROUND(stock_quantity)::INTEGER"
        ))
        conn.execute(text("ALTER TABLE variants ALTER COLUMN stock_quantity SET DEFAULT 0"))
        conn.commit()
        print("  Done.")

    print("\nMigration complete.")


if __name__ == "__main__":
    migrate()
