"""
Migration: Create attribute_classes / attribute_values tables and seed the
defaults that used to live only in the client's hardcoded INITIAL_ATTRIBUTES
(client/src/pages/AddProductPage.jsx), so attribute classes persist across
reloads instead of resetting to the hardcoded list every session.

Run from the server directory:
    python migrate_create_attributes.py
"""

import sys
import os

sys.path.append(os.path.dirname(os.path.abspath(__file__)))

from sqlmodel import Session, SQLModel, select
from db.database import engine
from entities.attributes import AttributeClass, AttributeValue

DEFAULTS = {
    'Color': ['White', 'Silver', 'Gold', 'Brown', 'Grey', 'Matt Black'],
    'Thickness': ['4mm', '5mm', '6mm', '8mm', '10mm', '12mm'],
    'Length': ['21ft', '17ft', '16ft', '15ft'],
    'Size': ['Standard', 'Large', 'Small'],
}


def migrate():
    print("Creating attribute_classes / attribute_values tables (if missing)...")
    SQLModel.metadata.create_all(engine, tables=[
        SQLModel.metadata.tables["attribute_classes"],
        SQLModel.metadata.tables["attribute_values"],
    ])
    print("  Tables verified.")

    with Session(engine) as db:
        for class_name, values in DEFAULTS.items():
            ac = db.exec(select(AttributeClass).where(AttributeClass.name == class_name)).first()
            if not ac:
                ac = AttributeClass(name=class_name, type="list")
                db.add(ac)
                db.commit()
                db.refresh(ac)
                print(f"  + created class: {class_name}")
            else:
                print(f"  = class already exists: {class_name}")

            existing_values = {v.value for v in ac.values}
            for value in values:
                if value not in existing_values:
                    db.add(AttributeValue(attribute_class_id=ac.attributeClassId, value=value))
                    print(f"    + added value: {class_name} / {value}")
            db.commit()

    print("Seed complete.")


if __name__ == "__main__":
    migrate()
