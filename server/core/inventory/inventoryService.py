from sqlmodel import Session, select
from typing import Optional
from entities.products import Product
from entities.variants import Variant
from entities.offcuts import Offcut
from entities.orderItems import OrderItem
from loggiing import logger


# ── Public entry point ────────────────────────────────────────────────────────

def deduct_stock_for_order_item(db: Session, item: OrderItem) -> None:
    """
    Deduct stock for a single OrderItem.

    Routing:
      - If details.lineItems is present  → process each line (full / half / cut / unit / roll)
      - Otherwise                        → simple quantity deduction from details.quantity

    For cut lines on offcut-tracked products, offcut_sources is recorded in each
    lineItem dict so the store manager can later reassign which offcuts fulfill the cut.
    """
    product = db.get(Product, item.product_id)
    if not product:
        raise ValueError(f"Product {item.product_id} not found")

    variant: Optional[Variant] = None
    if item.variant_id:
        variant = db.get(Variant, item.variant_id)

    details = item.details or {}
    line_items = details.get("lineItems")

    if line_items and isinstance(line_items, list):
        _process_line_items(db, product, variant, line_items)
        # Persist offcut_sources mutations back to the JSON column
        item.details = {**details, "lineItems": line_items}
        db.add(item)
    else:
        qty = float(details.get("quantity", 0))
        if qty > 0:
            _deduct_simple_stock(db, product, variant, qty)


# ── Line-item dispatcher ──────────────────────────────────────────────────────

def _process_line_items(
    db: Session,
    product: Product,
    variant: Optional[Variant],
    line_items: list,
) -> None:
    track = product.track_offcuts
    full_len = _get_full_length(product, variant)

    for line in line_items:
        l_type = line.get("type", "")
        qty = int(line.get("qty", 0))
        if qty <= 0:
            continue

        if "full" in l_type:
            # ── Full length sale ──────────────────────────────────────────
            _deduct_full_stock(db, product, variant, qty)

        elif "half" in l_type:
            # ── Half-length sale ──────────────────────────────────────────
            if full_len <= 0:
                logger.warning(
                    f"Product {product.productId} has no length set; "
                    "deducting 1 whole unit per half sold."
                )
                _deduct_full_stock(db, product, variant, qty)
            elif track:
                half_len = full_len / 2.0
                _process_cut_with_offcuts(db, product, variant, half_len, qty, full_len, line)
            else:
                _deduct_full_stock(db, product, variant, qty)

        elif "cut" in l_type:
            # ── Custom cut ────────────────────────────────────────────────
            meta = line.get("meta", {})
            cut_len = float(meta.get("length", 0))

            if cut_len <= 0:
                logger.warning(
                    f"Cut line item for product {product.productId} has no length; skipping deduction."
                )
                continue

            if track:
                _process_cut_with_offcuts(db, product, variant, cut_len, qty, full_len, line)
            else:
                _deduct_full_stock(db, product, variant, qty)

        elif "roll" in l_type or "meter" in l_type:
            _deduct_simple_stock(db, product, variant, qty)

        elif "unit" in l_type:
            _deduct_simple_stock(db, product, variant, qty)

        else:
            logger.warning(f"Unknown line item type '{l_type}'; performing simple deduction.")
            _deduct_simple_stock(db, product, variant, qty)


# ── Stock deduction primitives ────────────────────────────────────────────────

def _get_full_length(product: Product, variant: Optional[Variant] = None) -> float:
    if variant and variant.length:
        return float(variant.length)
    if product.length:
        return float(product.length)
    return 0.0


def _deduct_full_stock(
    db: Session,
    product: Product,
    variant: Optional[Variant],
    qty: int,
) -> None:
    """Deduct whole units. Validates stock first. Syncs parent total when deducting a variant."""
    if variant:
        if variant.stock_quantity < qty:
            raise ValueError(
                f"Insufficient stock for '{variant.name or product.name}'. "
                f"Available: {variant.stock_quantity}, requested: {qty}"
            )
        variant.stock_quantity -= qty
        db.add(variant)
        # Keep parent product total in sync
        product.stock_quantity = max(0, (product.stock_quantity or 0) - qty)
        db.add(product)
    else:
        if product.stock_quantity < qty:
            raise ValueError(
                f"Insufficient stock for '{product.name}'. "
                f"Available: {product.stock_quantity}, requested: {qty}"
            )
        product.stock_quantity -= qty
        db.add(product)


def _deduct_simple_stock(
    db: Session,
    product: Product,
    variant: Optional[Variant],
    qty: float,
) -> None:
    """Deduct fractional or integer units. Validates stock first. Syncs parent total."""
    if variant:
        if variant.stock_quantity < qty:
            raise ValueError(
                f"Insufficient stock for '{variant.name or product.name}'. "
                f"Available: {variant.stock_quantity}, requested: {qty}"
            )
        variant.stock_quantity -= qty
        db.add(variant)
        product.stock_quantity = max(0, (product.stock_quantity or 0) - qty)
        db.add(product)
    else:
        if product.stock_quantity < qty:
            raise ValueError(
                f"Insufficient stock for '{product.name}'. "
                f"Available: {product.stock_quantity}, requested: {qty}"
            )
        product.stock_quantity -= qty
        db.add(product)


# ── Offcut best-fit algorithm ─────────────────────────────────────────────────

def _process_cut_with_offcuts(
    db: Session,
    product: Product,
    variant: Optional[Variant],
    required_length: float,
    qty_cuts: int,
    full_length: float,
    line_item_dict: Optional[dict] = None,
) -> None:
    """
    Best-fit algorithm for cut-piece deduction (only called when track_offcuts=True).

    For each cut needed:
      1. Find the shortest available offcut that is >= required_length.
      2. If found  → consume it, create a remainder offcut if significant.
      3. If not    → consume 1 whole from stock, create a remainder offcut.

    If line_item_dict is provided, records offcut_sources list into it so the
    store manager can later reassign which offcuts fulfill each cut.
    """
    if required_length <= 0:
        return

    sources = []

    for _ in range(qty_cuts):
        stmt = (
            select(Offcut)
            .where(
                Offcut.product_id == product.productId,
                Offcut.length >= required_length,
                Offcut.quantity > 0,
            )
            .order_by(Offcut.length.asc())  # smallest fit first → least waste
        )
        if variant:
            stmt = stmt.where(Offcut.variant_id == variant.variantId)
        else:
            stmt = stmt.where(Offcut.variant_id == None)  # noqa: E711

        best_offcut = db.exec(stmt).first()

        if best_offcut:
            # ── Use the offcut ────────────────────────────────────────────
            oc_id = best_offcut.offcutId
            oc_len = best_offcut.length
            best_offcut.quantity -= 1
            remainder = round(oc_len - required_length, 4)
            if best_offcut.quantity == 0:
                db.delete(best_offcut)
            else:
                db.add(best_offcut)

            if remainder > 0.01:
                _upsert_offcut(db, product, variant, remainder)

            sources.append({
                "source": "offcut",
                "offcut_id": oc_id,
                "offcut_length": oc_len,
                "length_used": required_length,
                "remainder_created": remainder if remainder > 0.01 else 0,
            })

        else:
            # ── Fall back to consuming a whole bar ────────────────────────
            if full_length <= 0:
                logger.warning(
                    f"Product {product.productId} has no full length; "
                    "deducting 1 whole without creating a remainder offcut."
                )
                _deduct_full_stock(db, product, variant, 1)
                sources.append({
                    "source": "full_bar",
                    "offcut_id": None,
                    "offcut_length": 0,
                    "length_used": required_length,
                    "remainder_created": 0,
                })
                continue

            if required_length > full_length:
                raise ValueError(
                    f"Cut length {required_length} exceeds full bar length {full_length} "
                    f"for product '{product.name}'"
                )

            _deduct_full_stock(db, product, variant, 1)
            remainder = round(full_length - required_length, 4)
            if remainder > 0.01:
                _upsert_offcut(db, product, variant, remainder)

            sources.append({
                "source": "full_bar",
                "offcut_id": None,
                "offcut_length": full_length,
                "length_used": required_length,
                "remainder_created": remainder if remainder > 0.01 else 0,
            })

    if line_item_dict is not None:
        line_item_dict["offcut_sources"] = sources


# ── Stock restoration (reverses a previous deduction) ────────────────────────

def restore_stock_for_order_item(db: Session, item: OrderItem) -> None:
    """
    Reverse the stock deduction for a single OrderItem so an order can be re-processed.
    Mirrors deduct_stock_for_order_item but adds stock back instead of removing it.
    """
    product = db.get(Product, item.product_id)
    if not product:
        logger.warning(f"restore_stock: product {item.product_id} not found, skipping")
        return

    variant: Optional[Variant] = None
    if item.variant_id:
        variant = db.get(Variant, item.variant_id)

    details = item.details or {}
    line_items = details.get("lineItems")

    if line_items and isinstance(line_items, list):
        _restore_line_items(db, product, variant, line_items)
    else:
        qty = float(details.get("quantity", 0))
        if qty > 0:
            _restore_simple_stock(db, product, variant, qty)


def _restore_simple_stock(db, product, variant, qty: float) -> None:
    if variant:
        variant.stock_quantity += qty
        db.add(variant)
        product.stock_quantity = (product.stock_quantity or 0) + qty
        db.add(product)
    else:
        product.stock_quantity = (product.stock_quantity or 0) + qty
        db.add(product)


def _restore_line_items(db, product, variant, line_items: list) -> None:
    track = product.track_offcuts
    full_len = _get_full_length(product, variant)

    for line in line_items:
        l_type = line.get("type", "")
        qty = int(line.get("qty", 0))
        if qty <= 0:
            continue

        if "full" in l_type:
            _restore_simple_stock(db, product, variant, qty)

        elif "half" in l_type:
            if full_len <= 0 or not track:
                _restore_simple_stock(db, product, variant, qty)
            else:
                sources = line.get("offcut_sources")
                if sources:
                    restore_specific_offcut_sources(db, product, variant, sources)
                else:
                    for _ in range(qty):
                        _restore_simple_stock(db, product, variant, 1)
                        half_len = round(full_len / 2.0, 4)
                        _remove_offcut(db, product, variant, half_len)

        elif "cut" in l_type:
            meta = line.get("meta", {})
            cut_len = float(meta.get("length", 0))
            if cut_len <= 0:
                continue

            if not track or full_len <= 0:
                _restore_simple_stock(db, product, variant, qty)
            else:
                sources = line.get("offcut_sources")
                if sources:
                    # Use the exact recorded sources — mirrors restore_specific_offcut_sources
                    restore_specific_offcut_sources(db, product, variant, sources)
                else:
                    # No source record (legacy) — fall back to full-bar assumption
                    for _ in range(qty):
                        _restore_simple_stock(db, product, variant, 1)
                        remainder = round(full_len - cut_len, 4)
                        if remainder > 0.01:
                            _remove_offcut(db, product, variant, remainder)

        elif "roll" in l_type or "meter" in l_type or "unit" in l_type:
            _restore_simple_stock(db, product, variant, qty)

        else:
            _restore_simple_stock(db, product, variant, qty)


def _remove_offcut(db, product, variant, length: float) -> None:
    """Decrement (or delete) an offcut that was previously created as a remainder."""
    stmt = select(Offcut).where(
        Offcut.product_id == product.productId,
        Offcut.length >= length - 0.01,
        Offcut.length <= length + 0.01,
    )
    if variant:
        stmt = stmt.where(Offcut.variant_id == variant.variantId)
    else:
        stmt = stmt.where(Offcut.variant_id == None)  # noqa: E711

    existing = db.exec(stmt).first()
    if existing:
        if existing.quantity <= 1:
            db.delete(existing)
        else:
            existing.quantity -= 1
            db.add(existing)


# ── Store-manager offcut reassignment helpers ─────────────────────────────────

def restore_specific_offcut_sources(
    db: Session,
    product: Product,
    variant: Optional[Variant],
    sources: list,
) -> None:
    """
    Undo the exact offcut/stock consumption recorded in a cut line's offcut_sources.
    Called before applying a new manager-chosen set of sources.
    """
    for src in sources:
        remainder = float(src.get("remainder_created", 0))

        if src.get("source") == "offcut":
            # Restore the consumed offcut piece
            oc_id = src.get("offcut_id")
            oc_len = float(src.get("offcut_length", 0))
            if oc_id:
                existing = db.get(Offcut, oc_id)
                if existing:
                    existing.quantity += 1
                    db.add(existing)
                else:
                    # Offcut was fully deleted — recreate it
                    db.add(Offcut(
                        product_id=product.productId,
                        variant_id=variant.variantId if variant else None,
                        length=oc_len,
                        quantity=1,
                    ))
        else:
            # Restore 1 whole bar to stock
            _restore_simple_stock(db, product, variant, 1)

        # Remove the remainder offcut that was created by this cut
        if remainder > 0.01:
            _remove_offcut(db, product, variant, remainder)


def apply_specific_offcut_sources(
    db: Session,
    product: Product,
    variant: Optional[Variant],
    new_sources: list,
    required_total_length: float,
) -> list:
    """
    Consume manager-specified offcuts for a cut.  Uses SELECT FOR UPDATE to
    prevent concurrent double-use of the same offcut.

    new_sources: list of {"offcut_id": int, "length_used": float}
    Returns: list of recorded source dicts (same shape as offcut_sources).
    Raises ValueError if any offcut is unavailable or totals don't match.
    """
    total = sum(float(s["length_used"]) for s in new_sources)
    if abs(total - required_total_length) > 0.02:
        raise ValueError(
            f"Selected offcut lengths ({total:.2f} ft) must equal "
            f"the required cut ({required_total_length:.2f} ft)"
        )

    result = []
    for s in new_sources:
        oc_id = int(s["offcut_id"])
        length_used = float(s["length_used"])

        # Lock the row to prevent concurrent use
        locked = db.exec(
            select(Offcut)
            .where(Offcut.offcutId == oc_id)
            .with_for_update()
        ).first()

        if not locked:
            raise ValueError(f"Offcut #{oc_id} no longer exists")
        if locked.quantity < 1:
            raise ValueError(f"Offcut #{oc_id} is no longer available (qty=0)")
        if locked.length < length_used - 0.02:
            raise ValueError(
                f"Offcut #{oc_id} ({locked.length:.2f} ft) is too short "
                f"for the requested {length_used:.2f} ft"
            )

        remainder = round(locked.length - length_used, 4)
        locked.quantity -= 1
        if locked.quantity == 0:
            db.delete(locked)
        else:
            db.add(locked)

        if remainder > 0.01:
            _upsert_offcut(db, product, variant, remainder)

        result.append({
            "source": "offcut",
            "offcut_id": oc_id,
            "offcut_length": locked.length,
            "length_used": length_used,
            "remainder_created": remainder if remainder > 0.01 else 0,
        })

    return result


def _upsert_offcut(
    db: Session,
    product: Product,
    variant: Optional[Variant],
    length: float,
) -> None:
    """
    Create a new offcut record or increment the quantity if one of the
    same length (±1mm tolerance) already exists.
    """
    stmt = select(Offcut).where(
        Offcut.product_id == product.productId,
        Offcut.length >= length - 0.001,
        Offcut.length <= length + 0.001,
    )
    if variant:
        stmt = stmt.where(Offcut.variant_id == variant.variantId)
    else:
        stmt = stmt.where(Offcut.variant_id == None)  # noqa: E711

    existing = db.exec(stmt).first()
    if existing:
        existing.quantity += 1
        db.add(existing)
    else:
        db.add(Offcut(
            product_id=product.productId,
            variant_id=variant.variantId if variant else None,
            length=length,
            quantity=1,
        ))
