import { memo, useEffect, useRef } from 'react';

const isToday = (dateStr) => {
    const d = new Date(dateStr);
    const now = new Date();
    return d.getFullYear() === now.getFullYear() &&
           d.getMonth() === now.getMonth() &&
           d.getDate() === now.getDate();
};

const OrderCard = memo(({ order, onAddTo, onEdit, onCancel, onView, highlighted }) => {
    const isCancelled = order.status === 'cancelled';
    const orderIsToday = isToday(order.date);
    const cardRef = useRef(null);

    useEffect(() => {
        if (highlighted) cardRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }, [highlighted]);

    return (
    <div
    ref={cardRef}
    onClick={() => onView?.(order)}
    style={{
        background: 'linear-gradient(135deg, rgba(255,255,255,0.05), rgba(255,255,255,0.02))',
        border: highlighted ? '1px solid rgba(59,130,246,0.5)' : '1px solid rgba(255,255,255,0.08)',
        borderRadius: '1rem', padding: '1.25rem 1.5rem',
        display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '1.5rem',
        flexWrap: 'wrap', transition: 'all 0.2s ease',
        position: 'relative', overflow: 'hidden',
        cursor: onView ? 'pointer' : 'default',
        boxShadow: highlighted ? '0 0 0 3px rgba(59,130,246,0.2), 0 8px 24px rgba(59,130,246,0.2)' : 'none',
    }}
    onMouseEnter={e => { e.currentTarget.style.background = 'linear-gradient(135deg, rgba(255,255,255,0.07), rgba(255,255,255,0.03))'; e.currentTarget.style.borderColor = 'rgba(59,130,246,0.2)'; }}
    onMouseLeave={e => { e.currentTarget.style.background = 'linear-gradient(135deg, rgba(255,255,255,0.05), rgba(255,255,255,0.02))'; e.currentTarget.style.borderColor = 'rgba(255,255,255,0.08)'; }}
    >
        {/* Left accent */}
        <div style={{ position: 'absolute', left: 0, top: 0, bottom: 0, width: '3px', background: order.balance > 0.1 ? 'linear-gradient(180deg, #f59e0b, #d97706)' : 'linear-gradient(180deg, #3b82f6, #06b6d4)', borderRadius: '3px 0 0 3px' }} />

        {/* Order Info */}
        <div style={{ flex: 1, minWidth: 0, paddingLeft: '0.5rem' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.625rem', marginBottom: '0.375rem' }}>
                <span style={{
                    background: 'rgba(59,130,246,0.1)', border: '1px solid rgba(59,130,246,0.2)',
                    color: '#93c5fd', padding: '2px 8px', borderRadius: '6px',
                    fontSize: '0.68rem', fontFamily: 'var(--font-mono)', fontWeight: 700,
                }}>{order.id}</span>
                {isCancelled && (
                    <span style={{
                        background: 'rgba(239,68,68,0.12)', border: '1px solid rgba(239,68,68,0.25)',
                        color: '#f87171', padding: '2px 8px', borderRadius: '6px',
                        fontSize: '0.65rem', fontWeight: 700, letterSpacing: '0.05em', textTransform: 'uppercase',
                    }}>Cancelled</span>
                )}
                <span style={{ color: '#334155', fontSize: '0.68rem', fontWeight: 500 }}>
                    {new Date(order.date).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}
                </span>
                {order.paymentMethod && (
                    <span style={{ fontSize: '0.65rem', color: '#475569', background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: '4px', padding: '1px 6px', fontWeight: 600 }}>
                        {order.paymentMethod}
                    </span>
                )}
            </div>
            <h3 style={{ fontSize: '1rem', fontWeight: 800, color: '#e2e8f0', margin: '0 0 0.375rem', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{order.customer.name}</h3>
            <div style={{ display: 'flex', gap: '0.375rem', flexWrap: 'wrap' }}>
                {order.items.slice(0, 3).map((item, idx) => (
                    <span key={idx} style={{
                        fontSize: '0.67rem', background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.07)',
                        color: '#64748b', padding: '2px 8px', borderRadius: '4px',
                        maxWidth: '150px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                    }}>{item.name}</span>
                ))}
                {order.items.length > 3 && <span style={{ fontSize: '0.67rem', color: '#475569', padding: '2px 0' }}>+{order.items.length - 3} more</span>}
            </div>
        </div>

        {/* Financials */}
        <div style={{ textAlign: 'right', minWidth: '110px' }}>
            {order.balance > 0.1 ? (
                <>
                    <div style={{ fontSize: '0.65rem', fontWeight: 700, color: '#f59e0b', letterSpacing: '0.07em', textTransform: 'uppercase', marginBottom: '2px' }}>Balance Due</div>
                    <div style={{ fontSize: '1.375rem', fontWeight: 900, color: '#fbbf24', fontFamily: 'var(--font-mono)', letterSpacing: '-0.02em' }}>KSH{order.balance.toLocaleString()}</div>
                    <div style={{ fontSize: '0.68rem', color: '#475569', marginTop: '2px' }}>Total: KSH{order.totalAmount?.toLocaleString()}</div>
                </>
            ) : (
                <>
                    <div style={{ fontSize: '0.65rem', fontWeight: 700, color: '#475569', letterSpacing: '0.07em', textTransform: 'uppercase', marginBottom: '2px' }}>Total</div>
                    <div style={{ fontSize: '1.375rem', fontWeight: 900, color: '#f1f5f9', fontFamily: 'var(--font-mono)', letterSpacing: '-0.02em' }}>KSH{order.totalAmount?.toLocaleString()}</div>
                </>
            )}
        </div>

        {/* Actions */}
        <div style={{ display: 'flex', gap: '0.5rem' }} onClick={e => e.stopPropagation()}>
            {!isCancelled && orderIsToday && (
                <button onClick={() => onAddTo(order)} style={{
                    padding: '0.5rem 1rem', borderRadius: '0.625rem',
                    background: 'rgba(59,130,246,0.1)', border: '1px solid rgba(59,130,246,0.2)',
                    color: '#60a5fa', fontWeight: 700, fontSize: '0.78rem', cursor: 'pointer',
                    transition: 'all 0.15s', display: 'flex', alignItems: 'center', gap: '0.375rem',
                }}
                onMouseEnter={e => { e.currentTarget.style.background = 'rgba(59,130,246,0.18)'; }}
                onMouseLeave={e => { e.currentTarget.style.background = 'rgba(59,130,246,0.1)'; }}
                >➕ Add To</button>
            )}
            {!isCancelled && (
                <button onClick={() => onEdit(order)} style={{
                    padding: '0.5rem 1rem', borderRadius: '0.625rem',
                    background: 'linear-gradient(135deg, #3b82f6, #06b6d4)', border: 'none',
                    color: '#fff', fontWeight: 700, fontSize: '0.78rem', cursor: 'pointer',
                    transition: 'all 0.15s', boxShadow: '0 2px 12px rgba(59,130,246,0.3)',
                    display: 'flex', alignItems: 'center', gap: '0.375rem',
                }}
                onMouseEnter={e => { e.currentTarget.style.transform = 'translateY(-1px)'; }}
                onMouseLeave={e => { e.currentTarget.style.transform = 'translateY(0)'; }}
                >✏️ Edit</button>
            )}
            {!isCancelled && onCancel && (
                <button onClick={() => onCancel(order)} style={{
                    padding: '0.5rem 1rem', borderRadius: '0.625rem',
                    background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.2)',
                    color: '#f87171', fontWeight: 700, fontSize: '0.78rem', cursor: 'pointer',
                    transition: 'all 0.15s', display: 'flex', alignItems: 'center', gap: '0.375rem',
                }}
                onMouseEnter={e => { e.currentTarget.style.background = 'rgba(239,68,68,0.16)'; }}
                onMouseLeave={e => { e.currentTarget.style.background = 'rgba(239,68,68,0.08)'; }}
                >🚫 Cancel</button>
            )}
        </div>
    </div>
    );
});

export default OrderCard;
