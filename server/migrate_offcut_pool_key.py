"""
Migration: Pool offcuts across variants that differ only by a size/sale-unit
attribute — profile bar length, glass sheet dimensions, accessory pack size
(see core/inventory/poolKey.py for the full rationale).

Previously every offcut query/upsert scoped strictly to `variant_id`, so a
leftover piece cut from a 6m White profile bar was invisible to an order
against a 5.8m White bar of the same product, even though physically it's the
same material. `offcuts.pool_key` (new) groups rows by every variant attribute
EXCEPT "Dimensions" and any custom-typed attribute class — see poolKey.py.

Steps:
  1. Add offcuts.pool_key (VARCHAR NOT NULL DEFAULT '').
  2. Backfill pool_key for every existing row from its variant's attributes
     (empty string for a variantless row).
  3. Consolidate: rows that land on the same (product_id, pool_key, length) for
     1D offcuts, or (product_id, pool_key, width, height, status) for 2D ones,
     are merged into one row (summed quantity, most-recent source_item_id,
     earliest created_at) and the duplicates deleted.

Run from the server directory:
    python migrate_offcut_pool_key.py
"""

from sqlalchemy import text
from sqlmodel import Session, select

from db.database import engine, DATABASE_URL
from entities.offcuts import Offcut
from entities.variants import Variant
from entities.attributes import AttributeClass
from core.inventory.poolKey import pool_key_from_attributes


def _column_exists(conn, table: str, column: str) -> bool:
    return conn.execute(text(
        "SELECT column_name FROM information_schema.columns WHERE table_name=:t AND column_name=:c"
    ), {"t": table, "c": column}).fetchone() is not None


def migrate():
    with engine.connect() as conn:
        if not _column_exists(conn, "offcuts", "pool_key"):
            print("Adding 'pool_key' column to 'offcuts'...")
            conn.execute(text("ALTER TABLE offcuts ADD COLUMN pool_key VARCHAR NOT NULL DEFAULT ''"))
            conn.commit()
            print("  Column added.")
        else:
            print("Column 'pool_key' already exists on 'offcuts'.")

        print("Creating index on 'offcuts.pool_key' (if missing)...")
        conn.execute(text("CREATE INDEX IF NOT EXISTS ix_offcuts_pool_key ON offcuts (pool_key)"))
        conn.commit()

    with Session(engine) as db:
        print("Backfilling pool_key from each row's variant attributes...")
        attribute_types = {ac.name: ac.type for ac in db.exec(select(AttributeClass)).all()}
        variants_by_id = {v.variantId: v for v in db.exec(select(Variant)).all()}

        offcuts = db.exec(select(Offcut)).all()
        updated = 0
        for oc in offcuts:
            variant = variants_by_id.get(oc.variant_id) if oc.variant_id else None
            new_key = pool_key_from_attributes(variant.attributes if variant else None, attribute_types)
            if oc.pool_key != new_key:
                oc.pool_key = new_key
                db.add(oc)
                updated += 1
        db.commit()
        print(f"  Backfilled pool_key on {updated} offcut row(s).")

        print("Consolidating offcut rows that now land in the same pool...")
        offcuts = db.exec(select(Offcut)).all()
        groups: dict = {}
        for oc in offcuts:
            is_2d = oc.width is not None and oc.height is not None
            if is_2d:
                key = (oc.product_id, oc.pool_key, oc.status, round(oc.width, 1), round(oc.height, 1))
            else:
                key = (oc.product_id, oc.pool_key, oc.status, round(oc.length, 3))
            groups.setdefault(key, []).append(oc)

        merged_groups = 0
        deleted_rows = 0
        for key, rows in groups.items():
            if len(rows) <= 1:
                continue
            merged_groups += 1
            rows.sort(key=lambda r: r.created_at)
            survivor = rows[0]
            survivor.quantity = sum(r.quantity for r in rows)
            # Bias toward surfacing a pending-source notice — same "newest
            # contributor wins" policy _upsert_offcut/_upsert_glass_offcut use
            # when merging live, applied retroactively here.
            newest_with_source = max(
                (r for r in rows if r.source_item_id is not None),
                key=lambda r: r.created_at, default=None,
            )
            if newest_with_source is not None:
                survivor.source_item_id = newest_with_source.source_item_id
            db.add(survivor)
            for dup in rows[1:]:
                db.delete(dup)
                deleted_rows += 1
        db.commit()
        print(f"  Merged {merged_groups} pool(s), removing {deleted_rows} duplicate row(s).")

    print("\nDone.")


if __name__ == "__main__":
    migrate()
