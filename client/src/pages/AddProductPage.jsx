import { useState, useMemo, useEffect } from 'react';
import { useProducts } from '../context/ProductContext';
import ConfigModal from '../components/inventory/ConfigModal';

const INITIAL_ATTRIBUTES = {
    'Color': ['White', 'Silver', 'Gold', 'Bronze', 'Grey', 'Matt Black'],
    'Thickness': ['4mm', '5mm', '6mm', '8mm', '10mm', '12mm'],
    'Length': ['21ft', '17ft', '16ft', '15ft'],
    'Roll Type': ['Big Roll', 'Small Roll'],
    'Size': ['Standard', 'Large', 'Small']
};

export default function AddProductPage() {
    const { products, categories, addProduct, updateProduct, addCategory, addProductVariant } = useProducts();

    const [config, setConfig] = useState({ categories, subCategories: {}, attributes: INITIAL_ATTRIBUTES });

    useEffect(() => {
        const subs = {};
        categories.forEach(c => { subs[c.id] = c.subCategories || []; });
        setConfig(prev => ({ ...prev, categories, subCategories: subs }));
    }, [categories]);

    const [configModalOpen, setConfigModalOpen] = useState(false);
    const [activeConfigTab, setActiveConfigTab] = useState('categories');
    const [selectedParentCategory, setSelectedParentCategory] = useState(categories[0]?.id || '');
    const [mode, setMode] = useState('new');
    const [submitting, setSubmitting] = useState(false);
    const [hasVariants, setHasVariants] = useState(false);

    const [newProductData, setNewProductData] = useState({
        name: '', itemCode: '', category: 'ke-profile', subCategory: 'window',
        image: null, applicableAttributes: ['Color'], defaultAttributes: {},
        stock: '', priceFull: '', priceHalf: '', priceFoot: '', length: '', trackOffcuts: false
    });

    const [matrixSelections, setMatrixSelections] = useState({});
    const [matrixValues, setMatrixValues] = useState({});

    const [filterCategory, setFilterCategory] = useState(() => (categories && categories.length > 0) ? categories[0].id : 'ke-profile');
    const [filterSubCategory, setFilterSubCategory] = useState('window');

    useEffect(() => {
        const validSubs = config.subCategories[filterCategory] || [];
        if (validSubs.length > 0) setFilterSubCategory(validSubs[0].id);
        else setFilterSubCategory('');
    }, [filterCategory, config.subCategories]);

    const [selectedExistingProduct, setSelectedExistingProduct] = useState(null);
    const [variantSelections, setVariantSelections] = useState({});
    const [variantPricing, setVariantPricing] = useState({ priceFull: '', priceHalf: '', priceUnit: '', initialStock: '' });

    const activeProductAttributes = useMemo(() => {
        const p = mode === 'new' ? newProductData : selectedExistingProduct;
        if (!p) return [];
        if (mode === 'new') return newProductData.applicableAttributes;
        if (p.attributes) return Object.keys(p.attributes);
        if (p.applicableAttributes) return p.applicableAttributes;
        return [];
    }, [mode, newProductData.applicableAttributes, selectedExistingProduct, newProductData.category]);

    const matrixPreview = useMemo(() => {
        if (mode !== 'new' || newProductData.applicableAttributes.length === 0) return [];
        const generationAttributes = newProductData.category === 'accessories'
            ? newProductData.applicableAttributes.filter(a => a !== 'Length')
            : newProductData.applicableAttributes;
        if (generationAttributes.length === 0) return [];
        const potentialValues = generationAttributes.map(a => matrixSelections[a] || []);
        if (potentialValues.some(v => v.length === 0)) return [];
        const cartesian = (arrays) => {
            if (arrays.length === 0) return [[]];
            const [first, ...rest] = arrays;
            const restCart = cartesian(rest);
            return first.flatMap(f => restCart.map(r => [f, ...r]));
        };
        return cartesian(potentialValues).map(combo => combo.join(' - '));
    }, [newProductData.applicableAttributes, matrixSelections, mode, newProductData.category]);

    const handleNewChange = e => {
        const { name, value } = e.target;
        setNewProductData(prev => {
            const updates = { [name]: value };
            if (name === 'length' && prev.category === 'accessories') updates.trackOffcuts = !!value && value.trim() !== '';
            return { ...prev, ...updates };
        });
    };

    const handleDefaultAttributeChange = (attrKey, value) => {
        const previousDefault = newProductData.defaultAttributes[attrKey];
        setNewProductData(prev => ({ ...prev, defaultAttributes: { ...prev.defaultAttributes, [attrKey]: value } }));
        setMatrixSelections(prev => {
            const current = prev[attrKey] || [];
            let updated = [...current];
            if (previousDefault && previousDefault !== value) updated = updated.filter(v => v !== previousDefault);
            if (value && !updated.includes(value)) updated.push(value);
            return { ...prev, [attrKey]: updated };
        });
    };

    const handleNewCategoryChange = e => {
        const cat = e.target.value;
        const defaultSub = config.subCategories[cat]?.[0]?.id || '';
        let defaults = [];
        if (cat.includes('profile')) defaults = ['Color', 'Length'];
        else if (cat === 'glass') defaults = ['Thickness'];
        setNewProductData(prev => ({ ...prev, category: cat, subCategory: defaultSub, applicableAttributes: defaults, defaultAttributes: {} }));
        setMatrixSelections({});
        setMatrixValues({});
    };

    const toggleApplicableAttribute = attrKey => {
        setNewProductData(prev => {
            const has = prev.applicableAttributes.includes(attrKey);
            const nextAttrs = has ? prev.applicableAttributes.filter(a => a !== attrKey) : [...prev.applicableAttributes, attrKey];
            const nextDefaults = { ...prev.defaultAttributes };
            if (has) { delete nextDefaults[attrKey]; const nextMatrix = { ...matrixSelections }; delete nextMatrix[attrKey]; setMatrixSelections(nextMatrix); }
            return { ...prev, applicableAttributes: nextAttrs, defaultAttributes: nextDefaults };
        });
    };

    const toggleMatrixValue = (attrKey, value) => {
        setMatrixSelections(prev => {
            const current = prev[attrKey] || [];
            const has = current.includes(value);
            return { ...prev, [attrKey]: has ? current.filter(v => v !== value) : [...current, value] };
        });
    };

    const handleMatrixValueChange = (variantName, field, value) => {
        setMatrixValues(prev => ({ ...prev, [variantName]: { ...(prev[variantName] || {}), [field]: value } }));
        if (field === 'length' && newProductData.category === 'accessories') {
            const hasLength = !!value && value.trim() !== '';
            setNewProductData(prev => prev.trackOffcuts !== hasLength ? { ...prev, trackOffcuts: hasLength } : prev);
        }
    };

    const filteredExistingProducts = useMemo(() => products.filter(p =>
        p.category === filterCategory && (p.subCategory === filterSubCategory || (!p.subCategory && filterSubCategory === 'general'))
    ), [products, filterCategory, filterSubCategory]);

    const handleSelectExisting = product => { setSelectedExistingProduct(product); setVariantSelections({}); setVariantPricing({ priceFull: '', priceHalf: '', priceUnit: '', initialStock: '' }); };
    const handleVariantSelection = (attrKey, value) => setVariantSelections(prev => ({ ...prev, [attrKey]: value }));
    const handlePricingChange = e => setVariantPricing(prev => ({ ...prev, [e.target.name]: e.target.value }));

    const handleAddConfigItem = newItem => {
        if (!newItem) return;
        if (activeConfigTab === 'categories') {
            const newId = newItem.toLowerCase().replace(/\s+/g, '-');
            addCategory({ id: newId, label: newItem, icon: '📦' });
        } else if (activeConfigTab === 'subcats') {
            if (!selectedParentCategory) return;
            const newId = newItem.toLowerCase().replace(/\s+/g, '-');
            setConfig(prev => ({ ...prev, subCategories: { ...prev.subCategories, [selectedParentCategory]: [...(prev.subCategories[selectedParentCategory] || []), { id: newId, label: newItem }] } }));
        } else {
            setConfig(prev => ({ ...prev, attributes: { ...prev.attributes, [activeConfigTab]: [...(prev.attributes[activeConfigTab] || []), newItem] } }));
        }
    };

    const handleAddAttributeCategory = newCategoryName => {
        if (!newCategoryName || config.attributes[newCategoryName]) return;
        setConfig(prev => ({ ...prev, attributes: { ...prev.attributes, [newCategoryName]: [] } }));
        setActiveConfigTab(newCategoryName);
    };

    const handleRemoveConfigItem = (itemToRemove, parentId = null) => {
        if (activeConfigTab === 'categories') {
            setConfig(prev => ({ ...prev, categories: prev.categories.filter(c => c.id !== itemToRemove.id) }));
        } else if (activeConfigTab === 'subcats') {
            setConfig(prev => ({ ...prev, subCategories: { ...prev.subCategories, [parentId]: prev.subCategories[parentId].filter(s => s.id !== itemToRemove.id) } }));
        } else {
            setConfig(prev => ({ ...prev, attributes: { ...prev.attributes, [activeConfigTab]: prev.attributes[activeConfigTab].filter(v => v !== itemToRemove) } }));
        }
    };

    const handleSubmit = e => {
        e.preventDefault();
        setSubmitting(true);
        setTimeout(() => {
            if (mode === 'new') {
                let finalProduct = {};
                if (hasVariants) {
                    if (matrixPreview.length === 0) { alert("Please generate at least one variant."); setSubmitting(false); return; }
                    const variants = matrixPreview.map(name => {
                        const vals = matrixValues[name] || {};
                        const parts = name.split(' - ');
                        const attrs = {};
                        newProductData.applicableAttributes.forEach((key, i) => { attrs[key] = parts[i]; });
                        return { id: `v-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`, name, attributes: attrs, price: parseFloat(vals.priceFull || 0), stock: parseInt(vals.stock || 0), details: { priceFull: parseFloat(vals.priceFull || 0), priceHalf: parseFloat(vals.priceHalf || 0), priceUnit: parseFloat(vals.priceUnit || 0) }, length: attrs['Length'] ? parseFloat(attrs['Length']) : (vals.length ? parseFloat(vals.length) : null) };
                    });
                    finalProduct = { id: `p-${Date.now()}`, ...newProductData, attributes: matrixSelections, variants, stock: 0, priceFull: 0, priceHalf: 0, priceFoot: 0, image: 'https://placehold.co/300x200/555555/FFFFFF?text=New+Product' };
                    alert(`Product Created: ${newProductData.name}\n${variants.length} Variants Generated.`);
                } else {
                    finalProduct = { id: `p-${Date.now()}`, ...newProductData, variants: [], stock: parseInt(newProductData.stock || 0), priceFull: parseFloat(newProductData.priceFull || 0), priceHalf: parseFloat(newProductData.priceHalf || 0), priceFoot: parseFloat(newProductData.priceFoot || 0), attributes: {}, image: 'https://placehold.co/300x200/555555/FFFFFF?text=Simple+Product' };
                    alert(`Product Created: ${newProductData.name}`);
                }
                addProduct(finalProduct);
                setNewProductData({ name: '', itemCode: '', category: 'ke-profile', subCategory: 'window', stock: '', priceFull: '', priceHalf: '', priceFoot: '', defaultAttributes: {}, applicableAttributes: ['Color'] });
                setMatrixSelections({}); setMatrixValues({});
            } else {
                const updatedProduct = { ...selectedExistingProduct };
                const variantName = Object.values(variantSelections).join(' - ');
                const lengthVal = variantSelections['Length'] ? parseFloat(variantSelections['Length']) : (variantPricing.length ? parseFloat(variantPricing.length) : null);
                const newVariant = { id: `v-${Date.now()}`, attributes: { ...variantSelections }, price: parseFloat(variantPricing.priceFull || 0), stock: parseInt(variantPricing.initialStock || 0), details: { priceFull: parseFloat(variantPricing.priceFull || 0), priceHalf: parseFloat(variantPricing.priceHalf || 0), priceUnit: parseFloat(variantPricing.priceUnit || 0) }, length: lengthVal };
                if (!updatedProduct.variants) updatedProduct.variants = [];
                updatedProduct.variants.push(newVariant);
                if (lengthVal && (updatedProduct.category === 'accessories' || updatedProduct.category.includes('profile'))) updatedProduct.trackOffcuts = true;
                updateProduct(updatedProduct);
                alert(`Variant Added!\n${selectedExistingProduct.name}\nVariant: ${variantName}`);
                setSelectedExistingProduct(null); setVariantSelections({}); setVariantPricing({ priceFull: '', priceHalf: '', priceUnit: '', initialStock: '' });
            }
            setSubmitting(false);
        }, 800);
    };

    const isVariantComplete = useMemo(() => {
        if (!selectedExistingProduct) return false;
        const attrsComplete = activeProductAttributes.every(attr => variantSelections[attr]);
        const pricingComplete = variantPricing.initialStock !== '' && variantPricing.priceFull !== '' && variantPricing.priceHalf !== '' && variantPricing.priceUnit !== '';
        return attrsComplete && pricingComplete;
    }, [activeProductAttributes, variantSelections, selectedExistingProduct, variantPricing]);

    // --- Style helpers ---
    const inputStyle = { width: '100%', boxSizing: 'border-box', background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: '0.75rem', padding: '0.625rem 0.875rem', color: '#f1f5f9', fontSize: '0.875rem', outline: 'none', transition: 'border-color 0.2s' };
    const selectStyle = { ...inputStyle, cursor: 'pointer', appearance: 'none' };
    const labelStyle = { fontSize: '0.62rem', fontWeight: 700, color: '#475569', letterSpacing: '0.08em', textTransform: 'uppercase', display: 'block', marginBottom: '0.375rem' };
    const cardStyle = { background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: '1.25rem', padding: '1.75rem' };
    const onFocusBorder = e => { e.target.style.borderColor = 'rgba(59,130,246,0.5)'; };
    const onBlurBorder = e => { e.target.style.borderColor = 'rgba(255,255,255,0.1)'; };
    const stepBadge = (n, color) => ({
        width: '28px', height: '28px', borderRadius: '50%', flexShrink: 0,
        background: color || 'rgba(59,130,246,0.15)', border: `1px solid ${color ? color.replace('0.15', '0.4') : 'rgba(59,130,246,0.4)'}`,
        display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '0.72rem', fontWeight: 800,
        color: color ? '#60a5fa' : '#60a5fa',
    });
    const chipBtn = (active, color = 'blue') => {
        const colors = { blue: ['rgba(59,130,246,0.15)', 'rgba(59,130,246,0.4)', '#60a5fa'], purple: ['rgba(168,85,247,0.15)', 'rgba(168,85,247,0.4)', '#c084fc'], green: ['rgba(34,197,94,0.15)', 'rgba(34,197,94,0.4)', '#4ade80'] };
        const [bg, border, text] = colors[color] || colors.blue;
        return { padding: '0.3rem 0.875rem', borderRadius: '100px', fontSize: '0.72rem', fontWeight: 700, cursor: 'pointer', border: `1px solid ${active ? border : 'rgba(255,255,255,0.1)'}`, background: active ? bg : 'transparent', color: active ? text : '#64748b', transition: 'all 0.15s' };
    };

    return (
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', height: '100%', background: 'var(--color-bg)', overflowY: 'auto', position: 'relative' }} className="custom-scrollbar">

            {/* Header */}
            <div style={{ height: '72px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '0 1.5rem', flexShrink: 0, background: 'rgba(9,14,26,0.95)', borderBottom: '1px solid rgba(255,255,255,0.07)', backdropFilter: 'blur(20px)', position: 'sticky', top: 0, zIndex: 20 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
                    <div style={{ width: '32px', height: '32px', borderRadius: '8px', background: 'rgba(59,130,246,0.15)', border: '1px solid rgba(59,130,246,0.3)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                        <svg width="16" height="16" fill="none" stroke="#60a5fa" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 4v16m8-8H4" /></svg>
                    </div>
                    <div>
                        <h1 style={{ fontSize: '0.9rem', fontWeight: 800, color: '#f1f5f9', margin: 0 }}>Product Management</h1>
                        <p style={{ fontSize: '0.62rem', color: '#475569', margin: 0 }}>Create products or expand existing lines</p>
                    </div>
                </div>
                <div style={{ display: 'flex', gap: '0.75rem', alignItems: 'center' }}>
                    <button onClick={() => setConfigModalOpen(true)} style={{ padding: '0.5rem 1rem', borderRadius: '0.625rem', border: '1px solid rgba(255,255,255,0.1)', background: 'rgba(255,255,255,0.05)', color: '#94a3b8', cursor: 'pointer', fontSize: '0.78rem', fontWeight: 700, display: 'flex', alignItems: 'center', gap: '0.375rem' }}>
                        ⚙️ Manage Options
                    </button>
                    <div style={{ display: 'flex', background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: '0.75rem', padding: '3px', gap: '2px' }}>
                        {['new', 'variant'].map(m => (
                            <button key={m} onClick={() => setMode(m)} style={{ padding: '0.375rem 1rem', borderRadius: '0.5rem', border: 'none', cursor: 'pointer', fontWeight: 700, fontSize: '0.78rem', background: mode === m ? 'rgba(59,130,246,0.2)' : 'transparent', color: mode === m ? '#60a5fa' : '#64748b', transition: 'all 0.15s' }}>
                                {m === 'new' ? 'New Product' : 'Add Variant'}
                            </button>
                        ))}
                    </div>
                </div>
            </div>

            {/* Content */}
            <div style={{ padding: '1.5rem', maxWidth: '900px', margin: '0 auto', width: '100%', paddingBottom: '100px' }}>
                <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>

                    {/* === NEW PRODUCT === */}
                    {mode === 'new' && (
                        <>
                            {/* Product type toggle */}
                            <div style={{ display: 'flex', justifyContent: 'center' }}>
                                <div style={{ display: 'flex', background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: '0.875rem', padding: '4px', gap: '4px' }}>
                                    {[{ val: false, icon: '📦', label: 'Simple Product' }, { val: true, icon: '🧩', label: 'Variable Product' }].map(({ val, icon, label }) => (
                                        <button key={label} type="button" onClick={() => setHasVariants(val)} style={{ padding: '0.5rem 1.5rem', borderRadius: '0.625rem', border: 'none', cursor: 'pointer', fontWeight: 700, fontSize: '0.82rem', display: 'flex', alignItems: 'center', gap: '0.5rem', background: hasVariants === val ? 'rgba(59,130,246,0.2)' : 'transparent', color: hasVariants === val ? '#60a5fa' : '#64748b', transition: 'all 0.2s' }}>
                                            <span>{icon}</span><span>{label}</span>
                                        </button>
                                    ))}
                                </div>
                            </div>

                            <div style={{ display: 'grid', gridTemplateColumns: hasVariants ? '1fr 320px' : '1fr', gap: '1.25rem', alignItems: 'start' }}>
                                <div style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
                                    {/* Core Details */}
                                    <div style={cardStyle}>
                                        <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', marginBottom: '1.25rem' }}>
                                            <div style={stepBadge(1)}>1</div>
                                            <h2 style={{ fontSize: '0.9rem', fontWeight: 800, color: '#f1f5f9', margin: 0 }}>Core Details</h2>
                                        </div>
                                        <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
                                            <div>
                                                <label style={labelStyle}>Product Name</label>
                                                <input required type="text" name="name" value={newProductData.name} onChange={handleNewChange} placeholder="e.g. Heavy Duty Sliding Track" style={inputStyle} onFocus={onFocusBorder} onBlur={onBlurBorder} />
                                            </div>
                                            <div>
                                                <label style={labelStyle}>Item Code <span style={{ color: '#334155', fontSize: '0.58rem', textTransform: 'none' }}>(Max 5)</span></label>
                                                <input type="text" name="itemCode" maxLength={5} value={newProductData.itemCode || ''} onChange={handleNewChange} placeholder="XXXXX" style={{ ...inputStyle, width: '120px', textAlign: 'center', letterSpacing: '0.15em', textTransform: 'uppercase' }} onFocus={onFocusBorder} onBlur={onBlurBorder} />
                                            </div>
                                            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.75rem' }}>
                                                <div>
                                                    <label style={labelStyle}>Category</label>
                                                    <select name="category" value={newProductData.category} onChange={handleNewCategoryChange} style={selectStyle} onFocus={onFocusBorder} onBlur={onBlurBorder}>
                                                        {categories.map(c => <option key={c.id} value={c.id}>{c.label}</option>)}
                                                    </select>
                                                </div>
                                                <div>
                                                    <label style={labelStyle}>Sub-Category</label>
                                                    <select name="subCategory" value={newProductData.subCategory} onChange={handleNewChange} style={selectStyle} onFocus={onFocusBorder} onBlur={onBlurBorder}>
                                                        {config.subCategories[newProductData.category]?.map(sub => <option key={sub.id} value={sub.id}>{sub.label}</option>)}
                                                    </select>
                                                </div>
                                            </div>
                                            {/* Variable track offcuts */}
                                            {hasVariants && (
                                                <div style={{ paddingTop: '0.75rem', borderTop: '1px solid rgba(255,255,255,0.06)' }}>
                                                    <label style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', cursor: 'pointer' }}>
                                                        <button type="button" onClick={() => setNewProductData(prev => ({ ...prev, trackOffcuts: !prev.trackOffcuts }))} style={{ width: '44px', height: '24px', borderRadius: '100px', border: 'none', cursor: 'pointer', position: 'relative', background: newProductData.trackOffcuts ? 'linear-gradient(135deg, #3b82f6, #06b6d4)' : 'rgba(255,255,255,0.1)', transition: 'background 0.2s', flexShrink: 0 }}>
                                                            <span style={{ position: 'absolute', top: '3px', left: newProductData.trackOffcuts ? '22px' : '3px', width: '18px', height: '18px', borderRadius: '50%', background: '#fff', transition: 'left 0.2s', display: 'block' }} />
                                                        </button>
                                                        <span style={{ fontSize: '0.72rem', fontWeight: 700, color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.06em' }}>Track Offcuts (all variants)</span>
                                                    </label>
                                                </div>
                                            )}
                                            {/* Simple product pricing */}
                                            {!hasVariants && (
                                                <div style={{ paddingTop: '1rem', borderTop: '1px solid rgba(255,255,255,0.06)' }}>
                                                    <p style={{ ...labelStyle, marginBottom: '0.875rem' }}>💲 Pricing & Inventory</p>
                                                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(120px, 1fr))', gap: '0.75rem' }}>
                                                        <div>
                                                            <label style={{ ...labelStyle, color: '#60a5fa' }}>Initial Stock</label>
                                                            <input type="number" name="stock" value={newProductData.stock} onChange={handleNewChange} placeholder="0" style={{ ...inputStyle, borderColor: 'rgba(59,130,246,0.2)' }} onFocus={onFocusBorder} onBlur={onBlurBorder} />
                                                        </div>
                                                        <div>
                                                            <label style={labelStyle}>Price (Full)</label>
                                                            <input type="number" name="priceFull" value={newProductData.priceFull} onChange={handleNewChange} placeholder="0.00" style={inputStyle} onFocus={onFocusBorder} onBlur={onBlurBorder} />
                                                        </div>
                                                        {newProductData.trackOffcuts && (
                                                            <>
                                                                <div>
                                                                    <label style={labelStyle}>Price (Half)</label>
                                                                    <input type="number" name="priceHalf" value={newProductData.priceHalf} onChange={handleNewChange} placeholder="0.00" style={inputStyle} onFocus={onFocusBorder} onBlur={onBlurBorder} />
                                                                </div>
                                                                <div>
                                                                    <label style={labelStyle}>Price (Unit/Ft)</label>
                                                                    <input type="number" name="priceFoot" value={newProductData.priceFoot} onChange={handleNewChange} placeholder="0.00" style={inputStyle} onFocus={onFocusBorder} onBlur={onBlurBorder} />
                                                                </div>
                                                            </>
                                                        )}
                                                        {(newProductData.category.includes('profile') || newProductData.category === 'accessories') && (
                                                            <div>
                                                                <label style={labelStyle}>Length (opt.)</label>
                                                                <input type="number" step="0.1" name="length" value={newProductData.length} onChange={handleNewChange} placeholder="e.g. 6.0" style={inputStyle} onFocus={onFocusBorder} onBlur={onBlurBorder} />
                                                            </div>
                                                        )}
                                                        <div style={{ display: 'flex', alignItems: 'center' }}>
                                                            <label style={{ display: 'flex', alignItems: 'center', gap: '0.625rem', cursor: 'pointer' }}>
                                                                <button type="button" onClick={() => setNewProductData(prev => ({ ...prev, trackOffcuts: !prev.trackOffcuts }))} style={{ width: '44px', height: '24px', borderRadius: '100px', border: 'none', cursor: 'pointer', position: 'relative', background: newProductData.trackOffcuts ? 'linear-gradient(135deg, #3b82f6, #06b6d4)' : 'rgba(255,255,255,0.1)', transition: 'background 0.2s', flexShrink: 0 }}>
                                                                    <span style={{ position: 'absolute', top: '3px', left: newProductData.trackOffcuts ? '22px' : '3px', width: '18px', height: '18px', borderRadius: '50%', background: '#fff', transition: 'left 0.2s', display: 'block' }} />
                                                                </button>
                                                                <span style={{ fontSize: '0.68rem', fontWeight: 700, color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.06em' }}>Track Offcuts</span>
                                                            </label>
                                                        </div>
                                                    </div>
                                                </div>
                                            )}
                                        </div>
                                    </div>

                                    {/* Matrix Generator */}
                                    {hasVariants && newProductData.applicableAttributes.length > 0 && (
                                        <div style={cardStyle}>
                                            <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', marginBottom: '1.25rem' }}>
                                                <div style={{ ...stepBadge(3), background: 'rgba(34,197,94,0.15)', border: '1px solid rgba(34,197,94,0.4)' }}>3</div>
                                                <h2 style={{ fontSize: '0.9rem', fontWeight: 800, color: '#f1f5f9', margin: 0 }}>Generate Variants</h2>
                                            </div>
                                            <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
                                                {/* Value toggles */}
                                                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: '0.75rem' }}>
                                                    {newProductData.applicableAttributes.filter(attr => !(newProductData.category === 'accessories' && attr === 'Length')).map(attrKey => (
                                                        <div key={attrKey} style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.07)', borderRadius: '0.875rem', padding: '0.875rem' }}>
                                                            <p style={{ ...labelStyle, marginBottom: '0.625rem' }}>{attrKey} values</p>
                                                            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.375rem' }}>
                                                                {config.attributes[attrKey]?.map(val => {
                                                                    const isSelected = (matrixSelections[attrKey] || []).includes(val);
                                                                    return <button key={val} type="button" onClick={() => toggleMatrixValue(attrKey, val)} style={chipBtn(isSelected, 'green')}>{val}</button>;
                                                                })}
                                                            </div>
                                                        </div>
                                                    ))}
                                                </div>

                                                {/* Matrix table */}
                                                {matrixPreview.length > 0 ? (
                                                    <div style={{ maxHeight: '320px', overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '0.5rem' }} className="custom-scrollbar">
                                                        {matrixPreview.map(name => (
                                                            <div key={name} style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(34,197,94,0.15)', borderRadius: '0.875rem', padding: '0.75rem 1rem', flexWrap: 'wrap' }}>
                                                                <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', minWidth: '120px' }}>
                                                                    <span style={{ width: '6px', height: '6px', borderRadius: '50%', background: '#4ade80', flexShrink: 0 }} />
                                                                    <span style={{ fontSize: '0.78rem', fontWeight: 700, color: '#e2e8f0', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={name}>{name}</span>
                                                                </div>
                                                                <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap', flex: 1 }}>
                                                                    {['stock', 'priceFull', ...(newProductData.trackOffcuts ? ['priceHalf', 'priceUnit'] : []), ...(newProductData.category === 'accessories' && newProductData.applicableAttributes.includes('Length') ? ['length'] : [])].map(field => (
                                                                        <div key={field} style={{ minWidth: '70px', flex: 1 }}>
                                                                            <label style={{ ...labelStyle, marginBottom: '2px' }}>{field}</label>
                                                                            <input type="number" value={matrixValues[name]?.[field] || ''} onChange={e => handleMatrixValueChange(name, field, e.target.value)} style={{ ...inputStyle, padding: '0.375rem 0.5rem', fontSize: '0.78rem' }} onFocus={onFocusBorder} onBlur={onBlurBorder} />
                                                                        </div>
                                                                    ))}
                                                                </div>
                                                            </div>
                                                        ))}
                                                    </div>
                                                ) : (
                                                    <div style={{ textAlign: 'center', padding: '1.5rem', border: '1px dashed rgba(255,255,255,0.08)', borderRadius: '0.875rem', color: '#334155', fontSize: '0.78rem', fontStyle: 'italic' }}>
                                                        Select values above to generate variants
                                                    </div>
                                                )}
                                            </div>
                                        </div>
                                    )}

                                    {/* Product Image */}
                                    <div style={cardStyle}>
                                        <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', marginBottom: '1.25rem' }}>
                                            <div style={{ ...stepBadge(4), background: 'rgba(245,158,11,0.15)', border: '1px solid rgba(245,158,11,0.4)', color: '#fbbf24' }}>4</div>
                                            <h2 style={{ fontSize: '0.9rem', fontWeight: 800, color: '#f1f5f9', margin: 0 }}>Product Image</h2>
                                        </div>
                                        <div style={{ border: '2px dashed rgba(255,255,255,0.1)', borderRadius: '1rem', padding: '2rem', textAlign: 'center', cursor: 'pointer', transition: 'border-color 0.2s' }}
                                            onMouseEnter={e => { e.currentTarget.style.borderColor = 'rgba(245,158,11,0.3)'; }}
                                            onMouseLeave={e => { e.currentTarget.style.borderColor = 'rgba(255,255,255,0.1)'; }}>
                                            <div style={{ fontSize: '2rem', marginBottom: '0.5rem', opacity: 0.5 }}>📸</div>
                                            <p style={{ fontSize: '0.82rem', fontWeight: 700, color: '#94a3b8', margin: '0 0 4px' }}>Upload Product Image</p>
                                            <p style={{ fontSize: '0.72rem', color: '#475569', margin: '0 0 1rem' }}>PNG, JPG up to 5MB</p>
                                            <input type="file" id="image-upload" className="hidden" onChange={e => { const f = e.target.files[0]; if (f) { const r = new FileReader(); r.onload = ev => setNewProductData(prev => ({ ...prev, image: ev.target.result })); r.readAsDataURL(f); } }} />
                                            <label htmlFor="image-upload" style={{ padding: '0.5rem 1.25rem', borderRadius: '0.625rem', border: '1px solid rgba(255,255,255,0.12)', background: 'rgba(255,255,255,0.06)', color: '#94a3b8', cursor: 'pointer', fontSize: '0.78rem', fontWeight: 700 }}>Choose File</label>
                                            {newProductData.image && (
                                                <div style={{ marginTop: '1rem', position: 'relative', width: '96px', height: '96px', borderRadius: '0.75rem', overflow: 'hidden', border: '1px solid rgba(255,255,255,0.1)', margin: '1rem auto 0' }}>
                                                    <img src={newProductData.image} alt="Preview" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                                                    <button onClick={e => { e.preventDefault(); setNewProductData(prev => ({ ...prev, image: null })); }} style={{ position: 'absolute', top: '4px', right: '4px', width: '20px', height: '20px', borderRadius: '50%', background: 'rgba(239,68,68,0.9)', border: 'none', cursor: 'pointer', color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '0.72rem' }}>✕</button>
                                                </div>
                                            )}
                                        </div>
                                    </div>
                                </div>

                                {/* Attributes sidebar (variable only) */}
                                {hasVariants && (
                                    <div style={cardStyle}>
                                        <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', marginBottom: '1.25rem' }}>
                                            <div style={{ ...stepBadge(2), background: 'rgba(168,85,247,0.15)', border: '1px solid rgba(168,85,247,0.4)', color: '#c084fc' }}>2</div>
                                            <h2 style={{ fontSize: '0.9rem', fontWeight: 800, color: '#f1f5f9', margin: 0 }}>Attributes</h2>
                                        </div>
                                        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                                            {Object.keys(config.attributes).map(attrKey => {
                                                const isSelected = newProductData.applicableAttributes.includes(attrKey);
                                                return (
                                                    <div key={attrKey} style={{ borderRadius: '0.875rem', border: `1px solid ${isSelected ? 'rgba(168,85,247,0.4)' : 'rgba(255,255,255,0.07)'}`, background: isSelected ? 'rgba(168,85,247,0.08)' : 'rgba(255,255,255,0.03)', padding: '0.75rem 1rem', transition: 'all 0.15s' }}>
                                                        <div onClick={() => toggleApplicableAttribute(attrKey)} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', cursor: 'pointer' }}>
                                                            <span style={{ fontSize: '0.82rem', fontWeight: 700, color: isSelected ? '#c084fc' : '#64748b' }}>{attrKey}</span>
                                                            <div style={{ width: '18px', height: '18px', borderRadius: '5px', border: `1px solid ${isSelected ? 'rgba(168,85,247,0.6)' : 'rgba(255,255,255,0.15)'}`, background: isSelected ? 'rgba(168,85,247,0.5)' : 'transparent', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                                                                {isSelected && <svg width="10" height="10" fill="none" stroke="#fff" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="3" d="M5 13l4 4L19 7" /></svg>}
                                                            </div>
                                                        </div>
                                                        {isSelected && attrKey !== 'Color' && (
                                                            <div style={{ marginTop: '0.625rem' }}>
                                                                <label style={{ ...labelStyle, marginBottom: '0.25rem' }}>Default {attrKey}</label>
                                                                <select value={newProductData.defaultAttributes[attrKey] || ''} onChange={e => handleDefaultAttributeChange(attrKey, e.target.value)} onClick={e => e.stopPropagation()} style={{ ...selectStyle, fontSize: '0.78rem', padding: '0.375rem 0.625rem' }} onFocus={onFocusBorder} onBlur={onBlurBorder}>
                                                                    <option value="">No Default</option>
                                                                    {config.attributes[attrKey].map(opt => <option key={opt} value={opt}>{opt}</option>)}
                                                                </select>
                                                            </div>
                                                        )}
                                                    </div>
                                                );
                                            })}
                                        </div>
                                    </div>
                                )}
                            </div>
                        </>
                    )}

                    {/* === VARIANT MODE === */}
                    {mode === 'variant' && (
                        <div style={{ maxWidth: '700px', margin: '0 auto', width: '100%', display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
                            {/* Step 1: Find product */}
                            <div style={cardStyle}>
                                <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', marginBottom: '1.25rem' }}>
                                    <div style={stepBadge(1)}>1</div>
                                    <h2 style={{ fontSize: '0.9rem', fontWeight: 800, color: '#f1f5f9', margin: 0 }}>Find Existing Product</h2>
                                </div>
                                {!selectedExistingProduct ? (
                                    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
                                        {/* Category tabs */}
                                        <div style={{ display: 'flex', gap: '0.5rem', overflowX: 'auto', paddingBottom: '0.5rem', borderBottom: '1px solid rgba(255,255,255,0.06)' }} className="scrollbar-hide">
                                            {categories.map(cat => (
                                                <button key={cat.id} type="button" onClick={() => setFilterCategory(cat.id)} style={{ padding: '0.375rem 0.875rem', borderRadius: '0.625rem', border: '1px solid', whiteSpace: 'nowrap', cursor: 'pointer', fontSize: '0.78rem', fontWeight: 700, background: filterCategory === cat.id ? 'rgba(59,130,246,0.12)' : 'transparent', borderColor: filterCategory === cat.id ? 'rgba(59,130,246,0.35)' : 'rgba(255,255,255,0.08)', color: filterCategory === cat.id ? '#60a5fa' : '#64748b', transition: 'all 0.15s' }}>
                                                    {cat.label}
                                                </button>
                                            ))}
                                        </div>
                                        {/* Subcategory chips */}
                                        <div style={{ display: 'flex', gap: '0.375rem', flexWrap: 'wrap' }}>
                                            {(config.subCategories[filterCategory] || []).map(u => (
                                                <button key={u.id} type="button" onClick={() => setFilterSubCategory(u.id)} style={{ padding: '0.25rem 0.75rem', borderRadius: '100px', border: '1px solid', cursor: 'pointer', fontSize: '0.68rem', fontWeight: 700, background: filterSubCategory === u.id ? 'rgba(59,130,246,0.12)' : 'transparent', borderColor: filterSubCategory === u.id ? 'rgba(59,130,246,0.35)' : 'rgba(255,255,255,0.08)', color: filterSubCategory === u.id ? '#60a5fa' : '#64748b', transition: 'all 0.15s' }}>
                                                    {u.label}
                                                </button>
                                            ))}
                                        </div>
                                        {/* Product grid */}
                                        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))', gap: '0.75rem', maxHeight: '380px', overflowY: 'auto' }} className="custom-scrollbar">
                                            {filteredExistingProducts.length === 0 ? (
                                                <div style={{ gridColumn: '1 / -1', padding: '3rem', textAlign: 'center', border: '1px dashed rgba(255,255,255,0.08)', borderRadius: '0.875rem', color: '#334155', fontSize: '0.82rem' }}>No products found.</div>
                                            ) : filteredExistingProducts.map(p => (
                                                <div key={p.id} onClick={() => handleSelectExisting(p)} style={{ padding: '1rem', background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.07)', borderRadius: '1rem', cursor: 'pointer', transition: 'all 0.15s' }}
                                                    onMouseEnter={e => { e.currentTarget.style.borderColor = 'rgba(59,130,246,0.35)'; e.currentTarget.style.background = 'rgba(59,130,246,0.06)'; }}
                                                    onMouseLeave={e => { e.currentTarget.style.borderColor = 'rgba(255,255,255,0.07)'; e.currentTarget.style.background = 'rgba(255,255,255,0.04)'; }}>
                                                    <p style={{ fontSize: '0.82rem', fontWeight: 700, color: '#e2e8f0', margin: '0 0 4px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{p.name}</p>
                                                    <p style={{ fontSize: '0.68rem', color: '#475569', margin: 0 }}>{p.variants?.length || 0} variants</p>
                                                </div>
                                            ))}
                                        </div>
                                    </div>
                                ) : (
                                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '1rem 1.25rem', background: 'rgba(59,130,246,0.08)', border: '1px solid rgba(59,130,246,0.25)', borderRadius: '0.875rem' }}>
                                        <div>
                                            <p style={{ fontWeight: 700, color: '#e2e8f0', margin: '0 0 2px', fontSize: '0.9rem' }}>{selectedExistingProduct.name}</p>
                                            <p style={{ fontSize: '0.72rem', color: '#60a5fa', margin: 0 }}>Adding new variant</p>
                                        </div>
                                        <button onClick={() => setSelectedExistingProduct(null)} style={{ padding: '0.375rem 0.875rem', borderRadius: '0.625rem', border: '1px solid rgba(59,130,246,0.3)', background: 'rgba(59,130,246,0.1)', color: '#60a5fa', cursor: 'pointer', fontSize: '0.78rem', fontWeight: 700 }}>Change</button>
                                    </div>
                                )}
                            </div>

                            {/* Step 2: Configure */}
                            {selectedExistingProduct && (
                                <div style={cardStyle}>
                                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', marginBottom: '1.25rem' }}>
                                        <div style={{ ...stepBadge(2), background: 'rgba(168,85,247,0.15)', border: '1px solid rgba(168,85,247,0.4)', color: '#c084fc' }}>2</div>
                                        <h2 style={{ fontSize: '0.9rem', fontWeight: 800, color: '#f1f5f9', margin: 0 }}>Configure Variant</h2>
                                    </div>
                                    {activeProductAttributes.length > 0 ? (
                                        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: '1rem', marginBottom: '1.25rem' }}>
                                            {activeProductAttributes.map(attrKey => (
                                                <div key={attrKey}>
                                                    <label style={labelStyle}>{attrKey}</label>
                                                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.375rem', marginTop: '0.375rem' }}>
                                                        {config.attributes[attrKey]?.map(val => (
                                                            <button key={val} type="button" onClick={() => handleVariantSelection(attrKey, val)} style={chipBtn(variantSelections[attrKey] === val)}>{val}</button>
                                                        ))}
                                                    </div>
                                                </div>
                                            ))}
                                        </div>
                                    ) : (
                                        <p style={{ fontSize: '0.82rem', color: '#475569', fontStyle: 'italic', marginBottom: '1rem' }}>Standard product with no specific attributes.</p>
                                    )}

                                    <div style={{ paddingTop: '1rem', borderTop: '1px solid rgba(255,255,255,0.06)' }}>
                                        <p style={{ ...labelStyle, marginBottom: '0.875rem' }}>💲 Stock & Pricing</p>
                                        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(110px, 1fr))', gap: '0.75rem' }}>
                                            <div>
                                                <label style={{ ...labelStyle, color: '#60a5fa' }}>Stock Qty</label>
                                                <input type="number" name="initialStock" value={variantPricing.initialStock} onChange={handlePricingChange} placeholder="0" style={{ ...inputStyle, borderColor: 'rgba(59,130,246,0.2)' }} onFocus={onFocusBorder} onBlur={onBlurBorder} />
                                            </div>
                                            <div>
                                                <label style={labelStyle}>Price (Full)</label>
                                                <input type="number" name="priceFull" value={variantPricing.priceFull} onChange={handlePricingChange} placeholder="0.00" style={inputStyle} onFocus={onFocusBorder} onBlur={onBlurBorder} />
                                            </div>
                                            {selectedExistingProduct.trackOffcuts && (
                                                <>
                                                    <div>
                                                        <label style={labelStyle}>Price (Half)</label>
                                                        <input type="number" name="priceHalf" value={variantPricing.priceHalf} onChange={handlePricingChange} placeholder="0.00" style={inputStyle} onFocus={onFocusBorder} onBlur={onBlurBorder} />
                                                    </div>
                                                    <div>
                                                        <label style={labelStyle}>Price (Unit)</label>
                                                        <input type="number" name="priceUnit" value={variantPricing.priceUnit} onChange={handlePricingChange} placeholder="0.00" style={inputStyle} onFocus={onFocusBorder} onBlur={onBlurBorder} />
                                                    </div>
                                                </>
                                            )}
                                            {(selectedExistingProduct.category === 'accessories' && activeProductAttributes.includes('Length')) && (
                                                <div>
                                                    <label style={labelStyle}>Length</label>
                                                    <input type="number" step="0.1" name="length" value={variantPricing.length || ''} onChange={handlePricingChange} placeholder="e.g 6.0" style={inputStyle} onFocus={onFocusBorder} onBlur={onBlurBorder} />
                                                </div>
                                            )}
                                        </div>
                                    </div>
                                </div>
                            )}
                        </div>
                    )}

                    {/* Sticky action bar */}
                    <div style={{ position: 'fixed', bottom: 0, left: 0, right: 0, padding: '1rem 1.5rem', background: 'rgba(9,14,26,0.97)', borderTop: '1px solid rgba(255,255,255,0.07)', backdropFilter: 'blur(20px)', display: 'flex', justifyContent: 'flex-end', zIndex: 30 }}>
                        <button type="submit" disabled={submitting || (mode === 'variant' && !isVariantComplete)} style={{
                            padding: '0.75rem 2.5rem', borderRadius: '0.875rem', border: 'none', cursor: submitting || (mode === 'variant' && !isVariantComplete) ? 'not-allowed' : 'pointer',
                            background: submitting || (mode === 'variant' && !isVariantComplete) ? 'rgba(59,130,246,0.2)' : 'linear-gradient(135deg, #3b82f6, #06b6d4)',
                            color: '#fff', fontWeight: 700, fontSize: '0.875rem',
                            boxShadow: submitting || (mode === 'variant' && !isVariantComplete) ? 'none' : '0 4px 16px rgba(59,130,246,0.3)',
                            transition: 'all 0.2s', minWidth: '180px', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '0.5rem',
                        }}>
                            {submitting ? (
                                <><span style={{ display: 'inline-block', width: '14px', height: '14px', border: '2px solid rgba(255,255,255,0.3)', borderTop: '2px solid #fff', borderRadius: '50%', animation: 'spin 0.8s linear infinite' }} /><span>Processing...</span></>
                            ) : (
                                <span>{mode === 'new' ? '+ Create Product' : '+ Add Variant'}</span>
                            )}
                        </button>
                    </div>
                </form>
            </div>

            <ConfigModal isOpen={configModalOpen} onClose={() => setConfigModalOpen(false)} activeTab={activeConfigTab} onTabChange={setActiveConfigTab} config={config} selectedParentCategory={selectedParentCategory} onParentCategoryChange={setSelectedParentCategory} onAdd={handleAddConfigItem} onRemove={handleRemoveConfigItem} onAddCategory={handleAddAttributeCategory} />
        </div>
    );
}
