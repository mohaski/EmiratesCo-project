from fastapi import HTTPException
from sqlmodel import Session, select
from entities.attributes import AttributeClass, AttributeValue
from loggiing import logger
from . import model


# Renaming or deleting an attribute that products use is refused rather than cascaded.
# Products, variants and their offcut/stock pool keys all store the attribute by NAME
# (core/inventory/poolKey.py); renaming it here alone split pools and left existing offcuts
# unreachable. A safe cascade would have to re-key offcuts, offcut pieces and open
# containers and teach undo about it — so for now, change the products first.
def _products_using_class(db: Session, name: str) -> list[str]:
    from entities.products import Product
    from entities.variants import Variant
    names = set()
    for p in db.exec(select(Product)).all():
        if (name in (p.applicable_attributes or []) or name in (p.default_attributes or {})
                or name in (p.pool_ignored_attributes or [])):
            names.add(p.name)
    for v, pname in db.exec(select(Variant, Product.name).join(Product, Product.productId == Variant.product_id)).all():
        if name in (v.attributes or {}):
            names.add(pname)
    return sorted(names)


def _products_using_value(db: Session, class_name: str, value: str) -> list[str]:
    from entities.products import Product
    from entities.variants import Variant
    names = set()
    for p in db.exec(select(Product)).all():
        if (p.default_attributes or {}).get(class_name) == value:
            names.add(p.name)
    for v, pname in db.exec(select(Variant, Product.name).join(Product, Product.productId == Variant.product_id)).all():
        if (v.attributes or {}).get(class_name) == value:
            names.add(pname)
    return sorted(names)


def _refuse_in_use(what: str, action: str, products: list[str]) -> None:
    if not products:
        return
    shown = ", ".join(products[:5]) + (f" and {len(products) - 5} more" if len(products) > 5 else "")
    raise HTTPException(
        status_code=409,
        detail=f"{what} is used by {len(products)} product(s): {shown}. It can't be {action} while in use — "
               "change those products first.",
    )


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
    if data.name != ac.name:
        _refuse_in_use(f'"{ac.name}"', "renamed", _products_using_class(db, ac.name))

    ac.name = data.name
    db.add(ac)
    db.commit()
    db.refresh(ac)
    return ac


def delete_attribute_class(class_id: int, db: Session) -> dict:
    ac = db.get(AttributeClass, class_id)
    if not ac:
        raise HTTPException(status_code=404, detail="Attribute class not found")
    _refuse_in_use(f'"{ac.name}"', "deleted", _products_using_class(db, ac.name))
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
    if data.value != av.value:
        ac = db.get(AttributeClass, av.attribute_class_id)
        _refuse_in_use(f'"{av.value}"', "renamed", _products_using_value(db, ac.name if ac else "", av.value))

    av.value = data.value
    db.add(av)
    db.commit()
    db.refresh(av)
    return av


def delete_attribute_value(value_id: int, db: Session) -> dict:
    av = db.get(AttributeValue, value_id)
    if not av:
        raise HTTPException(status_code=404, detail="Attribute value not found")
    ac = db.get(AttributeClass, av.attribute_class_id)
    _refuse_in_use(f'"{av.value}"', "deleted", _products_using_value(db, ac.name if ac else "", av.value))
    db.delete(av)
    db.commit()
    return {"message": "Attribute value deleted", "id": value_id}
