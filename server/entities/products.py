from sqlmodel import SQLModel, Field, Relationship
from typing import Optional, List
from sqlalchemy import Column, Enum

class category(SQLModel, table=True):
    categoryId: Optional[int] = Field(default= None, primary_key=True)
    name: str = Field(nullable=False)
    type: str = Field(nullable=False)



class Product(SQLModel, table=True):
    __tablename__ = "products"

    productId: Optional[int] = Field(default=None, primary_key=True)
    itemCode: optional[str]= Field(unique=True)
    category: int = Field(nullable=False, foreign_key='categories.categoryId')
    name: str = Field(index=True)
    sub_category: Optional[str] = Field(default=None) # e.g. 'window', 'door'
    description: Optional[str] = Field(default=None)
    usage_type: str = Field(sa_column=Column(Enum('window', 'door', 'general', name='usage_type')))
    image_url: Optional[str] = Field(default=None)

    # Pricing
    price_full: float = Field(default=0.0)
    price_half: Optional[float] = Field(default=None)
    price_unit: Optional[float] = Field(default=None) # per foot or sqft
    
    # Inventory (Simple total, detailed logic might require a separate variant table as per schema)
    # For now, restoring basic product entity to satisfy foreign key constraints
    
    

    # Relationships
    orderItems: List["OrderItem"] = Relationship(back_populates="product")

