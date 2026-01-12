from fastapi import Depends, HTTPException, status
from sqlmodel import Session, select, col, or_
from typing import List, Optional
from entities.products import Product, Category
from entities.variants import Variant
from . import model
from db.database import get_session
from core.userManagement.authService import get_current_user
from loggiing import logger
from utils import require_role


def create_product(
    product_data: model.ProductCreate, 
    db: Session = Depends(get_session), 
    current_user=Depends(get_current_user)
) -> model.ProductCreateResponse:
    """
    Create a new product with optional variants.
    """
    try:
        # Debug Log
        logger.info(f"Creating Product: {product_data.name}")
        logger.info(f"Variants Payload ({len(product_data.variants)}): {product_data.variants}")
        
        # require_role(["admin", "CEO", "manager"], current_user) # Uncomment when roles active
        
        # 1. Check Duplicates (Name or ItemCode)
        query = select(Product).where(
            or_(
                Product.name == product_data.name
            )
        )
        if db.exec(query).first():
            raise HTTPException(status_code=400, detail="Product with this name or code already exists")

        # 2. Determine Mode
        has_variants = len(product_data.variants) > 0
        initial_stock = 0
        
        if not has_variants:
            # Simple Product: Use provided stock
            initial_stock = product_data.stock or 0
        else:
            # Variable Product: Stock is sum of variants
            initial_stock = sum(v.stock_quantity for v in product_data.variants)

        # 3. Create Product Entity
        new_product = Product(
            name=product_data.name,
            itemCode=product_data.itemCode,
            category_id=product_data.category_id,
            sub_category=product_data.sub_category,
            description=product_data.description,
            image_url=product_data.image_url,
            price_full=product_data.price_full,
            price_half=product_data.price_half,
            price_unit=product_data.price_unit,
            length=product_data.length,
            
            track_offcuts=product_data.trackOffcuts,
            alarm_quantity=product_data.alarm_quantity,
            
            # Explicit Simple/Variable Logic
            has_variants=has_variants,
            stock_quantity=initial_stock
        )
        db.add(new_product)
        db.flush() # Generate ID but stay in transaction
        db.refresh(new_product)
        
        # 4. Create Variants (Only if Variable Mode)
        if has_variants:
            for v_data in product_data.variants:
                # Generate Name
                v_name = " - ".join(str(v) for v in v_data.attributes.values())
                
                new_variant = Variant(
                    product_id=new_product.productId,
                    name=v_name,
                    attributes=v_data.attributes,
                    stock_quantity=v_data.stock_quantity,
                    price=v_data.price,
                    price_half=v_data.price_half,
                    price_unit=v_data.price_unit,
                    length=v_data.length
                )
                db.add(new_variant)
            
        db.commit()

        logger.info(f"Product created: {new_product.name} (Simple: {not has_variants})")
        return model.ProductCreateResponse(message="Product created successfully", id=new_product.productId)

    except HTTPException:
        raise
    except Exception as e:
        db.rollback()
        logger.error(f"Create Product Error: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=str(e))

def getAllProducts(
    skip: int = 0, 
    limit: int = 100, 
    search: Optional[str] = None,
    category_id: Optional[int] = None,
    db: Session = Depends(get_session)
) -> List[Product]: # Return Entity list, let FastAPI serialization handle Pydantic conversion
    try:
        query = select(Product).offset(skip).limit(limit)
        
        if search:
            query = query.where(
                or_(
                    col(Product.name).ilike(f"%{search}%")
                )
            )
            
        if category_id:
            query = query.where(Product.category_id == category_id)

        # Ensure eager loading if needed, though SQLModel usually handles relationships lazy unless specified
        # For now simple select is strictly strictly fine
        products = db.exec(query).all()
        return products
    except Exception as e:
        logger.error(f"Get Products Error: {e}")
        raise HTTPException(status_code=500, detail="Failed to fetch products")

def update_product(
    product_id: int, 
    update_data: model.ProductUpdateRequest, 
    db: Session = Depends(get_session),
    current_user = Depends(get_current_user)
) -> model.ProductUpdateResponse:
    try:
        product = db.get(Product, product_id)
        if not product:
            logger.warning(f"Product {product_id} not found.")
            raise HTTPException(status_code=404, detail="Product not found")

        update_dict = update_data.dict(exclude_unset=True)
        for key, value in update_dict.items():
            setattr(product, key, value)
            
        db.add(product)
        db.commit()
        db.refresh(product)
        
        return model.ProductUpdateResponse(message="Product updated", id=product.productId)
    except Exception as e:
        db.rollback()
        logger.error(f"Update Product Error: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=str(e))

def remove_product(product_id: int, db: Session = Depends(get_session), current_user = Depends(get_current_user)):
    try:
        product = db.get(Product, product_id)
        if not product:
            logger.warning(f"Product {product_id} not found for stock update.")
            raise HTTPException(status_code=404, detail="Product not found")
        db.delete(product)
        db.commit()
        return {"message": "Product deleted", "id": product_id}
    except Exception as e:
        db.rollback()
        logger.error(f"Remove Product Error: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=str(e))

# --- VARIANT MANAGEMENT ---

def add_variant(product_id: int, variant_data: model.VariantCreate, db: Session = Depends(get_session)):
    try:
        # 1. Generate Name (Strict)
        final_name = " - ".join(str(v) for v in variant_data.attributes.values())

        # 2. Create Variant
        variant = Variant(
            product_id=product_id,
            name=final_name,
            attributes=variant_data.attributes,
            stock_quantity=variant_data.stock_quantity,
            price=variant_data.price,
            price_half=variant_data.price_half,
            price_unit=variant_data.price_unit,
            length=variant_data.length
        )
        db.add(variant)
        
        # 2. Update Parent Product Stock
        # We must keep the cache in sync
        product = db.get(Product, product_id)
        if product:
            product.has_variants = True 
            product.stock_quantity = (product.stock_quantity or 0) + variant.stock_quantity
            db.add(product)
            
        db.commit()
        db.refresh(variant)
        return variant
    except Exception as e:
        db.rollback()
        logger.error(f"Add Variant Error: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=str(e))

def update_variant(variant_id: int, update_data: model.VariantUpdate, db: Session = Depends(get_session)):
    try:
        variant = db.get(Variant, variant_id)
        if not variant:
             raise HTTPException(status_code=404, detail="Variant not found")
        
        # 1. Update Prices
        if update_data.price is not None:
             logger.info(f"Updating Variant {variant_id} Price: {variant.price} -> {update_data.price}")
             variant.price = update_data.price
        
        if update_data.price_half is not None:
             variant.price_half = update_data.price_half
             
        if update_data.price_unit is not None:
             variant.price_unit = update_data.price_unit

        if update_data.length is not None:
             variant.length = update_data.length
             
        # 2. Update Stock (Delta)
        if update_data.stock_change is not None:
             logger.info(f"Adjusting Variant {variant_id} Stock: {variant.stock_quantity} + {update_data.stock_change}")
             
             variant.stock_quantity += update_data.stock_change
             
             # Sync Parent
             product = db.get(Product, variant.product_id)
             if product:
                  product.stock_quantity = (product.stock_quantity or 0) + update_data.stock_change
                  db.add(product)
        
        db.add(variant)
        db.commit()
        db.refresh(variant)
        return variant
    except Exception as e:
        db.rollback()
        logger.error(f"Update Variant Error: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=str(e))

# --- CATEGORIES ---

def create_category(category_data: model.CategoryCreate, db: Session = Depends(get_session)) -> Category:
    try:
        # Generate slugified type
        import re
        slug = re.sub(r'[^a-z0-9]+', '-', category_data.name.lower()).strip('-')
        
        # Check if type exists
        existing = db.exec(select(Category).where(Category.type == slug)).first()
        if existing:
             raise HTTPException(status_code=400, detail=f"Category '{category_data.name}' already exists.")

        new_cat = Category(name=category_data.name, type=slug)
        db.add(new_cat)
        db.commit()
        db.refresh(new_cat)
        return new_cat
    except Exception as e:
        db.rollback()
        logger.error(f"Create Category Error: {e}")
        raise HTTPException(status_code=500, detail=str(e))

def getAllCategories(db: Session = Depends(get_session)):
    return db.exec(select(Category)).all()

# --- STOCK ---

def check_stock_availability(product_id: int, qty: int, db: Session = Depends(get_session), variant_id: Optional[int] = None):
    product = db.get(Product, product_id)
    if not product:
        return {"message": "Product Not Found", "available": 0}

    # Case A: Specific Variant Request (for Variable Products)
    if variant_id:
        v = db.get(Variant, variant_id)
        if not v:
             return {"message": "Variant Not Found", "available": 0}
        if v.stock_quantity >= qty:
             return {"message": "Available", "available": v.stock_quantity}
        return {"message": "Insufficient Stock", "available": v.stock_quantity}

    # Case B: Product Level Check (Simple Product or Aggregated Variable Product)
    # Since we maintain total stock in product.stock_quantity, we can check it directly.
    if product.stock_quantity >= qty:
        return {"message": "Available", "available": product.stock_quantity}
    
    return {"message": "Insufficient Stock", "available": product.stock_quantity}
