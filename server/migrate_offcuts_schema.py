from sqlmodel import SQLModel, create_engine, text
from db.database import DATABASE_URL
from entities.offcuts import Offcut
from entities.products import Product
from entities.variants import Variant

def migrate():
    engine = create_engine(DATABASE_URL)
    with engine.connect() as conn:
        print("Dropping existing offcuts table...")
        try:
            # Postgres: Use CASCADE to handle FKs
            conn.execute(text("DROP TABLE IF EXISTS offcuts CASCADE"))
            conn.commit()
            print("Dropped successfully.")
        except Exception as e:
            print(f"Error dropping table: {e}")

    print("Creating new offcuts table...")
    SQLModel.metadata.create_all(engine)
    print("Migration complete.")

if __name__ == "__main__":
    migrate()
