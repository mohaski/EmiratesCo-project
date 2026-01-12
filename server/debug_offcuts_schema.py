from sqlalchemy import create_engine, inspect
from db.database import DATABASE_URL

def inspect_schema():
    engine = create_engine(DATABASE_URL)
    inspector = inspect(engine)
    
    if inspector.has_table("offcuts"):
        print("Table 'offcuts' EXISTS.")
        columns = inspector.get_columns("offcuts")
        print("Columns:")
        for col in columns:
            print(f" - {col['name']} ({col['type']})")
    else:
        print("Table 'offcuts' DOES NOT EXIST.")

if __name__ == "__main__":
    inspect_schema()
