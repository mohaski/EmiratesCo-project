import { useEffect, useState } from 'react';

const rowInput = {
    background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: '6px',
    color: '#e2e8f0', fontSize: '0.82rem', padding: '5px 8px', outline: 'none', fontFamily: 'var(--font-mono)',
};

const getVariantLabel = v => v.name || Object.values(v.attributes || {}).join(' - ');

const emptyRow = (hasDimensions) => hasDimensions
    ? { width: '', height: '', quantity: '1' }
    : { length: '', quantity: '1' };

// Manager-facing bulk entry for offcuts the system never produced itself —
// leftover pieces found/measured by hand (e.g. from before tracking started,
// or scraps the cutter set aside). Inserted straight into the pickable pool
// alongside cutting-job-generated offcuts; doesn't touch product.stock_quantity.
export default function AddOffcutsModal({ isOpen, onClose, product, onSubmit }) {
    const variants = product?.variants || [];
    const hasDimensions = !!product?.hasDimensions;
    const unit = product?.unit || 'ft';

    const [selectedVariantId, setSelectedVariantId] = useState(null);
    const [rows, setRows] = useState([emptyRow(hasDimensions)]);
    const [submitting, setSubmitting] = useState(false);
    const [error, setError] = useState('');

    useEffect(() => {
        if (isOpen) {
            setSelectedVariantId(variants[0]?.id ?? null);
            setRows([emptyRow(hasDimensions)]);
            setError('');
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [isOpen, product?.id]);

    if (!isOpen || !product) return null;

    const updateRow = (idx, field, value) => setRows(prev => prev.map((r, i) => i === idx ? { ...r, [field]: value } : r));
    const removeRow = (idx) => setRows(prev => prev.filter((_, i) => i !== idx));
    const addRow = () => setRows(prev => [...prev, emptyRow(hasDimensions)]);

    const isRowValid = (r) => {
        const qty = parseInt(r.quantity);
        if (!(qty > 0)) return false;
        return hasDimensions
            ? parseFloat(r.width) > 0 && parseFloat(r.height) > 0
            : parseFloat(r.length) > 0;
    };
    const validRows = rows.filter(isRowValid);
    const canSubmit = !submitting && rows.length > 0 && validRows.length === rows.length && (variants.length === 0 || selectedVariantId != null);

    const handleSubmit = async () => {
        if (!canSubmit) return;
        setSubmitting(true);
        setError('');
        try {
            const payload = rows.map(r => ({
                variantId: selectedVariantId,
                length: hasDimensions ? null : parseFloat(r.length),
                width: hasDimensions ? parseFloat(r.width) : null,
                height: hasDimensions ? parseFloat(r.height) : null,
                quantity: parseInt(r.quantity) || 1,
            }));
            await onSubmit(payload);
            onClose();
        } catch (err) {
            setError(err.response?.data?.detail || 'Failed to add offcuts. Please try again.');
        } finally {
            setSubmitting(false);
        }
    };

    return (
        <div style={{
            position: 'fixed', inset: 0, zIndex: 50, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '1rem',
            background: 'rgba(9,14,26,0.85)', backdropFilter: 'blur(10px)',
        }} onClick={onClose}>
            <div onClick={e => e.stopPropagation()} style={{
                width: '100%', maxWidth: '560px', maxHeight: '88vh',
                background: 'linear-gradient(145deg, rgba(13,20,38,0.99), rgba(9,14,26,0.99))',
                border: '1px solid rgba(255,255,255,0.1)', borderRadius: '1.5rem', overflow: 'hidden',
                boxShadow: '0 32px 80px rgba(0,0,0,0.6), 0 0 0 1px rgba(6,182,212,0.1)',
                display: 'flex', flexDirection: 'column',
                animation: 'fadeInScale 0.2s ease',
            }}>
                {/* Header */}
                <div style={{
                    padding: '1.5rem 2rem', textAlign: 'center', flexShrink: 0,
                    borderBottom: '1px solid rgba(255,255,255,0.07)',
                    background: 'linear-gradient(135deg, rgba(6,182,212,0.08), rgba(59,130,246,0.04))',
                }}>
                    <div style={{
                        width: '56px', height: '56px', borderRadius: '14px', margin: '0 auto 0.875rem',
                        background: 'linear-gradient(135deg, rgba(6,182,212,0.2), rgba(59,130,246,0.15))',
                        border: '1px solid rgba(6,182,212,0.3)',
                        display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '1.5rem',
                    }}>✂️</div>
                    <h3 style={{ fontSize: '1.1rem', fontWeight: 800, color: '#f1f5f9', margin: '0 0 4px' }}>Add Offcuts</h3>
                    <p style={{ fontSize: '0.78rem', color: '#64748b', margin: 0 }}>{product.name}</p>
                </div>

                <div style={{ flex: 1, overflowY: 'auto', padding: '1.5rem 2rem' }} className="custom-scrollbar">
                    {/* Variant selector */}
                    {variants.length > 0 && (
                        <div style={{ marginBottom: '1.5rem' }}>
                            <label style={{ fontSize: '0.65rem', fontWeight: 700, color: '#475569', letterSpacing: '0.08em', textTransform: 'uppercase', display: 'block', marginBottom: '0.625rem' }}>
                                Select Variant
                            </label>
                            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(110px, 1fr))', gap: '0.5rem' }}>
                                {variants.map(v => (
                                    <button key={v.id} onClick={() => setSelectedVariantId(v.id)} style={{
                                        padding: '0.625rem', borderRadius: '0.625rem', cursor: 'pointer', transition: 'all 0.15s', textAlign: 'center',
                                        background: selectedVariantId === v.id ? 'linear-gradient(135deg, #06b6d4, #3b82f6)' : 'rgba(255,255,255,0.05)',
                                        border: `1px solid ${selectedVariantId === v.id ? 'rgba(6,182,212,0.5)' : 'rgba(255,255,255,0.08)'}`,
                                        color: selectedVariantId === v.id ? '#fff' : '#64748b',
                                        fontSize: '0.78rem', fontWeight: 700,
                                    }}>{getVariantLabel(v)}</button>
                                ))}
                            </div>
                        </div>
                    )}

                    {/* Rows */}
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.625rem' }}>
                        <span style={{ fontSize: '0.65rem', fontWeight: 700, color: '#475569', letterSpacing: '0.08em', textTransform: 'uppercase' }}>
                            Offcut Pieces
                        </span>
                        <button type="button" onClick={addRow} style={{
                            background: 'none', border: 'none', color: '#22d3ee', fontSize: '0.75rem', fontWeight: 700, cursor: 'pointer',
                        }}>+ Add piece</button>
                    </div>

                    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.625rem' }}>
                        {rows.map((row, idx) => {
                            const invalid = !isRowValid(row);
                            return (
                                <div key={idx} style={{
                                    display: 'flex', alignItems: 'center', gap: '0.625rem',
                                    padding: '0.75rem 1rem', borderRadius: '0.875rem',
                                    background: 'rgba(255,255,255,0.03)', border: `1px solid ${invalid && (row.width || row.height || row.length) ? 'rgba(239,68,68,0.3)' : 'rgba(255,255,255,0.07)'}`,
                                }}>
                                    {hasDimensions ? (
                                        <>
                                            <input type="number" step="1" min="0" placeholder="width mm" value={row.width}
                                                onChange={e => updateRow(idx, 'width', e.target.value)}
                                                style={{ ...rowInput, width: '90px' }} />
                                            <span style={{ color: '#475569' }}>×</span>
                                            <input type="number" step="1" min="0" placeholder="height mm" value={row.height}
                                                onChange={e => updateRow(idx, 'height', e.target.value)}
                                                style={{ ...rowInput, width: '90px' }} />
                                        </>
                                    ) : (
                                        <div style={{ position: 'relative', flex: 1 }}>
                                            <input type="number" step="0.01" min="0" placeholder={`length (${unit})`} value={row.length}
                                                onChange={e => updateRow(idx, 'length', e.target.value)}
                                                style={{ ...rowInput, width: '100%', boxSizing: 'border-box' }} />
                                        </div>
                                    )}
                                    <span style={{ color: '#475569', fontSize: '0.72rem' }}>qty</span>
                                    <input type="number" step="1" min="1" placeholder="1" value={row.quantity}
                                        onChange={e => updateRow(idx, 'quantity', e.target.value)}
                                        style={{ ...rowInput, width: '56px', flexShrink: 0 }} />
                                    <button type="button" onClick={() => removeRow(idx)} disabled={rows.length === 1} style={{
                                        background: 'none', border: 'none', color: rows.length === 1 ? '#334155' : '#64748b',
                                        cursor: rows.length === 1 ? 'not-allowed' : 'pointer', fontSize: '0.9rem', flexShrink: 0, marginLeft: 'auto',
                                    }}>✕</button>
                                </div>
                            );
                        })}
                    </div>

                    {error && (
                        <div style={{ marginTop: '1rem', padding: '0.625rem 0.875rem', borderRadius: '0.75rem', background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.25)', color: '#f87171', fontSize: '0.78rem' }}>
                            {error}
                        </div>
                    )}
                </div>

                {/* Footer */}
                <div style={{ padding: '1.125rem 2rem', borderTop: '1px solid rgba(255,255,255,0.07)', display: 'flex', gap: '0.75rem', flexShrink: 0 }}>
                    <button onClick={onClose} style={{
                        flex: 1, padding: '0.875rem', borderRadius: '0.875rem', border: '1px solid rgba(255,255,255,0.08)',
                        background: 'transparent', color: '#64748b', fontWeight: 700, cursor: 'pointer', fontSize: '0.875rem',
                    }}>Cancel</button>
                    <button onClick={handleSubmit} disabled={!canSubmit} style={{
                        flex: 1, padding: '0.875rem', borderRadius: '0.875rem', border: 'none', cursor: canSubmit ? 'pointer' : 'not-allowed',
                        background: canSubmit ? 'linear-gradient(135deg, #06b6d4, #3b82f6)' : 'rgba(255,255,255,0.06)',
                        color: canSubmit ? '#fff' : '#334155', fontWeight: 800, fontSize: '0.875rem',
                        boxShadow: canSubmit ? '0 4px 16px rgba(6,182,212,0.3)' : 'none', transition: 'all 0.2s',
                    }}>{submitting ? 'Adding…' : `Add ${validRows.length || ''} Offcut${validRows.length === 1 ? '' : 's'}`}</button>
                </div>
            </div>
        </div>
    );
}
