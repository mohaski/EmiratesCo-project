import React, { useState, useMemo, useCallback, memo } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { useCart } from '../context/CartContext';
import { useAuth } from '../context/AuthContext';
import { useOrders } from '../context/OrderContext';
import { useCartTotals } from '../hooks/useCartTotals';

/* ── Review Item Card ── */
const ReviewItemCard = memo(({ item, index }) => (
    <div style={{
        display: 'grid',
        gridTemplateColumns: '1fr auto auto',
        gap: '1rem',
        padding: '1.25rem 1.5rem',
        borderBottom: '1px solid rgba(255,255,255,0.05)',
        transition: 'background 0.15s ease',
        alignItems: 'center',
    }}
        onMouseEnter={e => { e.currentTarget.style.background = 'rgba(255,255,255,0.02)'; }}
        onMouseLeave={e => { e.currentTarget.style.background = 'transparent'; }}
    >
        {/* Item Info */}
        <div style={{ display: 'flex', gap: '1rem', alignItems: 'center', minWidth: 0 }}>
            <div style={{
                width: '48px', height: '48px', borderRadius: '10px', flexShrink: 0,
                background: 'rgba(59,130,246,0.1)',
                border: '1px solid rgba(59,130,246,0.2)',
                overflow: 'hidden', display: 'flex', alignItems: 'center', justifyContent: 'center',
            }}>
                {item.image
                    ? <img src={item.image} style={{ width: '100%', height: '100%', objectFit: 'cover', mixBlendMode: 'luminosity', opacity: 0.8 }} alt={item.name} loading="lazy" />
                    : <span style={{ fontSize: '1.25rem' }}>📦</span>
                }
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
                KSH {item.totalPrice?.toFixed(2)}
            </div>
        </div>
    </div>
));

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

    const { user } = useAuth();
    const { cartItems: ctxCartItems, customer: ctxCustomer, taxEnabled: ctxTaxEnabled, clearCart } = useCart();
    const { addOrder, updateOrder } = useOrders();
    const { mode, originalTotal = 0 } = location.state || {};
    const editOrderId = mode === 'edit' ? (location.state?.orderData?.id ?? location.state?.orderData?.orderId ?? null) : null;
    // When arriving from invoice-convert or link mode, items & customer come via navigation state
    const fromInvoice = Boolean(location.state?.cartItems);
    const cartItems = fromInvoice ? location.state.cartItems : ctxCartItems;
    const customer = fromInvoice ? location.state.customer : ctxCustomer;
    const enableTax = location.state?.enableTax !== undefined ? location.state.enableTax : ctxTaxEnabled;
    const parentOrderId = location.state?.parentOrderId ?? null;

    const [loading, setLoading] = useState(false);
    const [paymentError, setPaymentError] = useState(null);
    const [paymentMethod, setPaymentMethod] = useState(null);
    const [discount, setDiscount] = useState('');
    const [isPartial, setIsPartial] = useState(false);
    const [amountPaid, setAmountPaid] = useState('');
    const [cashAmount, setCashAmount] = useState('');

    const isRegistered = useMemo(() => {
        if (!customer) return false;
        return ['registered', 'corporate', 'frequent'].includes(customer.type);
    }, [customer]);

    const { subtotal: rawSubtotal } = useCartTotals(cartItems, enableTax);

    const financials = useMemo(() => {
        const round2 = (n) => Math.round((n + Number.EPSILON) * 100) / 100;
        const discountValue = isPartial ? 0 : (parseFloat(discount) || 0);
        const netTaxable = Math.max(0, rawSubtotal - discountValue);
        const effectiveTax = enableTax ? round2(netTaxable * 0.16) : 0;
        const total = round2(netTaxable + effectiveTax);
        const effectiveTotal = mode === 'edit' ? (total - originalTotal) : total;
        const currentPayable = isPartial ? (parseFloat(amountPaid) || 0) : Math.max(0, effectiveTotal);
        const balance = Math.max(0, round2(total - ((mode === 'edit' ? originalTotal : 0) + currentPayable)));
        const mpesaAutoAmount = Math.max(0, round2(currentPayable - (parseFloat(cashAmount) || 0)));
        return { subtotal: rawSubtotal, tax: effectiveTax, discountValue, total, currentPayable, balance, mpesaAutoAmount, effectiveTotal, originalTotal };
    }, [rawSubtotal, enableTax, discount, isPartial, amountPaid, cashAmount, mode, originalTotal]);

    const { subtotal, tax, discountValue, total, currentPayable, balance, mpesaAutoAmount, effectiveTotal } = financials;

    // In edit mode: detect whether anything actually changed vs the original order
    const hasOrderChanged = useMemo(() => {
        if (!editOrderId) return true;
        const originalItems = location.state?.orderData?.items || [];
        if (originalItems.length !== cartItems.length) return true;
        const sig = (items) =>
            [...items]
                .map(i => `${i.productId ?? i.id}:${i.variantId ?? ''}:${Number(i.totalPrice ?? 0).toFixed(2)}`)
                .sort()
                .join('|');
        return sig(originalItems) !== sig(cartItems);
    }, [editOrderId, cartItems, location.state?.orderData?.items]);

    const handlePayment = useCallback(async () => {
        setLoading(true);
        setPaymentError(null);
        try {
            const orderData = {
                customer, items: cartItems, servedBy: user?.userId, VAT_status: enableTax,
                parentOrderId,
                totals: { subtotal, tax, total, discount: discountValue, paid: currentPayable, balance },
                payment: {
                    method: paymentMethod, isPartial,
                    details: paymentMethod === 'split' ? { cash: parseFloat(cashAmount), mpesa: mpesaAutoAmount } : null
                },
                mode: mode || 'new'
            };

            if (editOrderId) {
                await updateOrder(editOrderId, orderData);
            } else {
                await addOrder(orderData);
            }
            if (!fromInvoice) clearCart();
            navigate('/orders');
        } catch (err) {
            console.error('Payment failed', err);
            setPaymentError('Failed to process payment. Please try again.');
        } finally {
            setLoading(false);
        }
    }, [navigate, clearCart, addOrder, updateOrder, editOrderId, customer, cartItems, subtotal, tax, total, discountValue, currentPayable, balance, paymentMethod, isPartial, cashAmount, mpesaAutoAmount, mode, enableTax, user, fromInvoice, parentOrderId]);

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

    const canConfirm = !loading
        && hasOrderChanged
        && (currentPayable === 0 || !!paymentMethod)
        && !(paymentMethod === 'split' && (parseFloat(cashAmount) || 0) > currentPayable);

    return (
        <div style={{
            minHeight: '100vh',
            background: 'var(--color-bg)',
            display: 'flex',
            fontFamily: 'var(--font-sans)',
            color: 'var(--color-text)',
        }}>

            {/* ── LEFT: Order Review ── */}
            <div style={{ flex: 1, overflowY: 'auto', padding: '2rem' }} className="scrollbar-hide">
                <div style={{ maxWidth: '780px', margin: '0 auto' }}>

                    {/* Back nav */}
                    <button
                        onClick={() => navigate('/sales', { state: { enableTax } })}
                        style={{
                            display: 'flex', alignItems: 'center', gap: '0.5rem',
                            background: 'none', border: 'none', cursor: 'pointer',
                            color: '#475569', fontSize: '0.8rem', fontWeight: 600,
                            letterSpacing: '0.06em', textTransform: 'uppercase',
                            marginBottom: '2rem',
                            transition: 'color 0.2s ease',
                        }}
                        onMouseEnter={e => { e.currentTarget.style.color = '#94a3b8'; }}
                        onMouseLeave={e => { e.currentTarget.style.color = '#475569'; }}
                    >
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="15 18 9 12 15 6" /></svg>
                        Back to Sales
                    </button>

                    {/* Page header */}
                    <div style={{ marginBottom: '2rem' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', marginBottom: '0.5rem' }}>
                            <h1 style={{ fontSize: '1.75rem', fontWeight: 800, color: '#f1f5f9', letterSpacing: '-0.025em' }}>
                                {mode === 'edit' ? 'Update Order' : 'Order Review'}
                            </h1>
                            {mode === 'edit' && (
                                <span style={{ fontSize: '0.7rem', fontWeight: 700, padding: '0.2rem 0.625rem', background: 'rgba(245,158,11,0.12)', border: '1px solid rgba(245,158,11,0.25)', borderRadius: '100px', color: '#fbbf24', letterSpacing: '0.06em', textTransform: 'uppercase' }}>
                                    Edit Mode
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
                        <div style={{
                            display: 'grid',
                            gridTemplateColumns: '1fr auto auto',
                            gap: '1rem',
                            padding: '0.875rem 1.5rem',
                            background: 'rgba(255,255,255,0.02)',
                            borderBottom: '1px solid rgba(255,255,255,0.06)',
                        }}>
                            <span style={{ fontSize: '0.65rem', fontWeight: 700, color: '#334155', letterSpacing: '0.1em', textTransform: 'uppercase' }}>Item Description</span>
                            <span style={{ fontSize: '0.65rem', fontWeight: 700, color: '#334155', letterSpacing: '0.1em', textTransform: 'uppercase', minWidth: '180px' }}>Breakdown</span>
                            <span style={{ fontSize: '0.65rem', fontWeight: 700, color: '#334155', letterSpacing: '0.1em', textTransform: 'uppercase', textAlign: 'right' }}>Total</span>
                        </div>

                        {cartItems.map((item, idx) => (
                            <ReviewItemCard key={`${item.id}-${idx}`} item={item} index={idx} />
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
                width: '440px',
                flexShrink: 0,
                background: 'rgba(9,14,26,0.97)',
                borderLeft: '1px solid rgba(255,255,255,0.07)',
                display: 'flex',
                flexDirection: 'column',
                position: 'sticky',
                top: 0,
                height: '100vh',
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
                <div style={{ flex: 1, overflowY: 'auto', padding: '1.5rem 1.75rem', display: 'flex', flexDirection: 'column', gap: '1.25rem' }} className="scrollbar-hide">

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

                    {/* Discount */}
                    {!isPartial && (
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
                                    placeholder="0.00"
                                    min="0"
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
                    )}

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
                                style={{
                                    width: '100%', background: 'rgba(245,158,11,0.06)',
                                    border: '1px solid rgba(245,158,11,0.25)',
                                    borderRadius: '0.75rem', padding: '0.75rem 0.875rem',
                                    color: '#fbbf24', fontSize: '0.9rem', fontFamily: 'var(--font-mono)',
                                    fontWeight: 700, outline: 'none', transition: 'all 0.2s ease', boxSizing: 'border-box',
                                }}
                            />
                            {balance > 0 && (
                                <div style={{ fontSize: '0.75rem', fontWeight: 700, color: '#f59e0b', textAlign: 'right', marginTop: '0.375rem' }}>
                                    Remaining balance: KSH {balance.toFixed(2)}
                                </div>
                            )}
                        </div>
                    )}

                    {/* Refund mode */}
                    {effectiveTotal < 0 ? (
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
                                    <div style={{ fontSize: '0.78rem', color: '#92400e' }}>This update results in a credit balance. Select refund method.</div>
                                </div>
                            </div>
                            <div style={{ display: 'flex', gap: '0.75rem' }}>
                                <PaymentMethodBtn method="cash-refund" label="Cash Refund" icon="💸" selected={paymentMethod === 'cash-refund'} color="#3b82f6" onClick={setPaymentMethod} />
                                {isRegistered && <PaymentMethodBtn method="store-credit" label="Store Credit" icon="💳" selected={paymentMethod === 'store-credit'} color="#a855f7" onClick={setPaymentMethod} />}
                            </div>
                        </div>
                    ) : currentPayable > 0 && (
                        <div>
                            <label style={{ display: 'block', fontSize: '0.7rem', fontWeight: 600, color: '#475569', letterSpacing: '0.08em', textTransform: 'uppercase', marginBottom: '0.625rem' }}>
                                Payment Method
                            </label>
                            <div style={{ display: 'flex', gap: '0.75rem' }}>
                                <PaymentMethodBtn method="cash" label="Cash" icon="💵" selected={paymentMethod === 'cash'} color="#22c55e" onClick={setPaymentMethod} />
                                <PaymentMethodBtn method="mpesa" label="M-Pesa" icon="📱" selected={paymentMethod === 'mpesa'} color="#22c55e" onClick={setPaymentMethod} />
                                <PaymentMethodBtn method="split" label="Split" icon="⚖️" selected={paymentMethod === 'split'} color="#a855f7" onClick={setPaymentMethod} />
                            </div>
                        </div>
                    )}

                    {/* Split payment inputs */}
                    {currentPayable > 0 && paymentMethod === 'split' && (
                        <div style={{
                            padding: '1rem',
                            background: 'rgba(168,85,247,0.06)',
                            border: '1px solid rgba(168,85,247,0.2)',
                            borderRadius: '0.875rem',
                            display: 'flex', flexDirection: 'column', gap: '0.75rem',
                        }}>
                            <div>
                                <label style={{ display: 'block', fontSize: '0.68rem', fontWeight: 600, color: '#a855f7', letterSpacing: '0.08em', textTransform: 'uppercase', marginBottom: '0.375rem' }}>Cash Amount</label>
                                <input
                                    type="number"
                                    value={cashAmount}
                                    onChange={e => setCashAmount(e.target.value)}
                                    placeholder="0"
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
                                <label style={{ display: 'block', fontSize: '0.68rem', fontWeight: 600, color: '#94a3b8', letterSpacing: '0.08em', textTransform: 'uppercase', marginBottom: '0.375rem' }}>M-Pesa (auto)</label>
                                <input
                                    type="number"
                                    value={mpesaAutoAmount.toFixed(2)}
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
                            {(parseFloat(cashAmount) || 0) > currentPayable && (
                                <div style={{ fontSize: '0.75rem', fontWeight: 600, color: '#f87171' }}>
                                    ⚠ Cash exceeds total (max KSH {currentPayable.toFixed(2)})
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
                            <span style={{ fontSize: '0.825rem', color: '#94a3b8', fontFamily: 'var(--font-mono)' }}>KSH {subtotal.toFixed(2)}</span>
                        </div>
                        {enableTax && (
                            <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                                <span style={{ fontSize: '0.825rem', color: '#475569' }}>VAT (16%)</span>
                                <span style={{ fontSize: '0.825rem', color: '#94a3b8', fontFamily: 'var(--font-mono)' }}>KSH {tax.toFixed(2)}</span>
                            </div>
                        )}
                        {discountValue > 0 && (
                            <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                                <span style={{ fontSize: '0.825rem', color: '#22c55e' }}>Discount</span>
                                <span style={{ fontSize: '0.825rem', color: '#22c55e', fontFamily: 'var(--font-mono)', fontWeight: 700 }}>−KSH {discountValue.toFixed(2)}</span>
                            </div>
                        )}
                        {mode === 'edit' && (
                            <div style={{ display: 'flex', justifyContent: 'space-between', background: 'rgba(59,130,246,0.08)', padding: '0.375rem 0.625rem', borderRadius: '0.375rem' }}>
                                <span style={{ fontSize: '0.8rem', color: '#60a5fa' }}>Previously Paid</span>
                                <span style={{ fontSize: '0.8rem', color: '#60a5fa', fontFamily: 'var(--font-mono)', fontWeight: 700 }}>−KSH {originalTotal.toFixed(2)}</span>
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
                                KSH {Math.abs(mode === 'edit' ? effectiveTotal : total).toFixed(2)}
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
                        ) : currentPayable === 0
                            ? 'Confirm On Credit →'
                            : balance > 0
                                ? `Pay KSH ${currentPayable.toFixed(2)} & Credit Bal →`
                                : editOrderId ? `Update Order · KSH ${total.toFixed(2)} →` : `Confirm Payment · KSH ${total.toFixed(2)} →`
                        }
                    </button>
                </div>
            </div>
        </div>
    );
}
