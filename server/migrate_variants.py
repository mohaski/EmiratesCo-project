from sqlmodel import text
from db.database import engine

def migrate_variants():
    print("Starting Variants Migration (Postgres)...")
    try:
        with engine.connect() as conn:
            # Columns to add
            columns = [
                ("price_half", "FLOAT DEFAULT NULL"),
                ("price_unit", "FLOAT DEFAULT NULL"),
                # Also adding these just in case they are missing too
                ("cutType", "VARCHAR DEFAULT NULL"),
                ("pricePerCut", "FLOAT DEFAULT NULL")
            ]
            
            for col_name, col_type in columns:
                try:
                    # Standard Postgres syntax
                    stmt = f"ALTER TABLE variants ADD COLUMN IF NOT EXISTS \"{col_name}\" {col_type};"
                    print(f"Processing {col_name}...")
                    conn.execute(text(stmt))
                    conn.commit()
                    print(f" - Success.")
                except Exception as e:
                    print(f" - Error processing {col_name}: {e}")
                    conn.rollback()
                    
        print("Migration Complete.")
    except Exception as outer_e:
        print(f"CRITICAL FAIL: {outer_e}")

if __name__ == "__main__":
    migrate_variants()
