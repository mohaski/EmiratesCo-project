"""
Migration: Recreate payments table with correct schema.

The payments table may have been created before recorded_by / transaction_ref
columns were added to the entity.  Since the table is always empty after the
clear-tables migration we can safely drop + recreate it.

Run from the server directory:
    python migrate_payments_schema.py
"""

import sys
import os

sys.path.append(os.path.dirname(os.path.abspath(__file__)))

from sqlalchemy import text, inspect
from db.database import engine

# Import all entities so SQLModel.metadata knows about every table
from entities import *  # noqa: F401, F403
from sqlmodel import SQLModel


def run():
    print("=== Payments Schema Migration ===\n")

    with engine.begin() as conn:
        # 1. Show current columns (diagnostic)
        result = conn.execute(text("""
            SELECT column_name, data_type, is_nullable
            FROM information_schema.columns
            WHERE table_name = 'payments'
            ORDER BY ordinal_position
        """))
        rows = result.fetchall()
        if rows:
            print("Current payments table columns:")
            for r in rows:
                print(f"  {r[0]:25s} {r[1]:20s} nullable={r[2]}")
        else:
            print("payments table does not exist yet.")
        print()

        # 2. Confirm
        confirm = input("Drop and recreate the payments table? Type YES to continue: ")
        if confirm.strip() != "YES":
            print("Aborted.")
            sys.exit(0)

        # 3. Drop dependent objects then the table
        conn.execute(text('DROP TABLE IF EXISTS "payments" CASCADE'))
        print("  ✓ Dropped payments table")

        # 4. Drop the payment_method_enum type so it can be recreated cleanly
        conn.execute(text("DROP TYPE IF EXISTS payment_method_enum CASCADE"))
        print("  ✓ Dropped payment_method_enum type")

    # 5. Recreate using SQLModel metadata (outside the transaction above so the
    #    type creation runs in its own transaction context)
    SQLModel.metadata.create_all(engine, tables=[SQLModel.metadata.tables["payments"]])
    print("  ✓ Recreated payments table with correct schema")

    # 6. Show new columns
    with engine.connect() as conn:
        result = conn.execute(text("""
            SELECT column_name, data_type, is_nullable
            FROM information_schema.columns
            WHERE table_name = 'payments'
            ORDER BY ordinal_position
        """))
        print("\nNew payments table columns:")
        for r in result.fetchall():
            print(f"  {r[0]:25s} {r[1]:20s} nullable={r[2]}")

    print("\nDone.")


if __name__ == "__main__":
    run()
