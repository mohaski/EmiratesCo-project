from sqlmodel import SQLModel, Field, Relationship
from typing import Optional
from datetime import datetime

class Offcut(SQLModel, table=True):
    __tablename__ = "offcuts"

    offcutId: Optional[int] = Field(default=None, primary_key=True)
    
    # Product Links
    product_id: int = Field(foreign_key="products.productId", nullable=False)
    # Provenance only — which SKU's cutting job actually produced this row (or the
    # SKU a manager entered it against). NOT used to scope availability queries —
    # see `pool_key` below.
    variant_id: Optional[int] = Field(default=None, foreign_key="variants.variantId", nullable=True)

    # Groups offcuts that are physically the same material across variants that
    # differ only by a size/sale-unit attribute (profile bar length, glass sheet
    # dimensions, accessory pack size) — see core/inventory/poolKey.py. Empty
    # string for a variantless product or a variant with no other distinguishing
    # attributes. This, not variant_id, is what every availability query filters on.
    pool_key: str = Field(default="", nullable=False, index=True)

    # Dimensions — 1D (bar/profile) products use `length` only.
    # 2D (glass) products use `width` + `height` instead; `length` stays 0/unused for those rows.
    length: float = Field(default=0.0, nullable=False) # Available length (1D products)
    width: Optional[float] = Field(default=None)  # Available width (2D/glass products)
    height: Optional[float] = Field(default=None) # Available height (2D/glass products)
    quantity: int = Field(default=1) # How many pieces of this size

    # "available" (usable, in the pickable pool) or "scrap" (below min usable size — kept for waste reporting only)
    status: str = Field(default="available")

    # Which OrderItem's cutting job produced this remainder — permanent provenance link,
    # never cleared. Checked against that item's cutting_completed at consumption time to
    # decide whether to attach a pending_source_notice (see glassOffcutService/inventoryService).
    source_item_id: Optional[int] = Field(default=None, foreign_key="orderitems.item_id", index=True)

    # Metadata
    created_at: datetime = Field(default_factory=datetime.utcnow)
    
    # Relationships
    product: "Product" = Relationship(back_populates="offcuts")
    # variant relationship if needed