/** Who a provisional offcut waits on, for display: "Window 1 (alice), Window 2 (bob)".
 * `windows`: [{orderId, window, cashier}] from the API's `provisional` field. */
export const provisionalLabel = (windows) =>
    (windows || []).map(w => `${w.window || 'an open sale'}${w.cashier ? ` (${w.cashier})` : ''}`).join(', ');
