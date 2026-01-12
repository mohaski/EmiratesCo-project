from sqlalchemy import create_engine, text
from db.database import DATABASE_URL

def migrate():
    engine = create_engine(DATABASE_URL)
    with engine.connect() as conn:
        print("Migrating unit_type from Enum to Varchar...")
        try:
            # 1. Alter Column Type
            # Postgres requires explicit cast for Enum -> Text
            conn.execute(text("ALTER TABLE orderitems ALTER COLUMN unit_type TYPE VARCHAR(50) USING unit_type::character varying"))
            
            # 2. Drop the old Enum Type (optional but cleaner)
            conn.execute(text("DROP TYPE IF EXISTS unit_type_enum"))
            
            conn.commit()
            print("Migration successful.")
        except Exception as e:
            print(f"Migration failed: {e}")
            # Identify if error is because it's already done or simple text
            if "does not exist" in str(e):
                print("Enum type might not exist or column is already text.")

if __name__ == "__main__":
    migrate()
