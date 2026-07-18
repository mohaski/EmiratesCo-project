import { useState, useEffect, useMemo, useRef, memo } from 'react';
import OffcutSelectorModal from './OffcutSelectorModal';

const inputStyle = {
    background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.1)',
    borderRadius: '0.625rem', padding: '0.625rem 0.875rem', color: '#f1f5f9',
    fontSize: '0.875rem', outline: 'none', width: '100%', boxSizing: 'border-box',
    fontFamily: 'var(--font-mono)', transition: 'border-color 0.2s',
};
const sectionStyle = { background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: '0.875rem', padding: '1rem', marginBottom: '0.75rem' };
const labelStyle = { fontSize: '0.62rem', fontWeight: 700, color: '#475569', letterSpacing: '0.08em', textTransform: 'uppercase' };

const ProfileCalculator = memo(({ product, color, initialDetails, onUpdate, cart = [], cartIndex = null }) => {

    const extraAttributes = useMemo(() => {
        const extras = {};
        const attrKeys = Array.isArray(product.attributes) ? product.attributes : Object.keys(product.attributes || {});
        const allowedKeys = attrKeys.filter(key => key !== 'Color' && key !== 'Category');
        if (product.variants?.length > 0) {
            product.variants.forEach(v => {
                if (color && v.attributes?.Color && v.attributes.Color !== color) return;
                allowedKeys.forEach(key => {
                    const val = v.attributes?.[key];
                    if (val) { if (!extras[key]) extras[key] = new Set(); extras[key].add(val); }
                });
            });
        }
        return Object.entries(extras).reduce((acc, [key, set]) => {
            acc[key] = Array.from(set).sort((a, b) => {
                const nA = parseFloat(String(a).replace(/[^\d.]/g, '')), nB = parseFloat(String(b).replace(/[^\d.]/g, ''));
                if (!isNaN(nA) && !isNaN(nB)) return key === 'Length' ? nB - nA : nA - nB;
                return String(a).localeCompare(String(b));
            });
            if (key === 'Length' && acc[key][0] < acc[key][acc[key].length - 1]) acc[key].reverse();
            return acc;
        }, {});
    }, [product, color]);

    const [fullQty, setFullQty] = useState(initialDetails?.full || 0);
    const [halfQty, setHalfQty] = useState(initialDetails?.half || 0);
    const [feet, setFeet] = useState(initialDetails?.feet || 0);
    const [extraSelections, setExtraSelections] = useState(() => {
        const defaults = {};
        Object.keys(extraAttributes).forEach(key => {
            if (key !== 'Color') defaults[key] = product.defaultAttributes?.[key] || extraAttributes[key]?.[0];
        });
        return initialDetails?.extras ? { ...defaults, ...initialDetails.extras } : defaults;
    });
    const [fullLengtherror, setfullLengtherror] = useState(null);
    const [cuterror, setcuterror] = useState(null);
    const [offcutSelection, setOffcutSelection] = useState(initialDetails?.offcutSelection || null);
    const [showOffcutModal, setShowOffcutModal] = useState(false);

    useEffect(() => {
        setExtraSelections(prev => {
            const next = { ...prev };
            Object.keys(extraAttributes).forEach(key => {
                if (!extraAttributes[key].includes(next[key])) {
                    if (key !== 'Color') next[key] = product.defaultAttributes?.[key] || extraAttributes[key][0];
                    else delete next[key];
                }
            });
            return next;
        });
    }, [product, extraAttributes]);

    const selectedLengthNum = useMemo(() => {
        if (extraSelections['Length']) return parseInt(String(extraSelections['Length']).replace(/\D/g, '')) || 0;
        return 0;
    }, [extraSelections]);

    const pricing = useMemo(() => {
        const matchingVariant = product.variants?.find(v => {
            if (color && v.attributes?.Color && v.attributes.Color !== color) return false;
            return Object.entries(extraSelections).every(([key, val]) => v.attributes?.[key] === val);
        });
        if (matchingVariant) return {
            priceFull: matchingVariant.price || matchingVariant.priceFull || product.priceFull || 0,
            priceHalf: matchingVariant.priceHalf || product.priceHalf || 0,
            priceFoot: matchingVariant.priceUnit || product.priceFoot || 0,
            availableStock: matchingVariant.stock ?? product.stock ?? 0,
            variantId: matchingVariant.variantId,
        };
        return { priceFull: product.priceFull || 0, priceHalf: product.priceHalf || 0, priceFoot: product.priceFoot || 0, availableStock: product.stock || 0 };
    }, [product, color, extraSelections]);

    // Clear a stale offcut selection if the required length or variant it was picked for changes
    const prevCutKey = useRef(`${feet}|${pricing.variantId}`);
    useEffect(() => {
        const key = `${feet}|${pricing.variantId}`;
        if (prevCutKey.current !== key) {
            prevCutKey.current = key;
            setOffcutSelection(null);
        }
    }, [feet, pricing.variantId]);

    useEffect(() => {
        let isValid = true;
        if (pricing.availableStock !== undefined && fullQty > pricing.availableStock) { setfullLengtherror(`Only ${pricing.availableStock} full lengths available`); isValid = false; }
        else if (pricing.availableStock !== undefined && feet > selectedLengthNum) { setcuterror(`Feet cannot exceed ${selectedLengthNum}`); isValid = false; }
        else { setfullLengtherror(null); setcuterror(null); }

        const total = (fullQty * pricing.priceFull) + (halfQty * pricing.priceHalf) + (feet * pricing.priceFoot);
        const lineItems = [];
        if (fullQty > 0) lineItems.push({ type: 'profile-full', label: 'Full Length', qty: fullQty, rate: pricing.priceFull, total: fullQty * pricing.priceFull, meta: { length: extraSelections['Length'] } });
        if (halfQty > 0) lineItems.push({ type: 'profile-half', label: 'Half Length', qty: halfQty, rate: pricing.priceHalf, total: halfQty * pricing.priceHalf, meta: { length: extraSelections['Length'] } });
        if (feet > 0) {
            const cutLine = { type: 'profile-cut', label: `Custom Cut (${feet}ft)`, qty: 1, rate: pricing.priceFoot, total: feet * pricing.priceFoot, meta: { length: feet, unit: 'ft' } };
            if (offcutSelection && offcutSelection.length > 0) cutLine.offcut_selection = offcutSelection;
            lineItems.push(cutLine);
        }
        const attributes = [];
        if (color) attributes.push({ label: 'Color', value: color });
        if (extraSelections['Length']) attributes.push({ label: 'Length', value: extraSelections['Length'] });
        Object.entries(extraSelections).forEach(([key, val]) => { if (key !== 'Length' && key !== 'Color') attributes.push({ label: key, value: val }); });
        onUpdate(total, { lineItems, attributes, full: fullQty, half: halfQty, feet, color: color || 'White', extras: extraSelections, variantId: pricing.variantId, offcutSelection, isValid });
    }, [fullQty, halfQty, feet, pricing, color, extraSelections, offcutSelection, onUpdate]);

    const handleExtraChange = (key, val) => setExtraSelections(prev => ({ ...prev, [key]: val }));
    const chipBtn = (active) => ({
        padding: '0.3rem 0.875rem', borderRadius: '100px', fontSize: '0.72rem', fontWeight: 700,
        cursor: 'pointer', border: '1px solid', transition: 'all 0.15s',
        background: active ? 'rgba(59,130,246,0.15)' : 'transparent',
        borderColor: active ? 'rgba(59,130,246,0.4)' : 'rgba(255,255,255,0.1)',
        color: active ? '#60a5fa' : '#64748b',
    });

    return (
        <div>
            {/* Dynamic attribute selectors */}
            {Object.entries(extraAttributes).length > 0 && (
                <div style={sectionStyle}>
                    {Object.entries(extraAttributes).map(([key, options]) => (
                        <div key={key} style={{ marginBottom: '0.625rem' }}>
                            <span style={{ ...labelStyle, display: 'block', marginBottom: '0.375rem' }}>{key}</span>
                            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.375rem' }}>
                                {options.map(opt => (
                                    <button key={opt} onClick={() => handleExtraChange(key, opt)} style={chipBtn(extraSelections[key] === opt)}>{opt}</button>
                                ))}
                            </div>
                        </div>
                    ))}
                </div>
            )}

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.75rem' }}>
                {/* Standard Lengths */}
                <div style={sectionStyle}>
                    <p style={{ ...labelStyle, marginBottom: '0.875rem', display: 'block' }}>📏 Standard Lengths</p>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.625rem' }}>
                        <div>
                            <p style={{ fontSize: '0.82rem', color: '#94a3b8', margin: '0 0 2px', fontWeight: 600 }}>Full Length</p>
                            <p style={{ fontSize: '0.68rem', color: '#60a5fa', fontFamily: 'var(--font-mono)', margin: 0 }}>KSH{pricing.priceFull}/pc</p>
                        </div>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                            <button onClick={() => setFullQty(Math.max(0, fullQty - 1))} style={{ width: '30px', height: '30px', borderRadius: '7px', border: 'none', cursor: 'pointer', background: 'rgba(255,255,255,0.07)', color: '#94a3b8' }}>-</button>
                            <input type="number" value={fullQty === 0 ? '' : fullQty} onChange={e => setFullQty(e.target.value === '' ? 0 : Number(e.target.value))} placeholder="0"
                                style={{ ...inputStyle, width: '48px', textAlign: 'center', padding: '0.375rem' }} />
                            <button onClick={() => setFullQty(fullQty + 1)} style={{ width: '30px', height: '30px', borderRadius: '7px', border: 'none', cursor: 'pointer', background: 'rgba(59,130,246,0.15)', color: '#60a5fa' }}>+</button>
                        </div>
                    </div>
                    {fullLengtherror && <p style={{ fontSize: '0.65rem', color: '#f87171', fontWeight: 700, margin: '0 0 0.5rem', animation: 'pulse 1.5s ease-in-out infinite' }}>{fullLengtherror}</p>}

                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', paddingTop: '0.625rem', borderTop: '1px solid rgba(255,255,255,0.06)' }}>
                        <div>
                            <p style={{ fontSize: '0.82rem', color: '#94a3b8', margin: '0 0 2px', fontWeight: 600 }}>Half Length</p>
                            <p style={{ fontSize: '0.68rem', color: '#60a5fa', fontFamily: 'var(--font-mono)', margin: 0 }}>KSH{pricing.priceHalf}/pc</p>
                        </div>
                        <button onClick={() => setHalfQty(halfQty > 0 ? 0 : 1)} style={{
                            width: '44px', height: '24px', borderRadius: '100px', border: 'none', cursor: 'pointer', position: 'relative',
                            background: halfQty > 0 ? 'linear-gradient(135deg, #3b82f6, #06b6d4)' : 'rgba(255,255,255,0.1)', transition: 'background 0.2s',
                        }}>
                            <span style={{ position: 'absolute', top: '3px', left: halfQty > 0 ? '22px' : '3px', width: '18px', height: '18px', borderRadius: '50%', background: '#fff', transition: 'left 0.2s', display: 'block' }} />
                        </button>
                    </div>
                </div>

                {/* Custom Cut */}
                <div style={sectionStyle}>
                    <p style={{ ...labelStyle, marginBottom: '0.875rem', display: 'block' }}>✂️ Custom Cut</p>
                    <p style={{ fontSize: '0.78rem', color: '#64748b', margin: '0 0 0.5rem', fontWeight: 500 }}>Total feet needed</p>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                        <input type="number" placeholder="0" value={feet === 0 ? '' : feet} onChange={e => setFeet(e.target.value === '' ? 0 : Number(e.target.value))}
                            style={{ ...inputStyle, fontSize: '1.25rem', fontWeight: 700 }}
                            onFocus={e => { e.target.style.borderColor = 'rgba(59,130,246,0.5)'; }}
                            onBlur={e => { e.target.style.borderColor = 'rgba(255,255,255,0.1)'; }}
                        />
                        <span style={{ color: '#64748b', fontWeight: 700, flexShrink: 0 }}>ft</span>
                    </div>
                    <p style={{ fontSize: '0.68rem', color: '#60a5fa', fontFamily: 'var(--font-mono)', margin: '0.375rem 0 0', textAlign: 'right' }}>KSH{pricing.priceFoot}/ft</p>
                    {cuterror && <p style={{ fontSize: '0.65rem', color: '#f87171', fontWeight: 700, margin: '4px 0 0', animation: 'pulse 1.5s ease-in-out infinite' }}>{cuterror}</p>}

                    {product.trackOffcuts && feet > 0 && (
                        <div style={{ marginTop: '0.625rem', paddingTop: '0.625rem', borderTop: '1px solid rgba(255,255,255,0.06)' }}>
                            {offcutSelection && offcutSelection.length > 0 ? (
                                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '0.5rem' }}>
                                    <span style={{ fontSize: '0.68rem', color: '#4ade80', fontFamily: 'var(--font-mono)' }}>
                                        {offcutSelection.map(s => `${parseFloat(s.length_used).toFixed(1)}ft`).join(' + ')}
                                        {offcutSelection.reduce((s, o) => s + (parseFloat(o.length_used) || 0), 0) < feet - 0.01 ? ' + auto-fill rest' : ' ✓'}
                                    </span>
                                    <div style={{ display: 'flex', gap: '0.5rem', flexShrink: 0 }}>
                                        <button onClick={() => setShowOffcutModal(true)} style={{ background: 'none', border: 'none', color: '#60a5fa', fontSize: '0.68rem', cursor: 'pointer', textDecoration: 'underline', padding: 0 }}>Edit</button>
                                        <button onClick={() => setOffcutSelection(null)} style={{ background: 'none', border: 'none', color: '#64748b', fontSize: '0.68rem', cursor: 'pointer', textDecoration: 'underline', padding: 0 }}>Clear</button>
                                    </div>
                                </div>
                            ) : (
                                <button onClick={() => setShowOffcutModal(true)} style={{ background: 'none', border: 'none', color: '#60a5fa', fontSize: '0.7rem', fontWeight: 600, cursor: 'pointer', padding: 0 }}>
                                    🔍 Choose offcuts for this cut
                                </button>
                            )}
                        </div>
                    )}
                </div>
            </div>

            {showOffcutModal && (
                <OffcutSelectorModal
                    productId={product.id}
                    variantId={pricing.variantId ?? null}
                    requiredLength={feet}
                    initialSelection={offcutSelection}
                    cart={cart}
                    cartIndex={cartIndex}
                    onConfirm={setOffcutSelection}
                    onClose={() => setShowOffcutModal(false)}
                />
            )}
        </div>
    );
});

export default ProfileCalculator;
