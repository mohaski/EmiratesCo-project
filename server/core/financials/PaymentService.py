from fastapi import HTTPException, Depends
from entities.payments import Payment
from entities.credits import Credit
from db.database import get_session
from entities.orders import Order
from sqlalchemy.exc import IntegrityError, SQLAlchemyError
from sqlmodel import Session, select
from loggiing import logger
from sqlalchemy import func
from datetime import datetime
from utils import require_role

from . import model

def calculate_cash_payments_for_today(db: Session = Depends(get_session)) -> float:
    """
    Calculate the total cash payments received today.
    - Queries the payments made today with payment method 'Cash'.
    - Returns the total amount of cash payments.
    """
    try:
        # 🕒 Filter all 'Cash' payments made today
        statement = (
            select(Payment.amount)
            .where(
                Payment.payment_method == "Cash",
                func.date(Payment.payed_at) == func.current_date()  # ensures date-only comparison
            )
        )

        # 🎯 Execute the query
        results = db.exec(statement).all()

        # 🧮 Compute total
        total_cash = sum(results) if results else 0.0

        logger.info(f"Total cash payments for today: {total_cash}")
        return total_cash

    except Exception as e:
        logger.error(f"Error calculating cash payments: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail="Failed to calculate cash payments")
    
def calculate_cash_payments_for_certain_date(date: str, db: Session = Depends(get_session)) -> float:
    """
    Calculate the total cash payments received on a specific date.
    
    Parameters:
    - date (str): Date string in 'YYYY-MM-DD' format.
    - db (Session): Database session dependency.

    Returns:
    - float: Total amount of cash payments received on that date.
    """

    try:
        # ✅ Step 1: Validate date format
        try:
            parsed_date = datetime.strptime(date, "%Y-%m-%d").date()
        except ValueError:
            raise HTTPException(status_code=400, detail="Invalid date format. Use 'YYYY-MM-DD'")

        # ✅ Step 2: Query 'Cash' payments for the given date
        statement = (
            select(func.coalesce(func.sum(Payment.amount), 0))
            .where(
                Payment.payment_method == "Cash",
                func.date(Payment.payed_at) == parsed_date
            )
        )

        # ✅ Step 3: Execute and extract result
        total_cash = db.exec(statement).one_or_none() or (0,)

        total_cash_amount = float(total_cash[0])  # extract from tuple

        logger.info(f"✅ Total cash payments for {parsed_date}: {total_cash_amount}")
        return total_cash_amount

    except HTTPException:
        raise  # re-raise known exceptions to keep HTTP status
    except SQLAlchemyError as e:
        logger.error(f"Database error calculating cash payments for {date}: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail="Database query failed")
    except Exception as e:
        logger.error(f"Unexpected error calculating cash payments for {date}: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail="Failed to calculate cash payments for the specified date")


def _sync_credit_for_order(db: Session, order: Order) -> None:
    """Keep the order's Credit row (if any) mirroring Order.balance/amountPayed.
    This is the single place that reconciles the two, called both by
    record_payment and by order-edit so they can never drift apart."""
    credit = db.exec(select(Credit).where(Credit.orderId == order.orderId)).first()

    if credit:
        credit.amount_due = order.balance
        if order.balance <= 0.10:
            credit.status = "Paid"
            if not credit.settledAt:
                credit.settledAt = datetime.utcnow()
        else:
            credit.status = "Partially Paid" if order.amountPayed > 0 else "Pending"
        db.add(credit)
    elif order.balance > 0.01 and order.customerid:
        # Order didn't have a credit row yet (e.g. was created fully paid, then
        # edited to owe money) — create one now, matching create_order's rule.
        new_credit = Credit(
            orderId=order.orderId,
            customerId=order.customerid,
            amount=order.total,
            amount_due=order.balance,
            status="Partially Paid" if order.amountPayed > 0 else "Pending",
        )
        db.add(new_credit)


def record_payment(
    order_id: int,
    amount: float,
    payment_method: str,
    db: Session,
    current_user,
    number_used: str | None = None,
    transaction_ref: str | None = None,
) -> model.RecordPaymentResponse:
    """
    Single transactional entry point for "money was collected against this order":
    creates the Payment row, recomputes Order.amountPayed/balance/payment_status,
    and syncs the associated Credit row — all in one commit.
    """
    require_role(["cashier", "manager", "ceo", "admin"], current_user)

    try:
        order = db.exec(select(Order).where(Order.orderId == order_id)).first()
        if not order:
            raise HTTPException(status_code=404, detail="Order not found")
        if order.status == "cancelled":
            raise HTTPException(status_code=400, detail="Cannot record a payment against a cancelled order")

        if amount is None or amount <= 0:
            raise HTTPException(status_code=400, detail="Payment amount must be greater than zero")
        if amount > (order.balance or 0) + 0.10:
            raise HTTPException(status_code=400, detail="Payment exceeds the outstanding balance")

        pay_method = (payment_method or "cash").lower()
        if pay_method not in {"cash", "mpesa", "split", "number"}:
            pay_method = "cash"

        new_payment = Payment(
            orderId=order_id,
            amount=amount,
            payment_method=pay_method,
            number_used=number_used,
            transaction_ref=transaction_ref,
            recorded_by=current_user.userId,
        )
        db.add(new_payment)

        new_paid = (order.amountPayed or 0) + amount
        new_balance = max((order.total or 0) - new_paid, 0.0)
        order.amountPayed = new_paid
        order.balance = new_balance
        order.payment_status = "Paid" if new_balance <= 0.10 else "Partial"
        db.add(order)

        _sync_credit_for_order(db, order)

        db.commit()
        db.refresh(new_payment)
        db.refresh(order)

        logger.info(f"Payment recorded for order {order_id}: amount={amount}, new_balance={new_balance}")

        return model.RecordPaymentResponse(
            message="Payment recorded successfully",
            paymentId=new_payment.paymentId,
            orderId=order_id,
            newBalance=new_balance,
            newPaymentStatus=order.payment_status,
        )

    except HTTPException:
        raise
    except IntegrityError as e:
        db.rollback()
        logger.error(f"Database integrity error while recording payment: {e}")
        raise HTTPException(status_code=400, detail="Invalid payment data")
    except Exception as e:
        db.rollback()
        logger.error(f"Unexpected error while recording payment: {e}")
        raise HTTPException(status_code=500, detail="Failed to record payment")

