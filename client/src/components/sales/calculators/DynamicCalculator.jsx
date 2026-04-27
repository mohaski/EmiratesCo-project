import { useState, useEffect, useMemo, memo } from 'react';

const DynamicCalculator = memo(({ product, initialDetails, onUpdate }) => {
    const attributeKeys = Object.keys(product.attributes || {});

    const [selections, setSelections] = useState(() => {
        const initial = initialDetails?.selections ? { ...initialDetails.selections } : {};
        attributeKeys.forEach(key => {
            if (!initial[key]) {
                if (product.defaultAttributes?.[key]) initial[key] = product.defaultAttributes[key];
                else if (product.attributes[key]?.length > 0) initial[key] = product.attributes[key][0];
            }
        });
        return initial;
    });

    const [qty, setQty] = useState(initialDetails?.qty || 1);
    const [error, setError] = useState(null);

    useEffect(() => {
        const next = { ...selections };
        let changed = false;
        attributeKeys.forEach(key => {
            if (!next[key]) {
                const options = product.attributes[key] || [];
                if (options.length > 0) { next[key] = options[0]; changed = true; }
            }
        });
        if (changed) setSelections(next);
    }, [product.attributes, selections, attributeKeys]);

    const activeVariant = useMemo(() => {
        if (!product.variants) return null;
        return product.variants.find(v => attributeKeys.every(k => v.attributes[k] === selections[k]));
    }, [product.variants, selections, attributeKeys]);

    const currentPrice = activeVariant ? activeVariant.price : (product.priceFull || product.price || 0);
    const stockCount = activeVariant?.stock;

    useEffect(() => {
        let isValid = true;
        if (activeVariant && stockCount !== undefined) {
            if (qty > stockCount) { setError(`Only ${stockCount} items available in stock`); isValid = false; }
            else setError(null);
        } else setError(null);

        const total = qty * currentPrice;
        const variantName = attributeKeys.map(k => selections[k]).join(' - ');
        onUpdate(total, { selections, qty, variantId: activeVariant?.variantId || activeVariant?.id, description: variantName, isDynamic: true, isValid });
    }, [qty, currentPrice, selections, activeVariant, onUpdate, attributeKeys, stockCount]);

    const labelStyle = { fontSize: '0.62rem', fontWeight: 700, color: '#475569', letterSpacing: '0.08em', textTransform: 'uppercase' };
    const sectionStyle = { background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: '0.875rem', padding: '1rem', marginBottom: '0.75rem' };
    const chipBtn = (active) => ({
        padding: '0.3rem 0.875rem', borderRadius: '100px', fontSize: '0.72rem', fontWeight: 700,
        cursor: 'pointer', border: '1px solid', transition: 'all 0.15s',
        background: active ? 'rgba(59,130,246,0.15)' : 'transparent',
        borderColor: active ? 'rgba(59,130,246,0.4)' : 'rgba(255,255,255,0.1)',
        color: active ? '#60a5fa' : '#64748b',
    });

    return (
        <div>
            {/* Attribute Selectors */}
            {attributeKeys.length > 0 && (
                <div style={sectionStyle}>
                    {attributeKeys.map(key => (
                        <div key={key} style={{ marginBottom: '0.625rem' }}>
                            <span style={{ ...labelStyle, display: 'block', marginBottom: '0.375rem' }}>{key}</span>
                            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.375rem' }}>
                                {product.attributes[key].map(opt => (
                                    <button key={opt} onClick={() => setSelections(prev => ({ ...prev, [key]: opt }))} style={chipBtn(selections[key] === opt)}>{opt}</button>
                                ))}
                            </div>
                        </div>
                    ))}
                </div>
            )}

            {/* Price / Stock Display */}
            <div style={{ ...sectionStyle, textAlign: 'center', padding: '0.875rem' }}>
                {activeVariant ? (
                    <>
                        <p style={{ fontSize: '1.75rem', fontWeight: 900, fontFamily: 'var(--font-mono)', color: '#f1f5f9', margin: 0 }}>
                            KSH{currentPrice.toLocaleString()}
                        </p>
                        {stockCount !== undefined && (
                            <p style={{ fontSize: '0.72rem', fontWeight: 700, color: stockCount > 0 ? '#4ade80' : '#f87171', margin: '4px 0 0' }}>
                                {stockCount > 0 ? `${stockCount} in Stock` : 'Out of Stock'}
                            </p>
                        )}
                    </>
                ) : (
                    <p style={{ fontSize: '0.82rem', color: '#334155', fontStyle: 'italic', margin: 0 }}>Select options above</p>
                )}
            </div>

            {/* Quantity */}
            <div style={{ ...sectionStyle, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <div>
                    <p style={{ ...labelStyle, display: 'block', marginBottom: '2px' }}>Quantity</p>
                    <p style={{ fontSize: '0.68rem', color: '#475569', margin: 0, fontFamily: 'var(--font-mono)' }}>
                        Total: KSH{(qty * currentPrice).toLocaleString()}
                    </p>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                    <button onClick={() => setQty(Math.max(1, qty - 1))} style={{ width: '32px', height: '32px', borderRadius: '8px', border: 'none', cursor: 'pointer', background: 'rgba(255,255,255,0.07)', color: '#94a3b8', fontSize: '1rem', fontWeight: 700 }}>-</button>
                    <span style={{ fontSize: '1.5rem', fontWeight: 900, fontFamily: 'var(--font-mono)', color: error ? '#f87171' : '#f1f5f9', width: '48px', textAlign: 'center' }}>{qty}</span>
                    <button onClick={() => setQty(qty + 1)} style={{ width: '32px', height: '32px', borderRadius: '8px', border: 'none', cursor: 'pointer', background: 'rgba(59,130,246,0.15)', color: '#60a5fa', fontSize: '1rem', fontWeight: 700 }}>+</button>
                </div>
            </div>

            {error && (
                <p style={{ fontSize: '0.7rem', color: '#f87171', fontWeight: 700, margin: '0', animation: 'pulse 1.5s ease-in-out infinite' }}>{error}</p>
            )}
        </div>
    );
});

export default DynamicCalculator;
