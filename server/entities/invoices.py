from sqlmodel import Field, SQLModel, Relationship
from sqlalchemy import Column, JSON, Enum, func
from typing import Optional, List, Dict, Any
from datetime import datetime
from uuid import UUID


class Invoice(SQLModel, table=True):
    """
    Stores customer-facing quotations / proforma invoices.

    Lifecycle:
        draft       – created, not yet sent or acted on
        sent        – shared with the customer (optional step)
        converted   – a confirmed order has been created from this invoice
        cancelled   – voided, will not be converted

    When status becomes 'converted':
        - order_id is set to the resulting Order's PK
        - The Order gains source_invoice_id pointing back here
    """

    __tablename__ = "invoices"

    invoiceId: Optional[int] = Field(default=None, primary_key=True)

    # Auto-generated human-readable number e.g. "INV-000042"
    invoice_number: str = Field(nullable=False, index=True)

    # Customer — registered or guest
    customer_id: Optional[int] = Field(default=None, foreign_key="customers.customerId")
    customer_name: Optional[str] = Field(default=None)        # snapshot for guests
    customer_phone: Optional[str] = Field(default=None)
    customer_type: str = Field(default="guest")               # "guest" | "registered"

    # Who raised the invoice
    created_by: UUID = Field(nullable=False, foreign_key="users.userId")

    # Timestamps
    created_at: datetime = Field(
        sa_column_kwargs={"server_default": func.now()}, index=True
    )
    converted_at: Optional[datetime] = Field(default=None)

    # Financial snapshot (stored so the invoice is self-contained)
    subtotal: float = Field(default=0.0)
    vat_amount: float = Field(default=0.0)
    total: float = Field(default=0.0)
    discount: float = Field(default=0.0)
    vat_enabled: bool = Field(default=False)

    # Full cart snapshot — list of items with all calculated details
    # Same structure as CartContext items so the frontend can reconstruct the cart
    items: List[Dict[str, Any]] = Field(
        default_factory=list, sa_column=Column(JSON, nullable=False)
    )

    notes: Optional[str] = Field(default=None)

    # Status
    status: str = Field(
        sa_column=Column(
            Enum("draft", "sent", "converted", "cancelled", name="invoice_status_enum"),
            default="draft",
            nullable=False,
            index=True,
        )
    )

    # FK to the Order that was created when this invoice was converted (null until then)
    order_id: Optional[int] = Field(default=None, foreign_key="orders.orderId")
