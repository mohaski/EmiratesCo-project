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

    # Relationships
    order: "Order" = Relationship(back_populates="orderItems")
    product: "Product" = Relationship(back_populates="orderItems")
    
    variant: Optional["Variant"] = Relationship(back_populates="orderItems") # Add if needed on Variant side
