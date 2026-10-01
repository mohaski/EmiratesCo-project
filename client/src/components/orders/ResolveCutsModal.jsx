import { useMemo, useState } from 'react';
import { lineAnswered, answersPayload } from '../../utils/cutAnswers';

/**
 * Confirm, one cut line at a time, whether the cutting has physically been done - and, when
 * later orders have cut from the same bar/sheet, whether each of THEIR cuts has been made too.
 *
 * Already cut: the bar/sheet is never recombined; the cut piece goes back to the offcut pool.
 * Not cut: the material comes back - the whole bar/sheet if nobody else has touched it, or,
 * if a later order has cut into its leftover, the uncut length/glass joined back onto what is
 * left. A later cut confirmed made is marked cut on that order.
 *
 * Fed by the reversal plan (GET/POST /orders/{id}/reversal-plan). Produces the
 * `cutConfirmations` payload the edit and cancel endpoints take:
 *   { "<line_ref>": { physicalState, resolution, laterCuts: { "<item_id>": state } } }
 *
 * `CutQuestions` is the same list without the dialog, used inside the calculators (edit
 * mode) and the Correct-answers dialog.
 */

const PHYSICAL_STATES = [
    { id: 'not_cut', label: 'Not cut', icon: '⬜', color: '#22c55e' },
    { id: 'already_cut', label: 'Already cut', icon: '✂️', color: '#f59e0b' },
    { id: 'unknown', label: 'Needs check', icon: '❓', color: '#64748b' },
];
const LATER_STATES = PHYSICAL_STATES.slice(0, 2);

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

/** The physical chain this cut came out of - one row per piece, indented by depth. */
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
                            {p.origin === 'rejoin' && <span style={{ fontSize: '0.62rem', color: '#22c55e' }}>rejoined</span>}
                            {p.is_scrap && <span style={{ fontSize: '0.62rem', color: '#f87171' }}>scrap</span>}
                            {consumed && p.holder && (
                                <span style={{ fontSize: '0.62rem', color: '#f59e0b' }}>
                                    #{p.holder.order_id}{p.holder.customer_name ? ` ${p.holder.customer_name}` : ''}
                                </span>
                            )}
                        </div>
                    );
                })}
            </div>
        </div>
    );
}

function StateButtons({ states, value, onPick, small = false }) {
    return (
        <div style={{ display: 'flex', gap: '0.5rem' }}>
            {states.map(s => {
                const active = value === s.id;
                return (
                    <button
                        key={s.id}
                        type="button"
                        data-state={s.id}
                        onClick={() => onPick(s.id)}
                        style={{
                            flex: 1, display: 'flex', flexDirection: small ? 'row' : 'column', alignItems: 'center',
                            justifyContent: 'center', gap: '0.25rem',
                            padding: small ? '0.35rem 0.375rem' : '0.5rem 0.375rem', borderRadius: '0.75rem', cursor: 'pointer',
                            border: active ? `1px solid ${s.color}80` : '1px solid rgba(255,255,255,0.08)',
                            background: active ? `${s.color}1f` : 'rgba(255,255,255,0.03)',
                            color: active ? s.color : '#64748b', transition: 'all 0.15s ease',
                        }}
                    >
                        <span style={{ fontSize: small ? '0.8rem' : '1rem' }}>{s.icon}</span>
                        <span style={{ fontSize: '0.66rem', fontWeight: 700 }}>{s.label}</span>
                    </button>
                );
            })}
        </div>
    );
}

export function LineRow({ line, answer, onAnswer, expanded, onToggle, sheetMates = [] }) {
    const state = answer?.physicalState ?? (line.requires_explicit_answer ? null : line.default_physical_state);
    const meta = stateMeta(state);
    const answered = lineAnswered(line, answer);
    const laterCuts = line.later_cuts || [];
    const returns = line.returns || {};
    const setLater = (itemId, value) => onAnswer({
        physicalState: answer?.physicalState ?? null,
        resolution: answer?.resolution ?? null,
        laterCuts: { ...(answer?.laterCuts || {}), [String(itemId)]: value },
    });

    return (
        <div data-line-ref={line.line_ref} style={{ ...card, overflow: 'hidden', borderColor: answered ? 'rgba(255,255,255,0.07)' : 'rgba(245,158,11,0.3)' }}>
            <button onClick={onToggle} style={{
                width: '100%', display: 'flex', alignItems: 'center', gap: '0.75rem',
                padding: '0.875rem 1rem', background: 'none', border: 'none', cursor: 'pointer', textAlign: 'left',
            }}>
                <span style={{ fontSize: '1rem' }}>{state ? meta.icon : '•'}</span>
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
                        {laterCuts.length > 0 && <span style={{ color: '#fbbf24' }}> · {laterCuts.length} later cut{laterCuts.length > 1 ? 's' : ''} from it</span>}
                        {sheetMates.length > 0 && (
                            <span style={{ color: '#22d3ee' }}> · same sheet as {sheetMates.join(', ')}</span>
                        )}
                    </div>
                </div>
                <span style={{
                    fontSize: '0.62rem', fontWeight: 700, letterSpacing: '0.04em', textTransform: 'uppercase',
                    padding: '0.25rem 0.5rem', borderRadius: '0.5rem', flexShrink: 0,
                    color: answered ? meta.color : '#f59e0b',
                    background: answered ? `${meta.color}1f` : 'rgba(245,158,11,0.12)',
                    border: `1px solid ${answered ? meta.color : '#f59e0b'}44`,
                }}>
                    {answered ? meta.label : 'Answer'}
                </span>
                <span style={{ color: '#475569', fontSize: '0.7rem', flexShrink: 0 }}>{expanded ? '▲' : '▼'}</span>
            </button>

            {expanded && (
                <div style={{
                    padding: '0.875rem 1rem 1rem', display: 'flex', flexDirection: 'column', gap: '0.625rem',
                    borderTop: '1px solid rgba(255,255,255,0.05)',
                }}>
                    <ChainView chain={line.chain} />

                    <span style={microLabel}>This cut ({line.cut_description}) - was it made?</span>
                    <StateButtons
                        states={PHYSICAL_STATES}
                        value={state}
                        onPick={id => onAnswer({
                            physicalState: id,
                            resolution: id === 'already_cut' ? (line.default_resolution || 'return_to_pool') : null,
                            laterCuts: { ...(answer?.laterCuts || {}) },
                        })}
                    />
                    {state && returns[state]?.length > 0 && (
                        <div style={{ fontSize: '0.7rem', color: '#94a3b8' }}>
                            <span style={{ color: '#475569' }}>Comes back: </span>
                            <span style={{ color: '#22d3ee', fontWeight: 700 }}>{returns[state].join(' · ')}</span>
                        </div>
                    )}

                    {laterCuts.map(lc => (
                        <div key={lc.item_id} data-later-cut={lc.item_id} style={{ display: 'flex', flexDirection: 'column', gap: '0.375rem', paddingTop: '0.375rem', borderTop: '1px dashed rgba(255,255,255,0.06)' }}>
                            <span style={{ ...microLabel, color: '#b45309' }}>
                                Later cut from the same {line.is_2d ? 'sheet' : 'bar'}: order #{lc.order_id}{lc.customer_name ? ` ${lc.customer_name}` : ''} - {lc.cut}. Was it made?
                            </span>
                            <StateButtons small states={LATER_STATES} value={answer?.laterCuts?.[String(lc.item_id)]}
                                onPick={id => setLater(lc.item_id, id)} />
                        </div>
                    ))}
                </div>
            )}
        </div>
    );
}

/** The question list on its own. `answers` is { [line_ref]: answer }; onChange(next). */
export function CutQuestions({ lines, answers, onChange, initiallyExpanded = 'first-unanswered' }) {
    const [expanded, setExpanded] = useState(() => {
        if (initiallyExpanded !== 'first-unanswered') return initiallyExpanded;
        const first = (lines || []).find(l => !lineAnswered(l, answers?.[l.line_ref])) || (lines || [])[0];
        return first ? first.line_ref : null;
    });

    // Lines cut from the same physical sheet (same sheet_group) are one piece of glass, so
    // they take ONE cut/not-cut answer: answering any of them answers all.
    const setAnswer = (ref, value) => {
        const group = lines.find(l => l.line_ref === ref)?.sheet_group;
        const next = { ...(answers || {}) };
        if (!group) {
            next[ref] = value;
        } else {
            lines.filter(l => l.sheet_group === group).forEach(l => {
                const prev = next[l.line_ref] || {};
                next[l.line_ref] = {
                    ...prev,
                    physicalState: value.physicalState,
                    resolution: value.physicalState === 'already_cut'
                        ? (l.line_ref === ref ? value.resolution : (l.default_resolution || 'return_to_pool'))
                        : null,
                    laterCuts: l.line_ref === ref ? value.laterCuts : { ...(prev.laterCuts || {}), ...(value.laterCuts || {}) },
                };
            });
        }
        onChange(next);
    };

    const sheetMates = ref => {
        const group = lines.find(l => l.line_ref === ref)?.sheet_group;
        return group ? lines.filter(l => l.sheet_group === group && l.line_ref !== ref)
            .map(l => l.cut_description) : [];
    };

    return (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.625rem' }}>
            {(lines || []).map(line => (
                <LineRow
                    key={line.line_ref}
                    line={line}
                    sheetMates={sheetMates(line.line_ref)}
                    answer={answers?.[line.line_ref]}
                    onAnswer={v => setAnswer(line.line_ref, v)}
                    expanded={expanded === line.line_ref}
                    onToggle={() => setExpanded(expanded === line.line_ref ? null : line.line_ref)}
                />
            ))}
        </div>
    );
}

export default function ResolveCutsModal({ plan, onClose, onConfirm, actionLabel = 'Continue', notice = null, initialAnswers = null }) {
    // Lines an edit leaves untouched come back flagged will_reverse:false - their material
    // never moves, so asking about them would be noise.
    const lines = (plan?.lines || []).filter(l => l.will_reverse !== false);

    // Answers given in the calculators arrive pre-filled; lines the backend says are safe to
    // take on trust are pre-answered from their default. Everything else is left blank.
    const [answers, setAnswers] = useState(() => {
        const seed = {};
        lines.forEach(l => {
            if (initialAnswers?.[l.line_ref]) {
                seed[l.line_ref] = initialAnswers[l.line_ref];
            } else if (!l.requires_explicit_answer) {
                seed[l.line_ref] = { physicalState: l.default_physical_state, resolution: null, laterCuts: {} };
            }
        });
        return seed;
    });

    const unanswered = useMemo(() => lines.filter(l => !lineAnswered(l, answers[l.line_ref])), [lines, answers]);
    const canSubmit = unanswered.length === 0;

    if (!plan || !lines.length) return null;
    const hasLegacy = lines.some(l => l.legacy);

    return (
        <div style={{
            position: 'fixed', inset: 0, zIndex: 70, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '1rem',
            background: 'rgba(9,14,26,0.85)', backdropFilter: 'blur(12px)',
        }} onClick={onClose}>
            <div data-testid="resolve-cuts-modal" onClick={e => e.stopPropagation()} style={{
                width: '100%', maxWidth: '520px', maxHeight: '90vh', display: 'flex', flexDirection: 'column',
                background: 'linear-gradient(145deg, rgba(13,20,38,0.99), rgba(9,14,26,0.99))',
                border: '1px solid rgba(34,211,238,0.2)', borderRadius: '1.5rem', overflow: 'hidden',
                boxShadow: '0 32px 80px rgba(0,0,0,0.7)', animation: 'fadeInScale 0.2s ease',
            }}>
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

                <div className="modal-body-pad" style={{ padding: '1.25rem 1.75rem', overflowY: 'auto', flex: 1, minHeight: 0 }}>
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
                    <CutQuestions lines={lines} answers={answers} onChange={setAnswers} />
                </div>

                <div style={{
                    padding: '1rem 1.75rem 1.25rem', borderTop: '1px solid rgba(255,255,255,0.07)',
                    flexShrink: 0, display: 'flex', flexDirection: 'column', gap: '0.75rem',
                }}>
                    <div style={{ display: 'flex', gap: '0.625rem' }}>
                        <button type="button" onClick={onClose} style={{
                            flex: 1, padding: '0.875rem', borderRadius: '0.875rem', border: '1px solid rgba(255,255,255,0.1)',
                            background: 'rgba(255,255,255,0.04)', color: '#94a3b8', fontWeight: 700, fontSize: '0.875rem', cursor: 'pointer',
                        }}>Back</button>
                        <button type="button" data-testid="confirm-cuts" onClick={() => canSubmit && onConfirm(answersPayload(lines, answers))} disabled={!canSubmit} style={{
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
