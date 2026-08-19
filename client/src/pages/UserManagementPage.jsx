import { useState, useEffect, useCallback, useMemo, useDeferredValue } from 'react';
import api from '../services/api';
import { useAuth } from '../context/AuthContext';
import { extractErrorMessage, showToast } from '../utils/toast';
import UserRegistrationModal from '../components/users/UserRegistrationModal';
import AdminResetPasswordModal from '../components/users/AdminResetPasswordModal';

const ROLE_OPTIONS = ['cashier', 'manager'];
const ROLE_LABELS = { cashier: 'Cashier', manager: 'Manager', admin: 'Admin', ceo: 'CEO' };
// Only staff (manager/cashier) accounts are manageable here — executives (ceo/admin)
// are excluded from the list entirely, so a CEO never sees peers or themselves.
const MANAGEABLE_ROLES = new Set(['manager', 'cashier']);

export default function UserManagementPage() {
    const { user: currentUser } = useAuth();
    const [users, setUsers] = useState([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(null);
    const [searchQuery, setSearchQuery] = useState('');
    const deferredQuery = useDeferredValue(searchQuery);
    const [showRegModal, setShowRegModal] = useState(false);
    const [resetTarget, setResetTarget] = useState(null);
    const [busyUserId, setBusyUserId] = useState(null);
    const [pendingRoles, setPendingRoles] = useState({});

    const fetchUsers = useCallback(async () => {
        try {
            const data = await api.userService.getAllUsers();
            setUsers(data.filter(u => MANAGEABLE_ROLES.has(u.role)));
            setError(null);
        } catch (err) {
            console.error('Failed to fetch users', err);
            setError('Failed to load users.');
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => { fetchUsers(); }, [fetchUsers]);

    const rows = useMemo(() => {
        const lq = deferredQuery.toLowerCase();
        if (!lq) return users;
        return users.filter(u =>
            `${u.firstName} ${u.secondName || ''}`.toLowerCase().includes(lq)
            || u.username.toLowerCase().includes(lq)
            || u.email.toLowerCase().includes(lq)
        );
    }, [users, deferredQuery]);

    const handleRoleSelect = useCallback((targetUser, role) => {
        setPendingRoles(prev => ({ ...prev, [targetUser.userId]: role }));
    }, []);

    const handleConfirmRoleChange = useCallback(async (targetUser) => {
        const role = pendingRoles[targetUser.userId];
        if (!role || role === targetUser.role) return;
        setBusyUserId(targetUser.userId);
        try {
            await api.userService.updateRole(targetUser.userId, role);
            setUsers(prev => prev.map(u => u.userId === targetUser.userId ? { ...u, role } : u));
            showToast(`${targetUser.firstName}'s role updated to ${ROLE_LABELS[role]}.`, 'success');
        } catch (err) {
            showToast(extractErrorMessage(err), 'error');
        } finally {
            setPendingRoles(prev => {
                const next = { ...prev };
                delete next[targetUser.userId];
                return next;
            });
            setBusyUserId(null);
        }
    }, [pendingRoles]);

    const handleToggleStatus = useCallback(async (targetUser) => {
        const nextActive = !targetUser.isActive;
        if (nextActive === false && !window.confirm(`Deactivate ${targetUser.firstName} ${targetUser.secondName || ''}? They will no longer be able to log in.`)) {
            return;
        }
        setBusyUserId(targetUser.userId);
        try {
            await api.userService.updateStatus(targetUser.userId, nextActive);
            setUsers(prev => prev.map(u => u.userId === targetUser.userId ? { ...u, isActive: nextActive } : u));
            showToast(nextActive ? `${targetUser.firstName} reactivated.` : `${targetUser.firstName} deactivated.`, 'success');
        } catch (err) {
            showToast(extractErrorMessage(err), 'error');
        } finally {
            setBusyUserId(null);
        }
    }, []);

    const selectStyle = {
        background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.1)',
        borderRadius: '0.5rem', color: '#e2e8f0', fontSize: '0.78rem', padding: '0.4rem 0.6rem',
        outline: 'none', cursor: 'pointer',
    };
    const actionBtnStyle = {
        border: '1px solid rgba(255,255,255,0.1)', background: 'rgba(255,255,255,0.05)',
        color: '#94a3b8', borderRadius: '0.5rem', padding: '0.4rem 0.7rem',
        fontSize: '0.75rem', fontWeight: 600, cursor: 'pointer', whiteSpace: 'nowrap',
    };

    return (
        <div style={{ display: 'flex', flexDirection: 'column', height: '100%', background: 'var(--color-bg)' }}>
            {error && (
                <div style={{ background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.3)', color: '#fca5a5', padding: '0.75rem 2rem', fontSize: '0.8rem', fontWeight: 600 }}>
                    {error}
                </div>
            )}

            <div style={{
                padding: 'clamp(1rem, 4vw, 1.5rem) clamp(1rem, 5vw, 2rem)',
                borderBottom: '1px solid rgba(255,255,255,0.07)',
                background: 'rgba(9,14,26,0.8)',
                backdropFilter: 'blur(20px)',
                position: 'sticky', top: 0, zIndex: 20,
                display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '1rem', flexWrap: 'wrap',
            }}>
                <div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', marginBottom: '0.25rem' }}>
                        <div style={{ width: '8px', height: '8px', borderRadius: '50%', background: '#a855f7', boxShadow: '0 0 8px rgba(168,85,247,0.8)' }} />
                        <h1 style={{ fontSize: '1.375rem', fontWeight: 800, color: '#f1f5f9', margin: 0, letterSpacing: '-0.025em' }}>User Management</h1>
                    </div>
                    <p style={{ fontSize: '0.78rem', color: '#475569', margin: 0, marginLeft: '1.25rem', fontWeight: 500 }}>
                        {users.length} account{users.length === 1 ? '' : 's'}
                    </p>
                </div>

                <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', flexWrap: 'wrap' }}>
                    <div style={{ position: 'relative', minWidth: '260px' }}>
                        <span style={{ position: 'absolute', left: '0.875rem', top: '50%', transform: 'translateY(-50%)', color: '#475569', fontSize: '0.875rem' }}>🔍</span>
                        <input
                            type="text"
                            placeholder="Search by name, username, or email..."
                            style={{
                                width: '100%', background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.1)',
                                borderRadius: '0.75rem', padding: '0.625rem 1rem 0.625rem 2.25rem',
                                color: '#e2e8f0', fontSize: '0.82rem', outline: 'none', transition: 'border-color 0.2s', boxSizing: 'border-box',
                            }}
                            value={searchQuery}
                            onChange={e => setSearchQuery(e.target.value)}
                            onFocus={e => { e.target.style.borderColor = 'rgba(168,85,247,0.5)'; }}
                            onBlur={e => { e.target.style.borderColor = 'rgba(255,255,255,0.1)'; }}
                        />
                    </div>
                    <button
                        onClick={() => setShowRegModal(true)}
                        style={{
                            padding: '0.625rem 1.1rem', borderRadius: '0.75rem', border: 'none', cursor: 'pointer',
                            background: 'linear-gradient(135deg, #3b82f6, #06b6d4)', color: '#fff', fontWeight: 700, fontSize: '0.82rem',
                            boxShadow: '0 4px 16px rgba(59,130,246,0.3)', whiteSpace: 'nowrap',
                        }}
                    >
                        + Register User
                    </button>
                </div>
            </div>

            <div style={{ flex: 1, overflowY: 'auto', padding: 'clamp(1rem, 4vw, 1.5rem) clamp(1rem, 5vw, 2rem)' }} className="custom-scrollbar">
                {loading ? (
                    <div style={{ textAlign: 'center', padding: '2rem', color: '#475569', fontSize: '0.875rem' }}>Loading...</div>
                ) : rows.length === 0 ? (
                    <div style={{ textAlign: 'center', padding: '4rem 0', color: '#334155' }}>
                        <div style={{ fontSize: '3rem', marginBottom: '0.75rem', opacity: 0.4 }}>👥</div>
                        <p style={{ fontWeight: 500, fontSize: '0.875rem' }}>
                            {users.length === 0 ? 'No users yet.' : `No accounts found for "${searchQuery}"`}
                        </p>
                    </div>
                ) : (
                    <div style={{
                        background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.08)',
                        borderRadius: '1rem', overflow: 'hidden',
                    }}>
                        <div className="table-scroll">
                        <table style={{ width: '100%', minWidth: '640px', borderCollapse: 'collapse' }}>
                            <thead>
                                <tr style={{ borderBottom: '1px solid rgba(255,255,255,0.08)' }}>
                                    {['Name', 'Username', 'Email', 'Role', 'Status', 'Actions'].map(h => (
                                        <th key={h} style={{ padding: '0.75rem 1rem', textAlign: 'left', fontSize: '0.65rem', fontWeight: 700, color: '#475569', letterSpacing: '0.08em', textTransform: 'uppercase', whiteSpace: 'nowrap' }}>{h}</th>
                                    ))}
                                </tr>
                            </thead>
                            <tbody>
                                {rows.map(row => {
                                    const isSelf = row.userId === currentUser?.userId;
                                    const busy = busyUserId === row.userId;
                                    return (
                                        <tr key={row.userId} style={{ borderBottom: '1px solid rgba(255,255,255,0.05)' }}>
                                            <td style={{ padding: '0.875rem 1rem', fontSize: '0.85rem', fontWeight: 700, color: '#e2e8f0' }}>
                                                {row.firstName} {row.secondName}
                                                {isSelf && <span style={{ marginLeft: '0.5rem', fontSize: '0.65rem', fontWeight: 700, color: '#3b82f6' }}>(you)</span>}
                                                {row.mustChangePassword && (
                                                    <div style={{ fontSize: '0.65rem', fontWeight: 700, color: '#f59e0b', marginTop: '0.15rem' }}>Pending password change</div>
                                                )}
                                            </td>
                                            <td style={{ padding: '0.875rem 1rem', fontSize: '0.8rem', color: '#94a3b8', fontFamily: 'var(--font-mono)' }}>{row.username}</td>
                                            <td style={{ padding: '0.875rem 1rem', fontSize: '0.8rem', color: '#94a3b8' }}>{row.email}</td>
                                            <td style={{ padding: '0.875rem 1rem' }}>
                                                <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                                                    <select
                                                        value={pendingRoles[row.userId] ?? row.role}
                                                        disabled={busy}
                                                        onChange={e => handleRoleSelect(row, e.target.value)}
                                                        style={selectStyle}
                                                    >
                                                        {ROLE_OPTIONS.map(r => <option key={r} value={r}>{ROLE_LABELS[r]}</option>)}
                                                    </select>
                                                    {pendingRoles[row.userId] && pendingRoles[row.userId] !== row.role && (
                                                        <button
                                                            disabled={busy}
                                                            onClick={() => handleConfirmRoleChange(row)}
                                                            style={{
                                                                border: 'none', borderRadius: '0.5rem', padding: '0.4rem 0.7rem',
                                                                fontSize: '0.72rem', fontWeight: 700, cursor: busy ? 'not-allowed' : 'pointer',
                                                                background: 'linear-gradient(135deg, #3b82f6, #06b6d4)', color: '#fff', whiteSpace: 'nowrap',
                                                            }}
                                                        >
                                                            Confirm
                                                        </button>
                                                    )}
                                                </div>
                                            </td>
                                            <td style={{ padding: '0.875rem 1rem' }}>
                                                <span style={{
                                                    fontSize: '0.7rem', fontWeight: 700,
                                                    color: row.isActive ? '#4ade80' : '#f87171',
                                                    background: row.isActive ? 'rgba(34,197,94,0.1)' : 'rgba(239,68,68,0.1)',
                                                    border: `1px solid ${row.isActive ? 'rgba(34,197,94,0.25)' : 'rgba(239,68,68,0.25)'}`,
                                                    borderRadius: '6px', padding: '2px 8px',
                                                }}>{row.isActive ? 'Active' : 'Inactive'}</span>
                                            </td>
                                            <td style={{ padding: '0.875rem 1rem' }}>
                                                <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
                                                    <button style={actionBtnStyle} disabled={busy} onClick={() => setResetTarget(row)}>Reset Password</button>
                                                    <button
                                                        style={{ ...actionBtnStyle, opacity: isSelf ? 0.4 : 1, cursor: isSelf ? 'not-allowed' : 'pointer' }}
                                                        disabled={busy || isSelf}
                                                        onClick={() => handleToggleStatus(row)}
                                                    >
                                                        {row.isActive ? 'Deactivate' : 'Activate'}
                                                    </button>
                                                </div>
                                            </td>
                                        </tr>
                                    );
                                })}
                            </tbody>
                        </table>
                        </div>
                    </div>
                )}
            </div>

            <UserRegistrationModal isOpen={showRegModal} onClose={() => setShowRegModal(false)} onSuccess={fetchUsers} />
            <AdminResetPasswordModal isOpen={!!resetTarget} targetUser={resetTarget} onClose={() => setResetTarget(null)} />
        </div>
    );
}
