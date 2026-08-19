import { useState, useEffect, useMemo, useCallback } from 'react';
import { ToolService } from '../services/api';
import { useToast } from '../context/ToastContext';
import { wsEvents } from '../utils/wsEvents';

const cardStyle = {
    background: 'rgba(255,255,255,0.03)',
    border: '1px solid rgba(255,255,255,0.07)',
    borderRadius: '1.25rem',
};

const inputStyle = {
    width: '100%',
    padding: '0.7rem 0.9rem',
    background: 'rgba(255,255,255,0.04)',
    border: '1px solid rgba(255,255,255,0.1)',
    borderRadius: '0.75rem',
    color: '#f1f5f9',
    fontSize: '0.875rem',
    outline: 'none',
};

const primaryBtn = (disabled) => ({
    padding: '0.7rem 1.5rem',
    borderRadius: '0.75rem',
    border: 'none',
    cursor: disabled ? 'not-allowed' : 'pointer',
    background: disabled ? 'rgba(59,130,246,0.15)' : 'linear-gradient(135deg, #3b82f6, #06b6d4)',
    color: disabled ? '#475569' : '#fff',
    fontWeight: 700,
    fontSize: '0.85rem',
    boxShadow: disabled ? 'none' : '0 4px 16px rgba(59,130,246,0.3)',
    transition: 'all 0.15s',
});

const ghostBtn = {
    padding: '0.7rem 1.25rem',
    borderRadius: '0.75rem',
    background: 'rgba(255,255,255,0.05)',
    border: '1px solid rgba(255,255,255,0.09)',
    color: '#94a3b8',
    fontWeight: 600,
    fontSize: '0.85rem',
    cursor: 'pointer',
};

const STATUS_BADGE = {
    available:      { bg: 'rgba(34,197,94,0.12)',  border: 'rgba(34,197,94,0.25)',  text: '#4ade80' },
    taken:          { bg: 'rgba(245,158,11,0.12)', border: 'rgba(245,158,11,0.25)', text: '#fbbf24' },
    non_functional: { bg: 'rgba(239,68,68,0.12)',  border: 'rgba(239,68,68,0.25)',  text: '#f87171' },
    out:                { bg: 'rgba(245,158,11,0.12)', border: 'rgba(245,158,11,0.25)', text: '#fbbf24' },
    partially_returned: { bg: 'rgba(59,130,246,0.12)',  border: 'rgba(59,130,246,0.25)',  text: '#60a5fa' },
    returned:           { bg: 'rgba(34,197,94,0.12)',   border: 'rgba(34,197,94,0.25)',  text: '#4ade80' },
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

function PageHeader({ tab, setTab }) {
    return (
        <div style={{
            padding: '1.5rem 2rem', borderBottom: '1px solid rgba(255,255,255,0.07)',
            background: 'rgba(9,14,26,0.8)', backdropFilter: 'blur(20px)',
            position: 'sticky', top: 0, zIndex: 20,
        }}>
            <h1 style={{ fontSize: '1.375rem', fontWeight: 800, color: '#f1f5f9', margin: '0 0 1rem', letterSpacing: '-0.025em' }}>
                🔧 Tool Checkout
            </h1>
            <div style={{ display: 'flex', gap: '0.5rem', background: 'rgba(255,255,255,0.04)', borderRadius: '0.75rem', padding: '4px', width: 'fit-content' }}>
                {[['checkout', 'Check Out'], ['return', 'Return Tools']].map(([key, label]) => (
                    <button key={key} onClick={() => setTab(key)} style={{
                        padding: '0.5rem 1.25rem', borderRadius: '0.55rem', border: 'none', cursor: 'pointer',
                        fontSize: '0.8rem', fontWeight: 700,
                        background: tab === key ? 'rgba(59,130,246,0.2)' : 'transparent',
                        color: tab === key ? '#60a5fa' : '#64748b',
                        transition: 'all 0.15s',
                    }}>{label}</button>
                ))}
            </div>
        </div>
    );
}

// ── Check Out Tab ────────────────────────────────────────────────────────────

export function CheckoutTab() {
    const showToast = useToast();
    const [tools, setTools] = useState([]);
    const [loading, setLoading] = useState(true);
    const [workerName, setWorkerName] = useState('');
    const [selectedIds, setSelectedIds] = useState([]);
    const [notes, setNotes] = useState('');
    const [step, setStep] = useState('select'); // select | review
    const [submitting, setSubmitting] = useState(false);

    const fetchTools = useCallback(async () => {
        setLoading(true);
        try {
            const data = await ToolService.getAll('available');
            setTools(data);
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => { fetchTools(); }, [fetchTools]);
    useEffect(() => wsEvents.on('tools_updated', fetchTools), [fetchTools]);

    const selectedTools = useMemo(
        () => tools.filter(t => selectedIds.includes(t.toolId)),
        [tools, selectedIds]
    );

    const toggleTool = (toolId) => {
        setSelectedIds(prev => prev.includes(toolId) ? prev.filter(id => id !== toolId) : [...prev, toolId]);
    };

    const canReview = workerName.trim().length > 0 && selectedIds.length > 0;

    const resetForm = () => {
        setWorkerName('');
        setSelectedIds([]);
        setNotes('');
        setStep('select');
    };

    const handleConfirm = async () => {
        setSubmitting(true);
        try {
            await ToolService.createLoan({ workerName: workerName.trim(), toolIds: selectedIds, notes: notes || null });
            showToast(`${selectedIds.length} tool(s) checked out to ${workerName.trim()}`, 'success');
            resetForm();
            fetchTools();
        } catch {
            /* the axios response interceptor already surfaces the error toast */
        } finally {
            setSubmitting(false);
        }
    };

    if (step === 'review') {
        return (
            <div style={{ padding: '1.75rem 2rem', maxWidth: '640px' }}>
                <div style={{ ...cardStyle, padding: '1.5rem' }}>
                    <h3 style={{ fontSize: '0.68rem', fontWeight: 700, color: '#475569', letterSpacing: '0.1em', textTransform: 'uppercase', margin: '0 0 1rem' }}>
                        Review Checkout
                    </h3>
                    <div style={{ marginBottom: '1.25rem' }}>
                        <div style={{ fontSize: '0.7rem', color: '#475569', marginBottom: '0.25rem' }}>Worker</div>
                        <div style={{ fontSize: '1.1rem', fontWeight: 800, color: '#f1f5f9' }}>{workerName}</div>
                    </div>
                    <div style={{ fontSize: '0.7rem', color: '#475569', marginBottom: '0.5rem' }}>
                        Tools ({selectedTools.length})
                    </div>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem', marginBottom: '1.5rem' }}>
                        {selectedTools.map(t => (
                            <div key={t.toolId} style={{
                                display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                                padding: '0.7rem 0.9rem', background: 'rgba(255,255,255,0.03)',
                                border: '1px solid rgba(255,255,255,0.06)', borderRadius: '0.65rem',
                            }}>
                                <span style={{ fontSize: '0.85rem', fontWeight: 600, color: '#e2e8f0' }}>{t.name}</span>
                                {t.description && <span style={{ fontSize: '0.72rem', color: '#64748b' }}>{t.description}</span>}
                            </div>
                        ))}
                    </div>
                    <div style={{ display: 'flex', gap: '0.75rem', justifyContent: 'flex-end' }}>
                        <button style={ghostBtn} onClick={() => setStep('select')} disabled={submitting}>← Back</button>
                        <button style={primaryBtn(submitting)} onClick={handleConfirm} disabled={submitting}>
                            {submitting ? 'Issuing…' : 'Confirm & Issue'}
                        </button>
                    </div>
                </div>
            </div>
        );
    }

    return (
        <>
            <style>{`
                @media (max-width: 767px) {
                    .tool-checkout-grid { grid-template-columns: minmax(0, 1fr) !important; padding: 1.25rem 1rem !important; }
                }
            `}</style>
            <div className="tool-checkout-grid" style={{ padding: '1.75rem 2rem', display: 'grid', gridTemplateColumns: 'minmax(0,1fr) 320px', gap: '1.5rem', alignItems: 'start' }}>
            {/* Tool picker */}
            <div style={{ ...cardStyle, padding: '1.5rem' }}>
                <h3 style={{ fontSize: '0.68rem', fontWeight: 700, color: '#475569', letterSpacing: '0.1em', textTransform: 'uppercase', margin: '0 0 1rem' }}>
                    Available Tools
                </h3>
                {loading ? (
                    <p style={{ color: '#475569', fontSize: '0.82rem' }}>Loading…</p>
                ) : tools.length === 0 ? (
                    <p style={{ color: '#475569', fontSize: '0.82rem' }}>No tools are currently available.</p>
                ) : (
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))', gap: '0.75rem' }}>
                        {tools.map(t => {
                            const checked = selectedIds.includes(t.toolId);
                            return (
                                <button key={t.toolId} onClick={() => toggleTool(t.toolId)} style={{
                                    textAlign: 'left', padding: '0.9rem 1rem', borderRadius: '0.85rem', cursor: 'pointer',
                                    background: checked ? 'rgba(59,130,246,0.12)' : 'rgba(255,255,255,0.02)',
                                    border: `1px solid ${checked ? 'rgba(59,130,246,0.4)' : 'rgba(255,255,255,0.07)'}`,
                                    transition: 'all 0.15s',
                                }}>
                                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '0.5rem' }}>
                                        <span style={{ fontSize: '0.875rem', fontWeight: 700, color: '#f1f5f9' }}>{t.name}</span>
                                        <span style={{
                                            width: '18px', height: '18px', borderRadius: '5px', flexShrink: 0,
                                            border: `1px solid ${checked ? '#3b82f6' : 'rgba(255,255,255,0.2)'}`,
                                            background: checked ? '#3b82f6' : 'transparent',
                                            display: 'flex', alignItems: 'center', justifyContent: 'center',
                                            fontSize: '0.65rem', color: '#fff',
                                        }}>{checked ? '✓' : ''}</span>
                                    </div>
                                    {t.description && (
                                        <div style={{ fontSize: '0.72rem', color: '#64748b', marginTop: '0.35rem' }}>{t.description}</div>
                                    )}
                                </button>
                            );
                        })}
                    </div>
                )}
            </div>

            {/* Worker + selection summary */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
                <div style={{ ...cardStyle, padding: '1.25rem 1.5rem' }}>
                    <h3 style={{ fontSize: '0.68rem', fontWeight: 700, color: '#475569', letterSpacing: '0.1em', textTransform: 'uppercase', margin: '0 0 0.75rem' }}>
                        Worker
                    </h3>
                    <input
                        style={inputStyle}
                        placeholder="Worker's name"
                        value={workerName}
                        onChange={e => setWorkerName(e.target.value)}
                    />
                    <textarea
                        style={{ ...inputStyle, marginTop: '0.75rem', minHeight: '70px', resize: 'vertical', fontFamily: 'inherit' }}
                        placeholder="Notes (optional)"
                        value={notes}
                        onChange={e => setNotes(e.target.value)}
                    />
                </div>

                <div style={{ ...cardStyle, padding: '1.25rem 1.5rem' }}>
                    <h3 style={{ fontSize: '0.68rem', fontWeight: 700, color: '#475569', letterSpacing: '0.1em', textTransform: 'uppercase', margin: '0 0 0.75rem' }}>
                        Selected ({selectedTools.length})
                    </h3>
                    {selectedTools.length === 0 ? (
                        <p style={{ fontSize: '0.8rem', color: '#334155' }}>No tools selected yet.</p>
                    ) : (
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.4rem', marginBottom: '1rem' }}>
                            {selectedTools.map(t => (
                                <div key={t.toolId} style={{ fontSize: '0.8rem', color: '#cbd5e1', display: 'flex', justifyContent: 'space-between' }}>
                                    <span>{t.name}</span>
                                    <span onClick={() => toggleTool(t.toolId)} style={{ color: '#f87171', cursor: 'pointer' }}>Remove</span>
                                </div>
                            ))}
                        </div>
                    )}
                    <button style={primaryBtn(!canReview)} disabled={!canReview} onClick={() => setStep('review')}>
                        Review Checkout →
                    </button>
                </div>
            </div>
            </div>
        </>
    );
}

// ── Return Tab ───────────────────────────────────────────────────────────────

export function ReturnTab() {
    const showToast = useToast();
    const [query, setQuery] = useState('');
    const [loans, setLoans] = useState([]);
    const [loading, setLoading] = useState(false);
    const [selectedLoan, setSelectedLoan] = useState(null);
    const [returnState, setReturnState] = useState({}); // { [toolId]: { checked, defectNote, markNonFunctional } }
    const [submitting, setSubmitting] = useState(false);

    const fetchLoans = useCallback(async (worker) => {
        setLoading(true);
        try {
            const data = await ToolService.getLoans({ worker: worker || undefined, limit: 50 });
            setLoans(data.filter(l => l.status !== 'returned'));
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => { fetchLoans(''); }, [fetchLoans]);
    useEffect(() => wsEvents.on('tools_updated', () => fetchLoans(query)), [fetchLoans, query]);

    const handleSearch = (e) => {
        e.preventDefault();
        fetchLoans(query);
    };

    const openLoan = (loan) => {
        setSelectedLoan(loan);
        const initial = {};
        loan.items.filter(i => !i.returned).forEach(i => {
            initial[i.toolId] = { checked: false, defectNote: '', markNonFunctional: false };
        });
        setReturnState(initial);
    };

    const updateItem = (toolId, patch) => {
        setReturnState(prev => ({ ...prev, [toolId]: { ...prev[toolId], ...patch } }));
    };

    const hasSelection = Object.values(returnState).some(v => v.checked);

    const handleSubmit = async () => {
        const items = Object.entries(returnState)
            .filter(([, v]) => v.checked)
            .map(([toolId, v]) => ({
                toolId: Number(toolId),
                defectNote: v.defectNote?.trim() || null,
                markNonFunctional: v.markNonFunctional,
            }));
        if (items.length === 0) return;

        setSubmitting(true);
        try {
            await ToolService.returnLoan(selectedLoan.loanId, { items });
            showToast(`${items.length} tool(s) returned for ${selectedLoan.workerName}`, 'success');
            setSelectedLoan(null);
            setReturnState({});
            fetchLoans(query);
        } catch {
            /* the axios response interceptor already surfaces the error toast */
        } finally {
            setSubmitting(false);
        }
    };

    if (selectedLoan) {
        const openItems = selectedLoan.items.filter(i => !i.returned);
        return (
            <div style={{ padding: '1.75rem 2rem', maxWidth: '720px' }}>
                <button onClick={() => setSelectedLoan(null)} style={{
                    background: 'none', border: 'none', cursor: 'pointer', color: '#475569',
                    fontSize: '0.78rem', fontWeight: 600, marginBottom: '1rem', padding: 0,
                }}>← Back to open loans</button>

                <div style={{ ...cardStyle, padding: '1.5rem' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.25rem', flexWrap: 'wrap', gap: '0.5rem' }}>
                        <div>
                            <div style={{ fontSize: '1.1rem', fontWeight: 800, color: '#f1f5f9' }}>{selectedLoan.workerName}</div>
                            <div style={{ fontSize: '0.75rem', color: '#475569' }}>Issued {new Date(selectedLoan.issued_at).toLocaleString()}</div>
                        </div>
                        <Badge status={selectedLoan.status} />
                    </div>

                    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem', marginBottom: '1.5rem' }}>
                        {openItems.map(item => {
                            const state = returnState[item.toolId] || {};
                            return (
                                <div key={item.itemId} style={{
                                    padding: '1rem', borderRadius: '0.85rem',
                                    background: state.checked ? 'rgba(34,197,94,0.06)' : 'rgba(255,255,255,0.02)',
                                    border: `1px solid ${state.checked ? 'rgba(34,197,94,0.25)' : 'rgba(255,255,255,0.07)'}`,
                                }}>
                                    <label style={{ display: 'flex', alignItems: 'center', gap: '0.65rem', cursor: 'pointer' }}>
                                        <input type="checkbox" checked={!!state.checked}
                                            onChange={e => updateItem(item.toolId, { checked: e.target.checked })} />
                                        <span style={{ fontSize: '0.9rem', fontWeight: 700, color: '#f1f5f9' }}>{item.toolName}</span>
                                    </label>
                                    {state.checked && (
                                        <div style={{ marginTop: '0.75rem', display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                                            <input
                                                style={inputStyle}
                                                placeholder="New defect note (optional)"
                                                value={state.defectNote || ''}
                                                onChange={e => updateItem(item.toolId, { defectNote: e.target.value })}
                                            />
                                            <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', fontSize: '0.78rem', color: '#f87171', cursor: 'pointer' }}>
                                                <input type="checkbox" checked={!!state.markNonFunctional}
                                                    onChange={e => updateItem(item.toolId, { markNonFunctional: e.target.checked })} />
                                                Mark as non-functional (won't be available for checkout)
                                            </label>
                                        </div>
                                    )}
                                </div>
                            );
                        })}
                    </div>

                    <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
                        <button style={primaryBtn(!hasSelection || submitting)} disabled={!hasSelection || submitting} onClick={handleSubmit}>
                            {submitting ? 'Processing…' : 'Process Return'}
                        </button>
                    </div>
                </div>
            </div>
        );
    }

    return (
        <div style={{ padding: '1.75rem 2rem', maxWidth: '820px' }}>
            <form onSubmit={handleSearch} style={{ display: 'flex', gap: '0.75rem', marginBottom: '1.25rem', flexWrap: 'wrap' }}>
                <input
                    style={{ ...inputStyle, flex: '1 1 200px', minWidth: 0, width: 'auto' }}
                    placeholder="Search by worker name…"
                    value={query}
                    onChange={e => setQuery(e.target.value)}
                />
                <button type="submit" style={ghostBtn}>Search</button>
            </form>

            <div style={{ ...cardStyle, padding: '0.5rem 0' }}>
                {loading ? (
                    <p style={{ color: '#475569', fontSize: '0.82rem', padding: '1.5rem' }}>Loading…</p>
                ) : loans.length === 0 ? (
                    <p style={{ color: '#475569', fontSize: '0.82rem', padding: '1.5rem' }}>No open tool loans found.</p>
                ) : (
                    loans.map(loan => (
                        <button key={loan.loanId} onClick={() => openLoan(loan)} style={{
                            display: 'flex', justifyContent: 'space-between', alignItems: 'center', width: '100%',
                            padding: '1rem 1.5rem', background: 'transparent', border: 'none', borderBottom: '1px solid rgba(255,255,255,0.05)',
                            cursor: 'pointer', textAlign: 'left', flexWrap: 'wrap', gap: '0.5rem',
                        }}>
                            <div>
                                <div style={{ fontSize: '0.9rem', fontWeight: 700, color: '#e2e8f0' }}>{loan.workerName}</div>
                                <div style={{ fontSize: '0.75rem', color: '#475569' }}>
                                    {loan.items.length} tool(s) — {loan.items.filter(i => !i.returned).length} still out
                                </div>
                            </div>
                            <Badge status={loan.status} />
                        </button>
                    ))
                )}
            </div>
        </div>
    );
}

export default function ToolCheckoutPage() {
    const [tab, setTab] = useState('checkout');

    return (
        <div style={{ minHeight: '100%', background: 'var(--color-bg)', color: 'var(--color-text)' }}>
            <PageHeader tab={tab} setTab={setTab} />
            {tab === 'checkout' ? <CheckoutTab /> : <ReturnTab />}
        </div>
    );
}
