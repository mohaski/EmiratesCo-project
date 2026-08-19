from fastapi import HTTPException
from sqlmodel import Session, select
from typing import List
from uuid import UUID
from datetime import datetime, timezone

from entities.products import Product
from entities.variants import Variant
from entities.offcuts import Offcut
from entities.users import User
from entities.editHistory import EditHistory
from entities.stockInputSession import StockInputSession, StockInputSessionItem
from core.inventory.poolKey import compute_pool_key
from loggiing import logger
from utils import require_role
from . import model


def _username(db: Session, user_id: UUID) -> str:
    user = db.get(User, user_id)
    return user.username if user else str(user_id)


def _item_response(db: Session, item: StockInputSessionItem) -> model.StockInputSessionItemResponse:
    return model.StockInputSessionItemResponse(
        id=item.id,
        line_type=item.line_type,
        product_id=item.product_id,
        variant_id=item.variant_id,
        product_name=item.product_name,
        variant_name=item.variant_name,
        entered_quantity=item.entered_quantity,
        entered_unit=item.entered_unit,
        quantity_change=item.quantity_change,
        stock_before=item.stock_before,
        stock_after=item.stock_after,
        offcut_length=item.offcut_length,
        offcut_width=item.offcut_width,
        offcut_height=item.offcut_height,
        offcut_quantity=item.offcut_quantity,
        edited_by=_username(db, item.edited_by) if item.edited_by else None,
        edited_at=item.edited_at,
    )


def _apply_restock_line(db: Session, session_id: int, line: "model.StockInputLineCreate") -> StockInputSessionItem:
    if line.entered_quantity <= 0:
        raise HTTPException(status_code=400, detail="entered_quantity must be greater than 0")
    if line.conversion_factor <= 0:
        raise HTTPException(status_code=400, detail="conversion_factor must be greater than 0")

    quantity_change = line.entered_quantity * line.conversion_factor

    if line.variant_id is not None:
        variant = db.get(Variant, line.variant_id)
        if not variant or variant.product_id != line.product_id:
            raise HTTPException(status_code=404, detail=f"Variant {line.variant_id} not found for product {line.product_id}")
        product = db.get(Product, line.product_id)
        if not product:
            raise HTTPException(status_code=404, detail="Product not found")

        old_stock = variant.stock_quantity
        new_stock = old_stock + quantity_change
        if new_stock < 0:
            raise HTTPException(status_code=400, detail=f"Insufficient stock for {variant.name or product.name}")
        variant.stock_quantity = new_stock
        db.add(variant)
        product.stock_quantity = (product.stock_quantity or 0) + quantity_change
        db.add(product)
        variant_name = variant.name or ""
        product_name = product.name
    else:
        product = db.get(Product, line.product_id)
        if not product:
            raise HTTPException(status_code=404, detail="Product not found")
        if product.has_variants:
            raise HTTPException(status_code=400, detail=f"{product.name} has variants — a variant_id is required")

        old_stock = product.stock_quantity or 0
        new_stock = old_stock + quantity_change
        if new_stock < 0:
            raise HTTPException(status_code=400, detail=f"Insufficient stock for {product.name}")
        product.stock_quantity = new_stock
        db.add(product)
        variant_name = None
        product_name = product.name

    return StockInputSessionItem(
        session_id=session_id,
        line_type="restock",
        product_id=line.product_id,
        variant_id=line.variant_id,
        product_name=product_name,
        variant_name=variant_name,
        entered_quantity=line.entered_quantity,
        entered_unit=line.entered_unit,
        conversion_factor=line.conversion_factor,
        quantity_change=quantity_change,
        stock_before=old_stock,
        stock_after=new_stock,
    )


def _apply_offcut_line(db: Session, session_id: int, line: "model.OffcutLineCreate") -> StockInputSessionItem:
    """Mirrors core/inventory/products/service.py's add_offcuts_bulk — creates
    one Offcut pool row per line. Doesn't touch Product/Variant.stock_quantity,
    which tracks full-unit stock only; offcuts are a separate pool."""
    if line.quantity < 1:
        raise HTTPException(status_code=400, detail="quantity must be at least 1")

    product = db.get(Product, line.product_id)
    if not product:
        raise HTTPException(status_code=404, detail="Product not found")
    if not product.track_offcuts:
        raise HTTPException(status_code=400, detail=f"{product.name} does not track offcuts")

    variant = db.get(Variant, line.variant_id) if line.variant_id is not None else None
    if line.variant_id is not None and variant is None:
        raise HTTPException(status_code=404, detail=f"Variant {line.variant_id} not found")
    pool_key = compute_pool_key(db, variant)

    if product.has_dimensions:
        if line.width is None or line.height is None or line.width <= 0 or line.height <= 0:
            raise HTTPException(status_code=400, detail=f"width and height are required for {product.name}")
        offcut = Offcut(
            product_id=line.product_id, variant_id=line.variant_id, pool_key=pool_key,
            length=0.0, width=line.width, height=line.height,
            quantity=line.quantity, status="available",
        )
    else:
        if line.length is None or line.length <= 0:
            raise HTTPException(status_code=400, detail=f"length is required for {product.name}")
        offcut = Offcut(
            product_id=line.product_id, variant_id=line.variant_id, pool_key=pool_key,
            length=line.length, width=None, height=None,
            quantity=line.quantity, status="available",
        )
    db.add(offcut)
    db.flush()

    return StockInputSessionItem(
        session_id=session_id,
        line_type="offcut",
        product_id=line.product_id,
        variant_id=line.variant_id,
        product_name=product.name,
        variant_name=variant.name if variant else None,
        offcut_length=offcut.length if not product.has_dimensions else None,
        offcut_width=offcut.width,
        offcut_height=offcut.height,
        offcut_quantity=line.quantity,
        created_offcut_id=offcut.offcutId,
    )


def finalize_stock_input_session(
    payload: model.StockInputSessionCreate,
    db: Session,
    current_user,
) -> model.StockInputSessionResponse:
    """Commits every cart line built client-side in Stock Control in a single
    transaction — either the whole batch lands, or none of it does. Restock
    lines mirror update_variant / update_simple_product_stock; offcut lines
    mirror add_offcuts_bulk (both in core/inventory/products/service.py)."""
    require_role(["cashier", "manager"], current_user)

    if not payload.stock_lines and not payload.offcut_lines:
        raise HTTPException(status_code=400, detail="At least one stock or offcut line is required")

    if payload.offcut_lines:
        # Matches add_offcuts_bulk's own gate — cashiers can restock but not add offcuts.
        require_role(["manager", "ceo", "admin"], current_user)

    try:
        session = StockInputSession(
            created_by=UUID(current_user.userId),
            notes=payload.notes,
        )
        db.add(session)
        db.flush()

        created_items: List[StockInputSessionItem] = []
        for line in payload.stock_lines:
            item = _apply_restock_line(db, session.id, line)
            db.add(item)
            created_items.append(item)

        for line in payload.offcut_lines:
            item = _apply_offcut_line(db, session.id, line)
            db.add(item)
            created_items.append(item)

        # Per-line detail for the activity log (see client/src/utils/activityMeta.js's
        # summarizeActivity) — item_count alone told a CEO nothing about what was
        # actually added; this lets the log show real product/quantity info without
        # a second fetch of the session itself.
        lines_summary = [
            {
                "type": "restock",
                "product_name": item.product_name,
                "variant_name": item.variant_name,
                "entered_quantity": item.entered_quantity,
                "entered_unit": item.entered_unit,
            } if item.line_type == "restock" else {
                "type": "offcut",
                "product_name": item.product_name,
                "variant_name": item.variant_name,
                "quantity": item.offcut_quantity,
                "length": item.offcut_length,
                "width": item.offcut_width,
                "height": item.offcut_height,
            }
            for item in created_items
        ]

        db.add(EditHistory(
            entity_type="stock_batch",
            entity_id=session.id,
            edited_by=UUID(current_user.userId),
            action="finalize",
            before_snapshot={},
            after_snapshot={"item_count": len(created_items), "lines": lines_summary},
            notes=current_user.username,
        ))

        db.commit()
        db.refresh(session)
        for item in created_items:
            db.refresh(item)

        logger.info(f"Stock input session {session.id} finalized by {current_user.userId} ({len(created_items)} lines)")
        return model.StockInputSessionResponse(
            id=session.id,
            created_by=current_user.username,
            created_at=session.created_at,
            notes=session.notes,
            items=[_item_response(db, item) for item in created_items],
        )
    except HTTPException:
        db.rollback()
        raise
    except Exception as e:
        db.rollback()
        logger.error(f"Finalize Stock Input Session Error: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=str(e))


def list_stock_input_sessions(db: Session, skip: int = 0, limit: int = 100) -> List[model.StockInputSessionSummary]:
    stmt = (
        select(StockInputSession)
        .order_by(StockInputSession.created_at.desc())
        .offset(skip)
        .limit(limit)
    )
    sessions = db.exec(stmt).all()
    return [
        model.StockInputSessionSummary(
            id=s.id,
            created_by=_username(db, s.created_by),
            created_at=s.created_at,
            notes=s.notes,
            item_count=len(s.items),
        )
        for s in sessions
    ]


def get_stock_input_session(session_id: int, db: Session) -> model.StockInputSessionResponse:
    session = db.get(StockInputSession, session_id)
    if not session:
        raise HTTPException(status_code=404, detail="Stock input session not found")

    items = sorted(session.items, key=lambda i: i.id)
    return model.StockInputSessionResponse(
        id=session.id,
        created_by=_username(db, session.created_by),
        created_at=session.created_at,
        notes=session.notes,
        items=[_item_response(db, item) for item in items],
    )


def correct_stock_input_session_item(
    session_id: int,
    item_id: int,
    payload: model.StockInputItemCorrection,
    db: Session,
    current_user,
) -> model.StockInputSessionItemResponse:
    """CEO-only correction of a finalized session line — reverses the item's
    previously-applied delta from live stock and re-applies a new one computed
    from the same conversion_factor captured at entry time. Restock lines only —
    an offcut line's dimensions/quantity aren't a single scalar to "correct" the
    same way; adjusting an already-created offcut goes through the existing
    offcut-correction flows on the order that consumes it."""
    require_role(["ceo"], current_user)

    if payload.entered_quantity < 0:
        raise HTTPException(status_code=400, detail="entered_quantity cannot be negative")

    item = db.get(StockInputSessionItem, item_id)
    if not item or item.session_id != session_id:
        raise HTTPException(status_code=404, detail="Stock input session item not found")
    if item.line_type != "restock":
        raise HTTPException(status_code=400, detail="Only restock lines can be corrected here")

    try:
        old_delta = item.quantity_change
        new_delta = payload.entered_quantity * item.conversion_factor
        diff = new_delta - old_delta

        if item.variant_id is not None:
            variant = db.get(Variant, item.variant_id)
            if not variant:
                raise HTTPException(status_code=404, detail="Variant no longer exists")
            new_variant_stock = variant.stock_quantity + diff
            if new_variant_stock < 0:
                raise HTTPException(status_code=400, detail="Correction would drive stock negative")
            variant.stock_quantity = new_variant_stock
            db.add(variant)
            product = db.get(Product, item.product_id)
            if product:
                product.stock_quantity = (product.stock_quantity or 0) + diff
                db.add(product)
        else:
            product = db.get(Product, item.product_id)
            if not product:
                raise HTTPException(status_code=404, detail="Product no longer exists")
            new_product_stock = (product.stock_quantity or 0) + diff
            if new_product_stock < 0:
                raise HTTPException(status_code=400, detail="Correction would drive stock negative")
            product.stock_quantity = new_product_stock
            db.add(product)

        before_snapshot = {
            "item_id": item.id,
            "entered_quantity": item.entered_quantity,
            "quantity_change": old_delta,
            "stock_after": item.stock_after,
        }

        item.entered_quantity = payload.entered_quantity
        item.quantity_change = new_delta
        item.stock_after = item.stock_before + new_delta
        item.edited_by = UUID(current_user.userId)
        item.edited_at = datetime.now(timezone.utc)
        db.add(item)

        db.add(EditHistory(
            entity_type="stock_batch_correction",
            entity_id=session_id,
            edited_by=UUID(current_user.userId),
            action="correct",
            before_snapshot=before_snapshot,
            after_snapshot={
                "item_id": item.id,
                "entered_quantity": item.entered_quantity,
                "quantity_change": item.quantity_change,
                "stock_after": item.stock_after,
            },
            notes=payload.notes or current_user.username,
        ))

        db.commit()
        db.refresh(item)

        logger.info(f"Stock input session item {item_id} corrected by {current_user.userId}")
        return _item_response(db, item)
    except HTTPException:
        db.rollback()
        raise
    except Exception as e:
        db.rollback()
        logger.error(f"Correct Stock Input Session Item Error: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=str(e))
