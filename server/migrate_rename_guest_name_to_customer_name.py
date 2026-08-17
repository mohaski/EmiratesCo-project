from sqlalchemy import create_engine, text
from db.database import DATABASE_URL


def migrate():
    engine = create_engine(DATABASE_URL)
    with engine.connect() as conn:
        has_guest_name = conn.execute(text(
            "SELECT column_name FROM information_schema.columns "
            "WHERE table_name='orders' AND column_name='guest_name'"
        )).fetchone()
        has_customer_name = conn.execute(text(
            "SELECT column_name FROM information_schema.columns "
            "WHERE table_name='orders' AND column_name='customer_name'"
        )).fetchone()

        if has_customer_name:
            print("Column 'customer_name' already exists on 'orders'.")
        elif has_guest_name:
            print("Renaming 'orders.guest_name' -> 'orders.customer_name'...")
            conn.execute(text("ALTER TABLE orders RENAME COLUMN guest_name TO customer_name"))
            conn.commit()
            print("Column renamed.")
        else:
            print("Neither 'guest_name' nor 'customer_name' found — adding 'customer_name' column...")
            conn.execute(text("ALTER TABLE orders ADD COLUMN customer_name VARCHAR"))
            conn.commit()
            print("Column added.")

        print("Backfilling customer_name for orders placed by registered customers...")
        result = conn.execute(text(
            """
            UPDATE orders
            SET customer_name = customers."name"
            FROM customers
            WHERE orders.customerid = customers."customerId"
              AND (orders.customer_name IS NULL OR orders.customer_name <> customers."name")
            """
        ))
        conn.commit()
        print(f"Backfilled {result.rowcount} order(s) with their registered customer's name.")


if __name__ == "__main__":
    migrate()
