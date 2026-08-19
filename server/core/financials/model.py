from pydantic import BaseModel
from typing import Optional, Dict, Any

class RecordPaymentRequest(BaseModel):
    orderId: int
    amount: float
    paymentMethod: str
    # Split breakdown for this payment event, e.g. {"cash": 100, "mpesa": 200} — only meaningful when paymentMethod == "split"
    paymentDetails: Optional[Dict[str, Any]] = None


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


class FinancialSummaryResponse(BaseModel):
    """CEO oversight: money received in a day/month/year, by payment method,
    plus order volume/status counts for the same window."""
    period: str
    range_start: str
    range_end: str
    total: float
    by_method: Dict[str, float]
    by_method_count: Dict[str, int]
    order_count: int
    status_counts: Dict[str, int]


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