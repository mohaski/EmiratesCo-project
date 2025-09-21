from sqlmodel import Field, SQLModel, Relationship
from sqlalchemy import Enum, func, Column
from typing import Optional, List
from datetime import datetime

class Offcut(SQLModel, table=True):
    __tablename__ = "offcuts"

    offcutId: Optional[int] = Field(default=None, primary_key=True)
    productid: int = Field(foreign_key="products.productId")
    length_available: float
    source_orderid: Optional[int] = Field(foreign_key="orders.orderId")
    status: Optional[str] = Field(sa_column = Column(Enum("Available", "Used", name="offcut_status_enum")))
    created_at: datetime = Field(
        sa_column_kwargs={"server_default": func.now()}
    )

    # Relationships
    product: "Product" = Relationship(back_populates="offcuts")
    orderItems: List["OrderItem"] = Relationship(back_populates="offcut")