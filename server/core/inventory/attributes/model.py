from pydantic import BaseModel
from typing import List


class AttributeValueResponse(BaseModel):
    attributeValueId: int
    value: str

    class Config:
        from_attributes = True


class AttributeClassResponse(BaseModel):
    attributeClassId: int
    name: str
    type: str
    values: List[AttributeValueResponse] = []

    class Config:
        from_attributes = True


class AttributeClassCreate(BaseModel):
    name: str
    type: str = "list"  # "list" | "custom"


class AttributeClassRename(BaseModel):
    name: str


class AttributeValueCreate(BaseModel):
    value: str


class AttributeValueRename(BaseModel):
    value: str
