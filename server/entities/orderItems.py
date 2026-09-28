from sqlmodel import Field, SQLModel, Relationship
from sqlalchemy import Enum, Column, JSON
from typing import Optional, Dict, Any
from datetime import datetime

class OrderItem(SQLModel, table=True):
    __tablename__ = "orderitems"

    item_id: Optional[int] = Field(default=None, primary_key=True)
    order_id: int = Field(foreign_key="orders.orderId")
    product_id: int = Field(foreign_key="products.productId")

    total_price: float = Field(nullable=False)

    # Detailed Attributes (Dimensions, Color, Glass Type, etc.)
    details: Optional[Dict[str, Any]] = Field(default=None, sa_column=Column(JSON))

    status: Optional[str] = Field(sa_column= Column(Enum("purchased", "returned", name=" orderItemstatus_enum"), default="purchased"))
    variant_id: Optional[int] = Field(default=None, foreign_key="variants.variantId")

    # True means either "nothing to cut" (default, untouched) or "cutting has been
    # explicitly reported done" — cutting_completed_at is what actually distinguishes
    # those two cases (see deduct_stock_for_order_item / mark_cutting_complete_batch).
    cutting_completed: bool = Field(default=True)
    cutting_completed_at: Optional[datetime] = Field(default=None)

    # Where this item sits in the cart the customer/cashier built. Callers match the
    # order's items back to that array POSITIONALLY (the printed cutting worksheet in
    # ReceiptPage does exactly this), which used to be safe because item_id order was
    # insertion order and every edit recreated every item. It no longer is: update_order
    # keeps an unchanged item at its original id and appends the changed ones, so a kept
    # item can sort ahead of one that precedes it in the cart. This column makes the
    # intended order explicit instead of inferred.
    position: int = Field(default=0, nullable=False, index=True)

    # Relationships
    order: "Order" = Relationship(back_populates="orderItems")
    product: "Product" = Relationship(back_populates="orderItems")
    
    variant: Optional["Variant"] = Relationship(back_populates="orderItems") # Add if needed on Variant side
