from sqlmodel import Field, SQLModel, Relationship
from sqlalchemy import Enum, func, Column
from typing import List, Optional
from datetime import datetime

class Credit(SQLModel, table= True):

    __tablename__ = "credits"

    creditId: Optional[int] = Field(default=None, primary_key= True)
    orderId: int = Field(foreign_key = "orders.orderId", nullable= False)
    customerId: int = Field(foreign_key = "customers.customerId", nullable= False)
    amount: float = Field(nullable= False)
    amount_due: float = Field(nullable= False, default= 0.0)
    status: str = Field(sa_column= Column(Enum("Pending", "Partially Paid","Paid", name="credit_status_enum")))
    settledAt: datetime = Field(nullable= True)
    createdAt: datetime = Field(sa_column_kwargs={"server_default": func.now()})

    customer: "Customer" = Relationship(back_populates="credits")
    order: "Order" = Relationship(back_populates="credits")
