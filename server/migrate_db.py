from sqlmodel import text
from db.database import engine

def migrate():
    print("Starting Migration (Postgres)...")
    try:
        with engine.connect() as conn:
            # We wrap in a block. Queries will run.
            # Using IF NOT EXISTS is safe in Postgres.
            
            columns = [
                ("has_variants", "BOOLEAN DEFAULT FALSE"),
                ("stock_quantity", "INTEGER DEFAULT 0"),
                ("usage_type", "VARCHAR DEFAULT 'general'"),
                ("track_offcuts", "BOOLEAN DEFAULT FALSE"),
                ("alarm_quantity", "INTEGER DEFAULT 0")
            ]
            
            for col_name, col_type in columns:
                try:
                    stmt = f"ALTER TABLE products ADD COLUMN IF NOT EXISTS {col_name} {col_type};"
                    print(f"Processing {col_name}...")
                    conn.execute(text(stmt))
                    conn.commit() # Ensure committed immediately
                    print(f" - Success.")
                except Exception as e:
                    print(f" - Error processing {col_name}: {e}")
                    conn.rollback() # Important: Rollback to clear aborted state if any error
                    
        print("Migration Complete.")
    except Exception as outer_e:
        print(f"CRITICAL FAIL: {outer_e}")

if __name__ == "__main__":
    migrate()
