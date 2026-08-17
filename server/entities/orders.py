from sqlmodel import SQLModel, Field, Relationship
from sqlalchemy import func, Enum, Column
from typing import Optional, List
from datetime import datetime
from uuid import UUID

class Order(SQLModel, table=True):

    __tablename__ = "orders"

    orderId: Optional[int] = Field(default=None, primary_key=True)
    customerid: Optional[int] = Field(default=None, foreign_key="customers.customerId")
    # Display name for this order's customer — the walk-in name typed at
    # checkout for guests, or a snapshot of the registered customer's name.
    # Always populated, unlike the old guest-only guest_name column.
    customer_name: Optional[str] = Field(default=None)

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
    # payment_method/payment_details are no longer stored here — the
    # representative method/split for an order is derived from its Payment
    # rows (see orderService._latest_payment_method); Payment.payment_details
    # now carries the split breakdown per payment event instead of once per order.
    payment_status: str = Field(sa_column=Column(Enum("Paid", "Unpaid", "Partial", name="payment_status_enum"), default="Unpaid", nullable=False))

    # Link back to the invoice this order was created from (null for direct orders)
    source_invoice_id: Optional[int] = Field(default=None, foreign_key="invoices.invoiceId")

    # Relationships
    # order_by pins item order to insertion (item_id) order — orderService creates
    # OrderItem rows in the same sequence as the incoming cart/items array, and
    # callers (e.g. the receipt) match items back to that array positionally.
    orderItems: List["OrderItem"] = Relationship(
        back_populates="order",
        sa_relationship_kwargs={"order_by": "OrderItem.item_id"},
    )
    customer: Optional["Customer"] = Relationship(back_populates="orders")
    user: "User" = Relationship(back_populates="orders")
    credits: List["Credit"] = Relationship(back_populates="order")
    payments: List["Payment"] = Relationship(back_populates="order")