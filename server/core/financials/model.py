from pydantic import BaseModel
from typing import Optional

class RecordPaymentRequest(BaseModel):
    orderId: int
    amount: float
    paymentMethod: str
    numberUsed: Optional[str] = None
    transactionRef: Optional[str] = None


class RecordPaymentResponse(BaseModel):
    message: str
    paymentId: int
    orderId: int
    newBalance: float
    newPaymentStatus: str


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


class OutstandingCreditItem(BaseModel):
    creditId: int
    orderId: int
    customerId: int
    customerName: str
    customerPhone: str
    amount: float
    amountDue: float
    status: str
    createdAt: str
    daysOutstanding: int
    lastPaymentAt: Optional[str] = None