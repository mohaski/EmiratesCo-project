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
    const rawQty = parseFloat(item.qty || item.quantity);
    const qty = isNaN(rawQty) ? 1 : rawQty;

    const rawPrice = parseFloat(item.price || item.unitPrice);
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
