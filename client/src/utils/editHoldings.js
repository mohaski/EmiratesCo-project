/**
 * Editing a saved order: how much of THIS variant the item being edited already holds.
 *
 * The calculators' instant stock checks compare the quantity asked for with current stock,
 * but an edit gives the item's own units back before taking the new quantity (update_order
 * reverses a changed item first). Without adding them back, reducing 5 boxes to 3 when only
 * 1 is left on the shelf was refused - and even reopening the item unchanged was.
 *
 * Only while editing a saved item (details._sourceItemId, set by SalesDashboard in edit mode)
 * and only for the same variant: a different variant's units don't come back into this one.
 *
 *   types        line types to count (e.g. ['profile-full']); omitted -> the item's own `qty`
 *                (Standard / Dynamic calculators, which have no typed lines)
 *   perLine(l)   units each line unit is worth (e.g. a box's pieces), default 1
 */
export function heldByEditedItem(initialDetails, variantId, types = null, perLine = null) {
    if (!initialDetails?._sourceItemId) return 0;
    const saved = initialDetails._source || initialDetails;
    if (String(saved.variantId ?? '') !== String(variantId ?? '')) return 0;
    if (!types) return Number(saved.qty) || 0;
    return (saved.lineItems || [])
        .filter(l => l && types.includes(l.type))
        .reduce((sum, l) => sum + (Number(l.qty) || 0) * (perLine ? perLine(l) : 1), 0);
}
