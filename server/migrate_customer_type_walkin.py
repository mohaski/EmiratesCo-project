#!/usr/bin/env python3
"""
Migration: Create customer_type enum and convert customers.type from VARCHAR.

Values: individual | cooperate | walk-in

Run from the server/ directory:
    python migrate_customer_type_walkin.py
"""

import sys
import os
sys.path.append(os.path.dirname(os.path.abspath(__file__)))

from sqlalchemy import create_engine, text
from db.database import DATABASE_URL

ENUM_VALUES = ('individual', 'cooperate', 'walk-in')


def migrate():
    engine = create_engine(DATABASE_URL)

    # ALTER TYPE ADD VALUE and ALTER COLUMN TYPE must run outside a transaction
    # block in PostgreSQL, so we use autocommit via raw connection.
    raw_conn = engine.raw_connection()
    raw_conn.set_isolation_level(0)  # AUTOCOMMIT
    cur = raw_conn.cursor()

    try:
        # ── 1. Check whether the enum type exists ──────────────────────────
        print("Checking if customer_type enum exists...")
        cur.execute(
            "SELECT 1 FROM pg_type WHERE typname = 'customer_type'"
        )
        enum_exists = bool(cur.fetchone())

        if not enum_exists:
            print("  Creating customer_type enum with values:", ENUM_VALUES)
            values_sql = ", ".join(f"'{v}'" for v in ENUM_VALUES)
            cur.execute(f"CREATE TYPE customer_type AS ENUM ({values_sql})")
            print("  Done.")
        else:
            # Enum already exists — make sure walk-in is in it
            cur.execute(
                "SELECT enumlabel FROM pg_enum "
                "JOIN pg_type ON pg_enum.enumtypid = pg_type.oid "
                "WHERE pg_type.typname = 'customer_type'"
            )
            existing = [row[0] for row in cur.fetchall()]
            print(f"  Enum already exists with values: {existing}")
            if 'walk-in' not in existing:
                print("  Adding 'walk-in'...")
                cur.execute("ALTER TYPE customer_type ADD VALUE 'walk-in'")
                print("  Done.")
            else:
                print("  'walk-in' already present.")

        # ── 2. Convert the column if it is still VARCHAR ───────────────────
        print("Checking customers.type column data type...")
        cur.execute(
            "SELECT data_type FROM information_schema.columns "
            "WHERE table_name='customers' AND column_name='type'"
        )
        row = cur.fetchone()
        col_type = row[0] if row else None
        print(f"  Current type: {col_type}")

        if col_type and 'character' in col_type:
            print("  Converting VARCHAR -> customer_type enum...")
            # Normalise any unexpected values to 'individual' before casting
            allowed = ", ".join(f"'{v}'" for v in ENUM_VALUES)
            cur.execute(f"""
                ALTER TABLE customers
                    ALTER COLUMN type
                    TYPE customer_type
                    USING (
                        CASE WHEN type IN ({allowed})
                             THEN type::customer_type
                             ELSE 'individual'::customer_type
                        END
                    )
            """)
            print("  Done.")
        else:
            print("  Column is already the correct type.")

        print("\nMigration complete.")

    finally:
        cur.close()
        raw_conn.close()


if __name__ == "__main__":
    migrate()
