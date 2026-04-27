import { useCallback, memo } from 'react';
import { useNavigate } from 'react-router-dom';
import { useCartTotals } from '../../hooks/useCartTotals';

const S = {
    surface: { background: 'linear-gradient(135deg, rgba(255,255,255,0.05), rgba(255,255,255,0.02))', border: '1px solid rgba(255,255,255,0.08)', borderRadius: '0.875rem' },
    textPrimary: '#f1f5f9',
    textSecondary: '#64748b',
    textMuted: '#334155',
    brand: 'linear-gradient(135deg, #3b82f6, #06b6d4)',
};

const CartItem = memo(({ item, index, onEdit, onRemove }) => (
    <div className="group relative" style={{ borderBottom: '1px solid rgba(255,255,255,0.04)', paddingBottom: '1rem', marginBottom: '1rem' }}>
        <div style={{ display: 'flex', gap: '0.75rem', marginBottom: '0.5rem' }}>
            <div style={{
                width: '44px', height: '44px', flexShrink: 0, borderRadius: '10px',
                background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.1)',
                overflow: 'hidden', display: 'flex', alignItems: 'center', justifyContent: 'center',
            }}>
                <img src={item.image} loading="lazy" style={{ width: '100%', height: '100%', objectFit: 'cover', mixBlendMode: 'luminosity', opacity: 0.75 }} alt={item.name} onError={e => { e.currentTarget.style.display = 'none'; }} />
            </div>
            <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '0.5rem' }}>
                    <span style={{ fontSize: '0.82rem', fontWeight: 700, color: '#e2e8f0', lineHeight: 1.3, flex: 1 }}>{item.name}</span>
                    <span style={{ fontSize: '0.82rem', fontWeight: 800, color: '#60a5fa', fontFamily: 'var(--font-mono)', flexShrink: 0 }}>
                        KSH{(item.totalPrice || 0).toFixed(0)}
                    </span>
                </div>
                <div style={{ display: 'flex', gap: '0.75rem', marginTop: '0.25rem' }}>
                    <button onClick={() => onEdit(index)} style={{
                        fontSize: '0.68rem', color: '#3b82f6', fontWeight: 600, background: 'none', border: 'none', cursor: 'pointer', padding: 0,
                    }}>Edit</button>
                    <button onClick={() => onRemove(index)} style={{
                        fontSize: '0.68rem', color: '#ef4444', fontWeight: 600, background: 'none', border: 'none', cursor: 'pointer', padding: 0,
                    }}>Remove</button>
                </div>
            </div>
        </div>

        <div style={{ paddingLeft: '52px', fontSize: '0.7rem', color: S.textSecondary }}>
            <div style={{ display: 'flex', gap: '0.375rem', flexWrap: 'wrap', marginBottom: '0.25rem' }}>
                {item.details?.description && <span style={{ color: '#94a3b8', fontWeight: 600 }}>{item.details.description}</span>}
                {item.details?.color && (
                    <span style={{ display: 'flex', alignItems: 'center', gap: '0.25rem' }}>
                        <span style={{ width: '8px', height: '8px', borderRadius: '50%', background: item.details.color === 'White' ? '#e2e8f0' : item.details.color, border: '1px solid rgba(255,255,255,0.2)', display: 'inline-block' }} />
                        {item.details.color}
                    </span>
                )}
                {item.details?.attributes?.map((attr, i) => (
                    <span key={i} style={{ background: 'rgba(59,130,246,0.1)', border: '1px solid rgba(59,130,246,0.2)', borderRadius: '4px', padding: '1px 5px', color: '#93c5fd', fontSize: '0.65rem', fontWeight: 600 }}>
                        {attr.label === 'Color' ? (
                            <span style={{ display: 'flex', alignItems: 'center', gap: '3px' }}>
                                <span style={{ width: '6px', height: '6px', borderRadius: '50%', background: attr.value === 'White' ? '#e2e8f0' : attr.value, display: 'inline-block' }} />
                                {attr.value}
                            </span>
                        ) : attr.value}
                    </span>
                ))}
                {!item.details?.attributes && item.details?.extras && Object.entries(item.details.extras).map(([k, v]) => {
                    if (k === 'Color' || k === 'Category') return null;
                    return <span key={k} style={{ background: 'rgba(59,130,246,0.08)', border: '1px solid rgba(59,130,246,0.15)', borderRadius: '4px', padding: '1px 5px', color: '#93c5fd', fontSize: '0.65rem' }}>{v}{k === 'Length' && typeof v === 'number' ? 'ft' : ''}</span>;
                })}
            </div>

            {item.details?.lineItems?.length > 0 ? (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '2px', marginTop: '4px' }}>
                    {item.details.lineItems.map((li, i) => (
                        <div key={i} style={{ display: 'flex', justifyContent: 'space-between', fontFamily: 'var(--font-mono)', fontSize: '0.65rem' }}>
                            <span style={{ color: '#475569' }}>{li.label} <span style={{ color: '#334155' }}>×{li.qty}</span></span>
                            <span style={{ color: '#60a5fa', fontWeight: 700 }}>KSH{(li.total || 0).toFixed(0)}</span>
                        </div>
                    ))}
                </div>
            ) : item.details?.qty > 0 ? (
                <div style={{ display: 'flex', justifyContent: 'space-between', fontFamily: 'var(--font-mono)', fontSize: '0.65rem', marginTop: '2px' }}>
                    <span style={{ color: '#475569' }}>Qty</span>
                    <span style={{ color: '#94a3b8' }}>×{item.details.qty}</span>
                </div>
            ) : null}
        </div>
    </div>
));

export default function CartSidebar({ cartItems, onRemoveItem, onEditItem, customer, onChangeCustomer, actionLabel, onAction, mode, originalTotal = 0, enableTax, onToggleTax }) {
    const navigate = useNavigate();
    const { subtotal: subTotal, tax: vat, total: grandTotal } = useCartTotals(cartItems, enableTax);

    const balance = grandTotal - originalTotal;
    const isOwing = balance > 0;
    const isRefund = balance < 0;
    const isBalanced = Math.abs(balance) < 10;

    const handleAction = useCallback(() => {
        if (onAction) { onAction(); return; }
        navigate('/checkout', { state: { cartItems, customer, enableTax } });
    }, [onAction, navigate, cartItems, customer, enableTax]);

    return (
        <div style={{
            width: '100%', height: '100%', display: 'flex', flexDirection: 'column',
            background: 'rgba(9,14,26,0.98)',
            borderLeft: '1px solid rgba(255,255,255,0.07)',
            fontFamily: 'var(--font-sans)',
        }}>
            {/* Header */}
            <div style={{ padding: '1.5rem 1.25rem 1rem', borderBottom: '1px solid rgba(255,255,255,0.06)', flexShrink: 0 }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '0.875rem' }}>
                    <div>
                        <h2 style={{ fontSize: '1rem', fontWeight: 700, color: '#f1f5f9', margin: 0 }}>
                            {mode === 'edit' ? 'Editing Order' : 'Current Order'}
                        </h2>
                        <button onClick={onChangeCustomer} style={{
                            background: 'none', border: 'none', cursor: 'pointer', padding: 0,
                            fontSize: '0.78rem', marginTop: '2px',
                            color: customer ? '#60a5fa' : '#64748b',
                            fontWeight: customer ? 600 : 400,
                        }}>
                            {customer ? `${customer.name} ↗` : '+ Select Customer'}
                        </button>
                    </div>
                    <div style={{
                        width: '36px', height: '36px', borderRadius: '50%',
                        background: customer ? 'linear-gradient(135deg, #3b82f6, #06b6d4)' : 'rgba(255,255,255,0.06)',
                        border: '1px solid rgba(255,255,255,0.12)',
                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                        fontSize: '0.875rem',
                    }}>
                        {customer ? (customer.type === 'corporate' ? '🏢' : '👤') : '👤'}
                    </div>
                </div>

                <div style={{ position: 'relative' }}>
                    <input type="text" placeholder="Add note..." style={{
                        width: '100%', background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)',
                        borderRadius: '0.625rem', padding: '0.5rem 0.875rem', color: '#cbd5e1',
                        fontSize: '0.78rem', outline: 'none', boxSizing: 'border-box',
                    }} />
                </div>
            </div>

            {/* Cart count badge */}
            {cartItems?.length > 0 && (
                <div style={{ padding: '0.5rem 1.25rem', borderBottom: '1px solid rgba(255,255,255,0.04)' }}>
                    <span style={{ fontSize: '0.65rem', fontWeight: 700, color: '#475569', letterSpacing: '0.08em', textTransform: 'uppercase' }}>
                        {cartItems.length} {cartItems.length === 1 ? 'item' : 'items'}
                    </span>
                </div>
            )}

            {/* Cart Items */}
            <div style={{ flex: 1, overflowY: 'auto', padding: '1rem 1.25rem' }} className="custom-scrollbar">
                {(cartItems || []).length === 0 ? (
                    <div style={{ height: '100%', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: '0.75rem', opacity: 0.4 }}>
                        <div style={{ fontSize: '2.5rem', filter: 'grayscale(1)' }}>🛒</div>
                        <p style={{ color: '#475569', fontWeight: 500, fontSize: '0.875rem' }}>No items added</p>
                    </div>
                ) : (
                    [...cartItems].reverse().map((item, reversedIdx) => {
                        const idx = cartItems.length - 1 - reversedIdx;
                        return <CartItem key={`${item.id || 'item'}-${idx}`} item={item} index={idx} onEdit={onEditItem} onRemove={onRemoveItem} />;
                    })
                )}
            </div>

            {/* Footer */}
            <div style={{
                padding: '1rem 1.25rem',
                borderTop: '1px solid rgba(255,255,255,0.07)',
                background: 'rgba(0,0,0,0.3)',
                flexShrink: 0,
            }}>
                {originalTotal > 0 && (
                    <div style={{ marginBottom: '0.875rem', paddingBottom: '0.875rem', borderBottom: '1px solid rgba(255,255,255,0.06)' }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.72rem', color: '#475569', marginBottom: '4px' }}>
                            <span>Original Paid</span>
                            <span style={{ fontFamily: 'var(--font-mono)' }}>KSH{originalTotal.toFixed(2)}</span>
                        </div>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                            <span style={{ fontSize: '0.78rem', fontWeight: 700, color: isOwing ? '#fbbf24' : isRefund ? '#60a5fa' : '#4ade80' }}>
                                {isOwing ? 'Balance Due' : isRefund ? 'Refund Due' : 'Balanced'}
                            </span>
                            <span style={{ fontSize: '1.1rem', fontWeight: 800, fontFamily: 'var(--font-mono)', color: isOwing ? '#fbbf24' : isRefund ? '#60a5fa' : '#4ade80' }}>
                                {isBalanced ? '✓' : `KSH${Math.abs(balance).toFixed(2)}`}
                            </span>
                        </div>
                    </div>
                )}

                {originalTotal === 0 && (
                    <div style={{ marginBottom: '1rem' }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.78rem', color: '#64748b', marginBottom: '0.375rem' }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                                <span>Subtotal</span>
                                <button
                                    onClick={() => onToggleTax && onToggleTax(!enableTax)}
                                    style={{
                                        width: '28px', height: '15px', borderRadius: '100px', position: 'relative', cursor: 'pointer',
                                        background: enableTax ? 'rgba(59,130,246,0.5)' : 'rgba(255,255,255,0.08)',
                                        border: 'none', transition: 'background 0.2s',
                                    }}
                                    title="Toggle VAT"
                                >
                                    <span style={{
                                        position: 'absolute', top: '2px', left: enableTax ? '14px' : '2px',
                                        width: '11px', height: '11px', borderRadius: '50%', background: '#fff',
                                        transition: 'left 0.2s', display: 'block',
                                    }} />
                                </button>
                            </div>
                            <span style={{ fontFamily: 'var(--font-mono)' }}>KSH{subTotal.toFixed(2)}</span>
                        </div>
                        {enableTax && (
                            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.78rem', color: '#64748b', marginBottom: '0.375rem' }}>
                                <span>VAT (16%)</span>
                                <span style={{ fontFamily: 'var(--font-mono)' }}>KSH{vat.toFixed(2)}</span>
                            </div>
                        )}
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', paddingTop: '0.625rem', borderTop: '1px solid rgba(255,255,255,0.07)', marginTop: '0.375rem' }}>
                            <span style={{ fontSize: '0.9rem', fontWeight: 700, color: '#e2e8f0' }}>Total</span>
                            <span style={{ fontSize: '1.5rem', fontWeight: 900, fontFamily: 'var(--font-mono)', color: '#f1f5f9', letterSpacing: '-0.02em' }}>
                                KSH{grandTotal.toFixed(0)}
                            </span>
                        </div>
                    </div>
                )}

                <button
                    onClick={handleAction}
                    disabled={!cartItems?.length}
                    style={{
                        width: '100%', padding: '0.875rem',
                        borderRadius: '0.875rem', border: 'none', cursor: cartItems?.length ? 'pointer' : 'not-allowed',
                        background: !cartItems?.length ? 'rgba(255,255,255,0.06)'
                            : mode === 'edit'
                                ? (isRefund ? 'linear-gradient(135deg, #3b82f6, #2563eb)' : 'linear-gradient(135deg, #f59e0b, #d97706)')
                                : 'linear-gradient(135deg, #3b82f6, #06b6d4)',
                        color: cartItems?.length ? '#fff' : '#334155',
                        fontWeight: 800, fontSize: '0.875rem',
                        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                        boxShadow: cartItems?.length ? '0 4px 20px rgba(59,130,246,0.3)' : 'none',
                        transition: 'all 0.2s ease',
                        letterSpacing: '0.01em',
                    }}
                >
                    <span>
                        {mode === 'edit'
                            ? (isOwing ? 'Confirm & Pay' : isRefund ? 'Confirm Refund' : 'Update Order')
                            : (actionLabel || 'Checkout')}
                    </span>
                    <span style={{ fontFamily: 'var(--font-mono)', opacity: 0.85, fontSize: '0.8rem' }}>
                        {mode === 'edit'
                            ? (isBalanced ? '✓' : `KSH${Math.abs(balance).toFixed(0)}`)
                            : `KSH${grandTotal.toFixed(0)}`}
                    </span>
                </button>
            </div>
        </div>
    );
}
