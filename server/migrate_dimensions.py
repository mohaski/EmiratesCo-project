from sqlmodel import Session, text
from db.database import engine

def migrate():
    with Session(engine) as session:
        print("Starting Dimensions Migration (width/height)...")

        for table, col in [("products", "width"), ("products", "height"), ("variants", "width"), ("variants", "height")]:
            try:
                session.exec(text(f"ALTER TABLE {table} ADD COLUMN {col} FLOAT DEFAULT NULL"))
                print(f"  Added {col} to {table}.")
            except Exception as e:
                print(f"  Skipped {table}.{col}: {e}")
                session.rollback()

        session.commit()
        print("Migration complete.")

if __name__ == "__main__":
    migrate()
