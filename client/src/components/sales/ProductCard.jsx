import { memo } from 'react';
import { PROFILE_COLORS } from '../../hooks/useProductFiltering';

function getContrastText(hex) {
    if (!hex) return '#e2e8f0';
    const c = hex.replace('#', '');
    const r = parseInt(c.substring(0, 2), 16);
    const g = parseInt(c.substring(2, 4), 16);
    const b = parseInt(c.substring(4, 6), 16);
    const luminance = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
    return luminance > 0.6 ? '#0f172a' : '#f1f5f9';
}

// Lightens (positive) or darkens (negative) a hex color by a percentage
function shade(hex, percent) {
    const c = hex.replace('#', '');
    const r = parseInt(c.substring(0, 2), 16);
    const g = parseInt(c.substring(2, 4), 16);
    const b = parseInt(c.substring(4, 6), 16);
    const amt = Math.round(2.55 * percent);
    const clamp = v => Math.min(255, Math.max(0, v + amt));
    return `rgb(${clamp(r)}, ${clamp(g)}, ${clamp(b)})`;
}

function ProductCard({ product, onClick, selectedColor }) {
    const isProfile = product.category?.toLowerCase().includes('profile');
    const isGlass   = product.category?.toLowerCase().includes('glass');
    const displayGrid = isProfile || isGlass;
    const variantKey  = isProfile ? 'Length' : 'Thickness';

    // Rectangle color reflects the selected color, but only in profile sections
    const matchedColorHex = isProfile && selectedColor
        ? PROFILE_COLORS.find(c => c.name.toLowerCase() === selectedColor.toLowerCase())?.hex
        : null;
    const rectBackground = matchedColorHex
        ? `linear-gradient(155deg, ${shade(matchedColorHex, 16)} 0%, ${matchedColorHex} 48%, ${shade(matchedColorHex, -16)} 100%)`
        : 'linear-gradient(155deg, rgba(255,255,255,0.075) 0%, rgba(255,255,255,0.025) 55%, rgba(255,255,255,0.01) 100%)';
    const rectTextColor = matchedColorHex ? getContrastText(matchedColorHex) : '#e2e8f0';
    const isDarkText = rectTextColor === '#0f172a';

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

            {/* Product tile (color reflects selection in profile sections) */}
            <div className="product-tile" style={{
                aspectRatio: '4/3',
                borderRadius: '0.75rem',
                overflow: 'hidden',
                marginBottom: '0.875rem',
                background: rectBackground,
                border: '1px solid rgba(255,255,255,0.08)',
                boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.15), inset 0 -8px 16px rgba(0,0,0,0.16), 0 6px 16px rgba(0,0,0,0.2)',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                padding: '0.65rem',
                transition: 'background 0.25s ease, box-shadow 0.25s ease',
            }}>
                <span style={{
                    position: 'relative', zIndex: 1,
                    fontSize: '0.82rem', fontWeight: 700,
                    letterSpacing: '0.015em',
                    color: rectTextColor,
                    opacity: matchedColorHex ? 1 : 0.6,
                    textAlign: 'center',
                    lineHeight: 1.35,
                    textShadow: isDarkText ? '0 1px 0 rgba(255,255,255,0.45)' : '0 1px 3px rgba(0,0,0,0.5)',
                    overflow: 'hidden', textOverflow: 'ellipsis',
                    display: '-webkit-box', WebkitLineClamp: 3, WebkitBoxOrient: 'vertical',
                }}>
                    {product.name}
                </span>
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
