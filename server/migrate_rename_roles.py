"""
Migration: Rename user_role_enum values —
    seniorCashier -> manager
    juniorCashier -> cashier

Postgres enum labels are stored by OID, not by string, so ALTER TYPE ...
RENAME VALUE updates every existing row referencing the old label in place —
no UPDATE against the users table is needed.

Run from the server directory:
    python migrate_rename_roles.py
"""

from sqlmodel import Session, text
from db.database import engine


def migrate():
    with Session(engine) as session:
        print("Renaming user_role_enum value seniorCashier -> manager...")
        try:
            session.exec(text("ALTER TYPE user_role_enum RENAME VALUE 'seniorCashier' TO 'manager'"))
            session.commit()
            print("  Renamed.")
        except Exception as e:
            print(f"  Skipped: {e}")
            session.rollback()

        print("Renaming user_role_enum value juniorCashier -> cashier...")
        try:
            session.exec(text("ALTER TYPE user_role_enum RENAME VALUE 'juniorCashier' TO 'cashier'"))
            session.commit()
            print("  Renamed.")
        except Exception as e:
            print(f"  Skipped: {e}")
            session.rollback()

        print("Migration complete.")


if __name__ == "__main__":
    migrate()
