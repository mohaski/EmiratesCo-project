from fastapi import APIRouter, Depends, Query, BackgroundTasks
from typing import List
from sqlmodel import Session
from db.database import get_session
from core.userManagement.authService import get_current_user
from ws.manager import manager
from utils import require_role
from . import model, PaymentService, creditService

router = APIRouter(prefix="/financials", tags=["Financials"])

# ---------------------------------------------------------------------------
# Static / non-parameterised routes FIRST (avoids shadowing by /credits/{order_id})
# ---------------------------------------------------------------------------

# ---------------------------------------------------------------------------
# Payment Endpoints
# ---------------------------------------------------------------------------

@router.post("/payments", response_model=model.RecordPaymentResponse)
async def create_payment(
    payment_data: model.RecordPaymentRequest,
    background_tasks: BackgroundTasks,
    db: Session = Depends(get_session),
    current_user = Depends(get_current_user)
):
    """
    Record a payment against an order. The single writer for Payment/Order
    balance/Credit — used by both checkout and the Collect Payments page.
    """
    require_role(["cashier", "manager", "ceo", "admin"], current_user)
    result = PaymentService.record_payment(
        payment_data.orderId,
        payment_data.amount,
        payment_data.paymentMethod,
        db,
        current_user,
        payment_data.paymentDetails,
    )
    background_tasks.add_task(manager.broadcast, "orders_updated")
    return result

@router.get("/payments/cash/today", response_model=float)
def get_today_cash_total(
    db: Session = Depends(get_session),
    current_user = Depends(get_current_user)
):
    """
    Get total cash payments for today. Requires authentication.
    """
    require_role(["cashier", "manager", "ceo", "admin"], current_user)
    return PaymentService.calculate_cash_payments_for_today(db)

@router.get("/payments/cash/{date}", response_model=float)
def get_date_cash_total(
    date: str,
    db: Session = Depends(get_session),
    current_user = Depends(get_current_user)
):
    """
    Get total cash payments for a specific date (YYYY-MM-DD). Requires authentication.
    """
    require_role(["cashier", "manager", "ceo", "admin"], current_user)
    return PaymentService.calculate_cash_payments_for_certain_date(date, db)

@router.get("/payments/order/{order_id}", response_model=List[model.PaymentRecord])
def get_payments_for_order(
    order_id: int,
    db: Session = Depends(get_session),
    current_user = Depends(get_current_user)
):
    """
    Full payment history for a single order — feeds the Dues Follow-Up
    debt-detail view (order + every payment made against it, cleared or not).
    """
    require_role(["ceo", "manager", "admin"], current_user)
    return PaymentService.get_payments_for_order(order_id, db)

@router.get("/summary", response_model=model.FinancialSummaryResponse)
def get_financial_summary(
    period: str = Query("day", description="'day' | 'month' | 'year'"),
    date: str = Query(None, description="Anchor date YYYY-MM-DD, defaults to today"),
    db: Session = Depends(get_session),
    current_user = Depends(get_current_user)
):
    """
    CEO oversight: money received in the given period, broken down by payment
    method, plus order volume/status counts for the same window.
    """
    require_role(["ceo", "admin"], current_user)
    return PaymentService.get_financial_summary(period, date, db)

# ---------------------------------------------------------------------------
# Credit Endpoints
# ---------------------------------------------------------------------------

@router.get("/credits/outstanding", response_model=List[model.OutstandingCreditItem])
def get_outstanding_credits(
    db: Session = Depends(get_session),
    current_user = Depends(get_current_user)
):
    """
    Aggregate view of every outstanding balance across all customers, for the
    CEO/Manager dues follow-up page.
    """
    require_role(["ceo", "manager", "admin"], current_user)
    return creditService.get_all_outstanding_credits(db)

@router.get("/credits/customer/{customer_id}")
def get_customer_credits(
    customer_id: int,
    db: Session = Depends(get_session),
    current_user = Depends(get_current_user)
):
    """
    Get all credits for a specific customer. Requires authentication.
    """
    require_role(["manager", "ceo", "admin"], current_user)
    return creditService.check_credit_for_customer_by_customerId(customer_id, db)
