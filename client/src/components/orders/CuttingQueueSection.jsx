import { useCallback, useEffect, useState } from 'react';
import api from '../../services/api';
import { useToast } from '../../context/ToastContext';
import { wsEvents } from '../../utils/wsEvents';
import CuttingInstructions from './CuttingInstructions';
import { REVIEW_THEME } from '../../utils/cuttingInstructionFormat';

const cardStyle = {
    background: 'rgba(255,255,255,0.03)',
    border: '1px solid rgba(255,255,255,0.07)',
    borderRadius: '1.25rem',
};

// Floor staff periodically come here and report a batch of already-finished
// cutting jobs at once — not a claim/lock queue, just a select-many-then-submit
// list. Checked off a whole ORDER at a time (every item on it, plus the order's
// own status), not per item — see CuttingInstructions for the per-item worksheet
// rendering (reused as-is from the order review page) and its
// pending_source_notice warning, which is what actually flags cross-order
// dependencies on unfinished jobs.
export default function CuttingQueueSection({ onCountChange }) {
    const showToast = useToast();
    const [orders, setOrders] = useState([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState('');
    const [selected, setSelected] = useState(() => new Set());
    const [submitting, setSubmitting] = useState(false);

    const fetchQueue = useCallback(() => {
        setLoading(true);
        api.orderService.getCuttingQueue()
            .then(data => { setOrders(data || []); setError(''); })
            .catch(() => setError('Failed to load the cutting queue — please try again.'))
            .finally(() => setLoading(false));
    }, []);

    useEffect(() => { fetchQueue(); }, [fetchQueue]);
    useEffect(() => wsEvents.on('cutting_status_updated', fetchQueue), [fetchQueue]);

    useEffect(() => { onCountChange?.(orders.length); }, [orders, onCountChange]);

    useEffect(() => {
        // Drop selections for orders that disappeared from the queue (e.g. someone
        // else just reported them done from another screen/tab).
        setSelected(prev => {
            const validIds = new Set(orders.map(o => o.orderId));
            const next = new Set([...prev].filter(id => validIds.has(id)));
            return next.size === prev.size ? prev : next;
        });
    }, [orders]);

    const toggle = (orderId) => setSelected(prev => {
        const next = new Set(prev);
        if (next.has(orderId)) next.delete(orderId); else next.add(orderId);
        return next;
    });

    const allSelected = orders.length > 0 && selected.size === orders.length;
    const toggleAll = () => setSelected(allSelected ? new Set() : new Set(orders.map(o => o.orderId)));

    const handleSubmit = async () => {
        if (selected.size === 0) return;
        setSubmitting(true);
        try {
            await api.orderService.markOrdersCuttingDone([...selected]);
            showToast(`${selected.size} order${selected.size > 1 ? 's' : ''} reported cut and completed`, 'success');
            setSelected(new Set());
            fetchQueue();
        } catch (err) {
            showToast(err.response?.data?.detail || 'Failed to report cutting done. Please try again.', 'error');
        } finally {
            setSubmitting(false);
        }
    };

    return (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem', paddingBottom: selected.size > 0 ? '5.5rem' : 0 }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '1rem', flexWrap: 'wrap' }}>
                <p style={{ fontSize: '0.78rem', color: '#475569', margin: 0 }}>
                    Report a batch of already-finished orders — checking an order marks every item on it cut and the order completed.
                </p>
                {orders.length > 0 && (
                    <button onClick={toggleAll} style={{
                        padding: '0.5rem 1rem', borderRadius: '0.75rem', border: '1px solid rgba(255,255,255,0.1)',
                        background: 'rgba(255,255,255,0.05)', color: '#94a3b8', fontWeight: 600, fontSize: '0.78rem', cursor: 'pointer',
                    }}>{allSelected ? 'Deselect all' : `Select all (${orders.length})`}</button>
                )}
            </div>

            {error && (
                <div style={{ padding: '0.75rem 1rem', borderRadius: '0.75rem', background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.25)', color: '#f87171', fontSize: '0.82rem' }}>
                    {error}
                </div>
            )}
            {loading ? (
                <p style={{ color: '#475569', fontSize: '0.85rem' }}>Loading…</p>
            ) : orders.length === 0 ? (
                <div style={{ textAlign: 'center', padding: '4rem 0', color: '#334155' }}>
                    <div style={{ fontSize: '3rem', marginBottom: '0.75rem', opacity: 0.4 }}>✂️</div>
                    <p style={{ fontWeight: 500, fontSize: '0.875rem' }}>Nothing waiting on a cutting report.</p>
                </div>
            ) : (
                orders.map(order => {
                    const checked = selected.has(order.orderId);
                    return (
                        <div key={order.orderId} style={{
                            ...cardStyle, padding: '1rem 1.25rem', display: 'flex', gap: '0.875rem', alignItems: 'flex-start',
                            border: checked ? '1px solid rgba(59,130,246,0.35)' : cardStyle.border,
                            background: checked ? 'rgba(59,130,246,0.06)' : cardStyle.background,
                            cursor: 'pointer',
                        }} onClick={() => toggle(order.orderId)}>
                            <input type="checkbox" checked={checked} onChange={() => toggle(order.orderId)} onClick={e => e.stopPropagation()}
                                style={{ width: '18px', height: '18px', flexShrink: 0, marginTop: '2px', accentColor: '#3b82f6' }} />
                            <div style={{ flex: 1, minWidth: 0 }}>
                                <div style={{ display: 'flex', alignItems: 'baseline', gap: '0.5rem', flexWrap: 'wrap' }}>
                                    <span style={{ fontSize: '0.85rem', fontWeight: 700, color: '#e2e8f0' }}>Order #{order.orderId}</span>
                                    <span style={{ fontSize: '0.85rem', fontWeight: 600, color: '#94a3b8' }}>{order.customerName || 'Walk-in Customer'}</span>
                                </div>
                                {order.items.map(item => {
                                    const lineItems = item.details?.lineItems || [];
                                    return (
                                        <div key={item.itemId} style={{ marginTop: '0.5rem' }}>
                                            <span style={{ fontSize: '0.78rem', fontWeight: 600, color: '#94a3b8' }}>{item.productName}</span>
                                            {lineItems.map((li, idx) => (
                                                li.offcut_sources?.length > 0 && (
                                                    <div key={idx} style={{ marginTop: '0.375rem' }}>
                                                        <CuttingInstructions sources={li.offcut_sources} theme={REVIEW_THEME} />
                                                    </div>
                                                )
                                            ))}
                                        </div>
                                    );
                                })}
                            </div>
                        </div>
                    );
                })
            )}

            {/* Sticky submit bar */}
            {selected.size > 0 && (
                <div style={{
                    position: 'sticky', bottom: 0, padding: '1rem 2rem', margin: '0 -2rem', borderTop: '1px solid rgba(255,255,255,0.07)',
                    background: 'rgba(9,14,26,0.92)', backdropFilter: 'blur(20px)',
                    display: 'flex', justifyContent: 'flex-end', gap: '0.75rem',
                }}>
                    <button onClick={handleSubmit} disabled={submitting} style={{
                        padding: '0.75rem 1.75rem', borderRadius: '0.875rem', border: 'none',
                        background: submitting ? 'rgba(59,130,246,0.3)' : 'linear-gradient(135deg, #3b82f6, #06b6d4)',
                        color: '#fff', fontWeight: 700, fontSize: '0.85rem', cursor: submitting ? 'not-allowed' : 'pointer',
                        boxShadow: submitting ? 'none' : '0 4px 16px rgba(59,130,246,0.3)',
                    }}>
                        {submitting ? 'Reporting…' : `Mark ${selected.size} Order${selected.size > 1 ? 's' : ''} as Done`}
                    </button>
                </div>
            )}
        </div>
    );
}
