"""
Migration: Create the system_settings table (generic key/value store).
First consumer: the CEO-configured 4-digit PIN required to cancel an order.

Run from the server directory:
    python migrate_create_settings.py
"""

from sqlmodel import SQLModel
from db.database import engine
from entities.settings import SystemSetting  # noqa: F401 — registers the table


def migrate():
    print("Creating system_settings table (if missing)...")
    SQLModel.metadata.create_all(engine, tables=[
        SQLModel.metadata.tables["system_settings"],
    ])
    print("  Table verified.")


if __name__ == "__main__":
    migrate()
