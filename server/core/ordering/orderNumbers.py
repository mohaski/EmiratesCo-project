"""Gap-free order numbers.

orderId is a SERIAL: Postgres hands out a value on every INSERT and never takes it back, so
a rolled-back checkout or an abandoned sale window leaves a hole (#210, #212, ...). Order
numbers are what people see on receipts, and the business wants them unbroken.

order_no is therefore drawn from a one-row counter with UPDATE ... RETURNING *inside the
transaction that confirms the order*. The UPDATE row-locks the counter until that
transaction ends; if it rolls back, so does the increment. The lock serialises confirms
against each other, which costs nothing at till volume — but it is why callers take the
number as the LAST step before commit, after every stock lock, so the counter is held for
milliseconds and always acquired after the other locks (no lock-order inversion with the
stock rows).
"""
from sqlalchemy import text


def next_order_no(db) -> int:
    row = db.exec(text(
        "UPDATE order_number_counter SET last_no = last_no + 1 WHERE id = 1 RETURNING last_no"
    )).first()
    if row is None:
        # The migration seeds this row; recreating it here would restart numbering at 1
        # and collide with every existing order_no.
        raise RuntimeError(
            "order_number_counter is not initialised - run migrate_sale_windows.py"
        )
    return int(row[0])


def assign_order_no(db, order) -> int:
    """Give a confirmed order its receipt number. Idempotent: an order keeps the number
    it already has."""
    if order.order_no is None:
        order.order_no = next_order_no(db)
        db.add(order)
    return order.order_no
