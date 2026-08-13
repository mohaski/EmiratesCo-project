"""
Migration: Reassign the 'storeManager' role and drop stale enum values.

Postgres enums can't have a value removed in place — it requires creating a
replacement type with only the wanted labels, repointing the column at it,
then dropping the old type. Any row still referencing a dropped label would
fail the column type-change, so rows using 'storeManager' are reassigned to
'manager' first. 'stockManager' is dropped too — it's defined on the enum but
referenced by zero rows, left over from the same earlier role scheme.

Run from the server directory:
    python migrate_cleanup_role_enum.py
"""

from sqlalchemy import create_engine, text
from db.database import DATABASE_URL

KEEP_ROLES = ["admin", "ceo", "manager", "cashier"]


def migrate():
    engine = create_engine(DATABASE_URL)
    with engine.connect() as conn:
        print("Reassigning users with role 'storeManager' to 'manager'...")
        result = conn.execute(text("UPDATE users SET role = 'manager' WHERE role::text = 'storeManager'"))
        conn.commit()
        print(f"  Updated {result.rowcount} row(s).")

        print("Recreating user_role_enum with only", KEEP_ROLES, "...")
        conn.execute(text(
            "CREATE TYPE user_role_enum_new AS ENUM (" +
            ", ".join(f"'{r}'" for r in KEEP_ROLES) +
            ")"
        ))
        conn.execute(text(
            "ALTER TABLE users ALTER COLUMN role TYPE user_role_enum_new USING role::text::user_role_enum_new"
        ))
        conn.execute(text("DROP TYPE user_role_enum"))
        conn.execute(text("ALTER TYPE user_role_enum_new RENAME TO user_role_enum"))
        conn.commit()
        print("  Done.")


if __name__ == "__main__":
    migrate()
