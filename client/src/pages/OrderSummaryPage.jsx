import { useMemo, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { useProducts } from '../context/ProductContext';
import { useOrders } from '../context/OrderContext';
import { useAuth } from '../context/AuthContext';
import CancelOrderModal from '../components/orders/CancelOrderModal';

const STATUS_COLORS = {
    pending:   { bg: 'rgba(148,163,184,0.12)', border: 'rgba(148,163,184,0.25)', text: '#cbd5e1' },
    confirmed: { bg: 'rgba(59,130,246,0.12)',  border: 'rgba(59,130,246,0.25)',  text: '#60a5fa' },
    ready:     { bg: 'rgba(245,158,11,0.12)',  border: 'rgba(245,158,11,0.25)',  text: '#fbbf24' },
    completed: { bg: 'rgba(34,197,94,0.12)',   border: 'rgba(34,197,94,0.25)',   text: '#4ade80' },
    cancelled: { bg: 'rgba(239,68,68,0.12)',   border: 'rgba(239,68,68,0.25)',   text: '#f87171' },
};

const Card = ({ title, children }) => (
    <div style={{
        background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.07)',
        borderRadius: '1.25rem', padding: '1.25rem 1.5rem',
    }}>
        <h3 style={{ fontSize: '0.68rem', fontWeight: 700, color: '#475569', letterSpacing: '0.1em', textTransform: 'uppercase', margin: '0 0 1rem' }}>{title}</h3>
        {children}
    </div>
);

const Row = ({ label, value, strong }) => (
    <div style={{ display: 'flex', justifyContent: 'space-between', gap: '1rem', padding: '0.3rem 0' }}>
        <span style={{ fontSize: strong ? '0.9rem' : '0.82rem', color: strong ? '#f1f5f9' : '#64748b', fontWeight: strong ? 800 : 500 }}>{label}</span>
        <span style={{ fontSize: strong ? '0.9rem' : '0.82rem', color: strong ? '#f1f5f9' : '#94a3b8', fontFamily: 'var(--font-mono)', fontWeight: strong ? 800 : 600 }}>{value}</span>
    </div>
);

const ItemRow = ({ item }) => (
    <div style={{
        display: 'flex', alignItems: 'center', gap: '1rem',
        padding: '1rem 0', borderBottom: '1px solid rgba(255,255,255,0.05)',
    }}>
        <div style={{
            width: '44px', height: '44px', borderRadius: '10px', flexShrink: 0,
            background: 'rgba(59,130,246,0.1)', border: '1px solid rgba(59,130,246,0.2)',
            overflow: 'hidden', display: 'flex', alignItems: 'center', justifyContent: 'center',
        }}>
            {item.image
                ? <img src={item.image} alt={item.name} style={{ width: '100%', height: '100%', objectFit: 'cover' }} loading="lazy" />
                : <span style={{ fontSize: '1.1rem' }}>📦</span>}
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: '0.85rem', fontWeight: 700, color: '#e2e8f0', marginBottom: '2px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{item.name}</div>
            <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
                <span style={{ fontSize: '0.7rem', color: '#475569' }}>{item.quantity} {item.unitType || 'pcs'} × KSH {item.unitPrice.toFixed(2)}</span>
                {item.details?.color && (
                    <span style={{ fontSize: '0.62rem', fontWeight: 600, padding: '1px 6px', background: 'rgba(255,255,255,0.07)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: '4px', color: '#94a3b8', textTransform: 'uppercase' }}>{item.details.color}</span>
                )}
                {item.details?.thickness && (
                    <span style={{ fontSize: '0.62rem', fontWeight: 600, padding: '1px 6px', background: 'rgba(59,130,246,0.1)', border: '1px solid rgba(59,130,246,0.2)', borderRadius: '4px', color: '#60a5fa', textTransform: 'uppercase' }}>{item.details.thickness}</span>
                )}
            </div>
        </div>
        <div style={{ fontSize: '0.9rem', fontWeight: 800, color: '#f1f5f9', fontFamily: 'var(--font-mono)', whiteSpace: 'nowrap' }}>
            KSH {item.totalPrice.toFixed(2)}
        </div>
    </div>
);

export default function OrderSummaryPage() {
    const location = useLocation();
    const navigate = useNavigate();
    const { user } = useAuth();
    const { products: PRODUCTS } = useProducts();
    const { cancelOrder } = useOrders();
    const [showCancel, setShowCancel] = useState(false);

    const order = location.state?.order || null;

    const items = useMemo(() => {
        if (!order?.items) return [];
        return order.items.map(item => {
            const product = PRODUCTS.find(p => p.id === item.productId);
            return {
                ...item,
                name: product?.name ?? item.details?.name ?? `Product #${item.productId}`,
                image: product?.image ?? null,
            };
        });
    }, [order, PRODUCTS]);

    if (!order) {
        return (
            <div style={{ minHeight: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', flexDirection: 'column', gap: '1rem', background: 'var(--color-bg)' }}>
                <p style={{ color: '#64748b', fontSize: '0.875rem' }}>No order selected.</p>
                <button onClick={() => navigate('/orders')} style={{ color: '#60a5fa', fontWeight: 700, background: 'none', border: 'none', cursor: 'pointer', fontSize: '0.875rem' }}>← Back to Order History</button>
            </div>
        );
    }

    const isCancelled = order.status === 'cancelled';
    const statusColor = STATUS_COLORS[order.status] || STATUS_COLORS.pending;
    const vatAmount = order.VAT_status ? Math.max(0, order.total - (order.subtotal - (order.discount || 0))) : 0;
    const canEditOrCancel = ['manager', 'cashier', 'ceo', 'admin'].includes(user?.role);

    const handleEdit = () => navigate('/sales', { state: { mode: 'edit', orderData: { ...order, id: order.orderId } } });

    const handleCancelConfirm = async (pin) => {
        await cancelOrder(order.orderId, pin);
        setShowCancel(false);
        navigate('/orders');
    };

    return (
        <div style={{ minHeight: '100%', background: 'var(--color-bg)', color: 'var(--color-text)' }}>
            {/* Header */}
            <div style={{
                padding: '1.5rem 2rem', borderBottom: '1px solid rgba(255,255,255,0.07)',
                background: 'rgba(9,14,26,0.8)', backdropFilter: 'blur(20px)',
                position: 'sticky', top: 0, zIndex: 20,
                display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '1rem', flexWrap: 'wrap',
            }}>
                <div>
                    <button onClick={() => navigate('/orders')} style={{
                        display: 'flex', alignItems: 'center', gap: '0.5rem', background: 'none', border: 'none', cursor: 'pointer',
                        color: '#475569', fontSize: '0.78rem', fontWeight: 600, letterSpacing: '0.05em', textTransform: 'uppercase',
                        marginBottom: '0.5rem', padding: 0,
                    }}>← Back to Order History</button>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
                        <h1 style={{ fontSize: '1.375rem', fontWeight: 800, color: '#f1f5f9', margin: 0, letterSpacing: '-0.025em' }}>Order {order.orderId}</h1>
                        <span style={{
                            fontSize: '0.65rem', fontWeight: 700, padding: '2px 10px', borderRadius: '100px',
                            background: statusColor.bg, border: `1px solid ${statusColor.border}`, color: statusColor.text,
                            letterSpacing: '0.06em', textTransform: 'uppercase',
                        }}>{order.status}</span>
                    </div>
                    <p style={{ fontSize: '0.78rem', color: '#475569', margin: '2px 0 0' }}>
                        {new Date(order.created_at).toLocaleString('en-GB', { day: 'numeric', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit' })}
                    </p>
                </div>

                {!isCancelled && canEditOrCancel && (
                    <div style={{ display: 'flex', gap: '0.625rem' }}>
                        <button onClick={handleEdit} style={{
                            padding: '0.625rem 1.25rem', borderRadius: '0.75rem',
                            background: 'linear-gradient(135deg, #3b82f6, #06b6d4)', border: 'none',
                            color: '#fff', fontWeight: 700, fontSize: '0.82rem', cursor: 'pointer',
                            boxShadow: '0 2px 12px rgba(59,130,246,0.3)',
                        }}>✏️ Edit Order</button>
                        <button onClick={() => setShowCancel(true)} style={{
                            padding: '0.625rem 1.25rem', borderRadius: '0.75rem',
                            background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.2)',
                            color: '#f87171', fontWeight: 700, fontSize: '0.82rem', cursor: 'pointer',
                        }}>🚫 Cancel Order</button>
                    </div>
                )}
            </div>

            {/* Body */}
            <div style={{ padding: '1.75rem 2rem', display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) 320px', gap: '1.5rem', alignItems: 'start' }}>
                {/* Items */}
                <div style={{
                    background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.07)',
                    borderRadius: '1.25rem', padding: '0.5rem 1.5rem',
                }}>
                    <h3 style={{ fontSize: '0.68rem', fontWeight: 700, color: '#475569', letterSpacing: '0.1em', textTransform: 'uppercase', margin: '1rem 0 0' }}>
                        Items ({items.length})
                    </h3>
                    {items.length === 0 ? (
                        <p style={{ color: '#334155', fontSize: '0.82rem', padding: '1.5rem 0' }}>No items on this order.</p>
                    ) : (
                        items.map((item, idx) => <ItemRow key={idx} item={item} />)
                    )}
                </div>

                {/* Sidebar */}
                <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
                    <Card title="Customer">
                        <div style={{ fontSize: '0.9rem', fontWeight: 700, color: '#e2e8f0' }}>{order.customer?.name || order.customerName || 'Walk-in Customer'}</div>
                        {order.customer?.phone && <div style={{ fontSize: '0.78rem', color: '#64748b', marginTop: '2px' }}>{order.customer.phone}</div>}
                    </Card>

                    <Card title="Payment">
                        <Row label="Method" value={order.paymentMethod || '—'} />
                        <Row label="Status" value={order.paymentStatus} />
                        <Row label="VAT" value={order.VAT_status ? 'Included' : 'Not applied'} />
                    </Card>

                    <Card title="Totals">
                        <Row label="Subtotal" value={`KSH ${(order.subtotal || 0).toFixed(2)}`} />
                        {order.discount > 0 && <Row label="Discount" value={`- KSH ${order.discount.toFixed(2)}`} />}
                        {order.VAT_status && <Row label="VAT" value={`KSH ${vatAmount.toFixed(2)}`} />}
                        <div style={{ borderTop: '1px solid rgba(255,255,255,0.08)', margin: '0.5rem 0' }} />
                        <Row label="Total" value={`KSH ${(order.total || 0).toFixed(2)}`} strong />
                        <Row label="Paid" value={`KSH ${(order.amountPaid || 0).toFixed(2)}`} />
                        <Row label="Balance Due" value={`KSH ${(order.balance || 0).toFixed(2)}`} strong={order.balance > 0} />
                    </Card>
                </div>
            </div>

            {showCancel && (
                <CancelOrderModal
                    order={{ id: order.orderId }}
                    onClose={() => setShowCancel(false)}
                    onConfirm={handleCancelConfirm}
                />
            )}
        </div>
    );
}
