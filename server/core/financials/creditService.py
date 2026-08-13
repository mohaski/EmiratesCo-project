from fastapi import HTTPException, Depends
from sqlmodel import Session, select
from sqlalchemy import func
from sqlalchemy.exc import IntegrityError, SQLAlchemyError
from datetime import datetime
from entities.credits import Credit
from entities.customers import Customer
from entities.orders import Order
from entities.payments import Payment
from db.database import get_session
from loggiing import logger
from . import model


def create_credit(credit_data: model.CreditCreateRequest, db: Session = Depends(get_session)) -> model.CreditCreateResponse:
    """Create a new credit entry in the database."""
    try:
        new_credit = Credit(
            orderId=credit_data.orderId,
            customerId=credit_data.customerId,
            amount=credit_data.amount,
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
        select(Credit).where(Credit.customerId == customerId)
        )
    
    customer_name = db.exec(select(Customer.name).where(Customer.customerId == customerId)).first()
    
    customerCreditList = db.exec(statement).all()
    if not customerCreditList:
        return {
            'message': f"There is no oustanding credit for customer {customerId}"
        }
        
    return [

        model.checkCreditResponse(
            creditId=customerCredit.creditId,
            customerName=customer_name,
            status=customerCredit.status,
            amount=customerCredit.amount,
            unpaidAmount=customerCredit.amount_due,
            settled_at=customerCredit.settledAt.isoformat() if customerCredit.settledAt else None
        ) for customerCredit in customerCreditList
    ]


def get_all_outstanding_credits(db: Session = Depends(get_session)) -> list[model.OutstandingCreditItem]:
    """Aggregate every outstanding balance across all customers — feeds the
    CEO/Manager dues follow-up page. Sorted by days-outstanding (oldest first),
    since there's no due-date concept."""
    try:
        statement = (
            select(Credit, Customer, Order)
            .join(Customer, Credit.customerId == Customer.customerId)
            .join(Order, Credit.orderId == Order.orderId)
            .where(Credit.status != "Paid")
        )
        rows = db.exec(statement).all()
        if not rows:
            return []

        order_ids = [order.orderId for _, _, order in rows]
        last_payment_stmt = (
            select(Payment.orderId, func.max(Payment.payed_at))
            .where(Payment.orderId.in_(order_ids))
            .group_by(Payment.orderId)
        )
        last_payment_map = dict(db.exec(last_payment_stmt).all())

        now = datetime.utcnow()
        items = []
        for credit, customer, order in rows:
            created_at = order.created_at
            days_outstanding = (now - created_at).days if created_at else 0
            last_payment_at = last_payment_map.get(order.orderId)
            items.append(
                model.OutstandingCreditItem(
                    creditId=credit.creditId,
                    orderId=credit.orderId,
                    customerId=credit.customerId,
                    customerName=customer.name,
                    customerPhone=customer.phoneNumber,
                    amount=credit.amount,
                    amountDue=credit.amount_due,
                    status=credit.status,
                    createdAt=created_at.isoformat() if created_at else "",
                    daysOutstanding=days_outstanding,
                    lastPaymentAt=last_payment_at.isoformat() if last_payment_at else None,
                )
            )

        items.sort(key=lambda i: i.daysOutstanding, reverse=True)
        return items

    except SQLAlchemyError as sae:
        logger.error(f"Database error retrieving outstanding credits: {sae}", exc_info=True)
        raise HTTPException(status_code=500, detail="Database error occurred while retrieving outstanding credits")

