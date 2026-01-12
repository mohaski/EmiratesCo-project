from sqlmodel import Session, select, create_engine, text
from db.database import engine

def migrate():
    with Session(engine) as session:
        print("Starting Length Field Migration...")
        
        # 1. Add Column to Products
        try:
            session.exec(text("ALTER TABLE products ADD COLUMN length FLOAT DEFAULT NULL"))
            print("Added length column to products.")
        except Exception as e:
            print(f"Product column check: {e}")
            session.rollback()

        # 2. Add Column to Variants
        try:
            # Check if variant table exists (it should)
            session.exec(text("ALTER TABLE variants ADD COLUMN length FLOAT DEFAULT NULL"))
            print("Added length column to variants.")
        except Exception as e:
            print(f"Variant column check: {e}")
            session.rollback()

        session.commit()
        print("Migration Complete.")

if __name__ == "__main__":
    migrate()
