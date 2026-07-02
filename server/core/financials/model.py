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
    amount: float          # full order total
    amount_due: float      # outstanding balance
    status: str
    settledAt: Optional[str] = None


class CreditCreateResponse(BaseModel):
    message: str
    creditId: Optional[int]

class checkCreditResponse(BaseModel):
    customerName: str
    creditId: int
    status: str
    amount: float
    unpaidAmount: float
    settled_at: Optional[str] = None
    
    
class CreditUpdate(BaseModel):
    amount_due: float
    status: str
    settledAt: Optional[str] = None

class CreditUpdateResponse(BaseModel):
    message: str
    creditId: Optional[int]