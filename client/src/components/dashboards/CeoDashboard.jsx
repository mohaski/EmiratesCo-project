import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import UserRegistrationModal from '../users/UserRegistrationModal';
import { useOutstandingCredits } from '../../hooks/useOutstandingCredits';
import { useFinancialSummary } from '../../hooks/useFinancialSummary';
import { activityMetaForItem, timeAgo } from '../../utils/activityMeta';
import api from '../../services/api';

/* ── Bar Chart (bars are clickable — onBarClick(index) surfaces more detail) ── */
const BarChart = ({ data = [], labels = [], onBarClick, selectedIndex = null }) => {
    const max = Math.max(...data, 1);
    return (
        <div style={{ display: 'flex', alignItems: 'flex-end', gap: '6px', height: '160px', paddingTop: '8px' }}>
            {data.map((v, i) => {
                const isSelected = selectedIndex === i;
                return (
                <div key={i} style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '4px', height: '100%', justifyContent: 'flex-end' }}>
                    <div
                        onClick={() => onBarClick?.(i)}
                        style={{
                            width: '100%',
                            height: `${(v / max) * 130}px`,
                            minHeight: '4px',
                            background: isSelected
                                ? 'linear-gradient(180deg, #3b82f6, #06b6d4)'
                                : `rgba(59,130,246,${0.25 + (v/max)*0.35})`,
                            borderRadius: '4px 4px 0 0',
                            transition: 'height 0.6s cubic-bezier(0.4,0,0.2,1)',
                            cursor: onBarClick ? 'pointer' : 'default',
                            boxShadow: isSelected ? '0 0 12px rgba(59,130,246,0.4)' : 'none',
                            outline: isSelected ? '1px solid rgba(96,165,250,0.6)' : 'none',
                        }}
                        onMouseEnter={e => { e.currentTarget.style.filter = 'brightness(1.3)'; e.currentTarget.style.boxShadow = '0 0 12px rgba(59,130,246,0.4)'; }}
                        onMouseLeave={e => { e.currentTarget.style.filter = ''; e.currentTarget.style.boxShadow = isSelected ? '0 0 12px rgba(59,130,246,0.4)' : ''; }}
                    />
                    <span style={{ fontSize: '0.6rem', color: '#475569', letterSpacing: '0.04em' }}>{labels[i]}</span>
                </div>
                );
            })}
        </div>
    );
};

/* ── Metric Card ── */
const MetricCard = ({ icon, label, value, subtext, color, onClick }) => (
    <div className="metric-card" onClick={onClick} style={{ cursor: onClick ? 'pointer' : 'default' }}>
        <div style={{
            position: 'absolute', top: '-20px', right: '-20px',
            width: '100px', height: '100px', borderRadius: '50%',
            background: `radial-gradient(circle, ${color}20, transparent 70%)`,
            pointerEvents: 'none',
        }} />
        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: '1rem', position: 'relative' }}>
            <div style={{
                width: '40px', height: '40px', borderRadius: '10px',
                background: `${color}18`, border: `1px solid ${color}30`,
                display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '1.1rem',
            }}>{icon}</div>
        </div>
        <div>
            <div style={{ fontSize: '0.7rem', fontWeight: 600, color: '#475569', letterSpacing: '0.08em', textTransform: 'uppercase', marginBottom: '0.375rem' }}>
                {label}
            </div>
            <div style={{ fontSize: '1.625rem', fontWeight: 800, color: '#f1f5f9', letterSpacing: '-0.025em', lineHeight: 1 }}>
                {value}
            </div>
            {subtext && <div style={{ fontSize: '0.75rem', color: '#475569', marginTop: '0.3rem' }}>{subtext}</div>}
        </div>
    </div>
);

/* ── Activity Feed ── */
const ActivityItem = ({ icon, title, desc, time, color }) => (
    <div style={{ display: 'flex', gap: '0.875rem', alignItems: 'flex-start' }}>
        <div style={{
            width: '32px', height: '32px', borderRadius: '8px', flexShrink: 0,
            background: `${color}18`, border: `1px solid ${color}25`,
            display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '0.875rem',
        }}>{icon}</div>
        <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: '0.8rem', fontWeight: 600, color: '#cbd5e1', marginBottom: '2px' }}>{title}</div>
            <div style={{ fontSize: '0.75rem', color: '#475569', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{desc}</div>
        </div>
        <div style={{ fontSize: '0.65rem', color: '#334155', flexShrink: 0, marginTop: '2px', fontFamily: 'var(--font-mono)' }}>{time}</div>
    </div>
);

const STATUS_META = {
    pending: { label: 'Pending', color: '#f59e0b' },
    confirmed: { label: 'Confirmed', color: '#3b82f6' },
    ready: { label: 'Ready', color: '#06b6d4' },
    completed: { label: 'Completed', color: '#22c55e' },
    cancelled: { label: 'Cancelled', color: '#ef4444' },
};

const PERIOD_LABEL = { day: 'Today', month: 'This month', year: 'This year' };

/* ── Main Dashboard ── */
const CeoDashboard = () => {
    const navigate = useNavigate();
    const [showUserReg, setShowUserReg] = useState(false);
    const [period, setPeriod] = useState('day');
    const [selectedMethod, setSelectedMethod] = useState(null);
    const { totalDue, count: duesCount } = useOutstandingCredits();
    const { summary, loading: summaryLoading } = useFinancialSummary(period);

    const [activeUserCount, setActiveUserCount] = useState(null);
    const [activities, setActivities] = useState([]);

    useEffect(() => {
        api.userService.getAllUsers()
            .then(users => setActiveUserCount(users.filter(u => u.isActive).length))
            .catch(() => {});
    }, []);

    useEffect(() => {
        api.orderService.getAuditHistory(null, 0, 8)
            .then(setActivities)
            .catch(() => {});
    }, []);

    const total = summary?.total ?? 0;
    const orderCount = summary?.order_count ?? 0;
    const avgOrderValue = orderCount > 0 ? total / orderCount : 0;
    const statusCounts = summary?.status_counts ?? {};
    const byMethod = summary?.by_method ?? { cash: 0, mpesa: 0 };
    const byMethodCount = summary?.by_method_count ?? { cash: 0, mpesa: 0 };
    const maxStatusCount = Math.max(...Object.values(statusCounts), 1);

    const methodKeys = ['cash', 'mpesa'];
    const methodLabels = { cash: 'Cash', mpesa: 'M-Pesa' };
    const selectedIndex = selectedMethod ? methodKeys.indexOf(selectedMethod) : null;

    const metrics = [
        {
            icon: '💰', label: 'Total Revenue',
            value: summaryLoading ? '…' : `KSH ${total.toLocaleString()}`,
            subtext: PERIOD_LABEL[period], color: '#3b82f6',
        },
        {
            icon: '🛒', label: 'Total Orders',
            value: summaryLoading ? '…' : orderCount.toLocaleString(),
            subtext: PERIOD_LABEL[period], color: '#22c55e',
        },
        {
            icon: '⚡', label: 'Pending Credits',
            value: `KSH ${totalDue.toLocaleString()}`,
            subtext: `${duesCount} account${duesCount === 1 ? '' : 's'}`,
            color: '#f59e0b', onClick: () => navigate('/debt-management'),
        },
        {
            icon: '👥', label: 'Active Users',
            value: activeUserCount == null ? '…' : activeUserCount.toString(),
            subtext: 'Managers & cashiers', color: '#a855f7',
            onClick: () => setShowUserReg(true),
        },
    ];

    const quickActions = [
        { label: 'New Sale', icon: '⚡', path: '/sales', color: '#3b82f6' },
        { label: 'Add Product', icon: '📦', path: '/product-management', color: '#22c55e', state: { tab: 'add' } },
        { label: 'View Orders', icon: '🛒', path: '/orders', color: '#a855f7' },
        { label: 'Inventory', icon: '🏭', path: '/inventory', color: '#f59e0b' },
    ];

    const kpis = [
        { label: 'Avg. Order Value', value: `KSH ${Math.round(avgOrderValue).toLocaleString()}`, icon: '📊', color: '#06b6d4' },
        { label: 'Pending Orders', value: (statusCounts.pending || 0).toString(), icon: '⏳', color: '#f59e0b' },
        { label: 'Cancelled', value: (statusCounts.cancelled || 0).toString(), icon: '🚫', color: '#ef4444' },
        { label: 'Outstanding Credits', value: `KSH ${totalDue.toLocaleString()}`, icon: '💼', color: '#a855f7', onClick: () => navigate('/debt-management') },
    ];

    return (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '1.75rem' }} className="animate-fade-in-up">

            {/* ── Quick Actions ── */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: '0.875rem' }}>
                {quickActions.map((a) => (
                    <button
                        key={a.label}
                        onClick={() => navigate(a.path, a.state ? { state: a.state } : undefined)}
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
            <div className="metric-grid">
                {metrics.map((m, i) => (
                    <MetricCard key={i} {...m} />
                ))}
            </div>

            {/* ── Charts + Activity ── */}
            <style>{`
                @media (max-width: 1023px) {
                    .ceo-charts-grid { grid-template-columns: minmax(0, 1fr) !important; }
                }
            `}</style>
            <div className="ceo-charts-grid" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 320px', gap: '1rem' }}>

                {/* Payment Method Breakdown */}
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
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '1.25rem', flexWrap: 'wrap', gap: '0.75rem' }}>
                        <div>
                            <div style={{ fontSize: '0.7rem', color: '#475569', fontWeight: 600, letterSpacing: '0.08em', textTransform: 'uppercase' }}>Received by Payment Method</div>
                            <div style={{ fontSize: '1.25rem', fontWeight: 800, color: '#f1f5f9', letterSpacing: '-0.02em' }}>
                                KSH {total.toLocaleString()}
                            </div>
                        </div>
                        <div style={{ display: 'flex', gap: '4px', background: 'rgba(255,255,255,0.04)', borderRadius: '0.5rem', padding: '3px' }}>
                            {['day', 'month', 'year'].map(p => (
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
                    <BarChart
                        data={[byMethod.cash, byMethod.mpesa]}
                        labels={['Cash', 'M-Pesa']}
                        selectedIndex={selectedIndex}
                        onBarClick={(i) => {
                            const key = methodKeys[i];
                            setSelectedMethod(prev => prev === key ? null : key);
                        }}
                    />
                    {selectedMethod && (
                        <div style={{
                            marginTop: '1rem', padding: '0.875rem 1rem', borderRadius: '0.875rem',
                            background: 'rgba(59,130,246,0.06)', border: '1px solid rgba(59,130,246,0.15)',
                            display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '1rem', flexWrap: 'wrap',
                        }}>
                            <div>
                                <div style={{ fontSize: '0.68rem', color: '#475569', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em' }}>
                                    {methodLabels[selectedMethod]} · {PERIOD_LABEL[period]}
                                </div>
                                <div style={{ fontSize: '1.05rem', fontWeight: 800, color: '#f1f5f9', marginTop: '2px' }}>
                                    KSH {byMethod[selectedMethod].toLocaleString()}
                                </div>
                            </div>
                            <div style={{ textAlign: 'right' }}>
                                <div style={{ fontSize: '0.78rem', color: '#94a3b8', fontWeight: 600 }}>
                                    {total > 0 ? Math.round(byMethod[selectedMethod] / total * 100) : 0}% of total
                                </div>
                                <div style={{ fontSize: '0.72rem', color: '#64748b', marginTop: '2px' }}>
                                    {byMethodCount[selectedMethod]} transaction{byMethodCount[selectedMethod] === 1 ? '' : 's'}
                                </div>
                            </div>
                        </div>
                    )}
                </div>

                {/* Order Status */}
                <div style={{
                    background: 'linear-gradient(135deg, rgba(255,255,255,0.05), rgba(255,255,255,0.02))',
                    border: '1px solid rgba(255,255,255,0.08)',
                    borderRadius: '1.25rem',
                    padding: '1.5rem',
                }}>
                    <div style={{ fontSize: '0.7rem', color: '#475569', fontWeight: 600, letterSpacing: '0.08em', textTransform: 'uppercase', marginBottom: '0.5rem' }}>Order Status</div>
                    <div style={{ fontSize: '1.25rem', fontWeight: 800, color: '#f1f5f9', letterSpacing: '-0.02em', marginBottom: '1.5rem' }}>{orderCount} Total</div>

                    {Object.keys(STATUS_META).map(status => {
                        const value = statusCounts[status] || 0;
                        const meta = STATUS_META[status];
                        return (
                            <div key={status} style={{ marginBottom: '0.875rem' }}>
                                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '0.3rem' }}>
                                    <span style={{ fontSize: '0.8rem', color: '#94a3b8', fontWeight: 500 }}>{meta.label}</span>
                                    <span style={{ fontSize: '0.75rem', color: '#cbd5e1', fontWeight: 600 }}>
                                        {value} <span style={{ color: '#475569' }}>({orderCount > 0 ? Math.round(value / orderCount * 100) : 0}%)</span>
                                    </span>
                                </div>
                                <div style={{ height: '6px', borderRadius: '100px', background: 'rgba(255,255,255,0.06)', overflow: 'hidden' }}>
                                    <div style={{
                                        height: '100%',
                                        width: `${(value / maxStatusCount) * 100}%`,
                                        background: meta.color,
                                        borderRadius: '100px',
                                        opacity: 0.8,
                                        transition: 'width 1s cubic-bezier(0.4,0,0.2,1)',
                                    }} />
                                </div>
                            </div>
                        );
                    })}
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
                            <div style={{ fontSize: '1rem', fontWeight: 700, color: '#f1f5f9' }}>Manager & Cashier Activity</div>
                        </div>
                    </div>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem', flex: 1 }}>
                        {activities.length === 0 ? (
                            <p style={{ fontSize: '0.78rem', color: '#334155', textAlign: 'center', marginTop: '1rem', fontStyle: 'italic' }}>No recent activity</p>
                        ) : activities.map((a) => {
                            const meta = activityMetaForItem(a);
                            return (
                                <ActivityItem
                                    key={a.id}
                                    icon={meta.icon}
                                    color={meta.color}
                                    title={meta.label}
                                    desc={`${a.edited_by} · #${a.entity_id}`}
                                    time={timeAgo(a.edited_at)}
                                />
                            );
                        })}
                    </div>
                    <button
                        onClick={() => navigate('/activity')}
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
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: '1rem' }}>
                {kpis.map((kpi, i) => (
                    <div key={i} onClick={kpi.onClick} style={{
                        background: 'rgba(255,255,255,0.03)',
                        border: '1px solid rgba(255,255,255,0.07)',
                        borderRadius: '1rem',
                        padding: '1rem 1.25rem',
                        display: 'flex',
                        alignItems: 'center',
                        gap: '0.875rem',
                        transition: 'all 0.25s ease',
                        cursor: kpi.onClick ? 'pointer' : 'default',
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
