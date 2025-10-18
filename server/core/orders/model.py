from pydantic import BaseModel
from typing import Optional
from uuid import UUID

class OrderCreate(BaseModel):
    customerId: Optional[int] = None
    amountPaid: float = 0.0
    totalAmount: float
    parentOrderId: Optional[int] = None
    servedBy: UUID
    VAT_status: bool = False
    discount: Optional[float] = 0.0
    paymentStatus: str = "Unpaid"
    
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

