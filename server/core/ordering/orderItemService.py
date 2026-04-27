# services/order_item_service.py
from __future__ import annotations

from fastapi import Depends, HTTPException
from sqlmodel import Session, select
#from sqlalchemy.exc import IntegrityError

from entities.orderItems import OrderItem
from loggiing import logger
from db.database import get_session
from .orderService import _calculate_complex_item_total
from . import model


# --------------------------------------------------------------------------- #
# Pure business logic (no DB, no HTTP)
# --------------------------------------------------------------------------- #    


# --------------------------------------------------------------------------- #
# DB layer (still synchronous – easy to make async later)
# --------------------------------------------------------------------------- #
def create_orderItems(order_items: list[model.OrderItemCreate], db: Session = Depends(get_session)) -> model.OrderItemCreateResponse:
    """
    Create multiple order items.
    - Accepts a list of order item data.
    - Returns a structured success message with created item IDs.
    """
    created_item_ids = []
    try:
        # Pre-fetch Products and Variants for performance (N+1 query fix)
        product_ids = [item.productId for item in order_items]
        variant_ids = [item.variantId for item in order_items if item.variantId]
        
        from entities.products import Product
        from entities.variants import Variant
        
        products_cache = {}
        if product_ids:
            products = db.exec(select(Product).where(Product.productId.in_(product_ids))).all()
            products_cache = {p.productId: p for p in products}
            
        variants_cache = {}
        if variant_ids:
            variants = db.exec(select(Variant).where(Variant.variantId.in_(variant_ids))).all()
            variants_cache = {v.variantId: v for v in variants}

        new_items = []
        for item in order_items:
            
            new_order_item = OrderItem(
                order_id=item.orderId,
                product_id=item.productId,
                variant_id=item.variantId,
                quantity=item.quantity,
                unit_price=item.unitPrice,
                unit_type=item.unitType,
                details=item.details
            )

            total = _calculate_complex_item_total(item, db, products_cache, variants_cache)
            new_order_item.total_price = total

            new_items.append(new_order_item)

        db.add_all(new_items)
        db.commit()

        for item in new_items:
            db.refresh(item)
            created_item_ids.append(item.item_id)

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
        statement = select(OrderItem).where(OrderItem.order_id == order_id)
        results = db.exec(statement).all()
        
        if not results:
            # Return empty list instead of 404? 
            # Ideally an order might have no items initially.
            return []
        
        order_items = [
            model.OrderItemResponse(
                productId=item.product_id,
                orderId=item.order_id,
                quantity=item.quantity,
                unitType=item.unit_type,
                unitPrice=item.unit_price,
                totalPrice=item.total_price,
                details=item.details,
                status=item.status
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
