import { useState } from 'react';
import api from '../../services/api';
import { fmtLen } from '../../utils/cuttingInstructionFormat';
import { UnusedToggle, FatePicker, SourceSelect } from './SourceCorrectionFields';
import useCorrectionPreview from '../../hooks/useCorrectionPreview';
import { choiceFields, remeasureValid, remeasurePayload } from '../../utils/sourceCorrection';

// Manager-only correction for one 1D (bar/profile) offcut_sources entry — the
// 1D analogue of CorrectOffcutModal, mirroring its shape.
//   1. Corrected Remainder — what's really left of the RECORDED source. 0 means
//      nothing usable was left (e.g. damaged). The system never guesses this value;
//      the manager always types the real number.
//   2. "This cut didn't actually come from the recorded source" — resolves an
//      independent replacement source for the same length. The recorded source's own
//      consumption is not reversed by this (only its remainder, via #1), so it is never
//      offered as the replacement.
//   3. The source was never used at all — replaces both of the above: its leftover is
//      removed, a new bar goes back to STOCK (an offcut back to the pool, or as the
//      manager says), and the cut is re-supplied (server: core/inventory/cutCorrection.py).
// The replacement list comes from the server's dry run (previewProfileOffcutCorrection):
// only offcuts long enough for the cut, plus a new bar.
//
// Props:
//   event                 – the offcut_sources entry being corrected
//   orderId, target       – target: { itemId, lineIdx, eventIdx }
//   onConfirm(payload)    – async, performs the API call
//   onClose
export default function CorrectProfileOffcutModal({ event, orderId, target, onConfirm, onClose }) {
    const [remainder, setRemainder] = useState(String(event.remainder_created || 0));
    const [replaceSource, setReplaceSource] = useState(false);
    const [unused, setUnused] = useState(false);
    const [fate, setFate] = useState('available');
    const [parts, setParts] = useState([]);       // usable parts of a damaged source
    const [choice, setChoice] = useState('auto');
    const [notes, setNotes] = useState('');
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState('');

    const fromOffcut = event.source === 'offcut';
    const sourceName = fromOffcut ? `Offcut #${event.offcut_id}` : 'the bar';
    const remainderValid = remainder !== '' && parseFloat(remainder) >= 0;
    const fateOk = !unused || remeasureValid(fate, parts, false);
    const replacing = unused || replaceSource;

    const payload = {
        item_id: target.itemId, line_idx: target.lineIdx, event_idx: target.eventIdx,
        new_remainder_length: unused || !remainderValid ? 0 : parseFloat(remainder),
        replace_source: !unused && replaceSource,
        ...choiceFields(choice),
        source_unused: unused,
        source_fate: fate,
        remeasure: unused ? remeasurePayload(fate, parts, false) : null,
    };
    const preview = useCorrectionPreview(p => api.orderService.previewProfileOffcutCorrection(orderId, p),
        payload, replacing && fateOk && (unused || remainderValid));

    const canSubmit = !loading && fateOk && (unused || remainderValid)
        && (!replacing || (!preview.loading && !!preview.data && !preview.error));

    const handleSubmit = async (e) => {
        e.preventDefault();
        if (!canSubmit) return;
        setLoading(true);
        setError('');
        try {
            await onConfirm({ ...payload, notes });
            onClose();
        } catch (err) {
            setError(err.response?.data?.detail || 'Failed to correct offcut. Please try again.');
        } finally {
            setLoading(false);
        }
    };

    const rep = preview.data?.event;

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
                <div className="modal-header-pad" style={{ padding: '1.25rem 1.5rem', borderBottom: '1px solid rgba(255,255,255,0.07)', background: 'linear-gradient(135deg, rgba(245,158,11,0.1), transparent)', flexShrink: 0 }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                        <div>
                            <h3 style={{ fontSize: '1rem', fontWeight: 800, color: '#f1f5f9', margin: '0 0 3px' }}>Correct Cutting Outcome</h3>
                            <p style={{ fontSize: '0.75rem', color: '#64748b', margin: 0 }}>
                                Cut {fmtLen(event.length_used)} from {fromOffcut ? `Offcut #${event.offcut_id} (${fmtLen(event.offcut_length)} available)` : 'a new bar'} — enter what actually happened
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
                    <div style={{ flex: 1, overflowY: 'auto', padding: '1.25rem 1.5rem' }} className="custom-scrollbar modal-body-pad">
                        {!event.superseded && (
                            <div style={{ marginBottom: '1.25rem' }}>
                                <UnusedToggle checked={unused} onChange={setUnused}
                                    sourceLabel={fromOffcut ? `Offcut #${event.offcut_id}` : 'The new bar'} />
                                {unused && (
                                    <FatePicker fate={fate} setFate={setFate} parts={parts} setParts={setParts}
                                        wholeUnit={!fromOffcut} is2d={false} sourceLabel={sourceName} />
                                )}
                            </div>
                        )}

                        {!unused && (
                            <>
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
                                <div style={{ display: 'flex', gap: '0.75rem', marginTop: '0.5rem', flexWrap: 'wrap' }}>
                                    <button type="button" onClick={() => setRemainder('0')} style={{
                                        background: 'none', border: 'none', color: '#f87171', fontSize: '0.72rem', fontWeight: 700, cursor: 'pointer', whiteSpace: 'nowrap', padding: 0,
                                    }}>Nothing usable (damaged)</button>
                                </div>
                                <p style={{ fontSize: '0.7rem', color: '#475569', margin: '0.5rem 0 0' }}>
                                    This describes what's really left of {fromOffcut ? `Offcut #${event.offcut_id}` : 'the bar'} above — it applies whether or not you also replace the source below.
                                    If none of it was used, tick "never used" above instead.
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
                            </>
                        )}

                        {replacing && (
                            <div style={{ marginTop: '0.25rem' }}>
                                <span style={{ fontSize: '0.62rem', fontWeight: 700, color: '#475569', letterSpacing: '0.08em', textTransform: 'uppercase', display: 'block', margin: '1rem 0 0.375rem' }}>
                                    Replacement Source
                                </span>
                                <SourceSelect value={choice} onChange={setChoice} offcuts={preview.data?.candidates?.offcuts || []} is2d={false}
                                    newOk={(preview.data?.candidates?.bar?.stock ?? 0) >= 1}
                                    newLabel={`New bar (${preview.data?.candidates?.bar?.stock ?? 0} in stock)`} />
                                <div style={{ marginTop: '0.625rem', fontSize: '0.78rem' }}>
                                    {preview.loading && <p style={{ color: '#64748b', margin: 0 }}>Finding a replacement…</p>}
                                    {!preview.loading && preview.error && (
                                        <div style={{ padding: '0.625rem 0.875rem', borderRadius: '0.75rem', background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.25)', color: '#f87171' }}>
                                            {preview.error}
                                        </div>
                                    )}
                                    {!preview.loading && !preview.error && rep && (
                                        <p style={{ color: '#94a3b8', margin: 0 }}>
                                            <span style={{ color: '#fbbf24', fontWeight: 700 }}>Preview:</span>{' '}
                                            {fmtLen(rep.length_used)} from {rep.source === 'offcut' ? `Offcut #${rep.offcut_id} (${fmtLen(rep.offcut_length)})` : 'a new bar'}
                                            {rep.remainder_created > 0 ? `, leaves ${fmtLen(rep.remainder_created)}` : ', nothing left over'}
                                        </p>
                                    )}
                                </div>
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
                    <div className="modal-footer-pad" style={{ padding: '1rem 1.5rem', borderTop: '1px solid rgba(255,255,255,0.07)', display: 'flex', justifyContent: 'flex-end', gap: '0.75rem', background: 'rgba(0,0,0,0.3)', flexShrink: 0, flexWrap: 'wrap' }}>
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
