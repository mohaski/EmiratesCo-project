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
    amountPaid: float
    # Maps to subtotal or a generic total
    totalAmount: float 
    parentOrderId: Optional[int] = None
    servedBy: UUID
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
    
