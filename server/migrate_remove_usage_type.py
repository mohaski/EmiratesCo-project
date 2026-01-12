from sqlmodel import Session, text
from db.database import engine

def migrate_remove_usage_type():
    with Session(engine) as session:
        try:
            # Check if column exists
            result = session.exec(text("SELECT column_name FROM information_schema.columns WHERE table_name='products' AND column_name='usage_type'"))
            if not result.first():
                print("Column 'usage_type' does not exist in 'products' table. Nothing to do.")
                return

            # Drop column
            print("Dropping 'usage_type' column from 'products' table...")
            session.exec(text("ALTER TABLE products DROP COLUMN \"usage_type\""))
            session.commit()
            print("Successfully dropped 'usage_type' column.")
            
        except Exception as e:
            print(f"Error during migration: {e}")
            session.rollback()

if __name__ == "__main__":
    migrate_remove_usage_type()
