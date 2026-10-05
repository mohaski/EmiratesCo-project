import { useEffect, useState } from 'react';

/**
 * Sale-window constants and helpers, shared by WindowContext, the window tabs and checkout.
 * Kept out of the component files so those only export components/hooks (React fast refresh).
 * The limits mirror the server (core/ordering/windowService.py), which enforces them.
 */
export const WINDOW_LIMIT = 3;
export const IDLE_MINUTES = 15;
export const WARN_SECONDS = 120;

/** A stored window item back into the request shape a cart save takes. */
export const windowItemToRequest = (i) => ({
    productId: i.productId,
    variantId: i.variantId ?? null,
    quantity: i.quantity,
    unitPrice: i.unitPrice ?? 0,
    unitType: i.unitType ?? 'pcs',
    details: i.details ?? {},
});

/** Seconds until the server releases this window, counted down locally between syncs. */
export const secondsLeftOf = (w, now = Date.now()) =>
    w ? Math.max(0, Math.round(w.secondsLeft - (now - (w._syncedAt ?? now)) / 1000)) : 0;

export const formatCountdown = (seconds) => {
    const m = Math.floor(seconds / 60);
    const s = seconds % 60;
    return `${m}:${String(s).padStart(2, '0')}`;
};

/** Re-render every second, for the countdowns. */
export function useNow(intervalMs = 1000) {
    const [now, setNow] = useState(() => Date.now());
    useEffect(() => {
        const t = setInterval(() => setNow(Date.now()), intervalMs);
        return () => clearInterval(t);
    }, [intervalMs]);
    return now;
}
