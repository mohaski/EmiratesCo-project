"""
Migration: the "open container" stock model for accessories whose packs hold a
varying/unknowable amount (rubber rolls, screw boxes sold by weight).

Adds:
  - products.unit_stock_mode  ('counted' | 'open_container', default 'counted')
  - the open_containers table (entities/openContainers.py)

Safe and idempotent: every existing product keeps unit_stock_mode='counted', so
the packaged-piece pooling path (inventoryService._deduct_packaged_stock_pooled)
behaves exactly as before. Switching an individual product over is a separate,
deliberate act done from Product Management — see update_product in
core/inventory/products/service.py, which converts that product's variant
stock_quantity from pieces to whole packs and folds any leftover loose-piece
pool into an already-open container.

Run from the server directory:
    python migrate_add_open_containers.py
"""

from sqlmodel import Session, text, SQLModel

from db.database import engine
from entities.openContainers import OpenContainer  # noqa: F401 — registers the table


def migrate():
    with Session(engine) as session:
        print("Adding products.unit_stock_mode ...")
        try:
            session.exec(text(
                "ALTER TABLE products ADD COLUMN unit_stock_mode VARCHAR NOT NULL DEFAULT 'counted'"
            ))
            session.commit()
            print("  Added.")
        except Exception as e:
            session.rollback()
            print(f"  Skipped: {e}")

        # Backfill any pre-existing NULLs (only possible if the column was added
        # by an earlier partial run without the NOT NULL/DEFAULT clause).
        try:
            session.exec(text(
                "UPDATE products SET unit_stock_mode = 'counted' WHERE unit_stock_mode IS NULL"
            ))
            session.commit()
        except Exception:
            session.rollback()

    print("Creating open_containers table ...")
    try:
        OpenContainer.__table__.create(engine, checkfirst=True)
        print("  Created (or already present).")
    except Exception as e:
        print(f"  Skipped: {e}")

    print("Migration complete.")


if __name__ == "__main__":
    migrate()
