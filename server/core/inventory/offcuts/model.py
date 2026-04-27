from pydantic import BaseModel
from typing import Optional

class create_offcut(BaseModel):
    product_id: int
    variant_id: Optional[int] = None
    length: float
    quantity: int

class offcutIds(BaseModel):
    product_id: int
    variant_id: Optional[int] = None