import { useState, useEffect, useCallback, useMemo } from 'react';
import api from '../services/api';
import StoreOrderModal from '../components/store/StoreOrderModal';

function dateLabel(isoString) {
    const d = new Date(isoString);
    const today = new Date();
    const yesterday = new Date();
    yesterday.setDate(today.getDate() - 1);

    if (d.toDateString() === today.toDateString()) return 'Today';
    if (d.toDateString() === yesterday.toDateString()) return 'Yesterday';
    return d.toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'short' });
}

function fmtTime(iso) {
    if (!iso) return '';
    return new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

// Compact one-liner describing line items for a store item
function summariseLines(item) {
    const lines = item.details?.lineItems ?? [];
    const d = item.details ?? {};

    if (lines.length === 0) {
        if (d.width && d.height) return `${d.quantity ?? 1}× ${d.width}×${d.height} panel`;
        if (d.quantity) return `×${d.quantity}`;
        return '';
    }

    const parts = [];
    let fullQty = 0, halfQty = 0;
    const cuts = [];

    for (const li of lines) {
        const t = (li.type ?? '').toLowerCase();
        const isCut = t.includes('cut') && !t.includes('full');
        if (!isCut && t.includes('full')) fullQty += li.qty || 0;
        else if (t.includes('half')) halfQty += li.qty || 0;
        else if (isCut) {
            const len = li.meta?.length;
            cuts.push(`${li.qty}× ${len ? `${len}ft` : ''}cut`);
        }
    }

    if (fullQty) parts.push(`${fullQty}× full bar`);
    if (halfQty) parts.push(`${halfQty}× half bar`);
    parts.push(...cuts);
    return parts.join(' · ');
}

const STATUS_COLORS = {
    confirmed: { bg: 'rgba(34,197,94,0.1)', border: 'rgba(34,197,94,0.3)', text: '#4ade80' },
    pending:   { bg: 'rgba(251,191,36,0.1)', border: 'rgba(251,191,36,0.3)', text: '#fbbf24' },
    processing:{ bg: 'rgba(59,130,246,0.1)', border: 'rgba(59,130,246,0.3)', text: '#60a5fa' },
    ready:     { bg: 'rgba(168,85,247,0.1)', border: 'rgba(168,85,247,0.3)', text: '#c084fc' },
};
function statusStyle(s) {
    return STATUS_COLORS[s] ?? { bg: 'rgba(255,255,255,0.06)', border: 'rgba(255,255,255,0.15)', text: '#94a3b8' };
}

export default function StoreActiveOrdersPage() {
    const [storeOrders, setStoreOrders] = useState([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(null);
    const [selectedOrder, setSelectedOrder] = useState(null);
    const [searchQuery, setSearchQuery] = useState('');
    const [statusFilter, setStatusFilter] = useState('confirmed');

    const fetchOrders = useCallback(async () => {
        setLoading(true);
        setError(null);
        try {
            const data = await api.orderService.getStoreOrders(statusFilter);
            setStoreOrders(data);
        } catch (err) {
            setError('Failed to load orders. Check your connection.');
            console.error('Store orders fetch error:', err);
        } finally {
            setLoading(false);
        }
    }, [statusFilter]);

    useEffect(() => { fetchOrders(); }, [fetchOrders]);

    const groupedOrders = useMemo(() => {
        const filtered = storeOrders.filter(entry => {
            if (!searchQuery) return true;
            const q = searchQuery.toLowerCase();
            const o = entry.order;
            return (
                String(o.orderId).includes(q) ||
                (o.customerName ?? '').toLowerCase().includes(q)
            );
        });

        const groups = {};
        filtered.forEach(entry => {
            const label = dateLabel(entry.order.created_at);
            if (!groups[label]) groups[label] = [];
            groups[label].push(entry);
        });
        return groups;
    }, [storeOrders, searchQuery]);

    const totalCount = Object.values(groupedOrders).reduce((s, g) => s + g.length, 0);
    const handleRefresh = useCallback(() => fetchOrders(), [fetchOrders]);

    return (
        <div style={{ display: 'flex', flexDirection: 'column', height: '100%', background: 'var(--color-bg)' }}>

            {/* Header */}
            <div style={{
                padding: '1.25rem 1.75rem',
                borderBottom: '1px solid rgba(255,255,255,0.07)',
                background: 'rgba(9,14,26,0.95)', backdropFilter: 'blur(20px)',
                display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '1rem', flexWrap: 'wrap',
                position: 'sticky', top: 0, zIndex: 20,
            }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.875rem' }}>
                    <div style={{
                        width: '40px', height: '40px', borderRadius: '10px',
                        background: 'linear-gradient(135deg, rgba(168,85,247,0.2), rgba(139,92,246,0.15))',
                        border: '1px solid rgba(168,85,247,0.3)',
                        display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '1rem',
                    }}>⚡</div>
                    <div>
                        <h1 style={{ fontSize: '1.1rem', fontWeight: 800, color: '#f1f5f9', margin: 0 }}>Store Orders</h1>
                        <p style={{ fontSize: '0.7rem', color: '#475569', margin: 0 }}>
                            Profiles &amp; glass · awaiting preparation
                        </p>
                    </div>
                </div>

                <div style={{ display: 'flex', alignItems: 'center', gap: '0.625rem', flexWrap: 'wrap' }}>
                    <select
                        value={statusFilter}
                        onChange={e => setStatusFilter(e.target.value)}
                        style={{
                            background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.1)',
                            borderRadius: '0.75rem', padding: '0.5rem 0.875rem',
                            color: '#e2e8f0', fontSize: '0.8rem', outline: 'none', cursor: 'pointer',
                        }}
                    >
                        <option value="confirmed">Confirmed</option>
                        <option value="pending">Pending</option>
                        <option value="processing">Processing</option>
                        <option value="all">All active</option>
                    </select>

                    {totalCount > 0 && (
                        <div style={{
                            padding: '0.3rem 0.8rem', borderRadius: '100px',
                            background: 'rgba(168,85,247,0.12)', border: '1px solid rgba(168,85,247,0.25)',
                            color: '#c084fc', fontSize: '0.78rem', fontWeight: 700,
                        }}>
                            {totalCount} order{totalCount !== 1 ? 's' : ''}
                        </div>
                    )}

                    <div style={{ position: 'relative' }}>
                        <span style={{ position: 'absolute', left: '0.75rem', top: '50%', transform: 'translateY(-50%)', color: '#475569', fontSize: '0.8rem' }}>🔍</span>
                        <input
                            type="text" placeholder="Order # or customer…"
                            value={searchQuery} onChange={e => setSearchQuery(e.target.value)}
                            style={{
                                background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.1)',
                                borderRadius: '0.75rem', padding: '0.5rem 0.875rem 0.5rem 2.1rem',
                                color: '#e2e8f0', fontSize: '0.8rem', outline: 'none', width: '200px',
                                transition: 'border-color 0.2s',
                            }}
                            onFocus={e => { e.target.style.borderColor = 'rgba(168,85,247,0.5)'; }}
                            onBlur={e => { e.target.style.borderColor = 'rgba(255,255,255,0.1)'; }}
                        />
                    </div>

                    <button onClick={handleRefresh} disabled={loading} style={{
                        padding: '0.5rem 0.875rem', borderRadius: '0.75rem',
                        border: '1px solid rgba(255,255,255,0.1)', background: 'rgba(255,255,255,0.05)',
                        color: '#94a3b8', fontSize: '0.8rem', cursor: loading ? 'not-allowed' : 'pointer',
                    }}>
                        {loading ? '⟳' : '↺'} Refresh
                    </button>
                </div>
            </div>

            {/* Content */}
            <div style={{ flex: 1, overflowY: 'auto', padding: '1.5rem 1.75rem' }} className="custom-scrollbar">
                {loading ? (
                    <div style={{ display: 'flex', justifyContent: 'center', padding: '5rem 0' }}>
                        <span style={{ color: '#475569', fontSize: '0.875rem' }}>Loading orders…</span>
                    </div>
                ) : error ? (
                    <div style={{ textAlign: 'center', padding: '3rem 0' }}>
                        <div style={{ fontSize: '2rem', marginBottom: '0.5rem' }}>⚠️</div>
                        <p style={{ color: '#f87171', fontSize: '0.875rem' }}>{error}</p>
                        <button onClick={handleRefresh} style={{
                            marginTop: '0.75rem', padding: '0.5rem 1.25rem', borderRadius: '0.75rem',
                            border: '1px solid rgba(168,85,247,0.3)', background: 'rgba(168,85,247,0.1)',
                            color: '#c084fc', cursor: 'pointer', fontSize: '0.82rem',
                        }}>Retry</button>
                    </div>
                ) : totalCount === 0 ? (
                    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '60vh', gap: '0.875rem' }}>
                        <div style={{ fontSize: '3.5rem', opacity: 0.2 }}>✅</div>
                        <p style={{ fontSize: '1rem', fontWeight: 700, color: '#475569' }}>All caught up!</p>
                        <p style={{ fontSize: '0.8rem', color: '#334155' }}>No active store orders waiting.</p>
                    </div>
                ) : (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '2rem' }}>
                        {Object.entries(groupedOrders).map(([label, entries]) => (
                            <section key={label}>
                                {/* Date group header */}
                                <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', marginBottom: '1rem' }}>
                                    <span style={{
                                        fontSize: '0.7rem', fontWeight: 800, textTransform: 'uppercase',
                                        letterSpacing: '0.1em', color: '#475569', whiteSpace: 'nowrap',
                                    }}>{label}</span>
                                    <div style={{ flex: 1, height: '1px', background: 'rgba(255,255,255,0.06)' }} />
                                    <span style={{
                                        fontSize: '0.65rem', color: '#334155', fontWeight: 600,
                                        background: 'rgba(255,255,255,0.04)', borderRadius: '100px',
                                        padding: '2px 8px', border: '1px solid rgba(255,255,255,0.06)',
                                    }}>{entries.length}</span>
                                </div>

                                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))', gap: '0.875rem' }}>
                                    {entries.map(entry => (
                                        <OrderCard
                                            key={entry.order.orderId}
                                            entry={entry}
                                            onClick={() => setSelectedOrder(entry)}
                                        />
                                    ))}
                                </div>
                            </section>
                        ))}
                    </div>
                )}
            </div>

            {selectedOrder && (
                <StoreOrderModal
                    order={selectedOrder}
                    onClose={() => setSelectedOrder(null)}
                    onRefresh={() => { handleRefresh(); setSelectedOrder(null); }}
                />
            )}
        </div>
    );
}

function OrderCard({ entry, onClick }) {
    const o = entry.order;
    const items = entry.store_items ?? [];
    const hasCuts = items.some(i => i.has_cuts && i.track_offcuts);
    const sc = statusStyle(o.status);

    const MAX_VISIBLE = 4;
    const visibleItems = items.slice(0, MAX_VISIBLE);
    const overflow = items.length - MAX_VISIBLE;

    return (
        <div
            onClick={onClick}
            style={{
                background: 'rgba(13,20,38,0.8)',
                border: '1px solid rgba(255,255,255,0.09)',
                borderRadius: '1.25rem', padding: '1.125rem 1.25rem',
                cursor: 'pointer', transition: 'all 0.2s ease',
                display: 'flex', flexDirection: 'column', gap: '0.75rem',
                position: 'relative', overflow: 'hidden',
            }}
            onMouseEnter={e => {
                e.currentTarget.style.borderColor = 'rgba(168,85,247,0.4)';
                e.currentTarget.style.background = 'rgba(168,85,247,0.06)';
                e.currentTarget.style.transform = 'translateY(-2px)';
                e.currentTarget.style.boxShadow = '0 8px 28px rgba(0,0,0,0.3)';
            }}
            onMouseLeave={e => {
                e.currentTarget.style.borderColor = 'rgba(255,255,255,0.09)';
                e.currentTarget.style.background = 'rgba(13,20,38,0.8)';
                e.currentTarget.style.transform = 'translateY(0)';
                e.currentTarget.style.boxShadow = 'none';
            }}
        >
            {/* Top accent line */}
            <div style={{ position: 'absolute', top: 0, left: 0, right: 0, height: '2px', background: `linear-gradient(90deg, transparent, ${sc.border}, transparent)` }} />

            {/* Status + time row */}
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span style={{
                    fontSize: '0.62rem', fontWeight: 800, textTransform: 'uppercase', letterSpacing: '0.08em',
                    background: sc.bg, border: `1px solid ${sc.border}`, color: sc.text,
                    borderRadius: '100px', padding: '2px 9px',
                }}>{o.status}</span>
                <span style={{ color: '#334155', fontSize: '0.68rem', fontFamily: 'var(--font-mono)', fontWeight: 600 }}>
                    {fmtTime(o.created_at)}
                </span>
            </div>

            {/* Order number — large and prominent */}
            <div>
                <div style={{
                    fontSize: '1.6rem', fontWeight: 900, fontFamily: 'var(--font-mono)',
                    color: '#f1f5f9', letterSpacing: '-0.04em', lineHeight: 1,
                }}>
                    <span style={{ color: 'rgba(192,132,252,0.5)', fontSize: '1rem', fontWeight: 700 }}>#</span>
                    {o.orderId}
                </div>
                <div style={{ fontSize: '0.82rem', color: '#64748b', marginTop: '3px', fontWeight: 500 }}>
                    {o.customerName || 'Walk-in customer'}
                </div>
            </div>

            {/* Items list */}
            <div style={{
                borderTop: '1px solid rgba(255,255,255,0.06)',
                paddingTop: '0.625rem',
                display: 'flex', flexDirection: 'column', gap: '0.4rem',
            }}>
                {visibleItems.map((item, i) => {
                    const isProfile = item.category === 'profile';
                    const summary = summariseLines(item);
                    return (
                        <div key={i} style={{ display: 'flex', gap: '0.5rem', alignItems: 'flex-start' }}>
                            <span style={{ fontSize: '0.82rem', flexShrink: 0, marginTop: '1px' }}>
                                {isProfile ? '🏗️' : '💎'}
                            </span>
                            <div style={{ minWidth: 0 }}>
                                <span style={{ fontSize: '0.78rem', fontWeight: 700, color: '#cbd5e1', display: 'block', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                                    {item.product_name}
                                    {item.details?.color && (
                                        <span style={{ fontWeight: 400, color: '#64748b' }}> · {item.details.color}</span>
                                    )}
                                </span>
                                {summary && (
                                    <span style={{ fontSize: '0.68rem', color: '#475569', fontFamily: 'var(--font-mono)' }}>
                                        {summary}
                                    </span>
                                )}
                            </div>
                        </div>
                    );
                })}
                {overflow > 0 && (
                    <div style={{ fontSize: '0.7rem', color: '#334155', paddingLeft: '1.3rem' }}>
                        +{overflow} more item{overflow > 1 ? 's' : ''}
                    </div>
                )}
            </div>

            {/* Cut badge */}
            {hasCuts && (
                <div style={{
                    alignSelf: 'flex-start',
                    display: 'flex', alignItems: 'center', gap: '0.3rem',
                    fontSize: '0.68rem', fontWeight: 700, color: '#a78bfa',
                    background: 'rgba(167,139,250,0.1)', border: '1px solid rgba(167,139,250,0.25)',
                    borderRadius: '100px', padding: '3px 10px',
                }}>
                    <span>✂</span>
                    <span>Custom cuts</span>
                </div>
            )}
        </div>
    );
}
