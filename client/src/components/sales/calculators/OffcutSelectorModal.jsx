import { useState, useEffect, useMemo } from 'react';
import api from '../../../services/api';

/**
 * Lets the cashier pick which existing offcuts fulfill a custom cut, before
 * the order is even created. Selection may fall short of requiredLength —
 * any shortfall is auto-topped-up from a fresh bar at order-creation time.
 * Props:
 *   productId, variantId  – identify which offcuts to fetch
 *   requiredLength        – total feet the cut needs
 *   initialSelection      – previously chosen [{offcut_id, length_used}] to restore
 *   cart, cartIndex       – current pending cart + the index being edited (or null when
 *                           adding a new line). Used to discount offcuts already claimed
 *                           by OTHER cart lines that haven't been submitted yet — nothing
 *                           is actually deducted from stock until the order is created, so
 *                           without this the same offcut could be picked twice in one order.
 *   onConfirm(selection)  – called with the chosen [{offcut_id, length_used}]
 *   onClose               – close callback
 */
export default function OffcutSelectorModal({ productId, variantId, requiredLength, initialSelection, cart = [], cartIndex = null, onConfirm, onClose }) {
    const [offcuts, setOffcuts] = useState([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState('');

    // Selection state: { [offcutId]: lengthUsed (string) }
    const [selected, setSelected] = useState(() => {
        const init = {};
        (initialSelection || []).forEach(s => { init[s.offcut_id] = String(s.length_used); });
        return init;
    });

    // How many units of each offcut are already spoken for by other cart lines
    // (each offcut_selection entry consumes exactly one unit of that offcut).
    const claimedElsewhere = useMemo(() => {
        const claims = {};
        cart.forEach((item, idx) => {
            if (idx === cartIndex) return;
            (item.details?.lineItems || []).forEach(line => {
                (line.offcut_selection || []).forEach(s => {
                    claims[s.offcut_id] = (claims[s.offcut_id] || 0) + 1;
                });
            });
        });
        return claims;
    }, [cart, cartIndex]);

    useEffect(() => {
        let cancelled = false;
        setLoading(true);
        api.productService.getOffcuts(productId, variantId)
            .then(data => {
                if (cancelled) return;
                const adjusted = (data || [])
                    .map(oc => ({ ...oc, quantity: oc.quantity - (claimedElsewhere[oc.offcutId] || 0) }))
                    .filter(oc => oc.quantity > 0);
                setOffcuts(adjusted);
            })
            .catch(() => { if (!cancelled) setError('Failed to load offcuts — please try again.'); })
            .finally(() => { if (!cancelled) setLoading(false); });
        return () => { cancelled = true; };
    }, [productId, variantId, claimedElsewhere]);

    const toggle = (oc) => {
        setSelected(prev => {
            if (prev[oc.offcutId] !== undefined) {
                const next = { ...prev };
                delete next[oc.offcutId];
                return next;
            }
            const remaining = Math.max(0, requiredLength - selectedTotalOf(prev));
            const use = Math.min(oc.length, remaining || oc.length);
            return { ...prev, [oc.offcutId]: String(use) };
        });
    };

    const setLen = (id, val) => setSelected(prev => ({ ...prev, [id]: val }));

    const selectedTotalOf = (sel) => Object.values(sel).reduce((sum, v) => sum + (parseFloat(v) || 0), 0);

    const selectedTotal = useMemo(() => selectedTotalOf(selected), [selected]);

    const shortfall = useMemo(() => Math.max(0, Math.round((requiredLength - selectedTotal) * 100) / 100), [requiredLength, selectedTotal]);

    // Mirrors the backend's best-fit search (_fulfill_one_cut_via_best_fit): the
    // smallest offcut, not already claimed by the current selection, that's
    // long enough to cover the shortfall — so the label can name it up front.
    const shortfallBestFit = useMemo(() => {
        if (shortfall <= 0.01) return null;
        const candidates = offcuts
            .map(oc => ({ ...oc, availableQty: oc.quantity - (selected[oc.offcutId] !== undefined ? 1 : 0) }))
            .filter(oc => oc.availableQty > 0 && oc.length >= shortfall - 0.01)
            .sort((a, b) => a.length - b.length);
        return candidates[0] || null;
    }, [offcuts, selected, shortfall]);

    const overSelected = selectedTotal > requiredLength + 0.02;
    const fullyCovered = shortfall <= 0.01;
    const canSubmit = !overSelected && Object.keys(selected).length > 0;

    const handleConfirm = () => {
        if (!canSubmit) return;
        const selection = Object.entries(selected)
            .map(([id, len]) => ({ offcut_id: parseInt(id), length_used: parseFloat(len) }))
            .filter(s => s.length_used > 0);
        onConfirm(selection);
        onClose();
    };

    const handleClearAll = () => setSelected({});

    const fmtLen = (n) => `${parseFloat(n).toFixed(2)} ft`;

    return (
        <div style={{ position: 'fixed', inset: 0, zIndex: 300, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '1rem' }}>
            <div style={{ position: 'absolute', inset: 0, background: 'rgba(9,14,26,0.9)', backdropFilter: 'blur(16px)' }} onClick={onClose} />

            <div style={{
                position: 'relative', width: '100%', maxWidth: '560px', maxHeight: '90vh',
                background: 'linear-gradient(145deg, rgba(13,20,38,0.99), rgba(9,14,26,0.99))',
                border: '1px solid rgba(59,130,246,0.2)',
                borderRadius: '1.5rem', overflow: 'hidden',
                boxShadow: '0 32px 80px rgba(0,0,0,0.7)',
                display: 'flex', flexDirection: 'column',
                animation: 'fadeInScale 0.2s ease',
            }}>
                {/* Header */}
                <div style={{
                    padding: '1.25rem 1.5rem', borderBottom: '1px solid rgba(255,255,255,0.07)',
                    background: 'linear-gradient(135deg, rgba(59,130,246,0.1), transparent)',
                    flexShrink: 0,
                }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                        <div>
                            <h3 style={{ fontSize: '1rem', fontWeight: 800, color: '#f1f5f9', margin: '0 0 3px' }}>
                                Choose Offcuts For This Cut
                            </h3>
                            <p style={{ fontSize: '0.75rem', color: '#64748b', margin: 0 }}>
                                Needs {fmtLen(requiredLength)} total — use existing offcuts to reduce waste
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

                    {/* Available offcuts */}
                    <div style={{ marginBottom: '1.25rem' }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.625rem' }}>
                            <span style={{ fontSize: '0.7rem', color: '#475569', textTransform: 'uppercase', letterSpacing: '0.08em' }}>
                                Available Offcuts
                            </span>
                            {Object.keys(selected).length > 0 && (
                                <button onClick={handleClearAll} style={{
                                    background: 'none', border: 'none', color: '#64748b', fontSize: '0.7rem',
                                    cursor: 'pointer', textDecoration: 'underline',
                                }}>
                                    Clear all
                                </button>
                            )}
                        </div>

                        {loading ? (
                            <p style={{ fontSize: '0.8rem', color: '#475569' }}>Loading offcuts…</p>
                        ) : offcuts.length === 0 ? (
                            <p style={{ fontSize: '0.8rem', color: '#334155', fontStyle: 'italic' }}>
                                No offcuts available. This cut will come from a full bar.
                            </p>
                        ) : (
                            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                                {offcuts.map(oc => {
                                    const isSelected = selected[oc.offcutId] !== undefined;
                                    return (
                                        <div key={oc.offcutId} style={{
                                            display: 'flex', alignItems: 'center', gap: '0.75rem',
                                            padding: '0.75rem 1rem', borderRadius: '0.875rem',
                                            background: isSelected ? 'rgba(59,130,246,0.1)' : 'rgba(255,255,255,0.03)',
                                            border: `1px solid ${isSelected ? 'rgba(59,130,246,0.35)' : 'rgba(255,255,255,0.07)'}`,
                                            cursor: 'pointer', transition: 'all 0.15s',
                                        }}
                                        onClick={() => toggle(oc)}
                                        >
                                            {/* Checkbox */}
                                            <div style={{
                                                width: '18px', height: '18px', borderRadius: '5px', flexShrink: 0,
                                                border: `2px solid ${isSelected ? '#3b82f6' : 'rgba(255,255,255,0.2)'}`,
                                                background: isSelected ? '#3b82f6' : 'transparent',
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
                                                            width: '70px', background: 'rgba(59,130,246,0.1)',
                                                            border: '1px solid rgba(59,130,246,0.3)', borderRadius: '6px',
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
                        background: overSelected ? 'rgba(251,113,133,0.07)' : fullyCovered ? 'rgba(34,197,94,0.07)' : 'rgba(96,165,250,0.07)',
                        border: `1px solid ${overSelected ? 'rgba(251,113,133,0.25)' : fullyCovered ? 'rgba(34,197,94,0.25)' : 'rgba(96,165,250,0.25)'}`,
                        marginBottom: '1rem',
                    }}>
                        {overSelected ? (
                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                                <span style={{ fontSize: '0.8rem', color: '#94a3b8' }}>Selected total</span>
                                <span style={{ fontSize: '0.9rem', fontWeight: 800, fontFamily: 'var(--font-mono)', color: '#f87171' }}>
                                    {fmtLen(selectedTotal)} / {fmtLen(requiredLength)} — over by {fmtLen(selectedTotal - requiredLength)}
                                </span>
                            </div>
                        ) : fullyCovered ? (
                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                                <span style={{ fontSize: '0.8rem', color: '#94a3b8' }}>Fully covered by offcuts</span>
                                <span style={{ fontSize: '0.9rem', fontWeight: 800, fontFamily: 'var(--font-mono)', color: '#4ade80' }}>
                                    {fmtLen(selectedTotal)} ✓
                                </span>
                            </div>
                        ) : (
                            <span style={{ fontSize: '0.8rem', color: '#94a3b8' }}>
                                {Object.keys(selected).length > 0 ? (
                                    <>
                                        {fmtLen(selectedTotal)} from offcuts <strong style={{ color: '#60a5fa' }}>+ {fmtLen(shortfall)} auto-filled</strong> = {fmtLen(requiredLength)}{' '}
                                        <span style={{ color: '#475569' }}>
                                            {shortfallBestFit
                                                ? `(from the ${fmtLen(shortfallBestFit.length)} offcut)`
                                                : '(no offcut fits — from a new bar)'}
                                        </span>
                                    </>
                                ) : (
                                    <>
                                        No offcuts selected — {fmtLen(requiredLength)} will be auto-filled{' '}
                                        {shortfallBestFit
                                            ? <>from the <strong style={{ color: '#60a5fa' }}>{fmtLen(shortfallBestFit.length)} offcut</strong></>
                                            : <>from a new bar <span style={{ color: '#475569' }}>(no offcut fits)</span></>}
                                    </>
                                )}
                            </span>
                        )}
                    </div>

                    {error && (
                        <div style={{
                            padding: '0.625rem 0.875rem', borderRadius: '0.75rem',
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
                        onClick={handleConfirm}
                        disabled={!canSubmit}
                        style={{
                            padding: '0.625rem 1.5rem', borderRadius: '0.75rem', border: 'none',
                            background: canSubmit
                                ? 'linear-gradient(135deg, #3b82f6, #06b6d4)'
                                : 'rgba(255,255,255,0.06)',
                            color: canSubmit ? '#fff' : '#475569',
                            fontWeight: 700, fontSize: '0.82rem',
                            cursor: canSubmit ? 'pointer' : 'not-allowed',
                            boxShadow: canSubmit ? '0 4px 16px rgba(59,130,246,0.35)' : 'none',
                            transition: 'all 0.2s',
                        }}
                    >
                        Use These Offcuts
                    </button>
                </div>
            </div>
        </div>
    );
}
