"""Backfill: give old split refund rows the same sign as their amount.

Split cancel refunds used to be stored as amount=-1000 with payment_details
{cash: +400, mpesa: +600}. get_financial_summary now reads such rows correctly
(core/financials/splitDetails.signed_split_parts), so the dashboard is right
either way; this rewrites the rows themselves so anything else reading
payment_details sees the stored rule (every part signed like the amount).

Report-only unless --apply is given. --apply first copies the affected rows
into payments_split_sign_backup (created if missing), then rewrites them, in
one transaction. Idempotent: a fixed row no longer matches.

    python migrate_split_refund_signs.py                          # report, app database
    python migrate_split_refund_signs.py --apply                  # fix, app database
    python migrate_split_refund_signs.py --db emiratesco_edit_test --apply
"""
import sys

from sqlmodel import create_engine, text

from config import settings

# Negative split rows whose parts are all >= 0 and not all zero: the shape the old
# cancel path wrote. Rows with mixed signs are left alone and listed — they need a person.
MATCH = """
    payment_method = 'split' AND amount < 0 AND payment_details IS NOT NULL
    AND coalesce((payment_details::jsonb->>'cash')::numeric, 0) >= 0
    AND coalesce((payment_details::jsonb->>'mpesa')::numeric, 0) >= 0
    AND coalesce((payment_details::jsonb->>'cash')::numeric, 0)
      + coalesce((payment_details::jsonb->>'mpesa')::numeric, 0) > 0
"""
MIXED = """
    payment_method = 'split' AND payment_details IS NOT NULL
    AND least(coalesce((payment_details::jsonb->>'cash')::numeric, 0),
              coalesce((payment_details::jsonb->>'mpesa')::numeric, 0)) < 0
    AND greatest(coalesce((payment_details::jsonb->>'cash')::numeric, 0),
                 coalesce((payment_details::jsonb->>'mpesa')::numeric, 0)) > 0
"""


def engine_for(db_name=None):
    url = settings.get_database_url()
    if db_name:
        base, _, _ = url.rpartition("/")
        url = f"{base}/{db_name}"
    return create_engine(url, echo=False)


def main():
    db_name = sys.argv[sys.argv.index("--db") + 1] if "--db" in sys.argv else None
    apply = "--apply" in sys.argv
    engine = engine_for(db_name)

    with engine.begin() as conn:
        database = conn.execute(text("SELECT current_database()")).scalar()
        rows = conn.execute(text(f"""
            SELECT "paymentId", "orderId", amount, payment_details::text, payed_at
            FROM payments WHERE {MATCH} ORDER BY payed_at
        """)).fetchall()
        mixed = conn.execute(text(f"""
            SELECT "paymentId", "orderId", amount, payment_details::text
            FROM payments WHERE {MIXED} ORDER BY payed_at
        """)).fetchall()

        print(f"Database: {database}")
        print(f"Split refunds stored with positive parts: {len(rows)}")
        for r in rows:
            print(f"  payment {r[0]}  order {r[1]}  amount {r[2]:,.2f}  details {r[3]}  at {r[4]}")
        if mixed:
            print(f"\nSplit rows with mixed-sign parts (left alone, check by hand): {len(mixed)}")
            for r in mixed:
                print(f"  payment {r[0]}  order {r[1]}  amount {r[2]:,.2f}  details {r[3]}")

        if not apply:
            print("\nReport only. Run again with --apply to rewrite these rows.")
            return
        if not rows:
            print("\nNothing to fix.")
            return

        conn.execute(text("""
            CREATE TABLE IF NOT EXISTS payments_split_sign_backup (
                "paymentId" INTEGER, payment_details_before JSON, backed_up_at TIMESTAMP DEFAULT now()
            )
        """))
        conn.execute(text(f"""
            INSERT INTO payments_split_sign_backup ("paymentId", payment_details_before)
            SELECT "paymentId", payment_details FROM payments WHERE {MATCH}
        """))
        updated = conn.execute(text(f"""
            UPDATE payments SET payment_details = jsonb_build_object(
                'cash',  -coalesce((payment_details::jsonb->>'cash')::numeric, 0),
                'mpesa', -coalesce((payment_details::jsonb->>'mpesa')::numeric, 0))::json
            WHERE {MATCH}
        """)).rowcount
        print(f"\nRewrote {updated} row(s); originals saved in payments_split_sign_backup.")


if __name__ == "__main__":
    main()
