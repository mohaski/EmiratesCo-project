from pydantic import BaseModel
from typing import Optional, List, Dict, Any
from datetime import datetime

class RestockHistoryItem(BaseModel):
    id: int
    product_id: int
    product_name: str
    variant_name: str
    qty_added: float
    stock_before: float
    stock_after: float
    added_by: str
    added_at: datetime

    class Config:
        from_attributes = True


class CategoryCreate(BaseModel):
    name: str
    sub_categories: List[Dict[str, str]] = []

class SubCategoryCreate(BaseModel):
    name: str

class CategoryResponse(BaseModel):
    categoryId: int
    name: str # Category name (e.g. "Kenyan Profile")
    type: str # ID for frontend (e.g. "ke-profile")
    sub_categories: List[Dict[str, str]] = []

class PopularSizeRange(BaseModel):
    """A CEO-defined "this size sells well" band, mm, canonical wide/narrow.
    Drives glassOffcutService's offcut tiering — see _meets_popular_threshold.
    Per-VARIANT (not per-product) — different thicknesses/sizes of the same
    glass product can each have their own scrap threshold and popular sizes."""
    min_w: float
    max_w: float
    min_h: float
    max_h: float

class VariantCreate(BaseModel):
    attributes: Dict[str, Any] = {}
    stock_quantity: int = 0
    price: float = 0.0
    price_half: Optional[float] = None
    price_unit: Optional[float] = None
    length: Optional[float] = None
    width: Optional[float] = None
    height: Optional[float] = None
    unit_quantity: Optional[float] = None
    # Per-variant low-stock alarm threshold — defaults to 0 (no alarm) for every
    # newly-generated variant; the CEO sets a real value later from Manage Variants.
    low_stock_threshold: float = 0.0
    # Offcut tuning — per-variant (see PopularSizeRange) so e.g. a 4mm sheet and a
    # 12mm sheet of the same product can differ. Not required at creation: None
    # picks a context-aware default server-side (150mm for a has_dimensions=True
    # product, 2ft for a 1D bar/profile one — see products/service.py's
    # create_product) and is refined later per-variant via Manage Variants.
    # allow_rotation/popular_size_ranges are 2D (glass) only, ignored for 1D products.
    min_usable: Optional[float] = None
    allow_rotation: bool = True
    popular_size_ranges: List[PopularSizeRange] = []

class VariantUpdate(BaseModel):
    price: Optional[float] = None
    price_half: Optional[float] = None
    price_unit: Optional[float] = None
    length: Optional[float] = None
    width: Optional[float] = None
    height: Optional[float] = None
    unit_quantity: Optional[float] = None
    stock_change: Optional[int] = None
    low_stock_threshold: Optional[float] = None
    min_usable: Optional[float] = None
    allow_rotation: Optional[bool] = None
    # Full replace (not merged) when provided — the CEO always resends the complete
    # list from Manage Variants, same as how a fresh set of ranges is authored.
    popular_size_ranges: Optional[List[PopularSizeRange]] = None
    # Merged into the variant's existing attributes dict (not replaced) — lets the
    # CEO backfill a newly-added attribute class onto pre-existing variants from
    # Manage Variants without needing to also resend every attribute already set.
    attributes: Optional[Dict[str, Any]] = None

class VariantResponse(BaseModel):
    variantId: int
    name: Optional[str]
    attributes: Dict[str, Any]
    stock_quantity: int
    price: float
    price_half: Optional[float]
    price_unit: Optional[float]
    length: Optional[float] = None
    width: Optional[float] = None
    height: Optional[float] = None
    unit_quantity: Optional[float] = None
    low_stock_threshold: float = 0.0
    min_usable: float = 150.0
    allow_rotation: bool = True
    popular_size_ranges: List[PopularSizeRange] = []


class ProductCreate(BaseModel):
    name: str
    itemCode: Optional[str] = None
    category_id: int
    sub_category: Optional[str] = None
    description: Optional[str] = None
    image_url: Optional[str] = None

    trackOffcuts: bool = False
    alarm_quantity: int = 0
    unit: str = "ft"

    applicable_attributes: List[str] = []
    has_dimensions: bool = False
    # Which of applicable_attributes (plus "Dimensions" when has_dimensions=True) to
    # ignore when deciding whether two variants share an offcut/stock pool — see
    # core/inventory/poolKey.py. None keeps the automatic rule (ignore "Dimensions"
    # and any custom-typed attribute); explicit (even []) always wins from then on.
    pool_ignored_attributes: Optional[List[str]] = None

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

    trackOffcuts: Optional[bool] = None
    alarm_quantity: Optional[int] = None
    unit: Optional[str] = None

    applicable_attributes: Optional[List[str]] = None
    has_dimensions: Optional[bool] = None

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

    track_offcuts: bool = False
    unit: str = "ft"

    applicable_attributes: List[str] = []
    has_dimensions: bool = False
    pool_ignored_attributes: Optional[List[str]] = None

    # Computed or Relation
    variants: List[VariantResponse] = []
    

class StockAvailabilityResponse(BaseModel):
    message: str

class StockQuantityUpdateRequest(BaseModel):
    stock: int

class OffcutResponse(BaseModel):
    offcutId: int
    product_id: int
    variant_id: Optional[int]
    length: float
    width: Optional[float] = None
    height: Optional[float] = None
    status: str = "available"
    quantity: int

    class Config:
        from_attributes = True


class OffcutCreate(BaseModel):
    """A manager-entered offcut piece — one row of a bulk 'Add Offcuts' submission.
    For a 2D (has_dimensions) product, width+height are required (mm); for a 1D
    (bar/profile) product, length is required, in the product's own unit."""
    variant_id: Optional[int] = None
    length: Optional[float] = None
    width: Optional[float] = None
    height: Optional[float] = None
    quantity: int = 1


class GlassCutPreviewCut(BaseModel):
    l: float
    w: float
    qty: int = 1
    u: str = "mm"  # 'ft' | 'inch' | 'mm' — matches GlassCalculator's per-cut unit dropdown


class GlassCutPreviewRequest(BaseModel):
    variant_id: Optional[int] = None
    cuts: List[GlassCutPreviewCut]


class OffcutReplacementPreviewPiece(BaseModel):
    width: float
    height: float


class OffcutReplacementPreviewRequest(BaseModel):
    """Dry-run: given cut pieces whose recorded source turned out to be wrong
    (the cutter missed), what replacement offcut/sheet would supply them?"""
    variant_id: Optional[int] = None
    pieces: List[OffcutReplacementPreviewPiece]
    forced_offcut_id: Optional[int] = None


class LineItemsFeasibilityRequest(BaseModel):
    """Generic across product families (profile bars, glass sheets, ...) —
    line_items is whatever shape inventoryService._process_line_items already
    knows how to dispatch (profile-full/half/cut, sheet-full/half, glass-cut, ...)."""
    variant_id: Optional[int] = None
    line_items: List[Dict[str, Any]]


class LineItemsFeasibilityResponse(BaseModel):
    ok: bool
    message: Optional[str] = None


