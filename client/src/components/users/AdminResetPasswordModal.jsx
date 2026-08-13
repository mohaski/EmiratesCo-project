import { useState } from 'react';
import api from '../../services/api';
import { extractErrorMessage, showToast } from '../../utils/toast';

const AdminResetPasswordModal = ({ isOpen, onClose, targetUser }) => {
    const [newPassword, setNewPassword] = useState('');
    const [confirmPassword, setConfirmPassword] = useState('');
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState('');

    if (!isOpen) return null;

    const close = () => {
        setNewPassword(''); setConfirmPassword(''); setError('');
        onClose();
    };

    const handleSubmit = async e => {
        e.preventDefault();
        setError('');
        if (newPassword !== confirmPassword) {
            setError('Passwords do not match');
            return;
        }
        if (newPassword.length < 6) {
            setError('Password must be at least 6 characters');
            return;
        }
        setLoading(true);
        try {
            await api.userService.adminResetPassword(targetUser.userId, newPassword);
            showToast(`Password reset for ${targetUser.firstName}. Share the new password with them — they'll be asked to change it on next login.`, 'success');
            close();
        } catch (err) {
            setError(extractErrorMessage(err));
        } finally {
            setLoading(false);
        }
    };

    const inputStyle = {
        width: '100%', boxSizing: 'border-box', padding: '0.625rem 0.875rem',
        background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.1)',
        borderRadius: '0.75rem', color: '#f1f5f9', fontSize: '0.875rem', outline: 'none',
        transition: 'border-color 0.2s',
    };
    const labelStyle = { fontSize: '0.62rem', fontWeight: 700, color: '#475569', letterSpacing: '0.08em', textTransform: 'uppercase', display: 'block', marginBottom: '0.375rem' };
    const onFocus = e => { e.target.style.borderColor = 'rgba(59,130,246,0.5)'; };
    const onBlur = e => { e.target.style.borderColor = 'rgba(255,255,255,0.1)'; };

    return (
        <div style={{
            position: 'fixed', inset: 0, zIndex: 50, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '1rem',
            background: 'rgba(9,14,26,0.85)', backdropFilter: 'blur(12px)',
        }} onClick={close}>
            <div onClick={e => e.stopPropagation()} style={{
                width: '100%', maxWidth: '420px',
                background: 'linear-gradient(145deg, rgba(13,20,38,0.99), rgba(9,14,26,0.99))',
                border: '1px solid rgba(255,255,255,0.1)', borderRadius: '1.5rem', overflow: 'hidden',
                boxShadow: '0 32px 80px rgba(0,0,0,0.7)', animation: 'fadeInScale 0.2s ease',
            }}>
                <div style={{ padding: '1.5rem 2rem', borderBottom: '1px solid rgba(255,255,255,0.07)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
                        <div style={{ width: '36px', height: '36px', borderRadius: '10px', background: 'rgba(245,158,11,0.15)', border: '1px solid rgba(245,158,11,0.3)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '1rem' }}>🔑</div>
                        <div>
                            <h2 style={{ fontSize: '1rem', fontWeight: 800, color: '#f1f5f9', margin: 0 }}>Reset Password</h2>
                            <p style={{ fontSize: '0.68rem', color: '#475569', margin: 0, letterSpacing: '0.06em', textTransform: 'uppercase' }}>{targetUser?.firstName} {targetUser?.secondName}</p>
                        </div>
                    </div>
                    <button onClick={close} style={{ width: '30px', height: '30px', borderRadius: '8px', border: '1px solid rgba(255,255,255,0.1)', background: 'rgba(255,255,255,0.05)', color: '#64748b', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>✕</button>
                </div>

                <div style={{ padding: '1.5rem 2rem' }}>
                    {error && (
                        <div style={{ marginBottom: '1rem', padding: '0.75rem 1rem', background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.2)', borderRadius: '0.75rem', color: '#f87171', fontSize: '0.82rem', fontWeight: 600 }}>
                            ⚠️ {error}
                        </div>
                    )}

                    <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '0.875rem' }}>
                        <div>
                            <label style={labelStyle}>New Password</label>
                            <input type="text" required value={newPassword} onChange={e => setNewPassword(e.target.value)} placeholder="Minimum 6 characters" style={inputStyle} onFocus={onFocus} onBlur={onBlur} />
                        </div>
                        <div>
                            <label style={labelStyle}>Confirm New Password</label>
                            <input type="text" required value={confirmPassword} onChange={e => setConfirmPassword(e.target.value)} style={inputStyle} onFocus={onFocus} onBlur={onBlur} />
                        </div>

                        <button type="submit" disabled={loading} style={{
                            marginTop: '0.5rem', padding: '0.875rem', borderRadius: '0.875rem', border: 'none', cursor: loading ? 'not-allowed' : 'pointer',
                            background: loading ? 'rgba(245,158,11,0.3)' : 'linear-gradient(135deg, #f59e0b, #ea580c)',
                            color: '#fff', fontWeight: 700, fontSize: '0.875rem',
                            boxShadow: loading ? 'none' : '0 4px 16px rgba(245,158,11,0.3)', transition: 'all 0.2s',
                        }}>
                            {loading ? 'Resetting...' : 'Reset Password'}
                        </button>
                    </form>
                </div>
            </div>
        </div>
    );
};

export default AdminResetPasswordModal;
