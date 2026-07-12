import { useState, useEffect } from 'react';
import { useProducts } from '../../context/ProductContext';

export default function EditProductModal({ isOpen, onClose, product }) {
    const { updateProduct } = useProducts();
    const [form, setForm] = useState({ name: '', trackOffcuts: false, unit: 'ft' });

    useEffect(() => {
        if (product) setForm({
            name: product.name || '',
            trackOffcuts: product.trackOffcuts || false,
            unit: product.unit || 'ft',
        });
    }, [product]);

    const set = (key, val) => setForm(f => ({ ...f, [key]: val }));

    const handleSave = () => {
        if (!product) return;
        const payload = { ...product, name: form.name, trackOffcuts: form.trackOffcuts, unit: form.unit };
        updateProduct(payload);
        onClose();
    };

    if (!isOpen || !product) return null;

    const inputStyle = {
        width: '100%', background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.1)',
        borderRadius: '0.75rem', padding: '0.75rem 1rem', color: '#f1f5f9',
        fontSize: '0.875rem', outline: 'none', transition: 'border-color 0.2s', boxSizing: 'border-box',
    };
    const labelStyle = { fontSize: '0.65rem', fontWeight: 700, color: '#475569', letterSpacing: '0.08em', textTransform: 'uppercase', display: 'block', marginBottom: '0.5rem' };

    return (
        <div style={{
            position: 'fixed', inset: 0, zIndex: 40,
            display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '1rem',
            background: 'rgba(9,14,26,0.85)', backdropFilter: 'blur(12px)',
        }} onClick={onClose}>
            <div onClick={e => e.stopPropagation()} style={{
                width: '100%', maxWidth: '420px',
                background: 'linear-gradient(145deg, rgba(13,20,38,0.99), rgba(9,14,26,0.99))',
                border: '1px solid rgba(255,255,255,0.1)',
                borderRadius: '1.25rem', overflow: 'hidden',
                boxShadow: '0 32px 80px rgba(0,0,0,0.6)',
                animation: 'fadeInScale 0.2s ease',
            }}>
                <div style={{ padding: '1.5rem', borderBottom: '1px solid rgba(255,255,255,0.07)' }}>
                    <h3 style={{ fontSize: '1rem', fontWeight: 800, color: '#f1f5f9', margin: 0 }}>Edit Product</h3>
                </div>
                <div style={{ padding: '1.5rem', display: 'flex', flexDirection: 'column', gap: '1rem' }}>
                    <div>
                        <label style={labelStyle}>Product Name</label>
                        <input type="text" autoFocus value={form.name} onChange={e => set('name', e.target.value)}
                            onKeyDown={e => e.key === 'Enter' && handleSave()}
                            placeholder="Enter product name..."
                            style={inputStyle}
                            onFocus={e => { e.target.style.borderColor = 'rgba(59,130,246,0.5)'; }}
                            onBlur={e => { e.target.style.borderColor = 'rgba(255,255,255,0.1)'; }}
                        />
                    </div>

                    <div>
                        <label style={labelStyle}>Measurement Unit</label>
                        <select value={form.unit} onChange={e => set('unit', e.target.value)}
                            style={{ ...inputStyle, width: '140px' }}
                            onFocus={e => { e.target.style.borderColor = 'rgba(59,130,246,0.5)'; }}
                            onBlur={e => { e.target.style.borderColor = 'rgba(255,255,255,0.1)'; }}
                        >
                            {['ft', 'mm', 'cm', 'm', 'in', 'pcs'].map(u => <option key={u} value={u}>{u}</option>)}
                        </select>
                    </div>

                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', padding: '0.875rem 1rem', borderRadius: '0.75rem', background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)', cursor: 'pointer' }}
                        onClick={() => set('trackOffcuts', !form.trackOffcuts)}>
                        <div style={{
                            width: '36px', height: '20px', borderRadius: '10px', position: 'relative',
                            background: form.trackOffcuts ? 'rgba(59,130,246,0.8)' : 'rgba(255,255,255,0.12)',
                            transition: 'background 0.2s', flexShrink: 0,
                        }}>
                            <div style={{
                                position: 'absolute', top: '2px', left: form.trackOffcuts ? '18px' : '2px',
                                width: '16px', height: '16px', borderRadius: '50%', background: '#fff',
                                transition: 'left 0.2s', boxShadow: '0 1px 4px rgba(0,0,0,0.4)',
                            }} />
                        </div>
                        <div>
                            <div style={{ fontSize: '0.82rem', fontWeight: 700, color: '#e2e8f0' }}>Track Offcuts</div>
                            <div style={{ fontSize: '0.68rem', color: '#64748b' }}>Enable best-fit cut & offcut remainder logic</div>
                        </div>
                    </div>
                </div>
                <div style={{ padding: '0 1.5rem 1.5rem', display: 'flex', gap: '0.75rem', justifyContent: 'flex-end' }}>
                    <button onClick={onClose} style={{
                        padding: '0.625rem 1.25rem', borderRadius: '0.75rem', cursor: 'pointer',
                        background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.08)',
                        color: '#64748b', fontWeight: 600, fontSize: '0.82rem', transition: 'all 0.15s',
                    }}>Cancel</button>
                    <button onClick={handleSave} style={{
                        padding: '0.625rem 1.25rem', borderRadius: '0.75rem', border: 'none', cursor: 'pointer',
                        background: 'linear-gradient(135deg, #3b82f6, #06b6d4)',
                        color: '#fff', fontWeight: 700, fontSize: '0.82rem',
                        boxShadow: '0 4px 16px rgba(59,130,246,0.3)', transition: 'all 0.15s',
                    }}>Save Changes</button>
                </div>
            </div>
        </div>
    );
}
