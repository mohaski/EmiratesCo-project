import { useMemo, useState, useEffect, useCallback } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { useProducts } from '../context/ProductContext';
import { useOrders } from '../context/OrderContext';
import OrderChanges from '../components/orders/OrderChanges';
import { useAuth } from '../context/AuthContext';
import { ROUTE_ROLES } from '../config/routePermissions';
import { useToast } from '../context/ToastContext';
import api from '../services/api';
import { wsEvents } from '../utils/wsEvents';
import useCancelOrderFlow from '../hooks/useCancelOrderFlow';
import CorrectOffcutModal from '../components/orders/CorrectOffcutModal';
import CorrectProfileOffcutModal from '../components/orders/CorrectProfileOffcutModal';
import CuttingInstructions from '../components/orders/CuttingInstructions';
import { REVIEW_THEME, groupJointGlassSources } from '../utils/cuttingInstructionFormat';
import { BUCKET_ORDER, BUCKET_META, bucketOf } from '../utils/receiptCategories';
import { getProfileColorHex, getContrastText, getCategoryAccent, tileGradient, hexToRgba } from '../utils/colors';
import { extractErrorMessage } from '../utils/toast';
import { parseServerDate } from '../utils/dates';

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

const CorrectButton = ({ onClick }) => (
    <button
        onClick={onClick}
        style={{
            flexShrink: 0, background: 'rgba(245,158,11,0.1)', border: '1px solid rgba(245,158,11,0.25)',
            color: '#fbbf24', fontSize: '0.68rem', fontWeight: 700, padding: '2px 9px',
            borderRadius: '100px', cursor: 'pointer', whiteSpace: 'nowrap',
        }}
    >Correct</button>
);

// Same department-toggle pattern as CheckoutPage's CategoryToggle — a department
// with no items in this order stays disabled, same "can't pick what isn't there" rule.
const DeptToggle = ({ bucket, label, icon, color, checked, disabled, onToggle }) => (
    <button
        type="button"
        disabled={disabled}
        onClick={() => onToggle(bucket)}
        title={disabled ? `No ${label.toLowerCase()} items on this order` : undefined}
        style={{
            display: 'flex', alignItems: 'center', gap: '0.5rem',
            padding: '0.625rem 0.875rem',
            background: disabled ? 'rgba(255,255,255,0.02)' : checked ? `${color}15` : 'rgba(255,255,255,0.03)',
            border: disabled ? '1px solid rgba(255,255,255,0.05)' : checked ? `1px solid ${color}50` : '1px solid rgba(255,255,255,0.08)',
            borderRadius: '0.75rem',
            cursor: disabled ? 'not-allowed' : 'pointer',
            opacity: disabled ? 0.4 : 1,
            transition: 'all 0.2s ease',
            flex: 1,
        }}
    >
        <span style={{ fontSize: '1rem' }}>{icon}</span>
        <span style={{ fontSize: '0.78rem', fontWeight: 700, color: disabled ? '#475569' : checked ? color : '#64748b' }}>{label}</span>
    </button>
);

const ItemRow = ({ item, canCorrectOffcuts, canMarkCuttingDone, onCorrect, onMarkDone }) => {
    const lineItems = item.details?.lineItems || [];
    const attributes = item.details?.attributes;
    const extras = item.details?.extras;
    const pendingCut = item.cuttingCompleted === false;
    const colorHex = getProfileColorHex(item.details?.color);
    const accent = getCategoryAccent(item.category);
    const tileText = colorHex ? getContrastText(colorHex) : accent;
    const initial = item.name?.trim()?.[0]?.toUpperCase() || '?';

    return (
    <div style={{ padding: '1rem 0', borderBottom: '1px solid rgba(255,255,255,0.05)' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
            <div className="product-tile" style={{
                width: '44px', height: '44px', borderRadius: '10px', flexShrink: 0,
                background: colorHex ? tileGradient(colorHex) : hexToRgba(accent, 0.1),
                border: `1px solid ${colorHex ? 'rgba(255,255,255,0.15)' : hexToRgba(accent, 0.25)}`,
                boxShadow: colorHex ? 'inset 0 1px 0 rgba(255,255,255,0.15), inset 0 -4px 8px rgba(0,0,0,0.16)' : 'none',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
            }}>
                <span style={{ position: 'relative', zIndex: 1, fontSize: '1rem', fontWeight: 800, color: tileText }}>{initial}</span>
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

        {/* 1D (bar/profile) cutting instructions — rendered per line, unaffected
            by joint-packing (that's a 2D/glass-only feature — see
            groupJointGlassSources). */}
        {canCorrectOffcuts && lineItems.map((li, lineIdx) => {
            const sources = (li.offcut_sources || []).filter(s => !('cuts' in s));
            if (sources.length === 0) return null;
            return (
                <div key={lineIdx} style={{ marginLeft: '56px', marginTop: '0.375rem' }}>
                    <CuttingInstructions
                        sources={sources}
                        theme={REVIEW_THEME}
                        renderActions={(src) => {
                            const eventIdx = (li.offcut_sources || []).indexOf(src);
                            if (src.superseded) return null;
                            return (
                                <CorrectButton onClick={() => onCorrect({ kind: 'profile', itemId: item.itemId, productId: item.productId, variantId: item.variantId, lineIdx, eventIdx, event: src })} />
                            );
                        }}
                    />
                </div>
            );
        })}

        {/* 2D (glass) cutting instructions — merged per physical sheet, so a
            sheet joint-packed across several cut-lines shows once, with every
            cut and the real remainder(s) together (see groupJointGlassSources),
            instead of splitting back into per-line fragments where only the
            "owning" line ever carries a correctable remainder. */}
        {canCorrectOffcuts && groupJointGlassSources(lineItems).map((group, gi) => (
            <div key={`glass-${gi}`} style={{ marginLeft: '56px', marginTop: '0.375rem' }}>
                <CuttingInstructions
                    sources={[group.mergedSrc]}
                    theme={REVIEW_THEME}
                    renderActions={(src) => {
                        const correctable = (src.remainders_created || []).length > 0;
                        if (!correctable) return null;
                        return (
                            <CorrectButton onClick={() => onCorrect({
                                kind: 'glass', itemId: item.itemId, productId: item.productId, variantId: item.variantId,
                                lineIdx: group.ownerLineIdx, eventIdx: group.ownerEventIdx, cutOrigins: group.cutOrigins, event: src,
                            })} />
                        );
                    }}
                />
            </div>
        ))}
    </div>
    );
};

export default function OrderSummaryPage() {
    const location = useLocation();
    const navigate = useNavigate();
    const { user } = useAuth();
    const { products: PRODUCTS } = useProducts();
    const { cancelOrder } = useOrders();
    // Same sequence as the Orders list (plan -> cut confirmation -> PIN -> 409 retry).
    // Called up here, above the `if (!order) return` below: a hook after an early return
    // runs on some renders and not others, which React rejects.
    const { startCancel, cancelFlowModals } = useCancelOrderFlow({
        cancelOrder,
        onCancelled: () => navigate('/orders'),
    });
    const showToast = useToast();
    const [correcting, setCorrecting] = useState(null); // {itemId, lineIdx, eventIdx, event}

    const [windowWidth, setWindowWidth] = useState(() => window.innerWidth);
    useEffect(() => {
        const h = () => setWindowWidth(window.innerWidth);
        window.addEventListener('resize', h, { passive: true });
        return () => window.removeEventListener('resize', h);
    }, []);
    const isMobile = windowWidth < 768;

    const [order, setOrder] = useState(location.state?.order || null);
    // A cancelled order's stock/offcuts were already restored — its cutting
    // records no longer describe anything live, so there's nothing to correct.
    const canCorrectOffcuts = ['manager', 'ceo', 'admin'].includes(user?.role) && order?.status !== 'cancelled';
    const canMarkCuttingDone = ['cashier', 'admin'].includes(user?.role);

    const orderId = order?.orderId;
    const refreshOrder = useCallback(async () => {
        if (!orderId) return;
        const full = await api.orderService.getOrder(orderId);
        setOrder(prev => ({ ...full, id: full.orderId, customer: prev?.customer }));
    }, [orderId]);

    // Another device editing, cancelling or correcting this order: show its current records,
    // so a correction is never made against ones that have moved.
    useEffect(() => {
        let timer = null;
        const off = wsEvents.on('orders_updated', () => {
            clearTimeout(timer);
            timer = setTimeout(() => { refreshOrder().catch(() => {}); }, 400);
        });
        return () => { off(); clearTimeout(timer); };
    }, [refreshOrder]);

    // The cutting event as this screen shows it. Events are addressed by position and a
    // correction shifts positions, so the server refuses (409) if what is there now differs.
    const withExpectedEvent = (payload) => {
        const item = (order?.items || []).find(i => i.itemId === payload.item_id);
        const event = item?.details?.lineItems?.[payload.line_idx]?.offcut_sources?.[payload.event_idx];
        return event ? { ...payload, expected_event: event } : payload;
    };

    // Saved first, refreshed second: a failed refresh must not read as a failed correction —
    // retrying would apply it twice.
    const afterCorrection = async () => {
        showToast('Offcut correction saved', 'success');
        try { await refreshOrder(); }
        catch { showToast('Saved — but the order could not be reloaded. Reload the page before correcting again.', 'warning'); }
    };

    // The modals build the full request (see correctionPayload in SourceCorrectionFields);
    // the same payload drives their live preview.
    const handleOffcutCorrected = async (payload) => {
        await api.orderService.correctOffcutEvent(order.orderId, withExpectedEvent(payload));
        await afterCorrection();
    };

    const handleProfileOffcutCorrected = async (payload) => {
        await api.orderService.correctProfileOffcutEvent(order.orderId, withExpectedEvent(payload));
        await afterCorrection();
    };

    const handleMarkItemDone = async (itemId) => {
        try {
            await api.orderService.markCuttingDone([itemId]);
            await refreshOrder();
            showToast('Cutting reported done', 'success');
        } catch (err) {
            showToast(extractErrorMessage(err, 'Failed to report cutting done.'), 'error');
        }
    };

    const handleMarkOrderDone = async () => {
        try {
            await api.orderService.markOrderCuttingDone(order.orderId);
            await refreshOrder();
            showToast('Order cutting reported done', 'success');
        } catch (err) {
            showToast(extractErrorMessage(err, 'Failed to report cutting done.'), 'error');
        }
    };

    const items = useMemo(() => {
        if (!order?.items) return [];
        return order.items.map(item => {
            const product = PRODUCTS.find(p => p.id === item.productId);
            return {
                ...item,
                name: product?.name ?? item.details?.name ?? `Product #${item.productId}`,
                category: product?.category ?? null,
            };
        });
    }, [order, PRODUCTS]);

    // Which departments actually have items on this order — same rule ReceiptPage's
    // Checkout flow uses, so a department with nothing to print stays disabled.
    const presentBuckets = useMemo(() => {
        const present = { profile: false, glass: false, accessory: false };
        items.forEach(item => {
            const bucket = bucketOf(item.category);
            if (bucket) present[bucket] = true;
        });
        return present;
    }, [items]);

    // Starts with every department the order actually has ticked (Reprint used to open with
    // none selected and refuse to print until each was ticked by hand).
    const [receiptCategories, setReceiptCategories] = useState(() => ({ ...presentBuckets }));
    // Re-sync whenever the set of present departments changes (order loads/reloads) —
    // default every present department to checked, same as Checkout.
    const [syncedPresentBuckets, setSyncedPresentBuckets] = useState(presentBuckets);
    if (presentBuckets !== syncedPresentBuckets) {
        setSyncedPresentBuckets(presentBuckets);
        setReceiptCategories({ ...presentBuckets });
    }
    const toggleReceiptCategory = (bucket) => setReceiptCategories(prev => ({ ...prev, [bucket]: !prev[bucket] }));

    // Reprinting a worksheet is the same permission boundary as generating one at
    // checkout (/checkout/receipt is manager/cashier-only — see routePermissions.js).
    const canPrintReceipt = ['manager', 'cashier'].includes(user?.role);
    const handlePrintReceipt = () => {
        navigate('/checkout/receipt', {
            state: {
                orderId: order.orderId,
                cartItems: items,
                customer: order.customer || { name: order.customerName },
                categories: receiptCategories,
                mode: 'reprint',
            },
        });
    };

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
    // order.subtotal is stored AFTER the discount, so VAT is simply total - subtotal, and the
    // goods before discount are subtotal + discount (Subtotal - Discount + VAT = Total).
    const vatAmount = order.VAT_status ? Math.max(0, (order.total || 0) - (order.subtotal || 0)) : 0;
    const grossSubtotal = (order.subtotal || 0) + (order.discount || 0);
    // Cashier can view the summary but not edit or cancel — read-only + Add To only
    const canEditOrCancel = ['manager', 'ceo', 'admin'].includes(user?.role);
    // Editing happens in the Sales terminal - a role that can't open it (CEO, admin) would
    // just be bounced to the dashboard, so it doesn't get the button.
    const canEdit = canEditOrCancel && ROUTE_ROLES['/sales'].includes(user?.role);
    // An order with cut material CAN be edited and cancelled: each cut line is confirmed on
    // the floor first (ResolveCutsModal), and an already-cut bar is never credited back whole.
    // This page used to hide both buttons once anything was cut — a copy of a backend guard
    // that has since been removed, which left orders with cut material stuck.
    const anyItemPending = order.items?.some(i => i.cuttingCompleted === false) || false;
    // A completed order is finished business: the backend refuses to edit it (update_order),
    // though it can still be cancelled inside the window, same as cancel_order_with_pin.
    const isCompleted = order.status === 'completed';
    // Mirrors the backend's 7-day cutoff in cancel_order_with_pin — cancelling an
    // order that old is no longer allowed, so hide the option before the user tries.
    const orderTooOldToCancel = (new Date() - parseServerDate(order.created_at)) > 7 * 24 * 60 * 60 * 1000;

    // Loaded fresh: the order on this screen can be a list row (no items, no version) or
    // older than another device's change.
    const handleEdit = async () => {
        try {
            const full = await api.orderService.getOrder(order.orderId);
            navigate('/sales', { state: { mode: 'edit', editNonce: Date.now(), orderData: { ...full, id: full.orderId, customer: order.customer } } });
        } catch {
            showToast('Could not load this order to edit it. Check the connection and try again.', 'error');
        }
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
                        <h1 style={{ fontSize: 'clamp(1.1rem, 4vw, 1.375rem)', fontWeight: 800, color: '#f1f5f9', margin: 0, letterSpacing: '-0.025em' }}>Order {order.orderNo ?? order.orderId}</h1>
                        <span style={{
                            fontSize: '0.65rem', fontWeight: 700, padding: '2px 10px', borderRadius: '100px',
                            background: statusColor.bg, border: `1px solid ${statusColor.border}`, color: statusColor.text,
                            letterSpacing: '0.06em', textTransform: 'uppercase',
                        }}>{order.status}</span>
                    </div>
                    <p style={{ fontSize: '0.78rem', color: '#475569', margin: '2px 0 0' }}>
                        {parseServerDate(order.created_at).toLocaleString('en-GB', { day: 'numeric', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit' })}
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
                            {canEditOrCancel && (
                                <>
                                    {!isCompleted && canEdit && <button onClick={handleEdit} style={{
                                        padding: '0.625rem 1.25rem', borderRadius: '0.75rem',
                                        background: 'linear-gradient(135deg, #3b82f6, #06b6d4)', border: 'none',
                                        color: '#fff', fontWeight: 700, fontSize: '0.82rem', cursor: 'pointer',
                                        boxShadow: '0 2px 12px rgba(59,130,246,0.3)',
                                    }}>✏️ Edit Order</button>}
                                    {!orderTooOldToCancel && (
                                        <button onClick={() => startCancel(order)} style={{
                                            padding: '0.625rem 1.25rem', borderRadius: '0.75rem',
                                            background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.2)',
                                            color: '#f87171', fontWeight: 700, fontSize: '0.82rem', cursor: 'pointer',
                                        }}>🚫 Cancel Order</button>
                                    )}
                                </>
                            )}
                        </div>
                        {canEditOrCancel && isCompleted && (
                            <span style={{ fontSize: '0.7rem', color: '#475569' }}>Order is completed — it can no longer be edited</span>
                        )}
                        {canEditOrCancel && orderTooOldToCancel && (
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

                    {canPrintReceipt && !isCancelled && (
                        <Card title="Print Receipt">
                            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
                                <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
                                    {BUCKET_ORDER.map(bucket => (
                                        <DeptToggle
                                            key={bucket}
                                            bucket={bucket}
                                            label={BUCKET_META[bucket].label.replace(/ (Cutting|Prep)$/, '')}
                                            icon={BUCKET_META[bucket].icon}
                                            color={BUCKET_META[bucket].color}
                                            checked={receiptCategories[bucket]}
                                            disabled={!presentBuckets[bucket]}
                                            onToggle={toggleReceiptCategory}
                                        />
                                    ))}
                                </div>
                                <button
                                    onClick={handlePrintReceipt}
                                    disabled={!BUCKET_ORDER.some(b => receiptCategories[b])}
                                    style={{
                                        padding: '0.625rem 1rem', borderRadius: '0.75rem', border: 'none',
                                        cursor: BUCKET_ORDER.some(b => receiptCategories[b]) ? 'pointer' : 'not-allowed',
                                        background: BUCKET_ORDER.some(b => receiptCategories[b]) ? 'linear-gradient(135deg, rgba(245,158,11,0.85), rgba(234,88,12,0.85))' : 'rgba(255,255,255,0.06)',
                                        color: BUCKET_ORDER.some(b => receiptCategories[b]) ? '#fff' : '#475569',
                                        fontWeight: 700, fontSize: '0.82rem', transition: 'all 0.2s',
                                    }}
                                >🖨️ Print Receipt</button>
                            </div>
                        </Card>
                    )}

                    <Card title="Payment">
                        <Row label="Method" value={order.paymentMethod || '—'} />
                        <Row label="Status" value={order.paymentStatus} />
                        <Row label="VAT" value={order.VAT_status ? 'Included' : 'Not applied'} />
                    </Card>

                    <Card title="Totals">
                        <Row label="Subtotal" value={`KSH ${grossSubtotal.toFixed(0)}`} />
                        {order.discount > 0 && <Row label="Discount" value={`- KSH ${order.discount.toFixed(0)}`} />}
                        {order.VAT_status && <Row label="VAT" value={`KSH ${vatAmount.toFixed(0)}`} />}
                        <div style={{ borderTop: '1px solid rgba(255,255,255,0.08)', margin: '0.5rem 0' }} />
                        <Row label="Total" value={`KSH ${(order.total || 0).toFixed(0)}`} strong />
                        <Row label="Paid" value={`KSH ${(order.amountPaid || 0).toFixed(0)}`} />
                        <Row label="Balance Due" value={`KSH ${(order.balance || 0).toFixed(0)}`} strong={order.balance > 0} />
                    </Card>

                    {canEditOrCancel && (
                        <Card title="Changes to this order">
                            <OrderChanges orderId={order.orderId} onChanged={refreshOrder}
                                notify={m => showToast(m, 'success')} />
                        </Card>
                    )}
                </div>
            </div>

            {cancelFlowModals}

            {correcting && correcting.kind === 'glass' && (
                <CorrectOffcutModal
                    event={correcting.event}
                    orderId={order.orderId}
                    target={correcting}
                    productId={correcting.productId}
                    variantId={correcting.variantId}
                    onClose={() => setCorrecting(null)}
                    onConfirm={handleOffcutCorrected}
                />
            )}

            {correcting && correcting.kind === 'profile' && (
                <CorrectProfileOffcutModal
                    event={correcting.event}
                    orderId={order.orderId}
                    target={correcting}
                    productId={correcting.productId}
                    variantId={correcting.variantId}
                    onClose={() => setCorrecting(null)}
                    onConfirm={handleProfileOffcutCorrected}
                />
            )}
        </div>
    );
}
