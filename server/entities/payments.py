from sqlmodel import Field, SQLModel, Relationship
from sqlalchemy import Enum, func, Column
from typing import Optional
from datetime import datetime

class Payment(SQLModel, table= True):

    __tablename__ = "payments"

    paymentId: Optional[int] = Field(default=None, primary_key= True)
    orderId: int = Field(foreign_key = "orders.orderId", nullable= False)
    amount: float = Field(nullable= False)
    payment_method: str = Field(sa_column= Column(Enum("Cash", "Mpesa", "Number", name="payment_method_enum")))
    number_used: Optional[str] = None
    payed_at: datetime = Field(sa_column_kwargs = {"server_default": func.now()})

    order: "Order" = Relationship(back_populates="payments")
