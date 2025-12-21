from pydantic import BaseModel
from typing import Optional

class PaymentCreateRequest(BaseModel):
    orderId: int
    amount: float
    paymentMethod: str
    numberUsed: Optional[str] = None
    
    
class PaymentResponse(BaseModel):
    msg: str
    paymentId: int
    
class CreditCreateRequest(BaseModel):
    orderId: int
    customerId: int
    amountDue: float
    status: str
    settledAt: Optional[str] = None
    

class CreditCreateResponse(BaseModel):
    message: str
    creditId: Optional[int]
    
class checkCreditResponse:
    customerName: str
    creditId: int
    status: str
    amount: float
    unpaidAmount: float
    settled_at: Optional[str]
    
    
class CreditUpdate(BaseModel):
    amount_due: float
    status: str
    settledAt: Optional[str] = None
