"""
Migration: add 'refund' to the payment_reason_enum type.

payments.reason previously only allowed 'order' (collected at
create/edit-order checkout time) and 'debt' (collected later against a
standing balance). Order edits that pay money back out to the customer were
being tagged 'order' too, indistinguishable from a normal collection — see
orderService.update_order, which now tags those rows 'refund' instead
(reason="refund" if new_payment < 0 else "order").

Postgres requires ALTER TYPE ... ADD VALUE to run outside an explicit
transaction block (autocommit), and the new value can't be used by the same
connection until after it commits — this migration only adds the value, it
doesn't write any rows, so that's not an issue here.

Run from the server directory:
    python migrate_add_refund_payment_reason.py
"""

from sqlalchemy import text
from db.database import engine


def migrate():
    with engine.connect() as conn:
        conn = conn.execution_options(isolation_level="AUTOCOMMIT")
        print("Adding 'refund' to payment_reason_enum...")
        try:
            conn.execute(text(
                "ALTER TYPE payment_reason_enum ADD VALUE IF NOT EXISTS 'refund'"
            ))
            print("  Added (or already present).")
        except Exception as e:
            print(f"  Skipped: {e}")
        print("Migration complete.")


if __name__ == "__main__":
    migrate()
