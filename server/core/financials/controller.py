from fastapi import APIRouter, Depends, Query
from typing import List
from sqlmodel import Session
from db.database import get_session
from core.userManagement.authService import get_current_user
from . import model, PaymentService, creditService

router = APIRouter(prefix="/financials", tags=["Financials"])

# ---------------------------------------------------------------------------
# Payment Endpoints
# ---------------------------------------------------------------------------

@router.post("/payments", response_model=model.PaymentResponse)
def create_payment(
    payment_data: model.PaymentCreateRequest,
    db: Session = Depends(get_session),
    current_user = Depends(get_current_user)
):
    """
    Process a new payment. Requires authentication.
    """
    return PaymentService.process_payment(payment_data, db)

@router.get("/payments/cash/today", response_model=float)
def get_today_cash_total(
    db: Session = Depends(get_session),
    current_user = Depends(get_current_user)
):
    """
    Get total cash payments for today. Requires authentication.
    """
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
    return PaymentService.calculate_cash_payments_for_certain_date(date, db)

# ---------------------------------------------------------------------------
# Credit Endpoints
# ---------------------------------------------------------------------------

@router.post("/credits", response_model=model.CreditCreateResponse)
def create_credit(
    credit_data: model.CreditCreateRequest,
    db: Session = Depends(get_session),
    current_user = Depends(get_current_user)
):
    """
    Create a new credit record. Requires authentication.
    """
    return creditService.create_credit(credit_data, db)

@router.put("/credits/{order_id}", response_model=model.CreditUpdateResponse)
def update_credit(
    order_id: int,
    credit_data: model.CreditUpdate,
    paid_amount: float = Query(..., alias="amount"),
    db: Session = Depends(get_session),
    current_user = Depends(get_current_user)
):
    """
    Update credit status (make a payment). Requires authentication.
    """
    return creditService.update_credit(paid_amount, order_id, credit_data, db)

@router.get("/credits/customer/{customer_id}")
def get_customer_credits(
    customer_id: int,
    db: Session = Depends(get_session),
    current_user = Depends(get_current_user)
):
    """
    Get all credits for a specific customer. Requires authentication.
    """
    return creditService.check_credit_for_customer_by_customerId(customer_id, db)
