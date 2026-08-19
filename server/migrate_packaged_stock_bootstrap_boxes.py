"""
Migration: Bootstrap the box-opening model for packaged (count-tracked)
accessory variants.

Previously a packaged variant's stock_quantity (pieces, see
migrate_variant_stock_to_pieces.py) could hold a fractional-box remainder in
place — e.g. 44900 pieces at a 1000pcs pack size is 44.9 "boxes" worth,
because a piece sale used to just subtract straight from the number with no
concept of a box being sealed or opened. The new model
(inventoryService.py's _deduct_packaged_stock_pooled) treats a box as atomic:
stock_quantity must always be an exact multiple of the variant's own
unit_quantity (whole sealed boxes only), with any leftover living separately
in a shared "loose pieces" pool (an Offcut row, keyed by pool_key, `length`
repurposed as a piece count — see core/inventory/poolKey.py).

This is a one-time bootstrap: for every track_offcuts=False variant with
unit_quantity > 1, split its current stock_quantity into
  - sealed  = floor(stock_quantity / unit_quantity) * unit_quantity  (kept as
    the new stock_quantity)
  - loose   = stock_quantity - sealed  (moved into the shared loose-pieces
    pool for that variant's pool_key)
Physically: any partial-box remainder already implied by the data becomes a
real "opened box" leftover instead of a fictional in-place fraction.

Run from the server directory:
    python migrate_packaged_stock_bootstrap_boxes.py
"""
from sqlmodel import Session, select

from db.database import engine
from entities.variants import Variant
from entities.products import Product
from core.inventory.poolKey import load_attribute_types, pool_key_from_attributes
from core.inventory.inventoryService import _add_loose_pcs


def migrate():
    with Session(engine) as db:
        attribute_types = load_attribute_types(db)
        products = {p.productId: p for p in db.exec(select(Product)).all()}
        variants = db.exec(select(Variant)).all()

        converted = 0
        for v in variants:
            product = products.get(v.product_id)
            if not product or product.track_offcuts:
                continue
            unit_quantity = v.unit_quantity or 0
            if unit_quantity <= 1:
                continue  # unpackaged — already "loose" by definition, nothing to split

            sealed_boxes = v.stock_quantity // int(unit_quantity)
            sealed = sealed_boxes * int(unit_quantity)
            loose = v.stock_quantity - sealed
            if loose <= 0:
                print(f"  variant {v.variantId} ({product.name} / {v.attributes}): "
                      f"{v.stock_quantity} pcs already an exact multiple of {unit_quantity:.0f} — no change.")
                continue

            pool_key = pool_key_from_attributes(v.attributes, attribute_types)
            v.stock_quantity = sealed
            db.add(v)
            _add_loose_pcs(db, product, pool_key, loose, variant_id=v.variantId)
            converted += 1
            print(f"  variant {v.variantId} ({product.name} / {v.attributes}): "
                  f"{sealed + loose} pcs -> {sealed} sealed ({sealed_boxes} box(es) of {unit_quantity:.0f}) "
                  f"+ {loose} pcs to the loose pool (pool_key={pool_key!r})")

        db.commit()
        print(f"\nBootstrapped {converted} packaged variant(s) with a partial-box remainder.")

    print("Done.")


if __name__ == "__main__":
    migrate()
