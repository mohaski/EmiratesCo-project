from sqlmodel import Field, SQLModel, Relationship
from sqlalchemy import Enum, func, Column
from typing import Optional
from datetime import datetime
from uuid import UUID

class Payment(SQLModel, table= True):

    __tablename__ = "payments"

    paymentId: Optional[int] = Field(default=None, primary_key= True)
    orderId: int = Field(foreign_key = "orders.orderId", nullable= False)
    amount: float = Field(nullable= False)

    
    # Method & Reference
    payment_method: str = Field(sa_column= Column(Enum("cash", "mpesa", "split", "number", name="payment_method_enum")))
    transaction_ref: Optional[str] = Field(default=None) # M-Pesa code, Cheque No.
    number_used: Optional[str] = None
    # Audit
    payed_at: datetime = Field(sa_column_kwargs = {"server_default": func.now()})
    recorded_by: Optional[UUID] = Field(default=None, foreign_key="users.userId")

    # Relationships
    order: "Order" = Relationship(back_populates="payments")
