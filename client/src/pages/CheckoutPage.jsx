import React, { useState, useEffect, useMemo, useCallback, useRef, memo } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { useCart } from '../context/CartContext';
import { useAuth } from '../context/AuthContext';
import { useOrders } from '../context/OrderContext';
import { mapItemForBackend, editSignature } from '../utils/orderItemMapping';
import { answersComplete, answersPayload } from '../utils/cutAnswers';
import { useCartTotals } from '../hooks/useCartTotals';
import { ceilAmount } from '../utils/money';
import { BUCKET_ORDER, BUCKET_META, bucketOf } from '../utils/receiptCategories';
import { getProfileColorHex, getContrastText, getCategoryAccent, tileGradient, hexToRgba } from '../utils/colors';
import api from '../services/api';
import ResolveCutsModal from '../components/orders/ResolveCutsModal';

function useWindowWidth() {
    const [width, setWidth] = useState(() => (typeof window !== 'undefined' ? window.innerWidth : 1280));
    useEffect(() => {
        const handler = () => setWidth(window.innerWidth);
        window.addEventListener('resize', handler, { passive: true });
        return () => window.removeEventListener('resize', handler);
    }, []);
    return width;
}

/* ── Review Item Card ── */
const ReviewItemCard = memo(({ item, index, onRemove, isMobile }) => {
    const colorHex = getProfileColorHex(item.details?.color);
    const accent = getCategoryAccent(item.category);
    const tileText = colorHex ? getContrastText(colorHex) : accent;
    const initial = item.name?.trim()?.[0]?.toUpperCase() || '?';

    return (
    <div style={{
        display: 'grid',
        gridTemplateColumns: isMobile ? 'minmax(0, 1fr)' : (onRemove ? '1fr auto auto auto' : '1fr auto auto'),
        gap: isMobile ? '0.625rem' : '1rem',
        padding: isMobile ? '1rem 1.25rem' : '1.25rem 1.5rem',
        borderBottom: '1px solid rgba(255,255,255,0.05)',
        transition: 'background 0.15s ease',
        alignItems: isMobile ? 'stretch' : 'center',
    }}
        onMouseEnter={e => { e.currentTarget.style.background = 'rgba(255,255,255,0.02)'; }}
        onMouseLeave={e => { e.currentTarget.style.background = 'transparent'; }}
    >
        {/* Item Info */}
        <div style={{ display: 'flex', gap: '1rem', alignItems: 'center', minWidth: 0 }}>
            <div className="product-tile" style={{
                width: '48px', height: '48px', borderRadius: '10px', flexShrink: 0,
                background: colorHex ? tileGradient(colorHex) : hexToRgba(accent, 0.1),
                border: `1px solid ${colorHex ? 'rgba(255,255,255,0.15)' : hexToRgba(accent, 0.25)}`,
                boxShadow: colorHex ? 'inset 0 1px 0 rgba(255,255,255,0.15), inset 0 -4px 8px rgba(0,0,0,0.16)' : 'none',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
            }}>
                <span style={{ position: 'relative', zIndex: 1, fontSize: '1.05rem', fontWeight: 800, color: tileText }}>{initial}</span>
            </div>
            <div style={{ minWidth: 0 }}>
                <div style={{ fontSize: '0.875rem', fontWeight: 700, color: '#e2e8f0', marginBottom: '4px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {item.name}
                </div>
                <div style={{ display: 'flex', gap: '4px', flexWrap: 'wrap' }}>
                    {item.details?.color && (
                        <span style={{ fontSize: '0.65rem', fontWeight: 600, padding: '1px 6px', background: 'rgba(255,255,255,0.07)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: '4px', color: '#94a3b8', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                            {item.details.color}
                        </span>
                    )}
                    {item.details?.thickness && (
                        <span style={{ fontSize: '0.65rem', fontWeight: 600, padding: '1px 6px', background: 'rgba(59,130,246,0.1)', border: '1px solid rgba(59,130,246,0.2)', borderRadius: '4px', color: '#60a5fa', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                            {item.details.thickness}
                        </span>
                    )}
                </div>
            </div>
        </div>

        {/* Breakdown */}
        {item.details?.lineItems && (
            <div style={{ minWidth: '180px', fontSize: '0.72rem', fontFamily: 'var(--font-mono)', color: '#64748b' }}>
                {item.details.lineItems.map((li, idx) => (
                    <div key={idx} style={{ display: 'flex', justifyContent: 'space-between', gap: '0.5rem', marginBottom: '2px' }}>
                        <span style={{ color: '#475569' }}>{li.label}</span>
                        <span style={{ color: '#94a3b8', whiteSpace: 'nowrap' }}>
                            {li.qty}x{li.rate.toFixed(0)} = <span style={{ color: '#cbd5e1', fontWeight: 600 }}>KSH{li.total.toFixed(0)}</span>
                        </span>
                    </div>
                ))}
            </div>
        )}

        {/* Total */}
        <div style={{ textAlign: 'right', flexShrink: 0 }}>
            <div style={{ fontSize: '1rem', fontWeight: 800, color: '#f1f5f9', letterSpacing: '-0.01em', fontFamily: 'var(--font-mono)' }}>
                KSH {Math.ceil(item.totalPrice || 0)}
            </div>
        </div>

        {/* Remove */}
        {onRemove && (
            <button onClick={() => onRemove(index)} title="Remove item" style={{
                background: 'none', border: 'none', cursor: 'pointer', color: '#475569',
                fontSize: '1.1rem', padding: '0.25rem', lineHeight: 1, transition: 'color 0.15s',
            }}
            onMouseEnter={e => { e.currentTarget.style.color = '#f87171'; }}
            onMouseLeave={e => { e.currentTarget.style.color = '#475569'; }}>×</button>
        )}
    </div>
    );
});

/* ── Department Category Toggle ── */
const CategoryToggle = ({ bucket, label, icon, color, checked, disabled, onToggle }) => (
    <button
        type="button"
        disabled={disabled}
        onClick={() => onToggle(bucket)}
        title={disabled ? `No ${label.toLowerCase()} items in this order` : undefined}
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

/* ── Payment Method Button ── */
const PaymentMethodBtn = ({ method, label, icon, selected, color, onClick }) => (
    <button
        onClick={() => onClick(method)}
        style={{
            display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
            gap: '0.5rem', padding: '1rem 0.75rem',
            background: selected ? `${color}15` : 'rgba(255,255,255,0.03)',
            border: selected ? `1px solid ${color}50` : '1px solid rgba(255,255,255,0.08)',
            borderRadius: '0.875rem',
            cursor: 'pointer',
            transition: 'all 0.2s ease',
            boxShadow: selected ? `0 0 0 1px ${color}25, 0 4px 12px ${color}15` : 'none',
            flex: 1,
        }}
        onMouseEnter={e => { if (!selected) { e.currentTarget.style.background = 'rgba(255,255,255,0.06)'; e.currentTarget.style.borderColor = 'rgba(255,255,255,0.15)'; } }}
        onMouseLeave={e => { if (!selected) { e.currentTarget.style.background = 'rgba(255,255,255,0.03)'; e.currentTarget.style.borderColor = 'rgba(255,255,255,0.08)'; } }}
    >
        <span style={{ fontSize: '1.5rem' }}>{icon}</span>
        <span style={{ fontSize: '0.75rem', fontWeight: 700, color: selected ? color : '#64748b', letterSpacing: '0.04em', textTransform: 'uppercase' }}>{label}</span>
    </button>
);

export default function CheckoutPage() {
    const location = useLocation();
    const navigate = useNavigate();
    const windowWidth = useWindowWidth();
    const isMobile = windowWidth < 768;

    const { user } = useAuth();
    const { cartItems: ctxCartItems, customer: ctxCustomer, taxEnabled: ctxTaxEnabled, clearCart, editSession, removeFromCart } = useCart();
    const { addOrder, updateOrder } = useOrders();
    const { mode, originalTotal = 0, originalBalance = 0 } = location.state || {};
    const editOrderId = mode === 'edit' ? (location.state?.orderData?.id ?? location.state?.orderData?.orderId ?? null) : null;
    // When arriving from invoice-convert or link mode, items & customer come via navigation state
    const fromInvoice = Boolean(location.state?.cartItems);
    // Sales, edit, link and convert-from-Sales all check out the live cart (fromCart): reading
    // it from CartContext means a line removed here is gone from the cart too, and once the
    // sale clears the cart a stale history entry can't bring a filled checkout back.
    // Converting straight from Order History hands over the invoice's items without touching
    // the cart (which may hold a different sale in progress) — those stay a local copy.
    const fromCart = Boolean(location.state?.fromCart);
    const [localItems, setLocalItems] = useState(() => fromInvoice ? location.state.cartItems : ctxCartItems);
    const cartItems = fromCart ? ctxCartItems : localItems;
    const customer = fromInvoice ? location.state.customer : ctxCustomer;
    const enableTax = location.state?.enableTax !== undefined ? location.state.enableTax : ctxTaxEnabled;
    const parentOrderId = location.state?.parentOrderId ?? null;
    const sourceInvoiceId = location.state?.sourceInvoiceId ?? null;

    const removeItem = useCallback((index) => {
        if (fromCart) removeFromCart(index);
        else setLocalItems(prev => prev.filter((_, i) => i !== index));
    }, [fromCart, removeFromCart]);

    // Editing an order that consumed cut material: the confirmation is asked at SUBMIT,
    // not on entry, because only the final cart says which items actually change. An item
    // the cart still contains unchanged is left completely alone by update_order -- its
    // stock, offcut chain and cutting status never move -- so asking about it would be
    // noise. The backend does the matching (POST .../reversal-plan with the cart), so the
    // question and the eventual reversal can never disagree.
    const [cutsPlan, setCutsPlan] = useState(null);
    // Why the confirmation reopened (a 409: the material moved while it was being answered).
    // Shown inside the modal, where the cashier is looking — not on the page behind it.
    const [cutsNotice, setCutsNotice] = useState(null);
    // Cut answers already given in the calculators, pre-filled into the dialog.
    const [cutsInitial, setCutsInitial] = useState(null);

    const [loading, setLoading] = useState(false);
    const [paymentError, setPaymentError] = useState(null);
    const [paymentMethod, setPaymentMethod] = useState(null);
    // An edit (or a quote conversion) starts from the discount the order already has —
    // starting blank silently dropped it, and the customer was charged it again.
    const [discount, setDiscount] = useState(() => {
        const carried = Number(location.state?.discount ?? 0);
        return carried > 0 ? String(carried) : '';
    });
    const [isPartial, setIsPartial] = useState(false);
    const [amountPaid, setAmountPaid] = useState('');
    const [cashAmount, setCashAmount] = useState('');

    // Which departments actually have items in this order — buckets with none stay disabled
    const presentBuckets = useMemo(() => {
        const present = { profile: false, glass: false, accessory: false };
        cartItems.forEach(item => {
            const bucket = bucketOf(item.category);
            if (bucket) present[bucket] = true;
        });
        return present;
    }, [cartItems]);

    const [receiptCategories, setReceiptCategories] = useState(() => ({ ...presentBuckets }));
    const toggleReceiptCategory = useCallback((bucket) => {
        setReceiptCategories(prev => ({ ...prev, [bucket]: !prev[bucket] }));
    }, []);

    const isRegistered = useMemo(() => {
        if (!customer?.id) return false;
        return ['individual', 'cooperate'].includes(customer.type);
    }, [customer]);

    const { subtotal: rawSubtotal } = useCartTotals(cartItems, enableTax);

    const financials = useMemo(() => {
        // Never negative (that would be a surcharge) and never more than the goods.
        const discountValue = Math.min(Math.max(0, ceilAmount(parseFloat(discount) || 0)), ceilAmount(rawSubtotal));
        const netTaxable = Math.max(0, rawSubtotal - discountValue);
        const effectiveTax = enableTax ? ceilAmount(netTaxable * 0.16) : 0;
        const total = netTaxable + effectiveTax;
        const effectiveTotal = mode === 'edit' ? (total - originalTotal) : total;
        const isRefund = effectiveTotal < 0;
        const refundAmount = isRefund ? ceilAmount(-effectiveTotal) : 0;
        // A partial payment is between nothing and the full amount due — the server refuses
        // anything outside that, so it is clamped here rather than typed past.
        const partialEntered = Math.max(0, ceilAmount(parseFloat(amountPaid) || 0));
        const currentPayable = isRefund ? 0 : (isPartial ? Math.min(partialEntered, Math.max(0, effectiveTotal)) : Math.max(0, effectiveTotal));
        const balance = Math.max(0, ceilAmount(total - ((mode === 'edit' ? originalTotal : 0) + currentPayable)));
        // Amount the cash/mpesa split inputs divide up — the payable when charging,
        // the payout when refunding. Both directions share the same split UI.
        const payableAmount = isRefund ? refundAmount : currentPayable;
        const mpesaAutoAmount = Math.max(0, ceilAmount(payableAmount - (parseFloat(cashAmount) || 0)));
        // Signed amount to send the backend: positive = collected now, negative = refunded now.
        const netPayment = isRefund ? -refundAmount : currentPayable;
        return { subtotal: rawSubtotal, tax: effectiveTax, discountValue, total, currentPayable, balance, mpesaAutoAmount, effectiveTotal, originalTotal, isRefund, refundAmount, payableAmount, netPayment };
    }, [rawSubtotal, enableTax, discount, isPartial, amountPaid, cashAmount, mode, originalTotal]);

    const { subtotal, tax, discountValue, total, currentPayable, balance, mpesaAutoAmount, effectiveTotal, isRefund, refundAmount, payableAmount, netPayment } = financials;

    // In edit mode: detect whether anything actually changed vs the original order
    // Compared with the fingerprint taken when the edit was opened (items, customer, VAT,
    // discount). The old check compared against items this page was never given, so it
    // always said "changed". A session saved before fingerprints existed counts as changed.
    const hasOrderChanged = useMemo(() => {
        if (!editOrderId) return true;
        const original = editSession && String(editSession.orderId) === String(editOrderId) ? editSession.originalSig : null;
        if (!original) return true;
        return editSignature(cartItems, { customerId: customer?.id ?? null, vat: enableTax, discount: discountValue }) !== original;
    }, [editOrderId, editSession, cartItems, customer, enableTax, discountValue]);

    const submitOrder = useCallback(async (cutConfirmations, planToken) => {
        setLoading(true);
        setPaymentError(null);
        try {
            const orderData = {
                customer, items: cartItems, servedBy: user?.userId, VAT_status: enableTax,
                parentOrderId,
                sourceInvoiceId,
                totals: { subtotal, tax, total, discount: discountValue, paid: netPayment, balance },
                cutConfirmations: cutConfirmations || null,
                planToken: planToken || null,
                // From the session, else from the page state SalesDashboard passed: an edit
                // submit always carries a version, so the server's conflict check is never skipped.
                orderVersion: editSession && String(editSession.orderId) === String(editOrderId)
                    ? editSession.version : (location.state?.orderVersion ?? null),
                payment: {
                    method: paymentMethod, isPartial,
                    details: paymentMethod === 'split'
                        ? { cash: (isRefund ? -1 : 1) * (parseFloat(cashAmount) || 0), mpesa: (isRefund ? -1 : 1) * mpesaAutoAmount }
                        : null
                },
                mode: mode || 'new'
            };

            const response = editOrderId
                ? await updateOrder(editOrderId, orderData)
                : await addOrder(orderData);

            // replace: Back from the receipt must not land on a filled checkout that a second
            // Confirm would turn into a duplicate sale.
            navigate('/checkout/receipt', {
                replace: true,
                state: {
                    orderId: response?.orderId,
                    cartItems,
                    customer,
                    categories: receiptCategories,
                    totals: { subtotal, tax, total, discount: discountValue },
                    enableTax,
                    mode: mode || 'new',
                },
            });
            clearCart();
        } catch (err) {
            console.error('Payment failed', err);
            if (err?.response?.status === 409 && err?.response?.data?.detail?.plan) {
                // The cut material moved while the operator was confirming. Reopen the
                // confirmation on the plan the server just handed back; confirming it
                // resubmits.
                setCutsNotice(err.response.data.detail.message || null);
                setCutsPlan(err.response.data.detail.plan);
                return;
            }
            // Any 4xx the server explains in words is written for the cashier — the cut
            // validator's 422s, but also "Cannot edit a completed order", an unavailable
            // offcut, insufficient stock. Only fall back to the generic line when there is
            // no such message (a 500, a network failure).
            const status = err?.response?.status;
            const detail = err?.response?.data?.detail;
            setPaymentError(status >= 400 && status < 500 && typeof detail === 'string'
                ? detail
                : 'Failed to process payment. Please try again.');
        } finally {
            setLoading(false);
        }
    }, [navigate, clearCart, addOrder, updateOrder, editOrderId, editSession, customer, cartItems, subtotal, tax, total, discountValue, netPayment, balance, paymentMethod, isPartial, isRefund, cashAmount, mpesaAutoAmount, mode, enableTax, user, parentOrderId, sourceInvoiceId, receiptCategories, location.state?.orderVersion]);

    // Edit mode: ask the backend what THIS cart would disturb, and confirm every cut line
    // it does — the cutting flags are a prefill, not evidence, so a line the queue still
    // calls pending may well have been cut already. Gated on will_reverse, NOT on
    // requires_explicit_answer: the latter is only about which answers can be taken on
    // trust, and using it here skipped the modal entirely for an ordinary uncut line.
    // A new sale, or an edit that disturbs no cut material, submits straight through.
    // One submit at a time. The edit path awaits the reversal-plan preview before
    // submitOrder sets `loading`, so without this a quick double click ran two previews and
    // two saves.
    const busyRef = useRef(false);
    const handlePayment = useCallback(async () => {
        if (busyRef.current) return undefined;
        busyRef.current = true;
        setLoading(true);
        try {
            if (!editOrderId) return await submitOrder(null, null);
            let plan = null;
            try {
                plan = await api.orderService.previewReversalPlan(
                    editOrderId, cartItems.map(mapItemForBackend));
            } catch (err) {
                // Advisory pre-check only — the edit call enforces the rules server-side.
                console.error('Failed to preview the reversal plan', err);
                return await submitOrder(null, null);
            }
            const reversing = (plan?.lines || []).filter(l => l.will_reverse !== false);
            if (reversing.length) {
                // Answered in the calculators while the items were being changed. When they cover
                // every line this edit disturbs, there is nothing left to ask; otherwise (an item
                // removed outright, or answers from before a stale reload) the dialog opens with
                // them pre-filled and asks only for the rest.
                const known = Object.assign({}, ...cartItems.map(i => i.details?.cutAnswers || {}));
                if (answersComplete(reversing, known)) {
                    return await submitOrder(answersPayload(reversing, known), plan?.plan_token ?? null);
                }
                setCutsInitial(known);
                setCutsPlan(plan);
                setLoading(false);   // the dialog takes over; confirming it submits
                return undefined;
            }
            return await submitOrder(null, plan?.plan_token ?? null);
        } finally {
            busyRef.current = false;
        }
    }, [editOrderId, cartItems, submitOrder]);

    if (cartItems.length === 0) {
        return (
            <div style={{ minHeight: '100vh', background: 'var(--color-bg)', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: '1rem' }}>
                <span style={{ fontSize: '3rem' }}>🛒</span>
                <h2 style={{ fontSize: '1.25rem', fontWeight: 700, color: '#f1f5f9' }}>Cart is Empty</h2>
                <button onClick={() => navigate('/sales')} style={{ color: '#3b82f6', background: 'none', border: 'none', cursor: 'pointer', fontWeight: 600, fontSize: '0.875rem' }}>
                    ← Return to Sales
                </button>
            </div>
        );
    }

    const cashValue = parseFloat(cashAmount) || 0;
    // Whole shillings, never negative — a negative cash part inflates the M-Pesa side.
    const splitCashInvalid = paymentMethod === 'split' && (cashValue < 0 || !Number.isInteger(cashValue));
    const partialOverDue = isPartial && !isRefund && (parseFloat(amountPaid) || 0) > Math.max(0, effectiveTotal);
    const canConfirm = !loading
        && hasOrderChanged
        && (isRefund ? !!paymentMethod : (currentPayable === 0 || !!paymentMethod))
        && !(paymentMethod === 'split' && cashValue > payableAmount)
        && !splitCashInvalid
        && !partialOverDue;

    return (
        <div style={{
            minHeight: '100vh',
            background: 'var(--color-bg)',
            display: 'flex',
            flexDirection: isMobile ? 'column' : 'row',
            fontFamily: 'var(--font-sans)',
            color: 'var(--color-text)',
        }}>

            {/* Asked at submit, once the cart is final. Closing aborts the save and leaves
                the cashier on this page with their cart intact; confirming completes it. */}
            {cutsPlan && (
                <ResolveCutsModal
                    plan={cutsPlan}
                    notice={cutsNotice}
                    initialAnswers={cutsInitial}
                    onClose={() => { setCutsPlan(null); setCutsNotice(null); }}
                    onConfirm={(confirmations) => {
                        const token = cutsPlan.plan_token ?? null;
                        setCutsPlan(null);
                        setCutsNotice(null);
                        submitOrder(confirmations, token);
                    }}
                    actionLabel="Confirm & Save"
                />
            )}

            {/* ── LEFT: Order Review ── */}
            <div style={{ flex: 1, minWidth: 0, overflowY: isMobile ? 'visible' : 'auto', padding: isMobile ? '1.25rem 1rem' : '2rem' }} className="scrollbar-hide">
                <div style={{ maxWidth: '780px', margin: '0 auto' }}>

                    {/* Back nav */}
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '2rem', flexWrap: 'wrap', gap: '0.75rem' }}>
                        <button
                            onClick={() => sourceInvoiceId
                                ? navigate('/orders', { state: { activeTab: 'invoices', highlightId: sourceInvoiceId } })
                                : navigate('/sales', { state: { enableTax, mode: 'back' } })}
                            style={{
                                display: 'flex', alignItems: 'center', gap: '0.5rem',
                                background: 'none', border: 'none', cursor: 'pointer',
                                color: '#475569', fontSize: '0.8rem', fontWeight: 600,
                                letterSpacing: '0.06em', textTransform: 'uppercase',
                                transition: 'color 0.2s ease',
                            }}
                            onMouseEnter={e => { e.currentTarget.style.color = '#94a3b8'; }}
                            onMouseLeave={e => { e.currentTarget.style.color = '#475569'; }}
                        >
                            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="15 18 9 12 15 6" /></svg>
                            {sourceInvoiceId ? 'Back to Order History' : 'Back to Sales'}
                        </button>

                        {sourceInvoiceId && (
                            <button
                                onClick={() => navigate('/sales', { state: { mode: 'convert', cartItems, customer, sourceInvoiceId, enableTax, discount: discountValue } })}
                                style={{
                                    display: 'flex', alignItems: 'center', gap: '0.5rem',
                                    background: 'rgba(245,158,11,0.08)', border: '1px solid rgba(245,158,11,0.2)',
                                    borderRadius: '0.75rem', padding: '0.5rem 1rem',
                                    color: '#fbbf24', cursor: 'pointer', fontWeight: 700, fontSize: '0.78rem',
                                    transition: 'all 0.15s',
                                }}
                                onMouseEnter={e => { e.currentTarget.style.background = 'rgba(245,158,11,0.16)'; }}
                                onMouseLeave={e => { e.currentTarget.style.background = 'rgba(245,158,11,0.08)'; }}
                            >✏️ Add / Edit Items</button>
                        )}
                    </div>

                    {/* Page header */}
                    <div style={{ marginBottom: '2rem' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', marginBottom: '0.5rem' }}>
                            <h1 style={{ fontSize: 'clamp(1.35rem, 5vw, 1.75rem)', fontWeight: 800, color: '#f1f5f9', letterSpacing: '-0.025em' }}>
                                {mode === 'edit' ? 'Update Order' : 'Order Review'}
                            </h1>
                            {mode === 'edit' && (
                                <span style={{ fontSize: '0.7rem', fontWeight: 700, padding: '0.2rem 0.625rem', background: 'rgba(245,158,11,0.12)', border: '1px solid rgba(245,158,11,0.25)', borderRadius: '100px', color: '#fbbf24', letterSpacing: '0.06em', textTransform: 'uppercase' }}>
                                    Edit Mode
                                </span>
                            )}
                            {sourceInvoiceId && (
                                <span style={{ fontSize: '0.7rem', fontWeight: 700, padding: '0.2rem 0.625rem', background: 'rgba(59,130,246,0.12)', border: '1px solid rgba(59,130,246,0.25)', borderRadius: '100px', color: '#60a5fa', letterSpacing: '0.06em', textTransform: 'uppercase' }}>
                                    From Invoice #{String(sourceInvoiceId).slice(-6)}
                                </span>
                            )}
                        </div>
                        <p style={{ color: '#475569', fontSize: '0.875rem' }}>
                            {cartItems.length} item{cartItems.length !== 1 ? 's' : ''} · Review before confirming payment
                        </p>
                    </div>

                    {/* Items table */}
                    <div style={{
                        background: 'rgba(255,255,255,0.03)',
                        border: '1px solid rgba(255,255,255,0.07)',
                        borderRadius: '1.25rem',
                        overflow: 'hidden',
                    }}>
                        {/* Table header */}
                        {!isMobile && (
                        <div style={{
                            display: 'grid',
                            gridTemplateColumns: '1fr auto auto auto',
                            gap: '1rem',
                            padding: '0.875rem 1.5rem',
                            background: 'rgba(255,255,255,0.02)',
                            borderBottom: '1px solid rgba(255,255,255,0.06)',
                        }}>
                            <span style={{ fontSize: '0.65rem', fontWeight: 700, color: '#334155', letterSpacing: '0.1em', textTransform: 'uppercase' }}>Item Description</span>
                            <span style={{ fontSize: '0.65rem', fontWeight: 700, color: '#334155', letterSpacing: '0.1em', textTransform: 'uppercase', minWidth: '180px' }}>Breakdown</span>
                            <span style={{ fontSize: '0.65rem', fontWeight: 700, color: '#334155', letterSpacing: '0.1em', textTransform: 'uppercase', textAlign: 'right' }}>Total</span>
                            <span />
                        </div>
                        )}

                        {cartItems.map((item, idx) => (
                            <ReviewItemCard key={`${item.id}-${idx}`} item={item} index={idx} onRemove={removeItem} isMobile={isMobile} />
                        ))}

                        {/* Summary row */}
                        <div style={{
                            padding: '1rem 1.5rem',
                            background: 'rgba(255,255,255,0.02)',
                            borderTop: '1px solid rgba(255,255,255,0.06)',
                            display: 'flex',
                            justifyContent: 'flex-end',
                        }}>
                            <div style={{ display: 'flex', gap: '1.5rem', alignItems: 'center' }}>
                                <span style={{ fontSize: '0.8rem', color: '#475569', fontWeight: 500 }}>{cartItems.length} items</span>
                                <div style={{ height: '16px', width: '1px', background: 'rgba(255,255,255,0.1)' }} />
                                <span style={{ fontSize: '0.9rem', fontWeight: 700, color: '#f1f5f9', fontFamily: 'var(--font-mono)' }}>
                                    KSH {subtotal.toFixed(2)}
                                </span>
                            </div>
                        </div>
                    </div>
                </div>
            </div>

            {/* ── RIGHT: Payment Panel ── */}
            <div style={{
                width: isMobile ? '100%' : '440px',
                flexShrink: 0,
                background: 'rgba(9,14,26,0.97)',
                borderLeft: isMobile ? 'none' : '1px solid rgba(255,255,255,0.07)',
                borderTop: isMobile ? '1px solid rgba(255,255,255,0.07)' : 'none',
                display: 'flex',
                flexDirection: 'column',
                position: isMobile ? 'static' : 'sticky',
                top: 0,
                height: isMobile ? 'auto' : '100vh',
                backdropFilter: 'blur(20px)',
            }}>
                {/* Panel header */}
                <div style={{
                    padding: '1.75rem 1.75rem 1.25rem',
                    borderBottom: '1px solid rgba(255,255,255,0.06)',
                    flexShrink: 0,
                    position: 'relative',
                    overflow: 'hidden',
                }}>
                    <div style={{
                        position: 'absolute', top: 0, left: '10%', right: '10%', height: '1px',
                        background: 'linear-gradient(90deg, transparent, rgba(59,130,246,0.5), rgba(6,182,212,0.5), transparent)',
                    }} />
                    <h2 style={{ fontSize: '1.1rem', fontWeight: 700, color: '#f1f5f9', marginBottom: '4px' }}>Payment</h2>
                    <p style={{ fontSize: '0.78rem', color: '#475569' }}>Complete the transaction</p>
                </div>

                {/* Panel body */}
                <div style={{ flex: 1, overflowY: isMobile ? 'visible' : 'auto', padding: isMobile ? '1.25rem' : '1.5rem 1.75rem', display: 'flex', flexDirection: 'column', gap: '1.25rem' }} className="scrollbar-hide">

                    {/* Customer badge */}
                    <div style={{
                        display: 'flex', alignItems: 'center', gap: '0.875rem',
                        padding: '0.875rem 1rem',
                        background: 'rgba(59,130,246,0.08)',
                        border: '1px solid rgba(59,130,246,0.18)',
                        borderRadius: '0.875rem',
                    }}>
                        <div style={{
                            width: '36px', height: '36px', borderRadius: '50%', flexShrink: 0,
                            background: 'linear-gradient(135deg, #3b82f6, #06b6d4)',
                            display: 'flex', alignItems: 'center', justifyContent: 'center',
                            fontSize: '0.875rem', fontWeight: 700, color: '#fff',
                        }}>
                            {(customer?.name || 'W').charAt(0).toUpperCase()}
                        </div>
                        <div>
                            <div style={{ fontSize: '0.65rem', fontWeight: 600, color: '#3b82f6', letterSpacing: '0.08em', textTransform: 'uppercase' }}>Customer</div>
                            <div style={{ fontSize: '0.875rem', fontWeight: 700, color: '#e2e8f0' }}>{customer?.name || 'Walk-in Customer'}</div>
                            {customer?.phone && <div style={{ fontSize: '0.72rem', color: '#64748b' }}>{customer.phone}</div>}
                        </div>
                        {isRegistered && (
                            <div style={{ marginLeft: 'auto', fontSize: '0.65rem', fontWeight: 700, padding: '0.2rem 0.5rem', background: 'rgba(34,197,94,0.12)', border: '1px solid rgba(34,197,94,0.25)', borderRadius: '100px', color: '#4ade80', letterSpacing: '0.06em', textTransform: 'uppercase' }}>
                                Registered
                            </div>
                        )}
                    </div>

                    {/* Receipt departments */}
                    <div>
                        <label style={{ display: 'block', fontSize: '0.7rem', fontWeight: 600, color: '#475569', letterSpacing: '0.08em', textTransform: 'uppercase', marginBottom: '0.5rem' }}>
                            Receipt Departments
                        </label>
                        <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
                            {BUCKET_ORDER.map(bucket => (
                                <CategoryToggle
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
                    </div>

                    {/* Discount — allowed on partial / credit sales too */}
                    <div>
                        <label style={{ display: 'block', fontSize: '0.7rem', fontWeight: 600, color: '#475569', letterSpacing: '0.08em', textTransform: 'uppercase', marginBottom: '0.5rem' }}>
                            Discount (KSH)
                        </label>
                        <div style={{ position: 'relative' }}>
                            <span style={{ position: 'absolute', left: '0.875rem', top: '50%', transform: 'translateY(-50%)', fontSize: '0.8rem', color: '#22c55e', fontWeight: 700 }}>−</span>
                            <input
                                type="number"
                                value={discount}
                                onChange={e => setDiscount(e.target.value)}
                                placeholder="0"
                                min="0"
                                step="1"
                                style={{
                                    width: '100%', background: 'rgba(255,255,255,0.04)',
                                    border: '1px solid rgba(255,255,255,0.08)',
                                    borderRadius: '0.75rem', padding: '0.75rem 0.875rem 0.75rem 2rem',
                                    color: '#22c55e', fontSize: '0.9rem', fontFamily: 'var(--font-mono)',
                                    fontWeight: 700, outline: 'none', transition: 'all 0.2s ease', boxSizing: 'border-box',
                                }}
                                onFocus={e => { e.target.style.borderColor = 'rgba(34,197,94,0.4)'; e.target.style.boxShadow = '0 0 0 3px rgba(34,197,94,0.08)'; }}
                                onBlur={e => { e.target.style.borderColor = 'rgba(255,255,255,0.08)'; e.target.style.boxShadow = ''; }}
                            />
                        </div>
                    </div>

                    {/* Partial payment toggle */}
                    {isRegistered && effectiveTotal > 0 && (
                        <div style={{
                            display: 'flex', gap: '4px',
                            background: 'rgba(255,255,255,0.03)',
                            border: '1px solid rgba(255,255,255,0.07)',
                            borderRadius: '0.75rem', padding: '4px',
                        }}>
                            {[{ label: 'Pay in Full', val: false }, { label: 'Pay Partial / Later', val: true }].map(opt => (
                                <button
                                    key={opt.label}
                                    onClick={() => setIsPartial(opt.val)}
                                    style={{
                                        flex: 1, padding: '0.5rem',
                                        borderRadius: '0.5rem', border: 'none',
                                        background: isPartial === opt.val ? (opt.val ? 'rgba(245,158,11,0.15)' : 'rgba(59,130,246,0.15)') : 'transparent',
                                        color: isPartial === opt.val ? (opt.val ? '#fbbf24' : '#60a5fa') : '#475569',
                                        fontSize: '0.78rem', fontWeight: 700,
                                        cursor: 'pointer', transition: 'all 0.2s ease',
                                    }}
                                >
                                    {opt.label}
                                </button>
                            ))}
                        </div>
                    )}

                    {/* Partial amount input */}
                    {isRegistered && isPartial && effectiveTotal > 0 && (
                        <div>
                            <label style={{ display: 'block', fontSize: '0.7rem', fontWeight: 600, color: '#475569', letterSpacing: '0.08em', textTransform: 'uppercase', marginBottom: '0.5rem' }}>
                                Amount Paying Now (KSH)
                            </label>
                            <input
                                type="number"
                                value={amountPaid}
                                onChange={e => setAmountPaid(e.target.value)}
                                placeholder="Enter amount..."
                                min="0"
                                max={Math.max(0, effectiveTotal)}
                                step="1"
                                style={{
                                    width: '100%', background: 'rgba(245,158,11,0.06)',
                                    border: '1px solid rgba(245,158,11,0.25)',
                                    borderRadius: '0.75rem', padding: '0.75rem 0.875rem',
                                    color: '#fbbf24', fontSize: '0.9rem', fontFamily: 'var(--font-mono)',
                                    fontWeight: 700, outline: 'none', transition: 'all 0.2s ease', boxSizing: 'border-box',
                                }}
                            />
                            {partialOverDue && (
                                <div style={{ fontSize: '0.75rem', fontWeight: 700, color: '#f87171', marginTop: '0.375rem' }}>
                                    ⚠ More than the amount due (max KSH {Math.max(0, effectiveTotal).toFixed(0)}) — use Pay in Full instead
                                </div>
                            )}
                            {balance > 0 && (
                                <div style={{ fontSize: '0.75rem', fontWeight: 700, color: '#f59e0b', textAlign: 'right', marginTop: '0.375rem' }}>
                                    Remaining balance: KSH {balance.toFixed(0)}
                                </div>
                            )}
                        </div>
                    )}

                    {/* Refund mode */}
                    {isRefund ? (
                        <div>
                            <div style={{
                                padding: '0.875rem 1rem',
                                background: 'rgba(245,158,11,0.08)',
                                border: '1px solid rgba(245,158,11,0.25)',
                                borderRadius: '0.875rem',
                                display: 'flex', gap: '0.75rem',
                                marginBottom: '1rem',
                            }}>
                                <span style={{ fontSize: '1.25rem' }}>⚠️</span>
                                <div>
                                    <div style={{ fontSize: '0.825rem', fontWeight: 700, color: '#fbbf24', marginBottom: '2px' }}>Refund Required</div>
                                    <div style={{ fontSize: '0.78rem', color: '#92400e' }}>This update results in a credit balance. Select how the customer was refunded.</div>
                                </div>
                            </div>
                            <label style={{ display: 'block', fontSize: '0.7rem', fontWeight: 600, color: '#475569', letterSpacing: '0.08em', textTransform: 'uppercase', marginBottom: '0.625rem' }}>
                                Refund Method
                            </label>
                            <div style={{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap' }}>
                                <PaymentMethodBtn method="cash" label="Cash" icon="💵" selected={paymentMethod === 'cash'} color="#3b82f6" onClick={setPaymentMethod} />
                                <PaymentMethodBtn method="mpesa" label="M-Pesa" icon="📱" selected={paymentMethod === 'mpesa'} color="#3b82f6" onClick={setPaymentMethod} />
                                <PaymentMethodBtn method="split" label="Split" icon="⚖️" selected={paymentMethod === 'split'} color="#a855f7" onClick={setPaymentMethod} />
                            </div>
                        </div>
                    ) : currentPayable > 0 && (
                        <div>
                            <label style={{ display: 'block', fontSize: '0.7rem', fontWeight: 600, color: '#475569', letterSpacing: '0.08em', textTransform: 'uppercase', marginBottom: '0.625rem' }}>
                                Payment Method
                            </label>
                            <div style={{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap' }}>
                                <PaymentMethodBtn method="cash" label="Cash" icon="💵" selected={paymentMethod === 'cash'} color="#22c55e" onClick={setPaymentMethod} />
                                <PaymentMethodBtn method="mpesa" label="M-Pesa" icon="📱" selected={paymentMethod === 'mpesa'} color="#22c55e" onClick={setPaymentMethod} />
                                <PaymentMethodBtn method="split" label="Split" icon="⚖️" selected={paymentMethod === 'split'} color="#a855f7" onClick={setPaymentMethod} />
                            </div>
                        </div>
                    )}

                    {/* Split payment inputs */}
                    {(isRefund || currentPayable > 0) && paymentMethod === 'split' && (
                        <div style={{
                            padding: '1rem',
                            background: 'rgba(168,85,247,0.06)',
                            border: '1px solid rgba(168,85,247,0.2)',
                            borderRadius: '0.875rem',
                            display: 'flex', flexDirection: 'column', gap: '0.75rem',
                        }}>
                            <div>
                                <label style={{ display: 'block', fontSize: '0.68rem', fontWeight: 600, color: '#a855f7', letterSpacing: '0.08em', textTransform: 'uppercase', marginBottom: '0.375rem' }}>{isRefund ? 'Cash Refunded' : 'Cash Amount'}</label>
                                <input
                                    type="number"
                                    value={cashAmount}
                                    onChange={e => setCashAmount(e.target.value)}
                                    placeholder="0"
                                    min="0"
                                    step="1"
                                    style={{
                                        width: '100%', background: 'rgba(255,255,255,0.05)',
                                        border: '1px solid rgba(255,255,255,0.1)',
                                        borderRadius: '0.625rem', padding: '0.625rem 0.875rem',
                                        color: '#f1f5f9', fontSize: '0.875rem', fontFamily: 'var(--font-mono)',
                                        fontWeight: 600, outline: 'none', boxSizing: 'border-box',
                                    }}
                                />
                            </div>
                            <div>
                                <label style={{ display: 'block', fontSize: '0.68rem', fontWeight: 600, color: '#94a3b8', letterSpacing: '0.08em', textTransform: 'uppercase', marginBottom: '0.375rem' }}>{isRefund ? 'M-Pesa Refunded (auto)' : 'M-Pesa (auto)'}</label>
                                <input
                                    type="number"
                                    value={mpesaAutoAmount.toFixed(0)}
                                    readOnly
                                    style={{
                                        width: '100%', background: 'rgba(255,255,255,0.02)',
                                        border: '1px solid rgba(255,255,255,0.06)',
                                        borderRadius: '0.625rem', padding: '0.625rem 0.875rem',
                                        color: '#475569', fontSize: '0.875rem', fontFamily: 'var(--font-mono)',
                                        fontWeight: 600, outline: 'none', cursor: 'not-allowed', boxSizing: 'border-box',
                                    }}
                                />
                            </div>
                            {(parseFloat(cashAmount) || 0) > payableAmount && (
                                <div style={{ fontSize: '0.75rem', fontWeight: 600, color: '#f87171' }}>
                                    ⚠ Cash exceeds total (max KSH {payableAmount.toFixed(0)})
                                </div>
                            )}
                            {splitCashInvalid && (
                                <div style={{ fontSize: '0.75rem', fontWeight: 600, color: '#f87171' }}>
                                    ⚠ Enter cash as a whole, positive amount
                                </div>
                            )}
                        </div>
                    )}
                </div>

                {/* ── Footer: Totals + Confirm ── */}
                <div style={{
                    padding: '1.25rem 1.75rem',
                    borderTop: '1px solid rgba(255,255,255,0.06)',
                    flexShrink: 0,
                    display: 'flex',
                    flexDirection: 'column',
                    gap: '1rem',
                    background: 'rgba(9,14,26,0.98)',
                }}>
                    {/* Totals */}
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                            <span style={{ fontSize: '0.825rem', color: '#475569' }}>Subtotal</span>
                            <span style={{ fontSize: '0.825rem', color: '#94a3b8', fontFamily: 'var(--font-mono)' }}>KSH {subtotal.toFixed(0)}</span>
                        </div>
                        {enableTax && (
                            <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                                <span style={{ fontSize: '0.825rem', color: '#475569' }}>VAT (16%)</span>
                                <span style={{ fontSize: '0.825rem', color: '#94a3b8', fontFamily: 'var(--font-mono)' }}>KSH {tax.toFixed(0)}</span>
                            </div>
                        )}
                        {discountValue > 0 && (
                            <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                                <span style={{ fontSize: '0.825rem', color: '#22c55e' }}>Discount</span>
                                <span style={{ fontSize: '0.825rem', color: '#22c55e', fontFamily: 'var(--font-mono)', fontWeight: 700 }}>−KSH {discountValue.toFixed(0)}</span>
                            </div>
                        )}
                        {mode === 'edit' && originalTotal > 0 && (
                            <div style={{ display: 'flex', justifyContent: 'space-between', background: 'rgba(59,130,246,0.08)', padding: '0.375rem 0.625rem', borderRadius: '0.375rem' }}>
                                <span style={{ fontSize: '0.8rem', color: '#60a5fa' }}>Prior Collection</span>
                                <span style={{ fontSize: '0.8rem', color: '#60a5fa', fontFamily: 'var(--font-mono)', fontWeight: 700 }}>−KSH {originalTotal.toFixed(0)}</span>
                            </div>
                        )}
                        {mode === 'edit' && originalBalance > 0 && (
                            <div style={{ display: 'flex', justifyContent: 'space-between', background: 'rgba(245,158,11,0.08)', padding: '0.375rem 0.625rem', borderRadius: '0.375rem' }}>
                                <span style={{ fontSize: '0.8rem', color: '#fbbf24' }}>Outstanding Balance</span>
                                <span style={{ fontSize: '0.8rem', color: '#fbbf24', fontFamily: 'var(--font-mono)', fontWeight: 700 }}>KSH {originalBalance.toFixed(0)}</span>
                            </div>
                        )}
                        <div style={{ height: '1px', background: 'rgba(255,255,255,0.07)', margin: '0.25rem 0' }} />
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
                            <span style={{ fontSize: '0.875rem', fontWeight: 700, color: '#cbd5e1' }}>
                                {mode === 'edit' ? (effectiveTotal >= 0 ? 'Balance Due' : 'Refund Due') : 'Total'}
                            </span>
                            <span style={{
                                fontSize: '1.5rem', fontWeight: 900, letterSpacing: '-0.03em',
                                fontFamily: 'var(--font-mono)',
                                color: mode === 'edit'
                                    ? (effectiveTotal >= 0 ? '#fbbf24' : '#60a5fa')
                                    : '#f1f5f9',
                            }}>
                                KSH {Math.abs(mode === 'edit' ? effectiveTotal : total).toFixed(0)}
                            </span>
                        </div>
                    </div>

                    {/* No-change notice (edit mode) */}
                    {editOrderId && !hasOrderChanged && (
                        <div style={{
                            padding: '0.75rem 1rem',
                            background: 'rgba(100,116,139,0.1)',
                            border: '1px solid rgba(100,116,139,0.25)',
                            borderRadius: '0.75rem',
                            fontSize: '0.8rem',
                            color: '#94a3b8',
                            fontWeight: 600,
                            textAlign: 'center',
                        }}>
                            No changes detected — edit items in the sales screen first.
                        </div>
                    )}

                    {/* Payment Error */}
                    {paymentError && (
                        <div style={{
                            padding: '0.75rem 1rem',
                            background: 'rgba(239,68,68,0.1)',
                            border: '1px solid rgba(239,68,68,0.3)',
                            borderRadius: '0.75rem',
                            fontSize: '0.8rem',
                            color: '#f87171',
                            fontWeight: 600,
                        }}>
                            {paymentError}
                        </div>
                    )}

                    {/* Confirm Button */}
                    <button
                        onClick={handlePayment}
                        disabled={!canConfirm || loading}
                        style={{
                            width: '100%', padding: '1rem',
                            borderRadius: '0.875rem', border: 'none',
                            background: !canConfirm ? 'rgba(255,255,255,0.05)' :
                                balance > 0 ? 'linear-gradient(135deg, #f59e0b, #d97706)' :
                                    'linear-gradient(135deg, #3b82f6, #06b6d4)',
                            color: !canConfirm ? '#334155' : '#ffffff',
                            fontSize: '0.9rem', fontWeight: 700, fontFamily: 'inherit',
                            cursor: !canConfirm ? 'not-allowed' : 'pointer',
                            transition: 'all 0.2s ease',
                            display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '0.625rem',
                            boxShadow: !canConfirm ? 'none' : balance > 0 ? '0 4px 20px rgba(245,158,11,0.3)' : '0 4px 20px rgba(59,130,246,0.35)',
                            letterSpacing: '0.02em',
                        }}
                        onMouseEnter={e => { if (canConfirm) { e.currentTarget.style.transform = 'translateY(-1px)'; e.currentTarget.style.boxShadow = balance > 0 ? '0 6px 28px rgba(245,158,11,0.45)' : '0 6px 28px rgba(59,130,246,0.5)'; } }}
                        onMouseLeave={e => { e.currentTarget.style.transform = ''; e.currentTarget.style.boxShadow = !canConfirm ? 'none' : balance > 0 ? '0 4px 20px rgba(245,158,11,0.3)' : '0 4px 20px rgba(59,130,246,0.35)'; }}
                    >
                        {loading ? (
                            <>
                                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" style={{ animation: 'spin 0.8s linear infinite' }}>
                                    <path d="M21 12a9 9 0 1 1-6.219-8.56" />
                                </svg>
                                Processing…
                            </>
                        ) : isRefund
                            ? `Confirm Refund · KSH ${refundAmount.toFixed(0)} →`
                            : currentPayable === 0
                                ? 'Confirm Credit →'
                                : balance > 0
                                    ? `Confirm & Record Credit · KSH ${currentPayable.toFixed(0)} →`
                                    : editOrderId ? `Update Order · KSH ${total.toFixed(0)} →` : `Confirm Payment · KSH ${total.toFixed(0)} →`
                        }
                    </button>
                </div>
            </div>
        </div>
    );
}
