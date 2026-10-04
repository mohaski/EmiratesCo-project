"""
Migration: shift timestamps the app wrote as naive UTC to Africa/Nairobi time (+3h).

Columns filled by server_default now() (orders.created_at, payments.payed_at, ...) were
already Nairobi local time, but these were written from Python with datetime.utcnow(),
so they sat three hours behind everything else:

    offcuts.created_at, orderitems.cutting_completed_at, credits."settledAt",
    offcut_pieces.produced_at / consumed_at, offcut_piece_events.at,
    stock_operations.created_at, stock_journal.at, stock_baseline.taken_at

The app now writes them with config.nairobi_now(). This brings existing rows into the
same frame. It records itself in system_settings and refuses to run twice.

Order matters — stop the server, deploy the new code, run this, then start the server.
Rows written by the new code are already Nairobi time and must not be shifted again.

Not shifted: timestamps copied into JSON (stock_journal before/after images, op
summaries). Undoing an operation recorded before this migration can restore a
cutting_completed_at / consumed_at value that is three hours early; nothing compares
those against the clock, so it only affects what is displayed.

Run from the server directory:
    python migrate_timestamps_to_nairobi.py
"""

from sqlmodel import Session, text
from db.database import engine

MARKER_KEY = "migration.timestamps_to_nairobi"

COLUMNS = [
    ("offcuts", "created_at"),
    ("orderitems", "cutting_completed_at"),
    ("credits", '"settledAt"'),
    ("offcut_pieces", "produced_at"),
    ("offcut_pieces", "consumed_at"),
    ("offcut_piece_events", "at"),
    ("stock_operations", "created_at"),
    ("stock_journal", "at"),
    ("stock_baseline", "taken_at"),
]


def migrate():
    with Session(engine) as session:
        done = session.exec(text("SELECT value FROM system_settings WHERE key = :k"),
                            params={"k": MARKER_KEY}).first()
        if done:
            print(f"Already applied ({done[0]}). Nothing to do.")
            return

        try:
            for table, column in COLUMNS:
                result = session.exec(text(
                    f"UPDATE {table} SET {column} = {column} + INTERVAL '3 hours' "
                    f"WHERE {column} IS NOT NULL"
                ))
                print(f"  {table}.{column}: shifted {result.rowcount} row(s)")
            session.exec(text(
                "INSERT INTO system_settings (key, value) VALUES (:k, now()::text)"
            ), params={"k": MARKER_KEY})
            session.commit()
            print("Done.")
        except Exception as e:
            session.rollback()
            print(f"Failed, nothing changed: {e}")
            raise


if __name__ == "__main__":
    migrate()
