import { useState, useMemo } from 'react';
import api from '../../services/api';

/**
 * Lets the store manager pick which existing offcuts fulfill a cut line item.
 * Props:
 *   orderId       – order being edited
 *   item          – StoreItemResponse (has item_id, product_name, details, available_offcuts)
 *   cutLineIndex  – index in details.lineItems[] that is the cut line
 *   onClose       – close callback
 *   onSuccess     – called after a successful reassignment (triggers parent refresh)
 */
export default function OffcutReassignModal({ orderId, item, cutLineIndex, onClose, onSuccess }) {
    const cutLine = item.details?.lineItems?.[cutLineIndex] ?? {};
    const cutLen = parseFloat(cutLine.meta?.length ?? 0);
    const qty = parseInt(cutLine.qty ?? 1);
    const requiredTotal = parseFloat((cutLen * qty).toFixed(4));
    const currentSources = cutLine.offcut_sources ?? [];

    // Selection state: { [offcutId]: lengthUsed (string) }
    const [selected, setSelected] = useState({});
    const [notes, setNotes] = useState('');
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState('');

    const toggle = (oc) => {
        setSelected(prev => {
            if (prev[oc.offcutId] !== undefined) {
                const next = { ...prev };
                delete next[oc.offcutId];
                return next;
            }
            return { ...prev, [oc.offcutId]: String(oc.length) };
        });
    };

    const setLen = (id, val) => setSelected(prev => ({ ...prev, [id]: val }));

    const selectedTotal = useMemo(() =>
        Object.values(selected).reduce((sum, v) => sum + (parseFloat(v) || 0), 0)
    , [selected]);

    const totalOk = Math.abs(selectedTotal - requiredTotal) <= 0.02;
    const canSubmit = totalOk && Object.keys(selected).length > 0;

    const handleSubmit = async () => {
        if (!canSubmit) return;
        setLoading(true);
        setError('');
        try {
            const new_sources = Object.entries(selected).map(([id, len]) => ({
                offcut_id: parseInt(id),
                length_used: parseFloat(len),
            }));
            await api.orderService.reassignOffcut(orderId, item.item_id, {
                cut_line_index: cutLineIndex,
                new_sources,
                notes: notes.trim() || null,
            });
            onSuccess?.();
            onClose();
        } catch (err) {
            setError(err.response?.data?.detail ?? 'Reassignment failed — please try again.');
        } finally {
            setLoading(false);
        }
    };

    const fmtLen = (n) => `${parseFloat(n).toFixed(2)} ft`;

    return (
        <div style={{ position: 'fixed', inset: 0, zIndex: 200, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '1rem' }}>
            <div style={{ position: 'absolute', inset: 0, background: 'rgba(9,14,26,0.9)', backdropFilter: 'blur(16px)' }} onClick={onClose} />

            <div style={{
                position: 'relative', width: '100%', maxWidth: '560px', maxHeight: '90vh',
                background: 'linear-gradient(145deg, rgba(13,20,38,0.99), rgba(9,14,26,0.99))',
                border: '1px solid rgba(168,85,247,0.2)',
                borderRadius: '1.5rem', overflow: 'hidden',
                boxShadow: '0 32px 80px rgba(0,0,0,0.7)',
                display: 'flex', flexDirection: 'column',
                animation: 'fadeInScale 0.2s ease',
            }}>
                {/* Header */}
                <div style={{
                    padding: '1.25rem 1.5rem', borderBottom: '1px solid rgba(255,255,255,0.07)',
                    background: 'linear-gradient(135deg, rgba(168,85,247,0.1), transparent)',
                    flexShrink: 0,
                }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                        <div>
                            <h3 style={{ fontSize: '1rem', fontWeight: 800, color: '#f1f5f9', margin: '0 0 3px' }}>
                                Reassign Offcut Source
                            </h3>
                            <p style={{ fontSize: '0.75rem', color: '#64748b', margin: 0 }}>
                                {item.product_name}{item.variant_name ? ` — ${item.variant_name}` : ''}
                            </p>
                        </div>
                        <button onClick={onClose} style={{
                            width: '30px', height: '30px', borderRadius: '8px', border: '1px solid rgba(255,255,255,0.1)',
                            background: 'rgba(255,255,255,0.05)', color: '#64748b', cursor: 'pointer',
                            display: 'flex', alignItems: 'center', justifyContent: 'center',
                        }}>✕</button>
                    </div>
                </div>

                <div style={{ flex: 1, overflowY: 'auto', padding: '1.25rem 1.5rem' }} className="custom-scrollbar">

                    {/* Cut requirement */}
                    <div style={{
                        padding: '0.875rem 1rem', borderRadius: '0.875rem',
                        background: 'rgba(168,85,247,0.07)', border: '1px solid rgba(168,85,247,0.15)',
                        marginBottom: '1.25rem',
                    }}>
                        <div style={{ fontSize: '0.7rem', color: '#94a3b8', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: '0.5rem' }}>
                            Cut Requirement
                        </div>
                        <div style={{ display: 'flex', gap: '1.5rem', flexWrap: 'wrap' }}>
                            <span style={{ fontSize: '0.82rem', color: '#e2e8f0' }}>
                                Length: <strong style={{ color: '#c084fc', fontFamily: 'var(--font-mono)' }}>{fmtLen(cutLen)}</strong>
                            </span>
                            <span style={{ fontSize: '0.82rem', color: '#e2e8f0' }}>
                                Qty: <strong style={{ color: '#c084fc', fontFamily: 'var(--font-mono)' }}>×{qty}</strong>
                            </span>
                            <span style={{ fontSize: '0.82rem', color: '#e2e8f0' }}>
                                Total needed: <strong style={{ color: '#c084fc', fontFamily: 'var(--font-mono)' }}>{fmtLen(requiredTotal)}</strong>
                            </span>
                        </div>
                    </div>

                    {/* Current sources */}
                    {currentSources.length > 0 && (
                        <div style={{ marginBottom: '1.25rem' }}>
                            <div style={{ fontSize: '0.7rem', color: '#475569', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: '0.5rem' }}>
                                Current Assignment
                            </div>
                            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.375rem' }}>
                                {currentSources.map((s, i) => (
                                    <div key={i} style={{
                                        padding: '0.5rem 0.875rem', borderRadius: '0.625rem',
                                        background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.06)',
                                        fontSize: '0.75rem', color: '#64748b', fontFamily: 'var(--font-mono)',
                                        display: 'flex', gap: '1rem', flexWrap: 'wrap',
                                    }}>
                                        <span style={{ color: s.source === 'offcut' ? '#a78bfa' : '#fb923c' }}>
                                            {s.source === 'offcut' ? `Offcut #${s.offcut_id}` : 'Full bar'}
                                        </span>
                                        <span>Used: {fmtLen(s.length_used)}</span>
                                        {s.remainder_created > 0 && <span style={{ color: '#64748b' }}>→ {fmtLen(s.remainder_created)} remainder</span>}
                                    </div>
                                ))}
                            </div>
                        </div>
                    )}

                    {/* Available offcuts */}
                    <div style={{ marginBottom: '1.25rem' }}>
                        <div style={{ fontSize: '0.7rem', color: '#475569', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: '0.625rem' }}>
                            Available Offcuts — select to use
                        </div>
                        {item.available_offcuts.length === 0 ? (
                            <p style={{ fontSize: '0.8rem', color: '#334155', fontStyle: 'italic' }}>
                                No offcuts available. The cut must come from a full bar.
                            </p>
                        ) : (
                            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                                {item.available_offcuts.map(oc => {
                                    const isSelected = selected[oc.offcutId] !== undefined;
                                    return (
                                        <div key={oc.offcutId} style={{
                                            display: 'flex', alignItems: 'center', gap: '0.75rem',
                                            padding: '0.75rem 1rem', borderRadius: '0.875rem',
                                            background: isSelected ? 'rgba(168,85,247,0.1)' : 'rgba(255,255,255,0.03)',
                                            border: `1px solid ${isSelected ? 'rgba(168,85,247,0.35)' : 'rgba(255,255,255,0.07)'}`,
                                            cursor: 'pointer', transition: 'all 0.15s',
                                        }}
                                        onClick={() => toggle(oc)}
                                        >
                                            {/* Checkbox */}
                                            <div style={{
                                                width: '18px', height: '18px', borderRadius: '5px', flexShrink: 0,
                                                border: `2px solid ${isSelected ? '#a855f7' : 'rgba(255,255,255,0.2)'}`,
                                                background: isSelected ? '#a855f7' : 'transparent',
                                                display: 'flex', alignItems: 'center', justifyContent: 'center',
                                                fontSize: '0.7rem', color: '#fff',
                                            }}>
                                                {isSelected && '✓'}
                                            </div>

                                            <div style={{ flex: 1 }}>
                                                <span style={{ fontSize: '0.85rem', fontWeight: 700, color: '#e2e8f0', fontFamily: 'var(--font-mono)' }}>
                                                    {fmtLen(oc.length)}
                                                </span>
                                                <span style={{ fontSize: '0.72rem', color: '#475569', marginLeft: '0.5rem' }}>
                                                    qty: {oc.quantity}
                                                </span>
                                            </div>

                                            {/* Length input when selected */}
                                            {isSelected && (
                                                <div onClick={e => e.stopPropagation()} style={{ display: 'flex', alignItems: 'center', gap: '0.375rem' }}>
                                                    <span style={{ fontSize: '0.7rem', color: '#64748b' }}>use:</span>
                                                    <input
                                                        type="number"
                                                        step="0.01"
                                                        min="0.01"
                                                        max={oc.length}
                                                        value={selected[oc.offcutId]}
                                                        onChange={e => setLen(oc.offcutId, e.target.value)}
                                                        style={{
                                                            width: '70px', background: 'rgba(168,85,247,0.1)',
                                                            border: '1px solid rgba(168,85,247,0.3)', borderRadius: '6px',
                                                            color: '#e2e8f0', fontSize: '0.8rem', padding: '3px 6px',
                                                            outline: 'none', textAlign: 'right',
                                                        }}
                                                    />
                                                    <span style={{ fontSize: '0.7rem', color: '#64748b' }}>ft</span>
                                                </div>
                                            )}
                                        </div>
                                    );
                                })}
                            </div>
                        )}
                    </div>

                    {/* Running total */}
                    <div style={{
                        padding: '0.75rem 1rem', borderRadius: '0.875rem',
                        background: totalOk ? 'rgba(34,197,94,0.07)' : 'rgba(251,113,133,0.07)',
                        border: `1px solid ${totalOk ? 'rgba(34,197,94,0.25)' : 'rgba(251,113,133,0.25)'}`,
                        marginBottom: '1rem',
                        display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                    }}>
                        <span style={{ fontSize: '0.8rem', color: '#94a3b8' }}>Selected total</span>
                        <span style={{
                            fontSize: '0.9rem', fontWeight: 800, fontFamily: 'var(--font-mono)',
                            color: totalOk ? '#4ade80' : '#f87171',
                        }}>
                            {fmtLen(selectedTotal)} / {fmtLen(requiredTotal)}
                            {totalOk ? ' ✓' : ` (need ${fmtLen(requiredTotal - selectedTotal)} more)`}
                        </span>
                    </div>

                    {/* Notes */}
                    <textarea
                        placeholder="Notes (optional)"
                        value={notes}
                        onChange={e => setNotes(e.target.value)}
                        rows={2}
                        style={{
                            width: '100%', background: 'rgba(255,255,255,0.04)',
                            border: '1px solid rgba(255,255,255,0.1)', borderRadius: '0.75rem',
                            color: '#e2e8f0', fontSize: '0.8rem', padding: '0.625rem 0.875rem',
                            outline: 'none', resize: 'vertical', boxSizing: 'border-box',
                        }}
                    />

                    {error && (
                        <div style={{
                            marginTop: '0.75rem', padding: '0.625rem 0.875rem', borderRadius: '0.75rem',
                            background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.25)',
                            color: '#f87171', fontSize: '0.78rem',
                        }}>
                            {error}
                        </div>
                    )}
                </div>

                {/* Footer */}
                <div style={{
                    padding: '1rem 1.5rem', borderTop: '1px solid rgba(255,255,255,0.07)',
                    display: 'flex', justifyContent: 'flex-end', gap: '0.75rem',
                    background: 'rgba(0,0,0,0.3)', flexShrink: 0,
                }}>
                    <button onClick={onClose} style={{
                        padding: '0.625rem 1.25rem', borderRadius: '0.75rem',
                        border: '1px solid rgba(255,255,255,0.1)', background: 'rgba(255,255,255,0.05)',
                        color: '#64748b', fontSize: '0.82rem', cursor: 'pointer',
                    }}>
                        Cancel
                    </button>
                    <button
                        onClick={handleSubmit}
                        disabled={!canSubmit || loading}
                        style={{
                            padding: '0.625rem 1.5rem', borderRadius: '0.75rem', border: 'none',
                            background: canSubmit && !loading
                                ? 'linear-gradient(135deg, #a855f7, #7c3aed)'
                                : 'rgba(255,255,255,0.06)',
                            color: canSubmit && !loading ? '#fff' : '#475569',
                            fontWeight: 700, fontSize: '0.82rem',
                            cursor: canSubmit && !loading ? 'pointer' : 'not-allowed',
                            boxShadow: canSubmit && !loading ? '0 4px 16px rgba(168,85,247,0.35)' : 'none',
                            transition: 'all 0.2s',
                        }}
                    >
                        {loading ? 'Applying…' : 'Apply Reassignment'}
                    </button>
                </div>
            </div>
        </div>
    );
}
