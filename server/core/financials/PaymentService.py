from fastapi import HTTPException, Depends
from ...entities.payments import Payment
from ...db.database import get_session
from ...entities.orders import Order
from sqlalchemy.exc import IntegrityError, SQLAlchemyError
from sqlmodel import Session, select
from ...logging import logger
from sqlalchemy import func
from datetime import datetime

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


def process_payment(payment_data: model.PaymentCreate, db: Session = Depends(get_session)) -> model.PaymentResponse:
    """
    Process a payment for an order.

    Steps:
    1. Validate the order exists.
    2. Prevent duplicate payments for the same order (optional, if needed).
    3. Save payment details in the database.
    4. Return a structured response with the payment ID and message.
    """

    try:
        # ✅ 1. Ensure order exists 
        order = db.exec(
            select(Order).where(Order.orderId == payment_data.orderId)
        ).first()

        if not order:
            raise HTTPException(status_code=404, detail="Order not found")

        # ✅ 2. Create payment
        new_payment = Payment(
            orderId=payment_data.orderId,
            amount=payment_data.amount,
            payment_method=payment_data.paymentMethod,
            number_used=payment_data.numberUsed
        )

        db.add(new_payment)
        db.commit()
        db.refresh(new_payment)

        logger.info(f"✅ Payment processed successfully | PaymentID: {new_payment.paymentId}")

        # ✅ 4. Return clean response
        return model.PaymentResponse(
            msg="Payment processed successfully",
            paymentId=new_payment.paymentId
        )

    except IntegrityError as e:
        db.rollback()
        logger.error(f"Database integrity error while processing payment: {e}")
        raise HTTPException(status_code=400, detail="Invalid payment data")

    except HTTPException:
        # re-raise HTTPExceptions so FastAPI handles them properly
        raise

    except Exception as e:
        db.rollback()
        logger.error(f"Unexpected error while processing payment: {e}")
        raise HTTPException(status_code=500, detail="Failed to process payment")
    
