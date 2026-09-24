"""
Manager-facing operations for the open-container stock model.

Background (see entities/openContainers.py and the open-container section of
core/inventory/inventoryService.py): for accessories whose pack contents vary
or can't be counted, the system tracks whole sealed packs and nothing below
them. These are the endpoints for the only two facts a human can supply that
the system genuinely cannot infer -- "I have broken a pack open" and "that
pack is now empty".
"""
from typing import Optional, List
from datetime import datetime, timezone

from fastapi import HTTPException, status
from sqlmodel import Session, select

from entities.products import Product
from entities.variants import Variant
from entities.users import User
from entities.editHistory import EditHistory
from entities.openContainers import OpenContainer
from entities.offcuts import Offcut
from core.inventory.poolKey import (
    load_attribute_types,
    pool_key_from_attributes,
    safe_delete_offcut,
)
from core.inventory.inventoryService import (
    is_open_container_mode,
    _lock_variant,
    _lock_product,
)
from loggiing import logger
from . import model


# -- Shared helpers -----------------------------------------------------------

def _user_name(db: Session, user_id) -> Optional[str]:
    if not user_id:
        return None
    user = db.get(User, user_id)
    return user.username if user else None


def _observed_yield(c: OpenContainer) -> float:
    """What a finished pack actually gave. A measured actual_quantity beats the
    running tally -- the tally only counts what was SOLD, and a pack can lose
    material to offcuts, damage or internal use that no sale ever recorded."""
    if c.actual_quantity is not None and c.actual_quantity > 0:
        return float(c.actual_quantity)
    return float(c.units_sold or 0.0)


def _utilization(c: OpenContainer) -> dict:
    """Per-pack derived figures for the history view. Each is None rather than 0
    when the input it needs is absent, so the UI shows a dash instead of an
    invented zero -- the distinction between "nothing unaccounted for" and
    "nobody measured it" is the whole point of these numbers."""
    duration_hours = None
    if c.opened_at:
        end = c.closed_at or datetime.now(timezone.utc)
        # opened_at/closed_at come back from Postgres naive (the column is
        # `timestamp without time zone`); match that before subtracting rather
        # than raising on a naive/aware mix.
        start = c.opened_at.replace(tzinfo=None) if c.opened_at.tzinfo else c.opened_at
        end = end.replace(tzinfo=None) if end.tzinfo else end
        duration_hours = round((end - start).total_seconds() / 3600.0, 2)

    observed = _observed_yield(c)
    variance = (
        round(observed - float(c.nominal_quantity), 2)
        if c.nominal_quantity and observed > 0 else None
    )
    unaccounted = (
        round(float(c.actual_quantity) - float(c.units_sold or 0.0), 2)
        if c.actual_quantity is not None and c.actual_quantity > 0 else None
    )
    return {
        "duration_hours": duration_hours,
        "variance_vs_label": variance,
        "unaccounted_units": unaccounted,
    }


def _to_response(db: Session, c: OpenContainer) -> model.OpenContainerResponse:
    product = db.get(Product, c.product_id)
    variant = db.get(Variant, c.variant_id) if c.variant_id else None
    return model.OpenContainerResponse(
        **_utilization(c),
        id=c.id,
        product_id=c.product_id,
        product_name=product.name if product else "",
        variant_id=c.variant_id,
        variant_name=(variant.name or None) if variant else None,
        attributes=(variant.attributes or {}) if variant else {},
        pool_key=c.pool_key,
        unit=product.unit if product else None,
        status=c.status,
        opened_by_name=_user_name(db, c.opened_by),
        opened_at=c.opened_at,
        closed_by_name=_user_name(db, c.closed_by),
        closed_at=c.closed_at,
        nominal_quantity=c.nominal_quantity,
        units_sold=c.units_sold or 0.0,
        actual_quantity=c.actual_quantity,
        notes=c.notes,
    )


def _audit(db: Session, container: OpenContainer, action: str, current_user, before: dict, notes: str) -> None:
    """Every open/close/cancel lands in the shared CEO activity feed
    (GET /orders/audit/history). The snapshot carries the product and variant
    names, not just ids, so that feed stays readable years later even if the
    variant has since been renamed or deleted."""
    product = db.get(Product, container.product_id)
    variant = db.get(Variant, container.variant_id) if container.variant_id else None
    db.add(EditHistory(
        entity_type="open_container",
        entity_id=container.id,
        edited_by=current_user.userId,
        action=action,
        before_snapshot=before,
        after_snapshot={
            "status": container.status,
            "product_name": product.name if product else None,
            "variant_name": (variant.name or None) if variant else None,
            "unit": product.unit if product else None,
            "nominal_quantity": container.nominal_quantity,
            "units_sold": container.units_sold,
            "actual_quantity": container.actual_quantity,
        },
        notes=notes,
    ))


def _finished_yields(db: Session, variant_id: int) -> List[OpenContainer]:
    """Finished packs of this variant, newest first. A pack closed with nothing
    dispensed is excluded -- it says nothing about yield (it was almost
    certainly closed for some other reason, e.g. damaged stock)."""
    rows = db.exec(
        select(OpenContainer).where(
            OpenContainer.variant_id == variant_id,
            OpenContainer.status == "finished",
        ).order_by(OpenContainer.closed_at.desc())
    ).all()
    return [c for c in rows if _observed_yield(c) > 0]


def _avg_yield(db: Session, variant_id: int) -> Optional[float]:
    finished = _finished_yields(db, variant_id)
    if not finished:
        return None
    return round(sum(_observed_yield(c) for c in finished) / len(finished), 2)


# -- Queries ------------------------------------------------------------------

def list_containers(
    db: Session,
    status_filter: Optional[str] = "open",
    product_id: Optional[int] = None,
    limit: int = 200,
) -> List[model.OpenContainerResponse]:
    stmt = select(OpenContainer)
    if status_filter:
        stmt = stmt.where(OpenContainer.status == status_filter)
    if product_id:
        stmt = stmt.where(OpenContainer.product_id == product_id)
    # Open packs read oldest-first, matching the FIFO order sales actually draw
    # in (inventoryService.find_open_container); history reads newest-first.
    if status_filter == "open":
        stmt = stmt.order_by(OpenContainer.opened_at, OpenContainer.id)
    else:
        stmt = stmt.order_by(OpenContainer.opened_at.desc(), OpenContainer.id.desc())
    return [_to_response(db, c) for c in db.exec(stmt.limit(limit)).all()]


def list_openable(db: Session) -> List[model.OpenableVariantResponse]:
    """Every variant of an open-container product with at least one sealed pack
    left -- the "what can I open" half of the manager panel."""
    candidates = db.exec(select(Product)).all()
    products = [p for p in candidates if is_open_container_mode(p)]
    if not products:
        return []

    attribute_types = load_attribute_types(db)
    product_ids = [p.productId for p in products]
    variants = db.exec(select(Variant).where(Variant.product_id.in_(product_ids))).all()

    open_pool_keys = {
        (c.product_id, c.pool_key)
        for c in db.exec(select(OpenContainer).where(
            OpenContainer.status == "open",
            OpenContainer.product_id.in_(product_ids),
        )).all()
    }

    by_id = {p.productId: p for p in products}
    out: List[model.OpenableVariantResponse] = []
    for v in variants:
        if (v.stock_quantity or 0) < 1:
            continue
        product = by_id.get(v.product_id)
        if not product:
            continue
        pool_key = pool_key_from_attributes(v.attributes, attribute_types, product.pool_ignored_attributes)
        out.append(model.OpenableVariantResponse(
            product_id=product.productId,
            product_name=product.name,
            variant_id=v.variantId,
            variant_name=v.name or None,
            attributes=v.attributes or {},
            unit=product.unit,
            pool_key=pool_key,
            sealed_stock=int(v.stock_quantity or 0),
            nominal_quantity=v.unit_quantity,
            has_open=(product.productId, pool_key) in open_pool_keys,
            avg_yield=_avg_yield(db, v.variantId),
        ))
    out.sort(key=lambda r: (r.product_name, r.variant_name or "", r.variant_id))
    return out


def yield_history(variant_id: int, db: Session) -> model.YieldHistoryResponse:
    variant = db.get(Variant, variant_id)
    if not variant:
        raise HTTPException(status_code=404, detail="Variant not found")

    finished = _finished_yields(db, variant_id)
    yields = [_observed_yield(c) for c in finished]
    return model.YieldHistoryResponse(
        variant_id=variant_id,
        nominal_quantity=variant.unit_quantity,
        sample_size=len(yields),
        avg_yield=round(sum(yields) / len(yields), 2) if yields else None,
        min_yield=min(yields) if yields else None,
        max_yield=max(yields) if yields else None,
        entries=[
            model.YieldHistoryEntry(
                container_id=c.id,
                opened_at=c.opened_at,
                closed_at=c.closed_at,
                units_sold=c.units_sold or 0.0,
                actual_quantity=c.actual_quantity,
            )
            for c in finished
        ],
    )


# -- Mutations ----------------------------------------------------------------

def open_container(
    product_id: int,
    payload: model.OpenContainerCreate,
    db: Session,
    current_user,
) -> model.OpenContainerResponse:
    """Move exactly one sealed pack out of stock and into a dispensing row.
    This is the moment the pack leaves the books -- everything sold out of it
    afterwards is already accounted for."""
    product = db.get(Product, product_id)
    if not product:
        raise HTTPException(status_code=404, detail="Product not found")
    if not is_open_container_mode(product):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"'{product.name}' is not set to open-container stock tracking.",
        )

    variant: Optional[Variant] = db.get(Variant, payload.variant_id) if payload.variant_id else None
    if not variant or variant.product_id != product_id:
        raise HTTPException(status_code=404, detail="Variant not found for this product")

    locked = _lock_variant(db, variant)
    if (locked.stock_quantity or 0) < 1:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"No sealed packs left of '{locked.name or product.name}' to open.",
        )

    sealed_before = locked.stock_quantity or 0
    locked.stock_quantity -= 1
    db.add(locked)
    locked_product = _lock_product(db, product)
    locked_product.stock_quantity = max(0, (locked_product.stock_quantity or 0) - 1)
    db.add(locked_product)

    attribute_types = load_attribute_types(db)
    pool_key = pool_key_from_attributes(
        locked.attributes, attribute_types, locked_product.pool_ignored_attributes
    )

    container = OpenContainer(
        product_id=product_id,
        variant_id=locked.variantId,
        pool_key=pool_key,
        status="open",
        opened_by=current_user.userId,
        opened_at=datetime.now(timezone.utc),
        nominal_quantity=locked.unit_quantity,
        units_sold=0.0,
        notes=payload.notes,
    )
    db.add(container)
    db.flush()  # need container.id for the audit row below

    _audit(db, container, "open", current_user,
           before={"sealed_stock": sealed_before},
           notes=payload.notes or f"Opened 1 pack of {locked.name or product.name}")
    db.commit()
    db.refresh(container)
    logger.info(f"Open container {container.id} created for variant {locked.variantId} by {current_user.userId}")
    return _to_response(db, container)


def close_container(
    container_id: int,
    payload: model.OpenContainerClose,
    db: Session,
    current_user,
) -> model.OpenContainerResponse:
    """The pack is physically empty. Nothing returns to stock -- it left at open
    time -- so this only stops further sub-pack sales drawing on it and files
    what it yielded."""
    container = db.get(OpenContainer, container_id)
    if not container:
        raise HTTPException(status_code=404, detail="Open container not found")
    if container.status != "open":
        raise HTTPException(status_code=400, detail="This pack is already closed.")

    before = {"status": container.status, "units_sold": container.units_sold}
    container.status = "finished"
    container.closed_by = current_user.userId
    container.closed_at = datetime.now(timezone.utc)
    if payload.actual_quantity is not None:
        container.actual_quantity = payload.actual_quantity
    if payload.notes:
        container.notes = payload.notes
    db.add(container)

    _audit(db, container, "close", current_user, before, notes=payload.notes or "Pack finished")
    db.commit()
    db.refresh(container)
    return _to_response(db, container)


def reopen_container(container_id: int, db: Session, current_user) -> model.OpenContainerResponse:
    """Undo a premature close. Exists because the alternative -- opening a fresh
    pack to keep selling -- wrongly takes another one out of stock, so without
    this a misclick quietly costs a pack."""
    container = db.get(OpenContainer, container_id)
    if not container:
        raise HTTPException(status_code=404, detail="Open container not found")
    if container.status == "open":
        return _to_response(db, container)

    before = {"status": container.status, "closed_at": str(container.closed_at)}
    container.status = "open"
    container.closed_by = None
    container.closed_at = None
    db.add(container)

    _audit(db, container, "reopen", current_user, before, notes="Reopened -- closed in error")
    db.commit()
    db.refresh(container)
    return _to_response(db, container)


def cancel_container(container_id: int, db: Session, current_user) -> dict:
    """Opened by mistake -- put the pack back on the shelf and delete the row.

    Refused once anything has been dispensed: the pack is physically broken
    open by then, so returning it to sealed stock would be a lie. Close it
    instead.
    """
    container = db.get(OpenContainer, container_id)
    if not container:
        raise HTTPException(status_code=404, detail="Open container not found")
    if (container.units_sold or 0) > 0:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=(
                f"{container.units_sold:g} unit(s) have already been sold from this pack, "
                "so it can't go back to sealed stock. Mark it finished instead."
            ),
        )

    product = db.get(Product, container.product_id)
    variant = db.get(Variant, container.variant_id) if container.variant_id else None
    if variant:
        locked = _lock_variant(db, variant)
        locked.stock_quantity = (locked.stock_quantity or 0) + 1
        db.add(locked)
    if product:
        locked_product = _lock_product(db, product)
        locked_product.stock_quantity = (locked_product.stock_quantity or 0) + 1
        db.add(locked_product)

    db.add(EditHistory(
        entity_type="open_container",
        entity_id=container.id,
        edited_by=current_user.userId,
        action="cancel",
        before_snapshot={"status": container.status, "variant_id": container.variant_id},
        after_snapshot={"status": "cancelled", "returned_to_stock": 1},
        notes="Opened in error -- pack returned to sealed stock",
    ))
    db.delete(container)
    db.commit()
    return {"ok": True, "message": "Pack returned to sealed stock."}


# -- Mode switching -----------------------------------------------------------

def _loose_pool_rows(db: Session, product_id: int) -> List[Offcut]:
    """The counted model's shared "loose pieces" rows for this product -- an
    Offcut with `length` repurposed as a piece count and no width, keyed by
    pool (see inventoryService._find_loose_pcs_offcut)."""
    return db.exec(
        select(Offcut).where(
            Offcut.product_id == product_id,
            Offcut.status == "available",
            Offcut.width.is_(None),
        )
    ).all()


def convert_product_stock_mode(product: Product, new_mode: str, db: Session, current_user) -> dict:
    """Re-express a product's existing stock when unit_stock_mode changes.

    The two modes keep stock_quantity in different units -- PIECES under
    'counted', whole PACKS under 'open_container' -- so flipping the flag alone
    would silently multiply or divide every stock figure for this product by its
    pack size. This converts the numbers to match the new meaning.

    Returns a summary for the caller to audit. Does not commit: the caller's
    product update owns the transaction.
    """
    old_mode = getattr(product, "unit_stock_mode", "counted") or "counted"
    if old_mode == new_mode:
        return {"changed": False}

    attribute_types = load_attribute_types(db)
    variants = db.exec(select(Variant).where(Variant.product_id == product.productId)).all()
    detail: List[dict] = []

    if new_mode == "open_container":
        # Pieces -> whole packs. Any remainder is, by definition, a pack that
        # has already been broken open, so it becomes a real open container
        # rather than being rounded away.
        loose_by_pool: dict = {}
        for v in variants:
            pack = v.unit_quantity or 0
            pool_key = pool_key_from_attributes(v.attributes, attribute_types, product.pool_ignored_attributes)
            if pack > 1:
                packs = int((v.stock_quantity or 0) // int(pack))
                leftover = int((v.stock_quantity or 0) - packs * int(pack))
                if leftover > 0:
                    loose_by_pool.setdefault(pool_key, {"pieces": 0, "variant_id": v.variantId})
                    loose_by_pool[pool_key]["pieces"] += leftover
                detail.append({
                    "variant_id": v.variantId, "from_pieces": v.stock_quantity,
                    "to_packs": packs, "loose": leftover,
                })
                v.stock_quantity = packs
                db.add(v)
            # An unpackaged variant (no pack size) already counts its own whole
            # sale units, which IS one pack each -- nothing to convert.

        # Fold the counted model's leftover pools in as well: loose pieces are
        # physically a pack someone already opened.
        for row in _loose_pool_rows(db, product.productId):
            pieces = int(row.length or 0)
            if pieces > 0:
                loose_by_pool.setdefault(row.pool_key, {"pieces": 0, "variant_id": row.variant_id})
                loose_by_pool[row.pool_key]["pieces"] += pieces
            safe_delete_offcut(db, row)

        for pool_key, info in loose_by_pool.items():
            variant = db.get(Variant, info["variant_id"]) if info["variant_id"] else None
            db.add(OpenContainer(
                product_id=product.productId,
                variant_id=info["variant_id"],
                pool_key=pool_key,
                status="open",
                opened_by=current_user.userId,
                opened_at=datetime.now(timezone.utc),
                nominal_quantity=variant.unit_quantity if variant else None,
                # Left at 0 deliberately: these pieces were sold down under the
                # old model, so there is no per-pack tally to carry over, and a
                # fabricated one would poison the yield history this mode exists
                # to build. The note keeps the real figure visible.
                units_sold=0.0,
                notes=f"Carried over at switchover -- {info['pieces']} loose unit(s) from the counted model",
            ))

    else:
        # open_container -> counted. Packs -> pieces at the nominal pack size,
        # which is exactly the fiction this mode was adopted to avoid, so it is
        # inherently approximate. Anything currently open is closed: the counted
        # model has nowhere to put a half-used pack, and its contents are
        # unknown, so they are written off rather than invented as loose stock.
        for c in db.exec(select(OpenContainer).where(
            OpenContainer.product_id == product.productId,
            OpenContainer.status == "open",
        )).all():
            c.status = "finished"
            c.closed_by = current_user.userId
            c.closed_at = datetime.now(timezone.utc)
            c.notes = (c.notes or "") + " | closed automatically: product switched to counted stock"
            db.add(c)

        for v in variants:
            pack = v.unit_quantity or 0
            if pack > 1:
                pieces = int((v.stock_quantity or 0) * int(pack))
                detail.append({"variant_id": v.variantId, "from_packs": v.stock_quantity, "to_pieces": pieces})
                v.stock_quantity = pieces
                db.add(v)

    db.flush()
    product.stock_quantity = sum(int(v.stock_quantity or 0) for v in variants)
    db.add(product)

    db.add(EditHistory(
        entity_type="product_update",
        entity_id=product.productId,
        edited_by=current_user.userId,
        action="stock_mode_change",
        before_snapshot={"unit_stock_mode": old_mode},
        after_snapshot={"unit_stock_mode": new_mode, "variants": detail},
        notes=f"Stock re-expressed from {old_mode} to {new_mode}",
    ))
    logger.info(f"Product {product.productId} stock mode {old_mode} -> {new_mode}: {detail}")
    return {"changed": True, "from": old_mode, "to": new_mode, "variants": detail}
