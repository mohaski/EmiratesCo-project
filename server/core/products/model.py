from pydantic import BaseModel
from typing import Optional
from datetime import datetime
    
class ProductCreate(BaseModel):
    itemName: str
    itemCode: Optional[str] = None
    versionCategory: str
    useForCategory: str
    productCategory: str
    color: Optional[str] = None
    fullSizeLength: Optional[float] = None
    priceFull: int
    price_per_unit: Optional[int] = None
    price_per_half: Optional[int] = None
    trackOffcuts: Optional[bool] = False
    stock: int = 0
    alarm_quantity: Optional[int] = 0
    
class ProductCreateResponse(BaseModel):
    message: str
    id: int
    
class ProductUpdateRequest(BaseModel):
    itemName: Optional[str] = None
    itemCode: Optional[str] = None
    versionCategory: Optional[str] = None
    useForCategory: Optional[str] = None
    productCategory: Optional[str] = None
    color: Optional[str] = None
    fullSizeLength: Optional[float] = None
    priceFull: Optional[int] = None
    price_per_unit: Optional[int] = None
    price_per_half: Optional[int] = None
    trackOffcuts: Optional[bool] = None
    stock: Optional[int] = None
    alarm_quantity: Optional[int] = None
    
class ProductUpdateResponse(BaseModel):
    message: str
    id: int
    

class StockAvailabilityResponse(BaseModel):
    in_stock: bool
    available_quantity: int
class StockQuantityUpdateRequest(BaseModel):
    stock: int
    
    
