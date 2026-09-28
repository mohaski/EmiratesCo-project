"""
Migration: sale windows (parallel open checkouts) + gap-free order numbers.

  1. order_status_enum gains 'held' (an open sale window whose stock is deducted) and
     'abandoned' (a window closed without confirming; its stock was given back).
  2. orders.order_no — the gap-free receipt number, UNIQUE. Existing orders are backfilled
     with order_no = orderId, so every receipt already printed keeps its number; new
     orders continue from the highest existing one.
  3. order_number_counter — the single row order_no is drawn from.
  4. offcuts.held_by_order_id — a remainder private to an open window.
  5. sale_windows — the window sessions.

See core/ordering/windowService.py, core/ordering/orderNumbers.py and
core/inventory/holdScope.py. Additive and non-destructive; safe to re-run.

    python migrate_sale_windows.py
"""
from sqlmodel import SQLModel, Session, text

from db.database import engine
from entities import SaleWindow, OrderNumberCounter  # noqa: F401 - registers the tables


def run(conn, sql, label=None):
    try:
        conn.execute(text(sql))
        print(f"  OK: {label or sql}")
    except Exception as e:
        print(f"  Skipped: {label or sql} ({str(e).splitlines()[0]})")


def migrate():
    # ALTER TYPE ... ADD VALUE can't be used in the transaction that adds it, so each
    # statement is committed on its own.
    with engine.connect().execution_options(isolation_level="AUTOCOMMIT") as conn:
        print("Order statuses...")
        run(conn, "ALTER TYPE order_status_enum ADD VALUE IF NOT EXISTS 'held'")
        run(conn, "ALTER TYPE order_status_enum ADD VALUE IF NOT EXISTS 'abandoned'")

        print("\norders.order_no...")
        run(conn, "ALTER TABLE orders ADD COLUMN IF NOT EXISTS order_no INTEGER")
        run(conn, "CREATE UNIQUE INDEX IF NOT EXISTS ux_orders_order_no ON orders (order_no)")

        print("\noffcuts.held_by_order_id...")
        run(conn, 'ALTER TABLE offcuts ADD COLUMN IF NOT EXISTS held_by_order_id INTEGER '
                  'REFERENCES orders ("orderId")')
        run(conn, "CREATE INDEX IF NOT EXISTS ix_offcuts_held_by_order_id ON offcuts (held_by_order_id)")

    print("\nsale_windows / order_number_counter tables...")
    SQLModel.metadata.create_all(engine, tables=[SaleWindow.__table__, OrderNumberCounter.__table__])
    print("  OK")

    with Session(engine) as session:
        seeded = session.exec(text("SELECT count(*) FROM order_number_counter")).first()[0] > 0
        if not seeded:
            # First run: every existing order keeps its current number as its receipt number.
            print("\nBackfilling order_no = orderId for existing orders...")
            result = session.exec(text('''
                UPDATE orders SET order_no = "orderId"
                WHERE order_no IS NULL AND status NOT IN ('held', 'abandoned')
            '''))
            top = session.exec(text("SELECT COALESCE(MAX(order_no), 0) FROM orders")).first()[0]
            session.exec(text("INSERT INTO order_number_counter (id, last_no) VALUES (1, :top)").bindparams(top=top))
            session.commit()
            print(f"  Updated {result.rowcount} order(s).")
        else:
            # Re-run: orders taken by the OLD code between the first run and the service restart
            # have no number. They must be numbered from the counter, never from orderId — the new
            # code may already have handed out that value.
            stragglers = session.exec(text('''
                SELECT "orderId" FROM orders
                WHERE order_no IS NULL AND status NOT IN ('held', 'abandoned')
                ORDER BY created_at, "orderId"
            ''')).all()
            for (order_id,) in stragglers:
                no = session.exec(text(
                    "UPDATE order_number_counter SET last_no = last_no + 1 WHERE id = 1 RETURNING last_no"
                )).first()[0]
                session.exec(text('UPDATE orders SET order_no = :no WHERE "orderId" = :o').bindparams(no=no, o=order_id))
            session.commit()
            print(f"\nCounter already initialised; numbered {len(stragglers)} order(s) taken since the first run.")
        counter = session.exec(text("SELECT last_no FROM order_number_counter WHERE id = 1")).first()[0]
        print(f"  Counter at {counter}; the next confirmed order is no. {counter + 1}.")

        missing = session.exec(text('''
            SELECT count(*) FROM orders
            WHERE order_no IS NULL AND status NOT IN ('held', 'abandoned')
        ''')).first()[0]
        print(f"\nReal orders without an order_no: {missing} (expected 0)")
        print("Migration complete.")


if __name__ == "__main__":
    migrate()
