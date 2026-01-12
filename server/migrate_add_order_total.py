from sqlalchemy import create_engine, text
from db.database import DATABASE_URL

def migrate():
    engine = create_engine(DATABASE_URL)
    with engine.connect() as conn:
        print("Checking if 'total' column exists in 'orders' table...")
        try:
            # Check if column exists (Postgres)
            result = conn.execute(text("SELECT column_name FROM information_schema.columns WHERE table_name='orders' AND column_name='total'"))
            if result.fetchone():
                print("Column 'total' already exists.")
            else:
                print("Adding 'total' column to 'orders' table...")
                conn.execute(text("ALTER TABLE orders ADD COLUMN total DOUBLE PRECISION DEFAULT 0.0"))
                conn.commit()
                print("Column added successfully.")
        except Exception as e:
            print(f"Error during migration: {e}")

if __name__ == "__main__":
    migrate()
