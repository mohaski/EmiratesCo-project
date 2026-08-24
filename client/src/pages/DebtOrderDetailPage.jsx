import { useState, useEffect, useMemo } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import api from '../services/api';

const STATUS_COLORS = {
    pending:   { bg: 'rgba(148,163,184,0.12)', border: 'rgba(148,163,184,0.25)', text: '#cbd5e1' },
    confirmed: { bg: 'rgba(59,130,246,0.12)',  border: 'rgba(59,130,246,0.25)',  text: '#60a5fa' },
    ready:     { bg: 'rgba(245,158,11,0.12)',  border: 'rgba(245,158,11,0.25)',  text: '#fbbf24' },
    completed: { bg: 'rgba(34,197,94,0.12)',   border: 'rgba(34,197,94,0.25)',   text: '#4ade80' },
    cancelled: { bg: 'rgba(239,68,68,0.12)',   border: 'rgba(239,68,68,0.25)',   text: '#f87171' },
};

const CREDIT_STATUS_COLORS = {
    'Pending': '#f59e0b',
    'Partially Paid': '#3b82f6',
    'Paid': '#22c55e',
};

const REASON_META = {
    order: { label: 'Order Payment', color: '#60a5fa' },
    debt: { label: 'Debt Collection', color: '#f59e0b' },
    refund: { label: 'Refund', color: '#f87171' },
};

const METHOD_LABELS = {
    cash: 'Cash',
    mpesa: 'M-Pesa',
    split: 'Split',
    number: 'Other',
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

const Row = ({ label, value, strong, color }) => (
    <div style={{ display: 'flex', justifyContent: 'space-between', gap: '1rem', padding: '0.3rem 0' }}>
        <span style={{ fontSize: strong ? '0.9rem' : '0.82rem', color: strong ? '#f1f5f9' : '#64748b', fontWeight: strong ? 800 : 500 }}>{label}</span>
        <span style={{ fontSize: strong ? '0.9rem' : '0.82rem', color: color || (strong ? '#f1f5f9' : '#94a3b8'), fontFamily: 'var(--font-mono)', fontWeight: strong ? 800 : 600 }}>{value}</span>
    </div>
);

function formatMethod(payment) {
    if (payment.method === 'split' && payment.paymentDetails) {
        const parts = Object.entries(payment.paymentDetails)
            .filter(([, v]) => Number(v) > 0)
            .map(([k, v]) => `${METHOD_LABELS[k] || k} KSH ${Number(v).toLocaleString()}`);
        return parts.length ? `Split (${parts.join(' + ')})` : 'Split';
    }
    return METHOD_LABELS[payment.method] || payment.method;
}

// Order overview + debt standing + full repayment history for one dues row —
// intentionally does NOT show line items/cutting details (that's OrderSummaryPage's
// job); this page is scoped to "is this debt cleared, and who paid what when."
export default function DebtOrderDetailPage() {
    const location = useLocation();
    const navigate = useNavigate();
    const orderId = location.state?.orderId;
    const creditRow = location.state?.creditRow || null;

    const [order, setOrder] = useState(null);
    const [payments, setPayments] = useState([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(null);

    useEffect(() => {
        if (!orderId) { setLoading(false); return; }
        let cancelled = false;
        (async () => {
            setLoading(true);
            try {
                const [orderData, paymentsData] = await Promise.all([
                    api.orderService.getOrder(orderId),
                    api.financialService.getPaymentsForOrder(orderId),
                ]);
                if (cancelled) return;
                setOrder(orderData);
                setPayments(paymentsData);
                setError(null);
            } catch (err) {
                console.error('Failed to load debt order detail', err);
                if (!cancelled) setError('Failed to load order and payment details.');
            } finally {
                if (!cancelled) setLoading(false);
            }
        })();
        return () => { cancelled = true; };
    }, [orderId]);

    const totalPaid = useMemo(
        () => payments.filter(p => p.reason !== 'refund').reduce((sum, p) => sum + p.amount, 0)
            - payments.filter(p => p.reason === 'refund').reduce((sum, p) => sum + p.amount, 0),
        [payments]
    );

    if (!orderId) {
        return (
            <div style={{ minHeight: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', flexDirection: 'column', gap: '1rem', background: 'var(--color-bg)' }}>
                <p style={{ color: '#64748b', fontSize: '0.875rem' }}>No order selected.</p>
                <button onClick={() => navigate('/debt-management')} style={{ color: '#60a5fa', fontWeight: 700, background: 'none', border: 'none', cursor: 'pointer', fontSize: '0.875rem' }}>← Back to Debt Management</button>
            </div>
        );
    }

    if (loading) {
        return (
            <div style={{ minHeight: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'var(--color-bg)' }}>
                <p style={{ color: '#475569', fontSize: '0.875rem' }}>Loading…</p>
            </div>
        );
    }

    if (error || !order) {
        return (
            <div style={{ minHeight: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', flexDirection: 'column', gap: '1rem', background: 'var(--color-bg)' }}>
                <p style={{ color: '#f87171', fontSize: '0.875rem' }}>{error || 'Order not found.'}</p>
                <button onClick={() => navigate('/debt-management')} style={{ color: '#60a5fa', fontWeight: 700, background: 'none', border: 'none', cursor: 'pointer', fontSize: '0.875rem' }}>← Back to Debt Management</button>
            </div>
        );
    }

    const statusColor = STATUS_COLORS[order.status] || STATUS_COLORS.pending;
    const isCleared = order.balance <= 0.10;
    const customerName = order.customerName || creditRow?.customerName || 'Walk-in Customer';
    const customerPhone = order.customerPhone || creditRow?.customerPhone;

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
                    <button onClick={() => navigate('/debt-management')} style={{
                        display: 'flex', alignItems: 'center', gap: '0.5rem', background: 'none', border: 'none', cursor: 'pointer',
                        color: '#475569', fontSize: '0.78rem', fontWeight: 600, letterSpacing: '0.05em', textTransform: 'uppercase',
                        marginBottom: '0.5rem', padding: 0,
                    }}>← Back to Debt Management</button>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', flexWrap: 'wrap' }}>
                        <h1 style={{ fontSize: 'clamp(1.1rem, 4vw, 1.375rem)', fontWeight: 800, color: '#f1f5f9', margin: 0, letterSpacing: '-0.025em' }}>Order {order.orderId}</h1>
                        <span style={{
                            fontSize: '0.65rem', fontWeight: 700, padding: '2px 10px', borderRadius: '100px',
                            background: statusColor.bg, border: `1px solid ${statusColor.border}`, color: statusColor.text,
                            letterSpacing: '0.06em', textTransform: 'uppercase',
                        }}>{order.status}</span>
                        <span style={{
                            fontSize: '0.65rem', fontWeight: 700, padding: '2px 10px', borderRadius: '100px',
                            background: isCleared ? 'rgba(34,197,94,0.12)' : 'rgba(245,158,11,0.12)',
                            border: `1px solid ${isCleared ? 'rgba(34,197,94,0.25)' : 'rgba(245,158,11,0.25)'}`,
                            color: isCleared ? '#4ade80' : '#fbbf24',
                            letterSpacing: '0.06em', textTransform: 'uppercase',
                        }}>{isCleared ? '✅ Debt Cleared' : '⏳ Debt Outstanding'}</span>
                    </div>
                    <p style={{ fontSize: '0.78rem', color: '#475569', margin: '2px 0 0' }}>
                        {new Date(order.created_at).toLocaleString('en-GB', { day: 'numeric', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit' })}
                    </p>
                </div>
            </div>

            {/* Body */}
            <div style={{
                padding: 'clamp(1rem, 4vw, 1.75rem) clamp(1rem, 4vw, 2rem)', display: 'grid',
                gridTemplateColumns: 'minmax(0, 1fr) 340px', gap: '1.5rem', alignItems: 'start',
            }}
            className="debt-detail-grid"
            >
                {/* Main: repayment history */}
                <Card title={`Repayments (${payments.length})`}>
                    {payments.length === 0 ? (
                        <p style={{ color: '#334155', fontSize: '0.82rem' }}>No payments recorded against this order yet.</p>
                    ) : (
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.625rem' }}>
                            {payments.map(p => {
                                const meta = REASON_META[p.reason] || { label: p.reason, color: '#94a3b8' };
                                const isRefund = p.reason === 'refund';
                                return (
                                    <div key={p.paymentId} style={{
                                        display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '1rem',
                                        padding: '0.75rem 0.875rem', background: 'rgba(255,255,255,0.02)',
                                        border: '1px solid rgba(255,255,255,0.06)', borderRadius: '0.75rem',
                                    }}>
                                        <div style={{ minWidth: 0 }}>
                                            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', flexWrap: 'wrap' }}>
                                                <span style={{
                                                    fontSize: '0.65rem', fontWeight: 700, padding: '1px 8px', borderRadius: '100px',
                                                    background: `${meta.color}18`, border: `1px solid ${meta.color}30`, color: meta.color,
                                                    textTransform: 'uppercase', letterSpacing: '0.04em',
                                                }}>{meta.label}</span>
                                                <span style={{ fontSize: '0.78rem', color: '#94a3b8', fontWeight: 600 }}>{formatMethod(p)}</span>
                                            </div>
                                            <div style={{ fontSize: '0.72rem', color: '#475569', marginTop: '4px' }}>
                                                {new Date(p.payedAt).toLocaleString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })}
                                                {p.recordedByName && ` · by ${p.recordedByName}`}
                                            </div>
                                        </div>
                                        <div style={{
                                            fontSize: '0.9rem', fontWeight: 800, fontFamily: 'var(--font-mono)', whiteSpace: 'nowrap',
                                            color: isRefund ? '#f87171' : '#4ade80',
                                        }}>{isRefund ? '- ' : ''}KSH {p.amount.toLocaleString()}</div>
                                    </div>
                                );
                            })}
                        </div>
                    )}
                </Card>

                {/* Sidebar: order overview + debt details */}
                <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
                    <Card title="Order Overview">
                        <Row label="Customer" value={customerName} />
                        {customerPhone && <Row label="Phone" value={customerPhone} />}
                        <Row label="Order Total" value={`KSH ${(order.total || 0).toLocaleString()}`} />
                        <Row label="VAT" value={order.VAT_status ? 'Included' : 'Not applied'} />
                        <Row label="Order Status" value={order.status} />
                    </Card>

                    <Card title="Debt Details">
                        <Row label="Total Paid" value={`KSH ${Math.max(totalPaid, 0).toLocaleString()}`} color="#4ade80" />
                        <Row label="Balance Due" value={`KSH ${(order.balance || 0).toLocaleString()}`} strong color={isCleared ? '#4ade80' : '#fbbf24'} />
                        <div style={{ borderTop: '1px solid rgba(255,255,255,0.08)', margin: '0.5rem 0' }} />
                        <Row label="Status" value={creditRow?.status || order.paymentStatus || '—'} color={CREDIT_STATUS_COLORS[creditRow?.status] || undefined} />
                        {typeof creditRow?.daysOutstanding === 'number' && (
                            <Row label="Days Outstanding" value={`${creditRow.daysOutstanding}d`} />
                        )}
                        <div style={{
                            marginTop: '0.875rem', padding: '0.625rem 0.75rem', borderRadius: '0.75rem', textAlign: 'center',
                            background: isCleared ? 'rgba(34,197,94,0.1)' : 'rgba(245,158,11,0.1)',
                            border: `1px solid ${isCleared ? 'rgba(34,197,94,0.25)' : 'rgba(245,158,11,0.25)'}`,
                            color: isCleared ? '#4ade80' : '#fbbf24', fontSize: '0.8rem', fontWeight: 700,
                        }}>
                            {isCleared ? '✅ Fully Cleared' : `⏳ KSH ${(order.balance || 0).toLocaleString()} still owed`}
                        </div>
                    </Card>
                </div>
            </div>
            <style>{`
                @media (max-width: 900px) {
                    .debt-detail-grid { grid-template-columns: minmax(0, 1fr) !important; }
                }
            `}</style>
        </div>
    );
}
