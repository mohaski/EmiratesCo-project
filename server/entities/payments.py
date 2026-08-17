from sqlmodel import Field, SQLModel, Relationship
from sqlalchemy import Enum, func, Column, JSON
from typing import Optional, Dict, Any
from datetime import datetime
from uuid import UUID

class Payment(SQLModel, table= True):

    __tablename__ = "payments"

    paymentId: Optional[int] = Field(default=None, primary_key= True)
    orderId: int = Field(foreign_key = "orders.orderId", nullable= False)
    amount: float = Field(nullable= False)

    # Method & purpose
    payment_method: str = Field(sa_column= Column(Enum("cash", "mpesa", "split", "number", name="payment_method_enum")))
    # Why this payment was recorded: 'order' = collected as part of creating/
    # editing an order (or converting an invoice to one) at checkout time;
    # 'debt' = collected later against an already-standing balance (Collect
    # Payments / Dues page). Set by the code path that creates the row, not
    # by the caller — see PaymentService.record_payment / orderService.
    reason: str = Field(sa_column=Column(Enum("order", "debt", name="payment_reason_enum")))
    # Split breakdown for THIS payment event, e.g. {"cash": 100, "mpesa": 200}
    # — only meaningful when payment_method == "split".
    payment_details: Optional[Dict[str, Any]] = Field(default=None, sa_column=Column(JSON))

    # Audit
    payed_at: datetime = Field(sa_column_kwargs = {"server_default": func.now()})
    recorded_by: Optional[UUID] = Field(default=None, foreign_key="users.userId")

    # Relationships
    order: "Order" = Relationship(back_populates="payments")
