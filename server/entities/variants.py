from sqlmodel import SQLModel, Field, Relationship
from sqlalchemy import Column, JSON
from typing import Optional, List, Dict, Any
from datetime import datetime
import uuid

class Variant(SQLModel, table=True):
    __tablename__ = "variants"

    variantId: Optional[int] = Field(default=None, primary_key=True)
    product_id: int = Field(foreign_key="products.productId", nullable=False)
    
    name: Optional[str] = Field(default=None) # Optional display name override
    
    # Specific Attributes (Color, Size, Finish)
    attributes: Dict[str, Any] = Field(default={}, sa_column=Column(JSON))
    
    # Inventory
    stock_quantity: float = Field(default=0.0)
    low_stock_threshold: float = Field(default=10.0)
    
    # Price modifiers (added to base product price)
    price: float = Field(default=0.0) # Full Price
    price_half: Optional[float] = Field(default=None)
    price_unit: Optional[float] = Field(default=None)
    
    length: Optional[float] = Field(default=None)
    width: Optional[float] = Field(default=None)   # Sheet width (glass)
    height: Optional[float] = Field(default=None)  # Sheet height (glass)

    # Numeric quantity carried by a "custom" attribute value (e.g. 1000 for "1000pcs")
    unit_quantity: Optional[float] = Field(default=None)

    # Relationships
    product: "Product" = Relationship(back_populates="variants")
    orderItems: List["OrderItem"] = Relationship(back_populates="variant") 

