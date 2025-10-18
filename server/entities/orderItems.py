from sqlmodel import Field, SQLModel, Relationship
from sqlalchemy import Enum, Column
from typing import Optional

class OrderItem(SQLModel, table=True):
    __tablename__ = "orderitems"

    item_id: Optional[int] = Field(default=None, primary_key=True)
    order_id: int = Field(foreign_key="orders.orderId")
    product_id: int = Field(foreign_key="products.productId")
    quantity: float = Field(nullable=False)
    unit_type: Optional[str] = Field(sa_column = Column(Enum("half", "per_unit", name="unit_type_enum"), default= None))
    unit_price: float = Field(nullable=False)
    total_price: float = Field(nullable=False)
    status: Optional[str] = Field(sa_column= Column(Enum("purchased", "returned", name=" orderItemstatus_enum"), default="purchased")) 
    offcut_id: Optional[int] = Field(default=None, foreign_key="offcuts.offcutId")

    # Relationships
    order: "Order" = Relationship(back_populates="orderItems")
    product: "Product" = Relationship(back_populates="orderItems")
    offcut: Optional["Offcut"] = Relationship(back_populates="orderItems")


