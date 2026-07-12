"""
Migration: Add products.applicable_attributes (JSON list of attribute class names
used to describe this product's variants) and products.has_dimensions (whether
Length x Width "Dimensions" is a generating attribute for this product).

These are now fixed on the product at creation time so "Add Variant" always offers
the same attribute set the product was created with, instead of guessing from
whichever variants happen to exist.

Backfills existing products from their variants' attribute keys so "Add Variant"
keeps working for products created before this migration.

Run from the server directory:
    python migrate_product_variant_attributes.py
"""

from sqlmodel import Session, text, select
from db.database import engine
from entities.products import Product
from entities.variants import Variant


def migrate():
    with Session(engine) as session:
        print("Adding products.applicable_attributes...")
        try:
            session.exec(text("ALTER TABLE products ADD COLUMN applicable_attributes JSON DEFAULT '[]'"))
            session.commit()
            print("  Added.")
        except Exception as e:
            print(f"  Skipped: {e}")
            session.rollback()

        print("Adding products.has_dimensions...")
        try:
            session.exec(text("ALTER TABLE products ADD COLUMN has_dimensions BOOLEAN DEFAULT FALSE"))
            session.commit()
            print("  Added.")
        except Exception as e:
            print(f"  Skipped: {e}")
            session.rollback()

        print("Backfilling from existing variants...")
        products = session.exec(select(Product)).all()
        for product in products:
            if product.applicable_attributes:
                continue
            variants = session.exec(select(Variant).where(Variant.product_id == product.productId)).all()
            keys = set()
            has_dims = False
            for v in variants:
                for k in (v.attributes or {}).keys():
                    if k == 'Dimensions':
                        has_dims = True
                    else:
                        keys.add(k)
            product.applicable_attributes = sorted(keys)
            product.has_dimensions = has_dims
            session.add(product)
        session.commit()
        print("Migration complete.")


if __name__ == "__main__":
    migrate()
