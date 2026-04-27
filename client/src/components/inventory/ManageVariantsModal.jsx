import { useState } from 'react';
import { useProducts } from '../../context/ProductContext';
import ConfirmationModal from '../common/ConfirmationModal';

export default function ManageVariantsModal({ isOpen, onClose, product }) {
    const { updateProduct, updateProductVariant } = useProducts();
    const [confirmDelete, setConfirmDelete] = useState({ open: false, variant: null });
    const [editingVariantId, setEditingVariantId] = useState(null);
    const [editForm, setEditForm] = useState({ price: '', priceHalf: '', priceUnit: '', stockChange: 0 });

    if (!isOpen || !product) return null;

    const variants = product.variants || [];
    const getVariantId = v => v.name || Object.values(v.attributes).join(' - ');

    const handleEditClick = v => {
        setEditingVariantId(getVariantId(v));
        setEditForm({ price: v.price || v.priceFull || 0, priceHalf: v.priceHalf || 0, priceUnit: v.priceUnit || 0, length: v.length || '', stockChange: 0 });
    };

    const handleSaveEdit = async originalVariant => {
        try {
            const payload = {
                price: parseFloat(editForm.price), price_half: parseFloat(editForm.priceHalf),
                price_unit: parseFloat(editForm.priceUnit), stock_change: parseInt(editForm.stockChange) || 0,
            };
            if (editForm.length !== '') payload.length = parseFloat(editForm.length);
            await updateProductVariant(originalVariant.id, payload);
            setEditingVariantId(null);
        } catch { alert("Update failed"); }
    };

    const confirmDeletion = () => {
        const vToDel = confirmDelete.variant;
        if (!vToDel) return;
        updateProduct({ ...product, variants: variants.filter(v => getVariantId(v) !== getVariantId(vToDel)) });
        setConfirmDelete({ open: false, variant: null });
    };

    const inputStyle = { background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: '6px', padding: '0.375rem 0.625rem', color: '#f1f5f9', fontSize: '0.78rem', outline: 'none', width: '70px', fontFamily: 'var(--font-mono)', transition: 'border-color 0.2s' };

    return (
        <>
            <div style={{
                position: 'fixed', inset: 0, zIndex: 40,
                display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '1rem',
                background: 'rgba(9,14,26,0.85)', backdropFilter: 'blur(12px)',
            }} onClick={onClose}>
                <div onClick={e => e.stopPropagation()} style={{
                    width: '100%', maxWidth: '800px',
                    background: 'linear-gradient(145deg, rgba(13,20,38,0.99), rgba(9,14,26,0.99))',
                    border: '1px solid rgba(255,255,255,0.1)', borderRadius: '1.5rem', overflow: 'hidden',
                    boxShadow: '0 32px 80px rgba(0,0,0,0.7)', display: 'flex', flexDirection: 'column', maxHeight: '85vh',
                    animation: 'fadeInScale 0.2s ease',
                }}>
                    {/* Header */}
                    <div style={{ padding: '1.5rem 2rem', borderBottom: '1px solid rgba(255,255,255,0.07)', display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexShrink: 0 }}>
                        <div>
                            <h3 style={{ fontSize: '1.125rem', fontWeight: 800, color: '#f1f5f9', margin: '0 0 4px' }}>Manage Variants</h3>
                            <p style={{ fontSize: '0.78rem', color: '#64748b', margin: 0 }}>{product.name} — {variants.length} variants</p>
                        </div>
                        <button onClick={onClose} style={{
                            width: '32px', height: '32px', borderRadius: '8px', border: '1px solid rgba(255,255,255,0.1)',
                            background: 'rgba(255,255,255,0.05)', color: '#64748b', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center',
                        }}>✕</button>
                    </div>

                    {/* Variants list */}
                    <div style={{ flex: 1, overflowY: 'auto', padding: '1.25rem 2rem' }} className="custom-scrollbar">
                        {variants.length === 0 ? (
                            <div style={{ textAlign: 'center', padding: '3rem', border: '1px dashed rgba(255,255,255,0.08)', borderRadius: '1rem', color: '#334155' }}>
                                <div style={{ fontSize: '2.5rem', marginBottom: '0.75rem', opacity: 0.3 }}>📦</div>
                                <p style={{ fontWeight: 500 }}>No variants for this product</p>
                            </div>
                        ) : (
                            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                                {variants.map((variant, idx) => {
                                    const name = getVariantId(variant);
                                    const isEditing = editingVariantId === name;
                                    return (
                                        <div key={idx} style={{
                                            display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                                            padding: '0.875rem 1.25rem', borderRadius: '0.875rem',
                                            background: isEditing ? 'rgba(59,130,246,0.08)' : 'rgba(255,255,255,0.04)',
                                            border: `1px solid ${isEditing ? 'rgba(59,130,246,0.3)' : 'rgba(255,255,255,0.07)'}`,
                                            transition: 'all 0.2s', gap: '1rem', flexWrap: 'wrap',
                                        }}>
                                            {/* Info */}
                                            <div style={{ display: 'flex', alignItems: 'center', gap: '0.875rem', flex: 1, minWidth: 0 }}>
                                                <div style={{ width: '32px', height: '32px', borderRadius: '8px', background: 'rgba(255,255,255,0.07)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '0.78rem', fontWeight: 700, color: '#64748b', flexShrink: 0 }}>{idx + 1}</div>
                                                <div style={{ flex: 1, minWidth: 0 }}>
                                                    <h4 style={{ fontSize: '0.875rem', fontWeight: 700, color: '#e2e8f0', margin: '0 0 4px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{name}</h4>
                                                    {isEditing ? (
                                                        <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap', marginTop: '0.375rem' }}>
                                                            {[{ label: 'Full', key: 'price' }, ...(product.trackOffcuts ? [{ label: 'Half', key: 'priceHalf' }, { label: 'Unit(ft)', key: 'priceUnit' }, { label: 'Bar Len(ft)', key: 'length' }] : [])].map(f => (
                                                                <div key={f.key}>
                                                                    <div style={{ fontSize: '0.58rem', fontWeight: 700, color: '#475569', letterSpacing: '0.06em', textTransform: 'uppercase', marginBottom: '2px' }}>{f.label}</div>
                                                                    <input type="number" style={inputStyle} value={editForm[f.key]} onChange={e => setEditForm(p => ({ ...p, [f.key]: e.target.value }))}
                                                                        onFocus={e => { e.target.style.borderColor = 'rgba(59,130,246,0.5)'; }} onBlur={e => { e.target.style.borderColor = 'rgba(255,255,255,0.1)'; }} />
                                                                </div>
                                                            ))}
                                                        </div>
                                                    ) : (
                                                        <div style={{ display: 'flex', gap: '0.5rem' }}>
                                                            <span style={{ fontSize: '0.68rem', fontFamily: 'var(--font-mono)', background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.09)', borderRadius: '4px', padding: '1px 7px', color: '#94a3b8' }}>
                                                                KSH{variant.price || variant.priceFull || '—'}
                                                            </span>
                                                            <span style={{ fontSize: '0.68rem', fontFamily: 'var(--font-mono)', background: 'rgba(34,197,94,0.08)', border: '1px solid rgba(34,197,94,0.15)', borderRadius: '4px', padding: '1px 7px', color: '#4ade80' }}>
                                                                Stock: {variant.stock || 0}
                                                            </span>
                                                        </div>
                                                    )}
                                                </div>
                                            </div>

                                            {/* Actions */}
                                            <div style={{ display: 'flex', gap: '0.375rem', flexShrink: 0 }}>
                                                {isEditing ? (
                                                    <>
                                                        <button onClick={() => handleSaveEdit(variant)} style={{ padding: '0.375rem 0.875rem', borderRadius: '8px', border: 'none', cursor: 'pointer', background: 'rgba(34,197,94,0.15)', color: '#4ade80', fontWeight: 700, fontSize: '0.72rem', transition: 'all 0.15s' }}>Confirm</button>
                                                        <button onClick={() => setEditingVariantId(null)} style={{ padding: '0.375rem 0.875rem', borderRadius: '8px', border: 'none', cursor: 'pointer', background: 'rgba(255,255,255,0.07)', color: '#64748b', fontWeight: 700, fontSize: '0.72rem', transition: 'all 0.15s' }}>Cancel</button>
                                                    </>
                                                ) : (
                                                    <>
                                                        <button onClick={() => handleEditClick(variant)} style={{ width: '30px', height: '30px', borderRadius: '8px', border: 'none', cursor: 'pointer', background: 'transparent', color: '#475569', display: 'flex', alignItems: 'center', justifyContent: 'center', transition: 'all 0.15s' }}
                                                        onMouseEnter={e => { e.currentTarget.style.background = 'rgba(59,130,246,0.12)'; e.currentTarget.style.color = '#60a5fa'; }}
                                                        onMouseLeave={e => { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.color = '#475569'; }}>
                                                            <svg width="14" height="14" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" /></svg>
                                                        </button>
                                                        <button onClick={() => setConfirmDelete({ open: true, variant })} style={{ width: '30px', height: '30px', borderRadius: '8px', border: 'none', cursor: 'pointer', background: 'transparent', color: '#475569', display: 'flex', alignItems: 'center', justifyContent: 'center', transition: 'all 0.15s' }}
                                                        onMouseEnter={e => { e.currentTarget.style.background = 'rgba(239,68,68,0.12)'; e.currentTarget.style.color = '#f87171'; }}
                                                        onMouseLeave={e => { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.color = '#475569'; }}>
                                                            <svg width="14" height="14" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" /></svg>
                                                        </button>
                                                    </>
                                                )}
                                            </div>
                                        </div>
                                    );
                                })}
                            </div>
                        )}
                    </div>

                    <div style={{ padding: '1rem 2rem', borderTop: '1px solid rgba(255,255,255,0.07)', display: 'flex', justifyContent: 'flex-end', flexShrink: 0 }}>
                        <button onClick={onClose} style={{
                            padding: '0.75rem 2rem', borderRadius: '0.875rem', border: 'none', cursor: 'pointer',
                            background: 'linear-gradient(135deg, #3b82f6, #06b6d4)', color: '#fff', fontWeight: 700, fontSize: '0.875rem',
                            boxShadow: '0 4px 16px rgba(59,130,246,0.3)', transition: 'all 0.2s',
                        }}>Done</button>
                    </div>
                </div>
            </div>

            <ConfirmationModal isOpen={confirmDelete.open} onClose={() => setConfirmDelete({ open: false, variant: null })} onConfirm={confirmDeletion}
                title="Delete Variant" message={`Delete "${confirmDelete.variant?.name || 'this variant'}"? This cannot be undone.`} confirmText="Delete Variant" confirmStyle="danger" />
        </>
    );
}
