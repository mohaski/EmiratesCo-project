import { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { ToolService } from '../services/api';
import { useToast } from '../context/ToastContext';
import { wsEvents } from '../utils/wsEvents';
import { CheckoutTab, ReturnTab } from './ToolCheckoutPage';

const cardStyle = {
    background: 'rgba(255,255,255,0.03)',
    border: '1px solid rgba(255,255,255,0.07)',
    borderRadius: '1.25rem',
};

const inputStyle = {
    width: '100%',
    padding: '0.65rem 0.9rem',
    background: 'rgba(255,255,255,0.04)',
    border: '1px solid rgba(255,255,255,0.1)',
    borderRadius: '0.75rem',
    color: '#f1f5f9',
    fontSize: '0.85rem',
    outline: 'none',
};

const primaryBtn = (disabled) => ({
    padding: '0.65rem 1.25rem',
    borderRadius: '0.75rem',
    border: 'none',
    cursor: disabled ? 'not-allowed' : 'pointer',
    background: disabled ? 'rgba(59,130,246,0.15)' : 'linear-gradient(135deg, #3b82f6, #06b6d4)',
    color: disabled ? '#475569' : '#fff',
    fontWeight: 700,
    fontSize: '0.82rem',
});

const ghostBtn = {
    padding: '0.5rem 1rem',
    borderRadius: '0.6rem',
    background: 'rgba(255,255,255,0.05)',
    border: '1px solid rgba(255,255,255,0.09)',
    color: '#94a3b8',
    fontWeight: 600,
    fontSize: '0.78rem',
    cursor: 'pointer',
};

const STATUS_BADGE = {
    available:          { bg: 'rgba(34,197,94,0.12)',  border: 'rgba(34,197,94,0.25)',  text: '#4ade80' },
    taken:              { bg: 'rgba(245,158,11,0.12)', border: 'rgba(245,158,11,0.25)', text: '#fbbf24' },
    non_functional:     { bg: 'rgba(239,68,68,0.12)',  border: 'rgba(239,68,68,0.25)',  text: '#f87171' },
    out:                { bg: 'rgba(245,158,11,0.12)', border: 'rgba(245,158,11,0.25)', text: '#fbbf24' },
    partially_returned: { bg: 'rgba(59,130,246,0.12)', border: 'rgba(59,130,246,0.25)', text: '#60a5fa' },
    returned:           { bg: 'rgba(34,197,94,0.12)',  border: 'rgba(34,197,94,0.25)',  text: '#4ade80' },
};

const STATUS_LABEL = {
    available: 'Available', taken: 'Taken', non_functional: 'Non-Functional',
    out: 'Out', partially_returned: 'Partially Returned', returned: 'Returned',
};

function Badge({ status }) {
    const c = STATUS_BADGE[status] || STATUS_BADGE.available;
    return (
        <span style={{
            fontSize: '0.62rem', fontWeight: 700, padding: '2px 8px', borderRadius: '100px',
            background: c.bg, border: `1px solid ${c.border}`, color: c.text,
            letterSpacing: '0.05em', textTransform: 'uppercase', whiteSpace: 'nowrap',
        }}>
            {STATUS_LABEL[status] || status}
        </span>
    );
}

// ── Worker Loans Tab ─────────────────────────────────────────────────────────

function WorkerLoansTab() {
    const [loans, setLoans] = useState([]);
    const [loading, setLoading] = useState(true);
    const [statusFilter, setStatusFilter] = useState('');

    const fetchLoans = useCallback(async (status) => {
        setLoading(true);
        try {
            const data = await ToolService.getLoans({ status: status || undefined, limit: 200 });
            setLoans(data);
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => { fetchLoans(statusFilter); }, [fetchLoans, statusFilter]);
    useEffect(() => wsEvents.on('tools_updated', () => fetchLoans(statusFilter)), [fetchLoans, statusFilter]);

    return (
        <div style={{ padding: '1.75rem 2rem' }}>
            <div style={{ display: 'flex', gap: '0.5rem', marginBottom: '1.25rem', flexWrap: 'wrap' }}>
                {['', 'out', 'partially_returned', 'returned'].map(s => (
                    <button key={s || 'all'} onClick={() => setStatusFilter(s)} style={{
                        padding: '0.4rem 0.9rem', borderRadius: '100px', border: '1px solid rgba(255,255,255,0.09)',
                        background: statusFilter === s ? 'rgba(59,130,246,0.18)' : 'rgba(255,255,255,0.03)',
                        color: statusFilter === s ? '#60a5fa' : '#64748b',
                        fontSize: '0.75rem', fontWeight: 600, cursor: 'pointer',
                    }}>
                        {s ? STATUS_LABEL[s] : 'All'}
                    </button>
                ))}
            </div>

            <div style={{ ...cardStyle, overflow: 'hidden' }}>
                <div className="table-scroll">
                <table style={{ width: '100%', borderCollapse: 'separate', borderSpacing: 0 }}>
                    <thead>
                        <tr>
                            {['Worker', 'Tools', 'Issued By', 'Issued At', 'Status'].map(h => (
                                <th key={h} style={{ fontSize: '0.65rem', fontWeight: 700, color: '#334155', letterSpacing: '0.1em', textTransform: 'uppercase', padding: '0.9rem 1rem', textAlign: 'left', borderBottom: '1px solid rgba(255,255,255,0.06)' }}>
                                    {h}
                                </th>
                            ))}
                        </tr>
                    </thead>
                    <tbody>
                        {loading ? (
                            <tr><td colSpan={5} style={{ padding: '1.5rem', color: '#475569', fontSize: '0.82rem' }}>Loading…</td></tr>
                        ) : loans.length === 0 ? (
                            <tr><td colSpan={5} style={{ padding: '1.5rem', color: '#475569', fontSize: '0.82rem' }}>No tool loans found.</td></tr>
                        ) : loans.map(loan => (
                            <tr key={loan.loanId}>
                                <td style={{ padding: '0.9rem 1rem', fontSize: '0.85rem', fontWeight: 700, color: '#e2e8f0' }}>{loan.workerName}</td>
                                <td style={{ padding: '0.9rem 1rem', fontSize: '0.8rem', color: '#94a3b8' }}>
                                    {loan.items.map(i => (
                                        <span key={i.itemId} style={{ display: 'inline-flex', alignItems: 'center', gap: '4px', marginRight: '0.6rem' }}>
                                            {i.toolName}{i.returned && <span style={{ color: '#4ade80', fontSize: '0.65rem' }}>✓</span>}
                                        </span>
                                    ))}
                                </td>
                                <td style={{ padding: '0.9rem 1rem', fontSize: '0.78rem', color: '#64748b' }}>{loan.issued_by || '—'}</td>
                                <td style={{ padding: '0.9rem 1rem', fontSize: '0.78rem', color: '#64748b', fontFamily: 'var(--font-mono)' }}>
                                    {new Date(loan.issued_at).toLocaleString()}
                                </td>
                                <td style={{ padding: '0.9rem 1rem' }}><Badge status={loan.status} /></td>
                            </tr>
                        ))}
                    </tbody>
                </table>
                </div>
            </div>
        </div>
    );
}

// ── Tool Catalog Tab ─────────────────────────────────────────────────────────

function AddToolForm({ onAdded }) {
    const showToast = useToast();
    const [name, setName] = useState('');
    const [description, setDescription] = useState('');
    const [submitting, setSubmitting] = useState(false);

    const handleSubmit = async (e) => {
        e.preventDefault();
        if (!name.trim()) return;
        setSubmitting(true);
        try {
            await ToolService.create({ name: name.trim(), description: description.trim() || null });
            showToast(`"${name.trim()}" added to catalog`, 'success');
            setName('');
            setDescription('');
            onAdded();
        } catch {
            /* the axios response interceptor already surfaces the error toast */
        } finally {
            setSubmitting(false);
        }
    };

    return (
        <form onSubmit={handleSubmit} style={{ ...cardStyle, padding: '1.25rem 1.5rem', display: 'flex', gap: '0.75rem', alignItems: 'flex-end', flexWrap: 'wrap', marginBottom: '1.25rem' }}>
            <div style={{ flex: '1 1 200px' }}>
                <div style={{ fontSize: '0.68rem', fontWeight: 700, color: '#475569', letterSpacing: '0.06em', textTransform: 'uppercase', marginBottom: '0.4rem' }}>Tool Name</div>
                <input style={inputStyle} value={name} onChange={e => setName(e.target.value)} placeholder="e.g. Cordless Drill" />
            </div>
            <div style={{ flex: '2 1 260px' }}>
                <div style={{ fontSize: '0.68rem', fontWeight: 700, color: '#475569', letterSpacing: '0.06em', textTransform: 'uppercase', marginBottom: '0.4rem' }}>Description (optional)</div>
                <input style={inputStyle} value={description} onChange={e => setDescription(e.target.value)} placeholder="Any known issues" />
            </div>
            <button type="submit" style={primaryBtn(submitting || !name.trim())} disabled={submitting || !name.trim()}>
                {submitting ? 'Adding…' : '+ Add Tool'}
            </button>
        </form>
    );
}

function EditToolRow({ tool, onSaved }) {
    const showToast = useToast();
    const [editing, setEditing] = useState(false);
    const [name, setName] = useState(tool.name);
    const [description, setDescription] = useState(tool.description || '');
    const [status, setStatus] = useState(tool.status);
    const [saving, setSaving] = useState(false);

    const handleSave = async () => {
        setSaving(true);
        try {
            await ToolService.update(tool.toolId, { name, description: description || null, status });
            showToast(`"${name}" updated`, 'success');
            setEditing(false);
            onSaved();
        } catch {
            /* the axios response interceptor already surfaces the error toast */
        } finally {
            setSaving(false);
        }
    };

    if (!editing) {
        return (
            <tr>
                <td style={{ padding: '0.9rem 1rem', fontSize: '0.85rem', fontWeight: 700, color: '#e2e8f0' }}>{tool.name}</td>
                <td style={{ padding: '0.9rem 1rem', fontSize: '0.8rem', color: '#94a3b8' }}>{tool.description || '—'}</td>
                <td style={{ padding: '0.9rem 1rem' }}><Badge status={tool.status} /></td>
                <td style={{ padding: '0.9rem 1rem' }}>
                    <button style={ghostBtn} onClick={() => setEditing(true)}>Edit</button>
                </td>
            </tr>
        );
    }

    return (
        <tr>
            <td style={{ padding: '0.6rem 1rem' }}><input style={inputStyle} value={name} onChange={e => setName(e.target.value)} /></td>
            <td style={{ padding: '0.6rem 1rem' }}><input style={inputStyle} value={description} onChange={e => setDescription(e.target.value)} /></td>
            <td style={{ padding: '0.6rem 1rem' }}>
                <select style={inputStyle} value={status} onChange={e => setStatus(e.target.value)} disabled={tool.status === 'taken'}>
                    <option value="available">Available</option>
                    <option value="non_functional">Non-Functional</option>
                    {tool.status === 'taken' && <option value="taken">Taken</option>}
                </select>
            </td>
            <td style={{ padding: '0.6rem 1rem', display: 'flex', gap: '0.4rem' }}>
                <button style={primaryBtn(saving)} disabled={saving} onClick={handleSave}>{saving ? 'Saving…' : 'Save'}</button>
                <button style={ghostBtn} onClick={() => setEditing(false)}>Cancel</button>
            </td>
        </tr>
    );
}

function ToolCatalogTab() {
    const [tools, setTools] = useState([]);
    const [loading, setLoading] = useState(true);

    const fetchTools = useCallback(async () => {
        setLoading(true);
        try {
            const data = await ToolService.getAll();
            setTools(data);
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => { fetchTools(); }, [fetchTools]);
    useEffect(() => wsEvents.on('tools_updated', fetchTools), [fetchTools]);

    return (
        <div style={{ padding: '1.75rem 2rem' }}>
            <AddToolForm onAdded={fetchTools} />
            <div style={{ ...cardStyle, overflow: 'hidden' }}>
                <div className="table-scroll">
                <table style={{ width: '100%', borderCollapse: 'separate', borderSpacing: 0 }}>
                    <thead>
                        <tr>
                            {['Name', 'Description', 'Status', ''].map(h => (
                                <th key={h} style={{ fontSize: '0.65rem', fontWeight: 700, color: '#334155', letterSpacing: '0.1em', textTransform: 'uppercase', padding: '0.9rem 1rem', textAlign: 'left', borderBottom: '1px solid rgba(255,255,255,0.06)' }}>
                                    {h}
                                </th>
                            ))}
                        </tr>
                    </thead>
                    <tbody>
                        {loading ? (
                            <tr><td colSpan={4} style={{ padding: '1.5rem', color: '#475569', fontSize: '0.82rem' }}>Loading…</td></tr>
                        ) : tools.length === 0 ? (
                            <tr><td colSpan={4} style={{ padding: '1.5rem', color: '#475569', fontSize: '0.82rem' }}>No tools in the catalog yet.</td></tr>
                        ) : tools.map(tool => (
                            <EditToolRow key={tool.toolId} tool={tool} onSaved={fetchTools} />
                        ))}
                    </tbody>
                </table>
                </div>
            </div>
        </div>
    );
}

const TABS = [
    ['loans', 'Worker Loans'],
    ['checkout', 'Check Out'],
    ['return', 'Return Tools'],
    ['catalog', 'Tool Catalog'],
];

const TAB_CONTENT = {
    loans: WorkerLoansTab,
    checkout: CheckoutTab,
    return: ReturnTab,
    catalog: ToolCatalogTab,
};

export default function ManagerToolsPage() {
    const [tab, setTab] = useState('loans');
    const navigate = useNavigate();
    const ActiveTab = TAB_CONTENT[tab];

    return (
        <div style={{ minHeight: '100%', background: 'var(--color-bg)', color: 'var(--color-text)' }}>
            <div style={{
                padding: '1.5rem 2rem', borderBottom: '1px solid rgba(255,255,255,0.07)',
                background: 'rgba(9,14,26,0.8)', backdropFilter: 'blur(20px)',
                position: 'sticky', top: 0, zIndex: 20,
            }}>
                <button onClick={() => navigate('/')} style={{
                    background: 'none', border: 'none', cursor: 'pointer', color: '#475569',
                    fontSize: '0.78rem', fontWeight: 600, marginBottom: '0.75rem', padding: 0,
                }}>← Back to Dashboard</button>
                <h1 style={{ fontSize: '1.375rem', fontWeight: 800, color: '#f1f5f9', margin: '0 0 1rem', letterSpacing: '-0.025em' }}>
                    🧰 Tool Tracking
                </h1>
                <div className="scrollbar-hide" style={{ display: 'flex', gap: '0.5rem', background: 'rgba(255,255,255,0.04)', borderRadius: '0.75rem', padding: '4px', width: 'fit-content', maxWidth: '100%', overflowX: 'auto' }}>
                    {TABS.map(([key, label]) => (
                        <button key={key} onClick={() => setTab(key)} style={{
                            padding: '0.5rem 1.25rem', borderRadius: '0.55rem', border: 'none', cursor: 'pointer',
                            fontSize: '0.8rem', fontWeight: 700, whiteSpace: 'nowrap', flexShrink: 0,
                            background: tab === key ? 'rgba(59,130,246,0.2)' : 'transparent',
                            color: tab === key ? '#60a5fa' : '#64748b',
                        }}>{label}</button>
                    ))}
                </div>
            </div>
            <ActiveTab />
        </div>
    );
}
