import { memo } from 'react';

const InvoiceCard = memo(({ invoice, onView, onConvert }) => (
    <div style={{
        background: 'linear-gradient(135deg, rgba(245,158,11,0.06), rgba(255,255,255,0.02))',
        border: '1px solid rgba(245,158,11,0.15)',
        borderRadius: '1rem', padding: '1.25rem 1.5rem',
        display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '1.5rem',
        flexWrap: 'wrap', transition: 'all 0.2s ease',
        position: 'relative', overflow: 'hidden',
    }}
    onMouseEnter={e => { e.currentTarget.style.borderColor = 'rgba(245,158,11,0.3)'; e.currentTarget.style.background = 'linear-gradient(135deg, rgba(245,158,11,0.09), rgba(255,255,255,0.03))'; }}
    onMouseLeave={e => { e.currentTarget.style.borderColor = 'rgba(245,158,11,0.15)'; e.currentTarget.style.background = 'linear-gradient(135deg, rgba(245,158,11,0.06), rgba(255,255,255,0.02))'; }}
    >
        {/* Left accent */}
        <div style={{
            position: 'absolute', left: 0, top: 0, bottom: 0, width: '3px',
            background: invoice.status === 'converted' ? 'linear-gradient(180deg, #22c55e, #16a34a)' : 'linear-gradient(180deg, #f59e0b, #d97706)',
            borderRadius: '3px 0 0 3px',
        }} />

        {/* Invoice Info */}
        <div style={{ flex: 1, minWidth: 0, paddingLeft: '0.5rem' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.625rem', marginBottom: '0.375rem' }}>
                <span style={{
                    background: 'rgba(245,158,11,0.12)', border: '1px solid rgba(245,158,11,0.25)',
                    color: '#fbbf24', padding: '2px 8px', borderRadius: '6px',
                    fontSize: '0.68rem', fontFamily: 'var(--font-mono)', fontWeight: 700,
                }}>{invoice.id}</span>
                <span style={{ color: '#334155', fontSize: '0.68rem' }}>
                    {new Date(invoice.date).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}
                </span>
                {invoice.status === 'converted' && (
                    <span style={{ fontSize: '0.65rem', fontWeight: 700, background: 'rgba(34,197,94,0.12)', border: '1px solid rgba(34,197,94,0.25)', color: '#4ade80', borderRadius: '100px', padding: '1px 7px' }}>
                        ✓ Converted
                    </span>
                )}
            </div>
            <h3 style={{ fontSize: '1rem', fontWeight: 800, color: '#e2e8f0', margin: '0 0 0.25rem' }}>{invoice.customer.name}</h3>
            <span style={{ fontSize: '0.7rem', color: '#64748b' }}>{invoice.items?.length || 0} items</span>
        </div>

        {/* Total */}
        <div style={{ textAlign: 'right', minWidth: '110px' }}>
            <div style={{ fontSize: '0.65rem', fontWeight: 700, color: '#64748b', letterSpacing: '0.07em', textTransform: 'uppercase', marginBottom: '2px' }}>Estimate</div>
            <div style={{ fontSize: '1.375rem', fontWeight: 900, color: '#fbbf24', fontFamily: 'var(--font-mono)', letterSpacing: '-0.02em' }}>
                KSH{(invoice.total || 0).toLocaleString()}
            </div>
        </div>

        {/* Actions */}
        <div style={{ display: 'flex', gap: '0.5rem' }}>
            {invoice.status !== 'converted' && (
                <button onClick={() => onConvert(invoice)} style={{
                    padding: '0.5rem 1rem', borderRadius: '0.625rem',
                    background: 'rgba(34,197,94,0.12)', border: '1px solid rgba(34,197,94,0.25)',
                    color: '#4ade80', fontWeight: 700, fontSize: '0.78rem', cursor: 'pointer', transition: 'all 0.15s',
                }}
                onMouseEnter={e => { e.currentTarget.style.background = 'rgba(34,197,94,0.2)'; }}
                onMouseLeave={e => { e.currentTarget.style.background = 'rgba(34,197,94,0.12)'; }}
                >✅ Convert</button>
            )}
            <button onClick={() => onView(invoice)} style={{
                padding: '0.5rem 1rem', borderRadius: '0.625rem',
                background: 'linear-gradient(135deg, #f59e0b, #d97706)', border: 'none',
                color: '#0a0a0a', fontWeight: 800, fontSize: '0.78rem', cursor: 'pointer',
                transition: 'all 0.15s', boxShadow: '0 2px 12px rgba(245,158,11,0.3)',
            }}
            onMouseEnter={e => { e.currentTarget.style.transform = 'translateY(-1px)'; }}
            onMouseLeave={e => { e.currentTarget.style.transform = 'translateY(0)'; }}
            >👁️ View</button>
        </div>
    </div>
));

export default InvoiceCard;
