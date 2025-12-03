from fastapi import HTTPException, Depends
from sqlmodel import Session, select
from sqlalchemy import func
from sqlalchemy.exc import IntegrityError, SQLAlchemyError
from datetime import datetime
from ...entities.credits import Credit
from ...entities.customers import Customer
from ...db.database import get_session
from ...logging import logger
from . import model


def create_credit(credit_data: model.CreditCreate, db: Session = Depends(get_session)) -> model.CreditCreateResponse:
    """Create a new credit entry in the database."""
    try:
        new_credit = Credit(
            orderId=credit_data.orderId,
            customerId=credit_data.customerId,
            amount= credit_data.amount_due,
            amount_due=credit_data.amount_due,
            status=credit_data.status
        )
        db.add(new_credit)
        db.commit()
        db.refresh(new_credit)

        logger.info(f"Created new credit with ID: {new_credit.creditId}")
        return model.CreditCreateResponse(
            message="Credit created successfully",
            creditId=new_credit.creditId
        )

    except IntegrityError as ie:
        db.rollback()
        logger.error(f"Integrity error creating credit: {ie}", exc_info=True)
        raise HTTPException(status_code=400, detail="Integrity error: possibly invalid foreign key references")
    except SQLAlchemyError as sae:
        db.rollback()
        logger.error(f"Database error creating credit: {sae}", exc_info=True)
        raise HTTPException(status_code=500, detail="Database error occurred while creating credit")


def update_credit(payedAmount: float, order_id: int, credit_data: model.CreditUpdate, db: Session = Depends(get_session)) -> model.CreditUpdateResponse:
    """Update an existing credit entry."""
    try:
        credit = db.exec(
            select(Credit).where(Credit.orderId == order_id)
        ).first()

        if not credit:
            raise HTTPException(status_code=404, detail="Credit not found for the given order ID")
        
        unpaidAmount = credit.unpaid
      
        if payedAmount > credit.amount_due:
            raise HTTPException(status_code=400, detail="Paid amount exceeds the amount due")
        elif payedAmount == credit.amount_due:
            credit.amount_due = 0.0
            credit.status = "Paid"
            credit.settledAt = datetime.utcnow()
        else:
            credit.amount_due -= payedAmount
            if credit.status != "Partially Paid":
                credit.status = "Partially Paid"

        db.add(credit)
        db.commit()
        db.refresh(credit)

        logger.info(f"Updated credit for Order ID: {order_id}")
        return model.CreditUpdateResponse(
            message="Credit updated successfully",
            creditId=credit.creditId
        )

    except IntegrityError as ie:
        db.rollback()
        logger.error(f"Integrity error updating credit: {ie}", exc_info=True)
        raise HTTPException(status_code=400, detail="Integrity error: possibly invalid data")
    except SQLAlchemyError as sae:
        db.rollback()
        logger.error(f"Database error updating credit: {sae}", exc_info=True)
        raise HTTPException(status_code=500, detail="Database error occurred while updating credit")

def check_credit_for_customer_by_customerId(customerId, db: Session = Depends(get_session)) -> list[model.CreditCreateRequest]:
    statement = (
        select(credits).where(Credit.customerId == customerId)
        )
    
    customer_name = db.exec(select(Customer.name).where(Customer.customerId == customerId)).first()
    
    customerCreditList = db.exec(statement).all()
    if not customerCreditList:
        return {
            'message': f"There is no oustanding credit for customer {customerId}"
        }
        
    return [
        
        model.checkCreditResponse(
            creditId = customerCredit.creditId,
            customerName = customer_name,
            status = customerCredit.status,
            amount = customerCredit.amount,
            unpaidAmount = customerCredit.unpaid_amount,
            settledAt = customerCredit.settledAt
        ) for customerCredit in customerCreditList
    ] 
    