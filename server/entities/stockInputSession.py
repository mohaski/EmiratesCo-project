from sqlmodel import SQLModel, Field, Relationship
from sqlalchemy import func
from typing import Optional, List
from datetime import datetime
from uuid import UUID


class StockInputSession(SQLModel, table=True):
    __tablename__ = "stock_input_sessions"

    id: Optional[int] = Field(default=None, primary_key=True)
    created_by: UUID = Field(foreign_key="users.userId", index=True)
    created_at: datetime = Field(sa_column_kwargs={"server_default": func.now()}, index=True)
    notes: Optional[str] = Field(default=None)

    items: List["StockInputSessionItem"] = Relationship(back_populates="session")


class StockInputSessionItem(SQLModel, table=True):
    """One line of a finalized Stock Control batch — either a restock (adds to
    Product/Variant.stock_quantity) or an offcut (adds a new pool piece via
    core/inventory/products/service.py's add_offcuts_bulk logic, which doesn't
    touch stock_quantity at all). Both share one table/session so a manager can
    mix restock and offcut lines in a single cart and finalize them together;
    line_type picks which set of fields below is populated."""
    __tablename__ = "stock_input_session_items"

    id: Optional[int] = Field(default=None, primary_key=True)
    session_id: int = Field(foreign_key="stock_input_sessions.id", index=True)
    line_type: str = Field(default="restock", index=True)  # 'restock' | 'offcut'

    product_id: int = Field(foreign_key="products.productId", index=True)
    variant_id: Optional[int] = Field(default=None, foreign_key="variants.variantId")

    product_name: str
    variant_name: Optional[str] = Field(default=None)

    # --- restock fields ---
    # What the user typed (e.g. 5 boxes) and the pieces-per-unit factor captured
    # at entry time, so a later correction can recompute quantity_change without
    # re-deriving the pack-size factor from the (possibly since-changed) variant.
    entered_quantity: float = Field(default=0.0)
    entered_unit: Optional[str] = Field(default=None)
    conversion_factor: float = Field(default=1.0)
    quantity_change: float = Field(default=0.0)
    stock_before: Optional[float] = Field(default=None)
    stock_after: Optional[float] = Field(default=None)

    # --- offcut fields ---
    offcut_length: Optional[float] = Field(default=None)
    offcut_width: Optional[float] = Field(default=None)
    offcut_height: Optional[float] = Field(default=None)
    offcut_quantity: Optional[int] = Field(default=None)
    created_offcut_id: Optional[int] = Field(default=None, foreign_key="offcuts.offcutId")

    # Corrections currently only supported for restock lines (see
    # stockSessions/service.py's correct_stock_input_session_item).
    edited_by: Optional[UUID] = Field(default=None, foreign_key="users.userId")
    edited_at: Optional[datetime] = Field(default=None)

    session: Optional[StockInputSession] = Relationship(back_populates="items")
