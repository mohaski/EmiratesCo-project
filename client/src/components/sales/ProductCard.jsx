import { memo } from 'react';

function ProductCard({ product, onClick, selectedColor }) {
    const isProfile = product.category?.toLowerCase().includes('profile');
    const isGlass   = product.category?.toLowerCase().includes('glass');
    const displayGrid = isProfile || isGlass;
    const variantKey  = isProfile ? 'Length' : 'Thickness';

    // Resolve dynamic pricing based on selected color
    let displayPrice = {
        full: product.priceFull || product.price || 0,
        half: product.priceHalf || 0,
        unit: product.priceFoot || product.priceUnit || product.priceSqFt || 0,
    };

    if (selectedColor && product.variants?.length > 0) {
        const normalizedColor = selectedColor.toLowerCase();
        const matchingVariant = product.variants.find(v => {
            const vColor = v.attributes?.Color?.toLowerCase();
            return vColor === normalizedColor || v.name?.toLowerCase().includes(normalizedColor);
        });
        if (matchingVariant) {
            displayPrice = {
                full: matchingVariant.price || 0,
                half: matchingVariant.priceHalf || (matchingVariant.price ? matchingVariant.price / 2 : 0),
                unit: matchingVariant.priceUnit || 0,
            };
        }
    }

    let gridPricing = [];
    if (displayGrid && product.variants?.length > 0) {
        const variantMap = new Map();
        const normalizedColor = selectedColor ? selectedColor.toLowerCase() : null;

        product.variants.forEach(v => {
            if (normalizedColor) {
                const attrKeys = Object.keys(v.attributes || {});
                const colorKey = attrKeys.find(k => k.toLowerCase() === 'color');
                const vColor   = colorKey ? v.attributes[colorKey].toLowerCase() : '';
                const vName    = v.name?.toLowerCase() || '';
                if (isProfile && vColor !== normalizedColor && !vName.includes(normalizedColor)) return;
                if (isGlass  && vColor && vColor !== normalizedColor && !vName.includes(normalizedColor)) return;
            }
            const attrKeys = Object.keys(v.attributes || {});
            const targetKey = attrKeys.find(k => k.toLowerCase() === variantKey.toLowerCase());
            const headerVal = targetKey ? v.attributes[targetKey] : null;
            if (headerVal && !variantMap.has(headerVal)) {
                variantMap.set(headerVal, {
                    full: v.price || v.priceFull || 0,
                    half: v.priceHalf || (v.price ? v.price / 2 : 0),
                    unit: v.priceUnit || v.priceFoot || v.priceSqFt || 0,
                });
            }
        });

        gridPricing = Array.from(variantMap.entries())
            .map(([headerVal, prices]) => ({ headerVal, prices }))
            .sort((a, b) => {
                const nA = parseFloat(a.headerVal.replace(/[^\d.]/g, ''));
                const nB = parseFloat(b.headerVal.replace(/[^\d.]/g, ''));
                if (!isNaN(nA) && !isNaN(nB)) return nB - nA;
                return String(b.headerVal).localeCompare(String(a.headerVal));
            })
            .slice(0, 2);
    }

    const hasStock = product.stockQuantity === undefined || product.stockQuantity > 0;

    return (
        <div
            onClick={() => onClick(product)}
            className="product-card"
            style={{ position: 'relative', cursor: 'pointer' }}
        >
            {/* Stock badge */}
            {!hasStock && (
                <div style={{
                    position: 'absolute', top: '0.75rem', right: '0.75rem',
                    fontSize: '0.6rem', fontWeight: 700,
                    padding: '2px 6px', borderRadius: '4px',
                    background: 'rgba(239,68,68,0.15)', border: '1px solid rgba(239,68,68,0.3)',
                    color: '#f87171', letterSpacing: '0.06em', textTransform: 'uppercase',
                    zIndex: 2,
                }}>
                    Out
                </div>
            )}

            {/* Product image */}
            <div style={{
                aspectRatio: '4/3',
                borderRadius: '0.75rem',
                overflow: 'hidden',
                marginBottom: '0.875rem',
                background: 'rgba(255,255,255,0.04)',
                border: '1px solid rgba(255,255,255,0.06)',
                position: 'relative',
            }}>
                {product.image ? (
                    <img
                        src={product.image}
                        alt={product.name}
                        loading="lazy"
                        style={{
                            width: '100%', height: '100%',
                            objectFit: 'cover',
                            transition: 'transform 0.4s ease',
                            mixBlendMode: 'luminosity',
                            opacity: 0.85,
                        }}
                        onMouseEnter={e => { e.target.style.transform = 'scale(1.05)'; e.target.style.opacity = '1'; e.target.style.mixBlendMode = 'normal'; }}
                        onMouseLeave={e => { e.target.style.transform = ''; e.target.style.opacity = '0.85'; e.target.style.mixBlendMode = 'luminosity'; }}
                    />
                ) : (
                    <div style={{
                        width: '100%', height: '100%',
                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                        fontSize: '2rem', opacity: 0.4,
                    }}>
                        {isGlass ? '🪟' : isProfile ? '🔩' : '📦'}
                    </div>
                )}
            </div>

            {/* Product name */}
            <h3 style={{
                fontSize: '0.875rem', fontWeight: 700,
                color: '#e2e8f0', marginBottom: '0.75rem',
                lineHeight: 1.3, letterSpacing: '-0.01em',
                overflow: 'hidden', textOverflow: 'ellipsis',
                display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical',
                transition: 'color 0.2s ease',
            }}>
                {product.name}
            </h3>

            {/* Price section */}
            <div style={{
                borderTop: '1px solid rgba(255,255,255,0.06)',
                paddingTop: '0.75rem',
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'flex-end',
            }}>
                <div style={{ flex: 1, marginRight: '0.5rem' }}>
                    {gridPricing.length > 0 ? (
                        <div style={{
                            display: 'grid',
                            gridTemplateColumns: `auto repeat(${gridPricing.length}, minmax(0, 1fr))`,
                            gap: '2px 6px',
                            alignItems: 'center',
                        }}>
                            {/* Headers */}
                            <div />
                            {gridPricing.map(p => (
                                <div key={`h-${p.headerVal}`} style={{
                                    fontSize: '0.6rem', fontWeight: 800, color: '#60a5fa',
                                    textAlign: 'right', borderBottom: '1px solid rgba(59,130,246,0.2)',
                                    paddingBottom: '2px', letterSpacing: '0.04em',
                                }}>
                                    {p.headerVal}
                                </div>
                            ))}

                            {gridPricing.some(p => p.prices.full > 0) && <>
                                <div style={{ fontSize: '0.55rem', color: '#334155', fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase' }}>Full</div>
                                {gridPricing.map(p => (
                                    <div key={`f-${p.headerVal}`} style={{ fontSize: '0.72rem', fontWeight: 700, color: '#cbd5e1', textAlign: 'right' }}>
                                        {p.prices.full > 0 ? `${p.prices.full}` : '—'}
                                    </div>
                                ))}
                            </>}

                            {gridPricing.some(p => p.prices.half > 0) && <>
                                <div style={{ fontSize: '0.55rem', color: '#334155', fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase' }}>Half</div>
                                {gridPricing.map(p => (
                                    <div key={`h2-${p.headerVal}`} style={{ fontSize: '0.72rem', fontWeight: 700, color: '#cbd5e1', textAlign: 'right' }}>
                                        {p.prices.half > 0 ? `${p.prices.half}` : '—'}
                                    </div>
                                ))}
                            </>}

                            {gridPricing.some(p => p.prices.unit > 0) && <>
                                <div style={{ fontSize: '0.55rem', color: '#334155', fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase' }}>{isGlass ? 'SqFt' : 'Ft'}</div>
                                {gridPricing.map(p => (
                                    <div key={`u-${p.headerVal}`} style={{ fontSize: '0.72rem', fontWeight: 700, color: '#cbd5e1', textAlign: 'right' }}>
                                        {p.prices.unit > 0 ? `${p.prices.unit}` : '—'}
                                    </div>
                                ))}
                            </>}
                        </div>
                    ) : (
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '3px' }}>
                            {displayPrice.full > 0 && (
                                <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                                    <span style={{ fontSize: '0.6rem', color: '#334155', fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase' }}>Full</span>
                                    <span style={{ fontSize: '0.8rem', fontWeight: 700, color: '#e2e8f0' }}>KSH {displayPrice.full}</span>
                                </div>
                            )}
                            {displayPrice.half > 0 && (
                                <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                                    <span style={{ fontSize: '0.6rem', color: '#334155', fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase' }}>Half</span>
                                    <span style={{ fontSize: '0.8rem', fontWeight: 700, color: '#e2e8f0' }}>KSH {displayPrice.half}</span>
                                </div>
                            )}
                            {displayPrice.unit > 0 && (
                                <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                                    <span style={{ fontSize: '0.6rem', color: '#334155', fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase' }}>
                                        {isProfile ? 'Ft' : isGlass ? 'SqFt' : 'Unit'}
                                    </span>
                                    <span style={{ fontSize: '0.8rem', fontWeight: 700, color: '#e2e8f0' }}>KSH {displayPrice.unit}</span>
                                </div>
                            )}
                            {!displayPrice.full && !displayPrice.half && !displayPrice.unit && (
                                <span style={{ fontSize: '0.75rem', color: '#334155', fontStyle: 'italic' }}>Quote on request</span>
                            )}
                        </div>
                    )}
                </div>

                {/* Add button */}
                <button
                    onClick={e => { e.stopPropagation(); onClick(product); }}
                    style={{
                        flexShrink: 0,
                        width: '30px', height: '30px',
                        borderRadius: '8px',
                        background: 'rgba(59,130,246,0.15)',
                        border: '1px solid rgba(59,130,246,0.3)',
                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                        color: '#60a5fa',
                        cursor: 'pointer',
                        fontSize: '1.1rem', lineHeight: 1,
                        transition: 'all 0.2s ease',
                        fontWeight: 700,
                    }}
                    onMouseEnter={e => { e.currentTarget.style.background = 'linear-gradient(135deg, #3b82f6, #06b6d4)'; e.currentTarget.style.color = '#fff'; e.currentTarget.style.borderColor = 'transparent'; e.currentTarget.style.boxShadow = '0 4px 12px rgba(59,130,246,0.35)'; }}
                    onMouseLeave={e => { e.currentTarget.style.background = 'rgba(59,130,246,0.15)'; e.currentTarget.style.color = '#60a5fa'; e.currentTarget.style.borderColor = 'rgba(59,130,246,0.3)'; e.currentTarget.style.boxShadow = ''; }}
                >
                    +
                </button>
            </div>
        </div>
    );
}

export default memo(ProductCard);
