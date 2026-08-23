from sqlmodel import Session, select
from sqlalchemy.orm.attributes import flag_modified
from typing import Optional
from entities.products import Product
from entities.variants import Variant
from entities.offcuts import Offcut
from entities.orderItems import OrderItem
from entities.orders import Order
from core.inventory.glassOffcutService import resolve_glass_cut_lines, restore_glass_cut_lines
from core.inventory.poolKey import load_attribute_types, pool_key_from_attributes, compute_pool_key, pool_sibling_variants
from loggiing import logger


def _pending_source_notice(db: Session, source_item_id: Optional[int]) -> Optional[dict]:
    """If `source_item_id` points to an OrderItem whose cutting isn't marked done yet,
    returns the advisory notice dict to attach to a consuming event — see the 2D
    equivalent in glassOffcutService._apply_candidate for the full rationale."""
    if not source_item_id:
        return None
    producing_item = db.get(OrderItem, source_item_id)
    if not producing_item or producing_item.cutting_completed:
        return None
    order = db.get(Order, producing_item.order_id)
    customer_name = order.customer_name if order is not None else None
    return {"order_id": producing_item.order_id, "item_id": producing_item.item_id, "customer_name": customer_name}


# ── Public entry point ────────────────────────────────────────────────────────

def deduct_stock_for_order_item(db: Session, item: OrderItem) -> None:
    """
    Deduct stock for a single OrderItem.

    Routing:
      - If details.lineItems is present  → process each line (full / half / cut / unit / roll)
      - Otherwise                        → simple quantity deduction from details.quantity

    For cut lines on offcut-tracked products, offcut_sources is recorded in each
    lineItem dict for later restoration if the order is edited or cancelled.
    """
    product = db.get(Product, item.product_id)
    if not product:
        raise ValueError(f"Product {item.product_id} not found")

    variant: Optional[Variant] = None
    if item.variant_id:
        variant = db.get(Variant, item.variant_id)

    if item.item_id is None:
        # Order-creation's call site adds the item but doesn't flush before calling
        # here (order-edit's does) — flush now so item.item_id is always populated
        # before it's threaded through as Offcut.source_item_id below.
        db.flush()

    details = item.details or {}
    line_items = details.get("lineItems")

    if line_items and isinstance(line_items, list):
        cuttable = _process_line_items(db, product, variant, line_items, item.item_id)
        if cuttable:
            item.cutting_completed = False
            item.cutting_completed_at = None
        # Persist offcut_sources mutations back to the JSON column.
        # flag_modified is required: the offcut lookups inside _process_line_items
        # trigger a premature autoflush that INSERTs this item before offcut_sources
        # is attached, then mutates the same lineItems list in place — so by the time
        # this reassignment runs, old and new `details` are value-equal and SQLAlchemy
        # skips the UPDATE unless explicitly told the attribute changed.
        item.details = {**details, "lineItems": line_items}
        flag_modified(item, "details")
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
    item_id: Optional[int] = None,
) -> bool:
    """Returns True if any line actually went through a cut-resolution engine
    (i.e. this item needs a cutting job) — see deduct_stock_for_order_item, which
    uses this to decide whether to leave the item's cutting_completed at its
    default True ("nothing to cut") or flip it False ("needs cutting")."""
    track = product.track_offcuts
    full_len = _get_full_length(product, variant)
    cuttable = False
    attribute_types = load_attribute_types(db)
    pool_key = pool_key_from_attributes(variant.attributes if variant else None, attribute_types, product.pool_ignored_attributes)

    # 2D glass cuts are resolved as one batch across all glass-cut lines in this
    # item (see glassOffcutService.resolve_glass_cut_lines) rather than line-by-line,
    # so the largest cut doesn't get starved of the best offcut by smaller cuts.
    glass_cut_lines = [l for l in line_items if l.get("type", "") == "glass-cut" and int(l.get("qty", 0)) > 0]
    if glass_cut_lines and track:
        resolve_glass_cut_lines(db, product, variant, glass_cut_lines, item_id)
        cuttable = True

    # Manually-selected profile cut lines must be consumed before any automatic
    # (best-fit) profile line in this same item — otherwise an earlier auto line
    # can grab the very offcut the cashier reserved for a later manual line,
    # deleting it and making the manual line fail with "no longer exists" even
    # though nothing external touched it. Only applies to 1D "cut" lines
    # (profile/bar products); glass-cut lines are already handled above via
    # resolve_glass_cut_lines and skipped in this loop. Python's sort is
    # stable, so this only pulls reserved lines to the front; relative order
    # within each group is unchanged.
    def _is_reserved_cut(line: dict) -> bool:
        l_type = line.get("type", "")
        return l_type != "glass-cut" and "cut" in l_type and bool(line.get("offcut_selection"))

    ordered_lines = sorted(line_items, key=lambda l: 0 if _is_reserved_cut(l) else 1)

    for line in ordered_lines:
        l_type = line.get("type", "")
        qty = int(line.get("qty", 0))
        if qty <= 0:
            continue

        if l_type == "glass-cut":
            if not track:
                _deduct_full_stock(db, product, variant, qty)
            # else: already resolved above via resolve_glass_cut_lines
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
                _process_cut_with_offcuts(db, product, variant, half_len, qty, full_len, line, item_id, pool_key)
                cuttable = True
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
                manual_selection = line.get("offcut_selection")
                if manual_selection:
                    line["offcut_sources"] = apply_manual_cut_selection(
                        db, product, variant, manual_selection, cut_len * qty, full_len, item_id, pool_key
                    )
                else:
                    _process_cut_with_offcuts(db, product, variant, cut_len, qty, full_len, line, item_id, pool_key)
                cuttable = True
            else:
                _deduct_full_stock(db, product, variant, qty)

        elif "roll" in l_type or "meter" in l_type:
            _deduct_simple_stock(db, product, variant, qty)

        elif l_type == "accessory-pcs":
            # Piece sale: qty is already a piece count. A piece doesn't care
            # which sealed box it came from, so this draws from the whole
            # pool — already-loose pieces first (a shared leftover pool, plus
            # any inherently unpackaged sibling variant), only opening a
            # sealed box (smallest pack size first) if that's not enough. See
            # _deduct_packaged_stock_pooled / core/inventory/poolKey.py.
            _deduct_packaged_stock_pooled(db, product, variant, qty, pool_key, line)

        elif "unit" in l_type:
            # Pack/box sale: the customer receives actual sealed boxes of
            # THIS variant's own pack size, so unlike a piece sale this never
            # substitutes a different pack size or draws from the loose pool
            # — it's a plain deduction, just expressed in pieces (this
            # variant's own pack size, 1 for an unpackaged variant).
            pieces_per_unit = (variant.unit_quantity if variant else None) or 1
            _deduct_simple_stock(db, product, variant, qty * pieces_per_unit)

        else:
            logger.warning(f"Unknown line item type '{l_type}'; performing simple deduction.")
            _deduct_simple_stock(db, product, variant, qty)

    return cuttable


def check_line_items_feasible(
    db: Session,
    product: Product,
    variant: Optional[Variant],
    line_items: list,
) -> dict:
    """
    Dry-runs _process_line_items — the exact dispatcher a real checkout calls
    via deduct_stock_for_order_item — against a shallow copy of line_items, to
    check whether they can be fulfilled from current stock/offcuts without
    committing anything. Mirrors how products/service.py's preview_glass_cuts
    reuses glassOffcutService.resolve_glass_cut_lines: same real logic, always
    rolled back in `finally`, so nothing is ever persisted by a dry run.

    Returns {"ok": True, "message": None} if fulfillable, else
    {"ok": False, "message": <human-readable reason, from the ValueError>}.
    """
    trial_lines = [dict(line) for line in line_items]  # don't mutate caller's lineItems
    try:
        _process_line_items(db, product, variant, trial_lines)
        return {"ok": True, "message": None}
    except ValueError as e:
        return {"ok": False, "message": str(e)}
    finally:
        db.rollback()  # dry run only — never persist


# ── Stock deduction primitives ────────────────────────────────────────────────

def _get_full_length(product: Product, variant: Optional[Variant] = None) -> float:
    if variant and variant.length:
        return float(variant.length)
    return 0.0


def _lock_variant(db: Session, variant: Variant) -> Variant:
    """Re-fetch a variant with SELECT ... FOR UPDATE so concurrent deductions
    against the same row block instead of racing (lost-update prevention)."""
    return db.exec(
        select(Variant).where(Variant.variantId == variant.variantId).with_for_update()
    ).first()


def _lock_product(db: Session, product: Product) -> Product:
    """Re-fetch a product with SELECT ... FOR UPDATE — see _lock_variant."""
    return db.exec(
        select(Product).where(Product.productId == product.productId).with_for_update()
    ).first()


def _deduct_full_stock(
    db: Session,
    product: Product,
    variant: Optional[Variant],
    qty: int,
) -> None:
    """Deduct whole units. Locks the row first to prevent concurrent oversell,
    validates stock, then syncs parent total when deducting a variant."""
    if variant:
        variant = _lock_variant(db, variant)
        if variant.stock_quantity < qty:
            raise ValueError(
                f"Insufficient stock for '{variant.name or product.name}'. "
                f"Available: {variant.stock_quantity}, requested: {qty}"
            )
        variant.stock_quantity -= qty
        db.add(variant)
        # Keep parent product total in sync
        product = _lock_product(db, product)
        product.stock_quantity = max(0, (product.stock_quantity or 0) - qty)
        db.add(product)
    else:
        product = _lock_product(db, product)
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
    """Deduct fractional or integer units. Locks the row first to prevent
    concurrent oversell, validates stock, then syncs parent total."""
    if variant:
        variant = _lock_variant(db, variant)
        if variant.stock_quantity < qty:
            raise ValueError(
                f"Insufficient stock for '{variant.name or product.name}'. "
                f"Available: {variant.stock_quantity}, requested: {qty}"
            )
        variant.stock_quantity -= qty
        db.add(variant)
        product = _lock_product(db, product)
        product.stock_quantity = max(0, (product.stock_quantity or 0) - qty)
        db.add(product)
    else:
        product = _lock_product(db, product)
        if product.stock_quantity < qty:
            raise ValueError(
                f"Insufficient stock for '{product.name}'. "
                f"Available: {product.stock_quantity}, requested: {qty}"
            )
        product.stock_quantity -= qty
        db.add(product)


# ── Packaged-accessory piece pooling: loose pool + box-opening ───────────────
#
# A packaged accessory variant (e.g. "Wood Screw / 2 inches / Box of 1000pcs")
# stores stock_quantity in pieces, but ALWAYS as a whole number of sealed boxes
# — a box is atomic, sealed or not, never partially consumed in place (unlike
# the old pooled model this replaces, which would freely leave a variant at a
# fictional "0.45 boxes"). "Already loose" pieces — leftover from a
# previously opened box, or a sibling variant that was never packaged in the
# first place (e.g. a plain "Single pcs" variant with no unit_quantity) — live
# in a single shared pool per pool_key (core/inventory/poolKey.py), reusing
# the SAME Offcut table/column every other offcut pool uses, with `length`
# repurposed as a piece count (these products are never has_dimensions=True,
# so there's no clash with 2D width/height usage).
#
# A piece sale (_deduct_packaged_stock_pooled) draws loose pieces first, and
# only opens a sealed box — smallest pack size first, to minimize what's left
# over — once the loose pool (and every unpackaged sibling) is exhausted.
# Whatever's left over from an opened box beyond what this sale needed goes
# straight back into the loose pool for the next sale. A box/pack sale
# (dispatched separately in _process_line_items) does NOT go through this —
# a customer buying "2 boxes" needs actual sealed boxes of that exact pack
# size, not a pile of loose pieces reconstituted from various openings.

def _find_loose_pcs_offcut(db: Session, product: Product, pool_key: str) -> Optional[Offcut]:
    """The single row (if any) holding this pool's already-loose pieces."""
    return db.exec(
        select(Offcut).where(
            Offcut.product_id == product.productId,
            Offcut.pool_key == pool_key,
            Offcut.status == "available",
            Offcut.width.is_(None),
        ).with_for_update()
    ).first()


def _add_loose_pcs(db: Session, product: Product, pool_key: str, pieces: int, variant_id: Optional[int] = None) -> None:
    if pieces <= 0:
        return
    existing = _find_loose_pcs_offcut(db, product, pool_key)
    if existing:
        existing.length += pieces
        if variant_id is not None:
            existing.variant_id = variant_id
        db.add(existing)
    else:
        db.add(Offcut(
            product_id=product.productId, variant_id=variant_id, pool_key=pool_key,
            length=pieces, quantity=1, status="available",
        ))


def _take_loose_pcs(db: Session, product: Product, pool_key: str, pieces: int) -> tuple:
    """Consume up to `pieces` from the loose pool. Returns (taken, offcut_id)."""
    existing = _find_loose_pcs_offcut(db, product, pool_key)
    if not existing or existing.length <= 0:
        return 0, None
    taken = min(int(existing.length), pieces)
    existing.length -= taken
    offcut_id = existing.offcutId
    if existing.length <= 0:
        db.delete(existing)
    else:
        db.add(existing)
    return taken, offcut_id


def _remove_loose_pcs(db: Session, product: Product, pool_key: str, pieces: int) -> None:
    """Reverses _add_loose_pcs — removes exactly the pieces a since-reversed
    box-opening added, not a flat re-take (the pool may have moved since)."""
    existing = _find_loose_pcs_offcut(db, product, pool_key)
    if not existing:
        return
    existing.length = max(0, existing.length - pieces)
    if existing.length <= 0:
        db.delete(existing)
    else:
        db.add(existing)


def _deduct_packaged_stock_pooled(
    db: Session,
    product: Product,
    variant: Optional[Variant],
    qty_pieces: float,
    pool_key: Optional[str] = None,
    line_item_dict: Optional[dict] = None,
) -> None:
    """
    Fulfil a piece-count sale for a packaged (count-tracked) accessory:
      1. Draw from whatever's already loose — the shared opened-box pool,
         plus any pool-sibling variant that's inherently unpackaged
         (unit_quantity unset/<=1, so its own stock_quantity already IS
         individual pieces, not sealed boxes).
      2. If that's not enough, open sealed boxes to cover the shortfall,
         smallest pack size first — a box is opened by decrementing its own
         variant's stock_quantity by exactly its own unit_quantity (never
         partially). Whatever's left over from an opened box beyond what
         THIS sale needed goes back into the loose pool for next time.
      3. Raises ValueError if every loose piece and every sealed box across
         the whole pool still isn't enough.
    Records exactly what was drawn from into line_item_dict['stock_sources']
    so a later restore can reverse it precisely — see
    _restore_packaged_stock_pooled.
    """
    if not variant:
        _deduct_simple_stock(db, product, variant, qty_pieces)
        return
    if pool_key is None:
        pool_key = compute_pool_key(db, variant)

    remaining = round(qty_pieces)
    sources = []
    product_locked = _lock_product(db, product)

    self_locked = _lock_variant(db, variant)
    pool_variants = [self_locked] + [_lock_variant(db, sib) for sib in pool_sibling_variants(db, self_locked, pool_key)]

    # ── Tier 1: already loose ────────────────────────────────────────────
    for v in (pv for pv in pool_variants if not ((pv.unit_quantity or 0) > 1)):
        if remaining <= 0:
            break
        take = min(v.stock_quantity, remaining)
        if take <= 0:
            continue
        v.stock_quantity -= take
        db.add(v)
        remaining -= take
        product_locked.stock_quantity = max(0, (product_locked.stock_quantity or 0) - take)
        sources.append({"source": "loose_variant", "variant_id": v.variantId, "stock_used": take})

    if remaining > 0:
        taken, offcut_id = _take_loose_pcs(db, product, pool_key, remaining)
        if taken > 0:
            remaining -= taken
            product_locked.stock_quantity = max(0, (product_locked.stock_quantity or 0) - taken)
            sources.append({"source": "loose_pool", "offcut_id": offcut_id, "stock_used": taken})

    # ── Tier 2: open sealed boxes, smallest pack size first ──────────────
    if remaining > 0:
        boxable = sorted(
            (v for v in pool_variants if (v.unit_quantity or 0) > 1 and v.stock_quantity >= v.unit_quantity),
            key=lambda v: v.unit_quantity,
        )
        for box_variant in boxable:
            while remaining > 0 and box_variant.stock_quantity >= box_variant.unit_quantity:
                box_size = round(box_variant.unit_quantity)
                box_variant.stock_quantity -= box_size
                db.add(box_variant)
                take = min(box_size, remaining)
                remaining -= take
                leftover = box_size - take
                if leftover > 0:
                    _add_loose_pcs(db, product, pool_key, leftover, variant_id=box_variant.variantId)
                product_locked.stock_quantity = max(0, (product_locked.stock_quantity or 0) - take)
                sources.append({
                    "source": "box", "variant_id": box_variant.variantId,
                    "box_size": box_size, "stock_used": take, "remainder_to_pool": leftover,
                })
            if remaining <= 0:
                break

    db.add(product_locked)

    if remaining > 0:
        raise ValueError(
            f"Insufficient stock for '{variant.name or product.name}'. "
            f"Short by {remaining} piece(s) (checked across shared pack sizes, including sealed boxes)."
        )

    if line_item_dict is not None:
        line_item_dict["stock_sources"] = sources


def _restore_packaged_stock_pooled(
    db: Session,
    product: Product,
    variant: Optional[Variant],
    qty_pieces: float,
    line_item_dict: Optional[dict] = None,
    pool_key: Optional[str] = None,
) -> None:
    """Reverses _deduct_packaged_stock_pooled. Replays the exact recorded
    stock_sources: puts loose takes back where they came from, and re-seals
    each opened box (restores its variant's stock_quantity by the box's full
    size, removing exactly the leftover that opening it added to the pool —
    not a flat re-take, since other sales may have drawn the pool down
    further since). Falls back to a flat restore onto `variant` alone for
    legacy data predating this (or predating pooling entirely) and for a
    variantless product."""
    sources = (line_item_dict or {}).get("stock_sources")
    if not sources:
        _restore_simple_stock(db, product, variant, qty_pieces)
        return

    if pool_key is None and variant:
        pool_key = compute_pool_key(db, variant)
    product_locked = _lock_product(db, product)

    for s in sources:
        src_type = s.get("source")
        stock_used = round(s.get("stock_used", 0))

        if src_type == "loose_variant":
            v = db.get(Variant, s.get("variant_id"))
            if v and stock_used:
                v.stock_quantity += stock_used
                db.add(v)
        elif src_type == "loose_pool":
            if stock_used > 0 and pool_key is not None:
                _add_loose_pcs(db, product, pool_key, stock_used)
        elif src_type == "box":
            box_variant = db.get(Variant, s.get("variant_id"))
            box_size = round(s.get("box_size", 0))
            remainder = round(s.get("remainder_to_pool", 0))
            if box_variant and box_size > 0:
                locked = _lock_variant(db, box_variant)
                locked.stock_quantity += box_size
                db.add(locked)
            if remainder > 0 and pool_key is not None:
                _remove_loose_pcs(db, product, pool_key, remainder)
        else:
            # Legacy shape predating the box-opening model — {"variant_id", "stock_used"}
            v = db.get(Variant, s.get("variant_id"))
            if v and stock_used:
                v.stock_quantity += stock_used
                db.add(v)

        if stock_used:
            product_locked.stock_quantity = (product_locked.stock_quantity or 0) + stock_used

    db.add(product_locked)


# ── Offcut best-fit algorithm ─────────────────────────────────────────────────

def _is_scrap_1d(length: float, variant: Optional[Variant]) -> bool:
    """1D (bar/profile) analogue of glassOffcutService._is_scrap — classifies a
    remainder as unsellable scrap if it falls below this variant's configured
    minimum usable length (Variant.min_usable, e.g. 2ft for a typical profile
    bar). Recorded as a scrap-status Offcut (kept for waste reporting only,
    never offered as a pickable offcut — see _upsert_offcut/the Offcut.status
    docstring) rather than silently discarded, mirroring the 2D behavior."""
    m = (variant.min_usable if variant else None) or 0.0
    return length < m


def _fulfill_one_cut_via_best_fit(
    db: Session,
    product: Product,
    variant: Optional[Variant],
    required_length: float,
    full_length: float,
    item_id: Optional[int] = None,
    pool_key: Optional[str] = None,
) -> dict:
    """
    Fulfil a single cut of required_length:
      1. Find the shortest available offcut that is >= required_length.
      2. If found  → consume it, create a remainder offcut if significant.
      3. If not    → consume 1 whole from stock, create a remainder offcut.

    Returns a single source dict (same shape as an offcut_sources entry).
    Raises ValueError if required_length exceeds full_length and no offcut fits.

    `item_id` identifies the OrderItem this cut belongs to — any remainder gets
    tagged with it (Offcut.source_item_id), and if the offcut actually consumed
    was itself still awaiting cutting confirmation, the returned dict carries a
    `pending_source_notice` (advisory only — see the 2D equivalent in
    glassOffcutService._apply_candidate).

    `pool_key` scopes the offcut search to every variant sharing the same
    non-size attributes (see core/inventory/poolKey.py), not just this exact
    variant — callers in a hot loop should compute it once and pass it down;
    left None (e.g. a direct/test call) it's computed here from `variant`.
    """
    if pool_key is None:
        pool_key = compute_pool_key(db, variant)

    stmt = (
        select(Offcut)
        .where(
            Offcut.product_id == product.productId,
            Offcut.status == "available",
            Offcut.length >= required_length,
            Offcut.quantity > 0,
            Offcut.pool_key == pool_key,
        )
        .order_by(Offcut.length.asc())  # smallest fit first → least waste
        .with_for_update()  # prevent two concurrent cuts from claiming the same offcut
    )

    best_offcut = db.exec(stmt).first()

    if best_offcut:
        # ── Use the offcut ────────────────────────────────────────────────
        oc_id = best_offcut.offcutId
        oc_len = best_offcut.length
        notice = _pending_source_notice(db, best_offcut.source_item_id)
        best_offcut.quantity -= 1
        remainder = round(oc_len - required_length, 4)
        if best_offcut.quantity == 0:
            db.delete(best_offcut)
        else:
            db.add(best_offcut)

        remainder_status = "scrap" if remainder > 0.01 and _is_scrap_1d(remainder, variant) else "available"
        if remainder > 0.01:
            _upsert_offcut(db, product, variant, remainder, source_item_id=item_id, pool_key=pool_key, status=remainder_status)

        result = {
            "source": "offcut",
            "offcut_id": oc_id,
            "offcut_length": oc_len,
            "length_used": required_length,
            "remainder_created": remainder if remainder > 0.01 else 0,
            "remainder_status": remainder_status if remainder > 0.01 else None,
        }
        if notice is not None:
            result["pending_source_notice"] = notice
        return result

    # ── No offcut fits — fall back to consuming a whole bar ────────────────
    if full_length <= 0:
        logger.warning(
            f"Product {product.productId} has no full length; "
            "deducting 1 whole without creating a remainder offcut."
        )
        _deduct_full_stock(db, product, variant, 1)
        return {
            "source": "full_bar",
            "offcut_id": None,
            "offcut_length": 0,
            "length_used": required_length,
            "remainder_created": 0,
            "remainder_status": None,
        }

    if required_length > full_length:
        raise ValueError(
            f"Cut length {required_length} exceeds full bar length {full_length} "
            f"for product '{product.name}'"
        )

    _deduct_full_stock(db, product, variant, 1)
    remainder = round(full_length - required_length, 4)
    remainder_status = "scrap" if remainder > 0.01 and _is_scrap_1d(remainder, variant) else "available"
    if remainder > 0.01:
        _upsert_offcut(db, product, variant, remainder, source_item_id=item_id, pool_key=pool_key, status=remainder_status)

    return {
        "source": "full_bar",
        "offcut_id": None,
        "offcut_length": full_length,
        "length_used": required_length,
        "remainder_created": remainder if remainder > 0.01 else 0,
        "remainder_status": remainder_status if remainder > 0.01 else None,
    }


def _process_cut_with_offcuts(
    db: Session,
    product: Product,
    variant: Optional[Variant],
    required_length: float,
    qty_cuts: int,
    full_length: float,
    line_item_dict: Optional[dict] = None,
    item_id: Optional[int] = None,
    pool_key: Optional[str] = None,
) -> None:
    """
    Best-fit algorithm for cut-piece deduction (only called when track_offcuts=True).
    Fulfils qty_cuts separate cuts of required_length, each via _fulfill_one_cut_via_best_fit.

    If line_item_dict is provided, records offcut_sources list into it for
    later restoration if the order is edited or cancelled.
    """
    if required_length <= 0:
        return

    if pool_key is None:
        pool_key = compute_pool_key(db, variant)

    sources = [
        _fulfill_one_cut_via_best_fit(db, product, variant, required_length, full_length, item_id, pool_key)
        for _ in range(qty_cuts)
    ]

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
    pool_key = compute_pool_key(db, variant)

    glass_cut_lines = [l for l in line_items if l.get("type", "") == "glass-cut" and int(l.get("qty", 0)) > 0]
    if glass_cut_lines and track:
        restore_glass_cut_lines(db, product, variant, glass_cut_lines)

    for line in line_items:
        l_type = line.get("type", "")
        qty = int(line.get("qty", 0))
        if qty <= 0:
            continue

        if l_type == "glass-cut":
            if not track:
                _restore_simple_stock(db, product, variant, qty)
            # else: already restored above via restore_glass_cut_lines
            continue

        if "full" in l_type:
            _restore_simple_stock(db, product, variant, qty)

        elif "half" in l_type:
            if full_len <= 0 or not track:
                _restore_simple_stock(db, product, variant, qty)
            else:
                sources = line.get("offcut_sources")
                if sources:
                    restore_specific_offcut_sources(db, product, variant, sources, pool_key)
                else:
                    for _ in range(qty):
                        _restore_simple_stock(db, product, variant, 1)
                        half_len = round(full_len / 2.0, 4)
                        _remove_offcut(db, product, variant, half_len, pool_key)

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
                    restore_specific_offcut_sources(db, product, variant, sources, pool_key)
                else:
                    # No source record (legacy) — fall back to full-bar assumption
                    for _ in range(qty):
                        _restore_simple_stock(db, product, variant, 1)
                        remainder = round(full_len - cut_len, 4)
                        if remainder > 0.01:
                            _remove_offcut(db, product, variant, remainder, pool_key)

        elif l_type == "accessory-pcs":
            _restore_packaged_stock_pooled(db, product, variant, qty, line, pool_key)

        elif "roll" in l_type or "meter" in l_type:
            _restore_simple_stock(db, product, variant, qty)

        elif "unit" in l_type:
            pieces_per_unit = (variant.unit_quantity if variant else None) or 1
            _restore_simple_stock(db, product, variant, qty * pieces_per_unit)

        else:
            _restore_simple_stock(db, product, variant, qty)


def _remove_offcut(db, product, variant, length: float, pool_key: Optional[str] = None) -> None:
    """Decrement (or delete) an offcut that was previously created as a remainder."""
    if pool_key is None:
        pool_key = compute_pool_key(db, variant)
    stmt = select(Offcut).where(
        Offcut.product_id == product.productId,
        Offcut.length >= length - 0.01,
        Offcut.length <= length + 0.01,
        Offcut.pool_key == pool_key,
    ).with_for_update()

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
    pool_key: Optional[str] = None,
) -> None:
    """
    Undo the exact offcut/stock consumption recorded in a cut line's offcut_sources.
    Called before applying a new manager-chosen set of sources, and by order
    cancel/edit to reverse a whole line's consumption. Restores every entry
    exactly as recorded, including ones a manager correction has marked
    `superseded` — see correct_profile_offcut_event's docstring: a superseded
    event still legitimately owns its own original consumption (only its
    remainder was ever corrected, never its source/offcut_id/length_used), so
    it needs restoring here exactly like any other event. A replacement event
    created alongside it is a fully separate, independent entry that gets
    restored on its own merits in the same pass.
    """
    if pool_key is None:
        pool_key = compute_pool_key(db, variant)

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
                        pool_key=pool_key,
                        length=oc_len,
                        quantity=1,
                    ))
        else:
            # Restore 1 whole bar to stock
            _restore_simple_stock(db, product, variant, 1)

        # Remove the remainder offcut that was created by this cut
        if remainder > 0.01:
            _remove_offcut(db, product, variant, remainder, pool_key)


def _consume_offcut_sources(
    db: Session,
    product: Product,
    variant: Optional[Variant],
    sources: list,
    item_id: Optional[int] = None,
    pool_key: Optional[str] = None,
) -> list:
    """
    Consume a list of caller-specified offcuts.  Uses SELECT FOR UPDATE to
    prevent concurrent double-use of the same offcut.

    sources: list of {"offcut_id": int, "length_used": float}
    Returns: list of recorded source dicts (same shape as offcut_sources).
    Raises ValueError if any offcut is unavailable or too short.
    """
    if pool_key is None:
        pool_key = compute_pool_key(db, variant)
    result = []
    for s in sources:
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

        notice = _pending_source_notice(db, locked.source_item_id)
        remainder = round(locked.length - length_used, 4)
        locked.quantity -= 1
        if locked.quantity == 0:
            db.delete(locked)
        else:
            db.add(locked)

        remainder_status = "scrap" if remainder > 0.01 and _is_scrap_1d(remainder, variant) else "available"
        if remainder > 0.01:
            _upsert_offcut(db, product, variant, remainder, source_item_id=item_id, pool_key=pool_key, status=remainder_status)

        entry = {
            "source": "offcut",
            "offcut_id": oc_id,
            "offcut_length": locked.length,
            "length_used": length_used,
            "remainder_created": remainder if remainder > 0.01 else 0,
            "remainder_status": remainder_status if remainder > 0.01 else None,
        }
        if notice is not None:
            entry["pending_source_notice"] = notice
        result.append(entry)

    return result


def apply_manual_cut_selection(
    db: Session,
    product: Product,
    variant: Optional[Variant],
    selected_sources: list,
    required_total_length: float,
    full_length: float,
    item_id: Optional[int] = None,
    pool_key: Optional[str] = None,
) -> list:
    """
    Consume cashier-specified offcuts for a cut at order-creation time.
    selected_sources may fall short of required_total_length — any shortfall
    is fulfilled the same way as the automatic path (_fulfill_one_cut_via_best_fit):
    an existing offcut that fits the shortfall (exact or larger) is used first;
    only if none fits does it fall back to a fresh full bar.

    selected_sources: list of {"offcut_id": int, "length_used": float}
    Returns: list of recorded source dicts (same shape as offcut_sources).
    Raises ValueError if over-selected, an offcut is unavailable, or the
    shortfall can't be covered by a single fresh bar.
    """
    if pool_key is None:
        pool_key = compute_pool_key(db, variant)

    selected_total = sum(float(s["length_used"]) for s in selected_sources)
    if selected_total > required_total_length + 0.02:
        raise ValueError(
            f"Selected offcut lengths ({selected_total:.2f} ft) exceed "
            f"the required cut ({required_total_length:.2f} ft)"
        )

    result = _consume_offcut_sources(db, product, variant, selected_sources, item_id, pool_key)

    shortfall = round(required_total_length - selected_total, 4)
    if shortfall > 0.01:
        result.append(_fulfill_one_cut_via_best_fit(db, product, variant, shortfall, full_length, item_id, pool_key))

    return result


def _upsert_offcut(
    db: Session,
    product: Product,
    variant: Optional[Variant],
    length: float,
    source_item_id: Optional[int] = None,
    pool_key: Optional[str] = None,
    status: str = "available",
) -> None:
    """
    Create a new offcut record or increment the quantity if one of the
    same length (±1mm tolerance) already exists IN THE SAME POOL (see
    core/inventory/poolKey.py — every variant sharing the same non-size
    attributes as `variant`, not just `variant` itself).

    `source_item_id` tags which OrderItem's cutting job produced this remainder
    (see the 2D equivalent, glassOffcutService._upsert_glass_offcut, for the full
    merge-policy rationale — overwritten on merge only when a real id is given).

    `status` — callers pass "scrap" (via _is_scrap_1d) for a remainder below the
    variant's min_usable threshold so it's tracked for waste reporting but never
    offered as a pickable offcut; a merge onto an existing row never changes its
    status since same length + same variant's threshold always classifies the
    same way.
    """
    if pool_key is None:
        pool_key = compute_pool_key(db, variant)

    stmt = select(Offcut).where(
        Offcut.product_id == product.productId,
        Offcut.length >= length - 0.001,
        Offcut.length <= length + 0.001,
        Offcut.pool_key == pool_key,
    ).with_for_update()

    existing = db.exec(stmt).first()
    if existing:
        existing.quantity += 1
        if source_item_id is not None:
            existing.source_item_id = source_item_id
        db.add(existing)
    else:
        db.add(Offcut(
            product_id=product.productId,
            variant_id=variant.variantId if variant else None,
            pool_key=pool_key,
            length=length,
            quantity=1,
            status=status,
            source_item_id=source_item_id,
        ))


# ── Manager-facing correction (1D analogue of glassOffcutService.correct_glass_offcut_event) ──

def correct_profile_offcut_event(
    db: Session,
    product: Product,
    variant: Optional[Variant],
    event: dict,
    new_remainder_length: float,
    replace_source: bool,
    forced_offcut_id: Optional[int] = None,
) -> dict:
    """
    Manager-facing correction for a single 1D (bar/profile) offcut_sources entry
    — the 1D analogue of glassOffcutService.correct_glass_offcut_event, mirroring
    its shape exactly: two independent corrections, the remainder edit always
    applied, source replacement layered on top only if asked for.

      - remainder correction (always applied): reverses the remainder THIS
        event recorded (_remove_offcut) and records new_remainder_length
        instead (_upsert_offcut) — 0 means nothing usable was left (e.g. the
        source was damaged). The event's own source/offcut_id/length_used
        fields are NEVER touched here, exactly like glass never touches an
        event's own source/offcut_id when correcting remainders_created —
        this is the ONLY way material from the original source re-enters the
        pool. If replace_source below also says length_used didn't really
        come from here, the manager is trusted to type what the source
        actually still is — e.g. its full original offcut_length if none of
        it was really used, or something smaller if it was partly damaged.

      - source replacement (replace_source=True): length_used didn't actually
        come from the recorded source — resolves a fresh, INDEPENDENT
        consumption of that same length from the CURRENT pool
        (forced_offcut_id, or the normal best-fit pick if not given — same
        forced-then-fallback shape as apply_manual_cut_selection) and returns
        it as a separate replacement event, exactly like glass's
        resolve_replacement_pieces for a failed cut. Crucially, this function
        never reverses/restores the original event's own source consumption
        first — unlike a restore-then-refill approach, there's nothing to
        exclude from the search: the original source was never put back in
        the pool to begin with, so the replacement pick can't trivially
        re-select the very thing it's replacing. The original event is
        marked superseded=True purely to block a SECOND replace_source call
        from supplying length_used twice over — it still legitimately owns
        its own original consumption (now with the corrected remainder above)
        and is restored completely normally, like any other event, if the
        order is later cancelled or edited.

    Returns {"before": <snapshot of the event's own fields beforehand>,
    "after": <the event's own fields afterward>, "replacement_event": <new
    offcut_sources-shaped dict, or None>}.
    """
    if "cuts" in event or "remainders_created" in event:
        raise ValueError("This cutting event isn't a correctable 1D profile-cut event")
    if replace_source and event.get("superseded"):
        raise ValueError("This cutting event's cut has already been replaced by an earlier correction")
    if new_remainder_length < 0:
        raise ValueError("Corrected remainder length must be zero or positive")

    before = {
        "source": event.get("source"), "offcut_id": event.get("offcut_id"),
        "offcut_length": event.get("offcut_length"), "length_used": event.get("length_used"),
        "remainder_created": event.get("remainder_created", 0),
        "remainder_status": event.get("remainder_status"),
    }

    # ── Remainder correction — always applied ───────────────────────────────
    old_remainder = float(event.get("remainder_created", 0) or 0)
    if old_remainder > 0.01:
        _remove_offcut(db, product, variant, old_remainder)
    new_remainder = round(float(new_remainder_length), 4)
    new_remainder_status = "scrap" if new_remainder > 0.01 and _is_scrap_1d(new_remainder, variant) else "available"
    if new_remainder > 0.01:
        _upsert_offcut(db, product, variant, new_remainder, status=new_remainder_status)
    event["remainder_created"] = new_remainder if new_remainder > 0.01 else 0
    event["remainder_status"] = new_remainder_status if new_remainder > 0.01 else None

    if not replace_source:
        return {"before": before, "after": dict(event), "replacement_event": None}

    # ── Source replacement — independent of the remainder edit above ────────
    length_used = float(event.get("length_used", 0))
    full_length = _get_full_length(product, variant)

    if forced_offcut_id is not None:
        replacement_event = _consume_offcut_sources(
            db, product, variant, [{"offcut_id": forced_offcut_id, "length_used": length_used}],
        )[0]
    else:
        replacement_event = _fulfill_one_cut_via_best_fit(db, product, variant, length_used, full_length)

    event["superseded"] = True

    return {"before": before, "after": dict(event), "replacement_event": replacement_event}
