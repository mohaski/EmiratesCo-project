import { useState, useEffect } from 'react';
import { useProducts } from '../../context/ProductContext';
import { useAttributes } from '../../context/AttributeContext';
import { isProfileCategory } from '../../utils/colors';
import ConfirmationModal from '../common/ConfirmationModal';

export default function ManageVariantsModal({ isOpen, onClose, product }) {
    const { updateProduct, updateProductVariant, deleteProductVariant } = useProducts();
    const { attributeClasses, createAttributeClass, addAttributeValue } = useAttributes();
    const [confirmDelete, setConfirmDelete] = useState({ open: false, variant: null });
    const [editingVariantId, setEditingVariantId] = useState(null);
    const [editForm, setEditForm] = useState({ price: '', priceHalf: '', priceUnit: '', stockChange: 0, lowStockThreshold: 0, minUsable: 150, allowRotation: true, popularSizeRanges: [] });
    const [popularRangeDraft, setPopularRangeDraft] = useState({ min_w: '', max_w: '', min_h: '', max_h: '' });
    const [saving, setSaving] = useState(false);
    const [savingDefault, setSavingDefault] = useState(null); // attribute key currently being saved, or null

    // --- Add Attribute panel: lets the CEO introduce a new attribute class onto an
    // already-existing product, then say where each current variant sits on it —
    // new variants (created afterward via Add Variant) automatically offer it too,
    // since it's appended to the product's applicableAttributes.
    const [attrPanelOpen, setAttrPanelOpen] = useState(false);
    const [attrClassChoice, setAttrClassChoice] = useState(''); // attributeClass id, or '__new__'
    const [newClassName, setNewClassName] = useState('');
    const [newClassType, setNewClassType] = useState('list');
    const [newValueDraft, setNewValueDraft] = useState('');
    const [variantAttrValues, setVariantAttrValues] = useState({}); // { [variantKey]: value }
    const [savingAttr, setSavingAttr] = useState(false);

    // Once a brand-new class is actually created (see handleCreateNewClass below), switch
    // attrClassChoice over to its real id as soon as it shows up in attributeClasses — this
    // folds "just-created" back into the normal "existing class" flow below, so its shared
    // value list (for list-type classes) can immediately be edited via Add Value, the same
    // input already used for a pre-existing class.
    useEffect(() => {
        if (attrClassChoice !== '__new__') return;
        const trimmed = newClassName.trim();
        if (!trimmed) return;
        const match = attributeClasses.find(c => c.name === trimmed);
        if (match) setAttrClassChoice(String(match.id));
    }, [attributeClasses, attrClassChoice, newClassName]);

    if (!isOpen || !product) return null;

    const variants = product.variants || [];
    const unit = product.unit || 'ft';
    // Dimensioned products (e.g. glass sheets) are always cut & priced by square footage,
    // regardless of what unit their dimensions are recorded in — see GlassCalculator.
    const unitPriceLabel = product.hasDimensions ? 'ft²' : unit;
    const getVariantId = v => v.name || Object.values(v.attributes).join(' - ');
    // Only attributes with more than one actual value are worth a default picker —
    // a single-value attribute has nothing to choose between. "Color" is excluded for
    // profile products because ProfileCalculator sources its color from the sales
    // page's own color swatch selector, not a per-product default (see there).
    const defaultableAttributeKeys = Object.keys(product.attributes || {}).filter(k => {
        if ((product.attributes[k] || []).length <= 1) return false;
        if (k === 'Color' && isProfileCategory(product.category)) return false;
        return true;
    });

    const priceFields = [
        { label: 'Full Price', key: 'price' },
        ...(product.trackOffcuts ? [{ label: 'Half Price', key: 'priceHalf' }, { label: `Price / ${unitPriceLabel}`, key: 'priceUnit' }] : []),
    ];

    const handleEditClick = v => {
        setEditingVariantId(getVariantId(v));
        setEditForm({
            price: v.price || v.priceFull || 0, priceHalf: v.priceHalf || 0, priceUnit: v.priceUnit || 0, stockChange: 0,
            lowStockThreshold: v.lowStockThreshold || 0,
            minUsable: v.minUsable ?? 150, allowRotation: v.allowRotation ?? true, popularSizeRanges: v.popularSizeRanges || [],
        });
        setPopularRangeDraft({ min_w: '', max_w: '', min_h: '', max_h: '' });
    };

    const addEditPopularRange = () => {
        const { min_w, max_w, min_h, max_h } = popularRangeDraft;
        if (!min_w || !max_w || !min_h || !max_h) return;
        setEditForm(p => ({ ...p, popularSizeRanges: [...p.popularSizeRanges, { min_w: parseFloat(min_w), max_w: parseFloat(max_w), min_h: parseFloat(min_h), max_h: parseFloat(max_h) }] }));
        setPopularRangeDraft({ min_w: '', max_w: '', min_h: '', max_h: '' });
    };
    const removeEditPopularRange = idx => setEditForm(p => ({ ...p, popularSizeRanges: p.popularSizeRanges.filter((_, i) => i !== idx) }));

    // A packaged (count-tracked) variant's stock is tracked in individual pieces
    // server-side (see server/entities/variants.py) — the "Adjust Stock" field
    // below is entered in the variant's own pack unit (e.g. boxes), same as
    // before, so convert to pieces before sending. Bar/sheet (trackOffcuts) and
    // unpackaged variants are already in their own natural unit (factor 1).
    const packFactor = v => (!product.trackOffcuts && v.unitQuantity ? v.unitQuantity : 1);

    const handleSaveEdit = async originalVariant => {
        setSaving(true);
        try {
            const payload = {
                price: parseFloat(editForm.price) || 0,
                price_half: parseFloat(editForm.priceHalf) || 0,
                price_unit: parseFloat(editForm.priceUnit) || 0,
                stock_change: (parseInt(editForm.stockChange) || 0) * packFactor(originalVariant),
                low_stock_threshold: parseFloat(editForm.lowStockThreshold) || 0,
                ...(product.trackOffcuts ? { min_usable: parseFloat(editForm.minUsable) || 0 } : {}),
                ...(product.hasDimensions ? {
                    allow_rotation: editForm.allowRotation,
                    popular_size_ranges: editForm.popularSizeRanges,
                } : {}),
            };
            await updateProductVariant(originalVariant.id, payload);
            setEditingVariantId(null);
        } catch { alert('Update failed'); }
        finally { setSaving(false); }
    };

    // Which value the sales modal should auto-select for a given attribute (e.g.
    // "Color" -> "White") when a customer opens this product — see DynamicCalculator/
    // ProfileCalculator/GlassCalculator/AccessoryCalculator, which all fall back to
    // the first aggregated value when no default (or an unset one) is chosen here.
    const handleSetDefaultAttribute = async (key, value) => {
        setSavingDefault(key);
        try {
            const nextDefaults = { ...(product.defaultAttributes || {}) };
            if (value) nextDefaults[key] = value; else delete nextDefaults[key];
            await updateProduct({ ...product, defaultAttributes: nextDefaults });
        } catch { alert('Failed to set default value'); }
        finally { setSavingDefault(null); }
    };

    const confirmDeletion = async () => {
        const vToDel = confirmDelete.variant;
        if (!vToDel) return;
        setConfirmDelete({ open: false, variant: null });
        try { await deleteProductVariant(vToDel.id); }
        catch { /* error toast already shown by api interceptor */ }
    };

    // --- Add Attribute panel logic ---
    const applicableAttributes = product.applicableAttributes || [];
    const availableClasses = attributeClasses.filter(c => !applicableAttributes.includes(c.name));
    const isNewClass = attrClassChoice === '__new__';
    const selectedClass = !isNewClass && attrClassChoice
        ? attributeClasses.find(c => String(c.id) === String(attrClassChoice))
        : null;
    const effectiveClassName = isNewClass ? newClassName.trim() : (selectedClass?.name || '');
    const effectiveClassType = isNewClass ? newClassType : selectedClass?.type;

    const openAttrPanel = () => {
        setAttrClassChoice('');
        setNewClassName('');
        setNewClassType('list');
        setNewValueDraft('');
        setVariantAttrValues({});
        setAttrPanelOpen(true);
    };
    const closeAttrPanel = () => setAttrPanelOpen(false);

    const handleVariantAttrChange = (variantKey, value) => {
        setVariantAttrValues(prev => ({ ...prev, [variantKey]: value }));
    };

    // Creates the in-progress "new class" for real, so its shared value list (list-type) can be
    // populated before assigning values to variants — see the switch-over effect above.
    const handleCreateNewClass = async () => {
        const trimmed = newClassName.trim();
        if (!trimmed) return;
        if (attributeClasses.some(c => c.name.toLowerCase() === trimmed.toLowerCase())) {
            alert(`"${trimmed}" already exists.`);
            return;
        }
        setSavingAttr(true);
        try {
            await createAttributeClass(trimmed, newClassType === 'custom' ? 'custom' : 'list');
        } catch { alert('Failed to create attribute class.'); }
        finally { setSavingAttr(false); }
    };

    const handleAddValueToClass = async () => {
        if (!selectedClass) return;
        const val = newValueDraft.trim();
        if (!val) return;
        try {
            await addAttributeValue(selectedClass.id, val);
            setNewValueDraft('');
        } catch { alert('Failed to add value'); }
    };

    const handleSaveAttribute = async () => {
        if (!effectiveClassName) { alert('Choose or name an attribute.'); return; }
        if (applicableAttributes.includes(effectiveClassName)) { alert(`"${effectiveClassName}" is already an attribute on this product.`); return; }
        setSavingAttr(true);
        try {
            if (isNewClass) {
                await createAttributeClass(effectiveClassName, newClassType === 'custom' ? 'custom' : 'list');
            }
            // 1. Register the attribute on the product itself, so new variants offer it too.
            await updateProduct({ ...product, applicableAttributes: [...applicableAttributes, effectiveClassName] });
            // 2. Backfill each existing variant with its chosen value (blanks are left unset).
            for (const v of variants) {
                const val = (variantAttrValues[getVariantId(v)] || '').trim();
                if (!val) continue;
                await updateProductVariant(v.id, { attributes: { ...v.attributes, [effectiveClassName]: val } });
            }
            closeAttrPanel();
        } catch { alert('Failed to add attribute.'); }
        finally { setSavingAttr(false); }
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
                    <div className="modal-header-pad" style={{
                        padding: '1.5rem 2rem', borderBottom: '1px solid rgba(255,255,255,0.06)',
                        display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexShrink: 0, flexWrap: 'wrap', gap: '0.75rem',
                        background: 'linear-gradient(180deg, rgba(255,255,255,0.02), transparent)',
                    }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '0.875rem', flex: 1, minWidth: 0 }}>
                            <div style={{
                                width: '38px', height: '38px', borderRadius: '10px', flexShrink: 0,
                                background: 'linear-gradient(135deg, rgba(59,130,246,0.18), rgba(6,182,212,0.12))',
                                border: '1px solid rgba(59,130,246,0.25)', display: 'flex', alignItems: 'center', justifyContent: 'center',
                            }}>
                                <svg width="17" height="17" fill="none" stroke="#60a5fa" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 4v10M4 7v10l8 4" /></svg>
                            </div>
                            <div style={{ minWidth: 0 }}>
                                <h3 style={{ fontSize: '1.05rem', fontWeight: 800, color: '#f8fafc', margin: '0 0 2px', letterSpacing: '-0.01em', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>Manage Variants</h3>
                                <p style={{ fontSize: '0.76rem', color: '#64748b', margin: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{product.name} &nbsp;·&nbsp; {variants.length} variant{variants.length !== 1 ? 's' : ''}</p>
                            </div>
                        </div>
                        {!attrPanelOpen && (
                            <button onClick={openAttrPanel} style={{
                                padding: '0.5rem 1rem', borderRadius: '0.625rem', border: '1px solid rgba(168,85,247,0.3)',
                                background: 'rgba(168,85,247,0.1)', color: '#c084fc', cursor: 'pointer', fontSize: '0.76rem', fontWeight: 700,
                                display: 'flex', alignItems: 'center', gap: '0.375rem', flexShrink: 0,
                            }}>
                                + Add Attribute
                            </button>
                        )}
                        <button onClick={onClose} style={{
                            width: '34px', height: '34px', borderRadius: '9px', border: '1px solid rgba(255,255,255,0.1)',
                            background: 'rgba(255,255,255,0.04)', color: '#64748b', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center',
                            transition: 'all 0.15s',
                        }}
                        onMouseEnter={e => { e.currentTarget.style.background = 'rgba(255,255,255,0.08)'; e.currentTarget.style.color = '#cbd5e1'; }}
                        onMouseLeave={e => { e.currentTarget.style.background = 'rgba(255,255,255,0.04)'; e.currentTarget.style.color = '#64748b'; }}
                        >✕</button>
                    </div>

                    {/* Add Attribute panel */}
                    {attrPanelOpen && (
                        <div style={{ flex: 1, overflowY: 'auto', padding: '1.5rem 2rem' }} className="custom-scrollbar modal-body-pad">
                            <div style={{ padding: '1.25rem', borderRadius: '1rem', background: 'rgba(168,85,247,0.06)', border: '1px solid rgba(168,85,247,0.25)', marginBottom: '1.25rem' }}>
                                <p style={{ fontSize: '0.72rem', fontWeight: 800, color: '#c084fc', margin: '0 0 0.875rem', textTransform: 'uppercase', letterSpacing: '0.06em' }}>New Attribute</p>
                                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.875rem' }}>
                                    <div>
                                        <label style={{ fontSize: '0.62rem', fontWeight: 700, color: '#475569', letterSpacing: '0.08em', textTransform: 'uppercase', display: 'block', marginBottom: '0.375rem' }}>Attribute</label>
                                        <select value={attrClassChoice} onChange={e => { setAttrClassChoice(e.target.value); setVariantAttrValues({}); }} style={{
                                            width: '100%', background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.1)',
                                            borderRadius: '0.75rem', padding: '0.625rem 0.875rem', color: '#f1f5f9', fontSize: '0.85rem', outline: 'none', cursor: 'pointer',
                                        }}>
                                            <option value="" disabled>Select an attribute...</option>
                                            {availableClasses.map(c => <option key={c.id} value={c.id}>{c.name}{c.type === 'custom' ? ' (per-product)' : ''}</option>)}
                                            <option value="__new__">+ Create new attribute...</option>
                                        </select>
                                    </div>

                                    {isNewClass && (
                                        <div style={{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap' }}>
                                            <div style={{ flex: 1, minWidth: '160px' }}>
                                                <label style={{ fontSize: '0.62rem', fontWeight: 700, color: '#475569', letterSpacing: '0.08em', textTransform: 'uppercase', display: 'block', marginBottom: '0.375rem' }}>Name</label>
                                                <input type="text" autoFocus value={newClassName} onChange={e => setNewClassName(e.target.value)}
                                                    placeholder="e.g. Finish, Material..."
                                                    style={{ width: '100%', boxSizing: 'border-box', background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: '0.75rem', padding: '0.625rem 0.875rem', color: '#f1f5f9', fontSize: '0.85rem', outline: 'none' }} />
                                            </div>
                                            <div>
                                                <label style={{ fontSize: '0.62rem', fontWeight: 700, color: '#475569', letterSpacing: '0.08em', textTransform: 'uppercase', display: 'block', marginBottom: '0.375rem' }}>Values Come From</label>
                                                <div style={{ display: 'flex', gap: '0.5rem' }}>
                                                    {[{ val: 'list', label: 'Shared List' }, { val: 'custom', label: 'Per Product' }].map(opt => (
                                                        <button key={opt.val} type="button" onClick={() => setNewClassType(opt.val)} style={{
                                                            padding: '0.625rem 0.875rem', borderRadius: '0.75rem', cursor: 'pointer', fontSize: '0.78rem', fontWeight: 700,
                                                            border: `1px solid ${newClassType === opt.val ? 'rgba(168,85,247,0.5)' : 'rgba(255,255,255,0.1)'}`,
                                                            background: newClassType === opt.val ? 'rgba(168,85,247,0.12)' : 'rgba(255,255,255,0.03)',
                                                            color: newClassType === opt.val ? '#c084fc' : '#94a3b8',
                                                        }}>{opt.label}</button>
                                                    ))}
                                                </div>
                                            </div>
                                            <div>
                                                <label style={{ fontSize: '0.62rem', fontWeight: 700, color: 'transparent', letterSpacing: '0.08em', textTransform: 'uppercase', display: 'block', marginBottom: '0.375rem' }}>&nbsp;</label>
                                                <button type="button" disabled={savingAttr || !newClassName.trim()} onClick={handleCreateNewClass} style={{
                                                    padding: '0.625rem 1.125rem', borderRadius: '0.75rem', border: 'none',
                                                    cursor: (savingAttr || !newClassName.trim()) ? 'default' : 'pointer',
                                                    background: 'linear-gradient(135deg, #a855f7, #c084fc)', color: '#fff', fontWeight: 700, fontSize: '0.78rem',
                                                    opacity: (savingAttr || !newClassName.trim()) ? 0.6 : 1, whiteSpace: 'nowrap',
                                                }}>
                                                    {savingAttr ? 'Creating…' : 'Create Class'}
                                                </button>
                                            </div>
                                        </div>
                                    )}

                                    {selectedClass && selectedClass.type !== 'custom' && (
                                        <div style={{ display: 'flex', gap: '0.5rem' }}>
                                            <input type="text" value={newValueDraft} onChange={e => setNewValueDraft(e.target.value)}
                                                onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); handleAddValueToClass(); } }}
                                                placeholder={`Add a new ${selectedClass.name} value...`}
                                                style={{ flex: 1, background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: '0.75rem', padding: '0.625rem 0.875rem', color: '#f1f5f9', fontSize: '0.82rem', outline: 'none' }} />
                                            <button type="button" onClick={handleAddValueToClass} style={{ padding: '0.5rem 1rem', borderRadius: '0.625rem', border: '1px solid rgba(255,255,255,0.1)', background: 'rgba(255,255,255,0.06)', color: '#94a3b8', cursor: 'pointer', fontSize: '0.76rem', fontWeight: 700 }}>Add Value</button>
                                        </div>
                                    )}
                                </div>
                            </div>

                            {effectiveClassName && !isNewClass && (
                                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                                    <p style={{ fontSize: '0.68rem', fontWeight: 700, color: '#64748b', letterSpacing: '0.06em', textTransform: 'uppercase', margin: '0 0 0.25rem' }}>
                                        Where each variant lies on "{effectiveClassName}"
                                    </p>
                                    {variants.map((variant, idx) => {
                                        const key = getVariantId(variant);
                                        return (
                                            <div key={idx} style={{ display: 'flex', alignItems: 'center', gap: '0.875rem', padding: '0.75rem 1rem', background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.06)', borderRadius: '0.75rem' }}>
                                                <span style={{ flex: 1, fontSize: '0.82rem', fontWeight: 600, color: '#e2e8f0', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{key}</span>
                                                {effectiveClassType === 'custom' ? (
                                                    <input type="text" value={variantAttrValues[key] || ''} onChange={e => handleVariantAttrChange(key, e.target.value)}
                                                        placeholder="Enter value..."
                                                        style={{ width: '180px', background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: '0.625rem', padding: '0.5rem 0.75rem', color: '#f1f5f9', fontSize: '0.8rem', outline: 'none' }} />
                                                ) : (
                                                    <select value={variantAttrValues[key] || ''} onChange={e => handleVariantAttrChange(key, e.target.value)} style={{
                                                        width: '180px', background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: '0.625rem', padding: '0.5rem 0.75rem', color: '#f1f5f9', fontSize: '0.8rem', outline: 'none', cursor: 'pointer',
                                                    }}>
                                                        <option value="">— Not set —</option>
                                                        {(selectedClass?.values || []).map(v => <option key={v.id} value={v.value}>{v.value}</option>)}
                                                    </select>
                                                )}
                                            </div>
                                        );
                                    })}
                                </div>
                            )}

                            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.5rem', marginTop: '1.25rem' }}>
                                <button disabled={savingAttr} onClick={closeAttrPanel} style={{ padding: '0.625rem 1.25rem', borderRadius: '0.75rem', border: '1px solid rgba(255,255,255,0.08)', cursor: 'pointer', background: 'rgba(255,255,255,0.04)', color: '#94a3b8', fontWeight: 600, fontSize: '0.82rem' }}>Cancel</button>
                                <button disabled={savingAttr || !effectiveClassName} onClick={handleSaveAttribute} style={{
                                    padding: '0.625rem 1.5rem', borderRadius: '0.75rem', border: 'none', cursor: (savingAttr || !effectiveClassName) ? 'default' : 'pointer',
                                    background: 'linear-gradient(135deg, #a855f7, #c084fc)', color: '#fff', fontWeight: 700, fontSize: '0.82rem',
                                    opacity: (savingAttr || !effectiveClassName) ? 0.6 : 1, boxShadow: '0 4px 14px rgba(168,85,247,0.3)',
                                }}>
                                    {savingAttr ? 'Saving…' : 'Save Attribute'}
                                </button>
                            </div>
                        </div>
                    )}

                    {/* Variants list */}
                    {!attrPanelOpen && (
                    <div style={{ flex: 1, overflowY: 'auto', padding: '1.5rem 2rem' }} className="custom-scrollbar modal-body-pad">
                        {defaultableAttributeKeys.length > 0 && (
                            <div style={{ padding: '1.125rem 1.25rem', borderRadius: '1rem', background: 'rgba(59,130,246,0.05)', border: '1px solid rgba(59,130,246,0.18)', marginBottom: '1.25rem' }}>
                                <p style={{ fontSize: '0.68rem', fontWeight: 800, color: '#60a5fa', margin: '0 0 0.25rem', textTransform: 'uppercase', letterSpacing: '0.06em' }}>Default Values</p>
                                <p style={{ fontSize: '0.72rem', color: '#64748b', margin: '0 0 0.875rem' }}>Auto-selected when a customer opens this product in Sales.</p>
                                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.625rem' }}>
                                    {defaultableAttributeKeys.map(key => (
                                        <div key={key} style={{ display: 'flex', alignItems: 'center', gap: '0.875rem' }}>
                                            <span style={{ flex: 1, fontSize: '0.82rem', fontWeight: 600, color: '#cbd5e1' }}>{key}</span>
                                            <select
                                                value={product.defaultAttributes?.[key] || ''}
                                                disabled={savingDefault === key}
                                                onChange={e => handleSetDefaultAttribute(key, e.target.value)}
                                                style={{
                                                    width: '200px', background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.1)',
                                                    borderRadius: '0.625rem', padding: '0.5rem 0.75rem', color: '#f1f5f9', fontSize: '0.8rem', outline: 'none', cursor: 'pointer',
                                                    opacity: savingDefault === key ? 0.6 : 1,
                                                }}>
                                                <option value="">— No default (use first) —</option>
                                                {(product.attributes[key] || []).map(v => <option key={v} value={v}>{v}</option>)}
                                            </select>
                                        </div>
                                    ))}
                                </div>
                            </div>
                        )}
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
                                    // Out-of-stock always alerts, even with no CEO-configured threshold (0 = unset);
                                    // a configured threshold (>0) additionally alerts earlier, before hitting zero.
                                    const isLowStock = (variant.stock || 0) <= 0 || (variant.lowStockThreshold > 0 && (variant.stock || 0) < variant.lowStockThreshold);
                                    return (
                                        <div key={idx} style={{
                                            borderRadius: '1rem', overflow: 'hidden',
                                            background: isEditing ? 'linear-gradient(145deg, rgba(59,130,246,0.09), rgba(6,182,212,0.05))' : (isLowStock ? 'rgba(239,68,68,0.06)' : 'rgba(255,255,255,0.03)'),
                                            border: `1px solid ${isEditing ? 'rgba(59,130,246,0.35)' : (isLowStock ? 'rgba(239,68,68,0.3)' : 'rgba(255,255,255,0.06)')}`,
                                            transition: 'all 0.2s',
                                            boxShadow: isEditing ? '0 8px 24px rgba(59,130,246,0.12)' : (isLowStock ? '0 0 16px rgba(239,68,68,0.1)' : 'none'),
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
                                                                <span style={{ fontSize: '0.68rem', fontFamily: 'var(--font-mono)', fontWeight: 600, background: isLowStock ? 'rgba(239,68,68,0.1)' : 'rgba(34,197,94,0.08)', border: `1px solid ${isLowStock ? 'rgba(239,68,68,0.25)' : 'rgba(34,197,94,0.16)'}`, borderRadius: '5px', padding: '2px 8px', color: isLowStock ? '#f87171' : '#4ade80' }}>
                                                                    Stock: {(variant.stock || 0) / packFactor(variant)}
                                                                </span>
                                                                {isLowStock && (
                                                                    <span style={{ fontSize: '0.68rem', fontWeight: 700, background: 'rgba(239,68,68,0.12)', border: '1px solid rgba(239,68,68,0.25)', color: '#f87171', borderRadius: '100px', padding: '2px 8px', animation: 'pulse 1.5s ease-in-out infinite' }}>
                                                                        ⚠ Low Stock
                                                                    </span>
                                                                )}
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
                                                    padding: '0 1.25rem 1.125rem',
                                                    borderTop: '1px solid rgba(255,255,255,0.05)', marginTop: '-0.25rem', paddingTop: '1rem',
                                                }}>
                                                <div style={{ display: 'flex', alignItems: 'flex-end', gap: '0.875rem', flexWrap: 'wrap' }}>
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
                                                        <div style={{ fontSize: '0.6rem', color: '#475569', marginTop: '0.3rem' }}>Current: {(variant.stock || 0) / packFactor(variant)}</div>
                                                    </div>

                                                    <div style={{ width: '1px', alignSelf: 'stretch', background: 'rgba(255,255,255,0.08)', margin: '0 0.125rem' }} />

                                                    <div>
                                                        <div style={{ fontSize: '0.6rem', fontWeight: 700, color: '#f87171', letterSpacing: '0.07em', textTransform: 'uppercase', marginBottom: '0.375rem' }}>Low Stock Alert</div>
                                                        <input type="number" min="0" style={{ ...inputStyle, width: '92px' }} value={editForm.lowStockThreshold}
                                                            onChange={e => setEditForm(p => ({ ...p, lowStockThreshold: e.target.value }))}
                                                            onFocus={e => { e.target.style.borderColor = 'rgba(239,68,68,0.55)'; e.target.style.background = 'rgba(239,68,68,0.06)'; }}
                                                            onBlur={e => { e.target.style.borderColor = 'rgba(255,255,255,0.12)'; e.target.style.background = 'rgba(255,255,255,0.05)'; }} />
                                                        <div style={{ fontSize: '0.6rem', color: '#475569', marginTop: '0.3rem' }}>0 = no alarm</div>
                                                    </div>
                                                </div>

                                                {product.trackOffcuts && (
                                                    <div style={{ marginTop: '0.875rem', paddingTop: '0.875rem', borderTop: '1px solid rgba(255,255,255,0.05)' }}>
                                                        <p style={{ fontSize: '0.6rem', fontWeight: 700, color: '#22d3ee', letterSpacing: '0.06em', textTransform: 'uppercase', margin: '0 0 0.625rem' }}>Offcut Tuning</p>
                                                        <div style={{ display: 'flex', alignItems: 'flex-end', gap: '0.875rem', flexWrap: 'wrap' }}>
                                                            <div>
                                                                <div style={{ fontSize: '0.6rem', fontWeight: 700, color: '#f87171', letterSpacing: '0.07em', textTransform: 'uppercase', marginBottom: '0.375rem' }}>Min Usable Size ({product.hasDimensions ? 'mm' : unit})</div>
                                                                <input type="number" min="0" style={{ ...inputStyle, width: '92px' }} value={editForm.minUsable}
                                                                    onChange={e => setEditForm(p => ({ ...p, minUsable: e.target.value }))}
                                                                    onFocus={e => { e.target.style.borderColor = 'rgba(239,68,68,0.55)'; e.target.style.background = 'rgba(239,68,68,0.06)'; }}
                                                                    onBlur={e => { e.target.style.borderColor = 'rgba(255,255,255,0.12)'; e.target.style.background = 'rgba(255,255,255,0.05)'; }} />
                                                            </div>

                                                            {product.hasDimensions && (
                                                                <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', cursor: 'pointer' }}>
                                                                    <button type="button" onClick={() => setEditForm(p => ({ ...p, allowRotation: !p.allowRotation }))} style={{
                                                                        width: '30px', height: '17px', borderRadius: '100px', border: 'none', cursor: 'pointer', position: 'relative', flexShrink: 0,
                                                                        background: editForm.allowRotation ? 'linear-gradient(135deg, #22c55e, #16a34a)' : 'rgba(255,255,255,0.1)', transition: 'background 0.2s',
                                                                    }}>
                                                                        <span style={{ position: 'absolute', top: '2px', left: editForm.allowRotation ? '15px' : '2px', width: '13px', height: '13px', borderRadius: '50%', background: '#fff', transition: 'left 0.2s', display: 'block' }} />
                                                                    </button>
                                                                    <span style={{ fontSize: '0.68rem', color: editForm.allowRotation ? '#4ade80' : '#64748b', fontWeight: 600 }}>Allow 90° rotation</span>
                                                                </label>
                                                            )}
                                                        </div>

                                                        {product.hasDimensions && (
                                                        <div style={{ marginTop: '0.75rem' }}>
                                                            <div style={{ fontSize: '0.6rem', fontWeight: 700, color: '#94a3b8', letterSpacing: '0.07em', textTransform: 'uppercase', marginBottom: '0.375rem' }}>Popular Size Ranges (mm)</div>
                                                            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.375rem' }}>
                                                                <input type="number" step="1" placeholder="Min W" value={popularRangeDraft.min_w} onChange={e => setPopularRangeDraft(p => ({ ...p, min_w: e.target.value }))} style={{ ...inputStyle, width: '76px' }} />
                                                                <input type="number" step="1" placeholder="Max W" value={popularRangeDraft.max_w} onChange={e => setPopularRangeDraft(p => ({ ...p, max_w: e.target.value }))} style={{ ...inputStyle, width: '76px' }} />
                                                                <input type="number" step="1" placeholder="Min H" value={popularRangeDraft.min_h} onChange={e => setPopularRangeDraft(p => ({ ...p, min_h: e.target.value }))} style={{ ...inputStyle, width: '76px' }} />
                                                                <input type="number" step="1" placeholder="Max H" value={popularRangeDraft.max_h} onChange={e => setPopularRangeDraft(p => ({ ...p, max_h: e.target.value }))} style={{ ...inputStyle, width: '76px' }} />
                                                                <button type="button" onClick={addEditPopularRange} style={{ flexShrink: 0, padding: '0 0.75rem', borderRadius: '0.625rem', border: '1px solid rgba(6,182,212,0.4)', background: 'rgba(6,182,212,0.15)', color: '#22d3ee', cursor: 'pointer', fontSize: '0.76rem', fontWeight: 700 }}>+ Add</button>
                                                            </div>
                                                            {editForm.popularSizeRanges.length > 0 && (
                                                                <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.375rem', marginTop: '0.5rem' }}>
                                                                    {editForm.popularSizeRanges.map((r, i) => (
                                                                        <button key={i} type="button" onClick={() => removeEditPopularRange(i)} style={{
                                                                            padding: '0.3rem 0.875rem', borderRadius: '100px', fontSize: '0.72rem', fontWeight: 700, cursor: 'pointer',
                                                                            border: '1px solid rgba(59,130,246,0.4)', background: 'rgba(59,130,246,0.15)', color: '#60a5fa',
                                                                            display: 'flex', alignItems: 'center', gap: '0.3rem',
                                                                        }}>
                                                                            {r.min_w}-{r.max_w} × {r.min_h}-{r.max_h} <span style={{ opacity: 0.7 }}>✕</span>
                                                                        </button>
                                                                    ))}
                                                                </div>
                                                            )}
                                                        </div>
                                                        )}
                                                    </div>
                                                )}

                                                <div style={{ display: 'flex', gap: '0.5rem', justifyContent: 'flex-end', marginTop: '0.875rem' }}>
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
                    )}

                    <div className="modal-footer-pad" style={{ padding: '1.125rem 2rem', borderTop: '1px solid rgba(255,255,255,0.06)', display: 'flex', justifyContent: 'flex-end', flexShrink: 0 }}>
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
