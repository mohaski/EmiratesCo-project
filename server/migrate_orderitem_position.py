"""
Migration: orderitems.position — the item's place in the cart it was built from.

Callers match an order's items back to the cart array POSITIONALLY. The printed cutting
worksheet (client ReceiptPage) does exactly this: it merges the pre-submit cart snapshot
(names, categories, display breakdown) with the saved order (offcut_sources) by index.

That was safe while item_id order was cart order — create_order inserts one row per cart
item in sequence, and the old update_order deleted and recreated every row on each edit.
It stopped being safe when update_order became a diff: an unchanged item keeps its original
(low) id while changed ones are appended with new (high) ids, so a kept item can sort ahead
of one that precedes it in the cart. The visible symptom was a worksheet printing the GLASS
cutting instructions under a PROFILE item and vice versa.

This column records the intended order instead of inferring it. Order.orderItems is ordered
by (position, item_id), the item_id breaking ties for rows that predate the column.

Backfill sets position = the row's rank by item_id within its order, which reproduces the
old behaviour exactly for every order created or edited before this change — including the
ones already scrambled, since for those item_id order IS what the order currently reports.
Orders edited after this runs get a true cart position.

Additive and non-destructive; safe to re-run.

    python migrate_orderitem_position.py
"""
from sqlmodel import Session, text

from db.database import engine


def migrate():
    with Session(engine) as session:
        print("Adding orderitems.position...")
        for stmt in [
            "ALTER TABLE orderitems ADD COLUMN position INTEGER NOT NULL DEFAULT 0",
            "CREATE INDEX IF NOT EXISTS ix_orderitems_position ON orderitems (position)",
        ]:
            try:
                session.exec(text(stmt))
                session.commit()
                print(f"  OK: {stmt}")
            except Exception as e:
                print(f"  Skipped: {stmt} ({e})")
                session.rollback()

        print("\nBackfilling position from item_id rank within each order...")
        try:
            result = session.exec(text('''
                UPDATE orderitems AS oi
                SET position = ranked.rn - 1
                FROM (
                    SELECT item_id,
                           row_number() OVER (PARTITION BY order_id ORDER BY item_id) AS rn
                    FROM orderitems
                ) AS ranked
                WHERE oi.item_id = ranked.item_id
                  AND oi.position IS DISTINCT FROM ranked.rn - 1
            '''))
            session.commit()
            print(f"  Updated {result.rowcount} row(s).")
        except Exception as e:
            session.rollback()
            print(f"  Backfill failed: {e}")
            raise

        counts = session.exec(text('''
            SELECT count(*) AS items,
                   count(DISTINCT order_id) AS orders,
                   max(position) AS max_position
            FROM orderitems
        ''')).first()
        print(f"\n{counts[0]} item(s) across {counts[1]} order(s); highest position {counts[2]}.")

        bad = session.exec(text('''
            SELECT count(*) FROM (
                SELECT order_id FROM orderitems
                GROUP BY order_id, position HAVING count(*) > 1
            ) t
        ''')).first()
        print(f"Orders with duplicate positions: {bad[0]} (expected 0)")
        print("\nMigration complete.")


if __name__ == "__main__":
    migrate()
