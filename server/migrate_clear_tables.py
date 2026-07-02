"""
Migration: Clear data from orders, orderitems, products, and payments tables.

Resets identity sequences so IDs restart from 1.
Uses CASCADE to handle FK dependencies (variants, offcuts, credits, etc.)
without touching tables outside the requested scope.

Run from the server directory:
    python migrate_clear_tables.py
"""

import sys
import os

sys.path.append(os.path.dirname(os.path.abspath(__file__)))

from sqlalchemy import text
from db.database import engine

TABLES = [
    "orderitems",   # FK → orders, products — must go before orders/products
    "payments",     # FK → orders
    "offcuts",      # FK → products
    "orders",       # FK → customers, users
    "variants",     # FK → products — must go before products
    "products",     # base product table (also clears categories row refs via CASCADE)
]

def run():
    print("=== Clear Tables Migration ===")
    print(f"Tables: {', '.join(TABLES)}\n")

    confirm = input("This will permanently delete all data in the listed tables. Type YES to continue: ")
    if confirm.strip() != "YES":
        print("Aborted.")
        sys.exit(0)

    with engine.begin() as conn:
        for table in TABLES:
            conn.execute(text(f'TRUNCATE TABLE "{table}" RESTART IDENTITY CASCADE'))
            print(f"  ✓ Cleared: {table}")

    print("\nDone. All listed tables are empty and sequences reset.")

if __name__ == "__main__":
    run()
