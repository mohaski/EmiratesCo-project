from sqlmodel import Session, text
from db.database import engine

def seed_categories():
    categories = [
        {"name": "Kenyan Profile", "type": "ke-profile"},
        {"name": "Tanzania Profile", "type": "tz-profile"},
        {"name": "Glass", "type": "glass"},
        {"name": "Accessories", "type": "accessories"}
    ]

    with Session(engine) as session:
        print("Checking categories...")
        for cat_data in categories:
            # Check if exists
            query = text('SELECT "categoryId" FROM categories WHERE type = :type')
            existing = session.exec(query, params={"type": cat_data["type"]}).first()
            
            if not existing:
                print(f"Adding: {cat_data['name']}")
                insert = text("INSERT INTO categories (name, type) VALUES (:name, :type)")
                session.exec(insert, params=cat_data)
            else:
                print(f"Exists: {cat_data['name']}")
        
        session.commit()
        print("Seeding complete.")

if __name__ == "__main__":
    seed_categories()
