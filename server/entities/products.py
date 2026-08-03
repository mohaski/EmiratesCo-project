from sqlmodel import SQLModel, Field, Relationship
from typing import Optional, List, Dict, Any
from sqlalchemy import Column, Enum, JSON

class Category(SQLModel, table=True):
    __tablename__ = "categories"
    categoryId: Optional[int] = Field(default= None, primary_key=True)
    name: str = Field(nullable=False)
    type: str = Field(nullable=False)
    sub_categories: List[Dict[str, Any]] = Field(default=[], sa_column=Column(JSON))
    
    products: List["Product"] = Relationship(back_populates="category")

class Product(SQLModel, table=True):
    __tablename__ = "products"

    productId: Optional[int] = Field(default=None, primary_key=True)
    itemCode: Optional[str] = Field(default=None, nullable=True)
    category_id: int = Field(nullable=False, foreign_key='categories.categoryId')
    name: str = Field(index=True)
    sub_category: Optional[str] = Field(default=None) # e.g. 'window', 'door'
    description: Optional[str] = Field(default=None)
    image_url: Optional[str] = Field(default=None)
    
    track_offcuts: bool = Field(default=False)
    alarm_quantity: Optional[int] = Field(default=0)

    # Measurement unit used to label this product's dimensions & per-unit pricing (e.g. "ft", "mm", "pcs")
    unit: str = Field(default="ft")
    
    # Simple vs Variable Logic
    has_variants: bool = Field(default=False)
    stock_quantity: int = Field(default=0)

    # Price and dimensions live on Variant only — every product has >=1 variant.

    # Attribute classes (e.g. ["Color", "Length"]) used to describe this product's variants —
    # fixed at creation time so "Add Variant" always offers the same attributes to choose from.
    applicable_attributes: List[str] = Field(default=[], sa_column=Column(JSON))
    # Whether Length x Width "Dimensions" is a generating attribute for this product's variants.
    has_dimensions: bool = Field(default=False)

    # ── 2D (glass) offcut tuning — only meaningful when track_offcuts is True and
    # has_dimensions is True (2D length x width cuts, as opposed to 1D length-only) ──
    # Below this size in mm on either side, a remainder is scrap, not a usable offcut.
    # Sheet/offcut dimensions are always tracked in mm regardless of `unit` (a display/
    # pricing label only — see glassOffcutService.py module docstring for why).
    min_usable_dimension: float = Field(default=150.0)
    # Whether a cut piece may be rotated 90° to fit a source sheet/offcut (false for
    # directional/patterned/coated glass where orientation matters).
    allow_rotation: bool = Field(default=True)
    # CEO-configured "this size sells well" bands, e.g. [{"min_w":500,"max_w":650,
    # "min_h":1020,"max_h":1150}, ...] (mm, canonical wide/narrow — see
    # glassOffcutService.py's _meets_popular_threshold). Drives the offcut-tiering
    # decision: an offcut whose OWN size is below every range's min_w/min_h is
    # "small/unpopular" and gets used up before an offcut in-or-above a range is
    # touched at all. Empty means no CEO ranges configured yet for this product —
    # tiering falls back to treating every offcut as a single pool (today's
    # sales-history-only ProtectPopularStockAgent behavior still applies either way).
    popular_size_ranges: List[Dict[str, Any]] = Field(default=[], sa_column=Column(JSON))

    # Relationships
    category: Optional["Category"] = Relationship(back_populates="products")
    orderItems: List["OrderItem"] = Relationship(back_populates="product")
    offcuts: List["Offcut"] = Relationship(back_populates="product")
    variants: List["Variant"] = Relationship(back_populates="product")
