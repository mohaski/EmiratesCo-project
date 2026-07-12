import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import UserRegistrationModal from '../users/UserRegistrationModal';

/* ── Mini Sparkline (pure CSS/SVG) ── */
const Sparkline = ({ data = [], color = '#3b82f6', height = 40 }) => {
    if (!data.length) return null;
    const max = Math.max(...data);
    const min = Math.min(...data);
    const range = max - min || 1;
    const w = 100, h = height;
    const pts = data.map((v, i) => {
        const x = (i / (data.length - 1)) * w;
        const y = h - ((v - min) / range) * (h - 4) - 2;
        return `${x},${y}`;
    }).join(' ');
    const fillPts = `0,${h} ${pts} ${w},${h}`;
    return (
        <svg viewBox={`0 0 ${w} ${h}`} style={{ width: '100%', height: `${h}px`, overflow: 'visible' }}>
            <defs>
                <linearGradient id={`sg-${color.replace('#','')}`} x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor={color} stopOpacity="0.3" />
                    <stop offset="100%" stopColor={color} stopOpacity="0.0" />
                </linearGradient>
            </defs>
            <polygon points={fillPts} fill={`url(#sg-${color.replace('#','')})`} />
            <polyline points={pts} fill="none" stroke={color} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
            {/* Last point dot */}
            {data.length > 0 && (() => {
                const last = data[data.length - 1];
                const x = w;
                const y = h - ((last - min) / range) * (h - 4) - 2;
                return <circle cx={x} cy={y} r="2.5" fill={color} />;
            })()}
        </svg>
    );
};

/* ── Bar Chart ── */
const BarChart = ({ data = [], labels = [], color = '#3b82f6' }) => {
    const max = Math.max(...data, 1);
    return (
        <div style={{ display: 'flex', alignItems: 'flex-end', gap: '6px', height: '160px', paddingTop: '8px' }}>
            {data.map((v, i) => (
                <div key={i} style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '4px', height: '100%', justifyContent: 'flex-end' }}>
                    <div
                        style={{
                            width: '100%',
                            height: `${(v / max) * 130}px`,
                            minHeight: '4px',
                            background: i === data.length - 1
                                ? 'linear-gradient(180deg, #3b82f6, #06b6d4)'
                                : `rgba(59,130,246,${0.25 + (v/max)*0.35})`,
                            borderRadius: '4px 4px 0 0',
                            transition: 'height 0.6s cubic-bezier(0.4,0,0.2,1)',
                            cursor: 'default',
                        }}
                        onMouseEnter={e => { e.currentTarget.style.filter = 'brightness(1.3)'; e.currentTarget.style.boxShadow = '0 0 12px rgba(59,130,246,0.4)'; }}
                        onMouseLeave={e => { e.currentTarget.style.filter = ''; e.currentTarget.style.boxShadow = ''; }}
                    />
                    <span style={{ fontSize: '0.6rem', color: '#475569', letterSpacing: '0.04em' }}>{labels[i]}</span>
                </div>
            ))}
        </div>
    );
};

/* ── Metric Card ── */
const MetricCard = ({ icon, label, value, subtext, change, color, sparkData, onClick }) => {
    const isPos = change && !change.startsWith('-');
    return (
        <div
            className="metric-card"
            onClick={onClick}
            style={{ cursor: onClick ? 'pointer' : 'default' }}
        >
            {/* Glow orb */}
            <div style={{
                position: 'absolute', top: '-20px', right: '-20px',
                width: '100px', height: '100px',
                borderRadius: '50%',
                background: `radial-gradient(circle, ${color}20, transparent 70%)`,
                pointerEvents: 'none',
            }} />

            <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: '1rem', position: 'relative' }}>
                <div style={{
                    width: '40px', height: '40px', borderRadius: '10px',
                    background: `${color}18`,
                    border: `1px solid ${color}30`,
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    fontSize: '1.1rem',
                }}>
                    {icon}
                </div>
                {change && (
                    <div style={{
                        display: 'flex', alignItems: 'center', gap: '3px',
                        fontSize: '0.7rem', fontWeight: 700,
                        color: isPos ? '#4ade80' : '#f87171',
                        background: isPos ? 'rgba(34,197,94,0.1)' : 'rgba(239,68,68,0.1)',
                        border: `1px solid ${isPos ? 'rgba(34,197,94,0.2)' : 'rgba(239,68,68,0.2)'}`,
                        padding: '0.2rem 0.5rem', borderRadius: '100px',
                    }}>
                        <span>{isPos ? '↑' : '↓'}</span>
                        {change}
                    </div>
                )}
            </div>

            <div style={{ marginBottom: '0.5rem' }}>
                <div style={{ fontSize: '0.7rem', fontWeight: 600, color: '#475569', letterSpacing: '0.08em', textTransform: 'uppercase', marginBottom: '0.375rem' }}>
                    {label}
                </div>
                <div style={{ fontSize: '1.625rem', fontWeight: 800, color: '#f1f5f9', letterSpacing: '-0.025em', lineHeight: 1 }}>
                    {value}
                </div>
                {subtext && (
                    <div style={{ fontSize: '0.75rem', color: '#475569', marginTop: '0.3rem' }}>{subtext}</div>
                )}
            </div>

            {sparkData && (
                <div style={{ marginTop: '0.75rem' }}>
                    <Sparkline data={sparkData} color={color} height={36} />
                </div>
            )}
        </div>
    );
};

/* ── Activity Feed ── */
const ActivityItem = ({ icon, title, desc, time, color }) => (
    <div style={{ display: 'flex', gap: '0.875rem', alignItems: 'flex-start' }}>
        <div style={{
            width: '32px', height: '32px', borderRadius: '8px', flexShrink: 0,
            background: `${color}18`, border: `1px solid ${color}25`,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            fontSize: '0.875rem',
        }}>
            {icon}
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: '0.8rem', fontWeight: 600, color: '#cbd5e1', marginBottom: '2px' }}>{title}</div>
            <div style={{ fontSize: '0.75rem', color: '#475569', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{desc}</div>
        </div>
        <div style={{ fontSize: '0.65rem', color: '#334155', flexShrink: 0, marginTop: '2px', fontFamily: 'var(--font-mono)' }}>{time}</div>
    </div>
);

/* ── Main Dashboard ── */
const CeoDashboard = () => {
    const navigate = useNavigate();
    const [showUserReg, setShowUserReg] = useState(false);
    const [period, setPeriod] = useState('week');

    const revenueData = {
        week:  [42, 58, 51, 76, 68, 90, 84],
        month: [320, 410, 380, 500, 460, 520, 480, 610, 590, 640, 720, 680],
        year:  [1200, 1450, 1320, 1680, 1590, 1820, 1740, 2100, 1980, 2240, 2180, 2560],
    };

    const labels = {
        week:  ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'],
        month: ['1','4','7','10','13','16','19','22','25','28','31'],
        year:  ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'],
    };

    const metrics = [
        {
            icon: '💰',
            label: 'Total Revenue',
            value: 'KSH 124,000',
            subtext: 'This month',
            change: '+12.4%',
            color: '#3b82f6',
            sparkData: [40, 52, 48, 65, 70, 62, 84],
        },
        {
            icon: '🛒',
            label: 'Total Orders',
            value: '1,342',
            subtext: '84 today',
            change: '+5.2%',
            color: '#22c55e',
            sparkData: [120, 145, 132, 158, 162, 175, 180],
        },
        {
            icon: '⚡',
            label: 'Pending Credits',
            value: 'KSH 45,000',
            subtext: '12 accounts',
            change: '-2.1%',
            color: '#f59e0b',
            sparkData: [55, 48, 52, 46, 44, 42, 45],
        },
        {
            icon: '👥',
            label: 'Active Users',
            value: '24',
            subtext: 'Across all roles',
            change: '+2',
            color: '#a855f7',
            sparkData: [18, 20, 19, 22, 21, 24, 24],
            onClick: () => setShowUserReg(true),
        },
    ];

    const activities = [
        { icon: '🧾', title: 'Order #1847 confirmed',      desc: 'Glass 12mm — KSH 2,400',  time: '2m ago',  color: '#3b82f6' },
        { icon: '💳', title: 'Payment received',           desc: 'Customer: Al Rashid Corp', time: '15m ago', color: '#22c55e' },
        { icon: '📦', title: 'Stock alert: Low inventory', desc: '6mm Clear Glass < 10 units', time: '1h ago',  color: '#f59e0b' },
        { icon: '👤', title: 'New customer registered',    desc: 'Al Fahim Contracting LLC', time: '2h ago',  color: '#a855f7' },
        { icon: '🔧', title: 'Order #1839 completed',      desc: 'Ready for pickup',         time: '3h ago',  color: '#22c55e' },
    ];

    const quickActions = [
        { label: 'New Sale', icon: '⚡', path: '/sales', color: '#3b82f6' },
        { label: 'Add Product', icon: '📦', path: '/add-product', color: '#22c55e' },
        { label: 'View Orders', icon: '🛒', path: '/orders', color: '#a855f7' },
        { label: 'Inventory', icon: '🏭', path: '/inventory', color: '#f59e0b' },
    ];

    return (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '1.75rem' }} className="animate-fade-in-up">

            {/* ── Quick Actions ── */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '0.875rem' }}>
                {quickActions.map((a) => (
                    <button
                        key={a.label}
                        onClick={() => navigate(a.path)}
                        style={{
                            display: 'flex', alignItems: 'center', gap: '0.75rem',
                            padding: '0.875rem 1rem',
                            background: `${a.color}0e`,
                            border: `1px solid ${a.color}25`,
                            borderRadius: '0.875rem',
                            cursor: 'pointer',
                            transition: 'all 0.25s ease',
                            color: a.color,
                        }}
                        onMouseEnter={e => {
                            e.currentTarget.style.background = `${a.color}18`;
                            e.currentTarget.style.transform = 'translateY(-2px)';
                            e.currentTarget.style.boxShadow = `0 8px 24px ${a.color}20`;
                        }}
                        onMouseLeave={e => {
                            e.currentTarget.style.background = `${a.color}0e`;
                            e.currentTarget.style.transform = '';
                            e.currentTarget.style.boxShadow = '';
                        }}
                    >
                        <span style={{ fontSize: '1.2rem' }}>{a.icon}</span>
                        <span style={{ fontSize: '0.875rem', fontWeight: 600, color: '#cbd5e1' }}>{a.label}</span>
                    </button>
                ))}
            </div>

            {/* ── Metrics Grid ── */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '1rem' }}>
                {metrics.map((m, i) => (
                    <MetricCard key={i} {...m} />
                ))}
            </div>

            {/* ── Charts + Activity ── */}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 320px', gap: '1rem' }}>

                {/* Revenue Bar Chart */}
                <div style={{
                    background: 'linear-gradient(135deg, rgba(255,255,255,0.05), rgba(255,255,255,0.02))',
                    border: '1px solid rgba(255,255,255,0.08)',
                    borderRadius: '1.25rem',
                    padding: '1.5rem',
                    position: 'relative',
                    overflow: 'hidden',
                }}>
                    <div style={{
                        position: 'absolute', top: 0, left: 0, right: 0, height: '1px',
                        background: 'linear-gradient(90deg, transparent, rgba(59,130,246,0.4), transparent)',
                    }} />
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '1.25rem' }}>
                        <div>
                            <div style={{ fontSize: '0.7rem', color: '#475569', fontWeight: 600, letterSpacing: '0.08em', textTransform: 'uppercase' }}>Revenue</div>
                            <div style={{ fontSize: '1.25rem', fontWeight: 800, color: '#f1f5f9', letterSpacing: '-0.02em' }}>
                                KSH {period === 'week' ? '8,420' : period === 'month' ? '124,000' : '1.24M'}
                            </div>
                        </div>
                        <div style={{ display: 'flex', gap: '4px', background: 'rgba(255,255,255,0.04)', borderRadius: '0.5rem', padding: '3px' }}>
                            {['week', 'month', 'year'].map(p => (
                                <button
                                    key={p}
                                    onClick={() => setPeriod(p)}
                                    style={{
                                        padding: '0.25rem 0.625rem',
                                        borderRadius: '0.375rem',
                                        border: 'none',
                                        fontSize: '0.7rem',
                                        fontWeight: 600,
                                        cursor: 'pointer',
                                        background: period === p ? 'rgba(59,130,246,0.2)' : 'transparent',
                                        color: period === p ? '#60a5fa' : '#475569',
                                        transition: 'all 0.2s ease',
                                    }}
                                >
                                    {p.charAt(0).toUpperCase() + p.slice(1)}
                                </button>
                            ))}
                        </div>
                    </div>
                    <BarChart data={revenueData[period]} labels={labels[period]} />
                </div>

                {/* Order Status Donut */}
                <div style={{
                    background: 'linear-gradient(135deg, rgba(255,255,255,0.05), rgba(255,255,255,0.02))',
                    border: '1px solid rgba(255,255,255,0.08)',
                    borderRadius: '1.25rem',
                    padding: '1.5rem',
                }}>
                    <div style={{ fontSize: '0.7rem', color: '#475569', fontWeight: 600, letterSpacing: '0.08em', textTransform: 'uppercase', marginBottom: '0.5rem' }}>Order Status</div>
                    <div style={{ fontSize: '1.25rem', fontWeight: 800, color: '#f1f5f9', letterSpacing: '-0.02em', marginBottom: '1.5rem' }}>1,342 Total</div>

                    {/* Status bars */}
                    {[
                        { label: 'Completed', value: 892, total: 1342, color: '#22c55e' },
                        { label: 'Processing', value: 284, total: 1342, color: '#3b82f6' },
                        { label: 'Pending', value: 126, total: 1342, color: '#f59e0b' },
                        { label: 'Cancelled', value: 40, total: 1342, color: '#ef4444' },
                    ].map(s => (
                        <div key={s.label} style={{ marginBottom: '0.875rem' }}>
                            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '0.3rem' }}>
                                <span style={{ fontSize: '0.8rem', color: '#94a3b8', fontWeight: 500 }}>{s.label}</span>
                                <span style={{ fontSize: '0.75rem', color: '#cbd5e1', fontWeight: 600 }}>
                                    {s.value} <span style={{ color: '#475569' }}>({Math.round(s.value/s.total*100)}%)</span>
                                </span>
                            </div>
                            <div style={{ height: '6px', borderRadius: '100px', background: 'rgba(255,255,255,0.06)', overflow: 'hidden' }}>
                                <div style={{
                                    height: '100%',
                                    width: `${(s.value / s.total) * 100}%`,
                                    background: s.color,
                                    borderRadius: '100px',
                                    opacity: 0.8,
                                    transition: 'width 1s cubic-bezier(0.4,0,0.2,1)',
                                }} />
                            </div>
                        </div>
                    ))}

                    {/* Category breakdown */}
                    <div style={{ marginTop: '1.25rem', padding: '1rem', background: 'rgba(255,255,255,0.03)', borderRadius: '0.75rem', border: '1px solid rgba(255,255,255,0.05)' }}>
                        <div style={{ fontSize: '0.7rem', color: '#475569', fontWeight: 600, letterSpacing: '0.06em', textTransform: 'uppercase', marginBottom: '0.75rem' }}>Top Categories</div>
                        {[
                            { label: 'Glass', pct: 52, color: '#06b6d4' },
                            { label: 'Profiles', pct: 31, color: '#3b82f6' },
                            { label: 'Accessories', pct: 17, color: '#a855f7' },
                        ].map(c => (
                            <div key={c.label} style={{ display: 'flex', alignItems: 'center', gap: '0.625rem', marginBottom: '0.5rem' }}>
                                <div style={{ width: '8px', height: '8px', borderRadius: '50%', background: c.color, flexShrink: 0 }} />
                                <span style={{ fontSize: '0.78rem', color: '#94a3b8', flex: 1 }}>{c.label}</span>
                                <span style={{ fontSize: '0.75rem', fontWeight: 600, color: '#cbd5e1' }}>{c.pct}%</span>
                            </div>
                        ))}
                    </div>
                </div>

                {/* Activity Feed */}
                <div style={{
                    background: 'linear-gradient(135deg, rgba(255,255,255,0.05), rgba(255,255,255,0.02))',
                    border: '1px solid rgba(255,255,255,0.08)',
                    borderRadius: '1.25rem',
                    padding: '1.5rem',
                    display: 'flex',
                    flexDirection: 'column',
                }}>
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '1.25rem' }}>
                        <div>
                            <div style={{ fontSize: '0.7rem', color: '#475569', fontWeight: 600, letterSpacing: '0.08em', textTransform: 'uppercase' }}>Activity</div>
                            <div style={{ fontSize: '1rem', fontWeight: 700, color: '#f1f5f9' }}>Live Feed</div>
                        </div>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '0.375rem' }}>
                            <span className="status-dot online" style={{ animation: 'pulse 1.5s ease-in-out infinite' }} />
                            <span style={{ fontSize: '0.65rem', fontWeight: 600, color: '#4ade80' }}>LIVE</span>
                        </div>
                    </div>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem', flex: 1 }}>
                        {activities.map((a, i) => (
                            <ActivityItem key={i} {...a} />
                        ))}
                    </div>
                    <button
                        onClick={() => navigate('/orders')}
                        style={{
                            marginTop: '1rem',
                            width: '100%',
                            padding: '0.625rem',
                            background: 'rgba(59,130,246,0.08)',
                            border: '1px solid rgba(59,130,246,0.2)',
                            borderRadius: '0.625rem',
                            color: '#60a5fa',
                            fontSize: '0.8rem',
                            fontWeight: 600,
                            cursor: 'pointer',
                            transition: 'all 0.2s ease',
                        }}
                        onMouseEnter={e => { e.currentTarget.style.background = 'rgba(59,130,246,0.14)'; }}
                        onMouseLeave={e => { e.currentTarget.style.background = 'rgba(59,130,246,0.08)'; }}
                    >
                        View all activity →
                    </button>
                </div>
            </div>

            {/* ── KPI Footer Row ── */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '1rem' }}>
                {[
                    { label: 'Avg. Order Value', value: 'KSH 924', icon: '📊', trend: '+8%', color: '#06b6d4' },
                    { label: 'Customer Satisfaction', value: '96.4%', icon: '⭐', trend: '+1.2%', color: '#f59e0b' },
                    { label: 'Stock Turnover', value: '4.2x', icon: '🔄', trend: '+0.3x', color: '#22c55e' },
                    { label: 'Outstanding Credits', value: 'KSH 45K', icon: '💼', trend: '-2%', color: '#a855f7' },
                ].map((kpi, i) => (
                    <div key={i} style={{
                        background: 'rgba(255,255,255,0.03)',
                        border: '1px solid rgba(255,255,255,0.07)',
                        borderRadius: '1rem',
                        padding: '1rem 1.25rem',
                        display: 'flex',
                        alignItems: 'center',
                        gap: '0.875rem',
                        transition: 'all 0.25s ease',
                    }}
                        onMouseEnter={e => { e.currentTarget.style.background = 'rgba(255,255,255,0.05)'; e.currentTarget.style.transform = 'translateY(-1px)'; }}
                        onMouseLeave={e => { e.currentTarget.style.background = 'rgba(255,255,255,0.03)'; e.currentTarget.style.transform = ''; }}
                    >
                        <div style={{
                            width: '40px', height: '40px', borderRadius: '10px',
                            background: `${kpi.color}15`, border: `1px solid ${kpi.color}25`,
                            display: 'flex', alignItems: 'center', justifyContent: 'center',
                            fontSize: '1.1rem', flexShrink: 0,
                        }}>
                            {kpi.icon}
                        </div>
                        <div>
                            <div style={{ fontSize: '0.65rem', color: '#475569', fontWeight: 600, letterSpacing: '0.06em', textTransform: 'uppercase' }}>{kpi.label}</div>
                            <div style={{ display: 'flex', alignItems: 'baseline', gap: '0.5rem', marginTop: '2px' }}>
                                <span style={{ fontSize: '1.1rem', fontWeight: 700, color: '#f1f5f9' }}>{kpi.value}</span>
                                <span style={{
                                    fontSize: '0.7rem', fontWeight: 600,
                                    color: kpi.trend.startsWith('+') ? '#4ade80' : '#f87171',
                                }}>
                                    {kpi.trend}
                                </span>
                            </div>
                        </div>
                    </div>
                ))}
            </div>

            {/* User Registration Modal */}
            <UserRegistrationModal isOpen={showUserReg} onClose={() => setShowUserReg(false)} />
        </div>
    );
};

export default CeoDashboard;
