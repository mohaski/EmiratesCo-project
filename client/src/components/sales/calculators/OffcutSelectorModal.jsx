import { useState, useEffect, useMemo } from 'react';
import api from '../../../services/api';
import { useCart } from '../../../context/CartContext';
import ProvisionalBadge from '../../offcuts/ProvisionalBadge';

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
 *   projection            – editing a saved order: { orderId, itemId, answers }. The list is
 *                           then the pool as it will be once that item is reversed with those
 *                           cut answers, including the pieces the edit hands back (the uncut
 *                           length joined onto what's left of the bar, the cut piece itself...).
 *                           A pick of one of those carries `returned_ref`, which the edit
 *                           resolves to the piece it actually produces.
 *   initialNewBar         – the cut was set to come from a new bar
 *   onConfirm(selection, { newBar }) – called with the chosen [{offcut_id, length_used, returned_ref?}].
 *                           newBar true: whatever the picked offcuts don't cover comes from a new
 *                           bar, not another offcut (line source_pref); with nothing picked, the
 *                           whole cut comes from a new bar.
 *   onClose               – close callback
 */
export default function OffcutSelectorModal({ productId, variantId, requiredLength, initialSelection, initialNewBar = false, cart = [], cartIndex = null, projection = null, onConfirm, onClose }) {
    const [newBar, setNewBar] = useState(!!initialNewBar);
    const [offcuts, setOffcuts] = useState([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState('');
    const { windowMode, holdOrderId } = useCart();

    // Selection state: { [offcutId]: [lengthUsed (string), ...] } - one entry per PIECE taken
    // from that row. Same-size offcuts share one pooled row (quantity > 1), so a cut can use
    // several of them; each becomes its own offcut_selection entry, which the server consumes
    // one unit at a time (_consume_offcut_sources).
    const [selected, setSelected] = useState(() => {
        const init = {};
        (initialSelection || []).forEach(s => {
            const key = s.returned_ref ? `ref:${s.returned_ref}` : s.offcut_id;
            (init[key] = init[key] || []).push(String(s.length_used));
        });
        return init;
    });
    // A piece this edit hands back is one specific piece; any other row offers every unit it has.
    const maxUnits = (oc) => (oc.returned?.length ? 1 : oc.quantity);
    const [trimmedNote, setTrimmedNote] = useState('');
    const projectionKey = projection ? JSON.stringify(projection) : null;

    // How many units of each offcut are already spoken for by other cart lines
    // (each offcut_selection entry consumes exactly one unit of that offcut).
    //
    // Not in a sale window: there the other lines' picks are already TAKEN on the server, so
    // the listing no longer contains them — subtracting them again would hide real pieces.
    const claimedElsewhere = useMemo(() => {
        const claims = {};
        if (windowMode) return claims;
        cart.forEach((item, idx) => {
            if (idx === cartIndex) return;
            (item.details?.lineItems || []).forEach(line => {
                (line.offcut_selection || []).forEach(s => {
                    claims[s.offcut_id] = (claims[s.offcut_id] || 0) + 1;
                });
            });
        });
        return claims;
    }, [cart, cartIndex, windowMode]);

    // Re-editing a line in a sale window: the offcuts this very line cut from are held by the
    // window, so the listing doesn't show them. They come back to it when the cart is saved
    // (the server re-resolves the whole window), so offer them again — under the ids the
    // server will follow them by. Not a piece the line cut out of its OWN leftover (two 9ft
    // cuts: the second from the first bar's 12ft): that leftover is undone with the line.
    const ownSources = useMemo(() => {
        if (!windowMode || cartIndex === null || !cart[cartIndex]) return [];
        const sources = (cart[cartIndex].details?.lineItems || []).flatMap(line => line.offcut_sources || []);
        const ownLeftovers = new Set(sources.map(src => src.remainder_piece_id).filter(Boolean));
        return sources
            .filter(src => src.source === 'offcut' && src.offcut_id && !ownLeftovers.has(src.source_piece_id))
            .map(src => ({ offcutId: src.offcut_id, length: src.offcut_length, quantity: 1, status: 'available' }));
    }, [windowMode, cart, cartIndex]);
    // The window line being reopened: the listing leaves out the window's leftovers this line
    // (or a later one) made - 9ft from a new 21ft bar must not offer its own 12ft back.
    const heldItemId = windowMode && cartIndex !== null ? (cart[cartIndex]?.details?._heldItemId ?? null) : null;

    useEffect(() => {
        let cancelled = false;
        setLoading(true);
        const proj = projectionKey ? JSON.parse(projectionKey) : null;
        // Editing a saved order: what the pool will hold once this item's material is given
        // back. A sale window: the public pool plus the window's own held remainders, and
        // this line's own sources (held by the window, so not listed) offered again.
        const load = proj
            ? api.orderService.projectedOffcuts(proj.orderId, proj.itemId, proj.answers, variantId).then(res =>
                (res.offcuts || []).map(r => ({
                    ...r,
                    // Rows the reversal creates have no id yet; they are picked by returned_ref.
                    offcutId: r.returned?.length ? `ref:${r.returned[0].ref}` : r.offcutId,
                    realOffcutId: r.offcutId,
                })))
            : api.productService.getOffcuts(productId, variantId, holdOrderId, heldItemId).then(data => {
                const listed = [...(data || [])];
                ownSources.forEach(src => {
                    const same = listed.find(oc => oc.offcutId === src.offcutId);
                    if (same) same.quantity += 1; else listed.push(src);
                });
                return listed;
            });
        load
            .then(data => {
                if (cancelled) return;
                const adjusted = (data || [])
                    .map(oc => ({ ...oc, quantity: oc.quantity - (claimedElsewhere[oc.realOffcutId ?? oc.offcutId] || 0) }))
                    .filter(oc => oc.quantity > 0)
                    // Pieces this edit hands back first - the ones the cashier is thinking of.
                    .sort((a, b) => (b.returned?.length ? 1 : 0) - (a.returned?.length ? 1 : 0));
                setOffcuts(adjusted);
                // A reopened pick may name more pieces of a row than it still has (other lines
                // or tills took some since): keep only what is there, and say so.
                setSelected(prev => {
                    let trimmed = false;
                    const next = { ...prev };
                    adjusted.forEach(oc => {
                        const units = next[oc.offcutId];
                        const cap = oc.returned?.length ? 1 : oc.quantity;
                        if (units && units.length > cap) { next[oc.offcutId] = units.slice(0, cap); trimmed = true; }
                    });
                    if (trimmed) setTrimmedNote('Some pieces you had picked are no longer available - fewer are selected now.');
                    return trimmed ? next : prev;
                });
            })
            .catch(() => { if (!cancelled) setError('Failed to load offcuts — please try again.'); })
            .finally(() => { if (!cancelled) setLoading(false); });
        return () => { cancelled = true; };
    }, [productId, variantId, claimedElsewhere, projectionKey, holdOrderId, heldItemId, ownSources]);

    // Each new piece starts at what is still needed (capped at the piece's length).
    const nextUse = (oc, sel) => {
        const remaining = Math.max(0, requiredLength - selectedTotalOf(sel));
        return String(Math.min(oc.length, remaining || oc.length));
    };

    const toggle = (oc) => {
        setSelected(prev => {
            if (prev[oc.offcutId]?.length) {
                const next = { ...prev };
                delete next[oc.offcutId];
                return next;
            }
            return { ...prev, [oc.offcutId]: [nextUse(oc, prev)] };
        });
    };

    const addPiece = (oc) => setSelected(prev => {
        const units = prev[oc.offcutId] || [];
        if (units.length >= maxUnits(oc)) return prev;
        return { ...prev, [oc.offcutId]: [...units, nextUse(oc, prev)] };
    });

    const removePiece = (oc) => setSelected(prev => {
        const units = prev[oc.offcutId] || [];
        if (units.length <= 1) {
            const next = { ...prev };
            delete next[oc.offcutId];
            return next;
        }
        return { ...prev, [oc.offcutId]: units.slice(0, -1) };
    });

    const setLen = (id, idx, val) => setSelected(prev => ({
        ...prev, [id]: (prev[id] || []).map((v, i) => (i === idx ? val : v)),
    }));

    const selectedTotalOf = (sel) => Object.values(sel).flat().reduce((sum, v) => sum + (parseFloat(v) || 0), 0);
    const piecesSelected = Object.values(selected).reduce((n, units) => n + units.length, 0);

    const selectedTotal = useMemo(() => selectedTotalOf(selected), [selected]);

    const shortfall = useMemo(() => Math.max(0, Math.round((requiredLength - selectedTotal) * 100) / 100), [requiredLength, selectedTotal]);

    // Mirrors the backend's best-fit search (_fulfill_one_cut_via_best_fit): the
    // smallest offcut, not already claimed by the current selection, that's
    // long enough to cover the shortfall — so the label can name it up front.
    const shortfallBestFit = useMemo(() => {
        if (shortfall <= 0.01) return null;
        const candidates = offcuts
            .map(oc => ({ ...oc, availableQty: oc.quantity - (selected[oc.offcutId] || []).length }))
            .filter(oc => oc.availableQty > 0 && oc.length >= shortfall - 0.01)
            .sort((a, b) => a.length - b.length);
        return candidates[0] || null;
    }, [offcuts, selected, shortfall]);

    const overSelected = selectedTotal > requiredLength + 0.02;
    const fullyCovered = shortfall <= 0.01;
    // New bar on its own is a complete choice; picked offcuts must never exceed the cut.
    const canSubmit = !overSelected && (newBar || piecesSelected > 0);

    const handleConfirm = () => {
        if (!canSubmit) return;
        // One entry per piece, in the order they were picked.
        const selection = Object.entries(selected)
            .flatMap(([id, units]) => units.map(len => {
                const row = offcuts.find(o => String(o.offcutId) === String(id));
                const back = row?.returned?.[0];
                if (back) {
                    return { offcut_id: row.realOffcutId ?? null, length_used: parseFloat(len),
                             returned_ref: back.ref, returned_label: back.label };
                }
                return { offcut_id: parseInt(id), length_used: parseFloat(len) };
            }))
            .filter(s => s.length_used > 0);
        onConfirm(selection, { newBar });
        onClose();
    };

    const handleClearAll = () => setSelected({});

    const fmtLen = (n) => `${parseFloat(n).toFixed(2)} ft`;
    const stepBtn = {
        width: '24px', height: '24px', borderRadius: '6px', border: '1px solid rgba(59,130,246,0.35)',
        background: 'rgba(59,130,246,0.12)', color: '#93c5fd', fontWeight: 800, fontSize: '0.85rem',
        cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 0,
    };

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

                    {/* New bar: offcuts ignored even when one would fit */}
                    <label data-testid="new-bar-option" style={{
                        display: 'flex', alignItems: 'center', gap: '0.625rem', cursor: 'pointer', marginBottom: '1.25rem',
                        padding: '0.75rem 1rem', borderRadius: '0.875rem',
                        background: newBar ? 'rgba(245,158,11,0.1)' : 'rgba(255,255,255,0.03)',
                        border: `1px solid ${newBar ? 'rgba(245,158,11,0.35)' : 'rgba(255,255,255,0.07)'}`,
                    }}>
                        <input type="checkbox" checked={newBar} onChange={e => setNewBar(e.target.checked)}
                            style={{ width: '16px', height: '16px', flexShrink: 0, accentColor: '#f59e0b' }} />
                        <span>
                            <span style={{ display: 'block', fontSize: '0.82rem', fontWeight: 700, color: '#e2e8f0' }}>Remaining length from a new bar</span>
                            <span style={{ display: 'block', fontSize: '0.7rem', color: '#64748b' }}>
                                The offcuts you pick below are used first; whatever they don't cover is cut from a new bar,
                                never from another offcut. Pick none to cut the whole length from a new bar.
                            </span>
                        </span>
                    </label>

                    <div>

                    {/* Available offcuts */}
                    <div style={{ marginBottom: '1.25rem' }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.625rem' }}>
                            <span style={{ fontSize: '0.7rem', color: '#475569', textTransform: 'uppercase', letterSpacing: '0.08em' }}>
                                Available Offcuts
                            </span>
                            {piecesSelected > 0 && (
                                <button onClick={handleClearAll} style={{
                                    background: 'none', border: 'none', color: '#64748b', fontSize: '0.7rem',
                                    cursor: 'pointer', textDecoration: 'underline',
                                }}>
                                    Clear all
                                </button>
                            )}
                        </div>

                        {trimmedNote && (
                            <p style={{ fontSize: '0.72rem', color: '#fbbf24', margin: '0 0 0.5rem' }}>{trimmedNote}</p>
                        )}
                        {loading ? (
                            <p style={{ fontSize: '0.8rem', color: '#475569' }}>Loading offcuts…</p>
                        ) : offcuts.length === 0 ? (
                            <p style={{ fontSize: '0.8rem', color: '#334155', fontStyle: 'italic' }}>
                                No offcuts available. This cut will come from a full bar.
                            </p>
                        ) : (
                            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                                {offcuts.map(oc => {
                                    const picked = selected[oc.offcutId] || [];
                                    const isSelected = picked.length > 0;
                                    const cap = maxUnits(oc);
                                    return (
                                        <div key={oc.offcutId} style={{
                                            display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: '0.5rem 0.75rem',
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

                                            <div style={{ flex: '1 1 100px', minWidth: 0 }}>
                                                <span style={{ fontSize: '0.85rem', fontWeight: 700, color: '#e2e8f0', fontFamily: 'var(--font-mono)' }}>
                                                    {fmtLen(oc.length)}
                                                </span>
                                                <ProvisionalBadge windows={oc.provisional} />
                                                {oc.quantity > 1 ? (
                                                    <span data-testid="same-size-count" style={{
                                                        fontSize: '0.68rem', fontWeight: 800, color: '#fbbf24', marginLeft: '0.5rem',
                                                        padding: '1px 7px', borderRadius: '999px',
                                                        background: 'rgba(251,191,36,0.12)', border: '1px solid rgba(251,191,36,0.35)',
                                                    }}>
                                                        {oc.quantity} pieces this size
                                                    </span>
                                                ) : (
                                                    <span style={{ fontSize: '0.72rem', color: '#475569', marginLeft: '0.5rem' }}>1 piece</span>
                                                )}
                                                {oc.returned?.length > 0 && (
                                                    <div data-testid="returned-offcut" style={{ fontSize: '0.66rem', color: '#22c55e', fontWeight: 700, marginTop: '2px' }}>
                                                        ↩ returned by this edit: {oc.returned[0].label}
                                                    </div>
                                                )}
                                            </div>

                                            {/* When selected: how many of these pieces (rows with several), and
                                                what length each one gives */}
                                            {isSelected && (
                                                <div onClick={e => e.stopPropagation()} style={{ flex: '1 1 100%', display: 'flex', flexDirection: 'column', gap: '0.375rem', cursor: 'default' }}>
                                                    {cap > 1 && (
                                                        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                                                            <span style={{ fontSize: '0.7rem', color: '#94a3b8' }}>Pieces to use:</span>
                                                            <button type="button" aria-label="One piece fewer" onClick={() => removePiece(oc)} style={stepBtn}>−</button>
                                                            <span data-testid="pieces-used" style={{ fontSize: '0.82rem', fontWeight: 800, color: '#e2e8f0', minWidth: '1.25rem', textAlign: 'center' }}>{picked.length}</span>
                                                            <button type="button" aria-label="One piece more" onClick={() => addPiece(oc)} disabled={picked.length >= cap}
                                                                style={{ ...stepBtn, opacity: picked.length >= cap ? 0.35 : 1, cursor: picked.length >= cap ? 'not-allowed' : 'pointer' }}>+</button>
                                                            <span style={{ fontSize: '0.7rem', color: '#64748b' }}>of {cap}</span>
                                                        </div>
                                                    )}
                                                    {picked.map((len, idx) => (
                                                        <div key={idx} style={{ display: 'flex', alignItems: 'center', gap: '0.375rem' }}>
                                                            <span style={{ fontSize: '0.7rem', color: '#64748b', minWidth: cap > 1 ? '4.5rem' : undefined }}>
                                                                {cap > 1 ? `Piece ${idx + 1} use:` : 'use:'}
                                                            </span>
                                                            <input
                                                                type="number"
                                                                step="0.01"
                                                                min="0.01"
                                                                max={oc.length}
                                                                value={len}
                                                                aria-label={cap > 1 ? `Piece ${idx + 1} length used` : 'Length used'}
                                                                onChange={e => setLen(oc.offcutId, idx, e.target.value)}
                                                                style={{
                                                                    width: '70px', background: 'rgba(59,130,246,0.1)',
                                                                    border: '1px solid rgba(59,130,246,0.3)', borderRadius: '6px',
                                                                    color: '#e2e8f0', fontSize: '0.8rem', padding: '3px 6px',
                                                                    outline: 'none', textAlign: 'right',
                                                                }}
                                                            />
                                                            <span style={{ fontSize: '0.7rem', color: '#64748b' }}>ft</span>
                                                        </div>
                                                    ))}
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
                                {piecesSelected > 0 ? (
                                    <>
                                        {fmtLen(selectedTotal)} from {piecesSelected} offcut piece{piecesSelected === 1 ? '' : 's'} <strong style={{ color: '#60a5fa' }}>+ {fmtLen(shortfall)} auto-filled</strong> = {fmtLen(requiredLength)}{' '}
                                        <span style={{ color: '#475569' }}>
                                            {newBar
                                                ? '(from a new bar)'
                                                : shortfallBestFit
                                                    ? `(from the ${fmtLen(shortfallBestFit.length)} offcut)`
                                                    : '(no offcut fits — from a new bar)'}
                                        </span>
                                    </>
                                ) : newBar ? (
                                    <>No offcuts selected — all {fmtLen(requiredLength)} will come <strong style={{ color: '#fbbf24' }}>from a new bar</strong></>
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
                    display: 'flex', justifyContent: 'flex-end', flexWrap: 'wrap', gap: '0.75rem',
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
                        {!newBar ? 'Use These Offcuts' : piecesSelected > 0 ? 'Use Offcuts + New Bar' : 'Use a New Bar'}
                    </button>
                </div>
            </div>
        </div>
    );
}
