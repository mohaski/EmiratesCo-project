import { useMemo } from 'react';
import { ceilAmount } from '../utils/money';

export const useCartTotals = (cartItems, taxEnabled = true) => {
    return useMemo(() => {
        // 1. Calculate raw subtotal — each item's price is ceiled to a whole
        // KSH before summing, so the subtotal matches the backend's per-item rounding.
        const rawSubtotal = cartItems.reduce((sum, item) => sum + ceilAmount(item.totalPrice || 0), 0);

        // 2. Define Tax Rate (Centralized Configuration)
        const TAX_RATE = 0.16; // 16% VAT

        // 3. Calculate Tax
        const taxAmount = taxEnabled ? ceilAmount(rawSubtotal * TAX_RATE) : 0;

        // 4. Calculate Grand Total
        const grandTotal = rawSubtotal + taxAmount;

        return {
            subtotal: rawSubtotal,
            tax: taxAmount,
            total: grandTotal,
            // Pre-formatted strings for consistent UI display — whole KSH, no cents
            displaySubtotal: rawSubtotal.toLocaleString(),
            displayTax: taxAmount.toLocaleString(),
            displayTotal: grandTotal.toLocaleString(),
            count: cartItems.length,
            isEmpty: cartItems.length === 0
        };
    }, [cartItems, taxEnabled]);
};