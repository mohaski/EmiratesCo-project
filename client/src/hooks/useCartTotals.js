import { useMemo } from 'react';

export const useCartTotals = (cartItems, taxEnabled = true) => {
    return useMemo(() => {
        // 1. Calculate raw subtotal
        const rawSubtotal = cartItems.reduce((sum, item) => sum + (item.totalPrice || 0), 0);

        // 2. Define Tax Rate (Centralized Configuration)
        const TAX_RATE = 0.16; // 16% VAT

        // 3. Calculate Tax
        const taxAmount = taxEnabled ? rawSubtotal * TAX_RATE : 0;

        // 4. Calculate Grand Total
        const grandTotal = rawSubtotal + taxAmount;

        return {
            subtotal: rawSubtotal,
            tax: taxAmount,
            total: grandTotal,
            // Pre-formatted strings for consistent UI display
            displaySubtotal: rawSubtotal.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 }),
            displayTax: taxAmount.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 }),
            displayTotal: grandTotal.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 }),
            count: cartItems.length,
            isEmpty: cartItems.length === 0
        };
    }, [cartItems, taxEnabled]);
};