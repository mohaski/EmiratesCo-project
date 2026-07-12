from fastapi import HTTPException
from sqlmodel import Session, select
from entities.attributes import AttributeClass, AttributeValue
from loggiing import logger
from . import model


def get_all_attribute_classes(db: Session) -> list:
    return db.exec(select(AttributeClass)).all()


def create_attribute_class(data: model.AttributeClassCreate, db: Session) -> AttributeClass:
    if data.type not in ("list", "custom"):
        raise HTTPException(status_code=400, detail='type must be "list" or "custom"')

    existing = db.exec(select(AttributeClass).where(AttributeClass.name == data.name)).first()
    if existing:
        raise HTTPException(status_code=400, detail=f'Attribute class "{data.name}" already exists')

    ac = AttributeClass(name=data.name, type=data.type)
    db.add(ac)
    db.commit()
    db.refresh(ac)
    logger.info(f"Attribute class created: {ac.name} ({ac.type})")
    return ac


def rename_attribute_class(class_id: int, data: model.AttributeClassRename, db: Session) -> AttributeClass:
    ac = db.get(AttributeClass, class_id)
    if not ac:
        raise HTTPException(status_code=404, detail="Attribute class not found")

    existing = db.exec(
        select(AttributeClass).where(AttributeClass.name == data.name, AttributeClass.attributeClassId != class_id)
    ).first()
    if existing:
        raise HTTPException(status_code=400, detail=f'Attribute class "{data.name}" already exists')

    ac.name = data.name
    db.add(ac)
    db.commit()
    db.refresh(ac)
    return ac


def delete_attribute_class(class_id: int, db: Session) -> dict:
    ac = db.get(AttributeClass, class_id)
    if not ac:
        raise HTTPException(status_code=404, detail="Attribute class not found")
    db.delete(ac)
    db.commit()
    return {"message": "Attribute class deleted", "id": class_id}


def add_attribute_value(class_id: int, data: model.AttributeValueCreate, db: Session) -> AttributeValue:
    ac = db.get(AttributeClass, class_id)
    if not ac:
        raise HTTPException(status_code=404, detail="Attribute class not found")
    if ac.type != "list":
        raise HTTPException(status_code=400, detail="Custom attribute classes don't have a shared value list")

    existing = db.exec(
        select(AttributeValue).where(AttributeValue.attribute_class_id == class_id, AttributeValue.value == data.value)
    ).first()
    if existing:
        raise HTTPException(status_code=400, detail=f'"{data.value}" already exists in {ac.name}')

    av = AttributeValue(attribute_class_id=class_id, value=data.value)
    db.add(av)
    db.commit()
    db.refresh(av)
    return av


def rename_attribute_value(value_id: int, data: model.AttributeValueRename, db: Session) -> AttributeValue:
    av = db.get(AttributeValue, value_id)
    if not av:
        raise HTTPException(status_code=404, detail="Attribute value not found")

    existing = db.exec(
        select(AttributeValue).where(
            AttributeValue.attribute_class_id == av.attribute_class_id,
            AttributeValue.value == data.value,
            AttributeValue.attributeValueId != value_id,
        )
    ).first()
    if existing:
        raise HTTPException(status_code=400, detail=f'"{data.value}" already exists')

    av.value = data.value
    db.add(av)
    db.commit()
    db.refresh(av)
    return av


def delete_attribute_value(value_id: int, db: Session) -> dict:
    av = db.get(AttributeValue, value_id)
    if not av:
        raise HTTPException(status_code=404, detail="Attribute value not found")
    db.delete(av)
    db.commit()
    return {"message": "Attribute value deleted", "id": value_id}
