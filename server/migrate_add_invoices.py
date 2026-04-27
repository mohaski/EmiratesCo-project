#!/usr/bin/env python3
"""
Migration: Add invoices table and source_invoice_id column to orders.

Run from the server/ directory:
    python migrate_add_invoices.py
"""

import sys
import os
sys.path.append(os.path.dirname(os.path.abspath(__file__)))

from sqlalchemy import create_engine, text
from db.database import DATABASE_URL


def migrate():
    engine = create_engine(DATABASE_URL)
    with engine.connect() as conn:

        # ── 1. Create invoice_status_enum if it doesn't exist ──────────────
        print("Checking invoice_status_enum...")
        result = conn.execute(text(
            "SELECT 1 FROM pg_type WHERE typname = 'invoice_status_enum'"
        ))
        if not result.fetchone():
            print("  Creating invoice_status_enum...")
            conn.execute(text(
                "CREATE TYPE invoice_status_enum AS ENUM ('draft', 'sent', 'converted', 'cancelled')"
            ))
            print("  Done.")
        else:
            print("  Already exists.")

        # ── 2. Create invoices table ────────────────────────────────────────
        print("Checking invoices table...")
        result = conn.execute(text(
            "SELECT 1 FROM information_schema.tables "
            "WHERE table_schema='public' AND table_name='invoices'"
        ))
        if not result.fetchone():
            print("  Creating invoices table...")
            conn.execute(text("""
                CREATE TABLE invoices (
                    "invoiceId"      SERIAL PRIMARY KEY,
                    invoice_number   VARCHAR NOT NULL,
                    customer_id      INTEGER REFERENCES customers("customerId"),
                    customer_name    VARCHAR,
                    customer_phone   VARCHAR,
                    customer_type    VARCHAR NOT NULL DEFAULT 'guest',
                    created_by       UUID NOT NULL REFERENCES users("userId"),
                    created_at       TIMESTAMP WITHOUT TIME ZONE DEFAULT now(),
                    converted_at     TIMESTAMP WITHOUT TIME ZONE,
                    subtotal         DOUBLE PRECISION NOT NULL DEFAULT 0.0,
                    vat_amount       DOUBLE PRECISION NOT NULL DEFAULT 0.0,
                    total            DOUBLE PRECISION NOT NULL DEFAULT 0.0,
                    discount         DOUBLE PRECISION NOT NULL DEFAULT 0.0,
                    vat_enabled      BOOLEAN NOT NULL DEFAULT FALSE,
                    items            JSONB NOT NULL DEFAULT '[]',
                    notes            TEXT,
                    status           invoice_status_enum NOT NULL DEFAULT 'draft',
                    order_id         INTEGER REFERENCES orders("orderId")
                )
            """))
            conn.execute(text('CREATE INDEX idx_invoices_status ON invoices (status)'))
            conn.execute(text('CREATE INDEX idx_invoices_created_at ON invoices ("created_at")'))
            print("  Done.")
        else:
            print("  Already exists.")

        # ── 3. Add source_invoice_id column to orders ───────────────────────
        print("Checking source_invoice_id column on orders...")
        result = conn.execute(text(
            "SELECT 1 FROM information_schema.columns "
            "WHERE table_name='orders' AND column_name='source_invoice_id'"
        ))
        if not result.fetchone():
            print("  Adding source_invoice_id column...")
            conn.execute(text(
                'ALTER TABLE orders ADD COLUMN source_invoice_id INTEGER '
                'REFERENCES invoices("invoiceId")'
            ))
            print("  Done.")
        else:
            print("  Already exists.")

        conn.commit()
        print("\n✅ Migration complete.")


if __name__ == "__main__":
    migrate()
