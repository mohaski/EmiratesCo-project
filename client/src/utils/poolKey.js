// Mirrors server/core/inventory/poolKey.py — groups variants that are
// physically the same item into one pool for offcut/stock purposes, ignoring
// whichever attribute only varies a variant's SIZE or SALE UNIT: glass
// "Dimensions" (built-in), or any attribute class of type "custom" — profile's
// per-product "Length" values (5.8m/6m), an accessory's pack-size "Unit"
// values (Box/Pcs, "1000pcs") — see AddProductPage's buildGeneratedVariants,
// which is what feeds these into a variant's length/width/unitQuantity in the
// first place. "list"-type attributes (Color, Thickness, Finish...) are never
// size-carrying, so they're always part of the pool identity.
//
// A product can override this automatic rule explicitly via its own
// poolIgnoredAttributes (set at product-creation time — see AddProductPage's
// Attributes step): null/undefined keeps the automatic rule; an explicit list
// (even []) always wins from then on — mirrors
// server/core/inventory/poolKey.py's pool_key_from_attributes exactly.
const SIZE_ATTRIBUTE_KEYS = new Set(['Dimensions']);

export function computePoolKey(attributes, attributeTypesMap, poolIgnoredAttributes = null) {
    if (!attributes) return '';
    const ignored = poolIgnoredAttributes != null ? new Set(poolIgnoredAttributes) : null;
    const identity = Object.entries(attributes)
        .filter(([k]) => ignored ? !ignored.has(k) : (!SIZE_ATTRIBUTE_KEYS.has(k) && attributeTypesMap[k] !== 'custom'))
        .map(([k, v]) => [k, String(v)])
        .sort(([a], [b]) => a.localeCompare(b));
    if (identity.length === 0) return '';
    return identity.map(([k, v]) => `${k}=${v}`).join('|');
}

// Other variants of the same product sharing `variant`'s pool — excludes
// `variant` itself. `variants` should be the full variant list of one product.
export function poolSiblings(variants, variant, attributeTypesMap, poolIgnoredAttributes = null) {
    if (!variant) return [];
    const key = computePoolKey(variant.attributes, attributeTypesMap, poolIgnoredAttributes);
    return variants.filter(v => v !== variant && computePoolKey(v.attributes, attributeTypesMap, poolIgnoredAttributes) === key);
}

// Total stock available to `variant`, in `variant`'s own sale unit (e.g.
// boxes), pooled across sibling variants. Every variant's `stock` is already
// tracked in individual pieces (see server/entities/variants.py) — pooling is
// a plain sum; `variant.unitQuantity` only converts the pooled total back into
// `variant`'s own pack size for display/comparison. e.g. a Box-of-100 and a
// Single-pcs variant of the same White gasket share one combined piece pool.
export function pooledAvailableInOwnUnit(variants, variant, attributeTypesMap, poolIgnoredAttributes = null) {
    if (!variant) return 0;
    const factor = variant.unitQuantity || 1;
    const siblings = poolSiblings(variants, variant, attributeTypesMap, poolIgnoredAttributes);
    const pooledPieces = [variant, ...siblings].reduce((sum, v) => sum + (v.stock || 0), 0);
    return pooledPieces / factor;
}
