import { useState, useEffect, useCallback, useMemo, useDeferredValue } from 'react';
import api from '../services/api';
import { mapBackendOrder } from '../context/OrderContext';
import { wsEvents } from '../utils/wsEvents';
import OrderCard from '../components/orders/OrderCard';
import PaymentModal from '../components/orders/PaymentModal';

// Pure content — no header/search of its own — so it can be dropped into a page
// that owns those (this standalone page below, or DebtManagementPage's shared
// tab header). Mirrors ToolCheckoutPage's CheckoutTab/ReturnTab split.
export function CollectDebtTab({ searchQuery = '', onCountChange }) {
    const [orders, setOrders] = useState([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(null);
    const [collectingOrder, setCollectingOrder] = useState(null);

    const fetchOutstanding = useCallback(async ({ showLoading = false } = {}) => {
        if (showLoading) setLoading(true);
        try {
            const data = await api.orderService.getOutstandingOrders();
            setOrders(data.map(mapBackendOrder));
            setError(null);
        } catch (err) {
            console.error('Failed to fetch outstanding orders', err);
            setError('Failed to load outstanding orders.');
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => { fetchOutstanding({ showLoading: true }); }, [fetchOutstanding]);

    useEffect(() => {
        const off = wsEvents.on('orders_updated', () => fetchOutstanding());
        return off;
    }, [fetchOutstanding]);

    const filteredOrders = useMemo(() => {
        const lq = searchQuery.toLowerCase();
        return orders.filter(o => !lq || String(o.id).toLowerCase().includes(lq) || (o.customer?.name || '').toLowerCase().includes(lq));
    }, [orders, searchQuery]);

    useEffect(() => { onCountChange?.(orders.length); }, [orders, onCountChange]);

    const handlePaymentSuccess = useCallback(() => {
        setCollectingOrder(null);
        fetchOutstanding();
    }, [fetchOutstanding]);

    return (
        <div style={{ padding: '1.5rem 2rem' }}>
            {error && (
                <div style={{ background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.3)', color: '#fca5a5', padding: '0.75rem 1rem', borderRadius: '0.75rem', fontSize: '0.8rem', fontWeight: 600, marginBottom: '1rem' }}>
                    {error}
                </div>
            )}
            {loading ? (
                <div style={{ textAlign: 'center', padding: '2rem', color: '#475569', fontSize: '0.875rem' }}>Loading...</div>
            ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.625rem' }}>
                    {filteredOrders.map(order => (
                        <OrderCard key={order.id} order={order} canManage={false} onCollect={setCollectingOrder} />
                    ))}
                </div>
            )}
            {!loading && filteredOrders.length === 0 && (
                <div style={{ textAlign: 'center', padding: '4rem 0', color: '#334155' }}>
                    <div style={{ fontSize: '3rem', marginBottom: '0.75rem', opacity: 0.4 }}>💰</div>
                    <p style={{ fontWeight: 500, fontSize: '0.875rem' }}>
                        {orders.length === 0 ? 'No outstanding balances — all orders are paid up.' : `No orders found for "${searchQuery}"`}
                    </p>
                </div>
            )}

            {collectingOrder && (
                <PaymentModal
                    order={collectingOrder}
                    onClose={() => setCollectingOrder(null)}
                    onSuccess={handlePaymentSuccess}
                />
            )}
        </div>
    );
}

// Cashier's standalone entry point — owns its own header + search, same shape
// as ToolCheckoutPage wrapping its tabs.
export default function CollectPaymentsPage() {
    const [searchQuery, setSearchQuery] = useState('');
    const deferredQuery = useDeferredValue(searchQuery);
    const [count, setCount] = useState(0);

    return (
        <div style={{ display: 'flex', flexDirection: 'column', height: '100%', background: 'var(--color-bg)' }}>
            {/* Header */}
            <div style={{
                padding: '1.5rem 2rem',
                borderBottom: '1px solid rgba(255,255,255,0.07)',
                background: 'rgba(9,14,26,0.8)',
                backdropFilter: 'blur(20px)',
                position: 'sticky', top: 0, zIndex: 20,
                display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '1rem', flexWrap: 'wrap',
            }}>
                <div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', marginBottom: '0.25rem' }}>
                        <div style={{ width: '8px', height: '8px', borderRadius: '50%', background: '#22c55e', boxShadow: '0 0 8px rgba(34,197,94,0.8)' }} />
                        <h1 style={{ fontSize: '1.375rem', fontWeight: 800, color: '#f1f5f9', margin: 0, letterSpacing: '-0.025em' }}>Collect Debt</h1>
                    </div>
                    <p style={{ fontSize: '0.78rem', color: '#475569', margin: 0, marginLeft: '1.25rem', fontWeight: 500 }}>
                        {count} order{count === 1 ? '' : 's'} outstanding
                    </p>
                </div>

                <div style={{ position: 'relative', minWidth: '280px' }}>
                    <span style={{ position: 'absolute', left: '0.875rem', top: '50%', transform: 'translateY(-50%)', color: '#475569', fontSize: '0.875rem' }}>🔍</span>
                    <input
                        type="text"
                        placeholder="Search by order ID or customer..."
                        style={{
                            width: '100%', background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.1)',
                            borderRadius: '0.75rem', padding: '0.625rem 1rem 0.625rem 2.25rem',
                            color: '#e2e8f0', fontSize: '0.82rem', outline: 'none', transition: 'border-color 0.2s', boxSizing: 'border-box',
                        }}
                        value={searchQuery}
                        onChange={e => setSearchQuery(e.target.value)}
                        onFocus={e => { e.target.style.borderColor = 'rgba(34,197,94,0.5)'; }}
                        onBlur={e => { e.target.style.borderColor = 'rgba(255,255,255,0.1)'; }}
                    />
                </div>
            </div>

            <div style={{ flex: 1, overflowY: 'auto' }} className="custom-scrollbar">
                <CollectDebtTab searchQuery={deferredQuery} onCountChange={setCount} />
            </div>
        </div>
    );
}
