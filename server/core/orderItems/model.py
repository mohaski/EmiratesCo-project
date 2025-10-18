from pydantic import BaseModel
from typing import List

class OrderItemCreate(BaseModel):
    orderId: int
    productId: int
    quantity: int
    price: float
    totalAmount: float
    
class OrderItemCreateResponse(BaseModel):
    message: str
    orderItemId: List[int]
    
class OrderItemResponse(BaseModel):
    productId: int
    quantity: int
    unitType: str
    price: float
    totalPrice: float
    
class OrderItemStatusUpdateResponse(BaseModel):
    message: str
    