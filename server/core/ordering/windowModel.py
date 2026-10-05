from pydantic import BaseModel, Field
from typing import Optional, List, Dict, Any

from .model import OrderItemRequest, OrderItemResponse


class WindowOpenRequest(BaseModel):
    # Which till/browser this is — recorded for the audit trail, not used for ownership.
    deviceId: Optional[str] = None
    # Defaults to "Window N", the lowest number the cashier doesn't already have open.
    label: Optional[str] = None


class WindowCartRequest(BaseModel):
    """The window's whole cart, replacing whatever it held. The server re-deducts to match,
    so a 422 here means "the cart as sent can't be filled" and the window keeps its
    previous cart (and stock) untouched."""
    # The version the client last saw (WindowResponse.version). A stale one is refused with
    # 409, so two tabs on the same window can't silently overwrite each other.
    version: int
    customerId: Optional[int] = None
    customerName: Optional[str] = None
    VAT_status: bool = False
    discount: Optional[float] = 0.0
    parentOrderId: Optional[int] = None
    sourceInvoiceId: Optional[int] = None   # converting an invoice: marked converted on confirm
    items: List[OrderItemRequest] = []


class WindowConfirmRequest(BaseModel):
    """Turn the window into a real order: take payment, assign the order number, release
    its private offcuts to everyone, close the window."""
    version: int
    # Generated once per confirm attempt by the client and resent unchanged on a retry. A
    # retried confirm with the same key returns the original result instead of an error,
    # and can never record the payment twice.
    idempotencyKey: str = Field(..., min_length=8, max_length=100)
    amountPaid: float = 0.0
    paymentMethod: Optional[str] = None
    paymentDetails: Optional[Dict[str, Any]] = None


class WindowResponse(BaseModel):
    windowId: int
    orderId: int
    label: Optional[str] = None
    deviceId: Optional[str] = None
    version: int
    openedAt: str
    lastActivityAt: str
    expiresAt: str
    # Seconds until the idle expiry releases this window's stock, from the DB clock.
    secondsLeft: int
    customerId: Optional[int] = None
    customerName: Optional[str] = None
    VAT_status: bool = False
    discount: float = 0.0
    parentOrderId: Optional[int] = None
    sourceInvoiceId: Optional[int] = None
    subtotal: float = 0.0
    total: float = 0.0
    items: List[OrderItemResponse] = []


class WindowConfirmResponse(BaseModel):
    message: str
    windowId: int
    orderId: int
    orderNo: int


class WindowReleaseResponse(BaseModel):
    message: str
    windowId: int
