import { useEffect, useState, useCallback } from 'react';
import api from '../../services/api';
import { wsEvents } from '../../utils/wsEvents';
import { useWindows } from '../../context/WindowContext';
import { useProducts } from '../../context/ProductContext';
import { parseServerDate } from '../../utils/dates';
import { provisionalLabel } from '../../utils/provisional';

/**
 * Managers: what open sale windows are holding right now. A window's stock is really
 * deducted while its customer pays, so a figure here can look low without anything being
 * wrong - this says so, and by whom, before anyone "corrects" it.
 */
export default function HeldStockBanner() {
    const { enabled } = useWindows();
    const { products } = useProducts();
    const [holds, setHolds] = useState([]);
    // Provisional offcuts (switch on): leftovers of bars open sales haven't paid for. They are
    // in the offcut pool but NOT on the rack - the bar is still whole - so a count must not
    // "find" them. Empty while the switch is off.
    const [paper, setPaper] = useState([]);
    const [open, setOpen] = useState(false);

    const load = useCallback(() => {
        if (!enabled) return; // nothing is shown while windows are off
        api.windowService.holds().then(setHolds).catch(() => {});
        api.windowService.provisionalOffcuts().then(setPaper).catch(() => {});
    }, [enabled]);

    useEffect(() => {
        load();
        const offs = [wsEvents.on('windows_updated', load), wsEvents.on('products_updated', load)];
        return () => offs.forEach(off => off());
    }, [load]);

    if (!enabled || (holds.length === 0 && paper.length === 0)) return null;
    const nameOf = (h) => {
        const p = products.find(x => x.id === h.productId);
        const v = p?.variants?.find(x => (x.variantId ?? x.id) === h.variantId);
        return [p?.name ?? `Product ${h.productId}`, v?.name].filter(Boolean).join(' · ');
    };
    const what = (h) => (h.lineItems?.length
        ? h.lineItems.map(l => l.label || `${l.qty} × ${l.type}`).join(', ')
        : `${h.quantity ?? ''} ${h.unitType ?? ''}`.trim());
    const windowsCount = new Set(holds.map(h => h.windowId)).size;

    return (
        <div data-held-stock style={{
            margin: '0.75rem clamp(1rem, 5vw, 2rem) 0', padding: '0.625rem 0.875rem', borderRadius: '0.75rem',
            background: 'rgba(59,130,246,0.08)', border: '1px solid rgba(59,130,246,0.3)', color: '#93c5fd', fontSize: '0.78rem',
        }}>
            <button onClick={() => setOpen(o => !o)} style={{
                background: 'none', border: 'none', color: 'inherit', cursor: 'pointer', padding: 0,
                fontWeight: 700, fontSize: '0.78rem', textAlign: 'left',
            }}>
                {open ? '▾' : '▸'} {holds.length} item{holds.length === 1 ? '' : 's'} held in {windowsCount} open sale{windowsCount === 1 ? '' : 's'} -
                {' '}this stock is reserved for customers who are paying, not missing.
                {paper.length > 0 && ` ${paper.length} provisional offcut${paper.length === 1 ? '' : 's'} not cut yet.`}
            </button>
            {open && (
                <ul style={{ margin: '0.5rem 0 0', paddingLeft: '1.25rem', color: '#cbd5e1' }}>
                    {holds.map((h, i) => (
                        <li key={`${h.windowId}-${i}`}>
                            {nameOf(h)}: {what(h)} - {h.cashier}, {h.label}
                            {h.expiresAt ? ` (released by ${parseServerDate(h.expiresAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })} if idle)` : ''}
                        </li>
                    ))}
                    {paper.map(r => (
                        <li key={`p${r.offcutId}`} data-provisional-offcut>
                            {nameOf(r)}: {r.quantity > 1 ? `${r.quantity} × ` : ''}{r.length} offcut - provisional, only on paper
                            {' '}until {provisionalLabel(r.windows) || 'an open sale'} pays (the bar is still whole on the rack)
                        </li>
                    ))}
                </ul>
            )}
        </div>
    );
}
