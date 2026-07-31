import { useState } from 'react';
import { fmtMm } from '../../utils/cuttingInstructionFormat';

// Manager-only correction for one owning offcut_sources event: real-world cutting
// sometimes produces a different remainder than the system predicted at checkout
// (a crack, a chip, a measurement error). Lets the manager replace the recorded
// remainder(s) with what actually came off the sheet — the backend reverses the
// old bucket(s) and applies the corrected one(s).
//
// Props:
//   event      – the offcut_sources event being corrected (has remainders_created)
//   onConfirm(newRemainders, notes) – async, performs the API call
//   onClose
export default function CorrectOffcutModal({ event, onConfirm, onClose }) {
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
    const canSubmit = !loading && validRows.length === rows.length;

    const handleSubmit = async (e) => {
        e.preventDefault();
        if (!canSubmit) return;
        setLoading(true);
        setError('');
        try {
            const newRemainders = rows.map(r => ({ width: parseFloat(r.width), height: parseFloat(r.height), status: r.status }));
            await onConfirm(newRemainders, notes);
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
                width: '100%', maxWidth: '520px', maxHeight: '90vh',
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
                                From {event.source === 'offcut' ? `Offcut #${event.offcut_id}` : 'a new sheet'}{' '}
                                ({fmtMm(event.offcut_width)} x {fmtMm(event.offcut_height)}) — enter what the sheet actually yielded
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
                                        display: 'flex', alignItems: 'center', gap: '0.625rem',
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
