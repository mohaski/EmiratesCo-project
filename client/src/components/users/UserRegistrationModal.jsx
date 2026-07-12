import { useState } from 'react';
import api from '../../services/api';

const UserRegistrationModal = ({ isOpen, onClose, onSuccess }) => {
    const [formData, setFormData] = useState({
        firstName: '', secondName: '', username: '', role: 'cashier', email: '', phoneNumber: ''
    });
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState('');
    const [success, setSuccess] = useState('');

    if (!isOpen) return null;

    const handleChange = e => setFormData({ ...formData, [e.target.name]: e.target.value });

    const handleSubmit = async e => {
        e.preventDefault();
        setLoading(true); setError(''); setSuccess('');
        try {
            await api.userService.register({ ...formData, password: '1234', firstLogin: false });
            setSuccess('User registered! Default password is "1234".');
            if (onSuccess) onSuccess();
            setFormData({ firstName: '', secondName: '', username: '', role: 'cashier', email: '', phoneNumber: '' });
            setTimeout(() => { onClose(); setSuccess(''); }, 2000);
        } catch (err) {
            setError(err.response?.data?.detail || 'Registration failed. Please try again.');
        } finally { setLoading(false); }
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
        }} onClick={onClose}>
            <div onClick={e => e.stopPropagation()} style={{
                width: '100%', maxWidth: '480px',
                background: 'linear-gradient(145deg, rgba(13,20,38,0.99), rgba(9,14,26,0.99))',
                border: '1px solid rgba(255,255,255,0.1)', borderRadius: '1.5rem', overflow: 'hidden',
                boxShadow: '0 32px 80px rgba(0,0,0,0.7)', animation: 'fadeInScale 0.2s ease',
            }}>
                {/* Header */}
                <div style={{ padding: '1.5rem 2rem', borderBottom: '1px solid rgba(255,255,255,0.07)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
                        <div style={{ width: '36px', height: '36px', borderRadius: '10px', background: 'rgba(59,130,246,0.15)', border: '1px solid rgba(59,130,246,0.3)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '1rem' }}>👤</div>
                        <div>
                            <h2 style={{ fontSize: '1rem', fontWeight: 800, color: '#f1f5f9', margin: 0 }}>Register New User</h2>
                            <p style={{ fontSize: '0.68rem', color: '#475569', margin: 0, letterSpacing: '0.06em', textTransform: 'uppercase' }}>Access Management</p>
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

                    <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '0.875rem' }}>
                        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.75rem' }}>
                            <div>
                                <label style={labelStyle}>First Name</label>
                                <input type="text" name="firstName" required value={formData.firstName} onChange={handleChange} placeholder="John" style={inputStyle} onFocus={onFocus} onBlur={onBlur} />
                            </div>
                            <div>
                                <label style={labelStyle}>Last Name</label>
                                <input type="text" name="secondName" required value={formData.secondName} onChange={handleChange} placeholder="Doe" style={inputStyle} onFocus={onFocus} onBlur={onBlur} />
                            </div>
                        </div>

                        <div>
                            <label style={labelStyle}>Username</label>
                            <input type="text" name="username" required value={formData.username} onChange={handleChange} placeholder="johndoe123" style={inputStyle} onFocus={onFocus} onBlur={onBlur} />
                        </div>

                        <div>
                            <label style={labelStyle}>Email Address</label>
                            <input type="email" name="email" required value={formData.email} onChange={handleChange} placeholder="john.doe@example.com" style={inputStyle} onFocus={onFocus} onBlur={onBlur} />
                        </div>

                        <div>
                            <label style={labelStyle}>Phone Number</label>
                            <input type="tel" name="phoneNumber" required value={formData.phoneNumber} onChange={handleChange} placeholder="+1 555 000 0000" style={inputStyle} onFocus={onFocus} onBlur={onBlur} />
                        </div>

                        <div>
                            <label style={labelStyle}>Assign Role</label>
                            <select name="role" value={formData.role} onChange={handleChange}
                                style={{ ...inputStyle, cursor: 'pointer', appearance: 'none', backgroundImage: `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 24 24' fill='none' stroke='%2364748b' stroke-width='2'%3E%3Cpath d='M19 9l-7 7-7-7'/%3E%3C/svg%3E")`, backgroundRepeat: 'no-repeat', backgroundPosition: 'right 0.875rem center' }}>
                                <option value="cashier">Cashier</option>
                                <option value="manager">Manager</option>
                                <option value="admin">Admin</option>
                                <option value="ceo">CEO</option>
                            </select>
                        </div>

                        <button type="submit" disabled={loading} style={{
                            marginTop: '0.5rem', padding: '0.875rem', borderRadius: '0.875rem', border: 'none', cursor: loading ? 'not-allowed' : 'pointer',
                            background: loading ? 'rgba(59,130,246,0.3)' : 'linear-gradient(135deg, #3b82f6, #06b6d4)',
                            color: '#fff', fontWeight: 700, fontSize: '0.875rem',
                            boxShadow: loading ? 'none' : '0 4px 16px rgba(59,130,246,0.3)', transition: 'all 0.2s',
                            display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '0.5rem',
                        }}>
                            {loading ? (
                                <><span style={{ display: 'inline-block', width: '16px', height: '16px', border: '2px solid rgba(255,255,255,0.3)', borderTop: '2px solid #fff', borderRadius: '50%', animation: 'spin 0.8s linear infinite' }} /><span>Registering...</span></>
                            ) : (
                                <><span>👤</span><span>Register User</span></>
                            )}
                        </button>
                    </form>
                </div>
            </div>
        </div>
    );
};

export default UserRegistrationModal;
