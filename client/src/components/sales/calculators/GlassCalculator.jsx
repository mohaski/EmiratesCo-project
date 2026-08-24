import { memo, useState, useMemo, useEffect, useRef } from 'react';
import { mmToSquareFeet, inchesToSquareFeet, roundToHalfWithRule } from '../../../utils/calculations';
import CutPreviewModal from './CutPreviewModal';
import api from '../../../services/api';

const inputStyle = {
    background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.1)',
    borderRadius: '0.5rem', padding: '0.5rem 0.625rem', color: '#f1f5f9',
    fontSize: '0.82rem', outline: 'none', width: '100%', boxSizing: 'border-box',
    fontFamily: 'var(--font-mono)', transition: 'border-color 0.2s',
};

const GlassCalculator = memo(({ product, initialDetails, onUpdate }) => {

    const extraAttributes = useMemo(() => {
        const extras = {};
        if (Array.isArray(product.variants) && product.variants.length > 0) {
            product.variants.forEach(v => {
                const attrs = v.attributes;
                if (attrs) {
                    Object.entries(typeof attrs === 'object' ? attrs : {}).forEach(([key, val]) => {
                        if (['Category', 'id', 'itemCode', 'sku'].includes(key) || val === null || val === undefined || val === '') return;
                        if (!extras[key]) extras[key] = new Set();
                        extras[key].add(val);
                    });
                }
            });
        }
        if (product.attributes && typeof product.attributes === 'object' && !Array.isArray(product.attributes)) {
            Object.entries(product.attributes).forEach(([key, vals]) => {
                if (key !== 'Category' && Array.isArray(vals) && vals.length > 0) {
                    if (!extras[key]) extras[key] = new Set();
                    vals.forEach(v => extras[key].add(v));
                }
            });
        }
        return Object.entries(extras).reduce((acc, [key, set]) => {
            if (set.size > 0) {
                acc[key] = Array.from(set).sort((a, b) => {
                    const nA = parseFloat(String(a).replace(/[^\d.]/g, '')), nB = parseFloat(String(b).replace(/[^\d.]/g, ''));
                    return (!isNaN(nA) && !isNaN(nB)) ? nA - nB : String(a).localeCompare(String(b));
                });
            }
            return acc;
        }, {});
    }, [product]);

    const [fullQty, setFullQty] = useState(initialDetails?.fullSheet || 0);
    const [halfQty, setHalfQty] = useState(initialDetails?.halfSheet || 0);
    const [cutPieces, setCutPieces] = useState(initialDetails?.cutPieces || []);
    const [extraSelections, setExtraSelections] = useState(() => {
        if (initialDetails?.extras) return initialDetails.extras;
        const defaults = {};
        Object.keys(extraAttributes).forEach(key => {
            const def = product.defaultAttributes?.[key];
            defaults[key] = (def && extraAttributes[key]?.includes(def)) ? def : extraAttributes[key]?.[0];
        });
        return defaults;
    });
    const [cutL, setCutL] = useState('');
    const [cutW, setCutW] = useState('');
    const [cutQty, setCutQty] = useState('');
    const [unit, setUnit] = useState('mm');
    const [error, setError] = useState(null);
    const [cutSizeError, setCutSizeError] = useState(null);
    const [showCutPreview, setShowCutPreview] = useState(false);
    const [feasibility, setFeasibility] = useState({ checking: false, ok: true, message: null });

    // Cascading options: each attribute's shown chips are narrowed to values that
    // actually co-occur, on some real variant, with whatever's currently selected
    // for every OTHER attribute — e.g. picking Thickness=4mm hides a Dimensions
    // value that only exists on a 6mm variant. Without this, a combination with no
    // matching variant could be selected, resolving to no variant at all (not just
    // "no offcut of that size" — the whole product/variant lookup fails, which is
    // a different, more confusing failure than a genuine stock-fit problem).
    const optionsForKey = useMemo(() => {
        const result = {};
        Object.keys(extraAttributes).forEach(key => {
            const otherEntries = Object.entries(extraSelections).filter(([k]) => k !== key && extraAttributes[k]);
            const matching = (product.variants || []).filter(v =>
                otherEntries.every(([k, val]) => v.attributes?.[k] === val)
            );
            const opts = new Set();
            matching.forEach(v => {
                const val = v.attributes?.[key];
                if (val !== undefined && val !== null && val !== '') opts.add(val);
            });
            // Nothing matches yet (e.g. other keys still unset on first render) —
            // fall back to the full list rather than showing empty chips.
            result[key] = opts.size > 0 ? extraAttributes[key].filter(o => opts.has(o)) : extraAttributes[key];
        });
        return result;
    }, [extraAttributes, extraSelections, product.variants]);

    useEffect(() => {
        setExtraSelections(prev => {
            const next = { ...prev };
            let changed = false;
            Object.keys(extraAttributes).forEach(key => {
                const validOptions = optionsForKey[key] || [];
                if (!next[key] || !validOptions.includes(next[key])) {
                    const def = product.defaultAttributes?.[key];
                    next[key] = (def && validOptions.includes(def)) ? def : validOptions[0];
                    changed = true;
                }
            });
            return changed ? next : prev;
        });
    }, [optionsForKey, extraAttributes, product.defaultAttributes]);

    const pricing = useMemo(() => {
        let match = product.variants?.find(v => Object.entries(extraSelections).every(([key, val]) => v.attributes?.[key] === val));
        if (match) return {
            priceFull: match.price ?? match.priceFull ?? 0,
            priceHalf: match.priceHalf ?? 0,
            priceSqFt: match.priceUnit ?? match.priceSqFt ?? match.priceFoot ?? 0,
            availableStock: match.stock ?? product.stock ?? 0,
            variantId: match.variantId,
            // Sheet's own physical size, always in mm (see server-side glassOffcutService
            // docstring) — used to reject a cut piece that can't possibly fit this sheet.
            sheetLengthMm: match.length ?? 0,
            sheetWidthMm: match.width ?? 0,
        };
        return {
            priceFull: product.priceFull ?? product.priceFullSheet ?? 0,
            priceHalf: product.priceHalf ?? product.priceHalfSheet ?? 0,
            priceSqFt: product.priceFoot ?? product.priceSqFt ?? 0,
            availableStock: product.stock ?? 0,
            sheetLengthMm: 0,
            sheetWidthMm: 0,
        };
    }, [product, extraSelections]);

    const lineItems = useMemo(() => {
        const items = [];
        if (fullQty > 0) items.push({ type: 'sheet-full', label: 'Full Sheet', qty: fullQty, rate: pricing.priceFull, total: fullQty * pricing.priceFull, meta: {} });
        if (halfQty > 0) items.push({ type: 'sheet-half', label: 'Half Sheet', qty: halfQty, rate: pricing.priceHalf, total: halfQty * pricing.priceHalf, meta: {} });
        cutPieces.forEach(cut => items.push({ type: 'glass-cut', label: cut.label, qty: cut.q, rate: cut.area * pricing.priceSqFt, total: cut.area * cut.q * pricing.priceSqFt, meta: { l: cut.l, w: cut.w, u: cut.u, area: cut.area, rateSqFt: pricing.priceSqFt } }));
        return items;
    }, [fullQty, halfQty, cutPieces, pricing]);

    useEffect(() => {
        let syncValid = true;
        if (pricing.availableStock !== undefined && fullQty > pricing.availableStock) { setError(`Only ${pricing.availableStock} Full Sheets available`); syncValid = false; }
        else setError(null);

        const isValid = syncValid && !feasibility.checking && feasibility.ok;

        const fullTotal = fullQty * pricing.priceFull;
        const halfTotal = halfQty * pricing.priceHalf;
        const cutsCost = cutPieces.reduce((sum, cut) => sum + (cut.area * cut.q * pricing.priceSqFt), 0);
        const attributes = [];
        if (extraSelections['Thickness']) attributes.push({ label: 'Thickness', value: extraSelections['Thickness'] });
        Object.entries(extraSelections).forEach(([key, val]) => { if (key !== 'Thickness') attributes.push({ label: key, value: val }); });
        onUpdate(fullTotal + halfTotal + cutsCost, { lineItems, attributes, fullSheet: fullQty, halfSheet: halfQty, cutPieces: cutPieces.map(c => ({ ...c, rate: pricing.priceSqFt, totalPrice: c.area * c.q * pricing.priceSqFt })), extras: extraSelections, variantId: pricing.variantId, isValid, checkingStock: feasibility.checking, stockError: feasibility.message });
    }, [fullQty, halfQty, cutPieces, pricing, extraSelections, onUpdate, lineItems, feasibility]);

    // Debounced dry-run check: can these line items actually be fulfilled from
    // current sheet stock/offcuts? Reuses the exact real checkout deduction
    // logic on the backend (see checkCutFeasibility) — the same mechanism
    // ProfileCalculator uses for bar cuts — rather than guessing client-side,
    // since only the live DB knows what offcuts/stock actually exist.
    const feasibilitySeqRef = useRef(0);
    useEffect(() => {
        if (fullQty <= 0 && halfQty <= 0 && cutPieces.length === 0) {
            setFeasibility({ checking: false, ok: true, message: null });
            return;
        }
        // The cheap synchronous check already flagged a problem — no need to
        // hit the network for something the user already sees an error for.
        if (error) {
            setFeasibility({ checking: false, ok: true, message: null });
            return;
        }

        const mySeq = ++feasibilitySeqRef.current;
        // Flip to "checking" immediately so the Add-to-Order button disables
        // the instant a relevant input changes, not after the debounce delay.
        setFeasibility({ checking: true, ok: false, message: null });

        const timer = setTimeout(() => {
            api.productService
                .checkCutFeasibility(product.id, pricing.variantId ?? null, lineItems)
                .then(res => {
                    if (feasibilitySeqRef.current !== mySeq) return; // superseded by a newer check
                    setFeasibility({ checking: false, ok: !!res.ok, message: res.ok ? null : (res.message || 'Insufficient stock for this configuration.') });
                })
                .catch(err => {
                    if (feasibilitySeqRef.current !== mySeq) return;
                    // Fail-open: a transient network/server error shouldn't block a sale.
                    console.warn('Stock feasibility check failed; failing open (not blocking sale).', err);
                    setFeasibility({ checking: false, ok: true, message: null });
                });
        }, 400);

        return () => clearTimeout(timer);
    }, [fullQty, halfQty, cutPieces, pricing.variantId, product.id, error, lineItems]);

    const getArea = (l, w, u) => {
        if (u === 'ft') { const rl = roundToHalfWithRule(l), rw = roundToHalfWithRule(w); return rl * rw; }
        if (u === 'mm') return mmToSquareFeet(l, w);
        if (u === 'inch') return inchesToSquareFeet(l, w);
        return 0;
    };

    // Same conversion factors the backend uses (glassOffcutService.py's
    // MM_PER_FOOT/MM_PER_INCH) — mm is the canonical unit sheet/offcut sizes
    // are always stored in, regardless of what unit a cut was entered in.
    const MM_PER_FOOT = 304.79999025;
    const MM_PER_INCH = 25.4;
    const toMm = (val, u) => u === 'ft' ? val * MM_PER_FOOT : u === 'inch' ? val * MM_PER_INCH : val;

    // Live validation as the cashier types — doesn't wait for "Add" to be clicked.
    useEffect(() => {
        const { sheetLengthMm, sheetWidthMm } = pricing;
        if (!(sheetLengthMm > 0 && sheetWidthMm > 0)) { setCutSizeError(null); return; }
        const maxSide = Math.max(sheetLengthMm, sheetWidthMm);
        const minSide = Math.min(sheetLengthMm, sheetWidthMm);

        const lMm = cutL !== '' ? toMm(parseFloat(cutL), unit) : null;
        const wMm = cutW !== '' ? toMm(parseFloat(cutW), unit) : null;

        // A single dimension bigger than the sheet's LONGER side can never fit,
        // in any orientation, no matter what the other dimension turns out to
        // be — flag this the moment it's typed, without waiting for both fields.
        if ((lMm !== null && lMm > maxSide) || (wMm !== null && wMm > maxSide)) {
            const badVal = (lMm !== null && lMm > maxSide) ? cutL : cutW;
            setCutSizeError(`${badVal}${unit} exceeds the sheet size (${sheetLengthMm}×${sheetWidthMm}mm)`);
            return;
        }

        // Once both are filled, check the actual pair — piece may be rotated 90°
        // (matches the backend's default allow_rotation behavior), so compare
        // canonically rather than axis-by-axis, otherwise a physically-fitting
        // cut could be rejected just because L/W were typed in the "wrong" order
        // relative to the sheet's own L/W.
        if (lMm !== null && wMm !== null) {
            const fits = Math.max(lMm, wMm) <= maxSide && Math.min(lMm, wMm) <= minSide;
            if (!fits) {
                setCutSizeError(`${cutL}×${cutW}${unit} exceeds the sheet size (${sheetLengthMm}×${sheetWidthMm}mm)`);
                return;
            }
        }

        setCutSizeError(null);
    }, [cutL, cutW, unit, pricing]);

    const addCut = () => {
        if (!cutL || !cutW || !cutQty || cutSizeError) return;
        const l = parseFloat(cutL), w = parseFloat(cutW), q = parseFloat(cutQty);
        const area = getArea(l, w, unit);
        setCutPieces(prev => [...prev, { l, w, q, u: unit, area, label: `Cut: ${l}×${w}${unit}` }]);
        setCutL(''); setCutW(''); setCutQty('');
    };
    const removeCut = i => setCutPieces(prev => prev.filter((_, idx) => idx !== i));

    const sectionStyle = { background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: '0.875rem', padding: '1rem', marginBottom: '0.75rem' };
    const labelStyle = { fontSize: '0.62rem', fontWeight: 700, color: '#475569', letterSpacing: '0.08em', textTransform: 'uppercase', display: 'block', marginBottom: '0.5rem' };
    const chipBtn = (active, color = '#3b82f6') => ({
        padding: '0.3rem 0.75rem', borderRadius: '100px', fontSize: '0.72rem', fontWeight: 700, cursor: 'pointer', border: '1px solid', transition: 'all 0.15s',
        background: active ? `${color}20` : 'transparent',
        borderColor: active ? `${color}50` : 'rgba(255,255,255,0.1)',
        color: active ? color : '#64748b',
    });

    return (
        <div>
            {/* Attribute selectors */}
            {Object.entries(extraAttributes).length > 0 && (
                <div style={sectionStyle}>
                    {Object.entries(extraAttributes).map(([key]) => (
                        <div key={key} style={{ marginBottom: '0.625rem' }}>
                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.375rem' }}>
                                <span style={labelStyle}>{key}</span>
                                {key === 'Thickness' && <span style={{ fontSize: '0.65rem', color: '#475569', fontFamily: 'var(--font-mono)' }}>KSH{pricing.priceSqFt}/sqft</span>}
                            </div>
                            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.375rem' }}>
                                {(optionsForKey[key] || []).map(opt => (
                                    <button key={opt} onClick={() => setExtraSelections(prev => ({ ...prev, [key]: opt }))} style={chipBtn(extraSelections[key] === opt, '#06b6d4')}>{opt}</button>
                                ))}
                            </div>
                        </div>
                    ))}
                </div>
            )}

            {/* Full / Half sheets */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '0.75rem', marginBottom: '0.75rem' }}>
                <div style={sectionStyle}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.625rem' }}>
                        <span style={{ fontSize: '0.82rem', fontWeight: 700, color: '#e2e8f0' }}>Full Sheet</span>
                        <span style={{ fontSize: '0.68rem', fontWeight: 700, color: '#06b6d4', fontFamily: 'var(--font-mono)' }}>KSH{pricing.priceFull}</span>
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                        <button onClick={() => setFullQty(Math.max(0, fullQty - 1))} style={{ width: '32px', height: '32px', borderRadius: '8px', border: 'none', cursor: 'pointer', background: 'rgba(255,255,255,0.07)', color: '#94a3b8', fontSize: '1rem', flexShrink: 0 }}>-</button>
                        <input type="number" value={fullQty} onChange={e => setFullQty(Math.max(0, parseInt(e.target.value) || 0))} style={{ ...inputStyle, textAlign: 'center', flex: 1 }} />
                        <button onClick={() => setFullQty(fullQty + 1)} style={{ width: '32px', height: '32px', borderRadius: '8px', border: 'none', cursor: 'pointer', background: 'rgba(6,182,212,0.15)', color: '#22d3ee', fontSize: '1rem', flexShrink: 0 }}>+</button>
                    </div>
                    {error && <p style={{ fontSize: '0.65rem', color: '#f87171', fontWeight: 700, marginTop: '4px', animation: 'pulse 1.5s ease-in-out infinite' }}>{error}</p>}
                </div>

                <div style={sectionStyle}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.625rem' }}>
                        <span style={{ fontSize: '0.82rem', fontWeight: 700, color: '#e2e8f0' }}>Half Sheet</span>
                        <span style={{ fontSize: '0.68rem', fontWeight: 700, color: '#06b6d4', fontFamily: 'var(--font-mono)' }}>KSH{pricing.priceHalf}</span>
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                        <span style={{ fontSize: '0.78rem', color: '#64748b' }}>{halfQty > 0 ? 'Added' : 'Not added'}</span>
                        <button onClick={() => setHalfQty(halfQty > 0 ? 0 : 1)} style={{
                            width: '44px', height: '24px', borderRadius: '100px', border: 'none', cursor: 'pointer', position: 'relative',
                            background: halfQty > 0 ? 'linear-gradient(135deg, #3b82f6, #06b6d4)' : 'rgba(255,255,255,0.1)',
                            transition: 'background 0.2s',
                        }}>
                            <span style={{ position: 'absolute', top: '3px', left: halfQty > 0 ? '22px' : '3px', width: '18px', height: '18px', borderRadius: '50%', background: '#fff', transition: 'left 0.2s', display: 'block' }} />
                        </button>
                    </div>
                </div>
            </div>

            {/* Cut pieces */}
            <div style={sectionStyle}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '0.75rem' }}>
                    <span style={{ fontSize: '0.875rem', fontWeight: 700, color: '#e2e8f0' }}>📐 Cut Pieces</span>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                        {product.trackOffcuts && cutPieces.length > 0 && (
                            <button onClick={() => setShowCutPreview(true)} style={{
                                padding: '3px 10px', borderRadius: '6px', border: '1px solid rgba(34,211,238,0.3)',
                                background: 'rgba(6,182,212,0.1)', color: '#22d3ee', fontSize: '0.68rem', fontWeight: 700, cursor: 'pointer',
                            }}>
                                Preview Cuts
                            </button>
                        )}
                        <div style={{ display: 'flex', gap: '2px', background: 'rgba(255,255,255,0.06)', borderRadius: '6px', padding: '2px' }}>
                            {['mm', 'ft', 'inch'].map(u => (
                                <button key={u} onClick={() => setUnit(u)} style={{ ...chipBtn(unit === u), borderRadius: '4px', padding: '2px 8px', fontSize: '0.65rem' }}>{u}</button>
                            ))}
                        </div>
                    </div>
                </div>

                <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.375rem', marginBottom: '0.625rem' }}>
                    <input type="number" placeholder={`L (${unit})`} value={cutL} onChange={e => setCutL(e.target.value)} style={{ ...inputStyle, flex: '1 1 90px', minWidth: 0 }} onFocus={e => { e.target.style.borderColor = 'rgba(6,182,212,0.5)'; }} onBlur={e => { e.target.style.borderColor = 'rgba(255,255,255,0.1)'; }} />
                    <input type="number" placeholder={`W (${unit})`} value={cutW} onChange={e => setCutW(e.target.value)} style={{ ...inputStyle, flex: '1 1 90px', minWidth: 0 }} onFocus={e => { e.target.style.borderColor = 'rgba(6,182,212,0.5)'; }} onBlur={e => { e.target.style.borderColor = 'rgba(255,255,255,0.1)'; }} />
                    <input type="number" placeholder="Qty" value={cutQty} onChange={e => setCutQty(e.target.value)} style={{ ...inputStyle, textAlign: 'center', flex: '0 1 70px', minWidth: 0 }} onFocus={e => { e.target.style.borderColor = 'rgba(6,182,212,0.5)'; }} onBlur={e => { e.target.style.borderColor = 'rgba(255,255,255,0.1)'; }} />
                    <button onClick={addCut} disabled={!!cutSizeError} style={{
                        padding: '0.5rem 0.875rem', borderRadius: '0.5rem', border: 'none',
                        cursor: cutSizeError ? 'not-allowed' : 'pointer',
                        background: cutSizeError ? 'rgba(255,255,255,0.06)' : 'linear-gradient(135deg, #3b82f6, #06b6d4)',
                        color: cutSizeError ? '#334155' : '#fff', fontWeight: 800, fontSize: '0.82rem',
                        flex: '0 0 auto',
                    }}>Add</button>
                </div>
                {cutSizeError && <p style={{ fontSize: '0.65rem', color: '#f87171', fontWeight: 700, margin: '0 0 0.5rem', animation: 'pulse 1.5s ease-in-out infinite' }}>{cutSizeError}</p>}

                {feasibility.checking && (
                    <p style={{ fontSize: '0.68rem', color: '#64748b', margin: '0.5rem 0 0', fontStyle: 'italic' }}>
                        Checking stock…
                    </p>
                )}
                {!feasibility.checking && feasibility.message && (
                    <p style={{ fontSize: '0.68rem', color: '#f87171', fontWeight: 700, margin: '0.5rem 0 0', animation: 'pulse 1.5s ease-in-out infinite' }}>
                        {feasibility.message}
                    </p>
                )}
            </div>

            {/* Summary */}
            {(fullQty > 0 || halfQty > 0 || cutPieces.length > 0) && (
                <div style={{ background: 'rgba(6,182,212,0.05)', border: '1px solid rgba(6,182,212,0.15)', borderRadius: '0.875rem', overflow: 'hidden' }}>
                    <div style={{ padding: '0.625rem 1rem', borderBottom: '1px solid rgba(255,255,255,0.06)', background: 'rgba(0,0,0,0.2)' }}>
                        <span style={labelStyle}>Order Summary</span>
                    </div>
                    <div style={{ maxHeight: '180px', overflowY: 'auto' }} className="custom-scrollbar">
                        {fullQty > 0 && (
                            <div style={{ display: 'flex', justifyContent: 'space-between', padding: '0.625rem 1rem', borderBottom: '1px solid rgba(255,255,255,0.04)', fontSize: '0.78rem' }}>
                                <span style={{ color: '#94a3b8' }}>Full Sheet ×{fullQty}</span>
                                <span style={{ color: '#22d3ee', fontWeight: 700, fontFamily: 'var(--font-mono)' }}>KSH{(fullQty * pricing.priceFull).toLocaleString()}</span>
                            </div>
                        )}
                        {halfQty > 0 && (
                            <div style={{ display: 'flex', justifyContent: 'space-between', padding: '0.625rem 1rem', borderBottom: '1px solid rgba(255,255,255,0.04)', fontSize: '0.78rem' }}>
                                <span style={{ color: '#94a3b8' }}>Half Sheet ×{halfQty}</span>
                                <span style={{ color: '#22d3ee', fontWeight: 700, fontFamily: 'var(--font-mono)' }}>KSH{(halfQty * pricing.priceHalf).toLocaleString()}</span>
                            </div>
                        )}
                        {cutPieces.map((cut, i) => (
                            <div key={i} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '0.625rem 1rem', borderBottom: '1px solid rgba(255,255,255,0.04)', fontSize: '0.78rem' }}>
                                <div>
                                    <span style={{ color: '#94a3b8' }}>{cut.label} ×{cut.q}</span>
                                    <span style={{ color: '#475569', fontSize: '0.65rem', marginLeft: '0.5rem', fontFamily: 'var(--font-mono)' }}>{(cut.area * cut.q).toFixed(2)}sqft</span>
                                </div>
                                <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
                                    <span style={{ color: '#22d3ee', fontWeight: 700, fontFamily: 'var(--font-mono)' }}>KSH{(cut.area * cut.q * pricing.priceSqFt).toFixed(0)}</span>
                                    <button onClick={() => removeCut(i)} style={{ background: 'none', border: 'none', color: '#475569', cursor: 'pointer', fontSize: '0.875rem', padding: 0, transition: 'color 0.15s' }}
                                    onMouseEnter={e => { e.currentTarget.style.color = '#f87171'; }} onMouseLeave={e => { e.currentTarget.style.color = '#475569'; }}>×</button>
                                </div>
                            </div>
                        ))}
                    </div>
                </div>
            )}

            {showCutPreview && (
                <CutPreviewModal
                    productId={product.id}
                    variantId={pricing.variantId}
                    cutPieces={cutPieces}
                    onClose={() => setShowCutPreview(false)}
                />
            )}
        </div>
    );
});

export default GlassCalculator;
