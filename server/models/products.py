from sqlmodel import Field, SQLModel, Relationship
from sqlalchemy import Enum, func, Column
from typing import Optional, List
from datetime import datetime

class Product(SQLModel, table=True):
    __tablename__ = "products"

    productId: Optional[int] = Field(default=None, primary_key=True)
    itemName: str
    itemCode: Optional[str] = None
    versionCategory: str = Field(sa_column = Column(Enum("Ke", "Tz", "other", name="version_category_enum"))) 
    useForCategory: str = Field(sa_column = Column(Enum("Window", "Door&Partition", "other", name="use_for_category_enum")))
    productCategory: str = Field(sa_column = Column(Enum("glass", "profile", "accessory", name="product_category_enum")))
    color: Optional[str] = Field(sa_column = Column(Enum("white", "brown", "natural", "grey", name="color_enum")), default= None)
    fullSizeLength: Optional[int] = None
    priceFull: int = Field(nullable = False) 
    price_per_unit: Optional[float] = None
    price_per_half: Optional[float] = None
    trackOffcuts: Optional[bool] = Field(default=False)
    stock: int = Field(default=0)
    alarm_quantity: Optional[int] = Field(default= 0)
    created_at: datetime = Field(
        sa_column_kwargs={"server_default": func.now()}
    )

    # Relationships
    orderItems: List["OrderItem"] = Relationship(back_populates="product")
    offcuts: List["Offcut"] = Relationship(back_populates="product")