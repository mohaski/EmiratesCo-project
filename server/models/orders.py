
from sqlmodel import SQLModel, Field, Relationship
from sqlalchemy import func
from typing import Optional, List
from datetime import datetime

class Order(SQLModel, table=True):

    __tablename__ = "orders"

    orderId: Optional[int] = Field(default=None, primary_key=True)
    customerid: Optional[int] = Field(default=None, foreign_key="customers.customerId")
    amountPayed: Optional[float] = Field(default=0.0)
    servedby: int = Field( nullable = False,foreign_key="users.userId")
    parent_orderid: Optional[int] = Field(default=None )
    VAT_status: Optional[bool] = Field(default= False )
    created_at: datetime = Field(sa_column_kwargs={"server_default": func.now()})
    payment_status: Optional[str] = None
    subtotal: Optional[float] = Field(default= 0.0)
    discount: Optional[float] = Field(default= 0.0)

    # Relationships
    orderItems: List["OrderItem"] = Relationship(back_populates="order")
    customer: Optional["Customer"] = Relationship(back_populates="orders")
    user: "User" = Relationship(back_populates="orders")
    credits: List["Credit"] = Relationship(back_populates="order")
    payments: List["Payment"] = Relationship(back_populates="order")