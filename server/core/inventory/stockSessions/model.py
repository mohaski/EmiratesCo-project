from pydantic import BaseModel
from typing import List, Optional
from datetime import datetime


class StockInputLineCreate(BaseModel):
    """One restock cart row — entered_quantity is in the unit the user typed
    (e.g. boxes), conversion_factor converts it to the pieces-tracked
    stock_quantity (see entities/variants.py)."""
    product_id: int
    variant_id: Optional[int] = None
    entered_quantity: float
    entered_unit: Optional[str] = None
    conversion_factor: float = 1.0


class OffcutLineCreate(BaseModel):
    """One manually-entered offcut cart row — same shape as products/model.py's
    OffcutCreate. For a 2D (has_dimensions) product, width+height are required
    (mm); for a 1D (bar/profile) product, length is required, in the product's
    own unit. Restricted to manager/ceo/admin at finalize time (cashiers can
    restock but not add offcuts)."""
    product_id: int
    variant_id: Optional[int] = None
    length: Optional[float] = None
    width: Optional[float] = None
    height: Optional[float] = None
    quantity: int = 1


class StockInputSessionCreate(BaseModel):
    notes: Optional[str] = None
    stock_lines: List[StockInputLineCreate] = []
    offcut_lines: List[OffcutLineCreate] = []


class StockInputSessionItemResponse(BaseModel):
    id: int
    line_type: str
    product_id: int
    variant_id: Optional[int] = None
    product_name: str
    variant_name: Optional[str] = None

    entered_quantity: float
    entered_unit: Optional[str] = None
    quantity_change: float
    stock_before: Optional[float] = None
    stock_after: Optional[float] = None

    offcut_length: Optional[float] = None
    offcut_width: Optional[float] = None
    offcut_height: Optional[float] = None
    offcut_quantity: Optional[int] = None

    edited_by: Optional[str] = None
    edited_at: Optional[datetime] = None

    class Config:
        from_attributes = True


class StockInputSessionSummary(BaseModel):
    id: int
    created_by: str
    created_at: datetime
    notes: Optional[str] = None
    item_count: int


class StockInputSessionResponse(BaseModel):
    id: int
    created_by: str
    created_at: datetime
    notes: Optional[str] = None
    items: List[StockInputSessionItemResponse] = []


class StockInputItemCorrection(BaseModel):
    entered_quantity: float
    notes: Optional[str] = None
