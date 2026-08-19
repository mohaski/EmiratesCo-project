import { useState, useMemo } from 'react';
import api from '../../services/api';
import { ceilAmount } from '../../utils/money';

const METHODS = [
    { id: 'cash', label: 'Cash', icon: '💵' },
    { id: 'mpesa', label: 'M-Pesa', icon: '📱' },
    { id: 'split', label: 'Split', icon: '⚖️' },
];

export default function PaymentModal({ order, onClose, onSuccess }) {
    const balance = order.balance || 0;
    const [amount, setAmount] = useState(String(balance));
    const [paymentMethod, setPaymentMethod] = useState('cash');
    const [cashAmount, setCashAmount] = useState('');
    const [submitting, setSubmitting] = useState(false);
    const [error, setError] = useState(null);

    const parsedAmount = ceilAmount(parseFloat(amount) || 0);
    const cashExceedsAmount = paymentMethod === 'split' && (parseFloat(cashAmount) || 0) > parsedAmount;
    const isValid = parsedAmount > 0 && parsedAmount <= balance + 0.1 && !cashExceedsAmount;

    const remainingAfter = useMemo(() => Math.max(0, balance - parsedAmount), [balance, parsedAmount]);
    const mpesaAutoAmount = useMemo(() => Math.max(0, ceilAmount(parsedAmount - (parseFloat(cashAmount) || 0))), [parsedAmount, cashAmount]);

    const handleSubmit = async () => {
        if (!isValid || submitting) return;
        setSubmitting(true);
        setError(null);
        try {
            await api.financialService.createPayment({
                orderId: order.id,
                amount: parsedAmount,
                paymentMethod,
                paymentDetails: paymentMethod === 'split' ? { cash: parseFloat(cashAmount) || 0, mpesa: mpesaAutoAmount } : null,
            });
            onSuccess?.();
        } catch (err) {
            console.error('Failed to record payment', err);
            setError(err.response?.data?.detail || 'Failed to record payment. Please try again.');
        } finally {
            setSubmitting(false);
        }
    };

    return (
        <div style={{
            position: 'fixed', inset: 0, zIndex: 200,
            background: 'rgba(0,0,0,0.6)', backdropFilter: 'blur(4px)',
            display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '1rem',
        }} onClick={onClose}>
            <div
                onClick={e => e.stopPropagation()}
                style={{
                    width: '100%', maxWidth: '420px', maxHeight: 'min(720px, 90vh)', overflowY: 'auto',
                    background: 'linear-gradient(135deg, #0f172a, #0b1220)',
                    border: '1px solid rgba(255,255,255,0.1)', borderRadius: '1.25rem',
                    padding: 'clamp(1rem, 5vw, 1.75rem)', boxShadow: '0 24px 64px rgba(0,0,0,0.5)',
                    boxSizing: 'border-box',
                }}
                className="custom-scrollbar"
            >
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '1.25rem' }}>
                    <div>
                        <h2 style={{ fontSize: '1.05rem', fontWeight: 800, color: '#f1f5f9', margin: 0 }}>Collect Debt</h2>
                        <p style={{ fontSize: '0.75rem', color: '#64748b', margin: '0.25rem 0 0' }}>Order #{order.id} · {order.customer?.name}</p>
                    </div>
                    <button onClick={onClose} style={{
                        width: '32px', height: '32px', borderRadius: '8px',
                        background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.1)',
                        color: '#64748b', cursor: 'pointer', fontSize: '1rem', lineHeight: 1,
                    }}>✕</button>
                </div>

                {/* Order summary */}
                <div style={{
                    display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(110px, 100%), 1fr))', gap: '0.75rem',
                    background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.06)',
                    borderRadius: '0.875rem', padding: '0.875rem 1rem', marginBottom: '1.25rem',
                }}>
                    <div>
                        <div style={{ fontSize: '0.62rem', fontWeight: 700, color: '#475569', textTransform: 'uppercase', letterSpacing: '0.06em' }}>Total</div>
                        <div style={{ fontSize: '0.95rem', fontWeight: 700, color: '#e2e8f0' }}>KSH {(order.totalAmount || 0).toLocaleString()}</div>
                    </div>
                    <div>
                        <div style={{ fontSize: '0.62rem', fontWeight: 700, color: '#475569', textTransform: 'uppercase', letterSpacing: '0.06em' }}>Already Paid</div>
                        <div style={{ fontSize: '0.95rem', fontWeight: 700, color: '#e2e8f0' }}>KSH {(order.amountPaid || 0).toLocaleString()}</div>
                    </div>
                    <div style={{ gridColumn: '1 / -1' }}>
                        <div style={{ fontSize: '0.62rem', fontWeight: 700, color: '#f59e0b', textTransform: 'uppercase', letterSpacing: '0.06em' }}>Balance Due</div>
                        <div style={{ fontSize: '1.5rem', fontWeight: 900, color: '#fbbf24', fontFamily: 'var(--font-mono)' }}>KSH {balance.toLocaleString()}</div>
                    </div>
                </div>

                {/* Amount */}
                <label style={{ display: 'block', fontSize: '0.68rem', fontWeight: 600, color: '#94a3b8', letterSpacing: '0.08em', textTransform: 'uppercase', marginBottom: '0.375rem' }}>
                    Amount Collecting Now
                </label>
                <input
                    type="number"
                    value={amount}
                    onChange={e => setAmount(e.target.value)}
                    min="0"
                    max={balance}
                    step="1"
                    style={{
                        width: '100%', boxSizing: 'border-box', background: 'rgba(255,255,255,0.05)',
                        border: '1px solid rgba(255,255,255,0.12)', borderRadius: '0.75rem',
                        padding: '0.75rem 1rem', color: '#f1f5f9', fontSize: '1.1rem', fontWeight: 700,
                        fontFamily: 'var(--font-mono)', outline: 'none', marginBottom: '0.375rem',
                    }}
                />
                <p style={{ fontSize: '0.7rem', color: remainingAfter > 0.1 ? '#f59e0b' : '#22c55e', margin: '0 0 1.25rem' }}>
                    {remainingAfter > 0.1
                        ? `Balance remaining after this payment: KSH ${remainingAfter.toLocaleString()}`
                        : 'Order will be fully paid.'}
                </p>

                {/* Payment method */}
                <label style={{ display: 'block', fontSize: '0.68rem', fontWeight: 600, color: '#94a3b8', letterSpacing: '0.08em', textTransform: 'uppercase', marginBottom: '0.5rem' }}>
                    Payment Method
                </label>
                <div style={{ display: 'flex', gap: '0.5rem', marginBottom: '1.25rem', flexWrap: 'wrap' }}>
                    {METHODS.map(m => (
                        <button key={m.id} onClick={() => setPaymentMethod(m.id)} style={{
                            flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '0.375rem',
                            padding: '0.75rem 0.5rem',
                            background: paymentMethod === m.id ? 'rgba(34,197,94,0.12)' : 'rgba(255,255,255,0.03)',
                            border: paymentMethod === m.id ? '1px solid rgba(34,197,94,0.4)' : '1px solid rgba(255,255,255,0.08)',
                            borderRadius: '0.75rem', cursor: 'pointer', transition: 'all 0.15s',
                        }}>
                            <span style={{ fontSize: '1.25rem' }}>{m.icon}</span>
                            <span style={{ fontSize: '0.7rem', fontWeight: 700, color: paymentMethod === m.id ? '#4ade80' : '#64748b' }}>{m.label}</span>
                        </button>
                    ))}
                </div>

                {paymentMethod === 'split' && (
                    <div style={{
                        padding: '1rem',
                        background: 'rgba(168,85,247,0.06)',
                        border: '1px solid rgba(168,85,247,0.2)',
                        borderRadius: '0.875rem',
                        display: 'flex', flexDirection: 'column', gap: '0.75rem',
                        marginBottom: '1.25rem',
                    }}>
                        <div>
                            <label style={{ display: 'block', fontSize: '0.68rem', fontWeight: 600, color: '#a855f7', letterSpacing: '0.08em', textTransform: 'uppercase', marginBottom: '0.375rem' }}>Cash Amount</label>
                            <input
                                type="number"
                                value={cashAmount}
                                onChange={e => setCashAmount(e.target.value)}
                                placeholder="0"
                                style={{
                                    width: '100%', boxSizing: 'border-box', background: 'rgba(255,255,255,0.05)',
                                    border: '1px solid rgba(255,255,255,0.1)', borderRadius: '0.625rem',
                                    padding: '0.625rem 0.875rem', color: '#f1f5f9', fontSize: '0.875rem',
                                    fontFamily: 'var(--font-mono)', fontWeight: 600, outline: 'none',
                                }}
                            />
                        </div>
                        <div>
                            <label style={{ display: 'block', fontSize: '0.68rem', fontWeight: 600, color: '#94a3b8', letterSpacing: '0.08em', textTransform: 'uppercase', marginBottom: '0.375rem' }}>M-Pesa (auto)</label>
                            <input
                                type="number"
                                value={mpesaAutoAmount.toFixed(0)}
                                readOnly
                                style={{
                                    width: '100%', boxSizing: 'border-box', background: 'rgba(255,255,255,0.02)',
                                    border: '1px solid rgba(255,255,255,0.06)', borderRadius: '0.625rem',
                                    padding: '0.625rem 0.875rem', color: '#475569', fontSize: '0.875rem',
                                    fontFamily: 'var(--font-mono)', fontWeight: 600, outline: 'none', cursor: 'not-allowed',
                                }}
                            />
                        </div>
                        {cashExceedsAmount && (
                            <div style={{ fontSize: '0.75rem', fontWeight: 600, color: '#f87171' }}>
                                ⚠ Cash exceeds amount collecting (max KSH {parsedAmount.toFixed(0)})
                            </div>
                        )}
                    </div>
                )}

                {error && (
                    <div style={{ background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.3)', color: '#fca5a5', padding: '0.625rem 0.875rem', borderRadius: '0.625rem', fontSize: '0.78rem', marginBottom: '1rem' }}>
                        {error}
                    </div>
                )}

                <button
                    onClick={handleSubmit}
                    disabled={!isValid || submitting}
                    style={{
                        width: '100%', padding: '0.875rem', borderRadius: '0.875rem', border: 'none',
                        background: (!isValid || submitting) ? 'rgba(255,255,255,0.08)' : 'linear-gradient(135deg, #22c55e, #16a34a)',
                        color: (!isValid || submitting) ? '#475569' : '#fff',
                        fontWeight: 800, fontSize: '0.9rem', cursor: (!isValid || submitting) ? 'not-allowed' : 'pointer',
                        boxShadow: (!isValid || submitting) ? 'none' : '0 4px 20px rgba(34,197,94,0.35)',
                    }}
                >
                    {submitting ? 'Recording…' : `Record KSH ${parsedAmount.toLocaleString()} Payment`}
                </button>
            </div>
        </div>
    );
}
