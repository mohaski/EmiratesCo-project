"""
Pool-key computation shared by the 1D (inventoryService), 2D (glassOffcutService)
offcut engines, the manager-facing offcut endpoints (products/service.py), and
boxed/pcs accessory stock pooling.

An offcut, or a unit of packaged stock, is physically the same material/item
regardless of which SKU (variant) it happens to be recorded against — what
actually varies between pooled variants is only the attribute that generates a
*size* or *sale-unit* difference, never the item's own identity:

  - profile/accessory "Length" (a per-product custom attribute — 5.8m vs 6m bar,
    or a rubber roll's cut length) -> variant.length / variant.unit_quantity
  - glass "Dimensions" (built-in, only for has_dimensions=True products — sheet
    L x W) -> variant.length / variant.width
  - an accessory's pack-size ("Unit": Box / Pcs / "1000pcs", a custom attribute)
    -> variant.unit_quantity

By default these are identified automatically: "Dimensions" is a hardcoded
name, and everything else that carries a size/quantity is exactly whichever
attribute class has type == "custom" (see AddProductPage.jsx's
buildGeneratedVariants, which is what feeds these into a variant's
length/width/unit_quantity in the first place — "list"-type attributes like
Color/Thickness/Finish never do). So by default the pool key is every variant
attribute EXCEPT "Dimensions" and EXCEPT any custom-typed one.

A product can override this automatic rule explicitly via
Product.pool_ignored_attributes (set at product-creation time, in
AddProductPage's Attributes step — see that file) — a literal list of which of
THIS product's own attributes to ignore for pooling. None (the default for any
product created before this existed) keeps the automatic rule; a product that
has ever had this configured always uses its own explicit list from then on,
even if that list is empty (meaning "pool by every attribute" — every distinct
combination is its own pool).
"""
from typing import Dict, List, Optional

from sqlmodel import Session, select

from entities.attributes import AttributeClass
from entities.products import Product
from entities.variants import Variant

_SIZE_ATTRIBUTE_KEYS = {"Dimensions"}


def load_attribute_types(db: Session) -> Dict[str, str]:
    """{attribute class name: 'list' | 'custom'} — one small query (attribute_classes
    is never more than a handful of rows), safe to call once per top-level operation."""
    return {ac.name: ac.type for ac in db.exec(select(AttributeClass)).all()}


def pool_key_from_attributes(
    attributes: Optional[dict],
    attribute_types: Dict[str, str],
    pool_ignored_attributes: Optional[List[str]] = None,
) -> str:
    """Canonical key grouping variants that share every attribute except the
    ignored one(s) — explicit ignore list if given (see Product.pool_ignored_attributes),
    otherwise the automatic size/sale-unit rule. Empty string for no attributes, or a
    variant with nothing left after filtering — both mean "nothing distinguishes this
    from any other variant of the same product", which is a single shared pool."""
    if not attributes:
        return ""
    if pool_ignored_attributes is not None:
        ignored = set(pool_ignored_attributes)
        identity = {k: str(v) for k, v in attributes.items() if k not in ignored}
    else:
        identity = {
            k: str(v) for k, v in attributes.items()
            if k not in _SIZE_ATTRIBUTE_KEYS and attribute_types.get(k) != "custom"
        }
    if not identity:
        return ""
    return "|".join(f"{k}={identity[k]}" for k in sorted(identity))


def compute_pool_key(db: Session, variant: Optional[Variant]) -> str:
    """Convenience wrapper for standalone/one-off call sites. Callers that
    compute this repeatedly in a loop (e.g. once per cut) should call
    load_attribute_types(db) + the variant's product once themselves and pass
    pool_key_from_attributes' result down instead — see inventoryService.py /
    glassOffcutService.py, which thread the resulting pool_key through their
    helpers rather than recomputing it per cut."""
    if not variant:
        return ""
    product = db.get(Product, variant.product_id)
    pool_ignored = product.pool_ignored_attributes if product else None
    return pool_key_from_attributes(variant.attributes, load_attribute_types(db), pool_ignored)


def pool_sibling_variants(db: Session, variant: Variant, pool_key: Optional[str] = None) -> List[Variant]:
    """Other variants of the same product sharing `variant`'s pool — used for
    boxed/pcs accessory stock pooling (a Box-of-100 and a Single-pcs variant of
    the same White gasket draw from one combined stock pool). Excludes `variant`
    itself. Returns [] for a variant whose product only has one variant."""
    attribute_types = load_attribute_types(db)
    product = db.get(Product, variant.product_id)
    pool_ignored = product.pool_ignored_attributes if product else None
    if pool_key is None:
        pool_key = pool_key_from_attributes(variant.attributes, attribute_types, pool_ignored)
    candidates = db.exec(
        select(Variant).where(
            Variant.product_id == variant.product_id,
            Variant.variantId != variant.variantId,
        )
    ).all()
    return [v for v in candidates if pool_key_from_attributes(v.attributes, attribute_types, pool_ignored) == pool_key]
