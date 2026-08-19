from sqlmodel import SQLModel, Field, Relationship
from sqlalchemy import Column, JSON
from typing import Optional, List, Dict, Any
from datetime import datetime
import uuid

class Variant(SQLModel, table=True):
    __tablename__ = "variants"

    variantId: Optional[int] = Field(default=None, primary_key=True)
    product_id: int = Field(foreign_key="products.productId", nullable=False)
    
    name: Optional[str] = Field(default=None) # Optional display name override
    
    # Specific Attributes (Color, Size, Finish)
    attributes: Dict[str, Any] = Field(default={}, sa_column=Column(JSON))
    
    # Inventory. Always a whole-piece count — for a "packaged" variant (one with
    # unit_quantity set, e.g. "Wood Screw / Box of 1000pcs"), this counts
    # individual pieces held in SEALED boxes only (always an exact multiple of
    # unit_quantity — a box is atomic, never partially consumed in place); any
    # loose/opened-box leftover lives in a separate shared pool instead (see
    # inventoryService.py's _deduct_packaged_stock_pooled). A bar/sheet
    # product's variant counts whole bars/sheets, unaffected by unit_quantity
    # (see its own docstring below for why some of those have a spurious
    # unit_quantity that's never read).
    stock_quantity: int = Field(default=0)
    low_stock_threshold: float = Field(default=10.0)
    
    # Price modifiers (added to base product price)
    price: float = Field(default=0.0) # Full Price
    price_half: Optional[float] = Field(default=None)
    price_unit: Optional[float] = Field(default=None)
    
    # For has_dimensions=True products (2D sheets — glass, perspex, etc.), the sheet's
    # two dimensions are `length` x `width`, always in mm regardless of Product.unit
    # (a display/pricing label only). `height` is unused/dead — kept for backward
    # compatibility with existing rows/migrations, not written by any current code path.
    length: Optional[float] = Field(default=None)
    width: Optional[float] = Field(default=None)
    height: Optional[float] = Field(default=None)

    # Numeric quantity carried by a "custom" attribute value (e.g. 1000 for "1000pcs").
    # Meaningful as "pieces per stock unit" ONLY for track_offcuts=False (count-tracked)
    # accessory variants — see stock_quantity above. A track_offcuts=True bar/sheet
    # variant with a numeric custom "Length" (e.g. "21ft") also gets this populated
    # (AddProductPage's buildGeneratedVariants sets it for ANY custom attribute value
    # that carries a stored quantity, regardless of what the attribute represents) but
    # no deduction code path for those products ever reads it — dead data for them.
    unit_quantity: Optional[float] = Field(default=None)

    # Relationships
    product: "Product" = Relationship(back_populates="variants")
    orderItems: List["OrderItem"] = Relationship(back_populates="variant") 

