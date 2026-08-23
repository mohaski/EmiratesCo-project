from fastapi import Depends, HTTPException, status
from sqlmodel import Session, select, col, or_
from sqlalchemy.exc import IntegrityError
from typing import List, Optional, Dict, Any
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
        
        # 1. Check Duplicates — name only needs to be unique within the same category
        # (e.g. "Jam" can exist under both Tanzanian Profile and Euro Profile).
        query = select(Product).where(
            Product.name == product_data.name,
            Product.category_id == product_data.category_id,
        )
        if db.exec(query).first():
            raise HTTPException(status_code=400, detail="Product with this name already exists in this category")

        # 2. Every product must have at least one variant — price/stock/dimensions live there.
        if not product_data.variants:
            raise HTTPException(status_code=400, detail="Product must have at least one variant")
        initial_stock = sum(v.stock_quantity for v in product_data.variants)

        # Offcut tuning (min_usable/allow_rotation/popular_size_ranges) is per-VARIANT
        # now (see VariantCreate) — each variant gets a context-aware default (see the
        # min_usable default below) and the CEO refines it afterward via Manage
        # Variants, so nothing is required up front here regardless of has_dimensions.

        # 3. Create Product Entity
        new_product = Product(
            name=product_data.name,
            itemCode=product_data.itemCode,
            category_id=product_data.category_id,
            sub_category=product_data.sub_category,
            description=product_data.description,
            image_url=product_data.image_url,

            track_offcuts=product_data.trackOffcuts,
            alarm_quantity=product_data.alarm_quantity,
            unit=product_data.unit,

            applicable_attributes=product_data.applicable_attributes,
            has_dimensions=product_data.has_dimensions,
            pool_ignored_attributes=product_data.pool_ignored_attributes,

            has_variants=True,
            stock_quantity=initial_stock
        )
        db.add(new_product)
        db.flush() # Generate ID but stay in transaction
        db.refresh(new_product)

        # 4. Create Variants
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
                length=v_data.length,
                width=v_data.width,
                height=v_data.height,
                unit_quantity=v_data.unit_quantity,
                low_stock_threshold=v_data.low_stock_threshold,
                min_usable=v_data.min_usable if v_data.min_usable is not None else (150.0 if product_data.has_dimensions else 2.0),
                allow_rotation=v_data.allow_rotation,
                popular_size_ranges=[r.dict() for r in v_data.popular_size_ranges],
            )
            db.add(new_variant)

        db.commit()

        logger.info(f"Product created: {new_product.name} ({len(product_data.variants)} variant(s))")
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
        # Map camelCase field names to entity column names
        field_map = {'trackOffcuts': 'track_offcuts'}
        for key, value in update_dict.items():
            setattr(product, field_map.get(key, key), value)
            
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
    except HTTPException:
        raise
    except IntegrityError as e:
        db.rollback()
        logger.error(f"Remove Product Error (IntegrityError): {e}", exc_info=True)
        raise HTTPException(
            status_code=409,
            detail="Cannot delete this product because it has related order or stock history. "
                   "Remove those records first, or keep the product instead of deleting it.",
        )
    except Exception as e:
        db.rollback()
        logger.error(f"Remove Product Error: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=str(e))

# --- VARIANT MANAGEMENT ---

def add_variant(product_id: int, variant_data: model.VariantCreate, db: Session = Depends(get_session)):
    try:
        product = db.get(Product, product_id)

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
            length=variant_data.length,
            width=variant_data.width,
            height=variant_data.height,
            unit_quantity=variant_data.unit_quantity,
            low_stock_threshold=variant_data.low_stock_threshold,
            min_usable=variant_data.min_usable if variant_data.min_usable is not None else (150.0 if product and product.has_dimensions else 2.0),
            allow_rotation=variant_data.allow_rotation,
            popular_size_ranges=[r.dict() for r in variant_data.popular_size_ranges],
        )
        db.add(variant)

        # 2. Update Parent Product Stock
        # We must keep the cache in sync
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

def add_variants_bulk(product_id: int, variants_data: List[model.VariantCreate], db: Session = Depends(get_session)):
    """Create multiple variants for a product in a single transaction (used by the
    'Add Variant' matrix generator, which can produce more than one variant at once)."""
    try:
        product = db.get(Product, product_id)
        if not product:
            raise HTTPException(status_code=404, detail="Product not found")
        if not variants_data:
            raise HTTPException(status_code=400, detail="At least one variant is required")

        created = []
        total_stock = 0.0
        for variant_data in variants_data:
            final_name = " - ".join(str(v) for v in variant_data.attributes.values())
            variant = Variant(
                product_id=product_id,
                name=final_name,
                attributes=variant_data.attributes,
                stock_quantity=variant_data.stock_quantity,
                price=variant_data.price,
                price_half=variant_data.price_half,
                price_unit=variant_data.price_unit,
                length=variant_data.length,
                width=variant_data.width,
                height=variant_data.height,
                unit_quantity=variant_data.unit_quantity,
                low_stock_threshold=variant_data.low_stock_threshold,
                min_usable=variant_data.min_usable if variant_data.min_usable is not None else (150.0 if product.has_dimensions else 2.0),
                allow_rotation=variant_data.allow_rotation,
                popular_size_ranges=[r.dict() for r in variant_data.popular_size_ranges],
            )
            db.add(variant)
            created.append(variant)
            total_stock += variant_data.stock_quantity

        product.has_variants = True
        product.stock_quantity = (product.stock_quantity or 0) + total_stock
        db.add(product)

        db.commit()
        for v in created:
            db.refresh(v)
        return created
    except HTTPException:
        raise
    except Exception as e:
        db.rollback()
        logger.error(f"Add Variants Bulk Error: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=str(e))

def update_variant(variant_id: int, update_data: model.VariantUpdate, db: Session = Depends(get_session), current_user=None):
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

        if update_data.width is not None:
             variant.width = update_data.width

        if update_data.height is not None:
             variant.height = update_data.height

        if update_data.unit_quantity is not None:
             variant.unit_quantity = update_data.unit_quantity

        if update_data.low_stock_threshold is not None:
             variant.low_stock_threshold = update_data.low_stock_threshold

        if update_data.min_usable is not None:
             variant.min_usable = update_data.min_usable

        if update_data.allow_rotation is not None:
             variant.allow_rotation = update_data.allow_rotation

        if update_data.popular_size_ranges is not None:
             variant.popular_size_ranges = [r.dict() for r in update_data.popular_size_ranges]

        if update_data.attributes is not None:
             merged_attrs = {**(variant.attributes or {}), **update_data.attributes}
             variant.attributes = merged_attrs
             variant.name = " - ".join(str(v) for v in merged_attrs.values())

        # 2. Update Stock (Delta)
        if update_data.stock_change is not None:
             logger.info(f"Adjusting Variant {variant_id} Stock: {variant.stock_quantity} + {update_data.stock_change}")

             old_stock = variant.stock_quantity
             variant.stock_quantity += update_data.stock_change

             # Sync Parent
             product = db.get(Product, variant.product_id)
             if product:
                  product.stock_quantity = (product.stock_quantity or 0) + update_data.stock_change
                  db.add(product)

             if current_user is not None:
                  from entities.editHistory import EditHistory
                  from uuid import UUID
                  db.add(EditHistory(
                      entity_type='restock',
                      entity_id=variant.product_id,
                      edited_by=UUID(current_user.userId),
                      action='restock',
                      before_snapshot={
                          'variant_id': variant_id,
                          'variant_name': variant.name or '',
                          'product_name': product.name if product else '',
                          'stock_quantity': old_stock,
                      },
                      after_snapshot={
                          'variant_id': variant_id,
                          'variant_name': variant.name or '',
                          'product_name': product.name if product else '',
                          'stock_quantity': float(variant.stock_quantity),
                          'change': update_data.stock_change,
                      },
                      notes=current_user.username,
                  ))

        db.add(variant)
        db.commit()
        db.refresh(variant)
        return variant
    except Exception as e:
        db.rollback()
        logger.error(f"Update Variant Error: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=str(e))

def remove_variant(variant_id: int, db: Session = Depends(get_session)) -> dict:
    try:
        variant = db.get(Variant, variant_id)
        if not variant:
            raise HTTPException(status_code=404, detail="Variant not found")

        product = db.get(Product, variant.product_id)
        removed_stock = variant.stock_quantity or 0

        db.delete(variant)
        db.flush()

        if product:
            product.stock_quantity = max(0, (product.stock_quantity or 0) - removed_stock)
            db.add(product)

        db.commit()
        return {"message": "Variant deleted", "id": variant_id}
    except HTTPException:
        raise
    except IntegrityError:
        db.rollback()
        raise HTTPException(
            status_code=400,
            detail="Cannot delete this variant — it has order or offcut history linked to it. Set its stock to 0 instead.",
        )
    except Exception as e:
        db.rollback()
        logger.error(f"Remove Variant Error: {e}", exc_info=True)
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
    # Ordered by categoryId (creation order) — an unordered SELECT returns rows in
    # physical storage order, which drifts after any UPDATE to a row (e.g. adding a
    # sub-category) and reshuffles the category tabs/cards in the UI unpredictably.
    return db.exec(select(Category).order_by(Category.categoryId)).all()

def add_subcategory(category_id: int, name: str, db: Session = Depends(get_session)) -> Category:
    try:
        import re
        category = db.get(Category, category_id)
        if not category:
            raise HTTPException(status_code=404, detail="Category not found")

        slug = re.sub(r'[^a-z0-9]+', '-', name.lower()).strip('-')
        subs = list(category.sub_categories or [])
        if any(s.get('id') == slug for s in subs):
            raise HTTPException(status_code=400, detail=f"Sub-category '{name}' already exists.")

        subs.append({'id': slug, 'label': name})
        category.sub_categories = subs
        db.add(category)
        db.commit()
        db.refresh(category)
        return category
    except HTTPException:
        raise
    except Exception as e:
        db.rollback()
        logger.error(f"Add Sub-Category Error: {e}")
        raise HTTPException(status_code=500, detail=str(e))

# --- STOCK ---

def update_simple_product_stock(product_id: int, stock_change: int, db: Session, current_user=None) -> dict:
    """
    Add or remove stock from a simple (non-variant) product.
    stock_change can be positive (add) or negative (remove).
    """
    try:
        product = db.get(Product, product_id)
        if not product:
            raise HTTPException(status_code=404, detail="Product not found")
        if product.has_variants:
            raise HTTPException(status_code=400, detail="Use variant endpoints to update stock for variable products")
        old_qty = product.stock_quantity or 0
        new_qty = old_qty + stock_change
        if new_qty < 0:
            raise HTTPException(status_code=400, detail=f"Insufficient stock. Current: {product.stock_quantity}")
        product.stock_quantity = new_qty
        db.add(product)

        if current_user is not None:
            from entities.editHistory import EditHistory
            from uuid import UUID
            db.add(EditHistory(
                entity_type='restock',
                entity_id=product_id,
                edited_by=UUID(current_user.userId),
                action='restock',
                before_snapshot={
                    'product_name': product.name,
                    'stock_quantity': old_qty,
                },
                after_snapshot={
                    'product_name': product.name,
                    'stock_quantity': new_qty,
                    'change': stock_change,
                },
                notes=current_user.username,
            ))

        db.commit()
        db.refresh(product)
        logger.info(f"Stock updated for product {product_id}: {product.stock_quantity}")
        return {"message": "Stock updated", "id": product_id, "stock_quantity": product.stock_quantity}
    except HTTPException:
        raise
    except Exception as e:
        db.rollback()
        logger.error(f"Update Stock Error: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=str(e))

def get_restock_history(
    db: Session,
    skip: int = 0,
    limit: int = 100,
    product_id: Optional[int] = None,
) -> list:
    from entities.editHistory import EditHistory
    stmt = (
        select(EditHistory)
        .where(EditHistory.entity_type == 'restock')
        .order_by(EditHistory.edited_at.desc())
        .offset(skip)
        .limit(limit)
    )
    if product_id is not None:
        stmt = stmt.where(EditHistory.entity_id == product_id)

    rows = db.exec(stmt).all()
    results = []
    for r in rows:
        before = r.before_snapshot or {}
        after = r.after_snapshot or {}
        results.append(model.RestockHistoryItem(
            id=r.id,
            product_id=r.entity_id,
            product_name=after.get('product_name') or before.get('product_name', ''),
            variant_name=after.get('variant_name', ''),
            qty_added=float(after.get('change', 0)),
            stock_before=float(before.get('stock_quantity', 0)),
            stock_after=float(after.get('stock_quantity', 0)),
            added_by=r.notes or str(r.edited_by),
            added_at=r.edited_at,
        ))
    return results


def get_offcuts_for_product(
    product_id: int,
    db: Session,
    variant_id: Optional[int] = None,
):
    """Return all available (non-scrap) offcut pieces for a product, largest first.
    `variant_id`, when given, scopes to that variant's whole pool (every variant
    sharing its non-size attributes — see core/inventory/poolKey.py), not just
    that exact variant, so e.g. picking a manual offcut for a 5.8m White bar
    also surfaces offcuts left over from a 6m White bar."""
    from entities.offcuts import Offcut
    from entities.variants import Variant
    from core.inventory.poolKey import compute_pool_key

    stmt = (
        select(Offcut)
        .where(Offcut.product_id == product_id, Offcut.quantity > 0, Offcut.status == "available")
        .order_by(Offcut.length.desc(), (Offcut.width * Offcut.height).desc())
    )
    if variant_id is not None:
        variant = db.get(Variant, variant_id)
        pool_key = compute_pool_key(db, variant) if variant else ""
        stmt = stmt.where(Offcut.pool_key == pool_key)
    return db.exec(stmt).all()


def add_offcuts_bulk(
    product_id: int,
    offcuts_data: List["model.OffcutCreate"],
    db: Session,
    current_user=None,
) -> List["Offcut"]:
    """Manager-entered offcuts — leftover pieces measured by hand and added straight
    into the pickable pool, as opposed to the ones a cutting job creates automatically
    (_upsert_offcut / _upsert_glass_offcut). Doesn't touch product.stock_quantity,
    which tracks full-unit stock only; offcuts are a separate pool."""
    from entities.offcuts import Offcut
    from core.inventory.poolKey import compute_pool_key

    require_role(["manager", "ceo", "admin"], current_user)

    product = db.get(Product, product_id)
    if not product:
        raise HTTPException(status_code=404, detail="Product not found")
    if not product.track_offcuts:
        raise HTTPException(status_code=400, detail="This product does not track offcuts")
    if not offcuts_data:
        raise HTTPException(status_code=400, detail="At least one offcut is required")

    created = []
    for row in offcuts_data:
        if row.quantity < 1:
            raise HTTPException(status_code=400, detail="quantity must be at least 1")
        row_variant = db.get(Variant, row.variant_id) if row.variant_id is not None else None
        if row.variant_id is not None and row_variant is None:
            raise HTTPException(status_code=404, detail=f"Variant {row.variant_id} not found")
        pool_key = compute_pool_key(db, row_variant)

        if product.has_dimensions:
            if row.width is None or row.height is None or row.width <= 0 or row.height <= 0:
                raise HTTPException(status_code=400, detail="width and height are required for this product")
            offcut = Offcut(
                product_id=product_id, variant_id=row.variant_id, pool_key=pool_key,
                length=0.0, width=row.width, height=row.height,
                quantity=row.quantity, status="available",
            )
        else:
            if row.length is None or row.length <= 0:
                raise HTTPException(status_code=400, detail="length is required for this product")
            offcut = Offcut(
                product_id=product_id, variant_id=row.variant_id, pool_key=pool_key,
                length=row.length, width=None, height=None,
                quantity=row.quantity, status="available",
            )
        db.add(offcut)
        created.append(offcut)

    if current_user is not None:
        from entities.editHistory import EditHistory
        from uuid import UUID
        db.add(EditHistory(
            entity_type='manual_offcut',
            entity_id=product_id,
            edited_by=UUID(current_user.userId),
            action='create',
            before_snapshot={},
            after_snapshot={'product_name': product.name, 'count': len(created)},
            notes=current_user.username,
        ))

    db.commit()
    for o in created:
        db.refresh(o)
    return created


def _consolidate_preview_events(all_events: List[dict], pre_existing_offcut_ids: set) -> List[dict]:
    """
    Merges consumption events that represent the same physical sheet/offcut, for
    two distinct reasons a preview can end up with more "sources" than physically
    exist:

    1. Joint packing (glassOffcutService._pack_rect_multi) can place pieces from
       several different order lines into ONE physical source in a single
       operation; that gets split into one "owner" event (which records the real
       stock/offcut consumption) plus "shared" events per other line purely for
       restore-on-cancel bookkeeping (see _apply_candidate). They all carry the
       same `group_id` — merge those first.
    2. A later piece can end up consuming an offcut that only exists because this
       same dry-run created it moments earlier (a remainder from one piece reused
       by another, across separate packing rounds). Since nothing is persisted in
       a preview, showing that as two separate "sources" is misleading — there's
       only ONE physical item involved.

    Returns one merged group per physical source genuinely touched (a real
    pre-existing offcut, or a fresh sheet), each with every cut pooled together
    and only the truly-final remainders — ones never reused later in this preview.
    """
    combined_by_group: dict = {}
    group_order: list = []
    for e in all_events:
        gid = e.get("group_id")
        if gid not in combined_by_group:
            combined_by_group[gid] = {
                "source": e["source"], "offcut_id": e["offcut_id"],
                "offcut_width": e["offcut_width"], "offcut_height": e["offcut_height"],
                "cuts": [], "remainders_created": [],
            }
            group_order.append(gid)
        combined_by_group[gid]["cuts"].extend(e["cuts"])
        if e.get("remainders_created"):
            combined_by_group[gid]["remainders_created"] = e["remainders_created"]
    all_events = [combined_by_group[gid] for gid in group_order]

    creates = {}   # offcut_id -> event that created it as a remainder
    consumed_ids = set()
    for e in all_events:
        if e["source"] == "offcut":
            consumed_ids.add(e["offcut_id"])
        for r in e.get("remainders_created", []):
            if r.get("offcut_id") is not None:
                creates[r["offcut_id"]] = e

    def find_root(e: dict):
        """Returns (root_event, dx, dy) — dx/dy is the cumulative offset needed to
        translate e's own local (x, y) coordinates into the root event's source's
        coordinate space, since a chained event's cuts/remainders are positioned
        relative to the synthetic offcut it was cut from, not the original sheet."""
        if e["source"] == "offcut" and e["offcut_id"] not in pre_existing_offcut_ids and e["offcut_id"] in creates:
            creator = creates[e["offcut_id"]]
            remainder_entry = next(r for r in creator["remainders_created"] if r.get("offcut_id") == e["offcut_id"])
            root, dx, dy = find_root(creator)
            return root, dx + remainder_entry["x"], dy + remainder_entry["y"]
        return e, 0.0, 0.0

    groups: dict = {}  # id(root_event) -> merged group
    order: list = []
    for e in all_events:
        root, dx, dy = find_root(e)
        key = id(root)
        if key not in groups:
            groups[key] = {
                "source": root["source"], "offcut_id": root["offcut_id"],
                "offcut_width": root["offcut_width"], "offcut_height": root["offcut_height"],
                "cuts": [], "remainders_created": [],
            }
            order.append(key)
        groups[key]["cuts"].extend({**c, "x": c["x"] + dx, "y": c["y"] + dy} for c in e["cuts"])
        for r in e.get("remainders_created", []):
            if r.get("offcut_id") not in consumed_ids:
                groups[key]["remainders_created"].append({**r, "x": r["x"] + dx, "y": r["y"] + dy})

    return [groups[key] for key in order]


def preview_glass_cuts(
    product_id: int,
    cuts: List["model.GlassCutPreviewCut"],
    db: Session,
    variant_id: Optional[int] = None,
):
    """
    Dry-run the 2D glass offcut decision engine for a hypothetical set of cuts —
    runs the exact same batching/scoring logic a real sale would (so the preview
    matches production behavior exactly), but never commits: the DB transaction is
    always rolled back, so no stock is deducted and no offcuts are created/consumed.

    Returns {"groups": [...], "optimization": {...}}. `groups` is one merged
    entry per physical sheet/offcut actually touched — see
    _consolidate_preview_events for why this isn't just the raw per-line events.
    `optimization` is resolve_glass_cut_lines' summary of the multi-strategy
    search (which heuristics were tried, their outcomes, and which won) — surfaced
    so the preview can show that search actually happened, not just its result.
    """
    from entities.offcuts import Offcut
    from core.inventory.glassOffcutService import resolve_glass_cut_lines
    from core.inventory.poolKey import compute_pool_key

    product = db.get(Product, product_id)
    if not product:
        raise HTTPException(status_code=404, detail="Product not found")
    variant = db.get(Variant, variant_id) if variant_id else None
    pool_key = compute_pool_key(db, variant)

    pre_existing_stmt = select(Offcut.offcutId).where(Offcut.product_id == product_id, Offcut.pool_key == pool_key)
    pre_existing_ids = set(db.exec(pre_existing_stmt).all())

    lines = [
        {"type": "glass-cut", "qty": c.qty, "meta": {"l": c.l, "w": c.w, "u": c.u}}
        for c in cuts
    ]
    try:
        optimization = resolve_glass_cut_lines(db, product, variant, lines)
        all_events = [e for line in lines for e in line.get("offcut_sources", [])]
        groups = _consolidate_preview_events(all_events, pre_existing_ids)
        return {"groups": groups, "optimization": optimization}
    except ValueError as e:
        raise HTTPException(status_code=422, detail=str(e))
    finally:
        db.rollback()  # dry run only — never persist


def preview_offcut_replacement(
    product_id: int,
    pieces: List["model.OffcutReplacementPreviewPiece"],
    db: Session,
    variant_id: Optional[int] = None,
    forced_offcut_id: Optional[int] = None,
):
    """
    Dry-run: given cut pieces whose recorded source turned out to be wrong (the
    cutter missed), what replacement offcut/sheet would the engine pick to
    supply them, and what would it leave behind? Runs
    glassOffcutService.resolve_replacement_pieces for real, then always rolls
    back — same never-persist guarantee as preview_glass_cuts. Returns
    {"events": [...]}, shaped identically to real offcut_sources entries, so
    the frontend can render it with the same CuttingInstructions component
    used for committed data.
    """
    from core.inventory.glassOffcutService import resolve_replacement_pieces

    product = db.get(Product, product_id)
    if not product:
        raise HTTPException(status_code=404, detail="Product not found")
    variant = db.get(Variant, variant_id) if variant_id else None

    try:
        piece_tuples = [(p.width, p.height) for p in pieces]
        events = resolve_replacement_pieces(db, product, variant, piece_tuples, forced_offcut_id)
        return {"events": events}
    except ValueError as e:
        raise HTTPException(status_code=422, detail=str(e))
    finally:
        db.rollback()  # dry run only — never persist


def check_cut_feasibility(
    product_id: int,
    line_items: List[Dict[str, Any]],
    db: Session,
    variant_id: Optional[int] = None,
) -> dict:
    """
    Dry-run whether the given line items — profile full/half/custom-cut
    (optionally with a manual offcut_selection), glass sheet-full/sheet-half/
    glass-cut, or any other type _process_line_items understands — can be
    fulfilled from current stock. Delegates to
    inventoryService.check_line_items_feasible, which reuses
    _process_line_items, the exact dispatcher a real sale calls, so this stays
    correct for every product family without duplicating any stock logic.
    Nothing is persisted; see that function's docstring for the rollback
    guarantee.
    """
    from core.inventory.inventoryService import check_line_items_feasible

    product = db.get(Product, product_id)
    if not product:
        raise HTTPException(status_code=404, detail="Product not found")
    variant = db.get(Variant, variant_id) if variant_id else None

    return check_line_items_feasible(db, product, variant, line_items)


def check_stock_availability(product_id: int, qty: int, db: Session = Depends(get_session), variant_id: Optional[int] = None):
    from core.inventory.poolKey import pool_sibling_variants

    product = db.get(Product, product_id)
    if not product:
        return {"message": "Product Not Found", "available": 0}

    # Case A: Specific Variant Request (for Variable Products) — availability is
    # pooled across sibling variants sharing every attribute except the
    # pack-size one (a Box-of-100 and a Single-pcs variant of the same item;
    # see core/inventory/poolKey.py). Every variant's stock_quantity is already
    # tracked in pieces (see entities/variants.py), so the pool sums directly;
    # `v.unit_quantity` only converts the total back into `v`'s own pack unit
    # (e.g. boxes) to compare against `qty`.
    if variant_id:
        v = db.get(Variant, variant_id)
        if not v:
             return {"message": "Variant Not Found", "available": 0}
        factor = v.unit_quantity or 1
        pooled_pieces = v.stock_quantity + sum(
            sib.stock_quantity for sib in pool_sibling_variants(db, v)
        )
        available = pooled_pieces / factor
        if available >= qty:
             return {"message": "Available", "available": available}
        return {"message": "Insufficient Stock", "available": available}

    # Case B: Product Level Check (Simple Product or Aggregated Variable Product)
    # Since we maintain total stock in product.stock_quantity, we can check it directly.
    if product.stock_quantity >= qty:
        return {"message": "Available", "available": product.stock_quantity}
    
    return {"message": "Insufficient Stock", "available": product.stock_quantity}
