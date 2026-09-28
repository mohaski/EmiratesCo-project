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
        details: item.details,
    };
};

/**
 * A stored order item (OrderItemResponse — from an order being edited, or an open sale
 * window) -> the cart-item shape the sales screen, checkout and receipt work with.
 *
 * Everything that drives stock and price lives in `details`, which the server stores as
 * sent (plus its own bookkeeping), so this is lossless for the parts that matter; the name
 * and category come from the product catalogue. `totalPrice` is the SERVER's price — what
 * the sale will actually be charged.
 */
export const mapStoredItemToCart = (backendItem, products = []) => {
    const details = backendItem.details || {};
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
