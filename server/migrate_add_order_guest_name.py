from sqlalchemy import create_engine, text
from db.database import DATABASE_URL

def migrate():
    engine = create_engine(DATABASE_URL)
    with engine.connect() as conn:
        print("Checking if 'guest_name' column exists in 'orders' table...")
        try:
            result = conn.execute(text("SELECT column_name FROM information_schema.columns WHERE table_name='orders' AND column_name='guest_name'"))
            if result.fetchone():
                print("Column 'guest_name' already exists.")
            else:
                print("Adding 'guest_name' column to 'orders' table...")
                conn.execute(text("ALTER TABLE orders ADD COLUMN guest_name VARCHAR"))
                conn.commit()
                print("Column added successfully.")
        except Exception as e:
            print(f"Error during migration: {e}")

if __name__ == "__main__":
    migrate()
