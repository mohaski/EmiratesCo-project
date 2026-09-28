import { useMemo, useState } from 'react';

/**
 * Confirm, one cut line at a time, whether the cutting has physically been done.
 *
 * Shown for ANY order with cut material, whatever the cutting flags say — a bar is
 * routinely cut hours before anyone reports it, so `cutting_completed` is a prefill, not
 * evidence. Lines the flags say are uncut arrive pre-answered, so the common case is one
 * tap; every line stays visible and overridable.
 *
 * Already cut means the bar is never recombined and its own cut size goes back into the
 * offcut pool. Scrapping or writing off the piece is not offered here — the backend still
 * accepts those values, but `allowed_resolutions` advertises only return_to_pool, so this
 * renders no choice for it. Re-offering one is a change in reversalPlan.OFFERED_RESOLUTIONS.
 *
 * Fed by GET /orders/{id}/reversal-plan. Produces the `cutConfirmations` payload the edit
 * and cancel endpoints take: { "<line_ref>": { physicalState, resolution } }
 */

const PHYSICAL_STATES = [
    { id: 'not_cut', label: 'Not cut', icon: '⬜', color: '#22c55e' },
    { id: 'already_cut', label: 'Already cut', icon: '✂️', color: '#f59e0b' },
    { id: 'unknown', label: 'Needs check', icon: '❓', color: '#64748b' },
];

const stateMeta = id => PHYSICAL_STATES.find(s => s.id === id) || PHYSICAL_STATES[2];

const card = {
    background: 'rgba(255,255,255,0.03)',
    border: '1px solid rgba(255,255,255,0.07)',
    borderRadius: '1rem',
};

const microLabel = {
    fontSize: '0.62rem', fontWeight: 700, color: '#475569',
    letterSpacing: '0.08em', textTransform: 'uppercase',
};

/** The physical chain this cut came out of — one row per piece, indented by depth, so a
 *  bar cut down through several orders reads as the tree it actually is. */
function ChainView({ chain }) {
    if (!chain?.pieces?.length) return null;
    return (
        <div style={{ ...card, padding: '0.625rem 0.75rem', background: 'rgba(0,0,0,0.25)' }}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.2rem' }}>
                {chain.pieces.map(p => {
                    const consumed = p.state === 'consumed';
                    const retired = p.state === 'retired';
                    return (
                        <div key={p.piece_id} style={{
                            display: 'flex', alignItems: 'center', gap: '0.45rem',
                            paddingLeft: `${p.depth * 1.1}rem`, fontSize: '0.72rem',
                            opacity: retired ? 0.45 : 1,
                        }}>
                            <span style={{ color: '#334155' }}>{p.depth > 0 ? '└' : '▪'}</span>
                            <span style={{
                                fontWeight: 700,
                                color: p.is_scrap ? '#f87171' : (consumed ? '#f59e0b' : '#22d3ee'),
                                fontVariantNumeric: 'tabular-nums',
                            }}>{p.size}</span>
                            {p.origin === 'stock_unit' && <span style={{ fontSize: '0.62rem', color: '#475569' }}>whole</span>}
                            {p.is_scrap && <span style={{ fontSize: '0.62rem', color: '#f87171' }}>scrap</span>}
                            {consumed && p.holder && (
                                <span style={{ fontSize: '0.62rem', color: '#f59e0b' }}>
                                    {p.holder.order_no != null ? `#${p.holder.order_no}` : 'an open sale window'}{p.holder.customer_name ? ` ${p.holder.customer_name}` : ''}
                                </span>
                            )}
                        </div>
                    );
                })}
            </div>
        </div>
    );
}

function LineRow({ line, answer, onAnswer, expanded, onToggle, sheetMates = [] }) {
    const state = answer?.physicalState ?? line.default_physical_state;
    const meta = stateMeta(state);
    const needsCheck = state === 'unknown';
    const answered = !!answer?.physicalState;

    return (
        <div style={{ ...card, overflow: 'hidden', borderColor: needsCheck ? 'rgba(239,68,68,0.3)' : 'rgba(255,255,255,0.07)' }}>
            <button onClick={onToggle} style={{
                width: '100%', display: 'flex', alignItems: 'center', gap: '0.75rem',
                padding: '0.875rem 1rem', background: 'none', border: 'none', cursor: 'pointer', textAlign: 'left',
            }}>
                <span style={{ fontSize: '1rem' }}>{meta.icon}</span>
                <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{
                        fontSize: '0.82rem', fontWeight: 700, color: '#f1f5f9',
                        overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                    }}>
                        {line.product_name || 'Item'}
                        {line.variant_name ? <span style={{ color: '#64748b', fontWeight: 600 }}> · {line.variant_name}</span> : null}
                    </div>
                    <div style={{ fontSize: '0.7rem', color: '#64748b', marginTop: '0.1rem' }}>
                        {line.cut_description}
                        {line.legacy && <span style={{ color: '#a855f7' }}> · no history</span>}
                        {sheetMates.length > 0 && (
                            <span style={{ color: '#22d3ee' }}> · same sheet as {sheetMates.join(', ')}</span>
                        )}
                    </div>
                </div>
                <span style={{
                    fontSize: '0.62rem', fontWeight: 700, letterSpacing: '0.04em', textTransform: 'uppercase',
                    padding: '0.25rem 0.5rem', borderRadius: '0.5rem', flexShrink: 0,
                    color: meta.color, background: `${meta.color}1f`, border: `1px solid ${meta.color}44`,
                }}>
                    {answered ? meta.label : `${meta.label}?`}
                </span>
                <span style={{ color: '#475569', fontSize: '0.7rem', flexShrink: 0 }}>{expanded ? '▲' : '▼'}</span>
            </button>

            {expanded && (
                <div style={{
                    padding: '0.875rem 1rem 1rem', display: 'flex', flexDirection: 'column', gap: '0.625rem',
                    borderTop: '1px solid rgba(255,255,255,0.05)',
                }}>
                    <ChainView chain={line.chain} />

                    {/* Which order holds part of this material — the fact, not a sentence
                        about it. This is why a whole bar can't come back for the line. */}
                    {line.blockers.length > 0 && (
                        <div style={{
                            display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '0.375rem',
                            fontSize: '0.7rem', color: '#fbbf24',
                        }}>
                            <span style={{ ...microLabel, color: '#b45309' }}>Committed to</span>
                            {line.blockers.map((b, i) => (
                                <span key={b.piece_id ?? i} style={{
                                    fontWeight: 700, padding: '0.15rem 0.4rem', borderRadius: '0.4rem',
                                    background: 'rgba(245,158,11,0.12)', border: '1px solid rgba(245,158,11,0.3)',
                                }}>
                                    {b.order_no != null ? `#${b.order_no}` : 'an open sale window'}{b.customer_name ? ` ${b.customer_name}` : ''}
                                </span>
                            ))}
                        </div>
                    )}

                    <div style={{ display: 'flex', gap: '0.5rem' }}>
                        {PHYSICAL_STATES.map(s => {
                            const active = state === s.id;
                            return (
                                <button
                                    key={s.id}
                                    type="button"
                                    onClick={() => onAnswer({
                                        physicalState: s.id,
                                        // Already-cut material always goes back to the offcut pool.
                                        resolution: s.id === 'already_cut' ? (line.default_resolution || 'return_to_pool') : null,
                                    })}
                                    style={{
                                        flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '0.25rem',
                                        padding: '0.5rem 0.375rem', borderRadius: '0.75rem', cursor: 'pointer',
                                        border: active ? `1px solid ${s.color}80` : '1px solid rgba(255,255,255,0.08)',
                                        background: active ? `${s.color}1f` : 'rgba(255,255,255,0.03)',
                                        color: active ? s.color : '#64748b', transition: 'all 0.15s ease',
                                    }}
                                >
                                    <span style={{ fontSize: '1rem' }}>{s.icon}</span>
                                    <span style={{ fontSize: '0.66rem', fontWeight: 700 }}>{s.label}</span>
                                </button>
                            );
                        })}
                    </div>
                </div>
            )}
        </div>
    );
}

export default function ResolveCutsModal({ plan, onClose, onConfirm, actionLabel = 'Continue', notice = null }) {
    // Pre-answer the lines the backend says are safe to take on trust, so only the ones
    // that genuinely need a human are left blank.
    const [answers, setAnswers] = useState(() => {
        const seed = {};
        (plan?.lines || []).filter(l => l.will_reverse !== false).forEach(l => {
            if (!l.requires_explicit_answer) {
                seed[l.line_ref] = { physicalState: l.default_physical_state, resolution: null };
            }
        });
        return seed;
    });
    // Open the first line that needs a human; failing that the first line, so a fully
    // pre-answered order doesn't present as a wall of collapsed rows.
    const [expanded, setExpanded] = useState(() => {
        const shown = (plan?.lines || []).filter(l => l.will_reverse !== false);
        const first = shown.find(l => l.requires_explicit_answer) || shown[0];
        return first ? first.line_ref : null;
    });

    // Lines an edit leaves untouched come back flagged will_reverse:false — their material
    // never moves, so asking about them would be noise. A cancel reverses everything and
    // never sets the flag, so nothing is filtered there.
    const lines = (plan?.lines || []).filter(l => l.will_reverse !== false);

    const { unanswered, unknown } = useMemo(() => {
        const u = [], k = [];
        lines.forEach(l => {
            const a = answers[l.line_ref];
            if (!a?.physicalState) u.push(l);
            else if (a.physicalState === 'unknown') k.push(l);
        });
        return { unanswered: u, unknown: k };
    }, [lines, answers]);

    const canSubmit = unanswered.length === 0 && unknown.length === 0;

    // Lines cut from the same physical sheet (same sheet_group) are one piece of glass, so
    // they take ONE cut/not-cut answer: answering any of them answers all. Two lines on one
    // sheet answered differently is how order 201 put an already-cut 5mm sheet back in stock.
    const setAnswer = (ref, value) => setAnswers(prev => {
        const group = lines.find(l => l.line_ref === ref)?.sheet_group;
        if (!group) return { ...prev, [ref]: value };
        const next = { ...prev };
        lines.filter(l => l.sheet_group === group).forEach(l => {
            next[l.line_ref] = {
                physicalState: value.physicalState,
                resolution: value.physicalState === 'already_cut'
                    ? (l.line_ref === ref ? value.resolution : (l.default_resolution || 'return_to_pool'))
                    : null,
            };
        });
        return next;
    });

    // Short labels of the other lines on each shared sheet, for the "same sheet" hint.
    const sheetMates = ref => {
        const group = lines.find(l => l.line_ref === ref)?.sheet_group;
        return group ? lines.filter(l => l.sheet_group === group && l.line_ref !== ref)
            .map(l => l.cut_description) : [];
    };

    const handleConfirm = () => {
        if (!canSubmit) return;
        const payload = {};
        Object.entries(answers).forEach(([ref, a]) => {
            payload[ref] = {
                physicalState: a.physicalState,
                resolution: a.physicalState === 'already_cut' ? (a.resolution || 'return_to_pool') : null,
            };
        });
        onConfirm(payload);
    };

    if (!plan) return null;

    const hasLegacy = lines.some(l => l.legacy);
    // Nothing this action disturbs — caller shouldn't have opened it, but don't show an
    // empty dialog if it did.
    if (!lines.length) return null;

    return (
        <div style={{
            position: 'fixed', inset: 0, zIndex: 70, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '1rem',
            background: 'rgba(9,14,26,0.85)', backdropFilter: 'blur(12px)',
        }} onClick={onClose}>
            <div onClick={e => e.stopPropagation()} style={{
                width: '100%', maxWidth: '520px', maxHeight: '90vh', display: 'flex', flexDirection: 'column',
                background: 'linear-gradient(145deg, rgba(13,20,38,0.99), rgba(9,14,26,0.99))',
                border: '1px solid rgba(34,211,238,0.2)', borderRadius: '1.5rem', overflow: 'hidden',
                boxShadow: '0 32px 80px rgba(0,0,0,0.7)', animation: 'fadeInScale 0.2s ease',
            }}>
                {/* Header */}
                <div className="modal-header-pad" style={{
                    padding: '1.25rem 1.75rem', borderBottom: '1px solid rgba(255,255,255,0.07)',
                    display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '0.75rem', flexShrink: 0,
                }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', minWidth: 0, flex: 1 }}>
                        <div style={{
                            width: '36px', height: '36px', borderRadius: '10px', background: 'rgba(34,211,238,0.15)',
                            border: '1px solid rgba(34,211,238,0.3)', display: 'flex', alignItems: 'center',
                            justifyContent: 'center', fontSize: '1rem', flexShrink: 0,
                        }}>✂️</div>
                        <div style={{ minWidth: 0 }}>
                            <h2 style={{ fontSize: '1rem', fontWeight: 800, color: '#f1f5f9', margin: 0 }}>
                                Confirm Cutting · Order {plan.order_id}
                            </h2>
                            <p style={{ ...microLabel, margin: 0 }}>
                                {lines.length} cut {lines.length === 1 ? 'line' : 'lines'}
                                {unanswered.length > 0 ? ` · ${unanswered.length} to answer` : ''}
                            </p>
                        </div>
                    </div>
                    <button onClick={onClose} style={{
                        width: '30px', height: '30px', borderRadius: '8px', border: '1px solid rgba(255,255,255,0.1)',
                        background: 'rgba(255,255,255,0.05)', color: '#64748b', cursor: 'pointer', flexShrink: 0,
                    }}>✕</button>
                </div>

                {/* Body */}
                <div className="modal-body-pad" style={{ padding: '1.25rem 1.75rem', overflowY: 'auto', flex: 1 }}>
                    {/* Why the modal reopened: the material moved since it was last answered
                        (a 409 from the server). Without this it just looks like a glitch. */}
                    {notice && (
                        <div style={{
                            marginBottom: '0.75rem', padding: '0.5rem 0.75rem', background: 'rgba(245,158,11,0.1)',
                            border: '1px solid rgba(245,158,11,0.3)', borderRadius: '0.75rem',
                            color: '#fbbf24', fontSize: '0.72rem', fontWeight: 600,
                        }}>{notice}</div>
                    )}
                    {hasLegacy && (
                        <div style={{
                            marginBottom: '0.75rem', padding: '0.5rem 0.75rem', background: 'rgba(168,85,247,0.08)',
                            border: '1px solid rgba(168,85,247,0.25)', borderRadius: '0.75rem',
                            color: '#c4b5fd', fontSize: '0.7rem', fontWeight: 600,
                        }}>No offcut history on some lines — check the material.</div>
                    )}

                    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.625rem' }}>
                        {lines.map(line => (
                            <LineRow
                                key={line.line_ref}
                                line={line}
                                sheetMates={sheetMates(line.line_ref)}
                                answer={answers[line.line_ref]}
                                onAnswer={v => setAnswer(line.line_ref, v)}
                                expanded={expanded === line.line_ref}
                                onToggle={() => setExpanded(expanded === line.line_ref ? null : line.line_ref)}
                            />
                        ))}
                    </div>
                </div>

                {/* Footer */}
                <div style={{
                    padding: '1rem 1.75rem 1.25rem', borderTop: '1px solid rgba(255,255,255,0.07)',
                    flexShrink: 0, display: 'flex', flexDirection: 'column', gap: '0.75rem',
                }}>
                    {unknown.length > 0 && (
                        <div style={{ fontSize: '0.72rem', color: '#f87171', fontWeight: 600 }}>
                            {unknown.length} {unknown.length === 1 ? 'line needs' : 'lines need'} a floor check.
                        </div>
                    )}
                    <div style={{ display: 'flex', gap: '0.625rem' }}>
                        <button type="button" onClick={onClose} style={{
                            flex: 1, padding: '0.875rem', borderRadius: '0.875rem', border: '1px solid rgba(255,255,255,0.1)',
                            background: 'rgba(255,255,255,0.04)', color: '#94a3b8', fontWeight: 700, fontSize: '0.875rem', cursor: 'pointer',
                        }}>Back</button>
                        <button type="button" onClick={handleConfirm} disabled={!canSubmit} style={{
                            flex: 1, padding: '0.875rem', borderRadius: '0.875rem', border: 'none',
                            cursor: canSubmit ? 'pointer' : 'not-allowed',
                            background: canSubmit ? 'linear-gradient(135deg, #22d3ee, #0891b2)' : 'rgba(34,211,238,0.25)',
                            color: canSubmit ? '#04202a' : 'rgba(255,255,255,0.4)', fontWeight: 800, fontSize: '0.875rem',
                            boxShadow: canSubmit ? '0 4px 16px rgba(34,211,238,0.25)' : 'none',
                        }}>{actionLabel}</button>
                    </div>
                </div>
            </div>
        </div>
    );
}
