import { useEffect, useRef, useState } from 'react';
import api from '../../services/api';
import { fmtMm, REVIEW_THEME } from '../../utils/cuttingInstructionFormat';
import CuttingInstructions from './CuttingInstructions';

// Manager-only correction for one owning offcut_sources event. Two independent
// things can be wrong about a recorded cutting event, both fixed here in one
// combined Save:
//   1. The remainder(s) it left behind differ from what was predicted (a
//      crack, a chip, a measurement error) — edited directly below.
//   2. One or more of its own delivered cuts never actually came out of this
//      source at all (the cutter missed) — checked off in "Cuts From This
//      Source", which triggers a live dry-run preview of the replacement
//      offcut/sheet the system would use to actually supply them (overridable
//      via the picker). Nothing for #2 is persisted until Save.
//
// Props:
//   event                 – the offcut_sources event being corrected
//   productId, variantId  – identify which offcuts to preview/pick against
//   onConfirm(newRemainders, notes, failedCutIndices, forcedOffcutId) – async, performs the API call
//   onClose
export default function CorrectOffcutModal({ event, productId, variantId, onConfirm, onClose }) {
    const [rows, setRows] = useState(() =>
        (event.remainders_created || []).map(r => ({ width: String(r.width), height: String(r.height), status: r.status || 'available' }))
    );
    const [notes, setNotes] = useState('');
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState('');

    const updateRow = (idx, field, value) => setRows(prev => prev.map((r, i) => i === idx ? { ...r, [field]: value } : r));
    const removeRow = (idx) => setRows(prev => prev.filter((_, i) => i !== idx));
    const addRow = () => setRows(prev => [...prev, { width: '', height: '', status: 'available' }]);

    const validRows = rows.filter(r => parseFloat(r.width) > 0 && parseFloat(r.height) > 0);
    const canSubmitRemainders = validRows.length === rows.length;

    // ── Failed cuts + replacement preview ───────────────────────────────────
    const cuts = event.cuts || [];
    const [failedIndices, setFailedIndices] = useState(() => new Set());
    const [forcedOffcutId, setForcedOffcutId] = useState('');
    const [offcuts, setOffcuts] = useState([]);
    const [preview, setPreview] = useState(null);
    const [previewLoading, setPreviewLoading] = useState(false);
    const [previewError, setPreviewError] = useState('');

    const toggleFailed = (idx) => setFailedIndices(prev => {
        const next = new Set(prev);
        if (next.has(idx)) next.delete(idx); else next.add(idx);
        return next;
    });

    // Offcuts for the override picker — loaded once, only needed if there's
    // something to possibly replace.
    useEffect(() => {
        if (!productId || cuts.length === 0) return;
        let cancelled = false;
        api.productService.getOffcuts(productId, variantId)
            .then(data => { if (!cancelled) setOffcuts(data || []); })
            .catch(() => { /* picker just stays empty — auto-suggestion still works */ });
        return () => { cancelled = true; };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [productId, variantId]);

    // Debounced dry-run preview of the replacement source, re-run whenever the
    // checked failed cuts or the manager's override choice changes.
    const previewSeqRef = useRef(0);
    useEffect(() => {
        if (failedIndices.size === 0) {
            setPreview(null);
            setPreviewError('');
            return;
        }
        const mySeq = ++previewSeqRef.current;
        setPreviewLoading(true);
        setPreviewError('');
        const timer = setTimeout(() => {
            const pieces = Array.from(failedIndices).map(i => ({ width: cuts[i].width, height: cuts[i].height }));
            api.productService.previewOffcutReplacement(productId, {
                variantId, pieces, forcedOffcutId: forcedOffcutId || undefined,
            })
                .then(res => {
                    if (previewSeqRef.current !== mySeq) return;
                    setPreview(res);
                    setPreviewLoading(false);
                })
                .catch(err => {
                    if (previewSeqRef.current !== mySeq) return;
                    setPreview(null);
                    setPreviewLoading(false);
                    setPreviewError(err.response?.data?.detail || 'Could not find a replacement offcut for these pieces.');
                });
        }, 400);
        return () => clearTimeout(timer);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [failedIndices, forcedOffcutId, productId, variantId]);

    const canSubmit = !loading && canSubmitRemainders && (failedIndices.size === 0 || (!previewLoading && preview && !previewError));

    const handleSubmit = async (e) => {
        e.preventDefault();
        if (!canSubmit) return;
        setLoading(true);
        setError('');
        try {
            const newRemainders = rows.map(r => ({ width: parseFloat(r.width), height: parseFloat(r.height), status: r.status }));
            await onConfirm(newRemainders, notes, Array.from(failedIndices), forcedOffcutId ? parseInt(forcedOffcutId) : null);
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
                width: '100%', maxWidth: '560px', maxHeight: '90vh',
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
                                From {event.source === 'offcut' ? `Offcut #${event.offcut_id}` : 'a new sheet'}{' '}
                                ({fmtMm(event.offcut_width)} x {fmtMm(event.offcut_height)}) — enter what actually happened
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
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.625rem' }}>
                            <span style={{ fontSize: '0.7rem', color: '#475569', textTransform: 'uppercase', letterSpacing: '0.08em' }}>
                                Corrected Remainder(s)
                            </span>
                            <button type="button" onClick={addRow} style={{
                                background: 'none', border: 'none', color: '#fbbf24', fontSize: '0.75rem', fontWeight: 700, cursor: 'pointer',
                            }}>+ Add piece</button>
                        </div>

                        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.625rem' }}>
                            {rows.map((row, idx) => {
                                const invalid = !(parseFloat(row.width) > 0 && parseFloat(row.height) > 0);
                                return (
                                    <div key={idx} style={{
                                        display: 'flex', alignItems: 'center', gap: '0.625rem', flexWrap: 'wrap',
                                        padding: '0.75rem 1rem', borderRadius: '0.875rem',
                                        background: 'rgba(255,255,255,0.03)', border: `1px solid ${invalid ? 'rgba(239,68,68,0.3)' : 'rgba(255,255,255,0.07)'}`,
                                    }}>
                                        <input type="number" step="1" min="0" placeholder="width mm" value={row.width}
                                            onChange={e => updateRow(idx, 'width', e.target.value)}
                                            style={{ width: '90px', background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: '6px', color: '#e2e8f0', fontSize: '0.82rem', padding: '5px 8px', outline: 'none' }} />
                                        <span style={{ color: '#475569' }}>×</span>
                                        <input type="number" step="1" min="0" placeholder="height mm" value={row.height}
                                            onChange={e => updateRow(idx, 'height', e.target.value)}
                                            style={{ width: '90px', background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: '6px', color: '#e2e8f0', fontSize: '0.82rem', padding: '5px 8px', outline: 'none' }} />
                                        <select value={row.status} onChange={e => updateRow(idx, 'status', e.target.value)} style={{
                                            flex: 1, background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: '6px',
                                            color: '#e2e8f0', fontSize: '0.78rem', padding: '5px 8px', outline: 'none',
                                        }}>
                                            <option value="available">Available</option>
                                            <option value="scrap">Scrap</option>
                                        </select>
                                        <button type="button" onClick={() => removeRow(idx)} style={{
                                            background: 'none', border: 'none', color: '#64748b', cursor: 'pointer', fontSize: '0.9rem', flexShrink: 0,
                                        }}>✕</button>
                                    </div>
                                );
                            })}
                            {rows.length === 0 && (
                                <p style={{ fontSize: '0.78rem', color: '#334155', fontStyle: 'italic' }}>
                                    No remainder pieces — this cut left nothing usable.
                                </p>
                            )}
                        </div>

                        {cuts.length > 0 && (
                            <div style={{ marginTop: '1.25rem' }}>
                                <span style={{ fontSize: '0.7rem', color: '#475569', textTransform: 'uppercase', letterSpacing: '0.08em', display: 'block', marginBottom: '0.625rem' }}>
                                    Cuts From This Source
                                </span>
                                <p style={{ fontSize: '0.72rem', color: '#64748b', margin: '0 0 0.625rem' }}>
                                    Check any piece the cutter missed — it never actually came out of this source.
                                </p>
                                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                                    {cuts.map((c, idx) => {
                                        const checked = failedIndices.has(idx);
                                        return (
                                            <label key={idx} style={{
                                                display: 'flex', alignItems: 'center', gap: '0.625rem', cursor: 'pointer',
                                                padding: '0.625rem 1rem', borderRadius: '0.875rem',
                                                background: checked ? 'rgba(239,68,68,0.08)' : 'rgba(255,255,255,0.03)',
                                                border: `1px solid ${checked ? 'rgba(239,68,68,0.3)' : 'rgba(255,255,255,0.07)'}`,
                                            }}>
                                                <input type="checkbox" checked={checked} onChange={() => toggleFailed(idx)}
                                                    style={{ width: '16px', height: '16px', flexShrink: 0, accentColor: '#ef4444' }} />
                                                <span style={{ fontSize: '0.82rem', color: '#e2e8f0', fontWeight: 600 }}>
                                                    {fmtMm(c.width)} x {fmtMm(c.height)}
                                                </span>
                                                {c.rotated && <span style={{ fontSize: '0.7rem', color: '#64748b' }}>(rotated to fit)</span>}
                                                {checked && <span style={{ fontSize: '0.68rem', color: '#f87171', marginLeft: 'auto', fontWeight: 700 }}>MISSED</span>}
                                            </label>
                                        );
                                    })}
                                </div>
                            </div>
                        )}

                        {failedIndices.size > 0 && (
                            <div style={{ marginTop: '1rem' }}>
                                <label style={{ fontSize: '0.62rem', fontWeight: 700, color: '#475569', letterSpacing: '0.08em', textTransform: 'uppercase', display: 'block', marginBottom: '0.375rem' }}>
                                    Replacement Offcut
                                </label>
                                <select value={forcedOffcutId} onChange={e => setForcedOffcutId(e.target.value)} style={{
                                    width: '100%', boxSizing: 'border-box', padding: '0.625rem 0.75rem',
                                    background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: '0.625rem',
                                    color: '#e2e8f0', fontSize: '0.8rem', outline: 'none',
                                }}>
                                    <option value="">Let system choose (best fit)</option>
                                    {offcuts.map(oc => (
                                        <option key={oc.offcutId} value={oc.offcutId}>
                                            Offcut #{oc.offcutId} — {fmtMm(oc.width)} x {fmtMm(oc.height)} (qty {oc.quantity})
                                        </option>
                                    ))}
                                </select>

                                <div style={{ marginTop: '0.75rem' }}>
                                    {previewLoading && (
                                        <p style={{ fontSize: '0.78rem', color: '#64748b' }}>Finding a replacement…</p>
                                    )}
                                    {previewError && (
                                        <div style={{ padding: '0.625rem 0.875rem', borderRadius: '0.75rem', background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.25)', color: '#f87171', fontSize: '0.78rem' }}>
                                            {previewError}
                                        </div>
                                    )}
                                    {!previewLoading && !previewError && preview && (
                                        <div>
                                            <div style={{ fontSize: '0.68rem', fontWeight: 700, color: '#fbbf24', letterSpacing: '0.06em', textTransform: 'uppercase', marginBottom: '0.375rem' }}>
                                                Preview — not yet saved
                                            </div>
                                            <CuttingInstructions sources={preview.events} theme={REVIEW_THEME} />
                                        </div>
                                    )}
                                </div>
                            </div>
                        )}

                        <div style={{ marginTop: '1.25rem' }}>
                            <label style={{ fontSize: '0.62rem', fontWeight: 700, color: '#475569', letterSpacing: '0.08em', textTransform: 'uppercase', display: 'block', marginBottom: '0.375rem' }}>
                                Notes (optional)
                            </label>
                            <textarea value={notes} onChange={e => setNotes(e.target.value)} rows={2} placeholder="e.g. glass cracked during the cut, real offcut was smaller"
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
