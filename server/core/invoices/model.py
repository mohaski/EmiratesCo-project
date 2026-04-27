from pydantic import BaseModel
from typing import Optional, List, Dict, Any
from datetime import datetime
from uuid import UUID


# ── Request Models ──────────────────────────────────────────────────────────

class InvoiceCustomer(BaseModel):
    """Customer info embedded in the invoice payload."""
    id: Optional[int] = None          # customerId if registered
    name: str
    phone: Optional[str] = None
    type: str = "guest"               # "guest" | "registered"


class InvoiceCreate(BaseModel):
    customer: InvoiceCustomer
    items: List[Dict[str, Any]]       # Full cart item snapshots
    subtotal: float
    vat_amount: float = 0.0
    total: float
    discount: float = 0.0
    vat_enabled: bool = False
    notes: Optional[str] = None


class InvoiceUpdate(BaseModel):
    """Partial update for a draft invoice."""
    customer: Optional[InvoiceCustomer] = None
    items: Optional[List[Dict[str, Any]]] = None
    subtotal: Optional[float] = None
    vat_amount: Optional[float] = None
    total: Optional[float] = None
    discount: Optional[float] = None
    vat_enabled: Optional[bool] = None
    notes: Optional[str] = None
    status: Optional[str] = None      # only "sent" or "cancelled" allowed here


class InvoiceConvertRequest(BaseModel):
    """
    Payload for converting an invoice into a confirmed order.
    Mirrors the checkout payload — only financial/payment fields needed;
    items are taken from the stored invoice.
    """
    amount_paid: float = 0.0
    payment_method: str = "cash"
    payment_details: Optional[Dict[str, Any]] = None
    discount: Optional[float] = None  # override invoice discount if needed


# ── Response Models ──────────────────────────────────────────────────────────

class InvoiceResponse(BaseModel):
    invoiceId: int
    invoice_number: str
    customer_id: Optional[int]
    customer_name: Optional[str]
    customer_phone: Optional[str]
    customer_type: str
    created_by: str                   # UUID as string
    created_at: str
    converted_at: Optional[str]
    subtotal: float
    vat_amount: float
    total: float
    discount: float
    vat_enabled: bool
    items: List[Dict[str, Any]]
    notes: Optional[str]
    status: str
    order_id: Optional[int]           # set after conversion

    class Config:
        from_attributes = True


class InvoiceCreateResponse(BaseModel):
    message: str
    invoiceId: int
    invoice_number: str


class InvoiceConvertResponse(BaseModel):
    message: str
    invoiceId: int
    orderId: int
