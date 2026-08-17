"""
Migration: Rework payment provenance/audit fields.

- payments.transaction_ref / payments.number_used are dropped — dead columns,
  never wired up on any frontend form (no UI ever collected an M-Pesa code or
  cheque number).
- payments.reason (new, NOT NULL, enum 'order'/'debt') records WHY a payment
  was recorded: 'order' = collected as part of creating/editing an order (or
  converting an invoice to one) at checkout time; 'debt' = collected later
  against an already-standing balance (Collect Payments / Dues page).
- payments.payment_details (new, JSON, nullable) carries a split payment's
  cash/mpesa breakdown for THAT payment event — e.g. {"cash": 100, "mpesa":
  200} — replacing orders.payment_details, which could only ever hold one
  snapshot for the whole order even though an order can accumulate several
  separate payment events over time (initial checkout + later top-ups, each
  potentially its own split).
- orders.payment_method / orders.payment_details are dropped entirely. The
  representative payment method for an order is now derived from its most
  recently recorded Payment row (see orderService._latest_payment_method),
  and a split breakdown is now recorded per-payment via
  payments.payment_details above rather than once per order.

Backfill strategy for pre-existing data (best-effort — the old schema never
recorded "why" a payment happened, so this is inferred, not authoritative;
every payment recorded going forward is tagged correctly by the code path
that creates it, not by this heuristic):

  1. For any order with amountPayed > 0 but ZERO Payment rows — only possible
     via invoice conversion, since convert_invoice_to_order historically set
     Order.amountPayed/payment_method/payment_details directly without ever
     writing a Payment row — synthesize one Payment row from the order's own
     amountPayed / payment_method / payment_details / created_at / servedby,
     reason='order'. Without this, that payment's method/split would be lost
     outright once orders.payment_method/payment_details are dropped.
  2. reason: a payment recorded within 1 hour of its order's created_at is
     tagged 'order' (covers both the normal checkout-time payment, and a
     handful of legacy orders where a single split checkout was written as
     two separate same-second Payment rows instead of one 'split' row —
     verified against live data before choosing this window: every later
     payment in the current dataset lands 2+ hours after order creation,
     most of them 8-102 days later, i.e. unambiguous later debt collection).
     Anything later than that is tagged 'debt'.
  3. orders.payment_details is copied onto each order's EARLIEST payment row
     only (verified against live data: it always corresponds to whichever
     payment happened at checkout time, never a later debt collection).

Run from the server directory:
    python migrate_payment_reason_and_split.py
"""

from sqlalchemy import create_engine, text
from db.database import DATABASE_URL

REASON_WINDOW = "1 hour"


def _column_exists(conn, table: str, column: str) -> bool:
    return conn.execute(text(
        "SELECT column_name FROM information_schema.columns WHERE table_name=:t AND column_name=:c"
    ), {"t": table, "c": column}).fetchone() is not None


def _type_exists(conn, type_name: str) -> bool:
    return conn.execute(text("SELECT 1 FROM pg_type WHERE typname=:n"), {"n": type_name}).fetchone() is not None


def migrate():
    engine = create_engine(DATABASE_URL)
    with engine.connect() as conn:
        # ── 1. payments.reason ───────────────────────────────────────────────
        if not _type_exists(conn, "payment_reason_enum"):
            print("Creating 'payment_reason_enum' type...")
            conn.execute(text("CREATE TYPE payment_reason_enum AS ENUM ('order', 'debt')"))
            conn.commit()
        else:
            print("Type 'payment_reason_enum' already exists.")

        if not _column_exists(conn, "payments", "reason"):
            print("Adding 'reason' column to 'payments' (nullable for now, backfilling below)...")
            conn.execute(text("ALTER TABLE payments ADD COLUMN reason payment_reason_enum"))
            conn.commit()
        else:
            print("Column 'reason' already exists on 'payments'.")

        # ── 2. payments.payment_details ──────────────────────────────────────
        if not _column_exists(conn, "payments", "payment_details"):
            print("Adding 'payment_details' column to 'payments'...")
            conn.execute(text("ALTER TABLE payments ADD COLUMN payment_details JSON"))
            conn.commit()
        else:
            print("Column 'payment_details' already exists on 'payments'.")

        has_order_payment_method = _column_exists(conn, "orders", "payment_method")
        has_order_payment_details = _column_exists(conn, "orders", "payment_details")

        # ── 3. Synthesize missing Payment rows (paid orders with none on record) ──
        if has_order_payment_method:
            print("Synthesizing missing Payment rows for paid orders with none on record...")
            details_expr = "o.payment_details" if has_order_payment_details else "NULL"
            result = conn.execute(text(f"""
                INSERT INTO payments ("orderId", amount, payment_method, reason, payment_details, payed_at, recorded_by)
                SELECT
                    o."orderId",
                    o."amountPayed",
                    (CASE WHEN LOWER(COALESCE(o.payment_method, 'cash')) IN ('cash', 'mpesa', 'split', 'number')
                          THEN LOWER(o.payment_method) ELSE 'cash' END)::payment_method_enum,
                    'order',
                    {details_expr},
                    o.created_at,
                    o.servedby
                FROM orders o
                WHERE o."amountPayed" > 0.01
                  AND NOT EXISTS (SELECT 1 FROM payments p WHERE p."orderId" = o."orderId")
            """))
            conn.commit()
            print(f"  Inserted {result.rowcount} synthesized payment row(s).")
        else:
            print("orders.payment_method already dropped — skipping synthesis step (nothing left to read).")

        # ── 4. Backfill orders.payment_details onto each order's EARLIEST payment ──
        if has_order_payment_details:
            print("Copying orders.payment_details onto each order's earliest payment row...")
            result = conn.execute(text("""
                UPDATE payments p
                SET payment_details = o.payment_details
                FROM orders o
                JOIN LATERAL (
                    SELECT p2."paymentId" FROM payments p2
                    WHERE p2."orderId" = o."orderId"
                    ORDER BY p2.payed_at ASC, p2."paymentId" ASC
                    LIMIT 1
                ) earliest ON true
                WHERE o."orderId" = p."orderId"
                  AND p."paymentId" = earliest."paymentId"
                  AND o.payment_details IS NOT NULL
                  AND o.payment_details::text <> 'null'
                  AND p.payment_details IS NULL
            """))
            conn.commit()
            print(f"  Updated {result.rowcount} payment row(s) with a real split breakdown.")

        # ── 5. Backfill reason ────────────────────────────────────────────────
        print(f"Backfilling 'reason' — payments within {REASON_WINDOW} of their order's creation are 'order', later ones 'debt'...")
        conn.execute(text(f"""
            UPDATE payments p
            SET reason = 'order'
            FROM orders o
            WHERE o."orderId" = p."orderId"
              AND p.reason IS NULL
              AND (p.payed_at - o.created_at) <= interval '{REASON_WINDOW}'
        """))
        result = conn.execute(text("UPDATE payments SET reason = 'debt' WHERE reason IS NULL"))
        conn.commit()
        print(f"  Tagged remaining {result.rowcount} payment row(s) as 'debt'.")

        # ── 6. Enforce NOT NULL now that every row has a reason ──────────────
        conn.execute(text("ALTER TABLE payments ALTER COLUMN reason SET NOT NULL"))
        conn.commit()
        print("  'reason' is now NOT NULL.")

        # ── 7. Drop dead payments columns ────────────────────────────────────
        for col in ("transaction_ref", "number_used"):
            if _column_exists(conn, "payments", col):
                print(f"Dropping 'payments.{col}'...")
                conn.execute(text(f'ALTER TABLE payments DROP COLUMN "{col}"'))
                conn.commit()
            else:
                print(f"'payments.{col}' already dropped.")

        # ── 8. Drop orders.payment_method / orders.payment_details ──────────
        for col in ("payment_method", "payment_details"):
            if _column_exists(conn, "orders", col):
                print(f"Dropping 'orders.{col}'...")
                conn.execute(text(f'ALTER TABLE orders DROP COLUMN "{col}"'))
                conn.commit()
            else:
                print(f"'orders.{col}' already dropped.")

    print("\nDone.")


if __name__ == "__main__":
    migrate()
