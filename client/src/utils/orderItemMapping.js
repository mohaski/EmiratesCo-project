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
// Same for a sale-window line's `_heldItemId` / `_heldSource` (which held item it is, and what
// it holds - so a calculator reopening it counts that stock as its own): the server rebuilds
// a window's cart from the lines themselves, never by item id.
const stripUiKeys = (details) => {
    if (!details || typeof details !== 'object') return details;
    if (!('cutAnswers' in details) && !('_source' in details) && !('_heldItemId' in details) && !('_heldSource' in details)) return details;
    const { cutAnswers, _source, _heldItemId, _heldSource, ...rest } = details; // eslint-disable-line no-unused-vars
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
const VOLATILE_DETAIL_KEYS = new Set(['cutAnswers', '_source', '_sourceItemId', '_heldItemId', 'isValid', 'checkingStock', 'stockError', 'missingAttributes']);
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

/**
 * A stored order item (OrderItemResponse — from an order being edited, or an open sale
 * window) -> the cart-item shape the sales screen, checkout and receipt work with.
 *
 * Everything that drives stock and price lives in `details`, which the server stores as
 * sent (plus its own bookkeeping), so this is lossless for the parts that matter; the name
 * and category come from the product catalogue. `totalPrice` is the SERVER's price — what
 * the sale will actually be charged.
 */
export const mapStoredItemToCart = (backendItem, products = [], { held = false } = {}) => {
    const saved = backendItem.details || {};
    // A sale window's line holds its stock already: remember which item and what it holds, so
    // reopening it counts those units as available to it (utils/editHoldings).
    const details = held && backendItem.itemId
        ? {
            ...saved,
            _heldItemId: backendItem.itemId,
            _heldSource: {
                variantId: backendItem.variantId ?? saved.variantId ?? null,
                qty: saved.qty ?? backendItem.quantity ?? null,
                lineItems: saved.lineItems || [],
            },
        }
        : saved;
    const productId = backendItem.productId ?? details.productId;
    const product = products.find(p => p.id === productId);
    return {
        id: productId,
        productId,
        name: product?.name ?? details.name ?? `Product #${productId}`,
        category: product?.category ?? null,
        totalPrice: backendItem.totalPrice ?? 0,
        unit: backendItem.unitType ?? details.unitType ?? 'pcs',
        qty: backendItem.quantity ?? details.quantity ?? 1,
        price: backendItem.unitPrice ?? details.unitPrice ?? 0,
        variantId: backendItem.variantId ?? details.variantId ?? null,
        details,
    };
};
