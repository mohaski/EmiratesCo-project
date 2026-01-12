from pydantic import BaseModel
from typing import Optional, List, Dict, Any

class CategoryCreate(BaseModel):
    name: str
    sub_categories: List[Dict[str, str]] = []

class CategoryResponse(BaseModel):
    categoryId: int
    name: str # Category name (e.g. "Kenyan Profile")
    type: str # ID for frontend (e.g. "ke-profile")
    sub_categories: List[Dict[str, str]] = []

class VariantCreate(BaseModel):
    attributes: Dict[str, Any] = {}
    stock_quantity: float = 0.0
    price: float = 0.0
    price_half: Optional[float] = None
    price_unit: Optional[float] = None
    length: Optional[float] = None

class VariantUpdate(BaseModel):
    price: Optional[float] = None
    price_half: Optional[float] = None
    price_unit: Optional[float] = None
    length: Optional[float] = None
    stock_change: Optional[int] = None
    
class VariantResponse(BaseModel):
    variantId: int
    name: Optional[str]
    attributes: Dict[str, Any]
    stock_quantity: float
    price: float
    price_half: Optional[float]
    price_unit: Optional[float]
    length: Optional[float] = None

class ProductCreate(BaseModel):
    name: str
    itemCode: Optional[str] = None
    category_id: int
    sub_category: Optional[str] = None
    description: Optional[str] = None
    image_url: Optional[str] = None
    
    price_full: float = 0.0
    price_half: Optional[float] = None
    price_unit: Optional[float] = None
    length: Optional[float] = None
    
    trackOffcuts: bool = False
    alarm_quantity: int = 0
    
    # Simple Product Support
    stock: Optional[int] = 0
    
    variants: List[VariantCreate] = []

class ProductCreateResponse(BaseModel):
    message: str
    id: int
    
class ProductUpdateRequest(BaseModel):
    name: Optional[str] = None
    itemCode: Optional[str] = None
    category_id: Optional[int] = None
    sub_category: Optional[str] = None
    description: Optional[str] = None
    image_url: Optional[str] = None
    price_full: Optional[float] = None
    price_half: Optional[float] = None
    price_unit: Optional[float] = None
    length: Optional[float] = None
    
    trackOffcuts: Optional[bool] = None
    alarm_quantity: Optional[int] = None
    
class ProductUpdateResponse(BaseModel):
    message: str
    id: int

class ProductResponse(BaseModel):
    productId: int
    name: str
    itemCode: Optional[str]
    category_id: int
    sub_category: Optional[str]
    description: Optional[str]
    image_url: Optional[str]
    
    has_variants: bool
    stock_quantity: int
    
    price_full: Optional[float]
    price_half: Optional[float]
    price_unit: Optional[float] = None
    length: Optional[float] = None # Added length field
    
    track_offcuts: bool = False
    
    # Computed or Relation
    variants: List[VariantResponse] = []
    

class StockAvailabilityResponse(BaseModel):
    message: str
    
class StockQuantityUpdateRequest(BaseModel):
    stock: int
    
    
