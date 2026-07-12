import { useState } from 'react';
import { useProducts } from '../../context/ProductContext';
import ConfirmationModal from '../common/ConfirmationModal';

export default function ManageVariantsModal({ isOpen, onClose, product }) {
    const { updateProduct, updateProductVariant } = useProducts();
    const [confirmDelete, setConfirmDelete] = useState({ open: false, variant: null });
    const [editingVariantId, setEditingVariantId] = useState(null);
    const [editForm, setEditForm] = useState({ price: '', priceHalf: '', priceUnit: '', stockChange: 0 });
    const [saving, setSaving] = useState(false);

    if (!isOpen || !product) return null;

    const variants = product.variants || [];
    const unit = product.unit || 'ft';
    // Dimensioned products (e.g. glass sheets) are always cut & priced by square footage,
    // regardless of what unit their dimensions are recorded in — see GlassCalculator.
    const unitPriceLabel = product.hasDimensions ? 'ft²' : unit;
    const getVariantId = v => v.name || Object.values(v.attributes).join(' - ');

    const priceFields = [
        { label: 'Full Price', key: 'price' },
        ...(product.trackOffcuts ? [{ label: 'Half Price', key: 'priceHalf' }, { label: `Price / ${unitPriceLabel}`, key: 'priceUnit' }] : []),
    ];

    const handleEditClick = v => {
        setEditingVariantId(getVariantId(v));
        setEditForm({ price: v.price || v.priceFull || 0, priceHalf: v.priceHalf || 0, priceUnit: v.priceUnit || 0, stockChange: 0 });
    };

    const handleSaveEdit = async originalVariant => {
        setSaving(true);
        try {
            const payload = {
                price: parseFloat(editForm.price) || 0,
                price_half: parseFloat(editForm.priceHalf) || 0,
                price_unit: parseFloat(editForm.priceUnit) || 0,
                stock_change: parseInt(editForm.stockChange) || 0,
            };
            await updateProductVariant(originalVariant.id, payload);
            setEditingVariantId(null);
        } catch { alert('Update failed'); }
        finally { setSaving(false); }
    };

    const confirmDeletion = () => {
        const vToDel = confirmDelete.variant;
        if (!vToDel) return;
        updateProduct({ ...product, variants: variants.filter(v => getVariantId(v) !== getVariantId(vToDel)) });
        setConfirmDelete({ open: false, variant: null });
    };

    const inputStyle = {
        background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.12)', borderRadius: '8px',
        padding: '0.5rem 0.7rem', color: '#f8fafc', fontSize: '0.82rem', outline: 'none', width: '92px',
        fontFamily: 'var(--font-mono)', fontWeight: 600, transition: 'border-color 0.15s, background 0.15s',
    };

    return (
        <>
            <div style={{
                position: 'fixed', inset: 0, zIndex: 40,
                display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '1rem',
                background: 'rgba(9,14,26,0.85)', backdropFilter: 'blur(12px)',
            }} onClick={onClose}>
                <div onClick={e => e.stopPropagation()} style={{
                    width: '100%', maxWidth: '760px',
                    background: 'linear-gradient(160deg, rgba(15,22,42,0.99), rgba(9,14,26,0.99))',
                    border: '1px solid rgba(255,255,255,0.09)', borderRadius: '1.5rem', overflow: 'hidden',
                    boxShadow: '0 40px 100px rgba(0,0,0,0.65), 0 0 0 1px rgba(255,255,255,0.02) inset',
                    display: 'flex', flexDirection: 'column', maxHeight: '85vh',
                    animation: 'fadeInScale 0.2s ease',
                }}>
                    {/* Header */}
                    <div style={{
                        padding: '1.5rem 2rem', borderBottom: '1px solid rgba(255,255,255,0.06)',
                        display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexShrink: 0,
                        background: 'linear-gradient(180deg, rgba(255,255,255,0.02), transparent)',
                    }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '0.875rem' }}>
                            <div style={{
                                width: '38px', height: '38px', borderRadius: '10px',
                                background: 'linear-gradient(135deg, rgba(59,130,246,0.18), rgba(6,182,212,0.12))',
                                border: '1px solid rgba(59,130,246,0.25)', display: 'flex', alignItems: 'center', justifyContent: 'center',
                            }}>
                                <svg width="17" height="17" fill="none" stroke="#60a5fa" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 4v10M4 7v10l8 4" /></svg>
                            </div>
                            <div>
                                <h3 style={{ fontSize: '1.05rem', fontWeight: 800, color: '#f8fafc', margin: '0 0 2px', letterSpacing: '-0.01em' }}>Manage Variants</h3>
                                <p style={{ fontSize: '0.76rem', color: '#64748b', margin: 0 }}>{product.name} &nbsp;·&nbsp; {variants.length} variant{variants.length !== 1 ? 's' : ''}</p>
                            </div>
                        </div>
                        <button onClick={onClose} style={{
                            width: '34px', height: '34px', borderRadius: '9px', border: '1px solid rgba(255,255,255,0.1)',
                            background: 'rgba(255,255,255,0.04)', color: '#64748b', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center',
                            transition: 'all 0.15s',
                        }}
                        onMouseEnter={e => { e.currentTarget.style.background = 'rgba(255,255,255,0.08)'; e.currentTarget.style.color = '#cbd5e1'; }}
                        onMouseLeave={e => { e.currentTarget.style.background = 'rgba(255,255,255,0.04)'; e.currentTarget.style.color = '#64748b'; }}
                        >✕</button>
                    </div>

                    {/* Variants list */}
                    <div style={{ flex: 1, overflowY: 'auto', padding: '1.5rem 2rem' }} className="custom-scrollbar">
                        {variants.length === 0 ? (
                            <div style={{ textAlign: 'center', padding: '3.5rem 1rem', border: '1px dashed rgba(255,255,255,0.08)', borderRadius: '1.25rem', color: '#334155' }}>
                                <div style={{ fontSize: '2.25rem', marginBottom: '0.75rem', opacity: 0.35 }}>📦</div>
                                <p style={{ fontWeight: 600, color: '#475569' }}>No variants for this product</p>
                            </div>
                        ) : (
                            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.625rem' }}>
                                {variants.map((variant, idx) => {
                                    const name = getVariantId(variant);
                                    const isEditing = editingVariantId === name;
                                    return (
                                        <div key={idx} style={{
                                            borderRadius: '1rem', overflow: 'hidden',
                                            background: isEditing ? 'linear-gradient(145deg, rgba(59,130,246,0.09), rgba(6,182,212,0.05))' : 'rgba(255,255,255,0.03)',
                                            border: `1px solid ${isEditing ? 'rgba(59,130,246,0.35)' : 'rgba(255,255,255,0.06)'}`,
                                            transition: 'all 0.2s',
                                            boxShadow: isEditing ? '0 8px 24px rgba(59,130,246,0.12)' : 'none',
                                        }}>
                                            <div style={{
                                                display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                                                padding: '1rem 1.25rem', gap: '1rem', flexWrap: 'wrap',
                                            }}>
                                                {/* Info */}
                                                <div style={{ display: 'flex', alignItems: 'center', gap: '0.875rem', flex: 1, minWidth: 0 }}>
                                                    <div style={{
                                                        width: '30px', height: '30px', borderRadius: '8px', flexShrink: 0,
                                                        background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.07)',
                                                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                                                        fontSize: '0.72rem', fontWeight: 700, color: '#64748b', fontFamily: 'var(--font-mono)',
                                                    }}>{String(idx + 1).padStart(2, '0')}</div>
                                                    <div style={{ flex: 1, minWidth: 0 }}>
                                                        <h4 style={{ fontSize: '0.88rem', fontWeight: 700, color: '#e2e8f0', margin: '0 0 5px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{name}</h4>
                                                        {!isEditing && (
                                                            <div style={{ display: 'flex', gap: '0.4rem', flexWrap: 'wrap' }}>
                                                                <span style={{ fontSize: '0.68rem', fontFamily: 'var(--font-mono)', fontWeight: 600, background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: '5px', padding: '2px 8px', color: '#94a3b8' }}>
                                                                    KSH {variant.price || variant.priceFull || '—'}
                                                                </span>
                                                                {product.trackOffcuts && variant.priceHalf > 0 && (
                                                                    <span style={{ fontSize: '0.68rem', fontFamily: 'var(--font-mono)', fontWeight: 600, background: 'rgba(168,85,247,0.08)', border: '1px solid rgba(168,85,247,0.18)', borderRadius: '5px', padding: '2px 8px', color: '#c084fc' }}>
                                                                        Half: {variant.priceHalf}
                                                                    </span>
                                                                )}
                                                                {product.trackOffcuts && variant.priceUnit > 0 && (
                                                                    <span style={{ fontSize: '0.68rem', fontFamily: 'var(--font-mono)', fontWeight: 600, background: 'rgba(234,179,8,0.08)', border: '1px solid rgba(234,179,8,0.18)', borderRadius: '5px', padding: '2px 8px', color: '#facc15' }}>
                                                                        /{unitPriceLabel}: {variant.priceUnit}
                                                                    </span>
                                                                )}
                                                                <span style={{ fontSize: '0.68rem', fontFamily: 'var(--font-mono)', fontWeight: 600, background: 'rgba(34,197,94,0.08)', border: '1px solid rgba(34,197,94,0.16)', borderRadius: '5px', padding: '2px 8px', color: '#4ade80' }}>
                                                                    Stock: {variant.stock || 0}
                                                                </span>
                                                                {variant.width != null && (
                                                                    <span style={{ fontSize: '0.68rem', fontFamily: 'var(--font-mono)', fontWeight: 600, background: 'rgba(6,182,212,0.08)', border: '1px solid rgba(6,182,212,0.18)', borderRadius: '5px', padding: '2px 8px', color: '#22d3ee' }}>
                                                                        {variant.length ?? '?'}{unit} × {variant.width}{unit}
                                                                    </span>
                                                                )}
                                                            </div>
                                                        )}
                                                    </div>
                                                </div>

                                                {/* Actions */}
                                                {!isEditing && (
                                                    <div style={{ display: 'flex', gap: '0.375rem', flexShrink: 0 }}>
                                                        <button onClick={() => handleEditClick(variant)} title="Edit pricing" style={{ width: '32px', height: '32px', borderRadius: '8px', border: '1px solid transparent', cursor: 'pointer', background: 'transparent', color: '#64748b', display: 'flex', alignItems: 'center', justifyContent: 'center', transition: 'all 0.15s' }}
                                                        onMouseEnter={e => { e.currentTarget.style.background = 'rgba(59,130,246,0.12)'; e.currentTarget.style.color = '#60a5fa'; e.currentTarget.style.borderColor = 'rgba(59,130,246,0.2)'; }}
                                                        onMouseLeave={e => { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.color = '#64748b'; e.currentTarget.style.borderColor = 'transparent'; }}>
                                                                <svg width="14" height="14" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" /></svg>
                                                            </button>
                                                            <button onClick={() => setConfirmDelete({ open: true, variant })} title="Delete variant" style={{ width: '32px', height: '32px', borderRadius: '8px', border: '1px solid transparent', cursor: 'pointer', background: 'transparent', color: '#64748b', display: 'flex', alignItems: 'center', justifyContent: 'center', transition: 'all 0.15s' }}
                                                        onMouseEnter={e => { e.currentTarget.style.background = 'rgba(239,68,68,0.12)'; e.currentTarget.style.color = '#f87171'; e.currentTarget.style.borderColor = 'rgba(239,68,68,0.2)'; }}
                                                        onMouseLeave={e => { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.color = '#64748b'; e.currentTarget.style.borderColor = 'transparent'; }}>
                                                                <svg width="14" height="14" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" /></svg>
                                                            </button>
                                                    </div>
                                                )}
                                            </div>

                                            {/* Inline price editor */}
                                            {isEditing && (
                                                <div style={{
                                                    padding: '0 1.25rem 1.125rem', display: 'flex', alignItems: 'flex-end', gap: '0.875rem', flexWrap: 'wrap',
                                                    borderTop: '1px solid rgba(255,255,255,0.05)', marginTop: '-0.25rem', paddingTop: '1rem',
                                                }}>
                                                    {priceFields.map(f => (
                                                        <div key={f.key}>
                                                            <div style={{ fontSize: '0.6rem', fontWeight: 700, color: '#60a5fa', letterSpacing: '0.07em', textTransform: 'uppercase', marginBottom: '0.375rem' }}>{f.label}</div>
                                                            <div style={{ position: 'relative' }}>
                                                                <span style={{ position: 'absolute', left: '9px', top: '50%', transform: 'translateY(-50%)', fontSize: '0.68rem', color: '#475569', fontFamily: 'var(--font-mono)', pointerEvents: 'none' }}>KSH</span>
                                                                <input type="number" style={{ ...inputStyle, paddingLeft: '34px' }} value={editForm[f.key]}
                                                                    onChange={e => setEditForm(p => ({ ...p, [f.key]: e.target.value }))}
                                                                    onFocus={e => { e.target.style.borderColor = 'rgba(59,130,246,0.55)'; e.target.style.background = 'rgba(59,130,246,0.06)'; }}
                                                                    onBlur={e => { e.target.style.borderColor = 'rgba(255,255,255,0.12)'; e.target.style.background = 'rgba(255,255,255,0.05)'; }} />
                                                            </div>
                                                        </div>
                                                    ))}

                                                    <div style={{ width: '1px', alignSelf: 'stretch', background: 'rgba(255,255,255,0.08)', margin: '0 0.125rem' }} />

                                                    <div>
                                                        <div style={{ fontSize: '0.6rem', fontWeight: 700, color: '#4ade80', letterSpacing: '0.07em', textTransform: 'uppercase', marginBottom: '0.375rem' }}>Adjust Stock</div>
                                                        <div style={{ display: 'flex', alignItems: 'center', gap: '0.375rem' }}>
                                                            <button type="button" disabled={saving} onClick={() => setEditForm(p => ({ ...p, stockChange: (parseInt(p.stockChange) || 0) - 1 }))} style={{ width: '26px', height: '34px', borderRadius: '7px', border: '1px solid rgba(255,255,255,0.1)', background: 'rgba(255,255,255,0.05)', color: '#94a3b8', cursor: 'pointer', fontWeight: 700 }}>−</button>
                                                            <input type="number" style={{ ...inputStyle, width: '76px', textAlign: 'center' }} value={editForm.stockChange}
                                                                onChange={e => setEditForm(p => ({ ...p, stockChange: e.target.value }))}
                                                                onFocus={e => { e.target.style.borderColor = 'rgba(34,197,94,0.55)'; e.target.style.background = 'rgba(34,197,94,0.06)'; }}
                                                                onBlur={e => { e.target.style.borderColor = 'rgba(255,255,255,0.12)'; e.target.style.background = 'rgba(255,255,255,0.05)'; }} />
                                                            <button type="button" disabled={saving} onClick={() => setEditForm(p => ({ ...p, stockChange: (parseInt(p.stockChange) || 0) + 1 }))} style={{ width: '26px', height: '34px', borderRadius: '7px', border: '1px solid rgba(255,255,255,0.1)', background: 'rgba(255,255,255,0.05)', color: '#94a3b8', cursor: 'pointer', fontWeight: 700 }}>+</button>
                                                        </div>
                                                        <div style={{ fontSize: '0.6rem', color: '#475569', marginTop: '0.3rem' }}>Current: {variant.stock || 0}</div>
                                                    </div>

                                                    <div style={{ display: 'flex', gap: '0.5rem', marginLeft: 'auto' }}>
                                                        <button disabled={saving} onClick={() => setEditingVariantId(null)} style={{ padding: '0.5rem 1rem', borderRadius: '8px', border: '1px solid rgba(255,255,255,0.08)', cursor: 'pointer', background: 'rgba(255,255,255,0.04)', color: '#94a3b8', fontWeight: 600, fontSize: '0.78rem', transition: 'all 0.15s' }}>Cancel</button>
                                                        <button disabled={saving} onClick={() => handleSaveEdit(variant)} style={{ padding: '0.5rem 1.125rem', borderRadius: '8px', border: 'none', cursor: saving ? 'default' : 'pointer', background: 'linear-gradient(135deg, #3b82f6, #06b6d4)', color: '#fff', fontWeight: 700, fontSize: '0.78rem', opacity: saving ? 0.7 : 1, boxShadow: '0 4px 14px rgba(59,130,246,0.3)', transition: 'all 0.15s' }}>
                                                            {saving ? 'Saving…' : 'Save Changes'}
                                                        </button>
                                                    </div>
                                                </div>
                                            )}
                                        </div>
                                    );
                                })}
                            </div>
                        )}
                    </div>

                    <div style={{ padding: '1.125rem 2rem', borderTop: '1px solid rgba(255,255,255,0.06)', display: 'flex', justifyContent: 'flex-end', flexShrink: 0 }}>
                        <button onClick={onClose} style={{
                            padding: '0.7rem 2rem', borderRadius: '0.875rem', border: 'none', cursor: 'pointer',
                            background: 'linear-gradient(135deg, #3b82f6, #06b6d4)', color: '#fff', fontWeight: 700, fontSize: '0.85rem',
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
