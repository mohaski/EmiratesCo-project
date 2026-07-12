import { useState } from 'react';
import api from '../../services/api';

const SetCancelPinModal = ({ onClose }) => {
    const [pin, setPin] = useState('');
    const [confirmPin, setConfirmPin] = useState('');
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState('');
    const [success, setSuccess] = useState('');

    const digitsOnly = v => v.replace(/\D/g, '').slice(0, 4);

    const handleSubmit = async e => {
        e.preventDefault();
        setError(''); setSuccess('');
        if (pin.length !== 4) {
            setError('PIN must be exactly 4 digits.');
            return;
        }
        if (pin !== confirmPin) {
            setError('PINs do not match.');
            return;
        }
        setLoading(true);
        try {
            await api.settingsService.setCancelPin(pin);
            setSuccess('Cancel PIN updated.');
            setTimeout(() => { onClose(); }, 1500);
        } catch (err) {
            setError(err.response?.data?.detail || 'Failed to update PIN. Please try again.');
        } finally {
            setLoading(false);
        }
    };

    const inputStyle = {
        width: '100%', boxSizing: 'border-box', padding: '0.75rem 0.875rem',
        background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.1)',
        borderRadius: '0.75rem', color: '#f1f5f9', fontSize: '1.25rem', letterSpacing: '0.4em',
        textAlign: 'center', outline: 'none', transition: 'border-color 0.2s',
    };
    const labelStyle = { fontSize: '0.62rem', fontWeight: 700, color: '#475569', letterSpacing: '0.08em', textTransform: 'uppercase', display: 'block', marginBottom: '0.375rem' };
    const onFocus = e => { e.target.style.borderColor = 'rgba(59,130,246,0.5)'; };
    const onBlur = e => { e.target.style.borderColor = 'rgba(255,255,255,0.1)'; };

    return (
        <div style={{
            position: 'fixed', inset: 0, zIndex: 60, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '1rem',
            background: 'rgba(9,14,26,0.85)', backdropFilter: 'blur(12px)',
        }} onClick={onClose}>
            <div onClick={e => e.stopPropagation()} style={{
                width: '100%', maxWidth: '400px',
                background: 'linear-gradient(145deg, rgba(13,20,38,0.99), rgba(9,14,26,0.99))',
                border: '1px solid rgba(255,255,255,0.1)', borderRadius: '1.5rem', overflow: 'hidden',
                boxShadow: '0 32px 80px rgba(0,0,0,0.7)', animation: 'fadeInScale 0.2s ease',
            }}>
                {/* Header */}
                <div style={{ padding: '1.5rem 2rem', borderBottom: '1px solid rgba(255,255,255,0.07)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
                        <div style={{ width: '36px', height: '36px', borderRadius: '10px', background: 'rgba(59,130,246,0.15)', border: '1px solid rgba(59,130,246,0.3)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '1rem' }}>🔐</div>
                        <div>
                            <h2 style={{ fontSize: '1rem', fontWeight: 800, color: '#f1f5f9', margin: 0 }}>Set Cancel PIN</h2>
                            <p style={{ fontSize: '0.68rem', color: '#475569', margin: 0, letterSpacing: '0.06em', textTransform: 'uppercase' }}>Required to cancel any order</p>
                        </div>
                    </div>
                    <button onClick={onClose} style={{ width: '30px', height: '30px', borderRadius: '8px', border: '1px solid rgba(255,255,255,0.1)', background: 'rgba(255,255,255,0.05)', color: '#64748b', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>✕</button>
                </div>

                {/* Body */}
                <div style={{ padding: '1.5rem 2rem' }}>
                    {error && (
                        <div style={{ marginBottom: '1rem', padding: '0.75rem 1rem', background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.2)', borderRadius: '0.75rem', color: '#f87171', fontSize: '0.82rem', fontWeight: 600 }}>
                            ⚠️ {error}
                        </div>
                    )}
                    {success && (
                        <div style={{ marginBottom: '1rem', padding: '0.75rem 1rem', background: 'rgba(34,197,94,0.1)', border: '1px solid rgba(34,197,94,0.2)', borderRadius: '0.75rem', color: '#4ade80', fontSize: '0.82rem', fontWeight: 600 }}>
                            ✓ {success}
                        </div>
                    )}

                    <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
                        <div>
                            <label style={labelStyle}>New PIN</label>
                            <input
                                type="password" inputMode="numeric" maxLength={4} placeholder="••••"
                                value={pin} onChange={e => setPin(digitsOnly(e.target.value))}
                                style={inputStyle} onFocus={onFocus} onBlur={onBlur} autoFocus
                            />
                        </div>
                        <div>
                            <label style={labelStyle}>Confirm PIN</label>
                            <input
                                type="password" inputMode="numeric" maxLength={4} placeholder="••••"
                                value={confirmPin} onChange={e => setConfirmPin(digitsOnly(e.target.value))}
                                style={inputStyle} onFocus={onFocus} onBlur={onBlur}
                            />
                        </div>

                        <button type="submit" disabled={loading} style={{
                            marginTop: '0.5rem', padding: '0.875rem', borderRadius: '0.875rem', border: 'none', cursor: loading ? 'not-allowed' : 'pointer',
                            background: loading ? 'rgba(59,130,246,0.3)' : 'linear-gradient(135deg, #3b82f6, #06b6d4)',
                            color: '#fff', fontWeight: 700, fontSize: '0.875rem',
                            boxShadow: loading ? 'none' : '0 4px 16px rgba(59,130,246,0.3)', transition: 'all 0.2s',
                        }}>
                            {loading ? 'Saving...' : 'Save PIN'}
                        </button>
                    </form>
                </div>
            </div>
        </div>
    );
};

export default SetCancelPinModal;
