import { useCallback, useEffect, useState } from 'react';
import api from '../../services/api';
import { CutQuestions } from './ResolveCutsModal';
import { answersComplete, answersPayload } from '../../utils/cutAnswers';

/**
 * Every recorded change to an order, and the two ways to fix a mistaken one (managers, CEO):
 *
 *   Undo               reverses the change exactly - stock, offcuts, items, totals - using the
 *                      operation journal. Money that changed hands stays recorded.
 *   Correct answers    for an edit/cancel whose cut questions were answered wrongly: undoes it
 *                      and runs it again with the corrected answers, in one step. The result is
 *                      what the right answers would have given in the first place.
 *
 * Both show exactly what will happen before anything is written, and are refused - with the
 * reason - when an exact reversal isn't possible (e.g. a piece the change returned has since
 * been cut for another order).
 */

const KIND_LABEL = {
    sale: 'Sale', edit: 'Edit', cancel: 'Cancellation', undo: 'Undo', cut_correction: 'Cutting correction',
    cutting_report: 'Cutting reported', status_change: 'Status change',
};

const box = {
    background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.07)', borderRadius: '0.875rem',
};
const btn = (color) => ({
    padding: '0.4rem 0.75rem', borderRadius: '0.625rem', border: `1px solid ${color}55`, background: `${color}1a`,
    color, fontSize: '0.72rem', fontWeight: 700, cursor: 'pointer',
});
const input = {
    width: '100%', boxSizing: 'border-box', background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.12)',
    borderRadius: '0.625rem', padding: '0.55rem 0.7rem', color: '#e2e8f0', fontSize: '0.82rem', outline: 'none',
};

const fmtWhen = (iso) => {
    try { return new Date(iso).toLocaleString(); } catch { return iso; }
};

const errorText = (err) => {
    const d = err?.response?.data?.detail;
    if (!d) return 'Something went wrong. Please try again.';
    if (typeof d === 'string') return d;
    return [d.message, ...(d.reasons || [])].filter(Boolean).join(' ');
};

function Effects({ preview }) {
    if (!preview) return null;
    if (!preview.undoable) {
        return (
            <div data-testid="undo-refused" style={{ ...box, padding: '0.75rem', borderColor: 'rgba(239,68,68,0.35)', background: 'rgba(239,68,68,0.07)' }}>
                <p style={{ margin: '0 0 0.375rem', fontSize: '0.78rem', fontWeight: 800, color: '#f87171' }}>This can't be undone exactly</p>
                {preview.reasons.map((r, i) => <p key={i} style={{ margin: '0.2rem 0', fontSize: '0.74rem', color: '#fca5a5' }}>• {r}</p>)}
            </div>
        );
    }
    const empty = !preview.lines.length && !preview.items_added.length && !preview.items_removed.length;
    return (
        <div data-testid="undo-effects" style={{ ...box, padding: '0.75rem' }}>
            <p style={{ margin: '0 0 0.375rem', fontSize: '0.72rem', fontWeight: 800, color: '#94a3b8' }}>WHAT WILL HAPPEN</p>
            {empty && <p style={{ margin: 0, fontSize: '0.76rem', color: '#64748b' }}>No stock or offcut changes.</p>}
            {preview.lines.map((l, i) => <p key={i} style={{ margin: '0.15rem 0', fontSize: '0.76rem', color: '#e2e8f0' }}>• {l}</p>)}
            {preview.items_removed.length > 0 && <p style={{ margin: '0.15rem 0', fontSize: '0.76rem', color: '#e2e8f0' }}>• Items restored: {preview.items_removed.join(', ')}</p>}
            {preview.items_added.length > 0 && <p style={{ margin: '0.15rem 0', fontSize: '0.76rem', color: '#e2e8f0' }}>• Items rebuilt: {preview.items_added.join(', ')}</p>}
            {preview.money_note && <p style={{ margin: '0.375rem 0 0', fontSize: '0.74rem', color: '#fbbf24' }}>{preview.money_note}</p>}
        </div>
    );
}

function Shell({ title, children, onClose, footer }) {
    return (
        <div style={{ position: 'fixed', inset: 0, zIndex: 80, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '1rem', background: 'rgba(9,14,26,0.85)', backdropFilter: 'blur(12px)' }} onClick={onClose}>
            <div onClick={e => e.stopPropagation()} style={{ width: '100%', maxWidth: '540px', maxHeight: '90vh', display: 'flex', flexDirection: 'column', background: 'linear-gradient(145deg, rgba(13,20,38,0.99), rgba(9,14,26,0.99))', border: '1px solid rgba(96,165,250,0.25)', borderRadius: '1.25rem', overflow: 'hidden' }}>
                <div style={{ padding: '1rem 1.25rem', borderBottom: '1px solid rgba(255,255,255,0.07)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <h2 style={{ margin: 0, fontSize: '0.95rem', fontWeight: 800, color: '#f1f5f9' }}>{title}</h2>
                    <button onClick={onClose} style={{ width: 28, height: 28, borderRadius: 8, border: '1px solid rgba(255,255,255,0.1)', background: 'rgba(255,255,255,0.05)', color: '#64748b', cursor: 'pointer' }}>✕</button>
                </div>
                <div style={{ padding: '1rem 1.25rem', overflowY: 'auto', flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>{children}</div>
                {footer && <div style={{ padding: '0.875rem 1.25rem', borderTop: '1px solid rgba(255,255,255,0.07)' }}>{footer}</div>}
            </div>
        </div>
    );
}

function ConfirmFields({ reason, setReason, pin, setPin, reasonLabel }) {
    return (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
            <label style={{ fontSize: '0.7rem', color: '#94a3b8', fontWeight: 700 }}>{reasonLabel}</label>
            <textarea data-testid="undo-reason" rows={2} value={reason} onChange={e => setReason(e.target.value)} style={{ ...input, resize: 'vertical' }} />
            <label style={{ fontSize: '0.7rem', color: '#94a3b8', fontWeight: 700 }}>Cancel PIN</label>
            <input data-testid="undo-pin" type="password" inputMode="numeric" value={pin} onChange={e => setPin(e.target.value)} style={input} />
        </div>
    );
}

export function UndoDialog({ op, onClose, onDone }) {
    const [preview, setPreview] = useState(null);
    const [moneyHandled, setMoneyHandled] = useState(null);
    const [reason, setReason] = useState('');
    const [pin, setPin] = useState('');
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState(null);

    useEffect(() => {
        api.orderService.undoPreview(op.op_id).then(setPreview).catch(e => setError(errorText(e)));
    }, [op.op_id]);

    const submit = async () => {
        setBusy(true); setError(null);
        try {
            await api.orderService.undoOperation(op.op_id, pin, reason, moved ? moneyHandled : null);
            onDone?.(`${KIND_LABEL[op.kind] || 'Change'} undone`);
        } catch (e) { setError(errorText(e)); } finally { setBusy(false); }
    };
    // Money the change recorded as moving (+ collected, - refunded). Whether it really
    // changed hands decides whether undoing leaves it recorded or reverses it too.
    const moved = preview?.money_moved || 0;
    const can = preview?.undoable && reason.trim() && pin && !busy && (!moved || moneyHandled !== null);
    return (
        <Shell title={`Undo ${KIND_LABEL[op.kind]?.toLowerCase() || 'change'} · ${fmtWhen(op.created_at)}`} onClose={onClose} footer={
            <button data-testid="undo-confirm" disabled={!can} onClick={submit} style={{ ...btn('#f87171'), width: '100%', padding: '0.7rem', opacity: can ? 1 : 0.45, cursor: can ? 'pointer' : 'not-allowed' }}>
                {busy ? 'Undoing…' : 'Undo this change'}
            </button>
        }>
            {!preview && !error && <p style={{ color: '#64748b', fontSize: '0.8rem' }}>Working out what undoing it involves…</p>}
            <Effects preview={preview} />
            {preview?.undoable && moved !== 0 && (
                <div data-testid="undo-money" style={{ ...box, padding: '0.75rem', borderColor: 'rgba(251,191,36,0.35)' }}>
                    <p style={{ margin: '0 0 0.5rem', fontSize: '0.78rem', fontWeight: 700, color: '#fbbf24' }}>
                        {moved < 0
                            ? `This change recorded a refund of KSH ${Math.abs(moved).toFixed(0)}. Was it actually given back to the customer?`
                            : `This change recorded KSH ${moved.toFixed(0)} collected. Was it actually received?`}
                    </p>
                    <div style={{ display: 'flex', gap: '0.5rem' }}>
                        {[[true, 'Yes - keep it recorded'], [false, 'No - reverse it too']].map(([v, label]) => (
                            <button key={String(v)} data-money={String(v)} onClick={() => setMoneyHandled(v)} style={{
                                ...btn(moneyHandled === v ? '#fbbf24' : '#64748b'), flex: 1,
                                background: moneyHandled === v ? 'rgba(251,191,36,0.15)' : 'rgba(255,255,255,0.03)',
                            }}>{label}</button>
                        ))}
                    </div>
                </div>
            )}
            {preview?.undoable && <ConfirmFields reason={reason} setReason={setReason} pin={pin} setPin={setPin} reasonLabel="Why is it being undone?" />}
            {error && <p data-testid="undo-error" style={{ color: '#f87171', fontSize: '0.76rem', margin: 0 }}>{error}</p>}
        </Shell>
    );
}

export function CorrectDialog({ op, onClose, onDone }) {
    const [plan, setPlan] = useState(null);
    const [answers, setAnswers] = useState({});
    const [preview, setPreview] = useState(null);
    const [reason, setReason] = useState('');
    const [pin, setPin] = useState('');
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState(null);

    useEffect(() => {
        api.orderService.getCorrectionPlan(op.op_id).then(p => {
            const lines = (p.lines || []).filter(l => l.will_reverse !== false);
            const seed = {};
            lines.forEach(l => {
                const prev = l.previous_answer || {};
                if (prev.physicalState) seed[l.line_ref] = { physicalState: prev.physicalState, resolution: prev.resolution, laterCuts: prev.laterCuts || {} };
            });
            setAnswers(seed);
            setPlan({ ...p, lines });
        }).catch(e => setError(errorText(e)));
    }, [op.op_id]);

    // Answers changed after a preview: that preview no longer describes them.
    const change = (next) => { setAnswers(next); setPreview(null); };
    const complete = plan && answersComplete(plan.lines, answers);

    const runPreview = async () => {
        setBusy(true); setError(null);
        try { setPreview(await api.orderService.correctPreview(op.op_id, answersPayload(plan.lines, answers))); }
        catch (e) { setError(errorText(e)); } finally { setBusy(false); }
    };
    const submit = async () => {
        setBusy(true); setError(null);
        try {
            await api.orderService.correctOperation(op.op_id, pin, reason, answersPayload(plan.lines, answers));
            onDone?.('Cut answers corrected');
        } catch (e) { setError(errorText(e)); } finally { setBusy(false); }
    };
    const can = preview?.undoable && reason.trim() && pin && !busy;
    return (
        <Shell title={`Correct cut answers · ${KIND_LABEL[op.kind] || 'change'} ${fmtWhen(op.created_at)}`} onClose={onClose} footer={
            preview?.undoable
                ? <button data-testid="correct-confirm" disabled={!can} onClick={submit} style={{ ...btn('#22c55e'), width: '100%', padding: '0.7rem', opacity: can ? 1 : 0.45, cursor: can ? 'pointer' : 'not-allowed' }}>{busy ? 'Applying…' : 'Apply the corrected answers'}</button>
                : <button data-testid="correct-preview" disabled={!complete || busy} onClick={runPreview} style={{ ...btn('#60a5fa'), width: '100%', padding: '0.7rem', opacity: complete && !busy ? 1 : 0.45, cursor: complete && !busy ? 'pointer' : 'not-allowed' }}>{busy ? 'Checking…' : 'Show what the corrected answers change'}</button>
        }>
            {!plan && !error && <p style={{ color: '#64748b', fontSize: '0.8rem' }}>Loading the cut questions…</p>}
            {plan && (
                <>
                    <p style={{ margin: 0, fontSize: '0.74rem', color: '#94a3b8' }}>The answers given at the time are selected. Change the wrong ones.</p>
                    <CutQuestions lines={plan.lines} answers={answers} onChange={change} initiallyExpanded={plan.lines[0]?.line_ref} />
                </>
            )}
            <Effects preview={preview} />
            {preview?.undoable && <ConfirmFields reason={reason} setReason={setReason} pin={pin} setPin={setPin} reasonLabel="What was wrong with the original answers?" />}
            {error && <p data-testid="correct-error" style={{ color: '#f87171', fontSize: '0.76rem', margin: 0 }}>{error}</p>}
        </Shell>
    );
}

function answerText(c) {
    const s = { not_cut: 'not cut', already_cut: 'already cut' }[c.physical_state] || '—';
    const later = Object.entries(c.later_cuts || {}).map(([, v]) => (v === 'already_cut' ? 'cut' : 'not cut'));
    return `${c.product || 'Item'} ${c.cut}: ${s}${later.length ? ` · later cuts: ${later.join(', ')}` : ''}`;
}

export default function OrderChanges({ orderId, onChanged, notify }) {
    const [ops, setOps] = useState(null);
    const [dialog, setDialog] = useState(null);

    const load = useCallback(() => {
        api.orderService.getOperations(orderId).then(setOps).catch(() => setOps([]));
    }, [orderId]);
    useEffect(() => { load(); }, [load]);

    const done = (msg) => {
        setDialog(null);
        notify?.(msg);
        load();
        onChanged?.();
    };

    if (!ops) return null;
    if (!ops.length) {
        return <p style={{ margin: 0, fontSize: '0.74rem', color: '#475569' }}>No changes recorded yet (tracking started with this update).</p>;
    }
    return (
        <div data-testid="order-changes" style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
            {ops.map(op => (
                <div key={op.op_id} data-op-kind={op.kind} data-op-status={op.status} style={{ ...box, padding: '0.625rem 0.75rem', opacity: op.status === 'undone' ? 0.55 : 1 }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', gap: '0.5rem', alignItems: 'center' }}>
                        <div style={{ minWidth: 0 }}>
                            <div style={{ fontSize: '0.8rem', fontWeight: 800, color: '#e2e8f0' }}>
                                {KIND_LABEL[op.kind] || op.kind}
                                {op.status === 'undone' && <span style={{ marginLeft: 6, fontSize: '0.62rem', color: '#f87171' }}>UNDONE</span>}
                            </div>
                            <div style={{ fontSize: '0.68rem', color: '#64748b' }}>{fmtWhen(op.created_at)}{op.actor_name ? ` · ${op.actor_name}` : ''}</div>
                        </div>
                        {op.can_undo && (
                            <div style={{ display: 'flex', gap: '0.375rem', flexShrink: 0 }}>
                                {op.cut_confirmations?.some(c => c.physical_state) && (
                                    <button data-testid="op-correct" onClick={() => setDialog({ type: 'correct', op })} style={btn('#22c55e')}>Correct answers</button>
                                )}
                                <button data-testid="op-undo" onClick={() => setDialog({ type: 'undo', op })} style={btn('#f87171')}>Undo</button>
                            </div>
                        )}
                    </div>
                    {op.cut_confirmations?.filter(c => c.physical_state).map((c, i) => (
                        <div key={i} style={{ fontSize: '0.68rem', color: '#94a3b8', marginTop: '0.25rem' }}>✂️ {answerText(c)}</div>
                    ))}
                    {op.notes && op.kind !== 'sale' && <div style={{ fontSize: '0.66rem', color: '#64748b', marginTop: '0.2rem' }}>{op.notes}</div>}
                </div>
            ))}
            {dialog?.type === 'undo' && <UndoDialog op={dialog.op} onClose={() => setDialog(null)} onDone={done} />}
            {dialog?.type === 'correct' && <CorrectDialog op={dialog.op} onClose={() => setDialog(null)} onDone={done} />}
        </div>
    );
}
