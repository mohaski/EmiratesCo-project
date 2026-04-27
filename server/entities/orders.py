from sqlmodel import SQLModel, Field, Relationship
from sqlalchemy import func, Enum, Column, JSON
from typing import Optional, List, Dict, Any
from datetime import datetime
from uuid import UUID

class Order(SQLModel, table=True):

    __tablename__ = "orders"

    orderId: Optional[int] = Field(default=None, primary_key=True)
    customerid: Optional[int] = Field(default=None, foreign_key="customers.customerId")
    
    # Financials
    amountPayed: float = Field(default=0.0)
    subtotal: float = Field(default=0.0)
    discount: float = Field(default=0.0)
    balance: float = Field(default=0.0)
    total: float = Field(default=0.0)
    VAT_status: bool = Field(default=False, index=True)
    
    # Computed Total can be subtotal + tax - discount, usually stored or computed. 
    # Frontend sends 'total' in payload. Let's add it if needed, or rely on amountPayed + balance.
    
    # Metadata
    servedby: UUID = Field(nullable=False, foreign_key="users.userId", index=True)
    parent_orderid: Optional[int] = Field(default=None)
    created_at: datetime = Field(sa_column_kwargs={"server_default": func.now()}, index=True)
    
    # Status Workflow
    status: str = Field(sa_column=Column(Enum("pending", "confirmed", "ready", "completed", "cancelled", name="order_status_enum"), default="pending", nullable=False))
    
    # Payment Info
    payment_status: str = Field(sa_column=Column(Enum("Paid", "Unpaid", "Partial", name="payment_status_enum"), default="Unpaid", nullable=False))
    payment_method: Optional[str] = Field(default=None) # 'cash', 'mpesa', 'split', 'cheque'
    payment_details: Optional[Dict[str, Any]] = Field(default=None, sa_column=Column(JSON)) # For split payments {cash: 100, mpesa: 200}

    # Link back to the invoice this order was created from (null for direct orders)
    source_invoice_id: Optional[int] = Field(default=None, foreign_key="invoices.invoiceId")

    # Relationships
    orderItems: List["OrderItem"] = Relationship(back_populates="order")
    customer: Optional["Customer"] = Relationship(back_populates="orders")
    user: "User" = Relationship(back_populates="orders")
    credits: List["Credit"] = Relationship(back_populates="order")
    payments: List["Payment"] = Relationship(back_populates="order")