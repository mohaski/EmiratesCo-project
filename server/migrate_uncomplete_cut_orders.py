"""
Migration: undo the order completions that the cutting report used to do on its own.

mark_cutting_complete_for_orders_batch used to set order.status="completed" alongside
flagging each item cut. That conflated "the metal has been cut" with "this sale is
finished", and since update_order refuses a completed order it left every cut order
permanently uneditable. The auto-complete has been removed, but orders it already
completed are still sitting there locked.

This moves those orders to "ready", which is what they actually are: the cutting is done,
the goods are waiting for the customer. They become editable again, and completing them
stays a human action through update_order_status.

WHICH ORDERS
------------
Only orders that are status="completed" AND have at least one item carrying a
cutting_completed_at timestamp — i.e. ones the cutting report plausibly completed. An
order somebody completed by hand has no such timestamp and is left alone.

That test is a heuristic, not a certainty: if a manager manually completed an order that
had also been cut, this will move it back to "ready" and somebody will have to complete it
again. The auto-complete never wrote an edit_history row, so the previous status genuinely
isn't recoverable. Nothing in the codebase reads status=="completed" (the only status any
code compares against is "cancelled"), so the blast radius is limited to the workflow label
itself.

Writes an edit_history row per order so the change is visible in the CEO activity feed
rather than appearing as an unexplained status move.

    python migrate_uncomplete_cut_orders.py --dry-run   # report only, writes nothing
    python migrate_uncomplete_cut_orders.py             # apply
"""
import sys

from sqlmodel import Session, select, text

from db.database import engine

import entities  # noqa: F401  — registers every table on SQLModel.metadata
from entities.editHistory import EditHistory
from entities.orders import Order

NEW_STATUS = "ready"

FIND = text('''
    SELECT DISTINCT o."orderId"
    FROM orders o
    JOIN orderitems i ON i.order_id = o."orderId"
    WHERE o.status = 'completed'
      AND i.cutting_completed_at IS NOT NULL
    ORDER BY o."orderId"
''')


def migrate(dry_run: bool) -> None:
    with Session(engine) as session:
        order_ids = [row[0] for row in session.exec(FIND).all()]

        # .first() hands back a Row, which is not a plain tuple — index it rather than
        # type-checking, or the count prints as "(0,)".
        manual_row = session.exec(text('''
            SELECT count(*) FROM orders o
            WHERE o.status = 'completed'
              AND NOT EXISTS (SELECT 1 FROM orderitems i
                              WHERE i.order_id = o."orderId"
                                AND i.cutting_completed_at IS NOT NULL)
        ''')).first()
        manual_count = manual_row[0] if manual_row is not None else 0

        print(f"Completed orders that look auto-completed by a cutting report: {len(order_ids)}")
        print(f"Completed orders with no cutting timestamp (left alone): {manual_count}")

        if not order_ids:
            print("\nNothing to do.")
            return

        print(f"\nWould move to '{NEW_STATUS}': {', '.join(f'#{i}' for i in order_ids)}")
        if dry_run:
            print("\n--dry-run: nothing written.")
            return

        for order_id in order_ids:
            order = session.get(Order, order_id)
            if order is None or order.status != "completed":
                continue
            order.status = NEW_STATUS
            session.add(order)
            session.add(EditHistory(
                entity_type="order_status",
                entity_id=order_id,
                edited_by=order.servedby,
                action="status_change",
                before_snapshot={"status": "completed"},
                after_snapshot={"status": NEW_STATUS},
                notes=("migrate_uncomplete_cut_orders: the cutting report used to complete "
                       "orders automatically, which locked them against editing"),
            ))
            print(f"  #{order_id}: completed -> {NEW_STATUS}")

        session.commit()
        print(f"\nDone. {len(order_ids)} order(s) are editable again.")


if __name__ == "__main__":
    migrate(dry_run="--dry-run" in set(sys.argv[1:]))
