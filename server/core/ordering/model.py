from pydantic import BaseModel
from typing import Optional, List, Dict, Any
from uuid import UUID

class OrderItemRequest(BaseModel):
    productId: int
    variantId: Optional[int] = None
    quantity: float
    unitType: Optional[str] = None
    unitPrice: float
    details: Optional[Dict[str, Any]] = None
    totalPrice: Optional[float] = 0.0

class OrderCreate(BaseModel):
    customerId: Optional[int] = None
    amountPaid: float = 0.0
    # totalAmount is now calculated by backend
    # totalAmount: float = 0.0 
    parentOrderId: Optional[int] = None
    sourceInvoiceId: Optional[int] = None   # set when converting an invoice at checkout
    servedBy: UUID
    VAT_status: bool = False
    discount: Optional[float] = 0.0
    paymentStatus: str
    
    # New Fields
    status: Optional[str] = "pending"
    paymentMethod: Optional[str] = None
    paymentDetails: Optional[Dict[str, Any]] = None
    total: float = 0.0
    
    # Nested Items
    items: List[OrderItemRequest] = []

class OrderCreateResponse(BaseModel):
    message: str
    orderId: int

class OrderResponse(BaseModel):
    orderId: int
    customerId: Optional[int] = None
    customerName: Optional[str] = None
    amountPaid: float
    # Maps to subtotal or a generic total
    totalAmount: float
    parentOrderId: Optional[int] = None
    servedBy: Optional[UUID] = None
    VAT_status: bool
    discount: Optional[float] = 0.0
    paymentStatus: str
    created_at: str

    # New Fields
    status: str
    paymentMethod: Optional[str] = None
    balance: float = 0.0
    subtotal: float = 0.0
    total: float = 0.0
    source_invoice_id: Optional[int] = None
    items: List["OrderItemResponse"] = []
    
class OrderUpdateRequest(BaseModel):
    amountPaid: Optional[float] = None
    totalAmount: Optional[float] = None    
    status: Optional[str] = None


########orderItem model###########

class OrderItemCreate(BaseModel):
    orderId: int
    productId: int
    variantId: Optional[int] = None
    quantity: float 
    unitType: Optional[str] = None
    unitPrice: float 
    totalAmount: float
    details: Optional[Dict[str, Any]] = None
    
class OrderItemCreateResponse(BaseModel):
    message: str
    orderItemId: List[int]
    
class OrderItemResponse(BaseModel):
    productId: int
    orderId: int
    variantId: Optional[int] = None
    quantity: float
    unitType: Optional[str] = None
    unitPrice: float
    totalPrice: float
    details: Optional[Dict[str, Any]] = None
    status: Optional[str] = None
    
class totalPriceRequest(BaseModel):
    quantity: float
    unitPrice: float
    
class OrderItemStatusUpdateResponse(BaseModel):
    message: str

class OrderStatusUpdateResponse(BaseModel):
    message: str

class OrderEditRequest(BaseModel):
    """Payload for editing an existing order (replaces items + recalculates)."""
    customerId: Optional[int] = None
    amountPaid: float = 0.0
    servedBy: UUID
    VAT_status: bool = False
    discount: Optional[float] = 0.0
    paymentStatus: str
    paymentMethod: Optional[str] = None
    paymentDetails: Optional[Dict[str, Any]] = None
    items: List[OrderItemRequest] = []
    notes: Optional[str] = None

class EditHistoryResponse(BaseModel):
    id: int
    entity_type: str
    entity_id: int
    edited_by: str
    edited_at: str
    action: str
    before_snapshot: Dict[str, Any]
    after_snapshot: Dict[str, Any]
    notes: Optional[str] = None

    class Config:
        from_attributes = True


# ── Store-manager view models ──────────────────────────────────────────────────

class OffcutInfo(BaseModel):
    """An available offcut piece shown to the store manager."""
    offcutId: int
    length: float
    quantity: int


class StoreItemResponse(BaseModel):
    """Order item enriched with category + offcut data for the store manager."""
    item_id: int
    product_id: int
    product_name: str
    variant_id: Optional[int] = None
    variant_name: Optional[str] = None
    category: str           # "profile" | "glass"
    details: Optional[Dict[str, Any]] = None
    available_offcuts: List[OffcutInfo] = []
    has_cuts: bool = False
    track_offcuts: bool = False


class StoreOrderResponse(BaseModel):
    """Order header + its profile/glass items for the store manager view."""
    order: OrderResponse
    store_items: List[StoreItemResponse] = []


# ── Offcut reassignment models ─────────────────────────────────────────────────

class OffcutReassignSource(BaseModel):
    """One offcut piece the manager wants to use to fulfill (part of) a cut."""
    offcut_id: int
    length_used: float


class OffcutReassignRequest(BaseModel):
    """
    Reassign which offcuts fulfill a specific cut line in an order item.
    cut_line_index: index in lineItems[] that is a cut type.
    new_sources: the offcuts the manager wants to use (must sum to the cut length × qty).
    """
    cut_line_index: int = 0
    new_sources: List[OffcutReassignSource]
    notes: Optional[str] = None


class OffcutReassignResponse(BaseModel):
    message: str
    new_sources: List[Dict[str, Any]]

