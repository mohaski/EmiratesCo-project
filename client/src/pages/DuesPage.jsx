import { useState, useEffect, useCallback, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import api from '../services/api';
import { wsEvents } from '../utils/wsEvents';

const STATUS_COLORS = {
    'Pending': '#f59e0b',
    'Partially Paid': '#3b82f6',
};

// Pure content — no header/search of its own, see CollectDebtTab in
// CollectPaymentsPage.jsx for the same split, now shared by DebtManagementPage.
export function DuesTab({ searchQuery = '', onCountChange }) {
    const navigate = useNavigate();
    const [credits, setCredits] = useState([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(null);
    const [sortBy, setSortBy] = useState('daysOutstanding');
    const [sortDir, setSortDir] = useState('desc');

    const fetchCredits = useCallback(async ({ showLoading = false } = {}) => {
        if (showLoading) setLoading(true);
        try {
            const data = await api.financialService.getOutstandingCredits();
            setCredits(data);
            setError(null);
        } catch (err) {
            console.error('Failed to fetch outstanding credits', err);
            setError('Failed to load outstanding balances.');
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => { fetchCredits({ showLoading: true }); }, [fetchCredits]);

    useEffect(() => {
        const off = wsEvents.on('orders_updated', () => fetchCredits());
        return off;
    }, [fetchCredits]);

    useEffect(() => { onCountChange?.(credits.length); }, [credits, onCountChange]);

    const handleSort = useCallback((field) => {
        if (sortBy === field) {
            setSortDir(d => d === 'desc' ? 'asc' : 'desc');
        } else {
            setSortBy(field);
            setSortDir('desc');
        }
    }, [sortBy]);

    const rows = useMemo(() => {
        const lq = searchQuery.toLowerCase();
        const filtered = credits.filter(c =>
            !lq
            || c.customerName.toLowerCase().includes(lq)
            || c.customerPhone.toLowerCase().includes(lq)
            || String(c.orderId).includes(lq)
        );
        const sorted = [...filtered].sort((a, b) => {
            let cmp;
            if (sortBy === 'customerName') cmp = a.customerName.localeCompare(b.customerName);
            else cmp = (a[sortBy] ?? 0) - (b[sortBy] ?? 0);
            return sortDir === 'asc' ? cmp : -cmp;
        });
        return sorted;
    }, [credits, searchQuery, sortBy, sortDir]);

    const handleRowClick = useCallback(async (row) => {
        try {
            const full = await api.orderService.getOrder(row.orderId);
            navigate('/orders/review', {
                state: { order: { ...full, id: full.orderId, customer: { id: row.customerId, name: row.customerName, phone: row.customerPhone } } },
            });
        } catch (err) {
            console.error('Failed to fetch order for summary view', err);
        }
    }, [navigate]);

    const SortHeader = ({ field, label, align = 'left' }) => (
        <th
            onClick={() => handleSort(field)}
            style={{
                padding: '0.75rem 1rem', textAlign: align, cursor: 'pointer', userSelect: 'none',
                fontSize: '0.65rem', fontWeight: 700, color: sortBy === field ? '#f1f5f9' : '#475569',
                letterSpacing: '0.08em', textTransform: 'uppercase', whiteSpace: 'nowrap',
            }}
        >
            {label} {sortBy === field && (sortDir === 'desc' ? '↓' : '↑')}
        </th>
    );

    return (
        <div style={{ padding: 'clamp(1rem, 4vw, 1.5rem) clamp(1rem, 4vw, 2rem)' }}>
            {error && (
                <div style={{ background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.3)', color: '#fca5a5', padding: '0.75rem 1rem', borderRadius: '0.75rem', fontSize: '0.8rem', fontWeight: 600, marginBottom: '1rem' }}>
                    {error}
                </div>
            )}
            {loading ? (
                <div style={{ textAlign: 'center', padding: '2rem', color: '#475569', fontSize: '0.875rem' }}>Loading...</div>
            ) : rows.length === 0 ? (
                <div style={{ textAlign: 'center', padding: '4rem 0', color: '#334155' }}>
                    <div style={{ fontSize: '3rem', marginBottom: '0.75rem', opacity: 0.4 }}>✅</div>
                    <p style={{ fontWeight: 500, fontSize: '0.875rem' }}>
                        {credits.length === 0 ? 'No outstanding balances — everyone is paid up.' : `No accounts found for "${searchQuery}"`}
                    </p>
                </div>
            ) : (
                <div style={{
                    background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.08)',
                    borderRadius: '1rem', overflow: 'hidden',
                }}>
                    <div className="table-scroll">
                    <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: '760px' }}>
                        <thead>
                            <tr style={{ borderBottom: '1px solid rgba(255,255,255,0.08)' }}>
                                <SortHeader field="customerName" label="Customer" />
                                <th style={{ padding: '0.75rem 1rem', textAlign: 'left', fontSize: '0.65rem', fontWeight: 700, color: '#475569', letterSpacing: '0.08em', textTransform: 'uppercase' }}>Phone</th>
                                <th style={{ padding: '0.75rem 1rem', textAlign: 'left', fontSize: '0.65rem', fontWeight: 700, color: '#475569', letterSpacing: '0.08em', textTransform: 'uppercase' }}>Order</th>
                                <SortHeader field="amountDue" label="Amount Owed" align="right" />
                                <SortHeader field="daysOutstanding" label="Days Outstanding" align="right" />
                                <th style={{ padding: '0.75rem 1rem', textAlign: 'left', fontSize: '0.65rem', fontWeight: 700, color: '#475569', letterSpacing: '0.08em', textTransform: 'uppercase' }}>Last Payment</th>
                                <th style={{ padding: '0.75rem 1rem', textAlign: 'left', fontSize: '0.65rem', fontWeight: 700, color: '#475569', letterSpacing: '0.08em', textTransform: 'uppercase' }}>Status</th>
                            </tr>
                        </thead>
                        <tbody>
                            {rows.map(row => {
                                const overdue = row.daysOutstanding > 30;
                                return (
                                    <tr
                                        key={row.creditId}
                                        onClick={() => handleRowClick(row)}
                                        style={{ borderBottom: '1px solid rgba(255,255,255,0.05)', cursor: 'pointer', transition: 'background 0.15s' }}
                                        onMouseEnter={e => { e.currentTarget.style.background = 'rgba(255,255,255,0.03)'; }}
                                        onMouseLeave={e => { e.currentTarget.style.background = 'transparent'; }}
                                    >
                                        <td style={{ padding: '0.875rem 1rem', fontSize: '0.85rem', fontWeight: 700, color: '#e2e8f0' }}>{row.customerName}</td>
                                        <td style={{ padding: '0.875rem 1rem', fontSize: '0.8rem', color: '#94a3b8', fontFamily: 'var(--font-mono)' }}>{row.customerPhone}</td>
                                        <td style={{ padding: '0.875rem 1rem', fontSize: '0.8rem', color: '#60a5fa', fontFamily: 'var(--font-mono)' }}>#{row.orderId}</td>
                                        <td style={{ padding: '0.875rem 1rem', fontSize: '0.9rem', fontWeight: 800, color: '#fbbf24', fontFamily: 'var(--font-mono)', textAlign: 'right' }}>KSH {row.amountDue.toLocaleString()}</td>
                                        <td style={{ padding: '0.875rem 1rem', textAlign: 'right' }}>
                                            <span style={{
                                                fontSize: '0.75rem', fontWeight: 700,
                                                color: overdue ? '#f87171' : '#94a3b8',
                                                background: overdue ? 'rgba(239,68,68,0.1)' : 'rgba(255,255,255,0.05)',
                                                border: overdue ? '1px solid rgba(239,68,68,0.25)' : '1px solid rgba(255,255,255,0.08)',
                                                borderRadius: '6px', padding: '2px 8px',
                                            }}>{row.daysOutstanding}d {overdue && '⚠'}</span>
                                        </td>
                                        <td style={{ padding: '0.875rem 1rem', fontSize: '0.78rem', color: '#64748b' }}>
                                            {row.lastPaymentAt ? new Date(row.lastPaymentAt).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }) : '—'}
                                        </td>
                                        <td style={{ padding: '0.875rem 1rem' }}>
                                            <span style={{
                                                fontSize: '0.7rem', fontWeight: 700,
                                                color: STATUS_COLORS[row.status] || '#94a3b8',
                                                background: `${STATUS_COLORS[row.status] || '#94a3b8'}18`,
                                                border: `1px solid ${STATUS_COLORS[row.status] || '#94a3b8'}30`,
                                                borderRadius: '6px', padding: '2px 8px',
                                            }}>{row.status}</span>
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
    );
}
