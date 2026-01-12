from sqlmodel import Session, select, create_engine, text, SQLModel, Field
from sqlalchemy import Column, JSON
from typing import List, Dict, Any, Optional
from db.database import engine
import json

# Define Local Model to avoid Relationship issues during migration
class Category(SQLModel, table=True):
    __tablename__ = "categories"
    categoryId: Optional[int] = Field(default=None, primary_key=True)
    name: str
    type: str
    sub_categories: List[Dict[str, Any]] = Field(default=[], sa_column=Column(JSON))

def migrate():
    with Session(engine) as session:
        print("Starting Category Migration...")
        
        # 1. Add Column if not exists
        try:
            session.exec(text("ALTER TABLE categories ADD COLUMN sub_categories JSON DEFAULT '[]'"))
            print("Added sub_categories column.")
        except Exception as e:
            # Ignore if column exists
            print(f"Column check: {e}")
            session.rollback()

        # 2. Seed Data
        SUB_CATEGORIES = {
            'ke-profile': [
                { 'id': 'window', 'label': 'Windows' },
                { 'id': 'door', 'label': 'Doors' },
                { 'id': 'general', 'label': 'General' },
            ],
            'tz-profile': [
                { 'id': 'window', 'label': 'Windows' },
                { 'id': 'door', 'label': 'Doors' },
                { 'id': 'general', 'label': 'General' },
            ],
            'glass': [
                { 'id': 'clear', 'label': 'Clear' },
                { 'id': 'oneway', 'label': 'One/Way' },
                { 'id': 'tint', 'label': 'Tinted' },
                { 'id': 'mirror', 'label': 'Mirror' },
                { 'id': 'frost', 'label': 'Frost' },
                { 'id': 'obscure', 'label': 'Obscure' },
                { 'id': 'alucoboard', 'label': 'Alucoboard' },
            ],
            'accessories': [
                { 'id': 'window', 'label': 'Windows' },
                { 'id': 'door', 'label': 'Doors' },
                { 'id': 'general', 'label': 'General' },
            ]
        }

        # Query using local model
        categories = session.exec(select(Category)).all()
        for cat in categories:
            if cat.type in SUB_CATEGORIES:
                print(f"Updating category {cat.name} ({cat.type})...")
                cat.sub_categories = SUB_CATEGORIES[cat.type]
                session.add(cat)
            else:
                 if cat.sub_categories is None:
                    cat.sub_categories = []
                    session.add(cat)
        
        session.commit()
        print("Migration Complete.")

if __name__ == "__main__":
    migrate()
