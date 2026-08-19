import { useState, useEffect, useCallback, useMemo } from 'react';
import api from '../services/api';
import { activityMeta, activityMetaForItem, summarizeActivity, diffSnapshot, colorForName, initials, describeStockBatchLine } from '../utils/activityMeta';

const MANAGEABLE_ROLES = new Set(['manager', 'cashier']);
const PAGE_SIZE = 50;

const ENTITY_TYPES = [
    'order', 'order_status', 'order_cancellation', 'restock', 'stock_batch',
    'stock_batch_correction', 'manual_offcut', 'offcut_correction', 'profile_offcut_correction',
];

const fieldStyle = {
    background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.09)',
    borderRadius: '0.625rem', padding: '0.55rem 0.75rem', color: '#e2e8f0', fontSize: '0.8rem', outline: 'none',
};

const dateGroupLabel = (iso) => {
    const d = new Date(iso);
    const today = new Date();
    const yesterday = new Date(today);
    yesterday.setDate(today.getDate() - 1);
    const sameDay = (a, b) => a.toDateString() === b.toDateString();
    if (sameDay(d, today)) return 'Today';
    if (sameDay(d, yesterday)) return 'Yesterday';
    return d.toLocaleDateString(undefined, {
        weekday: 'long', month: 'short', day: 'numeric',
        year: d.getFullYear() !== today.getFullYear() ? 'numeric' : undefined,
    });
};

const groupByDate = (rows) => {
    const groups = [];
    let current = null;
    for (const r of rows) {
        const label = dateGroupLabel(r.edited_at);
        if (!current || current.label !== label) {
            current = { label, items: [] };
            groups.push(current);
        }
        current.items.push(r);
    }
    return groups;
};

function StatCard({ label, value, sub, color }) {
    return (
        <div style={{
            flex: '1 1 150px', padding: '0.875rem 1.125rem', borderRadius: '0.875rem',
            background: 'linear-gradient(135deg, rgba(255,255,255,0.05), rgba(255,255,255,0.02))',
            border: '1px solid rgba(255,255,255,0.08)',
        }}>
            <div style={{ fontSize: '0.65rem', fontWeight: 700, color: '#475569', textTransform: 'uppercase', letterSpacing: '0.07em' }}>{label}</div>
            <div style={{ fontSize: '1.35rem', fontWeight: 800, color: color || '#f1f5f9', marginTop: '3px', letterSpacing: '-0.02em' }}>{value}</div>
            {sub && <div style={{ fontSize: '0.7rem', color: '#64748b', marginTop: '2px' }}>{sub}</div>}
        </div>
    );
}

function ActivityRow({ item, expanded, onToggle }) {
    const meta = activityMetaForItem(item);
    const summary = summarizeActivity(item);
    const date = new Date(item.edited_at);
    // stock_batch carries a per-line breakdown (product/variant/qty) that doesn't
    // fit a flat before→after diff — render it as its own list instead.
    const batchLines = item.entity_type === 'stock_batch' ? (item.after_snapshot?.lines || []) : null;
    const rows = batchLines ? [] : diffSnapshot(item.before_snapshot, item.after_snapshot).filter(r => r.changed);
    const hasDetails = (batchLines && batchLines.length > 0) || rows.length > 0;
    const avatarColor = colorForName(item.edited_by);

    return (
        <div style={{
            padding: '0.875rem 1.125rem', borderRadius: '0.875rem',
            background: 'linear-gradient(135deg, rgba(255,255,255,0.035), rgba(255,255,255,0.012))',
            border: '1px solid rgba(255,255,255,0.07)',
            borderLeft: `3px solid ${meta.color}55`,
            transition: 'border-color 0.15s',
        }}>
            <div style={{ display: 'flex', alignItems: 'flex-start', gap: '0.875rem' }}>
                <div style={{
                    width: '36px', height: '36px', borderRadius: '50%', flexShrink: 0,
                    background: `${avatarColor}22`, border: `1px solid ${avatarColor}55`,
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    fontSize: '0.72rem', fontWeight: 800, color: avatarColor,
                }}>{initials(item.edited_by)}</div>

                <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', flexWrap: 'wrap' }}>
                        <span style={{ fontSize: '0.85rem', fontWeight: 700, color: '#e2e8f0' }}>{item.edited_by}</span>
                        <span style={{
                            display: 'inline-flex', alignItems: 'center', gap: '4px',
                            fontSize: '0.65rem', fontWeight: 700, color: meta.color,
                            background: `${meta.color}18`, border: `1px solid ${meta.color}30`,
                            borderRadius: '100px', padding: '2px 8px',
                        }}>{meta.icon} {meta.label}</span>
                        <span style={{
                            fontSize: '0.65rem', fontWeight: 700, color: '#64748b',
                            background: 'rgba(255,255,255,0.05)', borderRadius: '4px', padding: '1px 6px',
                            fontFamily: 'var(--font-mono)',
                        }}>#{item.entity_id}</span>
                    </div>
                    <div style={{ fontSize: '0.8rem', color: '#94a3b8', marginTop: '0.3rem' }}>
                        {summary || <span style={{ fontStyle: 'italic', color: '#475569' }}>No summary available</span>}
                    </div>
                    {item.notes && item.notes !== item.edited_by && (
                        <div style={{ fontSize: '0.72rem', color: '#475569', marginTop: '2px' }}>“{item.notes}”</div>
                    )}
                </div>

                <div style={{ textAlign: 'right', flexShrink: 0 }}>
                    <div style={{ fontSize: '0.75rem', color: '#94a3b8', fontWeight: 600 }}>
                        {date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                    </div>
                    <div style={{ fontSize: '0.65rem', color: '#475569', fontFamily: 'var(--font-mono)', marginTop: '1px' }}>
                        {date.toLocaleDateString()}
                    </div>
                    {hasDetails && (
                        <button onClick={onToggle} style={{
                            background: 'none', border: 'none', cursor: 'pointer', color: '#60a5fa',
                            fontSize: '0.68rem', fontWeight: 700, marginTop: '4px',
                        }}>{expanded ? 'Hide details ▴' : 'Details ▾'}</button>
                    )}
                </div>
            </div>

            {expanded && batchLines && batchLines.length > 0 && (
                <div style={{ marginTop: '0.875rem', display: 'flex', flexDirection: 'column', gap: '0.375rem' }}>
                    {batchLines.map((line, i) => (
                        <div key={i} style={{
                            display: 'flex', alignItems: 'center', gap: '0.5rem',
                            padding: '0.45rem 0.75rem', borderRadius: '0.5rem',
                            background: line.type === 'offcut' ? 'rgba(6,182,212,0.06)' : 'rgba(34,197,94,0.06)',
                            border: `1px solid ${line.type === 'offcut' ? 'rgba(6,182,212,0.15)' : 'rgba(34,197,94,0.15)'}`,
                            fontSize: '0.75rem',
                        }}>
                            <span>{line.type === 'offcut' ? '✂️' : '📦'}</span>
                            <span style={{ color: '#cbd5e1' }}>{describeStockBatchLine(line)}</span>
                        </div>
                    ))}
                </div>
            )}

            {expanded && !batchLines && rows.length > 0 && (
                <div style={{ marginTop: '0.875rem', borderRadius: '0.625rem', overflow: 'hidden', border: '1px solid rgba(255,255,255,0.07)' }}>
                    <div className="table-scroll">
                    <table style={{ width: '100%', minWidth: '420px', borderCollapse: 'collapse', fontSize: '0.72rem' }}>
                        <thead>
                            <tr style={{ background: 'rgba(255,255,255,0.04)' }}>
                                <th style={{ textAlign: 'left', padding: '0.5rem 0.75rem', color: '#64748b', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em', fontSize: '0.62rem' }}>Field</th>
                                <th style={{ textAlign: 'left', padding: '0.5rem 0.75rem', color: '#64748b', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em', fontSize: '0.62rem' }}>Before</th>
                                <th style={{ textAlign: 'left', padding: '0.5rem 0.75rem', color: '#64748b', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em', fontSize: '0.62rem' }}>After</th>
                            </tr>
                        </thead>
                        <tbody>
                            {rows.map(r => (
                                <tr key={r.key} style={{ borderTop: '1px solid rgba(255,255,255,0.05)' }}>
                                    <td style={{ padding: '0.5rem 0.75rem', color: '#94a3b8', fontWeight: 600 }}>{r.key}</td>
                                    <td style={{ padding: '0.5rem 0.75rem', color: '#f87171', fontFamily: 'var(--font-mono)', wordBreak: 'break-word' }}>{r.before}</td>
                                    <td style={{ padding: '0.5rem 0.75rem', color: '#4ade80', fontFamily: 'var(--font-mono)', wordBreak: 'break-word' }}>{r.after}</td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                    </div>
                </div>
            )}
        </div>
    );
}

export default function ActivityLogPage() {
    const [users, setUsers] = useState([]);
    const [userId, setUserId] = useState('');
    const [entityType, setEntityType] = useState('');
    const [since, setSince] = useState('');
    const [until, setUntil] = useState('');
    const [query, setQuery] = useState('');
    const [rows, setRows] = useState([]);
    const [skip, setSkip] = useState(0);
    const [hasMore, setHasMore] = useState(false);
    const [loading, setLoading] = useState(false);
    const [expandedId, setExpandedId] = useState(null);

    useEffect(() => {
        api.userService.getAllUsers()
            .then(data => setUsers(data.filter(u => MANAGEABLE_ROLES.has(u.role))))
            .catch(() => {});
    }, []);

    const load = useCallback(async (nextSkip) => {
        setLoading(true);
        try {
            const data = await api.orderService.getAuditHistory(
                entityType || null, nextSkip, PAGE_SIZE + 1, userId || null, since || null, until || null
            );
            setHasMore(data.length > PAGE_SIZE);
            setRows(prev => nextSkip === 0 ? data.slice(0, PAGE_SIZE) : [...prev, ...data.slice(0, PAGE_SIZE)]);
            setSkip(nextSkip);
        } catch {
            /* toast handled globally by the api interceptor */
        } finally {
            setLoading(false);
        }
    }, [entityType, userId, since, until]);

    useEffect(() => { load(0); }, [load]);

    const visibleRows = useMemo(() => {
        if (!query.trim()) return rows;
        const q = query.toLowerCase();
        return rows.filter(r => {
            const meta = activityMetaForItem(r);
            const summary = summarizeActivity(r) || '';
            return meta.label.toLowerCase().includes(q)
                || r.edited_by.toLowerCase().includes(q)
                || String(r.entity_id).includes(q)
                || summary.toLowerCase().includes(q);
        });
    }, [rows, query]);

    const stats = useMemo(() => {
        if (rows.length === 0) return null;
        const uniqueUsers = new Set(rows.map(r => r.edited_by));
        const typeCounts = {};
        rows.forEach(r => { typeCounts[r.entity_type] = (typeCounts[r.entity_type] || 0) + 1; });
        const [topType, topCount] = Object.entries(typeCounts).sort((a, b) => b[1] - a[1])[0] || [];
        return {
            total: rows.length,
            users: uniqueUsers.size,
            topLabel: topType ? activityMeta(topType).label : '—',
            topCount,
        };
    }, [rows]);

    const groups = useMemo(() => groupByDate(visibleRows), [visibleRows]);
    const hasActiveFilters = userId || entityType || since || until || query;

    return (
        <div style={{ display: 'flex', flexDirection: 'column', height: '100%', background: 'var(--color-bg)', overflow: 'hidden' }}>
            <header style={{
                padding: 'clamp(1rem, 4vw, 1.25rem) clamp(1rem, 5vw, 2rem)', borderBottom: '1px solid rgba(255,255,255,0.07)',
                background: 'rgba(9,14,26,0.9)', backdropFilter: 'blur(20px)',
                display: 'flex', alignItems: 'center', gap: '1rem', flexShrink: 0, flexWrap: 'wrap',
                position: 'sticky', top: 0, zIndex: 20,
            }}>
                <div style={{
                    width: '40px', height: '40px', borderRadius: '10px',
                    background: 'linear-gradient(135deg, rgba(168,85,247,0.2), rgba(59,130,246,0.15))',
                    border: '1px solid rgba(168,85,247,0.3)',
                    display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '1.1rem',
                }}>🛡️</div>
                <div>
                    <h1 style={{ fontSize: '1.125rem', fontWeight: 800, color: '#f1f5f9', margin: 0 }}>Activity Log</h1>
                    <p style={{ fontSize: '0.72rem', color: '#475569', margin: 0, fontWeight: 500 }}>Oversight of every manager & cashier action in the system</p>
                </div>
            </header>

            <div style={{ flex: 1, overflowY: 'auto', padding: 'clamp(1rem, 4vw, 1.25rem) clamp(1rem, 5vw, 2rem) 2rem' }} className="custom-scrollbar">

                {/* Stats strip */}
                {stats && (
                    <div style={{ display: 'flex', gap: '0.875rem', marginBottom: '1.25rem', flexWrap: 'wrap' }}>
                        <StatCard label="Loaded Events" value={stats.total} color="#60a5fa" />
                        <StatCard label="Active People" value={stats.users} color="#4ade80" />
                        <StatCard label="Most Common" value={stats.topLabel} sub={`${stats.topCount} event${stats.topCount === 1 ? '' : 's'}`} color="#f59e0b" />
                    </div>
                )}

                {/* Filter toolbar */}
                <div style={{
                    display: 'flex', gap: '0.625rem', flexWrap: 'wrap', alignItems: 'center',
                    padding: '0.875rem 1rem', borderRadius: '0.875rem', marginBottom: '1.25rem',
                    background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.07)',
                }}>
                    <input type="text" placeholder="🔍 Search this page…" value={query} onChange={e => setQuery(e.target.value)}
                        style={{ ...fieldStyle, flex: '1 1 200px', minWidth: '160px' }} />
                    <select value={userId} onChange={e => setUserId(e.target.value)} style={fieldStyle}>
                        <option value="">All users</option>
                        {users.map(u => (
                            <option key={u.userId} value={u.userId}>{u.firstName} {u.secondName || ''} ({u.role})</option>
                        ))}
                    </select>
                    <select value={entityType} onChange={e => setEntityType(e.target.value)} style={fieldStyle}>
                        <option value="">All activity types</option>
                        {ENTITY_TYPES.map(t => (
                            <option key={t} value={t}>{activityMeta(t).label}</option>
                        ))}
                    </select>
                    <input type="date" value={since} onChange={e => setSince(e.target.value)} style={fieldStyle} />
                    <span style={{ color: '#475569', fontSize: '0.78rem' }}>to</span>
                    <input type="date" value={until} onChange={e => setUntil(e.target.value)} style={fieldStyle} />
                    {hasActiveFilters && (
                        <button onClick={() => { setUserId(''); setEntityType(''); setSince(''); setUntil(''); setQuery(''); }} style={{
                            background: 'none', border: 'none', cursor: 'pointer', color: '#60a5fa', fontSize: '0.78rem', fontWeight: 700,
                        }}>Clear filters</button>
                    )}
                </div>

                {/* Grouped list */}
                {groups.length === 0 && !loading ? (
                    <p style={{ fontSize: '0.85rem', color: '#334155', textAlign: 'center', marginTop: '3rem', fontStyle: 'italic' }}>No activity matches these filters</p>
                ) : groups.map(group => (
                    <div key={group.label} style={{ marginBottom: '1.5rem' }}>
                        <div style={{
                            display: 'flex', alignItems: 'center', gap: '0.625rem', marginBottom: '0.625rem',
                        }}>
                            <span style={{ fontSize: '0.72rem', fontWeight: 800, color: '#94a3b8', textTransform: 'uppercase', letterSpacing: '0.06em' }}>{group.label}</span>
                            <div style={{ flex: 1, height: '1px', background: 'rgba(255,255,255,0.07)' }} />
                            <span style={{ fontSize: '0.68rem', color: '#475569', fontWeight: 600 }}>{group.items.length} event{group.items.length === 1 ? '' : 's'}</span>
                        </div>
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                            {group.items.map(item => (
                                <ActivityRow
                                    key={item.id}
                                    item={item}
                                    expanded={expandedId === item.id}
                                    onToggle={() => setExpandedId(expandedId === item.id ? null : item.id)}
                                />
                            ))}
                        </div>
                    </div>
                ))}

                {hasMore && (
                    <button onClick={() => load(skip + PAGE_SIZE)} disabled={loading} style={{
                        display: 'block', margin: '0.5rem auto 0', padding: '0.625rem 1.5rem',
                        borderRadius: '0.75rem', border: '1px solid rgba(255,255,255,0.09)',
                        background: 'rgba(255,255,255,0.04)', color: '#94a3b8', fontWeight: 600, fontSize: '0.8rem',
                        cursor: loading ? 'not-allowed' : 'pointer',
                    }}>{loading ? 'Loading…' : 'Load more'}</button>
                )}
            </div>
        </div>
    );
}
