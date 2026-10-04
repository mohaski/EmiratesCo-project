/**
 * Cart item -> the OrderItemRequest shape the order endpoints take.
 *
 * Shared by OrderContext (create / edit submit) and CheckoutPage (the edit-time reversal
 * plan preview). They MUST produce the same payload: the backend matches an edited cart
 * against the stored order by comparing exactly these fields (orderService._stock_signature),
 * so if the preview and the real submit disagreed, the operator would be asked about one
 * set of lines while a different set was actually reversed.
 *
 * Kept out of OrderContext.jsx so that file only exports components/hooks (React fast
 * refresh requires it).
 */
// Cart-only state: the cut answers given in the calculator (CheckoutPage reads them from the
// cart). `_sourceItemId` - which saved item the line came from - IS sent: the server pairs
// the line with that item, which matters when an order has two identical items.
const stripUiKeys = (details) => {
    if (!details || typeof details !== 'object') return details;
    if (!('cutAnswers' in details) && !('_source' in details)) return details;
    const { cutAnswers, _source, ...rest } = details; // eslint-disable-line no-unused-vars
    return rest;
};

export const mapItemForBackend = (item) => {
    // DynamicCalculator items carry their quantity only in details.qty (no top-level qty,
    // no lineItems), and the server prices and deducts a line-item-less item by its
    // quantity — so falling back to 1 charged and deducted one unit whatever was entered.
    // Only for those items: a calculator with lineItems keeps quantity 1 per line, and a
    // reopened saved item has its top-level qty, which still wins.
    const dynamic = !!item.details?.isDynamic && !item.details?.lineItems;
    const rawQty = parseFloat(item.qty || item.quantity || (dynamic ? item.details?.qty : undefined));
    const qty = isNaN(rawQty) ? 1 : rawQty;

    // Same items have no unit price either; without one the server falls back to the price
    // sent (0) whenever the product has no matching variant.
    let rawPrice = parseFloat(item.price || item.unitPrice);
    if (isNaN(rawPrice) && dynamic && qty > 0) rawPrice = (parseFloat(item.totalPrice) || 0) / qty;
    const price = isNaN(rawPrice) ? 0 : rawPrice;

    const rawVariantId = item.variantId ?? item.details?.variantId ?? null;

    return {
        productId: parseInt(item.productId || item.id),
        variantId: rawVariantId ? parseInt(rawVariantId) : null,
        quantity: qty,
        unitPrice: price,
        unitType: item.unit || 'pcs',
        details: stripUiKeys(item.details),
    };
};

// Keys a calculator adds for its own bookkeeping — they change when an item is merely
// reopened, without the goods changing.
const VOLATILE_DETAIL_KEYS = new Set(['cutAnswers', '_source', '_sourceItemId', 'isValid', 'checkingStock', 'stockError', 'missingAttributes']);
const stable = (value) => {
    if (Array.isArray(value)) return value.map(stable);
    if (value && typeof value === 'object') {
        return Object.keys(value).sort().filter(k => !VOLATILE_DETAIL_KEYS.has(k))
            .reduce((acc, k) => { acc[k] = stable(value[k]); return acc; }, {});
    }
    return value;
};

/** What an order edit would change: the goods (as sent to the server, prices excluded —
 * the server reprices), the customer, VAT and the discount. Two equal signatures mean
 * saving would change nothing. */
export const editSignature = (items, { customerId = null, vat = false, discount = 0 } = {}) => JSON.stringify({
    items: (items || []).map(mapItemForBackend).map(i => stable({ ...i, unitPrice: undefined })),
    customerId: customerId ?? null,
    vat: !!vat,
    discount: Number(discount) || 0,
});
