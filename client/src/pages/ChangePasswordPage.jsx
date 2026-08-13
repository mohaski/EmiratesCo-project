import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import api from '../services/api';
import { extractErrorMessage } from '../utils/toast';

const EyeIcon = ({ open }) => open ? (
    <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M9.88 9.88a3 3 0 1 0 4.24 4.24" /><path d="M10.73 5.08A10.43 10.43 0 0 1 12 5c7 0 10 7 10 7a13.16 13.16 0 0 1-1.67 2.68" /><path d="M6.61 6.61A13.526 13.526 0 0 0 2 12s3 7 10 7a9.74 9.74 0 0 0 5.39-1.61" /><line x1="2" x2="22" y1="2" y2="22" /></svg>
) : (
    <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M2 12s3-7 10-7 10 7 10 7-3 7-10 7-10-7-10-7Z" /><circle cx="12" cy="12" r="3" /></svg>
);

const labelStyle = { fontSize: '0.62rem', fontWeight: 700, color: '#475569', letterSpacing: '0.08em', textTransform: 'uppercase', display: 'block', marginBottom: '0.375rem' };
const inputStyle = {
    width: '100%', boxSizing: 'border-box', padding: '0.625rem 0.875rem', paddingRight: '2.5rem',
    background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.1)',
    borderRadius: '0.75rem', color: '#f1f5f9', fontSize: '0.875rem', outline: 'none',
    transition: 'border-color 0.2s',
};
const onFocus = e => { e.target.style.borderColor = 'rgba(59,130,246,0.5)'; };
const onBlur = e => { e.target.style.borderColor = 'rgba(255,255,255,0.1)'; };

export default function ChangePasswordPage() {
    const { user, refreshUser, logout } = useAuth();
    const navigate = useNavigate();
    const forced = !!user?.mustChangePassword;

    const [currentPassword, setCurrentPassword] = useState('');
    const [newPassword, setNewPassword] = useState('');
    const [confirmPassword, setConfirmPassword] = useState('');
    const [showCurrent, setShowCurrent] = useState(false);
    const [showNew, setShowNew] = useState(false);
    const [showConfirm, setShowConfirm] = useState(false);
    const [error, setError] = useState('');
    const [isLoading, setIsLoading] = useState(false);
    const [isSuccess, setIsSuccess] = useState(false);

    const handleSubmit = async (e) => {
        e.preventDefault();
        setError('');

        if (!forced && !currentPassword) {
            setError('Please enter your current password');
            return;
        }
        if (!newPassword || !confirmPassword) {
            setError('Please fill in all fields');
            return;
        }
        if (newPassword !== confirmPassword) {
            setError('Passwords do not match');
            return;
        }
        if (newPassword.length < 6) {
            setError('Password must be at least 6 characters');
            return;
        }

        setIsLoading(true);
        try {
            if (forced) {
                await api.userService.changePassword(user.userId, { newPassword, confirmNewPassword: confirmPassword });
            } else {
                await api.userService.resetPassword(user.userId, { currentPassword, newPassword, confirmNewPassword: confirmPassword });
            }
            setIsSuccess(true);
            await refreshUser();
            setTimeout(() => navigate('/', { replace: true }), 1000);
        } catch (err) {
            setError(extractErrorMessage(err));
        } finally {
            setIsLoading(false);
        }
    };

    return (
        <div style={{ minHeight: '100%', display: 'flex', flexDirection: 'column', background: 'var(--color-bg)' }}>
            <div style={{
                padding: '1.5rem 2rem',
                borderBottom: '1px solid rgba(255,255,255,0.07)',
                background: 'rgba(9,14,26,0.8)',
                backdropFilter: 'blur(20px)',
            }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', marginBottom: '0.25rem' }}>
                    <div style={{ width: '8px', height: '8px', borderRadius: '50%', background: '#3b82f6', boxShadow: '0 0 8px rgba(59,130,246,0.8)' }} />
                    <h1 style={{ fontSize: '1.375rem', fontWeight: 800, color: '#f1f5f9', margin: 0, letterSpacing: '-0.025em' }}>
                        {forced ? 'Set a New Password' : 'Change Password'}
                    </h1>
                </div>
                <p style={{ fontSize: '0.78rem', color: '#475569', margin: 0, marginLeft: '1.25rem', fontWeight: 500 }}>
                    {forced ? 'You must set a new password before continuing.' : 'Update the password for your account.'}
                </p>
            </div>

            <div style={{ flex: 1, display: 'flex', alignItems: 'flex-start', justifyContent: 'center', padding: '2.5rem 2rem' }}>
                <div style={{
                    width: '100%', maxWidth: '420px',
                    background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.08)',
                    borderRadius: '1rem', padding: '1.75rem',
                }}>
                    {isSuccess ? (
                        <div style={{ textAlign: 'center', padding: '1rem 0' }}>
                            <div style={{ width: '48px', height: '48px', borderRadius: '50%', background: 'rgba(34,197,94,0.12)', border: '1px solid rgba(34,197,94,0.3)', display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 1rem' }}>
                                <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#4ade80" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M5 13l4 4L19 7" /></svg>
                            </div>
                            <p style={{ fontSize: '0.9rem', fontWeight: 700, color: '#f1f5f9', margin: '0 0 0.25rem' }}>Password updated</p>
                            <p style={{ fontSize: '0.8rem', color: '#475569', margin: 0 }}>Redirecting...</p>
                        </div>
                    ) : (
                        <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
                            {error && (
                                <div style={{ padding: '0.75rem 1rem', background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.2)', borderRadius: '0.75rem', color: '#f87171', fontSize: '0.82rem', fontWeight: 600 }}>
                                    ⚠️ {error}
                                </div>
                            )}

                            {!forced && (
                                <div>
                                    <label style={labelStyle}>Current Password</label>
                                    <div style={{ position: 'relative' }}>
                                        <input
                                            type={showCurrent ? 'text' : 'password'}
                                            value={currentPassword}
                                            onChange={e => setCurrentPassword(e.target.value)}
                                            placeholder="••••••••"
                                            autoComplete="current-password"
                                            style={inputStyle}
                                            onFocus={onFocus}
                                            onBlur={onBlur}
                                        />
                                        <button type="button" onClick={() => setShowCurrent(!showCurrent)} style={{ position: 'absolute', right: '0.75rem', top: '50%', transform: 'translateY(-50%)', background: 'none', border: 'none', color: '#64748b', cursor: 'pointer', display: 'flex' }}>
                                            <EyeIcon open={showCurrent} />
                                        </button>
                                    </div>
                                </div>
                            )}

                            <div>
                                <label style={labelStyle}>New Password</label>
                                <div style={{ position: 'relative' }}>
                                    <input
                                        type={showNew ? 'text' : 'password'}
                                        value={newPassword}
                                        onChange={e => setNewPassword(e.target.value)}
                                        placeholder="Minimum 6 characters"
                                        autoComplete="new-password"
                                        style={inputStyle}
                                        onFocus={onFocus}
                                        onBlur={onBlur}
                                    />
                                    <button type="button" onClick={() => setShowNew(!showNew)} style={{ position: 'absolute', right: '0.75rem', top: '50%', transform: 'translateY(-50%)', background: 'none', border: 'none', color: '#64748b', cursor: 'pointer', display: 'flex' }}>
                                        <EyeIcon open={showNew} />
                                    </button>
                                </div>
                            </div>

                            <div>
                                <label style={labelStyle}>Confirm New Password</label>
                                <div style={{ position: 'relative' }}>
                                    <input
                                        type={showConfirm ? 'text' : 'password'}
                                        value={confirmPassword}
                                        onChange={e => setConfirmPassword(e.target.value)}
                                        placeholder="••••••••"
                                        autoComplete="new-password"
                                        style={inputStyle}
                                        onFocus={onFocus}
                                        onBlur={onBlur}
                                    />
                                    <button type="button" onClick={() => setShowConfirm(!showConfirm)} style={{ position: 'absolute', right: '0.75rem', top: '50%', transform: 'translateY(-50%)', background: 'none', border: 'none', color: '#64748b', cursor: 'pointer', display: 'flex' }}>
                                        <EyeIcon open={showConfirm} />
                                    </button>
                                </div>
                            </div>

                            <button
                                type="submit"
                                disabled={isLoading}
                                style={{
                                    marginTop: '0.25rem', padding: '0.875rem', borderRadius: '0.875rem', border: 'none', cursor: isLoading ? 'not-allowed' : 'pointer',
                                    background: isLoading ? 'rgba(59,130,246,0.3)' : 'linear-gradient(135deg, #3b82f6, #06b6d4)',
                                    color: '#fff', fontWeight: 700, fontSize: '0.875rem',
                                    boxShadow: isLoading ? 'none' : '0 4px 16px rgba(59,130,246,0.3)', transition: 'all 0.2s',
                                }}
                            >
                                {isLoading ? 'Saving...' : 'Save New Password'}
                            </button>

                            <div style={{ display: 'flex', justifyContent: 'center' }}>
                                {forced ? (
                                    <button type="button" onClick={logout} style={{ background: 'none', border: 'none', color: '#475569', fontSize: '0.78rem', fontWeight: 600, cursor: 'pointer' }}>
                                        Sign out instead
                                    </button>
                                ) : (
                                    <button type="button" onClick={() => navigate(-1)} style={{ background: 'none', border: 'none', color: '#475569', fontSize: '0.78rem', fontWeight: 600, cursor: 'pointer' }}>
                                        Cancel
                                    </button>
                                )}
                            </div>
                        </form>
                    )}
                </div>
            </div>
        </div>
    );
}
