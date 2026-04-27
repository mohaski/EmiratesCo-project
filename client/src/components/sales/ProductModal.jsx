import { useState, useCallback } from 'react';
import ProfileCalculator from './calculators/ProfileCalculator';
import GlassCalculator from './calculators/GlassCalculator';
import AccessoryCalculator from './calculators/AccessoryCalculator';
import DynamicCalculator from './calculators/DynamicCalculator';
import StandardCalculator from './calculators/StandardCalculator';

export default function ProductModal({ product, isOpen, onClose, onAddToOrder, color, initialDetails, source = 'sales' }) {
    const [total, setTotal] = useState(0);
    const [details, setDetails] = useState(null);

    const handleUpdate = useCallback((newTotal, newDetails) => {
        setTotal(newTotal);
        setDetails(newDetails);
    }, []);

    const handleAdd = () => {
        const isStockValid = details?.isValid !== false;
        if (source === 'sales' && !isStockValid) return;
        if (total <= 0) return;
        onAddToOrder({ image: product.image, id: product.id, name: product.name, category: product.category, totalPrice: total, details });
        onClose();
    };

    if (!isOpen || !product) return null;

    const isProfile = product.category === 'ke-profile' || product.category === 'tz-profile';
    const isGlass = product.category === 'glass';
    const isAccessory = product.category === 'accessories';
    const isDynamic = !!product.variants;
    const canProceed = total > 0 && (source !== 'sales' || details?.isValid !== false);

    const categoryColor = isProfile ? '#a855f7' : isGlass ? '#06b6d4' : isAccessory ? '#22c55e' : '#3b82f6';

    return (
        <div style={{ position: 'absolute', inset: 0, zIndex: 50, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '1rem' }}>
            <div style={{ position: 'absolute', inset: 0, background: 'rgba(9,14,26,0.8)', backdropFilter: 'blur(8px)' }} onClick={onClose} />

            <div style={{
                position: 'relative', width: '100%', maxWidth: '780px',
                background: 'linear-gradient(145deg, rgba(13,20,38,0.99), rgba(9,14,26,0.99))',
                border: '1px solid rgba(255,255,255,0.1)',
                borderRadius: '1.5rem', overflow: 'hidden',
                boxShadow: `0 32px 80px rgba(0,0,0,0.7), 0 0 0 1px ${categoryColor}20`,
                maxHeight: '90vh', display: 'flex', flexDirection: 'column',
                animation: 'fadeInScale 0.2s ease',
            }}>
                {/* Header image strip */}
                <div style={{ position: 'relative', height: '140px', flexShrink: 0, overflow: 'hidden' }}>
                    <div style={{ position: 'absolute', inset: 0, background: `linear-gradient(135deg, ${categoryColor}20, rgba(9,14,26,0.8))` }} />
                    <img src={product.image} alt={product.name} style={{ width: '100%', height: '100%', objectFit: 'cover', opacity: 0.3, mixBlendMode: 'luminosity' }} />
                    <div style={{ position: 'absolute', inset: 0, background: 'linear-gradient(to top, rgba(9,14,26,0.9) 0%, transparent 50%)' }} />

                    {/* Close button */}
                    <button onClick={onClose} style={{
                        position: 'absolute', top: '1rem', right: '1rem',
                        width: '32px', height: '32px', borderRadius: '50%',
                        background: 'rgba(0,0,0,0.4)', border: '1px solid rgba(255,255,255,0.15)',
                        color: '#94a3b8', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center',
                        fontSize: '0.875rem', transition: 'all 0.2s',
                    }}
                    onMouseEnter={e => { e.currentTarget.style.background = 'rgba(239,68,68,0.3)'; e.currentTarget.style.color = '#fff'; }}
                    onMouseLeave={e => { e.currentTarget.style.background = 'rgba(0,0,0,0.4)'; e.currentTarget.style.color = '#94a3b8'; }}
                    >✕</button>

                    {/* Product name overlay */}
                    <div style={{ position: 'absolute', bottom: '1rem', left: '1.5rem' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.25rem' }}>
                            <span style={{
                                fontSize: '0.62rem', fontWeight: 700, letterSpacing: '0.1em', textTransform: 'uppercase',
                                background: `${categoryColor}25`, border: `1px solid ${categoryColor}40`,
                                color: categoryColor, borderRadius: '4px', padding: '2px 8px',
                            }}>
                                {product.category.toUpperCase().replace('-', ' ')}
                            </span>
                            {isProfile && color && (
                                <span style={{ fontSize: '0.62rem', fontWeight: 700, background: 'rgba(255,255,255,0.12)', border: '1px solid rgba(255,255,255,0.2)', borderRadius: '4px', padding: '2px 8px', color: '#e2e8f0', display: 'flex', alignItems: 'center', gap: '4px' }}>
                                    <span style={{ width: '8px', height: '8px', borderRadius: '50%', background: color === 'White' ? '#e2e8f0' : color === 'Silver' ? '#C0C0C0' : color === 'Gold' ? '#FFD700' : '#808080', display: 'inline-block' }} />
                                    {color}
                                </span>
                            )}
                        </div>
                        <h2 style={{ fontSize: '1.5rem', fontWeight: 900, color: '#f1f5f9', margin: 0, textShadow: '0 2px 8px rgba(0,0,0,0.5)' }}>{product.name}</h2>
                    </div>
                </div>

                {/* Calculator content */}
                <div style={{ flex: 1, overflowY: 'auto', padding: '1.25rem 1.5rem' }} className="custom-scrollbar">
                    {isProfile ? <ProfileCalculator key={product.id} product={product} color={color} initialDetails={initialDetails} onUpdate={handleUpdate} />
                        : isGlass ? <GlassCalculator key={product.id} product={product} initialDetails={initialDetails} onUpdate={handleUpdate} />
                            : isAccessory ? <AccessoryCalculator key={product.id} product={product} initialDetails={initialDetails} onUpdate={handleUpdate} />
                                : isDynamic ? <DynamicCalculator key={product.id} product={product} initialDetails={initialDetails} onUpdate={handleUpdate} />
                                    : <StandardCalculator key={product.id} product={product} initialDetails={initialDetails} onUpdate={handleUpdate} />}
                </div>

                {/* Footer */}
                <div style={{
                    padding: '1rem 1.5rem',
                    borderTop: '1px solid rgba(255,255,255,0.08)',
                    background: 'rgba(0,0,0,0.3)',
                    display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                    flexShrink: 0,
                }}>
                    <div>
                        <p style={{ fontSize: '0.65rem', fontWeight: 700, color: '#475569', letterSpacing: '0.08em', textTransform: 'uppercase', margin: '0 0 2px' }}>Total</p>
                        <p style={{ fontSize: '1.75rem', fontWeight: 900, color: '#f1f5f9', margin: 0, fontFamily: 'var(--font-mono)', letterSpacing: '-0.02em' }}>
                            KSH<span style={{ color: '#60a5fa' }}>{total.toLocaleString()}</span>
                        </p>
                    </div>
                    <button onClick={handleAdd} disabled={!canProceed} style={{
                        padding: '0.875rem 2rem', borderRadius: '0.875rem', border: 'none', cursor: canProceed ? 'pointer' : 'not-allowed',
                        background: canProceed ? `linear-gradient(135deg, ${categoryColor}, ${isProfile ? '#06b6d4' : isGlass ? '#3b82f6' : isAccessory ? '#16a34a' : '#06b6d4'})` : 'rgba(255,255,255,0.06)',
                        color: canProceed ? '#fff' : '#334155', fontWeight: 800, fontSize: '0.9rem',
                        boxShadow: canProceed ? `0 4px 20px ${categoryColor}40` : 'none',
                        transition: 'all 0.2s', transform: 'translateY(0)',
                    }}
                    onMouseEnter={e => { if (canProceed) e.currentTarget.style.transform = 'translateY(-1px)'; }}
                    onMouseLeave={e => { e.currentTarget.style.transform = 'translateY(0)'; }}
                    >
                        {source === 'invoice' ? '+ Add to Invoice' : '+ Add to Order'}
                    </button>
                </div>
            </div>
        </div>
    );
}
