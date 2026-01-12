from sqlmodel import create_engine, text
from db.database import DATABASE_URL

print(f"Connecting to {DATABASE_URL}")
engine = create_engine(DATABASE_URL)

try:
    with engine.connect() as connection:
        print("Starting migration: Dropping cutType and pricePerCut from variants...")
        
        # Using separate statements for safety
        try:
            connection.execute(text("ALTER TABLE variants DROP COLUMN IF EXISTS \"cutType\";"))
            print("Dropped cutType.")
        except Exception as e:
            print(f"Error dropping cutType: {e}")

        try:
            connection.execute(text("ALTER TABLE variants DROP COLUMN IF EXISTS \"pricePerCut\";"))
            print("Dropped pricePerCut.")
        except Exception as e:
            print(f"Error dropping pricePerCut: {e}")

        connection.commit()
        print("Migration complete.")
except Exception as e:
    print(f"Migration failed: {e}")
