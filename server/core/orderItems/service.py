from fastapi import Depends, HTTPException
from . import model
from ...entities.orderItems import OrderItem
from ...logging import logger
from ...db.database import get_session
from sqlmodel import Session, select


def create_orderItems(order_items: list[model.OrderItemCreate], db: Session = Depends(get_session)) -> model.OrderItemCreateResponse:
    """
    Create multiple order items.
    - Accepts a list of order item data.
    - Returns a structured success message with created item IDs.
    """
    created_item_ids = []
    try:
        for item in order_items:
            new_order_item = OrderItem(
                orderId=item.orderId,
                productId=item.productId,
                quantity=item.quantity,
                price=item.price,
                totalAmount=item.totalAmount
            )
            db.add(new_order_item)
            db.commit()
            db.refresh(new_order_item)
            created_item_ids.append(new_order_item.orderItemId)

        logger.info(f"Created {len(created_item_ids)} order items.")
        return model.OrderItemCreateResponse(
            message=f"Successfully created {len(created_item_ids)} order items.",
            orderItemId=created_item_ids
        )
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error creating order items: {e}")
        raise HTTPException(status_code=500, detail="Internal Server Error")
    
def get_orderItems_by_orderId(order_id: int, db: Session = Depends(get_session)) -> list[model.OrderItemResponse]:
    """
    Retrieve order items by order ID.
    - Accepts an order ID.
    - Returns a list of order items associated with the given order ID.
    """
    try:
        statement = select(OrderItem).where(OrderItem.orderId == order_id)
        results = db.exec(statement).all()
        
        if not results:
            raise HTTPException(status_code=404, detail="No order items found for this order ID")
        
        order_items = [
            model.OrderItemResponse(
                productId=item.productId,
                quantity=item.quantity,
                unitType="unit",  # Assuming a default unit type; adjust as necessary
                price=item.price,
                totalPrice=item.totalAmount
            ) for item in results
        ]
        
        logger.info(f"Retrieved {len(order_items)} items for order ID {order_id}.")
        return order_items
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error retrieving order items: {e}")
        raise HTTPException(status_code=500, detail="Internal Server Error")
    

def update_orderItem_status_to_returned(orderItemId: int, db: Session = Depends(get_session)) -> model.OrderItemStatusUpdateResponse:
    """
    Update the status of an order item to 'returned'.
    - Accepts an order item ID.
    - Returns a structured success message upon updating the status.
    """
    try:
        statement = select(OrderItem).where(OrderItem.item_id == orderItemId)
        order_item = db.exec(statement).first()
        
        if not order_item:
            raise HTTPException(status_code=404, detail="Order item not found")
        
        order_item.status = "returned"
        db.add(order_item)
        db.commit()
        db.refresh(order_item)
        
        logger.info(f"Order item ID {orderItemId} status updated to 'returned'.")
        return model.OrderItemStatusUpdateResponse(
            message=f"Order item ID {orderItemId} status updated to 'returned'."
        )
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error updating order item status: {e}")
        raise HTTPException(status_code=500, detail="Internal Server Error")