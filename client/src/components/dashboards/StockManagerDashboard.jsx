import React from 'react';
import { useNavigate } from 'react-router-dom';

const StatCard = ({ icon, label, value, color, sub }) => (
    <div style={{
        background: 'linear-gradient(135deg, rgba(255,255,255,0.05), rgba(255,255,255,0.02))',
        border: '1px solid rgba(255,255,255,0.08)',
        borderRadius: '1.25rem',
        padding: '1.25rem',
        display: 'flex', alignItems: 'center', gap: '1rem',
        transition: 'all 0.25s ease',
        position: 'relative', overflow: 'hidden',
    }}
        onMouseEnter={e => { e.currentTarget.style.background = 'linear-gradient(135deg, rgba(255,255,255,0.07), rgba(255,255,255,0.03))'; e.currentTarget.style.transform = 'translateY(-2px)'; }}
        onMouseLeave={e => { e.currentTarget.style.background = 'linear-gradient(135deg, rgba(255,255,255,0.05), rgba(255,255,255,0.02))'; e.currentTarget.style.transform = ''; }}
    >
        <div style={{
            position: 'absolute', top: 0, left: 0, right: 0, height: '1px',
            background: `linear-gradient(90deg, transparent, ${color}60, transparent)`,
        }} />
        <div style={{
            width: '48px', height: '48px', flexShrink: 0,
            borderRadius: '12px',
            background: `${color}15`, border: `1px solid ${color}25`,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            fontSize: '1.25rem',
        }}>
            {icon}
        </div>
        <div>
            <div style={{ fontSize: '0.7rem', color: '#475569', fontWeight: 600, letterSpacing: '0.08em', textTransform: 'uppercase' }}>{label}</div>
            <div style={{ fontSize: '1.5rem', fontWeight: 800, color: '#f1f5f9', letterSpacing: '-0.025em', lineHeight: 1.2 }}>{value}</div>
            {sub && <div style={{ fontSize: '0.72rem', color: '#334155', marginTop: '2px' }}>{sub}</div>}
        </div>
    </div>
);

const StockManagerDashboard = () => {
    const navigate = useNavigate();

    const lowStockItems = [
        { id: 'GLS-001', name: 'Clear Glass 6mm',        qty: 4,  reorder: 10, category: 'Glass' },
        { id: 'GLS-002', name: 'Tinted Glass 8mm',       qty: 2,  reorder: 8,  category: 'Glass' },
        { id: 'PRF-001', name: 'Aluminium Profile 40mm', qty: 7,  reorder: 15, category: 'Profile' },
        { id: 'PRF-002', name: 'Door Frame Profile',     qty: 3,  reorder: 10, category: 'Profile' },
    ];

    return (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }} className="animate-fade-in-up">

            {/* Top Stats */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '1rem' }}>
                <StatCard icon="📦" label="Total Products" value="4,230" color="#3b82f6" sub="Across all categories" />
                <StatCard icon="⚠️" label="Low Stock Alerts" value="12" color="#f59e0b" sub="Items below reorder level" />
                <StatCard icon="💰" label="Total Inventory Value" value="KSH 1.24M" color="#22c55e" sub="Current stock value" />
            </div>

            {/* Main Content */}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 280px', gap: '1rem' }}>

                {/* Low Stock Alerts */}
                <div style={{
                    background: 'linear-gradient(135deg, rgba(255,255,255,0.05), rgba(255,255,255,0.02))',
                    border: '1px solid rgba(255,255,255,0.08)',
                    borderRadius: '1.25rem',
                    overflow: 'hidden',
                }}>
                    <div style={{
                        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                        padding: '1.25rem 1.5rem',
                        borderBottom: '1px solid rgba(255,255,255,0.06)',
                    }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '0.625rem' }}>
                            <div style={{
                                width: '8px', height: '8px', borderRadius: '50%',
                                background: '#ef4444',
                                animation: 'pulse 1.5s ease-in-out infinite',
                                boxShadow: '0 0 6px rgba(239,68,68,0.7)',
                            }} />
                            <div>
                                <div style={{ fontSize: '0.7rem', color: '#475569', fontWeight: 600, letterSpacing: '0.08em', textTransform: 'uppercase' }}>Alerts</div>
                                <div style={{ fontSize: '1rem', fontWeight: 700, color: '#f1f5f9' }}>Low Stock Items</div>
                            </div>
                        </div>
                        <button
                            onClick={() => navigate('/inventory')}
                            style={{
                                fontSize: '0.78rem', fontWeight: 600, color: '#3b82f6',
                                background: 'rgba(59,130,246,0.1)', border: '1px solid rgba(59,130,246,0.2)',
                                borderRadius: '0.5rem', padding: '0.375rem 0.75rem', cursor: 'pointer',
                            }}
                        >
                            View All →
                        </button>
                    </div>

                    <div>
                        {lowStockItems.map((item, i) => {
                            const urgency = item.qty <= 3 ? 'critical' : 'warning';
                            return (
                                <div
                                    key={item.id}
                                    style={{
                                        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                                        padding: '1rem 1.5rem',
                                        borderBottom: i < lowStockItems.length - 1 ? '1px solid rgba(255,255,255,0.04)' : 'none',
                                        transition: 'background 0.15s ease',
                                    }}
                                    onMouseEnter={e => { e.currentTarget.style.background = 'rgba(255,255,255,0.02)'; }}
                                    onMouseLeave={e => { e.currentTarget.style.background = ''; }}
                                >
                                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.875rem' }}>
                                        <div style={{
                                            width: '40px', height: '40px', borderRadius: '10px',
                                            background: urgency === 'critical' ? 'rgba(239,68,68,0.1)' : 'rgba(245,158,11,0.1)',
                                            border: `1px solid ${urgency === 'critical' ? 'rgba(239,68,68,0.2)' : 'rgba(245,158,11,0.2)'}`,
                                            display: 'flex', alignItems: 'center', justifyContent: 'center',
                                            fontSize: '1.1rem',
                                        }}>
                                            {item.category === 'Glass' ? '🪟' : '🔩'}
                                        </div>
                                        <div>
                                            <div style={{ fontSize: '0.875rem', fontWeight: 700, color: '#e2e8f0' }}>{item.name}</div>
                                            <div style={{ fontSize: '0.72rem', color: '#334155', marginTop: '2px', fontFamily: 'var(--font-mono)' }}>ID: {item.id}</div>
                                        </div>
                                    </div>
                                    <div style={{ textAlign: 'right' }}>
                                        <div style={{
                                            fontSize: '0.72rem', fontWeight: 700,
                                            padding: '0.2rem 0.625rem',
                                            background: urgency === 'critical' ? 'rgba(239,68,68,0.12)' : 'rgba(245,158,11,0.12)',
                                            border: `1px solid ${urgency === 'critical' ? 'rgba(239,68,68,0.25)' : 'rgba(245,158,11,0.25)'}`,
                                            borderRadius: '100px',
                                            color: urgency === 'critical' ? '#f87171' : '#fbbf24',
                                            letterSpacing: '0.04em',
                                        }}>
                                            {item.qty} remaining
                                        </div>
                                        <div style={{ fontSize: '0.68rem', color: '#334155', marginTop: '4px' }}>
                                            Reorder at: {item.reorder}
                                        </div>
                                    </div>
                                </div>
                            );
                        })}
                    </div>
                </div>

                {/* Actions panel */}
                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.875rem' }}>
                    <div style={{
                        background: 'linear-gradient(135deg, rgba(59,130,246,0.15), rgba(6,182,212,0.1))',
                        border: '1px solid rgba(59,130,246,0.25)',
                        borderRadius: '1.25rem',
                        padding: '1.5rem',
                    }}>
                        <div style={{ fontSize: '1rem', fontWeight: 700, color: '#f1f5f9', marginBottom: '0.375rem' }}>Quick Actions</div>
                        <div style={{ fontSize: '0.78rem', color: '#475569', marginBottom: '1.25rem' }}>Manage inventory operations</div>

                        {[
                            { label: 'Add New Product', icon: '➕', path: '/add-product', color: '#22c55e' },
                            { label: 'View Inventory', icon: '📊', path: '/inventory', color: '#3b82f6' },
                            { label: 'Active Orders', icon: '⚡', path: '/store/active-orders', color: '#a855f7' },
                        ].map(a => (
                            <button
                                key={a.label}
                                onClick={() => navigate(a.path)}
                                style={{
                                    display: 'flex', alignItems: 'center', gap: '0.75rem',
                                    width: '100%', padding: '0.75rem 0.875rem',
                                    background: 'rgba(255,255,255,0.05)',
                                    border: '1px solid rgba(255,255,255,0.08)',
                                    borderRadius: '0.75rem', cursor: 'pointer',
                                    marginBottom: '0.5rem',
                                    transition: 'all 0.2s ease',
                                    color: '#cbd5e1',
                                    fontSize: '0.825rem', fontWeight: 600,
                                    textAlign: 'left',
                                }}
                                onMouseEnter={e => { e.currentTarget.style.background = 'rgba(255,255,255,0.1)'; e.currentTarget.style.borderColor = `${a.color}40`; }}
                                onMouseLeave={e => { e.currentTarget.style.background = 'rgba(255,255,255,0.05)'; e.currentTarget.style.borderColor = 'rgba(255,255,255,0.08)'; }}
                            >
                                <span style={{ fontSize: '1rem' }}>{a.icon}</span>
                                {a.label}
                            </button>
                        ))}
                    </div>

                    {/* Category breakdown */}
                    <div style={{
                        background: 'rgba(255,255,255,0.03)',
                        border: '1px solid rgba(255,255,255,0.07)',
                        borderRadius: '1.25rem',
                        padding: '1.25rem',
                    }}>
                        <div style={{ fontSize: '0.875rem', fontWeight: 700, color: '#f1f5f9', marginBottom: '1rem' }}>Stock by Category</div>
                        {[
                            { label: 'Glass Products', pct: 48, color: '#06b6d4' },
                            { label: 'Profiles', pct: 35, color: '#3b82f6' },
                            { label: 'Accessories', pct: 17, color: '#a855f7' },
                        ].map(c => (
                            <div key={c.label} style={{ marginBottom: '0.75rem' }}>
                                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '0.3rem' }}>
                                    <span style={{ fontSize: '0.78rem', color: '#64748b' }}>{c.label}</span>
                                    <span style={{ fontSize: '0.75rem', fontWeight: 700, color: '#94a3b8' }}>{c.pct}%</span>
                                </div>
                                <div style={{ height: '5px', borderRadius: '100px', background: 'rgba(255,255,255,0.05)', overflow: 'hidden' }}>
                                    <div style={{ height: '100%', width: `${c.pct}%`, background: c.color, borderRadius: '100px', opacity: 0.7 }} />
                                </div>
                            </div>
                        ))}
                    </div>
                </div>
            </div>
        </div>
    );
};

export default StockManagerDashboard;
