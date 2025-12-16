import { useState, useMemo } from 'react';
import { PRODUCTS, CATEGORIES as INITIAL_CATEGORIES } from '../data/mockProducts';

// --- Initial Data ---
const INITIAL_COLORS = ['White', 'Silver', 'Gold', 'Bronze', 'Grey', 'Matt Black'];
const INITIAL_THICKNESSES = ['4mm', '5mm', '6mm', '8mm', '10mm', '12mm'];
// Constants for variants
const KE_LENGTHS = [21, 17, 16, 15];

const INITIAL_SUB_CATEGORIES = {
    'ke-profile': [
        { id: 'window', label: 'Windows' },
        { id: 'door', label: 'Doors' },
        { id: 'general', label: 'General' },
    ],
    'tz-profile': [
        { id: 'window', label: 'Windows' },
        { id: 'door', label: 'Doors' },
        { id: 'general', label: 'General' },
    ],
    'glass': [
        { id: 'clear', label: 'Clear' },
        { id: 'oneway', label: 'One/Way' }, // Fixed ID
        { id: 'tint', label: 'Tinted' },
        { id: 'mirror', label: 'Mirror' },
        { id: 'frost', label: 'Frost' },
        { id: 'obscure', label: 'Obscure' },
        { id: 'alucoboard', label: 'Alucoboard' },
    ],
    'accessories': [
        { id: 'general', label: 'General' }
    ]
};

export default function AddProductPage() {
    // --- Config State (Editable by Admin) ---
    const [config, setConfig] = useState({
        categories: INITIAL_CATEGORIES,
        subCategories: INITIAL_SUB_CATEGORIES,
        colors: INITIAL_COLORS,
        thicknesses: INITIAL_THICKNESSES
    });
    const [configModalOpen, setConfigModalOpen] = useState(false);
    const [activeConfigTab, setActiveConfigTab] = useState('categories'); // categories, subcats, colors, thicknesses
    const [selectedParentCategory, setSelectedParentCategory] = useState(INITIAL_CATEGORIES[0]?.id || '');

    // Mode: 'new' | 'variant'
    const [mode, setMode] = useState('new');
    const [submitting, setSubmitting] = useState(false);

    // --- State for "New Product" ---
    const [newProductData, setNewProductData] = useState({
        name: '',
        category: 'ke-profile',
        subCategory: 'window',
        sku: '',
        image: null,
        variants: ['White']
    });

    // --- State for "Existing Variant" ---
    const [existingSearch, setExistingSearch] = useState('');
    const [filterCategory, setFilterCategory] = useState('all');
    const [filterSubCategory, setFilterSubCategory] = useState('all');

    const [selectedExistingProduct, setSelectedExistingProduct] = useState(null);
    const [variantToAdd, setVariantToAdd] = useState('');

    // New: Full Pricing for Variant
    const [variantPricing, setVariantPricing] = useState({
        priceFull: '',
        priceHalf: '',
        priceUnit: '',
        initialStock: '', // Quantity
        selectedLength: '21', // For KE Profile Length Dropdown
    });

    // --- Handlers: New Product ---
    const handleNewChange = (e) => {
        const { name, value } = e.target;
        setNewProductData(prev => ({ ...prev, [name]: value }));
    };

    const handleNewCategoryChange = (e) => {
        const cat = e.target.value;
        const defaultSub = config.subCategories[cat]?.[0]?.id || '';

        setNewProductData(prev => ({
            ...prev,
            category: cat,
            subCategory: defaultSub,
            variants: cat.includes('profile') ? ['White'] : cat === 'glass' ? ['6mm'] : []
        }));
    };

    const handleNewVariantToggle = (variant) => {
        setNewProductData(prev => {
            const exists = prev.variants.includes(variant);
            return {
                ...prev,
                variants: exists
                    ? prev.variants.filter(v => v !== variant)
                    : [...prev.variants, variant]
            };
        });
    };

    // --- Handlers: Existing Variant ---
    const filteredExistingProducts = useMemo(() => {
        return PRODUCTS.filter(p => {
            const matchesSearch = p.name.toLowerCase().includes(existingSearch.toLowerCase());
            const matchesCat = filterCategory === 'all' || p.category === filterCategory;
            // Corrected logic: if item has no usage field (e.g. accessories), treat as matching if subcat filter is 'all'
            const itemUsage = p.usage || 'general';
            const matchesSub = (filterSubCategory === 'all' || filterCategory === 'all') || itemUsage === filterSubCategory;
            return matchesSearch && matchesCat && matchesSub;
        });
    }, [existingSearch, filterCategory, filterSubCategory]);

    const handleSelectExisting = (product) => {
        setSelectedExistingProduct(product);
        setExistingSearch('');
        setVariantToAdd('');
        // Pre-populate pricing from parent product
        setVariantPricing({
            priceFull: product.priceFull,
            priceHalf: product.priceHalf,
            priceUnit: product.priceUnit || product.priceSqFt || '',
            initialStock: '',
            selectedLength: '21'
        });
    };

    const handleVariantPricingChange = (e) => {
        const { name, value } = e.target;
        setVariantPricing(prev => ({ ...prev, [name]: value }));
    };

    // --- Handlers: Config Logic ---
    const handleAddConfigItem = (newItem) => {
        if (!newItem) return;

        // 1. Categories
        if (activeConfigTab === 'categories') {
            const newId = newItem.toLowerCase().replace(/\s+/g, '-');
            setConfig(prev => ({
                ...prev,
                categories: [...prev.categories, { id: newId, label: newItem, icon: '📦' }],
                subCategories: { ...prev.subCategories, [newId]: [] } // Initialize subcats
            }));
        }
        // 2. Sub-Categories
        else if (activeConfigTab === 'subcats') {
            if (!selectedParentCategory) return;
            const newId = newItem.toLowerCase().replace(/\s+/g, '-');
            setConfig(prev => ({
                ...prev,
                subCategories: {
                    ...prev.subCategories,
                    [selectedParentCategory]: [
                        ...(prev.subCategories[selectedParentCategory] || []),
                        { id: newId, label: newItem }
                    ]
                }
            }));
        }
        // 3. Colors
        else if (activeConfigTab === 'colors') {
            setConfig(prev => ({ ...prev, colors: [...prev.colors, newItem] }));
        }
        // 4. Thicknesses
        else if (activeConfigTab === 'thickness') {
            setConfig(prev => ({ ...prev, thicknesses: [...prev.thicknesses, newItem] }));
        }
    };

    const handleRemoveConfigItem = (itemToRemove, parentId = null) => {
        if (activeConfigTab === 'categories') {
            setConfig(prev => ({
                ...prev,
                categories: prev.categories.filter(c => c.id !== itemToRemove.id)
                // Note: Ideally should cleanup subcats too
            }));
        } else if (activeConfigTab === 'subcats') {
            if (!parentId) return;
            setConfig(prev => ({
                ...prev,
                subCategories: {
                    ...prev.subCategories,
                    [parentId]: prev.subCategories[parentId].filter(s => s.id !== itemToRemove.id)
                }
            }));
        } else if (activeConfigTab === 'colors') {
            setConfig(prev => ({ ...prev, colors: prev.colors.filter(c => c !== itemToRemove) }));
        } else if (activeConfigTab === 'thickness') {
            setConfig(prev => ({ ...prev, thicknesses: prev.thicknesses.filter(c => c !== itemToRemove) }));
        }
    };


    const handleSubmit = (e) => {
        e.preventDefault();
        setSubmitting(true);

        // Mock API
        setTimeout(() => {
            if (mode === 'new') {
                alert(`New Product Created!\nVariants: ${newProductData.variants.join(', ')}\n(Stock will be added via "Add Variant")`);
                setNewProductData({
                    name: '', category: 'ke-profile', subCategory: 'window', sku: '', image: null, variants: ['White']
                });
            } else {
                const stockMsg = selectedExistingProduct.category === 'ke-profile'
                    ? `Stock: ${variantPricing.initialStock} units of ${variantPricing.selectedLength}ft`
                    : `Stock: ${variantPricing.initialStock}`;

                alert(`Variant Added!\n${selectedExistingProduct.name} - ${variantToAdd}\n${stockMsg}\nPrice: ${variantPricing.priceFull}`);
                setSelectedExistingProduct(null);
                setVariantToAdd('');
                setVariantPricing({ priceFull: '', priceHalf: '', priceUnit: '', initialStock: '', selectedLength: '21' });
            }
            setSubmitting(false);
        }, 1500);
    };

    // Helpers
    const getAvailableVariantsForType = (category) => {
        if (!category) return [];
        // Improved logic: Use category ID content rather than hardcoded string inclusion
        // Or keep simple for now
        if (category.includes('profile')) return config.colors;
        if (category === 'glass') return config.thicknesses;
        return [];
    };

    const currentVariantsList = mode === 'new'
        ? getAvailableVariantsForType(newProductData.category)
        : selectedExistingProduct ? getAvailableVariantsForType(selectedExistingProduct.category) : [];

    return (
        <div className="flex-1 flex flex-col h-full bg-slate-50 font-sans text-gray-800 overflow-y-auto custom-scrollbar relative">

            {/* Header */}
            <header className="h-24 flex px-8 items-center justify-between border-b border-gray-200 bg-white sticky top-0 z-20 shadow-sm shrink-0">
                <div className="flex items-center gap-4">
                    <div className="p-3 bg-gray-900 rounded-2xl text-white shadow-lg shadow-gray-900/20">
                        <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 4v16m8-8H4"></path></svg>
                    </div>
                    <div>
                        <h1 className="text-2xl font-bold tracking-tight text-gray-900">Product Management</h1>
                        <p className="text-sm text-gray-500 font-medium">Create products or expand existing lines.</p>
                    </div>
                </div>

                <div className="flex gap-4">
                    {/* Metadata Button */}
                    <button
                        onClick={() => setConfigModalOpen(true)}
                        className="px-4 py-2.5 rounded-xl border border-gray-200 bg-white text-gray-600 font-bold text-sm hover:bg-gray-50 hover:text-blue-600 transition-all flex items-center gap-2"
                    >
                        <span>⚙️ Manage Options</span>
                    </button>

                    {/* Mode Switcher */}
                    <div className="bg-gray-100 p-1 rounded-xl flex font-bold text-sm">
                        <button
                            onClick={() => setMode('new')}
                            className={`px-6 py-2.5 rounded-lg transition-all ${mode === 'new' ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-700'}`}
                        >
                            New Product
                        </button>
                        <button
                            onClick={() => setMode('variant')}
                            className={`px-6 py-2.5 rounded-lg transition-all ${mode === 'variant' ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-700'}`}
                        >
                            Add Variant
                        </button>
                    </div>
                </div>
            </header>

            {/* Content */}
            <div className="p-8 max-w-5xl mx-auto w-full pb-20">

                <form onSubmit={handleSubmit} className="space-y-8 animate-fade-in">

                    {/* === MODE: NEW PRODUCT === */}
                    {mode === 'new' && (
                        <>
                            <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
                                {/* Left Column: Core Info */}
                                <div className="lg:col-span-2 space-y-8">
                                    <div className="bg-white p-8 rounded-3xl border border-gray-100 shadow-sm hover:shadow-md transition-shadow">
                                        <h2 className="text-lg font-bold text-gray-900 mb-6 flex items-center gap-3">
                                            <span className="w-8 h-8 rounded-full bg-blue-50 text-blue-600 flex items-center justify-center font-bold text-sm">1</span>
                                            Product Details
                                        </h2>

                                        <div className="space-y-6">
                                            <div>
                                                <label className="block text-xs font-bold text-gray-400 uppercase tracking-wide mb-2">Product Name</label>
                                                <input required type="text" name="name" value={newProductData.name} onChange={handleNewChange} className="w-full bg-gray-50 border-gray-200 rounded-xl px-4 py-3 font-bold focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 transition-all placeholder-gray-300" placeholder="e.g. Heavy Duty Sliding Track" />
                                            </div>
                                            <div className="grid grid-cols-2 gap-6">
                                                <div>
                                                    <label className="block text-xs font-bold text-gray-400 uppercase tracking-wide mb-2">Category</label>
                                                    <select name="category" value={newProductData.category} onChange={handleNewCategoryChange} className="w-full bg-gray-50 border-gray-200 rounded-xl px-4 py-3 font-medium focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 transition-all cursor-pointer">
                                                        {config.categories.map(c => <option key={c.id} value={c.id}>{c.label}</option>)}
                                                    </select>
                                                </div>
                                                <div>
                                                    <label className="block text-xs font-bold text-gray-400 uppercase tracking-wide mb-2">Sub-Category</label>
                                                    <select
                                                        name="subCategory"
                                                        value={newProductData.subCategory}
                                                        onChange={handleNewChange}
                                                        className="w-full bg-gray-50 border-gray-200 rounded-xl px-4 py-3 font-medium focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 transition-all cursor-pointer"
                                                        disabled={!config.subCategories[newProductData.category]}
                                                    >
                                                        {config.subCategories[newProductData.category] ? (
                                                            config.subCategories[newProductData.category].map(sub => (
                                                                <option key={sub.id} value={sub.id}>{sub.label}</option>
                                                            ))
                                                        ) : (
                                                            <option value="">None</option>
                                                        )}
                                                    </select>
                                                </div>
                                            </div>
                                            <div className="grid grid-cols-2 gap-6">
                                                <div>
                                                    <label className="block text-xs font-bold text-gray-400 uppercase tracking-wide mb-2">Code</label>
                                                    <input type="text" name="code" value={newProductData.sku} onChange={handleNewChange} className="w-full bg-gray-50 border-gray-200 rounded-xl px-4 py-3 font-mono text-sm focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 transition-all placeholder-gray-300" placeholder="code" />
                                                </div>

                                                {/* Initial Stock REMOVED for New Product */}
                                            </div>
                                        </div>
                                    </div>

                                </div>

                                {/* Right Column: Variants & Image */}
                                <div className="space-y-8">
                                    <div className="bg-white p-8 rounded-3xl border border-gray-100 shadow-sm hover:shadow-md transition-shadow">
                                        <h2 className="text-lg font-bold text-gray-900 mb-6 flex items-center gap-3">
                                            <span className="w-8 h-8 rounded-full bg-purple-50 text-purple-600 flex items-center justify-center font-bold text-sm">3</span>
                                            {newProductData.category.includes('profile') ? 'Colors' : newProductData.category === 'glass' ? 'Thicknesses' : 'Variants'}
                                        </h2>

                                        {currentVariantsList.length > 0 ? (
                                            <div className="flex flex-wrap gap-2">
                                                {currentVariantsList.map(v => (
                                                    <button
                                                        key={v}
                                                        type="button"
                                                        onClick={() => handleNewVariantToggle(v)}
                                                        className={`px-3 py-2 rounded-lg text-sm font-bold border-2 transition-all ${newProductData.variants.includes(v) ? 'bg-purple-50 border-purple-500 text-purple-700 shadow-sm' : 'bg-white border-transparent text-gray-400 hover:bg-gray-50'}`}
                                                    >
                                                        {v}
                                                    </button>
                                                ))}
                                            </div>
                                        ) : (
                                            <p className="text-gray-400 text-sm italic">Standard items have no variants.</p>
                                        )}
                                    </div>

                                    <div className="bg-white p-8 rounded-3xl border border-gray-100 shadow-sm hover:shadow-md transition-shadow">
                                        <div className="border-2 border-dashed border-gray-200 rounded-2xl h-40 flex flex-col items-center justify-center text-gray-400 hover:border-purple-300 hover:bg-purple-50 transition-all cursor-pointer">
                                            <span className="text-2xl mb-2">📷</span>
                                            <span className="text-xs font-bold uppercase tracking-wide">Upload Image</span>
                                        </div>
                                    </div>
                                </div>
                            </div>
                        </>
                    )}

                    {/* === MODE: EXISTING VARIANT === */}
                    {mode === 'variant' && (
                        <div className="max-w-4xl mx-auto space-y-8">

                            {/* Step 1: Select Product */}
                            <div className="bg-white p-8 rounded-3xl border border-gray-100 shadow-lg shadow-gray-200/50">
                                <h2 className="text-xl font-bold text-gray-900 mb-6">Find existing product</h2>

                                {!selectedExistingProduct ? (
                                    <div className="space-y-6">

                                        {/* Filter Tabs */}
                                        <div className="space-y-4">
                                            {/* Categories */}
                                            <div className="flex gap-2 bg-gray-50 p-1.5 rounded-xl w-fit flex-wrap">
                                                <button type="button" onClick={() => { setFilterCategory('all'); setFilterSubCategory('all'); }} className={`px-4 py-2 rounded-lg text-xs font-bold transition-all ${filterCategory === 'all' ? 'bg-white shadow text-gray-900' : 'text-gray-500 hover:text-gray-700'}`}>All</button>
                                                {config.categories.map(c => (
                                                    <button type="button" key={c.id} onClick={() => { setFilterCategory(c.id); setFilterSubCategory('all'); }} className={`px-4 py-2 rounded-lg text-xs font-bold transition-all ${filterCategory === c.id ? 'bg-white shadow text-gray-900' : 'text-gray-500 hover:text-gray-700'}`}>{c.label}</button>
                                                ))}
                                            </div>

                                            {/* Subcategories (Dynamic) */}
                                            {config.subCategories[filterCategory] && (
                                                <div className="flex gap-2 animate-fade-in pl-2 flex-wrap">
                                                    <button type="button" onClick={() => setFilterSubCategory('all')} className={`px-3 py-1.5 rounded-lg border text-[11px] font-bold transition-all ${filterSubCategory === 'all' ? 'bg-blue-50 border-blue-200 text-blue-600' : 'bg-white border-gray-200 text-gray-500'}`}>All {filterCategory.split('-')[0]}</button>
                                                    {config.subCategories[filterCategory].map(s => (
                                                        <button type="button" key={s.id} onClick={() => setFilterSubCategory(s.id)} className={`px-3 py-1.5 rounded-lg border text-[11px] font-bold transition-all ${filterSubCategory === s.id ? 'bg-blue-50 border-blue-200 text-blue-600' : 'bg-white border-gray-200 text-gray-500'}`}>{s.label}</button>
                                                    ))}
                                                </div>
                                            )}
                                        </div>

                                        <div className="relative">
                                            <span className="absolute left-5 top-4 text-gray-400 text-lg">🔍</span>
                                            <input
                                                type="text"
                                                autoFocus
                                                className="w-full bg-gray-50 border-gray-200 rounded-2xl pl-14 pr-6 py-4 text-lg font-medium shadow-inner focus:ring-4 focus:ring-blue-500/10 focus:border-blue-500 outline-none transition-all placeholder-gray-400"
                                                placeholder="Search by name..."
                                                value={existingSearch}
                                                onChange={e => setExistingSearch(e.target.value)}
                                            />

                                            {(existingSearch || filterCategory !== 'all') && (
                                                <div className="absolute top-full left-0 right-0 mt-4 bg-white rounded-2xl shadow-xl border border-gray-100 overflow-hidden max-h-60 overflow-y-auto z-10">
                                                    {filteredExistingProducts.length > 0 ? filteredExistingProducts.map(p => (
                                                        <div
                                                            key={p.id}
                                                            onClick={() => handleSelectExisting(p)}
                                                            className="px-6 py-4 hover:bg-blue-50 cursor-pointer flex items-center justify-between group transition-colors border-b border-gray-50 last:border-0"
                                                        >
                                                            <div className="flex items-center gap-4">
                                                                <div className="w-10 h-10 bg-gray-100 rounded-lg flex items-center justify-center overflow-hidden">
                                                                    {p.image ? <img src={p.image} className="w-full h-full object-cover" alt="" /> : <span className="text-xs">IMG</span>}
                                                                </div>
                                                                <div>
                                                                    <div className="font-bold text-gray-800">{p.name}</div>
                                                                    <div className="text-[10px] text-gray-400 uppercase font-bold tracking-wide">{p.category} • {p.usage}</div>
                                                                </div>
                                                            </div>
                                                            <div className="text-xs text-blue-500 opacity-0 group-hover:opacity-100 font-bold uppercase tracking-wide">Select</div>
                                                        </div>
                                                    )) : (
                                                        <div className="p-8 text-center text-gray-400 text-sm font-medium">
                                                            No products found matching filters.
                                                        </div>
                                                    )}
                                                </div>
                                            )}
                                        </div>
                                    </div>
                                ) : (
                                    <div className="bg-blue-50 p-6 rounded-2xl border border-blue-100 flex items-center justify-between animate-pop-in">
                                        <div className="flex items-center gap-4">
                                            <div className="w-16 h-16 bg-white rounded-xl shadow-sm flex items-center justify-center p-1">
                                                <img src={selectedExistingProduct.image} className="w-full h-full object-contain mix-blend-multiply" alt="" />
                                            </div>
                                            <div>
                                                <div className="font-bold text-blue-900 text-lg">{selectedExistingProduct.name}</div>
                                                <div className="text-sm text-blue-600 font-medium">{INITIAL_CATEGORIES.find(c => c.id === selectedExistingProduct.category)?.label} • {selectedExistingProduct.usage}</div>
                                            </div>
                                        </div>
                                        <button onClick={() => setSelectedExistingProduct(null)} className="px-4 py-2 bg-white rounded-lg text-blue-600 font-bold text-sm shadow-sm hover:bg-blue-600 hover:text-white transition-colors">Change</button>
                                    </div>
                                )}
                            </div>

                            {/* Step 2: Configure Variant */}
                            {selectedExistingProduct && (
                                <div className="bg-white p-8 rounded-3xl border border-gray-100 shadow-lg shadow-gray-200/50 animate-slide-up">
                                    <h2 className="text-xl font-bold text-gray-900 mb-6">Select {selectedExistingProduct.category.includes('profile') ? 'Color' : 'Thickness'} & Pricing</h2>

                                    <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-8">
                                        {currentVariantsList.map(v => (
                                            <button key={v} type="button" onClick={() => setVariantToAdd(v)} className={`py-4 rounded-xl font-bold border-2 transition-all flex flex-col items-center gap-1 ${variantToAdd === v ? 'bg-gray-900 text-white border-gray-900 shadow-lg transform scale-105' : 'bg-white text-gray-500 border-gray-100 hover:border-gray-300'}`}>
                                                <span>{v}</span>
                                            </button>
                                        ))}
                                    </div>

                                    {/* Full Pricing for Variant */}
                                    <div className="pt-6 border-t border-gray-100 grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">

                                        {/* Conditional Stock Input for Variant - Dropdown + Qty logic */}
                                        {selectedExistingProduct.category === 'ke-profile' ? (
                                            <div className="md:col-span-1">
                                                <label className="block text-xs font-bold text-gray-400 uppercase tracking-wide mb-2">Length</label>
                                                <select
                                                    name="selectedLength"
                                                    value={variantPricing.selectedLength}
                                                    onChange={handleVariantPricingChange}
                                                    className="w-full bg-blue-50 border-blue-100 text-blue-900 rounded-xl px-4 py-3 font-bold focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 transition-all cursor-pointer shadow-sm"
                                                >
                                                    {KE_LENGTHS.map(length => (
                                                        <option key={length} value={length}>{length}ft</option>
                                                    ))}
                                                </select>
                                            </div>
                                        ) : null}

                                        <div>
                                            <label className="block text-xs font-bold text-gray-400 uppercase tracking-wide mb-2">Initial Quantity</label>
                                            <input type="number" name="initialStock" value={variantPricing.initialStock} onChange={handleVariantPricingChange} className="w-full bg-blue-50 border-blue-100 text-blue-900 rounded-xl px-4 py-3 font-bold focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 transition-all" placeholder="0" />
                                        </div>

                                        <div>
                                            <label className="block text-xs font-bold text-gray-400 uppercase tracking-wide mb-2">Price Full</label>
                                            <input type="number" name="priceFull" value={variantPricing.priceFull} onChange={handleVariantPricingChange} className="w-full bg-gray-50 border-gray-200 rounded-xl px-4 py-3 font-bold focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 transition-all" placeholder="0.00" />
                                        </div>
                                        <div>
                                            <label className="block text-xs font-bold text-gray-400 uppercase tracking-wide mb-2">Price Half</label>
                                            <input type="number" name="priceHalf" value={variantPricing.priceHalf} onChange={handleVariantPricingChange} className="w-full bg-gray-50 border-gray-200 rounded-xl px-4 py-3 font-bold focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 transition-all" placeholder="0.00" />
                                        </div>
                                        <div>
                                            <label className="block text-xs font-bold text-gray-400 uppercase tracking-wide mb-2">Price Unit</label>
                                            <input type="number" name="priceUnit" value={variantPricing.priceUnit} onChange={handleVariantPricingChange} className="w-full bg-gray-50 border-gray-200 rounded-xl px-4 py-3 font-bold focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 transition-all" placeholder="0.00" />
                                        </div>
                                    </div>
                                </div>
                            )}
                        </div>
                    )}


                    {/* Action Bar */}
                    <div className="fixed bottom-0 left-0 right-0 p-6 bg-white/90 backdrop-blur-md border-t border-gray-200 flex justify-center z-30">
                        <div className="w-full max-w-5xl flex justify-end gap-4">
                            <button type="button" className="px-8 py-4 bg-white border border-gray-200 text-gray-600 font-bold rounded-2xl hover:bg-gray-50 transition-all" onClick={() => window.history.back()}>Cancel</button>
                            <button type="submit" disabled={submitting || (mode === 'variant' && !variantToAdd)} className="px-10 py-4 bg-gray-900 text-white font-bold rounded-2xl hover:bg-black transition-all shadow-xl shadow-gray-900/20 flex items-center gap-2 disabled:opacity-50 disabled:shadow-none min-w-[200px] justify-center">
                                {submitting ? <span className="animate-pulse">Processing...</span> : <span>{mode === 'new' ? 'Create Product' : 'Add Variant'}</span>}
                            </button>
                        </div>
                    </div>

                </form>
            </div>

            {/* --- CONFIG MODAL (Admin) --- */}
            {configModalOpen && (
                <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-gray-900/60 backdrop-blur-sm animate-fade-in">
                    <div className="bg-white rounded-3xl shadow-2xl w-full max-w-lg overflow-hidden animate-pop-in">
                        <div className="p-6 border-b border-gray-100 flex justify-between items-center bg-gray-50">
                            <h3 className="text-xl font-bold text-gray-900">Manage Options</h3>
                            <button onClick={() => setConfigModalOpen(false)} className="text-gray-400 hover:text-gray-600 text-2xl">×</button>
                        </div>
                        <div className="flex border-b border-gray-100">
                            {/* Enhanced Tabs for Categories/Subcats */}
                            {['categories', 'subcats', 'colors', 'thickness'].map(tab => (
                                <button key={tab} onClick={() => setActiveConfigTab(tab)} className={`flex-1 py-3 font-bold text-xs ${activeConfigTab === tab ? 'text-blue-600 border-b-2 border-blue-600 bg-blue-50/50' : 'text-gray-500 hover:bg-gray-50'}`}>
                                    {tab === 'categories' ? 'Categories' : tab === 'subcats' ? 'Sub-Cats' : tab === 'colors' ? 'Colors' : 'Thicknesses'}
                                </button>
                            ))}
                        </div>
                        <div className="p-6 h-80 overflow-y-auto custom-scrollbar">
                            <div className="space-y-4">

                                {/* Sub-Cat Parent Selector */}
                                {activeConfigTab === 'subcats' && (
                                    <div className="mb-4">
                                        <label className="block text-xs font-bold text-gray-400 uppercase mb-2">Parent Category</label>
                                        <select
                                            value={selectedParentCategory}
                                            onChange={e => setSelectedParentCategory(e.target.value)}
                                            className="w-full bg-gray-50 border border-gray-200 rounded-xl px-3 py-2 text-sm font-bold"
                                        >
                                            {config.categories.map(c => (
                                                <option key={c.id} value={c.id}>{c.label}</option>
                                            ))}
                                        </select>
                                    </div>
                                )}

                                <div className="flex gap-2">
                                    <input id="newItemInput" type="text" className="flex-1 bg-gray-50 border border-gray-200 rounded-xl px-4 py-2 text-sm font-medium outline-none focus:border-blue-500" placeholder={`Add new ${activeConfigTab}...`} onKeyDown={e => e.key === 'Enter' && (handleAddConfigItem(e.target.value), e.target.value = '')} />
                                    <button onClick={() => { const el = document.getElementById('newItemInput'); handleAddConfigItem(el.value); el.value = ''; }} className="bg-blue-600 text-white px-4 rounded-xl font-bold text-sm hover:bg-blue-700">+</button>
                                </div>
                                <div className="grid grid-cols-2 gap-2">
                                    {/* Render Logic Based on Active Tab */}
                                    {(() => {
                                        let items = [];
                                        if (activeConfigTab === 'categories') items = config.categories;
                                        else if (activeConfigTab === 'subcats') items = config.subCategories[selectedParentCategory] || [];
                                        else if (activeConfigTab === 'colors') items = config.colors;
                                        else items = config.thicknesses;

                                        return items.map(item => {
                                            const label = typeof item === 'string' ? item : item.label;
                                            return (
                                                <div key={typeof item === 'string' ? item : item.id} className="flex items-center justify-between p-3 bg-white border border-gray-100 rounded-xl shadow-sm text-sm font-bold text-gray-700">
                                                    <span>{label}</span>
                                                    <button onClick={() => handleRemoveConfigItem(item, selectedParentCategory)} className="text-red-400 hover:text-red-600">×</button>
                                                </div>
                                            );
                                        });
                                    })()}
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}
