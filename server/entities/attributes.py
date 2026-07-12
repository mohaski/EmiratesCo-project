from sqlmodel import SQLModel, Field, Relationship
from typing import Optional, List


class AttributeClass(SQLModel, table=True):
    __tablename__ = "attribute_classes"

    attributeClassId: Optional[int] = Field(default=None, primary_key=True)
    name: str = Field(nullable=False, unique=True, index=True)
    type: str = Field(default="list")  # "list" (shared preset values) | "custom" (entered per product)

    values: List["AttributeValue"] = Relationship(
        back_populates="attribute_class",
        sa_relationship_kwargs={"cascade": "all, delete-orphan"},
    )


class AttributeValue(SQLModel, table=True):
    __tablename__ = "attribute_values"

    attributeValueId: Optional[int] = Field(default=None, primary_key=True)
    attribute_class_id: int = Field(nullable=False, foreign_key="attribute_classes.attributeClassId")
    value: str = Field(nullable=False)

    attribute_class: Optional["AttributeClass"] = Relationship(back_populates="values")
