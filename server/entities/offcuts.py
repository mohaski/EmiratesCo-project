from sqlmodel import SQLModel, Field, Relationship
from typing import Optional
from datetime import datetime

class Offcut(SQLModel, table=True):
    __tablename__ = "offcuts"

    offcutId: Optional[int] = Field(default=None, primary_key=True)
    
    # Product Links
    product_id: int = Field(foreign_key="products.productId", nullable=False)
    variant_id: Optional[int] = Field(default=None, foreign_key="variants.variantId", nullable=True)
    
    # Dimensions — 1D (bar/profile) products use `length` only.
    # 2D (glass) products use `width` + `height` instead; `length` stays 0/unused for those rows.
    length: float = Field(default=0.0, nullable=False) # Available length (1D products)
    width: Optional[float] = Field(default=None)  # Available width (2D/glass products)
    height: Optional[float] = Field(default=None) # Available height (2D/glass products)
    quantity: int = Field(default=1) # How many pieces of this size

    # "available" (usable, in the pickable pool) or "scrap" (below min usable size — kept for waste reporting only)
    status: str = Field(default="available")

    # Metadata
    created_at: datetime = Field(default_factory=datetime.utcnow)
    
    # Relationships
    product: "Product" = Relationship(back_populates="offcuts")
    # variant relationship if needed