from sqlmodel import create_engine, text
from db.database import DATABASE_URL

print(f"Connecting to {DATABASE_URL}")
engine = create_engine(DATABASE_URL)

try:
    with engine.connect() as connection:
        print("Starting migration: Adding 'type' column to customers table...")
        
        # 1. Check if column exists, if not continue
        # Simple approach: Try adding it, catch error if exists or handle via explicit checks
        # Better: Check information_schema logic or just try adding type if not exists
        
        # Create Enum Type first
        try:
            connection.execute(text("CREATE TYPE customer_type AS ENUM ('individual', 'cooperate');"))
            print("Created Enum Type 'customer_type'.")
        except Exception as e:
            print(f"Enum Type might already exist: {e}")
            
        # Add Column
        try:
            connection.execute(text("ALTER TABLE customers ADD COLUMN type customer_type DEFAULT 'individual' NOT NULL;"))
            print("Added 'type' column.")
        except Exception as e:
            print(f"Error adding column (maybe it exists?): {e}")

        connection.commit()
        print("Migration complete.")
except Exception as e:
    print(f"Migration failed: {e}")
