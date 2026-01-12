from sqlmodel import SQLModel, Field, Relationship
from typing import Optional
from datetime import datetime

class Offcut(SQLModel, table=True):
    __tablename__ = "offcuts"

    offcutId: Optional[int] = Field(default=None, primary_key=True)
    
    # Product Links
    product_id: int = Field(foreign_key="products.productId", nullable=False)
    variant_id: Optional[int] = Field(default=None, foreign_key="variants.variantId", nullable=True)
    
    # Dimensions
    length: float = Field(nullable=False) # Available length
    quantity: int = Field(default=1) # How many pieces of this length
    
    # Metadata
    created_at: datetime = Field(default_factory=datetime.utcnow)
    
    # Relationships
    product: "Product" = Relationship(back_populates="offcuts")
    # variant relationship if needed