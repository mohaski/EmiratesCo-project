import { useEffect, useState } from 'react';
import api from '../../services/api';
import { fmtLen } from '../../utils/cuttingInstructionFormat';

// Manager-only correction for one 1D (bar/profile) offcut_sources entry — the
// 1D analogue of CorrectOffcutModal, mirroring its shape: two independent
// corrections, combinable in one Save.
//   1. Corrected Remainder (always applied) — what's really left of the
//      RECORDED source, regardless of whether "replace source" below is also
//      checked. 0 means nothing usable was left (e.g. damaged). If the cut
//      also didn't come from here, this is where that gets reflected too —
//      e.g. the offcut's full original length if none of it was really used,
//      or something smaller if it was partly damaged. The system never
//      guesses this value; the manager always types the real number.
//   2. "This cut didn't actually come from the recorded source" — resolves
//      an independent replacement source (another offcut, or a new bar) for
//      the same length, entirely separate from the remainder correction
//      above. Because the recorded source's own consumption is never
//      reversed by this action (only its remainder, via #1), the picker
//      excludes it — offering it back as a candidate would be circular.
//
// Props:
//   event                 – the offcut_sources entry being corrected
//   productId, variantId  – identify which offcuts to offer as a replacement
//   onConfirm(newRemainderLength, replaceSource, forcedOffcutId, notes) – async, performs the API call
//   onClose
export default function CorrectProfileOffcutModal({ event, productId, variantId, onConfirm, onClose }) {
    const [remainder, setRemainder] = useState(String(event.remainder_created || 0));
    const [replaceSource, setReplaceSource] = useState(false);
    const [forcedOffcutId, setForcedOffcutId] = useState('');
    const [offcuts, setOffcuts] = useState([]);
    const [notes, setNotes] = useState('');
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState('');

    // Offcuts for the replacement picker — only needed once "replace source" is checked.
    useEffect(() => {
        if (!replaceSource || !productId) return;
        let cancelled = false;
        api.productService.getOffcuts(productId, variantId)
            .then(data => { if (!cancelled) setOffcuts((data || []).filter(oc => oc.offcutId !== event.offcut_id)); })
            .catch(() => { /* picker just stays empty — auto-suggestion still works */ });
        return () => { cancelled = true; };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [replaceSource, productId, variantId]);

    const remainderValid = remainder !== '' && parseFloat(remainder) >= 0;
    const canSubmit = !loading && remainderValid;

    const handleSubmit = async (e) => {
        e.preventDefault();
        if (!canSubmit) return;
        setLoading(true);
        setError('');
        try {
            await onConfirm(parseFloat(remainder), replaceSource, forcedOffcutId ? parseInt(forcedOffcutId) : null, notes);
            onClose();
        } catch (err) {
            setError(err.response?.data?.detail || 'Failed to correct offcut. Please try again.');
        } finally {
            setLoading(false);
        }
    };

    return (
        <div style={{
            position: 'fixed', inset: 0, zIndex: 300, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '1rem',
            background: 'rgba(9,14,26,0.9)', backdropFilter: 'blur(16px)',
        }} onClick={onClose}>
            <div onClick={e => e.stopPropagation()} style={{
                width: '100%', maxWidth: '480px', maxHeight: '90vh',
                background: 'linear-gradient(145deg, rgba(13,20,38,0.99), rgba(9,14,26,0.99))',
                border: '1px solid rgba(245,158,11,0.25)', borderRadius: '1.5rem', overflow: 'hidden',
                boxShadow: '0 32px 80px rgba(0,0,0,0.7)', display: 'flex', flexDirection: 'column',
                animation: 'fadeInScale 0.2s ease',
            }}>
                {/* Header */}
                <div style={{ padding: '1.25rem 1.5rem', borderBottom: '1px solid rgba(255,255,255,0.07)', background: 'linear-gradient(135deg, rgba(245,158,11,0.1), transparent)', flexShrink: 0 }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                        <div>
                            <h3 style={{ fontSize: '1rem', fontWeight: 800, color: '#f1f5f9', margin: '0 0 3px' }}>Correct Cutting Outcome</h3>
                            <p style={{ fontSize: '0.75rem', color: '#64748b', margin: 0 }}>
                                Cut {fmtLen(event.length_used)} from {event.source === 'offcut' ? `Offcut #${event.offcut_id} (${fmtLen(event.offcut_length)} available)` : 'a new bar'} — enter what actually happened
                            </p>
                        </div>
                        <button onClick={onClose} style={{
                            width: '30px', height: '30px', borderRadius: '8px', border: '1px solid rgba(255,255,255,0.1)',
                            background: 'rgba(255,255,255,0.05)', color: '#64748b', cursor: 'pointer',
                            display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
                        }}>✕</button>
                    </div>
                </div>

                <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0 }}>
                    <div style={{ flex: 1, overflowY: 'auto', padding: '1.25rem 1.5rem' }} className="custom-scrollbar">
                        <span style={{ fontSize: '0.7rem', color: '#475569', textTransform: 'uppercase', letterSpacing: '0.08em', display: 'block', marginBottom: '0.625rem' }}>
                            Corrected Remainder
                        </span>
                        <div style={{
                            display: 'flex', alignItems: 'center', gap: '0.625rem',
                            padding: '0.75rem 1rem', borderRadius: '0.875rem',
                            background: 'rgba(255,255,255,0.03)', border: `1px solid ${remainderValid ? 'rgba(255,255,255,0.07)' : 'rgba(239,68,68,0.3)'}`,
                        }}>
                            <input type="number" step="0.01" min="0"
                                value={remainder}
                                onChange={e => setRemainder(e.target.value)}
                                style={{ width: '100px', background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: '6px', color: '#e2e8f0', fontSize: '0.82rem', padding: '5px 8px', outline: 'none' }} />
                            <span style={{ color: '#64748b', fontSize: '0.78rem' }}>ft left over</span>
                        </div>
                        <div style={{ display: 'flex', gap: '0.75rem', marginTop: '0.5rem' }}>
                            <button type="button" onClick={() => setRemainder('0')} style={{
                                background: 'none', border: 'none', color: '#f87171', fontSize: '0.72rem', fontWeight: 700, cursor: 'pointer', whiteSpace: 'nowrap', padding: 0,
                            }}>Nothing usable (damaged)</button>
                            <button type="button" onClick={() => setRemainder(String(event.offcut_length || 0))} style={{
                                background: 'none', border: 'none', color: '#4ade80', fontSize: '0.72rem', fontWeight: 700, cursor: 'pointer', whiteSpace: 'nowrap', padding: 0,
                            }}>Fully intact — none of it was used</button>
                        </div>
                        <p style={{ fontSize: '0.7rem', color: '#475569', margin: '0.5rem 0 0' }}>
                            This describes what's really left of {event.source === 'offcut' ? `Offcut #${event.offcut_id}` : 'the bar'} above — it applies whether or not you also replace the source below.
                        </p>

                        <div style={{ marginTop: '1.25rem' }}>
                            <label style={{ display: 'flex', alignItems: 'center', gap: '0.625rem', cursor: 'pointer' }}>
                                <input type="checkbox" checked={replaceSource} onChange={e => setReplaceSource(e.target.checked)}
                                    style={{ width: '16px', height: '16px', flexShrink: 0, accentColor: '#ef4444' }} />
                                <span style={{ fontSize: '0.82rem', color: '#e2e8f0', fontWeight: 600 }}>
                                    This cut didn't actually come from the recorded source
                                </span>
                            </label>
                            <p style={{ fontSize: '0.72rem', color: '#64748b', margin: '0.375rem 0 0 26px' }}>
                                e.g. the recorded offcut turned out damaged, or the cutter used a different piece. This finds a separate replacement — it doesn't change the remainder above.
                            </p>
                        </div>

                        {replaceSource && (
                            <div style={{ marginTop: '0.875rem' }}>
                                <label style={{ fontSize: '0.62rem', fontWeight: 700, color: '#475569', letterSpacing: '0.08em', textTransform: 'uppercase', display: 'block', marginBottom: '0.375rem' }}>
                                    Replacement Source
                                </label>
                                <select value={forcedOffcutId} onChange={e => setForcedOffcutId(e.target.value)} style={{
                                    width: '100%', boxSizing: 'border-box', padding: '0.625rem 0.75rem',
                                    background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: '0.625rem',
                                    color: '#e2e8f0', fontSize: '0.8rem', outline: 'none',
                                }}>
                                    <option value="">Let system choose (best fit / new bar)</option>
                                    {offcuts.map(oc => (
                                        <option key={oc.offcutId} value={oc.offcutId}>
                                            Offcut #{oc.offcutId} — {fmtLen(oc.length)} (qty {oc.quantity})
                                        </option>
                                    ))}
                                </select>
                            </div>
                        )}

                        <div style={{ marginTop: '1.25rem' }}>
                            <label style={{ fontSize: '0.62rem', fontWeight: 700, color: '#475569', letterSpacing: '0.08em', textTransform: 'uppercase', display: 'block', marginBottom: '0.375rem' }}>
                                Notes (optional)
                            </label>
                            <textarea value={notes} onChange={e => setNotes(e.target.value)} rows={2} placeholder="e.g. offcut was cracked, actual leftover was shorter"
                                style={{
                                    width: '100%', boxSizing: 'border-box', padding: '0.625rem 0.75rem',
                                    background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: '0.625rem',
                                    color: '#e2e8f0', fontSize: '0.8rem', outline: 'none', resize: 'vertical', fontFamily: 'inherit',
                                }} />
                        </div>

                        {error && (
                            <div style={{ marginTop: '1rem', padding: '0.625rem 0.875rem', borderRadius: '0.75rem', background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.25)', color: '#f87171', fontSize: '0.78rem' }}>
                                {error}
                            </div>
                        )}
                    </div>

                    {/* Footer */}
                    <div style={{ padding: '1rem 1.5rem', borderTop: '1px solid rgba(255,255,255,0.07)', display: 'flex', justifyContent: 'flex-end', gap: '0.75rem', background: 'rgba(0,0,0,0.3)', flexShrink: 0 }}>
                        <button type="button" onClick={onClose} style={{
                            padding: '0.625rem 1.25rem', borderRadius: '0.75rem', border: '1px solid rgba(255,255,255,0.1)',
                            background: 'rgba(255,255,255,0.05)', color: '#64748b', fontSize: '0.82rem', cursor: 'pointer',
                        }}>Cancel</button>
                        <button type="submit" disabled={!canSubmit} style={{
                            padding: '0.625rem 1.5rem', borderRadius: '0.75rem', border: 'none',
                            background: canSubmit ? 'linear-gradient(135deg, #f59e0b, #ea580c)' : 'rgba(255,255,255,0.06)',
                            color: canSubmit ? '#fff' : '#475569', fontWeight: 700, fontSize: '0.82rem',
                            cursor: canSubmit ? 'pointer' : 'not-allowed',
                            boxShadow: canSubmit ? '0 4px 16px rgba(245,158,11,0.3)' : 'none', transition: 'all 0.2s',
                        }}>
                            {loading ? 'Saving...' : 'Save Correction'}
                        </button>
                    </div>
                </form>
            </div>
        </div>
    );
}
