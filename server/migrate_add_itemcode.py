from sqlmodel import Session, text
from db.database import engine

def migrate_item_code():
    with Session(engine) as session:
        try:
            # Check if column exists
            result = session.exec(text("SELECT column_name FROM information_schema.columns WHERE table_name='products' AND column_name='itemCode'"))
            if result.first():
                print("Column 'itemCode' already exists in 'products' table.")
                return

            # Add column
            print("Adding 'itemCode' column to 'products' table...")
            session.exec(text("ALTER TABLE products ADD COLUMN \"itemCode\" VARCHAR"))
            session.commit()
            print("Successfully added 'itemCode' column.")
            
        except Exception as e:
            print(f"Error during migration: {e}")
            session.rollback()

if __name__ == "__main__":
    migrate_item_code()
