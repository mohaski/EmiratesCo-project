import { useState, useEffect, useMemo, memo } from 'react';

const inputStyle = {
    background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.1)',
    borderRadius: '0.625rem', padding: '0.625rem 0.875rem', color: '#f1f5f9',
    fontSize: '0.875rem', outline: 'none', width: '100%', boxSizing: 'border-box',
    fontFamily: 'var(--font-mono)', transition: 'border-color 0.2s',
};
const sectionStyle = { background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: '0.875rem', padding: '1rem', marginBottom: '0.75rem' };
const labelStyle = { fontSize: '0.62rem', fontWeight: 700, color: '#475569', letterSpacing: '0.08em', textTransform: 'uppercase' };

const AccessoryCalculator = memo(({ product, initialDetails, onUpdate }) => {
    const hasVariants = product.variants && product.variants.length > 0;

    const [selections, setSelections] = useState(() => {
        if (initialDetails?.selectedAttributes) return initialDetails.selectedAttributes;
        const defaults = {};
        if (hasVariants) {
            const attrKeys = Object.keys(product.variants[0].attributes || {});
            attrKeys.forEach(key => { defaults[key] = null; });
        }
        return defaults;
    });

    const selectedVariant = useMemo(() => {
        if (!hasVariants) return product;
        return product.variants.find(v =>
            Object.entries(selections).every(([key, val]) => v.attributes[key] === val)
        ) || null;
    }, [product, hasVariants, selections]);

    const availableAttributes = useMemo(() => {
        if (!hasVariants) return {};
        const attrs = {};
        product.variants.forEach(v => {
            Object.entries(v.attributes).forEach(([key, val]) => {
                if (!attrs[key]) attrs[key] = new Set();
                attrs[key].add(val);
            });
        });
        const result = {};
        Object.keys(attrs).forEach(k => result[k] = Array.from(attrs[k]));
        return result;
    }, [product.variants, hasVariants]);

    useEffect(() => {
        if (hasVariants) {
            setSelections(prev => {
                const next = { ...prev };
                let changed = false;
                Object.entries(availableAttributes).forEach(([key, opts]) => {
                    if (opts.length > 0 && !next[key]) { next[key] = opts[0]; changed = true; }
                });
                return changed ? next : prev;
            });
        }
    }, [availableAttributes, hasVariants]);

    const [qtyFull, setQtyFull] = useState(initialDetails?.qtyFull || 0);
    const [qtyHalf, setQtyHalf] = useState(initialDetails?.qtyHalf || 0);
    const [cutLength, setCutLength] = useState(initialDetails?.cutLength || '');
    const [qty, setQty] = useState(initialDetails?.qty || 1);
    const [salesMode] = useState(initialDetails?.salesMode || 'roll');

    const rollOptions = product.rollOptions || (product.priceRoll ? [{ label: 'Standard Roll', length: product.rollLength, price: product.priceRoll }] : []);
    const hasRollOption = rollOptions.length > 0 && !hasVariants;
    const [selectedRoll] = useState(initialDetails?.selectedRoll || (hasRollOption ? rollOptions[0] : null));
    const [error, setError] = useState(null);

    useEffect(() => {
        if (hasVariants && !selectedVariant) { onUpdate(0, { isValid: false, warning: 'Please select options' }); return; }
        const activeItem = selectedVariant || product;
        const trackOffcuts = activeItem.trackOffcuts || product.trackOffcuts;
        let total = 0;
        const lineItems = [];
        const attributesDetail = [];
        let isValid = true;
        let finalError = null;

        if (hasVariants) Object.entries(selections).forEach(([k, v]) => { if (v) attributesDetail.push({ label: k, value: v }); });
        if (!hasVariants && product.hasColor && initialDetails?.color) attributesDetail.push({ label: 'Color', value: initialDetails.color });

        const stock = activeItem.stock || 0;

        if (trackOffcuts) {
            const pFull = activeItem.priceFull || activeItem.price || 0;
            const pHalf = activeItem.priceHalf || 0;
            const pCut = activeItem.priceUnit || activeItem.priceFoot || 0;
            const totalFullPrice = qtyFull * pFull;
            const totalHalfPrice = qtyHalf * pHalf;
            let totalCutPrice = 0;
            const l = parseFloat(cutLength) || 0;
            if (l > 0) totalCutPrice = l * pCut;
            total = totalFullPrice + totalHalfPrice + totalCutPrice;
            if (qtyFull > stock) { finalError = `Insufficient Stock (Full). Have ${stock}`; isValid = false; }
            if (qtyFull > 0) lineItems.push({ type: 'accessory-full', label: 'Full', qty: qtyFull, rate: pFull, total: totalFullPrice });
            if (qtyHalf > 0) lineItems.push({ type: 'accessory-half', label: 'Half', qty: qtyHalf, rate: pHalf, total: totalHalfPrice });
            if (totalCutPrice > 0) lineItems.push({ type: 'accessory-cut', label: `Cut ${l}${activeItem.unit || ''}`, qty: 1, rate: pCut * l, total: totalCutPrice, meta: { length: l, unit: activeItem.unit || '' } });
            onUpdate(total, { lineItems, attributes: attributesDetail, qtyFull, qtyHalf, cutLength: l > 0 ? l : null, cutQty: 1, trackOffcuts: true, variantId: hasVariants && selectedVariant ? (selectedVariant.variantId || selectedVariant.id) : null, isValid, warning: finalError });
        } else {
            if (hasRollOption && salesMode === 'roll') {
                const price = selectedRoll?.price || 0;
                total = qty * price;
                lineItems.push({ type: 'accessory-roll', label: selectedRoll?.label || 'Roll', qty, rate: price, total, meta: { length: selectedRoll?.length } });
                attributesDetail.push({ label: 'Roll Type', value: selectedRoll?.label });
            } else {
                const price = activeItem.price || activeItem.priceFull || 0;
                total = qty * price;
                if (qty > stock) { finalError = `Only ${stock} items available`; isValid = false; }
                lineItems.push({ type: 'accessory-unit', label: 'Quantity', qty, rate: price, total, meta: { unit: activeItem.unit } });
            }
            onUpdate(total, { lineItems, attributes: attributesDetail, qty, salesMode, selectedRoll, variantId: activeItem.variantId || activeItem.id, isValid, warning: finalError });
        }
        setError(finalError);
    }, [hasVariants, selectedVariant, product, selections, qtyFull, qtyHalf, cutLength, qty, salesMode, selectedRoll, hasRollOption, onUpdate]);

    const handleVariantSelect = (key, val) => setSelections(prev => ({ ...prev, [key]: val }));
    const activeItem = selectedVariant || product;
    const trackOffcuts = activeItem.trackOffcuts || activeItem.track_offcuts || product.trackOffcuts || product.track_offcuts;

    const chipBtn = (active) => ({
        padding: '0.3rem 0.875rem', borderRadius: '100px', fontSize: '0.72rem', fontWeight: 700,
        cursor: 'pointer', border: '1px solid', transition: 'all 0.15s',
        background: active ? 'rgba(34,197,94,0.15)' : 'transparent',
        borderColor: active ? 'rgba(34,197,94,0.4)' : 'rgba(255,255,255,0.1)',
        color: active ? '#4ade80' : '#64748b',
    });

    return (
        <div>
            {/* Variant Attribute Selectors */}
            {hasVariants && Object.entries(availableAttributes).length > 0 && (
                <div style={sectionStyle}>
                    {Object.entries(availableAttributes).map(([key, options]) => (
                        <div key={key} style={{ marginBottom: '0.625rem' }}>
                            <span style={{ ...labelStyle, display: 'block', marginBottom: '0.375rem' }}>{key}</span>
                            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.375rem' }}>
                                {options.map(opt => (
                                    <button key={opt} onClick={() => handleVariantSelect(key, opt)} style={chipBtn(selections[key] === opt)}>{opt}</button>
                                ))}
                            </div>
                        </div>
                    ))}
                </div>
            )}

            {trackOffcuts ? (
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.75rem' }}>
                    {/* Standard lengths */}
                    <div style={sectionStyle}>
                        <p style={{ ...labelStyle, marginBottom: '0.875rem', display: 'block' }}>📏 Standard</p>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.625rem' }}>
                            <div>
                                <p style={{ fontSize: '0.82rem', color: '#94a3b8', margin: '0 0 2px', fontWeight: 600 }}>Full</p>
                                <p style={{ fontSize: '0.68rem', color: '#4ade80', fontFamily: 'var(--font-mono)', margin: 0 }}>KSH{activeItem.priceFull || activeItem.price || 0}/pc</p>
                            </div>
                            <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                                <button onClick={() => setQtyFull(Math.max(0, qtyFull - 1))} style={{ width: '30px', height: '30px', borderRadius: '7px', border: 'none', cursor: 'pointer', background: 'rgba(255,255,255,0.07)', color: '#94a3b8' }}>-</button>
                                <input type="number" value={qtyFull === 0 ? '' : qtyFull} onChange={e => setQtyFull(e.target.value === '' ? 0 : Math.max(0, parseInt(e.target.value) || 0))} placeholder="0"
                                    style={{ ...inputStyle, width: '48px', textAlign: 'center', padding: '0.375rem' }} />
                                <button onClick={() => setQtyFull(qtyFull + 1)} style={{ width: '30px', height: '30px', borderRadius: '7px', border: 'none', cursor: 'pointer', background: 'rgba(34,197,94,0.15)', color: '#4ade80' }}>+</button>
                            </div>
                        </div>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', paddingTop: '0.625rem', borderTop: '1px solid rgba(255,255,255,0.06)' }}>
                            <div>
                                <p style={{ fontSize: '0.82rem', color: '#94a3b8', margin: '0 0 2px', fontWeight: 600 }}>Half</p>
                                <p style={{ fontSize: '0.68rem', color: '#4ade80', fontFamily: 'var(--font-mono)', margin: 0 }}>KSH{activeItem.priceHalf || 0}/pc</p>
                            </div>
                            <button onClick={() => setQtyHalf(qtyHalf > 0 ? 0 : 1)} style={{
                                width: '44px', height: '24px', borderRadius: '100px', border: 'none', cursor: 'pointer', position: 'relative',
                                background: qtyHalf > 0 ? 'linear-gradient(135deg, #22c55e, #16a34a)' : 'rgba(255,255,255,0.1)', transition: 'background 0.2s',
                            }}>
                                <span style={{ position: 'absolute', top: '3px', left: qtyHalf > 0 ? '22px' : '3px', width: '18px', height: '18px', borderRadius: '50%', background: '#fff', transition: 'left 0.2s', display: 'block' }} />
                            </button>
                        </div>
                    </div>

                    {/* Custom Cut */}
                    <div style={sectionStyle}>
                        <p style={{ ...labelStyle, marginBottom: '0.875rem', display: 'block' }}>✂️ Custom Cut</p>
                        <p style={{ fontSize: '0.78rem', color: '#64748b', margin: '0 0 0.5rem', fontWeight: 500 }}>Length needed</p>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                            <input type="number" step="1" value={cutLength} onChange={e => setCutLength(e.target.value)} placeholder="0"
                                style={{ ...inputStyle, fontSize: '1.25rem', fontWeight: 700 }}
                                onFocus={e => { e.target.style.borderColor = 'rgba(34,197,94,0.5)'; }}
                                onBlur={e => { e.target.style.borderColor = 'rgba(255,255,255,0.1)'; }}
                            />
                            <span style={{ color: '#64748b', fontWeight: 700, flexShrink: 0 }}>{activeItem.unit || 'ft'}</span>
                        </div>
                        <p style={{ fontSize: '0.68rem', color: '#4ade80', fontFamily: 'var(--font-mono)', margin: '0.375rem 0 0', textAlign: 'right' }}>KSH{activeItem.priceUnit || activeItem.priceFoot || 0}/{activeItem.unit || 'unit'}</p>
                    </div>
                </div>
            ) : (
                /* Simple qty */
                <div style={{ ...sectionStyle, textAlign: 'center', padding: '1.5rem 1rem' }}>
                    <p style={{ ...labelStyle, marginBottom: '1rem', display: 'block' }}>{hasRollOption ? 'Number of Rolls' : 'Quantity'}</p>
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '1rem' }}>
                        <button onClick={() => setQty(Math.max(1, qty - 1))} style={{ width: '44px', height: '44px', borderRadius: '10px', border: '1px solid rgba(255,255,255,0.1)', cursor: 'pointer', background: 'rgba(255,255,255,0.06)', color: '#94a3b8', fontSize: '1.25rem', fontWeight: 700 }}>-</button>
                        <span style={{ fontSize: '2.5rem', fontWeight: 900, fontFamily: 'var(--font-mono)', color: '#f1f5f9', width: '80px', textAlign: 'center' }}>{qty}</span>
                        <button onClick={() => setQty(qty + 1)} style={{ width: '44px', height: '44px', borderRadius: '10px', border: 'none', cursor: 'pointer', background: 'rgba(34,197,94,0.15)', color: '#4ade80', fontSize: '1.25rem', fontWeight: 700 }}>+</button>
                    </div>
                    <p style={{ fontSize: '0.78rem', color: '#4ade80', fontFamily: 'var(--font-mono)', marginTop: '0.5rem' }}>
                        KSH{activeItem.price || activeItem.priceFull || 0} per {activeItem.unit || 'unit'}
                    </p>
                    {hasRollOption && <p style={{ fontSize: '0.68rem', color: '#475569', marginTop: '0.25rem' }}>Roll Length: {product.rollLength}m</p>}
                </div>
            )}

            {error && (
                <p style={{ fontSize: '0.7rem', color: '#f87171', fontWeight: 700, margin: '0.5rem 0 0', display: 'flex', alignItems: 'center', gap: '0.375rem', animation: 'pulse 1.5s ease-in-out infinite' }}>
                    <svg width="12" height="12" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" /></svg>
                    {error}
                </p>
            )}
        </div>
    );
});

export default AccessoryCalculator;
