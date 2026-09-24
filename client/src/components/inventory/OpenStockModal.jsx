import { useState, useEffect, useCallback } from 'react';
import api from '../../services/api';
import { useToast } from '../../context/ToastContext';
import { useProducts } from '../../context/ProductContext';
import { useAuth } from '../../context/AuthContext';
import OpenStockHistory from './OpenStockHistory';

/**
 * Manager panel for the open-container stock model.
 *
 * Some accessories come in packs whose real contents vary or can't be counted
 * -- a rubber roll runs long or short, a "box" of screws is bought by weight.
 * For those the system tracks whole SEALED packs and nothing below them (see
 * server/entities/openContainers.py), which leaves exactly two facts only a
 * human can supply: "I have broken a pack open" and "that pack is now empty".
 * This panel is where a manager supplies them.
 *
 * Until a pack is open, the sales screen refuses sub-pack sales of that item --
 * that refusal is the prompt that brings a manager here.
 */

const overlay = {
    position: 'fixed', inset: 0, background: 'rgba(3,7,18,0.75)', backdropFilter: 'blur(6px)',
    display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 200, padding: '1rem',
};
const panel = {
    background: '#0b1220', border: '1px solid rgba(255,255,255,0.09)', borderRadius: '1rem',
    width: '100%', maxWidth: '760px', maxHeight: 'min(88vh, calc(100dvh - 2rem))', display: 'flex', flexDirection: 'column',
    boxShadow: '0 24px 60px rgba(0,0,0,0.55)',
};
const card = {
    background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)',
    borderRadius: '0.75rem', padding: '0.875rem', marginBottom: '0.625rem',
};
const label = {
    fontSize: '0.62rem', fontWeight: 700, color: '#475569',
    letterSpacing: '0.08em', textTransform: 'uppercase',
};
const btn = (tone) => ({
    padding: '0.4rem 0.75rem', borderRadius: '0.5rem', fontSize: '0.72rem', fontWeight: 700,
    cursor: 'pointer', border: '1px solid', transition: 'all 0.15s', whiteSpace: 'nowrap',
    background: tone === 'green' ? 'rgba(34,197,94,0.15)'
        : tone === 'amber' ? 'rgba(251,191,36,0.12)'
            : 'rgba(255,255,255,0.05)',
    borderColor: tone === 'green' ? 'rgba(34,197,94,0.4)'
        : tone === 'amber' ? 'rgba(251,191,36,0.35)'
            : 'rgba(255,255,255,0.12)',
    color: tone === 'green' ? '#4ade80' : tone === 'amber' ? '#fbbf24' : '#94a3b8',
});

const variantLabel = (row) => row.variant_name || Object.values(row.attributes || {}).join(' - ') || 'Standard';

export default function OpenStockModal({ onClose }) {
    const showToast = useToast();
    const { refreshProducts } = useProducts();
    const { user } = useAuth();
    // History exposes per-pack revenue and the gap between what a pack yielded
    // and what was billed from it, so it matches the backend's own restriction
    // on /open-containers/utilization (openContainers/controller.py).
    const canSeeHistory = ['ceo', 'admin'].includes(user?.role);
    const [tab, setTab] = useState('open');
    const [openList, setOpenList] = useState([]);
    const [openable, setOpenable] = useState([]);
    const [loading, setLoading] = useState(true);
    const [busyId, setBusyId] = useState(null);
    // container id -> the measured yield the manager is typing while closing it.
    const [closingQty, setClosingQty] = useState({});

    const load = useCallback(async () => {
        setLoading(true);
        try {
            const [open, can] = await Promise.all([
                api.openContainerService.list('open'),
                api.openContainerService.listOpenable(),
            ]);
            setOpenList(open || []);
            setOpenable(can || []);
        } catch {
            // The api interceptor already toasts; leave the lists as they were.
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => { load(); }, [load]);

    // Every mutation changes stock_quantity or what the sales screen may sell,
    // so the shared product state has to be refreshed alongside this panel.
    const afterChange = useCallback(async () => {
        await Promise.all([load(), refreshProducts()]);
    }, [load, refreshProducts]);

    const handleOpen = async (row) => {
        if (row.has_open && !window.confirm(
            `A pack of ${row.product_name} (${variantLabel(row)}) is already open.\n\n`
            + 'Open a second one anyway? Sales will keep drawing from the older pack until it is marked finished.'
        )) return;
        setBusyId(`v${row.variant_id}`);
        try {
            await api.openContainerService.open(row.product_id, row.variant_id);
            showToast(`Opened 1 pack of ${row.product_name}`, 'success');
            await afterChange();
            setTab('open');
        } catch { /* toasted by the interceptor */ } finally { setBusyId(null); }
    };

    const handleClose = async (container) => {
        const typed = closingQty[container.id];
        const actual = typed === '' || typed == null ? null : parseFloat(typed);
        setBusyId(`c${container.id}`);
        try {
            await api.openContainerService.close(container.id, { actualQuantity: Number.isFinite(actual) ? actual : null });
            showToast('Pack marked finished', 'success');
            setClosingQty(prev => ({ ...prev, [container.id]: '' }));
            await afterChange();
        } catch { /* toasted */ } finally { setBusyId(null); }
    };

    const handleCancel = async (container) => {
        if (!window.confirm(
            'Return this pack to sealed stock?\n\n'
            + 'Only do this if it was opened by mistake and is still sealed.'
        )) return;
        setBusyId(`c${container.id}`);
        try {
            await api.openContainerService.cancel(container.id);
            showToast('Pack returned to sealed stock', 'success');
            await afterChange();
        } catch { /* toasted -- the backend refuses once units have been sold */ } finally { setBusyId(null); }
    };

    return (
        <div style={overlay} onClick={onClose}>
            <div style={panel} onClick={e => e.stopPropagation()}>
                {/* Header */}
                <div style={{ padding: '1.125rem 1.25rem', borderBottom: '1px solid rgba(255,255,255,0.07)' }}>
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '1rem', flexWrap: 'wrap' }}>
                        <div style={{ minWidth: 0 }}>
                            <h2 style={{ fontSize: '1.05rem', fontWeight: 800, color: '#f1f5f9', margin: 0 }}>Open Stock</h2>
                            <p style={{ fontSize: '0.72rem', color: '#475569', margin: '2px 0 0', fontWeight: 500 }}>
                                Rolls and boxes broken open for selling in units
                            </p>
                        </div>
                        <button onClick={onClose} style={{ ...btn(), padding: '0.35rem 0.6rem' }}>Close</button>
                    </div>

                    <div style={{ display: 'flex', gap: '4px', background: 'rgba(255,255,255,0.04)', borderRadius: '0.625rem', padding: '3px', marginTop: '0.875rem' }}>
                        {[
                            ['open', `Open (${openList.length})`],
                            ['openable', `Available (${openable.length})`],
                            ...(canSeeHistory ? [['history', 'History']] : []),
                        ].map(([key, text]) => (
                            <button key={key} onClick={() => setTab(key)} style={{
                                flex: 1, padding: '0.4rem 0', borderRadius: '0.4rem', border: 'none', cursor: 'pointer',
                                background: tab === key ? 'rgba(59,130,246,0.15)' : 'transparent',
                                color: tab === key ? '#60a5fa' : '#475569',
                                fontWeight: 700, fontSize: '0.72rem', transition: 'all 0.15s',
                            }}>{text}</button>
                        ))}
                    </div>
                </div>

                {/* Body */}
                <div style={{ flex: 1, overflowY: 'auto', padding: '1rem 1.25rem' }} className="custom-scrollbar">
                    {tab === 'history' ? (
                        <OpenStockHistory />
                    ) : loading ? (
                        <p style={{ color: '#475569', fontSize: '0.8rem', textAlign: 'center', padding: '2rem 0' }}>Loading…</p>
                    ) : tab === 'open' ? (
                        openList.length === 0 ? (
                            <p style={{ color: '#475569', fontSize: '0.8rem', textAlign: 'center', padding: '2rem 0' }}>
                                Nothing is open. Sub-unit sales of these items stay blocked until a pack is opened.
                            </p>
                        ) : openList.map(c => (
                            <div key={c.id} style={card}>
                                <div style={{ display: 'flex', justifyContent: 'space-between', gap: '0.75rem', flexWrap: 'wrap' }}>
                                    <div style={{ minWidth: 0 }}>
                                        <p style={{ fontSize: '0.85rem', fontWeight: 700, color: '#f1f5f9', margin: 0 }}>{c.product_name}</p>
                                        <p style={{ fontSize: '0.72rem', color: '#64748b', margin: '2px 0 0' }}>{variantLabel(c)}</p>
                                    </div>
                                    <div style={{ textAlign: 'right' }}>
                                        <p style={{ fontSize: '0.95rem', fontWeight: 800, color: '#4ade80', fontFamily: 'var(--font-mono)', margin: 0 }}>
                                            {(c.units_sold || 0).toLocaleString()} {c.unit || ''}
                                        </p>
                                        <p style={{ ...label, margin: '2px 0 0' }}>sold so far</p>
                                    </div>
                                </div>

                                <p style={{ fontSize: '0.68rem', color: '#475569', margin: '0.5rem 0 0' }}>
                                    Opened {c.opened_at ? new Date(c.opened_at).toLocaleString() : '—'}
                                    {c.opened_by_name ? ` by ${c.opened_by_name}` : ''}
                                    {c.nominal_quantity ? ` · labelled ${c.nominal_quantity}${c.unit || ''}` : ''}
                                </p>
                                {c.notes && (
                                    <p style={{ fontSize: '0.68rem', color: '#64748b', margin: '0.25rem 0 0', fontStyle: 'italic' }}>{c.notes}</p>
                                )}

                                <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginTop: '0.75rem', flexWrap: 'wrap' }}>
                                    {/* Optional and genuinely useful: the measured figure is
                                        better evidence than the sold-tally, which misses
                                        offcuts, damage and internal use. */}
                                    <input
                                        type="number" step="any" placeholder={`actual ${c.unit || 'units'} (optional)`}
                                        value={closingQty[c.id] ?? ''}
                                        onChange={e => setClosingQty(prev => ({ ...prev, [c.id]: e.target.value }))}
                                        style={{
                                            background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.1)',
                                            borderRadius: '0.5rem', padding: '0.4rem 0.6rem', color: '#f1f5f9',
                                            fontSize: '0.72rem', outline: 'none', flex: '1 1 140px', minWidth: 0,
                                            fontFamily: 'var(--font-mono)',
                                        }}
                                    />
                                    <button disabled={busyId === `c${c.id}`} onClick={() => handleClose(c)} style={btn('green')}>
                                        Mark Finished
                                    </button>
                                    {(c.units_sold || 0) === 0 && (
                                        <button disabled={busyId === `c${c.id}`} onClick={() => handleCancel(c)} style={btn('amber')}>
                                            Opened by mistake
                                        </button>
                                    )}
                                </div>
                            </div>
                        ))
                    ) : (
                        openable.length === 0 ? (
                            <p style={{ color: '#475569', fontSize: '0.8rem', textAlign: 'center', padding: '2rem 0' }}>
                                No sealed packs available. Only products set to open-container stock tracking appear here.
                            </p>
                        ) : openable.map(row => (
                            <div key={row.variant_id} style={card}>
                                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '0.75rem', flexWrap: 'wrap' }}>
                                    <div style={{ minWidth: 0 }}>
                                        <p style={{ fontSize: '0.85rem', fontWeight: 700, color: '#f1f5f9', margin: 0 }}>{row.product_name}</p>
                                        <p style={{ fontSize: '0.72rem', color: '#64748b', margin: '2px 0 0' }}>{variantLabel(row)}</p>
                                        <p style={{ fontSize: '0.68rem', color: '#475569', margin: '0.35rem 0 0' }}>
                                            <span style={{ color: '#e2e8f0', fontWeight: 700 }}>{row.sealed_stock}</span> sealed
                                            {row.nominal_quantity ? ` · labelled ${row.nominal_quantity}${row.unit || ''} each` : ''}
                                            {row.avg_yield ? ` · actually averages ${row.avg_yield}${row.unit || ''}` : ''}
                                        </p>
                                        {row.has_open && (
                                            <p style={{ fontSize: '0.68rem', color: '#fbbf24', margin: '0.25rem 0 0', fontWeight: 600 }}>
                                                One is already open
                                            </p>
                                        )}
                                    </div>
                                    <button disabled={busyId === `v${row.variant_id}`} onClick={() => handleOpen(row)} style={btn('green')}>
                                        Open One
                                    </button>
                                </div>
                            </div>
                        ))
                    )}
                </div>

                <div style={{ padding: '0.75rem 1.25rem', borderTop: '1px solid rgba(255,255,255,0.07)' }}>
                    <p style={{ fontSize: '0.66rem', color: '#475569', margin: 0, lineHeight: 1.5 }}>
                        A pack leaves stock the moment it is opened. What is left inside is not tracked —
                        mark it finished when it physically runs out.
                    </p>
                </div>
            </div>
        </div>
    );
}
