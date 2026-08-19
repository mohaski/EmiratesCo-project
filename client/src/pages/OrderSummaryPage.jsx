import { useMemo, useState, useEffect } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { useProducts } from '../context/ProductContext';
import { useOrders } from '../context/OrderContext';
import { useAuth } from '../context/AuthContext';
import { useToast } from '../context/ToastContext';
import api from '../services/api';
import CancelOrderModal from '../components/orders/CancelOrderModal';
import CorrectOffcutModal from '../components/orders/CorrectOffcutModal';
import CorrectProfileOffcutModal from '../components/orders/CorrectProfileOffcutModal';
import CuttingInstructions from '../components/orders/CuttingInstructions';
import { REVIEW_THEME } from '../utils/cuttingInstructionFormat';

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

const DetailBadge = ({ color, children }) => (
    <span style={{ fontSize: '0.62rem', fontWeight: 600, padding: '1px 6px', background: `${color}15`, border: `1px solid ${color}30`, borderRadius: '4px', color, textTransform: 'uppercase' }}>{children}</span>
);

const ItemRow = ({ item, canCorrectOffcuts, canMarkCuttingDone, onCorrect, onMarkDone }) => {
    const lineItems = item.details?.lineItems || [];
    const attributes = item.details?.attributes;
    const extras = item.details?.extras;
    const pendingCut = item.cuttingCompleted === false;

    return (
    <div style={{ padding: '1rem 0', borderBottom: '1px solid rgba(255,255,255,0.05)' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
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
                <div style={{ display: 'flex', gap: '0.375rem', flexWrap: 'wrap', alignItems: 'center' }}>
                    <span style={{ fontSize: '0.7rem', color: '#475569' }}>{item.quantity} {item.unitType || 'pcs'} × KSH {item.unitPrice.toFixed(2)}</span>
                    {item.variantId && (
                        <span style={{ fontSize: '0.65rem', color: '#334155', fontFamily: 'var(--font-mono)' }}>· Variant #{item.variantId}</span>
                    )}
                    {item.details?.description && <DetailBadge color="#94a3b8">{item.details.description}</DetailBadge>}
                    {item.details?.color && <DetailBadge color="#94a3b8">{item.details.color}</DetailBadge>}
                    {item.details?.thickness && <DetailBadge color="#60a5fa">{item.details.thickness}</DetailBadge>}
                    {Array.isArray(attributes) && attributes.map((attr, i) => (
                        <DetailBadge key={i} color="#93c5fd">{attr.label}: {attr.value}</DetailBadge>
                    ))}
                    {!attributes && extras && Object.entries(extras).map(([k, v]) => (
                        k === 'Color' || k === 'Category' ? null : <DetailBadge key={k} color="#93c5fd">{k}: {v}{k === 'Length' && typeof v === 'number' ? 'ft' : ''}</DetailBadge>
                    ))}
                    {pendingCut && <DetailBadge color="#fbbf24">Awaiting cut</DetailBadge>}
                </div>
            </div>
            {pendingCut && canMarkCuttingDone && (
                <button onClick={() => onMarkDone(item.itemId)} style={{
                    flexShrink: 0, background: 'rgba(34,197,94,0.1)', border: '1px solid rgba(34,197,94,0.25)',
                    color: '#4ade80', fontSize: '0.72rem', fontWeight: 700, padding: '5px 11px',
                    borderRadius: '100px', cursor: 'pointer', whiteSpace: 'nowrap',
                }}>Mark Done</button>
            )}
            <div style={{ fontSize: '0.9rem', fontWeight: 800, color: '#f1f5f9', fontFamily: 'var(--font-mono)', whiteSpace: 'nowrap' }}>
                KSH {item.totalPrice.toFixed(0)}
            </div>
        </div>

        {/* Line-item breakdown — full/half sheets, individual cuts, etc. */}
        {lineItems.length > 0 && (
            <div style={{
                marginLeft: '56px', marginTop: '0.625rem', background: 'rgba(255,255,255,0.02)',
                border: '1px solid rgba(255,255,255,0.05)', borderRadius: '0.625rem', overflow: 'hidden',
            }}>
                {lineItems.map((li, i) => (
                    <div key={i} style={{
                        display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '0.75rem',
                        padding: '0.5rem 0.75rem', borderBottom: i < lineItems.length - 1 ? '1px solid rgba(255,255,255,0.04)' : 'none',
                        fontSize: '0.75rem',
                    }}>
                        <span style={{ color: '#94a3b8', flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                            {li.label || li.type}
                            {li.meta?.length ? ` · ${li.meta.length}${li.meta.u || 'ft'}` : ''}
                            {li.meta?.area ? ` · ${li.meta.area.toFixed(2)}sqft` : ''}
                        </span>
                        <span style={{ color: '#64748b', fontFamily: 'var(--font-mono)', whiteSpace: 'nowrap' }}>×{li.qty}</span>
                        <span style={{ color: '#64748b', fontFamily: 'var(--font-mono)', whiteSpace: 'nowrap' }}>@KSH{(li.rate || 0).toFixed(2)}</span>
                        <span style={{ color: '#cbd5e1', fontWeight: 700, fontFamily: 'var(--font-mono)', whiteSpace: 'nowrap', minWidth: '70px', textAlign: 'right' }}>KSH{Math.ceil(li.total || 0)}</span>
                    </div>
                ))}
            </div>
        )}

        {canCorrectOffcuts && lineItems.map((li, lineIdx) => {
            const sources = li.offcut_sources;
            if (!sources || sources.length === 0) return null;
            return (
                <div key={lineIdx} style={{ marginLeft: '56px', marginTop: '0.375rem' }}>
                    <CuttingInstructions
                        sources={sources}
                        theme={REVIEW_THEME}
                        renderActions={(src) => {
                            const eventIdx = sources.indexOf(src);
                            const is2D = 'cuts' in src;
                            const correctable = is2D
                                ? src.owns_consumption !== false && (src.remainders_created || []).length > 0
                                : !src.superseded;
                            if (!correctable) return null;
                            return (
                                <button
                                    onClick={() => onCorrect({ kind: is2D ? 'glass' : 'profile', itemId: item.itemId, productId: item.productId, variantId: item.variantId, lineIdx, eventIdx, event: src })}
                                    style={{
                                        flexShrink: 0, background: 'rgba(245,158,11,0.1)', border: '1px solid rgba(245,158,11,0.25)',
                                        color: '#fbbf24', fontSize: '0.68rem', fontWeight: 700, padding: '2px 9px',
                                        borderRadius: '100px', cursor: 'pointer', whiteSpace: 'nowrap',
                                    }}
                                >Correct</button>
                            );
                        }}
                    />
                </div>
            );
        })}
    </div>
    );
};

export default function OrderSummaryPage() {
    const location = useLocation();
    const navigate = useNavigate();
    const { user } = useAuth();
    const { products: PRODUCTS } = useProducts();
    const { cancelOrder } = useOrders();
    const showToast = useToast();
    const [showCancel, setShowCancel] = useState(false);
    const [correcting, setCorrecting] = useState(null); // {itemId, lineIdx, eventIdx, event}

    const [windowWidth, setWindowWidth] = useState(() => window.innerWidth);
    useEffect(() => {
        const h = () => setWindowWidth(window.innerWidth);
        window.addEventListener('resize', h, { passive: true });
        return () => window.removeEventListener('resize', h);
    }, []);
    const isMobile = windowWidth < 768;

    const [order, setOrder] = useState(location.state?.order || null);
    const canCorrectOffcuts = ['manager', 'ceo', 'admin'].includes(user?.role);
    const canMarkCuttingDone = ['cashier', 'admin'].includes(user?.role);

    const refreshOrder = async () => {
        const full = await api.orderService.getOrder(order.orderId);
        setOrder({ ...full, id: full.orderId, customer: order.customer });
    };

    const handleOffcutCorrected = async (newRemainders, notes, failedCutIndices, forcedOffcutId) => {
        await api.orderService.correctOffcutEvent(order.orderId, {
            item_id: correcting.itemId, line_idx: correcting.lineIdx, event_idx: correcting.eventIdx,
            new_remainders: newRemainders, failed_cut_indices: failedCutIndices, forced_offcut_id: forcedOffcutId, notes,
        });
        await refreshOrder();
        showToast('Offcut correction saved', 'success');
    };

    const handleProfileOffcutCorrected = async (newRemainderLength, replaceSource, forcedOffcutId, notes) => {
        await api.orderService.correctProfileOffcutEvent(order.orderId, {
            item_id: correcting.itemId, line_idx: correcting.lineIdx, event_idx: correcting.eventIdx,
            new_remainder_length: newRemainderLength, replace_source: replaceSource, forced_offcut_id: forcedOffcutId, notes,
        });
        await refreshOrder();
        showToast('Offcut correction saved', 'success');
    };

    const handleMarkItemDone = async (itemId) => {
        try {
            await api.orderService.markCuttingDone([itemId]);
            await refreshOrder();
            showToast('Cutting reported done', 'success');
        } catch (err) {
            showToast(err.response?.data?.detail || 'Failed to report cutting done.', 'error');
        }
    };

    const handleMarkOrderDone = async () => {
        try {
            await api.orderService.markOrderCuttingDone(order.orderId);
            await refreshOrder();
            showToast('Order cutting reported done', 'success');
        } catch (err) {
            showToast(err.response?.data?.detail || 'Failed to report cutting done.', 'error');
        }
    };

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
    // Cashier can view the summary but not edit or cancel — read-only + Add To only
    const canEditOrCancel = ['manager', 'ceo', 'admin'].includes(user?.role);
    // Once any item has actually been cut, the order can no longer be safely edited/cancelled
    // (both restore stock for every item, which would fabricate inventory for a piece that's
    // already been physically cut) — see the backend guard in update_order/cancel_order_with_pin.
    const anyItemCut = order.items?.some(i => i.cuttingCompletedAt) || false;
    const anyItemPending = order.items?.some(i => i.cuttingCompleted === false) || false;
    // Mirrors the backend's 7-day cutoff in cancel_order_with_pin — cancelling an
    // order that old is no longer allowed, so hide the option before the user tries.
    const orderTooOldToCancel = (new Date() - new Date(order.created_at)) > 7 * 24 * 60 * 60 * 1000;

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
                padding: 'clamp(1rem, 4vw, 1.5rem) clamp(1rem, 4vw, 2rem)', borderBottom: '1px solid rgba(255,255,255,0.07)',
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
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', flexWrap: 'wrap' }}>
                        <h1 style={{ fontSize: 'clamp(1.1rem, 4vw, 1.375rem)', fontWeight: 800, color: '#f1f5f9', margin: 0, letterSpacing: '-0.025em' }}>Order {order.orderId}</h1>
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

                {!isCancelled && (
                    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: '0.375rem' }}>
                        <div style={{ display: 'flex', gap: '0.625rem', flexWrap: 'wrap', justifyContent: 'flex-end' }}>
                            {canMarkCuttingDone && anyItemPending && (
                                <button onClick={handleMarkOrderDone} style={{
                                    padding: '0.625rem 1.25rem', borderRadius: '0.75rem',
                                    background: 'rgba(34,197,94,0.08)', border: '1px solid rgba(34,197,94,0.25)',
                                    color: '#4ade80', fontWeight: 700, fontSize: '0.82rem', cursor: 'pointer',
                                }}>✅ Mark Order Cutting Done</button>
                            )}
                            {canEditOrCancel && !anyItemCut && (
                                <>
                                    <button onClick={handleEdit} style={{
                                        padding: '0.625rem 1.25rem', borderRadius: '0.75rem',
                                        background: 'linear-gradient(135deg, #3b82f6, #06b6d4)', border: 'none',
                                        color: '#fff', fontWeight: 700, fontSize: '0.82rem', cursor: 'pointer',
                                        boxShadow: '0 2px 12px rgba(59,130,246,0.3)',
                                    }}>✏️ Edit Order</button>
                                    {!orderTooOldToCancel && (
                                        <button onClick={() => setShowCancel(true)} style={{
                                            padding: '0.625rem 1.25rem', borderRadius: '0.75rem',
                                            background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.2)',
                                            color: '#f87171', fontWeight: 700, fontSize: '0.82rem', cursor: 'pointer',
                                        }}>🚫 Cancel Order</button>
                                    )}
                                </>
                            )}
                        </div>
                        {canEditOrCancel && anyItemCut && (
                            <span style={{ fontSize: '0.7rem', color: '#475569' }}>Already cut — can no longer be edited or cancelled</span>
                        )}
                        {canEditOrCancel && !anyItemCut && orderTooOldToCancel && (
                            <span style={{ fontSize: '0.7rem', color: '#475569' }}>Order is over a week old — can no longer be cancelled</span>
                        )}
                    </div>
                )}
            </div>

            {/* Body */}
            <div style={{
                padding: 'clamp(1rem, 4vw, 1.75rem) clamp(1rem, 4vw, 2rem)', display: 'grid',
                gridTemplateColumns: isMobile ? 'minmax(0, 1fr)' : 'minmax(0, 1fr) 320px', gap: '1.5rem', alignItems: 'start',
            }}>
                {/* Items */}
                <div style={{
                    background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.07)',
                    borderRadius: '1.25rem', padding: '0.5rem clamp(1rem, 4vw, 1.5rem)',
                    minWidth: 0,
                }}>
                    <h3 style={{ fontSize: '0.68rem', fontWeight: 700, color: '#475569', letterSpacing: '0.1em', textTransform: 'uppercase', margin: '1rem 0 0' }}>
                        Items ({items.length})
                    </h3>
                    {items.length === 0 ? (
                        <p style={{ color: '#334155', fontSize: '0.82rem', padding: '1.5rem 0' }}>No items on this order.</p>
                    ) : (
                        items.map((item, idx) => (
                            <ItemRow key={idx} item={item} canCorrectOffcuts={canCorrectOffcuts} canMarkCuttingDone={canMarkCuttingDone}
                                onCorrect={setCorrecting} onMarkDone={handleMarkItemDone} />
                        ))
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
                        <Row label="Subtotal" value={`KSH ${(order.subtotal || 0).toFixed(0)}`} />
                        {order.discount > 0 && <Row label="Discount" value={`- KSH ${order.discount.toFixed(0)}`} />}
                        {order.VAT_status && <Row label="VAT" value={`KSH ${vatAmount.toFixed(0)}`} />}
                        <div style={{ borderTop: '1px solid rgba(255,255,255,0.08)', margin: '0.5rem 0' }} />
                        <Row label="Total" value={`KSH ${(order.total || 0).toFixed(0)}`} strong />
                        <Row label="Paid" value={`KSH ${(order.amountPaid || 0).toFixed(0)}`} />
                        <Row label="Balance Due" value={`KSH ${(order.balance || 0).toFixed(0)}`} strong={order.balance > 0} />
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

            {correcting && correcting.kind === 'glass' && (
                <CorrectOffcutModal
                    event={correcting.event}
                    productId={correcting.productId}
                    variantId={correcting.variantId}
                    onClose={() => setCorrecting(null)}
                    onConfirm={handleOffcutCorrected}
                />
            )}

            {correcting && correcting.kind === 'profile' && (
                <CorrectProfileOffcutModal
                    event={correcting.event}
                    productId={correcting.productId}
                    variantId={correcting.variantId}
                    onClose={() => setCorrecting(null)}
                    onConfirm={handleProfileOffcutCorrected}
                />
            )}
        </div>
    );
}
