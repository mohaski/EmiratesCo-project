from fastapi import HTTPException, Depends
from .authService import get_current_user
from entities.customers import Customer
from db.database import get_session
from loggiing import logger
from sqlmodel import Session
from utils import require_role
from sqlalchemy.exc import IntegrityError, SQLAlchemyError
from . import model



def create_customerAccount(customer_info: model.CustomerCreateRequest, db: Session = Depends(get_session), current_user= Depends(get_current_user) ):
    try:
        
        #require_role(['admin', 'CEO'])
        new_customerAccount = Customer(
        name = customer_info.name,
        phoneNumber= customer_info.phoneNumber,
        type = customer_info.type
    ) 
    
        db.add(new_customerAccount)
        db.commit()
        db.refresh(new_customerAccount)
        
        logger.info("customer created successfully")
        return model.CustomerCreateResponse(
            msg = 'customer created successfully',
            customerId = new_customerAccount.customerId
        )
    
    except IntegrityError as ie:
        db.rollback()
        logger.warning(f"Integrity error creating customer: {ie}" , exc_info=True)
        raise HTTPException(status_code=400, detail="Integrity error: possibly invalid foreign key references")
    except SQLAlchemyError as sae:
        db.rollback()
        logger.warning(f"Database error creating credit: {sae}", exc_info=True)
        raise HTTPException(status_code=500, detail="Database error occurred while creating credit")

def get_all_customers(db: Session = Depends(get_session)):
    try:
        from sqlmodel import select
        statement = select(Customer)
        customers = db.exec(statement).all()
        return customers
    except Exception as e:
        logger.error(f"Error retrieving customers: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail="Internal server error")
