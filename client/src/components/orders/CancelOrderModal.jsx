import { useState } from 'react';

const CancelOrderModal = ({ order, onClose, onConfirm }) => {
    const [pin, setPin] = useState('');
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState('');

    if (!order) return null;

    const handlePinChange = e => {
        const digits = e.target.value.replace(/\D/g, '').slice(0, 4);
        setPin(digits);
        if (error) setError('');
    };

    const handleSubmit = async e => {
        e.preventDefault();
        if (pin.length !== 4) {
            setError('Enter the 4-digit PIN.');
            return;
        }
        setLoading(true);
        setError('');
        try {
            await onConfirm(pin);
        } catch (err) {
            setError(err.response?.data?.detail || 'Failed to cancel order. Please try again.');
        } finally {
            setLoading(false);
        }
    };

    return (
        <div style={{
            position: 'fixed', inset: 0, zIndex: 60, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '1rem',
            background: 'rgba(9,14,26,0.85)', backdropFilter: 'blur(12px)',
        }} onClick={onClose}>
            <div onClick={e => e.stopPropagation()} style={{
                width: '100%', maxWidth: '400px',
                background: 'linear-gradient(145deg, rgba(13,20,38,0.99), rgba(9,14,26,0.99))',
                border: '1px solid rgba(239,68,68,0.25)', borderRadius: '1.5rem', overflow: 'hidden',
                boxShadow: '0 32px 80px rgba(0,0,0,0.7)', animation: 'fadeInScale 0.2s ease',
            }}>
                {/* Header */}
                <div style={{ padding: '1.5rem 2rem', borderBottom: '1px solid rgba(255,255,255,0.07)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
                        <div style={{ width: '36px', height: '36px', borderRadius: '10px', background: 'rgba(239,68,68,0.15)', border: '1px solid rgba(239,68,68,0.3)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '1rem' }}>🚫</div>
                        <div>
                            <h2 style={{ fontSize: '1rem', fontWeight: 800, color: '#f1f5f9', margin: 0 }}>Cancel Order {order.id}</h2>
                            <p style={{ fontSize: '0.68rem', color: '#475569', margin: 0, letterSpacing: '0.06em', textTransform: 'uppercase' }}>Requires manager PIN</p>
                        </div>
                    </div>
                    <button onClick={onClose} style={{ width: '30px', height: '30px', borderRadius: '8px', border: '1px solid rgba(255,255,255,0.1)', background: 'rgba(255,255,255,0.05)', color: '#64748b', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>✕</button>
                </div>

                {/* Body */}
                <div style={{ padding: '1.5rem 2rem' }}>
                    <p style={{ fontSize: '0.82rem', color: '#94a3b8', margin: '0 0 1.25rem', lineHeight: 1.5 }}>
                        This will restore the stock and offcuts consumed by this order. This cannot be undone from here.
                    </p>

                    {error && (
                        <div style={{ marginBottom: '1rem', padding: '0.75rem 1rem', background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.2)', borderRadius: '0.75rem', color: '#f87171', fontSize: '0.82rem', fontWeight: 600 }}>
                            ⚠️ {error}
                        </div>
                    )}

                    <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
                        <div>
                            <label style={{ fontSize: '0.62rem', fontWeight: 700, color: '#475569', letterSpacing: '0.08em', textTransform: 'uppercase', display: 'block', marginBottom: '0.375rem' }}>4-Digit PIN</label>
                            <input
                                type="password"
                                inputMode="numeric"
                                autoFocus
                                maxLength={4}
                                value={pin}
                                onChange={handlePinChange}
                                placeholder="••••"
                                style={{
                                    width: '100%', boxSizing: 'border-box', padding: '0.75rem 0.875rem',
                                    background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.1)',
                                    borderRadius: '0.75rem', color: '#f1f5f9', fontSize: '1.5rem', letterSpacing: '0.5em',
                                    textAlign: 'center', outline: 'none', transition: 'border-color 0.2s',
                                }}
                                onFocus={e => { e.target.style.borderColor = 'rgba(239,68,68,0.5)'; }}
                                onBlur={e => { e.target.style.borderColor = 'rgba(255,255,255,0.1)'; }}
                            />
                        </div>

                        <div style={{ display: 'flex', gap: '0.625rem' }}>
                            <button type="button" onClick={onClose} style={{
                                flex: 1, padding: '0.875rem', borderRadius: '0.875rem', border: '1px solid rgba(255,255,255,0.1)',
                                background: 'rgba(255,255,255,0.04)', color: '#94a3b8', fontWeight: 700, fontSize: '0.875rem', cursor: 'pointer',
                            }}>Keep Order</button>
                            <button type="submit" disabled={loading || pin.length !== 4} style={{
                                flex: 1, padding: '0.875rem', borderRadius: '0.875rem', border: 'none',
                                cursor: (loading || pin.length !== 4) ? 'not-allowed' : 'pointer',
                                background: (loading || pin.length !== 4) ? 'rgba(239,68,68,0.3)' : 'linear-gradient(135deg, #ef4444, #dc2626)',
                                color: '#fff', fontWeight: 700, fontSize: '0.875rem',
                                boxShadow: (loading || pin.length !== 4) ? 'none' : '0 4px 16px rgba(239,68,68,0.3)',
                                display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '0.5rem',
                            }}>
                                {loading ? 'Cancelling...' : 'Cancel Order'}
                            </button>
                        </div>
                    </form>
                </div>
            </div>
        </div>
    );
};

export default CancelOrderModal;
