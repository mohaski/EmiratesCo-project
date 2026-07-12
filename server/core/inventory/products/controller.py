from fastapi import APIRouter, Depends, Query, BackgroundTasks
from typing import List, Optional
from sqlmodel import Session
from db.database import get_session
from core.userManagement.authService import get_current_user
from ws.manager import manager
from . import model, service

router = APIRouter(prefix="/products", tags=["Products"])

# ---------------------------------------------------------------------------
# Product CRUD
# ---------------------------------------------------------------------------

@router.post("/", response_model=model.ProductCreateResponse)
async def create_product(
    product_data: model.ProductCreate,
    background_tasks: BackgroundTasks,
    db: Session = Depends(get_session),
    current_user = Depends(get_current_user)
):
    result = service.create_product(product_data, db, current_user)
    background_tasks.add_task(manager.broadcast, "products_updated")
    return result

@router.get("/", response_model=List[model.ProductResponse])
def get_products(
    skip: int = 0,
    limit: int = 100,
    search: Optional[str] = None,
    category_id: Optional[int] = None,
    db: Session = Depends(get_session)
):
    return service.getAllProducts(skip, limit, search, category_id, db)

@router.get("/categories", response_model=List[model.CategoryResponse])
def get_categories(
    db: Session = Depends(get_session)
):
    return service.getAllCategories(db)

@router.post("/categories", response_model=model.CategoryResponse)
async def create_category(
    category_data: model.CategoryCreate,
    background_tasks: BackgroundTasks,
    db: Session = Depends(get_session),
    current_user = Depends(get_current_user)
):
    result = service.create_category(category_data, db)
    background_tasks.add_task(manager.broadcast, "products_updated")
    return result

@router.put("/{product_id}", response_model=model.ProductUpdateResponse)
async def update_product(
    product_id: int,
    update_data: model.ProductUpdateRequest,
    background_tasks: BackgroundTasks,
    db: Session = Depends(get_session),
    current_user = Depends(get_current_user)
):
    result = service.update_product(product_id, update_data, db, current_user)
    background_tasks.add_task(manager.broadcast, "products_updated")
    return result

@router.delete("/{product_id}")
async def delete_product(
    product_id: int,
    background_tasks: BackgroundTasks,
    db: Session = Depends(get_session),
    current_user = Depends(get_current_user)
):
    result = service.remove_product(product_id, db, current_user)
    background_tasks.add_task(manager.broadcast, "products_updated")
    return result

# ---------------------------------------------------------------------------
# Variant Management
# ---------------------------------------------------------------------------

@router.post("/{product_id}/variants", response_model=model.VariantResponse)
async def add_product_variant(
    product_id: int,
    variant_data: model.VariantCreate,
    background_tasks: BackgroundTasks,
    db: Session = Depends(get_session),
    current_user = Depends(get_current_user)
):
    result = service.add_variant(product_id, variant_data, db)
    background_tasks.add_task(manager.broadcast, "products_updated")
    return result

@router.post("/{product_id}/variants/bulk", response_model=List[model.VariantResponse])
async def add_product_variants_bulk(
    product_id: int,
    variants_data: List[model.VariantCreate],
    background_tasks: BackgroundTasks,
    db: Session = Depends(get_session),
    current_user = Depends(get_current_user)
):
    result = service.add_variants_bulk(product_id, variants_data, db)
    background_tasks.add_task(manager.broadcast, "products_updated")
    return result

@router.put("/variants/{variant_id}", response_model=model.VariantResponse)
async def update_variant(
    variant_id: int,
    update_data: model.VariantUpdate,
    background_tasks: BackgroundTasks,
    db: Session = Depends(get_session),
    current_user = Depends(get_current_user)
):
    result = service.update_variant(variant_id, update_data, db, current_user)
    background_tasks.add_task(manager.broadcast, "products_updated")
    return result

# ---------------------------------------------------------------------------
# Stock Management
# ---------------------------------------------------------------------------

@router.put("/{product_id}/stock")
async def update_product_stock(
    product_id: int,
    stock_data: model.StockQuantityUpdateRequest,
    background_tasks: BackgroundTasks,
    db: Session = Depends(get_session),
    current_user = Depends(get_current_user)
):
    result = service.update_simple_product_stock(product_id, stock_data.stock, db, current_user)
    background_tasks.add_task(manager.broadcast, "products_updated")
    return result


@router.get("/restock-history", response_model=list[model.RestockHistoryItem])
def get_restock_history(
    skip: int = 0,
    limit: int = 100,
    product_id: Optional[int] = None,
    db: Session = Depends(get_session),
    current_user = Depends(get_current_user),
):
    """Restock audit log — accessible to manager, ceo, and admin."""
    return service.get_restock_history(db, skip, limit, product_id)

@router.get("/{product_id}/offcuts", response_model=List[model.OffcutResponse])
def get_product_offcuts(
    product_id: int,
    variant_id: Optional[int] = Query(None, description="Filter by variant ID"),
    db: Session = Depends(get_session),
    current_user = Depends(get_current_user)
):
    return service.get_offcuts_for_product(product_id, db, variant_id)

@router.get("/{product_id}/availability", response_model=model.StockAvailabilityResponse)
def check_availability(
    product_id: int,
    qty: int = Query(..., description="Required quantity"),
    variant_id: Optional[int] = Query(None, description="Optional Variant ID"),
    db: Session = Depends(get_session)
):
    return service.check_stock_availability(product_id, qty, db, variant_id)
