from sqlmodel import Session, create_engine, select
from db.database import DATABASE_URL
from core.ordering import orderService, model
from entities.users import User
from decimal import Decimal
import uuid

import logging

# Configure Logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("core.ordering.orderService")
logger.setLevel(logging.DEBUG)

def test_persistence():
    engine = create_engine(DATABASE_URL)
    # 1. Fetch User
    with Session(engine) as db_user:
        user = db_user.exec(select(User)).first()
        if not user:
            print("No user found!")
            return
        
        print(f"Using user: {user.username} ({user.userId})")
        # We need the user object partially, mainly ID and Role (if checked)
        # Assuming user object is simple enough to pass across sessions or we re-fetch if needed.
        # But create_order just needs current_user object.

    # 2. Create Order
    with Session(engine) as db:
        # Create Order Payload
        payload = model.OrderCreate(
            customerId=None, 
            amountPaid=1500.0,
            servedBy=user.userId,
            paymentStatus="Paid",
            items=[
                model.OrderItemRequest(
                    productId=15, 
                    quantity=3.0,
                    unitPrice=500.0,
                    unitType="pcs",
                    details={"existing": "meta"},
                    totalPrice=1500.0
                )
            ]
        )

        try:
            response = orderService.create_order(payload, db, current_user=user)
            print(f"Order Created! ID: {response.orderId}")
            
            # Verify Persistence
            fetched = orderService.get_order_by_orderId(response.orderId, db)
            print(f"Fetched Order Items: {len(fetched.items)}")
            item0 = fetched.items[0]
            print(f"Item 0 Quantity: {item0.quantity}")
            print(f"Item 0 Details: {item0.details}")
            
            if item0.quantity == 3.0:
                print("PASS: Quantity persisted and retrieved.")
            else:
                print(f"FAIL: Expected 3.0, Got {item0.quantity}")
                
        except Exception as e:
            print(f"ERROR: {e}")
            with open("test_error.log", "w") as f:
                import traceback
                f.write(str(e) + "\n")
                traceback.print_exc(file=f)

if __name__ == "__main__":
    test_persistence()
