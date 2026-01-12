from fastapi import APIRouter, Depends, HTTPException, Query
from typing import List, Optional
from sqlmodel import Session
from db.database import get_session
from entities.products import Product
from core.userManagement.authService import get_current_user
from . import model, service

router = APIRouter(prefix="/products", tags=["Products"])

# ---------------------------------------------------------------------------
# Product CRUD
# ---------------------------------------------------------------------------

@router.post("/", response_model=model.ProductCreateResponse)
def create_product(
    product_data: model.ProductCreate,
    db: Session = Depends(get_session),
    current_user = Depends(get_current_user)
):
    """
    Create a new product with optional variants.
    Requires Admin/CEO role.
    """
    return service.create_product(product_data, db, current_user)

@router.get("/", response_model=List[model.ProductResponse])
def get_products(
    skip: int = 0,
    limit: int = 100,
    search: Optional[str] = None,
    category_id: Optional[int] = None,
    db: Session = Depends(get_session)
):
    """
    Get all products with pagination and search.
    """
    return service.getAllProducts(skip, limit, search, category_id, db)

@router.get("/categories", response_model=List[model.CategoryResponse])
def get_categories(
    db: Session = Depends(get_session)
):
    """
    Get all product categories.
    """
    return service.getAllCategories(db)

@router.post("/categories", response_model=model.CategoryResponse)
def create_category(
    category_data: model.CategoryCreate,
    db: Session = Depends(get_session),
    current_user = Depends(get_current_user)
):
    """
    Create a new category.
    """
    return service.create_category(category_data, db)

@router.put("/{product_id}", response_model=model.ProductUpdateResponse)
def update_product(
    product_id: int,
    update_data: model.ProductUpdateRequest,
    db: Session = Depends(get_session),
    current_user = Depends(get_current_user)
):
    """
    Update product details.
    """
    return service.update_product(product_id, update_data, db, current_user)

@router.delete("/{product_id}")
def delete_product(
    product_id: int,
    db: Session = Depends(get_session),
    current_user = Depends(get_current_user)
):
    """
    Delete a product.
    """
    return service.remove_product(product_id, db, current_user)

# ---------------------------------------------------------------------------
# Variant Management
# ---------------------------------------------------------------------------

@router.post("/{product_id}/variants", response_model=model.VariantResponse)
def add_product_variant(
    product_id: int,
    variant_data: model.VariantCreate,
    db: Session = Depends(get_session),
    current_user = Depends(get_current_user)
):
    """
    Add a variant to a product.
    """
    return service.add_variant(product_id, variant_data, db)

@router.put("/variants/{variant_id}", response_model=model.VariantResponse)
def update_variant(
    variant_id: int,
    update_data: model.VariantUpdate,
    db: Session = Depends(get_session),
    current_user = Depends(get_current_user)
):
    """
    Update variant price or stock.
    """
    return service.update_variant(variant_id, update_data, db)

# ---------------------------------------------------------------------------
# Stock Management
# ---------------------------------------------------------------------------

@router.get("/{product_id}/availability", response_model=model.StockAvailabilityResponse)
def check_availability(
    product_id: int,
    qty: int = Query(..., description="Required quantity"),
    variant_id: Optional[int] = Query(None, description="Optional Variant ID"),
    db: Session = Depends(get_session)
):
    """
    Check stock availability.
    """
    return service.check_stock_availability(product_id, qty, db, variant_id)
