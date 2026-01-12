from sqlalchemy import create_engine, text
from db.database import DATABASE_URL

def migrate():
    engine = create_engine(DATABASE_URL)
    with engine.connect() as conn:
        print("Dropping quantity, unit_price, unit_type from orderitems...")
        try:
            conn.execute(text("ALTER TABLE orderitems DROP COLUMN IF EXISTS quantity CASCADE"))
            conn.execute(text("ALTER TABLE orderitems DROP COLUMN IF EXISTS unit_price CASCADE"))
            conn.execute(text("ALTER TABLE orderitems DROP COLUMN IF EXISTS unit_type CASCADE"))
            conn.commit()
            print("Dropped successfully.")
        except Exception as e:
            print(f"Error dropping columns: {e}")

if __name__ == "__main__":
    migrate()
