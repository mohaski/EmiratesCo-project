import React from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import CeoDashboard from '../components/dashboards/CeoDashboard';
import CashierDashboard from '../components/dashboards/CashierDashboard';

const GREETING = () => {
    const h = new Date().getHours();
    if (h < 12) return 'Good morning';
    if (h < 17) return 'Good afternoon';
    return 'Good evening';
};

// Keys are lower-cased to match the lower-cased `role` lookup below (and the
// lower-case comparisons in renderDashboard) — mixed-case keys here would never match.
const ROLE_META = {
    ceo:          { label: 'Executive Dashboard',  sub: 'Strategic overview of operations and revenue.' },
    admin:        { label: 'Admin Dashboard',       sub: 'Full system control and configuration.' },
    manager:      { label: 'Sales Dashboard',       sub: 'POS terminal and transaction management.' },
    cashier:      { label: 'Sales Dashboard',       sub: 'Process sales and view your orders.' },
};

export default function DashboardPage() {
    const { user } = useAuth();
    const navigate = useNavigate();
    const role = user?.role?.toLowerCase();

    const meta = ROLE_META[role] || { label: 'Dashboard', sub: 'Welcome back.' };
    const firstName = user?.firstName || user?.name?.split(' ')[0] || 'there';

    const renderDashboard = () => {
        if (role === 'ceo' || role === 'admin') return <CeoDashboard />;
        return <CashierDashboard />;
    };

    return (
        <div style={{ minHeight: '100%', background: 'var(--color-bg)', color: 'var(--color-text)', position: 'relative' }}>

            {/* Page Header */}
            <div className="dashboard-header" style={{
                padding: 'clamp(1rem, 3vw, 2rem) clamp(1rem, 3vw, 2.5rem) 1rem',
                borderBottom: '1px solid rgba(255,255,255,0.06)',
                background: 'rgba(255,255,255,0.02)',
                backdropFilter: 'blur(8px)',
                position: 'sticky', top: 0, zIndex: 20,
            }}>
                <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', flexWrap: 'wrap', gap: '0.75rem', maxWidth: '1400px', margin: '0 auto' }}>
                    <div className="animate-fade-in-up">
                        <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', marginBottom: '0.375rem', flexWrap: 'wrap' }}>
                            <div style={{
                                fontSize: '0.7rem', fontWeight: 600, letterSpacing: '0.1em',
                                textTransform: 'uppercase', color: '#3b82f6',
                                padding: '0.2rem 0.6rem',
                                background: 'rgba(59,130,246,0.12)',
                                border: '1px solid rgba(59,130,246,0.2)',
                                borderRadius: '100px',
                            }}>
                                {meta.label}
                            </div>
                        </div>
                        <h1 style={{ fontSize: 'clamp(1.2rem, 3vw, 1.5rem)', fontWeight: 700, color: '#f1f5f9', letterSpacing: '-0.02em' }}>
                            {GREETING()}, <span className="gradient-text">{firstName}</span>
                        </h1>
                        <p style={{ color: '#64748b', fontSize: '0.875rem', marginTop: '0.25rem' }}>{meta.sub}</p>
                    </div>

                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.625rem', flexWrap: 'wrap' }} className="animate-fade-in">
                        <div style={{
                            display: 'flex', alignItems: 'center', gap: '0.5rem',
                            padding: '0.4rem 0.75rem',
                            background: 'rgba(34,197,94,0.08)',
                            border: '1px solid rgba(34,197,94,0.18)',
                            borderRadius: '100px',
                        }}>
                            <span className="status-dot online" style={{ animation: 'pulse 2s ease-in-out infinite' }} />
                            <span style={{ fontSize: '0.72rem', fontWeight: 600, color: '#4ade80' }}>Online</span>
                        </div>
                        <div style={{
                            padding: '0.4rem 0.75rem',
                            background: 'rgba(255,255,255,0.04)',
                            border: '1px solid rgba(255,255,255,0.08)',
                            borderRadius: '0.625rem',
                            fontSize: '0.72rem', fontWeight: 500, color: '#64748b',
                        }}>
                            {new Date().toLocaleDateString('en-AE', { weekday: 'short', day: 'numeric', month: 'short' })}
                        </div>
                    </div>
                </div>
            </div>

            {/* Dashboard Body */}
            <div style={{ padding: '2rem 2.5rem', maxWidth: '1400px', margin: '0 auto' }}>
                {renderDashboard()}
            </div>
        </div>
    );
}
