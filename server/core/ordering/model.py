from pydantic import BaseModel
from typing import Optional, List
from uuid import UUID

class OrderCreate(BaseModel):
    customerId: Optional[int] = None
    amountPaid: float = 0.0
    totalAmount: float = 0.0
    parentOrderId: Optional[int] = None
    servedBy: UUID
    VAT_status: bool = False
    discount: Optional[float] = 0.0
    paymentStatus: str
    
class OrderCreateResponse(BaseModel):
    message: str
    orderId: int
    
class OrderResponse(BaseModel):
    orderId: int
    customerId: Optional[str] = None
    amountPaid: float
    totalAmount: float
    parentOrderId: Optional[int] = None
    servedBy: UUID
    VAT_status: bool
    discount: Optional[float] = 0.0
    paymentStatus: str
    created_at: str
    
class OrderUpdateRequest(BaseModel):
    amountPaid: Optional[float] = None
    totalAmount: Optional[float] = None    


########orderItem model###########



class OrderItemCreate(BaseModel):
    orderId: int
    productId: int
    quantity: int
    unitType: str
    unitPrice: float
    totalAmount: float
    
class OrderItemCreateResponse(BaseModel):
    message: str
    orderItemId: List[int]
    
class OrderItemResponse(BaseModel):
    productId: int
    orderId: int
    quantity: int
    unitType: str
    unitPrice: float
    totalPrice: float
    
class totalPriceRequest(BaseModel):
    quantity: int
    unitPrice: float
    
class OrderItemStatusUpdateResponse(BaseModel):
    message: str
    
