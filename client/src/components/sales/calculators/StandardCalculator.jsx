import { useState, useEffect, memo } from 'react';

const StandardCalculator = memo(({ product, initialDetails, onUpdate }) => {
    const [qty, setQty] = useState(initialDetails?.qty || 1);
    const stock = product.stock || 0;
    const [error, setError] = useState(null);

    useEffect(() => {
        const isValid = qty <= stock;
        setError(!isValid ? `Only ${stock} items available in stock` : null);

        const total = qty * product.price;
        const lineItems = [{ type: 'standard', label: product.name || 'Item', qty, rate: product.price, total, meta: { unit: product.unit } }];
        onUpdate(total, { lineItems, attributes: [], qty, unit: product.unit, isValid });
    }, [qty, product.price, product.unit, product.name, onUpdate, stock]);

    return (
        <div style={{
            background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)',
            borderRadius: '0.875rem', padding: '1.5rem', textAlign: 'center',
        }}>
            <p style={{ fontSize: '0.62rem', fontWeight: 700, color: '#475569', letterSpacing: '0.08em', textTransform: 'uppercase', marginBottom: '1.25rem' }}>
                Quantity ({product.unit}s)
            </p>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '1rem', marginBottom: '0.75rem' }}>
                <button onClick={() => setQty(Math.max(1, qty - 1))} style={{
                    width: '48px', height: '48px', borderRadius: '12px', border: '1px solid rgba(255,255,255,0.1)',
                    cursor: 'pointer', background: 'rgba(255,255,255,0.06)', color: '#94a3b8', fontSize: '1.5rem', fontWeight: 700,
                }}>-</button>
                <span style={{
                    fontSize: '3rem', fontWeight: 900, fontFamily: 'var(--font-mono)',
                    color: error ? '#f87171' : '#f1f5f9', width: '80px', textAlign: 'center',
                }}>{qty}</span>
                <button onClick={() => setQty(qty + 1)} style={{
                    width: '48px', height: '48px', borderRadius: '12px', border: 'none',
                    cursor: 'pointer', background: 'rgba(59,130,246,0.15)', color: '#60a5fa', fontSize: '1.5rem', fontWeight: 700,
                }}>+</button>
            </div>
            <p style={{ fontSize: '0.875rem', color: '#60a5fa', fontFamily: 'var(--font-mono)', fontWeight: 600 }}>
                KSH{product.price} per {product.unit}
            </p>
            <p style={{ fontSize: '0.68rem', color: '#334155', marginTop: '0.25rem', fontWeight: 500 }}>
                Available: {stock}
            </p>
            {error && (
                <p style={{ fontSize: '0.7rem', color: '#f87171', fontWeight: 700, marginTop: '0.75rem', animation: 'pulse 1.5s ease-in-out infinite' }}>
                    {error}
                </p>
            )}
        </div>
    );
});

export default StandardCalculator;
