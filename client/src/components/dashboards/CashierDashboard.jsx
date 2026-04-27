import React from 'react';
import { useNavigate } from 'react-router-dom';

const StatRow = ({ label, value, color }) => (
    <div style={{
        display: 'flex', justifyContent: 'space-between', alignItems: 'center',
        padding: '0.875rem 1rem',
        background: 'rgba(255,255,255,0.02)',
        border: '1px solid rgba(255,255,255,0.05)',
        borderRadius: '0.75rem',
        transition: 'all 0.2s ease',
    }}
        onMouseEnter={e => { e.currentTarget.style.background = 'rgba(255,255,255,0.04)'; }}
        onMouseLeave={e => { e.currentTarget.style.background = 'rgba(255,255,255,0.02)'; }}
    >
        <span style={{ fontSize: '0.825rem', color: '#64748b', fontWeight: 500 }}>{label}</span>
        <span style={{ fontSize: '1rem', fontWeight: 800, color: color || '#f1f5f9', fontFamily: 'var(--font-mono)', letterSpacing: '-0.01em' }}>{value}</span>
    </div>
);

const CashierDashboard = () => {
    const navigate = useNavigate();

    const quickActions = [
        { label: 'New Sale', sub: 'Start a new transaction', icon: '⚡', path: '/sales', primary: true, color: '#3b82f6' },
        { label: 'Order History', sub: 'View past transactions', icon: '📋', path: '/orders', color: '#a855f7' },
        { label: 'Invoice', sub: 'Generate invoices', icon: '🧾', path: '/invoice', color: '#22c55e' },
    ];

    const recentTransactions = [
        { time: '10:32 AM', customer: 'Walk-in Customer', amount: 2400, status: 'Paid', method: '💵' },
        { time: '10:15 AM', customer: 'Al Rashid Corp', amount: 8750, status: 'Paid', method: '📱' },
        { time: '09:48 AM', customer: 'Walk-in Customer', amount: 1200, status: 'Credit', method: '💳' },
    ];

    return (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }} className="animate-fade-in-up">

            {/* Quick Actions */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '1rem' }}>
                {quickActions.map((action) => (
                    <button
                        key={action.label}
                        onClick={() => navigate(action.path)}
                        style={{
                            display: 'flex', flexDirection: 'column', alignItems: 'flex-start',
                            padding: '1.5rem',
                            background: action.primary
                                ? 'linear-gradient(135deg, rgba(59,130,246,0.2), rgba(6,182,212,0.15))'
                                : 'rgba(255,255,255,0.03)',
                            border: action.primary
                                ? '1px solid rgba(59,130,246,0.3)'
                                : '1px solid rgba(255,255,255,0.07)',
                            borderRadius: '1.25rem',
                            cursor: 'pointer',
                            textAlign: 'left',
                            transition: 'all 0.25s ease',
                            position: 'relative',
                            overflow: 'hidden',
                            boxShadow: action.primary ? '0 4px 20px rgba(59,130,246,0.15)' : 'none',
                        }}
                        onMouseEnter={e => {
                            e.currentTarget.style.transform = 'translateY(-3px)';
                            e.currentTarget.style.boxShadow = action.primary
                                ? `0 8px 32px rgba(59,130,246,0.25)`
                                : `0 8px 24px ${action.color}20`;
                            e.currentTarget.style.borderColor = action.primary
                                ? 'rgba(59,130,246,0.5)'
                                : `${action.color}40`;
                        }}
                        onMouseLeave={e => {
                            e.currentTarget.style.transform = '';
                            e.currentTarget.style.boxShadow = action.primary ? '0 4px 20px rgba(59,130,246,0.15)' : 'none';
                            e.currentTarget.style.borderColor = action.primary ? 'rgba(59,130,246,0.3)' : 'rgba(255,255,255,0.07)';
                        }}
                    >
                        {/* Background icon */}
                        <div style={{
                            position: 'absolute', bottom: '-10px', right: '-10px',
                            fontSize: '5rem', opacity: 0.06, lineHeight: 1,
                            pointerEvents: 'none',
                        }}>
                            {action.icon}
                        </div>

                        <div style={{
                            width: '44px', height: '44px',
                            borderRadius: '12px',
                            background: action.primary ? 'rgba(255,255,255,0.15)' : `${action.color}18`,
                            border: action.primary ? '1px solid rgba(255,255,255,0.2)' : `1px solid ${action.color}30`,
                            display: 'flex', alignItems: 'center', justifyContent: 'center',
                            fontSize: '1.25rem',
                            marginBottom: '1rem',
                        }}>
                            {action.icon}
                        </div>
                        <div style={{ fontSize: '1.05rem', fontWeight: 700, color: action.primary ? '#f1f5f9' : '#e2e8f0', marginBottom: '4px' }}>
                            {action.label}
                        </div>
                        <div style={{ fontSize: '0.78rem', color: action.primary ? 'rgba(191,219,254,0.7)' : '#475569' }}>
                            {action.sub}
                        </div>
                    </button>
                ))}
            </div>

            {/* Stats + Transactions */}
            <div style={{ display: 'grid', gridTemplateColumns: '280px 1fr', gap: '1rem' }}>

                {/* My Performance */}
                <div style={{
                    background: 'linear-gradient(135deg, rgba(255,255,255,0.05), rgba(255,255,255,0.02))',
                    border: '1px solid rgba(255,255,255,0.08)',
                    borderRadius: '1.25rem',
                    padding: '1.5rem',
                    position: 'relative', overflow: 'hidden',
                }}>
                    <div style={{
                        position: 'absolute', top: 0, left: 0, right: 0, height: '1px',
                        background: 'linear-gradient(90deg, transparent, rgba(59,130,246,0.4), transparent)',
                    }} />
                    <div style={{ fontSize: '0.7rem', color: '#475569', fontWeight: 600, letterSpacing: '0.08em', textTransform: 'uppercase', marginBottom: '0.25rem' }}>Today</div>
                    <div style={{ fontSize: '1rem', fontWeight: 700, color: '#f1f5f9', marginBottom: '1.25rem' }}>My Performance</div>

                    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.625rem' }}>
                        <StatRow label="Sales Revenue" value="KSH 4,520" color="#4ade80" />
                        <StatRow label="Orders Processed" value="12" color="#60a5fa" />
                        <StatRow label="Average Order" value="KSH 376" />
                    </div>

                    {/* Shift progress */}
                    <div style={{ marginTop: '1.25rem' }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '0.375rem' }}>
                            <span style={{ fontSize: '0.72rem', color: '#475569', fontWeight: 500 }}>Shift progress</span>
                            <span style={{ fontSize: '0.72rem', color: '#94a3b8', fontWeight: 600 }}>6h / 8h</span>
                        </div>
                        <div style={{ height: '6px', borderRadius: '100px', background: 'rgba(255,255,255,0.06)', overflow: 'hidden' }}>
                            <div style={{ height: '100%', width: '75%', background: 'linear-gradient(90deg, #3b82f6, #06b6d4)', borderRadius: '100px', transition: 'width 1s ease' }} />
                        </div>
                    </div>
                </div>

                {/* Recent Transactions */}
                <div style={{
                    background: 'linear-gradient(135deg, rgba(255,255,255,0.05), rgba(255,255,255,0.02))',
                    border: '1px solid rgba(255,255,255,0.08)',
                    borderRadius: '1.25rem',
                    padding: '1.5rem',
                    overflow: 'hidden',
                }}>
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '1.25rem' }}>
                        <div>
                            <div style={{ fontSize: '0.7rem', color: '#475569', fontWeight: 600, letterSpacing: '0.08em', textTransform: 'uppercase' }}>Transactions</div>
                            <div style={{ fontSize: '1rem', fontWeight: 700, color: '#f1f5f9' }}>Recent Orders</div>
                        </div>
                        <button
                            onClick={() => navigate('/orders')}
                            style={{
                                fontSize: '0.78rem', fontWeight: 600, color: '#3b82f6',
                                background: 'rgba(59,130,246,0.1)', border: '1px solid rgba(59,130,246,0.2)',
                                borderRadius: '0.5rem', padding: '0.375rem 0.75rem', cursor: 'pointer',
                                transition: 'all 0.2s ease',
                            }}
                            onMouseEnter={e => { e.currentTarget.style.background = 'rgba(59,130,246,0.18)'; }}
                            onMouseLeave={e => { e.currentTarget.style.background = 'rgba(59,130,246,0.1)'; }}
                        >
                            View All →
                        </button>
                    </div>

                    <table style={{ width: '100%', borderCollapse: 'separate', borderSpacing: 0 }}>
                        <thead>
                            <tr>
                                {['Time', 'Customer', 'Amount', 'Method', 'Status'].map(h => (
                                    <th key={h} style={{ fontSize: '0.65rem', fontWeight: 700, color: '#334155', letterSpacing: '0.1em', textTransform: 'uppercase', padding: '0 0.875rem 0.75rem', textAlign: 'left', borderBottom: '1px solid rgba(255,255,255,0.06)' }}>
                                        {h}
                                    </th>
                                ))}
                            </tr>
                        </thead>
                        <tbody>
                            {recentTransactions.map((tx, i) => (
                                <tr key={i} style={{ transition: 'background 0.15s ease' }}
                                    onMouseEnter={e => { e.currentTarget.style.background = 'rgba(255,255,255,0.02)'; }}
                                    onMouseLeave={e => { e.currentTarget.style.background = ''; }}
                                >
                                    <td style={{ padding: '0.875rem', fontSize: '0.78rem', color: '#475569', fontFamily: 'var(--font-mono)' }}>{tx.time}</td>
                                    <td style={{ padding: '0.875rem', fontSize: '0.825rem', fontWeight: 600, color: '#cbd5e1' }}>{tx.customer}</td>
                                    <td style={{ padding: '0.875rem', fontSize: '0.875rem', fontWeight: 700, color: '#f1f5f9', fontFamily: 'var(--font-mono)' }}>KSH {tx.amount.toLocaleString()}</td>
                                    <td style={{ padding: '0.875rem', fontSize: '1rem' }}>{tx.method}</td>
                                    <td style={{ padding: '0.875rem' }}>
                                        <span style={{
                                            fontSize: '0.65rem', fontWeight: 700,
                                            padding: '0.2rem 0.5rem', borderRadius: '100px',
                                            letterSpacing: '0.06em', textTransform: 'uppercase',
                                            background: tx.status === 'Paid' ? 'rgba(34,197,94,0.12)' : 'rgba(245,158,11,0.12)',
                                            color: tx.status === 'Paid' ? '#4ade80' : '#fbbf24',
                                            border: `1px solid ${tx.status === 'Paid' ? 'rgba(34,197,94,0.25)' : 'rgba(245,158,11,0.25)'}`,
                                        }}>
                                            {tx.status}
                                        </span>
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            </div>
        </div>
    );
};

export default CashierDashboard;
