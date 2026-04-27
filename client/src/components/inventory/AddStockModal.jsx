const AddStockModal = ({ isOpen, onClose, product, selectedVariant, onVariantSelect, stockToAdd, onStockChange, onConfirm }) => {
    if (!isOpen || !product) return null;

    const darkInput = {
        background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.1)',
        borderRadius: '0.75rem', color: '#f1f5f9', outline: 'none', transition: 'border-color 0.2s',
        fontFamily: 'var(--font-mono)',
    };

    return (
        <div style={{
            position: 'fixed', inset: 0, zIndex: 50, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '1rem',
            background: 'rgba(9,14,26,0.85)', backdropFilter: 'blur(10px)',
        }}>
            <div style={{
                width: '100%', maxWidth: '480px',
                background: 'linear-gradient(145deg, rgba(13,20,38,0.99), rgba(9,14,26,0.99))',
                border: '1px solid rgba(255,255,255,0.1)',
                borderRadius: '1.5rem', overflow: 'hidden',
                boxShadow: '0 32px 80px rgba(0,0,0,0.6), 0 0 0 1px rgba(59,130,246,0.1)',
                animation: 'fadeInScale 0.2s ease',
            }}>
                {/* Header */}
                <div style={{
                    padding: '1.5rem 2rem', textAlign: 'center',
                    borderBottom: '1px solid rgba(255,255,255,0.07)',
                    background: 'linear-gradient(135deg, rgba(59,130,246,0.08), rgba(6,182,212,0.04))',
                }}>
                    <div style={{
                        width: '56px', height: '56px', borderRadius: '14px', margin: '0 auto 0.875rem',
                        background: 'linear-gradient(135deg, rgba(59,130,246,0.2), rgba(6,182,212,0.15))',
                        border: '1px solid rgba(59,130,246,0.3)',
                        display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '1.5rem',
                    }}>📦</div>
                    <h3 style={{ fontSize: '1.1rem', fontWeight: 800, color: '#f1f5f9', margin: '0 0 4px' }}>Restock Product</h3>
                    <p style={{ fontSize: '0.78rem', color: '#64748b', margin: 0 }}>{product.name}</p>
                </div>

                <div style={{ padding: '1.5rem 2rem' }}>
                    {/* Variant selector */}
                    <div style={{ marginBottom: '1.5rem' }}>
                        <label style={{ fontSize: '0.65rem', fontWeight: 700, color: '#475569', letterSpacing: '0.08em', textTransform: 'uppercase', display: 'block', marginBottom: '0.625rem' }}>
                            Select Variant
                        </label>
                        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '0.5rem' }}>
                            {Object.keys(product.stockVariants).map(variant => (
                                <button key={variant} onClick={() => onVariantSelect(variant)} style={{
                                    padding: '0.625rem', borderRadius: '0.625rem', cursor: 'pointer', transition: 'all 0.15s', textAlign: 'center',
                                    background: selectedVariant === variant ? 'linear-gradient(135deg, #3b82f6, #06b6d4)' : 'rgba(255,255,255,0.05)',
                                    border: `1px solid ${selectedVariant === variant ? 'rgba(59,130,246,0.5)' : 'rgba(255,255,255,0.08)'}`,
                                    color: selectedVariant === variant ? '#fff' : '#64748b',
                                    transform: selectedVariant === variant ? 'scale(1.03)' : 'scale(1)',
                                    boxShadow: selectedVariant === variant ? '0 4px 16px rgba(59,130,246,0.3)' : 'none',
                                }}>
                                    <div style={{ fontSize: '0.78rem', fontWeight: 700 }}>{variant}</div>
                                    <div style={{ fontSize: '0.65rem', fontFamily: 'var(--font-mono)', opacity: 0.7, marginTop: '2px' }}>
                                        {product.stockVariants[variant]}
                                    </div>
                                </button>
                            ))}
                        </div>
                    </div>

                    {/* Qty input */}
                    <div style={{ marginBottom: '1.5rem' }}>
                        <label style={{ fontSize: '0.65rem', fontWeight: 700, color: '#475569', letterSpacing: '0.08em', textTransform: 'uppercase', display: 'block', marginBottom: '0.625rem' }}>
                            Quantity to Add
                        </label>
                        <div style={{ position: 'relative' }}>
                            <button onClick={() => onStockChange(Math.max(0, (parseInt(stockToAdd) || 0) - 1).toString())} style={{
                                position: 'absolute', left: '0.5rem', top: '50%', transform: 'translateY(-50%)',
                                width: '36px', height: '36px', borderRadius: '8px', border: 'none', cursor: 'pointer',
                                background: 'rgba(255,255,255,0.07)', color: '#94a3b8', fontSize: '1.25rem', transition: 'all 0.15s',
                                display: 'flex', alignItems: 'center', justifyContent: 'center',
                            }}>−</button>
                            <input type="number" autoFocus placeholder="0" value={stockToAdd} onChange={e => onStockChange(e.target.value)} onKeyDown={e => e.key === 'Enter' && onConfirm()}
                                style={{ ...darkInput, width: '100%', textAlign: 'center', fontSize: '2.5rem', fontWeight: 900, padding: '1rem 3.5rem', boxSizing: 'border-box' }}
                                onFocus={e => { e.target.style.borderColor = 'rgba(59,130,246,0.5)'; }}
                                onBlur={e => { e.target.style.borderColor = 'rgba(255,255,255,0.1)'; }}
                            />
                            <button onClick={() => onStockChange(((parseInt(stockToAdd) || 0) + 1).toString())} style={{
                                position: 'absolute', right: '0.5rem', top: '50%', transform: 'translateY(-50%)',
                                width: '36px', height: '36px', borderRadius: '8px', border: 'none', cursor: 'pointer',
                                background: 'rgba(59,130,246,0.15)', color: '#60a5fa', fontSize: '1.25rem', transition: 'all 0.15s',
                                display: 'flex', alignItems: 'center', justifyContent: 'center',
                            }}>+</button>
                        </div>
                        {selectedVariant && (
                            <p style={{ textAlign: 'center', fontSize: '0.72rem', color: '#475569', marginTop: '0.5rem', fontFamily: 'var(--font-mono)' }}>
                                New total: <span style={{ color: '#60a5fa', fontWeight: 700 }}>
                                    {(product.stockVariants[selectedVariant] || 0) + (parseInt(stockToAdd) || 0)}
                                </span>
                            </p>
                        )}
                    </div>
                </div>

                {/* Footer */}
                <div style={{ padding: '0 2rem 1.5rem', display: 'flex', gap: '0.75rem' }}>
                    <button onClick={onClose} style={{
                        flex: 1, padding: '0.875rem', borderRadius: '0.875rem', border: '1px solid rgba(255,255,255,0.08)',
                        background: 'transparent', color: '#64748b', fontWeight: 700, cursor: 'pointer', transition: 'all 0.15s', fontSize: '0.875rem',
                    }}
                    onMouseEnter={e => { e.currentTarget.style.background = 'rgba(255,255,255,0.05)'; }}
                    onMouseLeave={e => { e.currentTarget.style.background = 'transparent'; }}
                    >Cancel</button>
                    <button onClick={onConfirm} disabled={!stockToAdd || parseInt(stockToAdd) <= 0} style={{
                        flex: 1, padding: '0.875rem', borderRadius: '0.875rem', border: 'none', cursor: 'pointer',
                        background: !stockToAdd || parseInt(stockToAdd) <= 0 ? 'rgba(255,255,255,0.06)' : 'linear-gradient(135deg, #3b82f6, #06b6d4)',
                        color: !stockToAdd || parseInt(stockToAdd) <= 0 ? '#334155' : '#fff',
                        fontWeight: 800, fontSize: '0.875rem',
                        boxShadow: !stockToAdd || parseInt(stockToAdd) <= 0 ? 'none' : '0 4px 16px rgba(59,130,246,0.3)',
                        transition: 'all 0.2s',
                    }}>Confirm Restock ✓</button>
                </div>
            </div>
        </div>
    );
};

export default AddStockModal;
