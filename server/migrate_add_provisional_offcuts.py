"""
Migration: provisional offcuts (PROVISIONAL_OFFCUTS_PLAN.md, phase 1).

  offcuts.provisional_for INTEGER[] NOT NULL DEFAULT '{}' - the open sale windows whose uncut
  cut a 1D offcut depends on (entities/offcuts.py). GIN-indexed: "every row marked by window N"
  is what a window's confirm and release look up.

The feature switch (system_settings 'provisional_offcuts_enabled') is not created here: absent
means off, so this migration changes no behaviour. Additive and non-destructive; safe to re-run.
Run it BEFORE starting the new server code - the Offcut entity selects the column.

    python migrate_add_provisional_offcuts.py
"""
from sqlmodel import text

from db.database import engine


def run(conn, sql, label=None):
    try:
        conn.execute(text(sql))
        print(f"  OK: {label or sql}")
    except Exception as e:
        print(f"  Skipped: {label or sql} ({str(e).splitlines()[0]})")


def migrate():
    with engine.connect().execution_options(isolation_level="AUTOCOMMIT") as conn:
        print("offcuts.provisional_for...")
        run(conn, "ALTER TABLE offcuts ADD COLUMN IF NOT EXISTS provisional_for INTEGER[] "
                  "NOT NULL DEFAULT '{}'")
        run(conn, "CREATE INDEX IF NOT EXISTS ix_offcuts_provisional_for ON offcuts "
                  "USING GIN (provisional_for)")
        marked = conn.execute(text("SELECT count(*) FROM offcuts WHERE provisional_for <> '{}'")).scalar()
        print(f"\n  Rows marked provisional: {marked} (0 expected on first run)")
    print("Done.")


if __name__ == "__main__":
    migrate()
