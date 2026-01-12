import { useState, useMemo, useEffect } from 'react';
import { useProducts } from '../context/ProductContext';
import ConfigModal from '../components/inventory/ConfigModal';

// --- Initial Data ---
// Dynamic Attributes Schema (Local defaults for the UI)
const INITIAL_ATTRIBUTES = {
    'Color': ['White', 'Silver', 'Gold', 'Bronze', 'Grey', 'Matt Black'],
    'Thickness': ['4mm', '5mm', '6mm', '8mm', '10mm', '12mm'],
    'Length': ['21ft', '17ft', '16ft', '15ft'],
    'Roll Type': ['Big Roll', 'Small Roll'],
    'Size': ['Standard', 'Large', 'Small']
};


export default function AddProductPage() {
    const { products, categories, addProduct, updateProduct, addCategory, addProductVariant } = useProducts();
    console.log("AddProductPage categories:", categories);

    // --- Config State (Editable by Admin) ---
    // Initialize categories from Context, others local for now
    const [config, setConfig] = useState({
        categories: categories,
        subCategories: {},
        attributes: INITIAL_ATTRIBUTES
    });

    // Sync categories from context if they change
    useEffect(() => {
        const subs = {};
        categories.forEach(c => {
            subs[c.id] = c.subCategories || [];
        });
        setConfig(prev => ({ ...prev, categories, subCategories: subs }));
    }, [categories]);

    const [configModalOpen, setConfigModalOpen] = useState(false);
    const [activeConfigTab, setActiveConfigTab] = useState('categories');
    const [selectedParentCategory, setSelectedParentCategory] = useState(categories[0]?.id || '');

    // Mode: 'new' | 'variant'
    const [mode, setMode] = useState('new');
    const [submitting, setSubmitting] = useState(false);

    // --- State for "New Product" ---
    const [hasVariants, setHasVariants] = useState(false); // Default Simple
    const [newProductData, setNewProductData] = useState({
        name: '',
        itemCode: '',
        category: 'ke-profile',
        subCategory: 'window',
        image: null,
        applicableAttributes: ['Color'],
        defaultAttributes: {},
        // Simple Product Fields
        stock: '',
        priceFull: '',
        priceHalf: '',
        priceFoot: '',
        length: '',
        trackOffcuts: false
    });

    // Valid values selected for the matrix generator
    // { 'Color': ['Silver', 'Gold'], 'Length': ['21ft'] }
    const [matrixSelections, setMatrixSelections] = useState({});

    // { "Silver - 21ft": { stock: 10, priceFull: 1000, ... } }
    const [matrixValues, setMatrixValues] = useState({});

    // --- State for "Existing Variant" ---

    const [filterCategory, setFilterCategory] = useState(() => {
        return (categories && categories.length > 0) ? categories[0].id : 'ke-profile';
    });
    const [filterSubCategory, setFilterSubCategory] = useState('window');

    // Auto-reset subcategory filter when category changes in "Add Variant" mode
    useEffect(() => {
        const validSubs = config.subCategories[filterCategory] || [];
        if (validSubs.length > 0) {
            setFilterSubCategory(validSubs[0].id);
        } else {
            setFilterSubCategory('');
        }
    }, [filterCategory, config.subCategories]);

    const [selectedExistingProduct, setSelectedExistingProduct] = useState(null);

    // Dynamic Variant Construction State (For "Add Variant" mode)
    const [variantSelections, setVariantSelections] = useState({});
    const [variantPricing, setVariantPricing] = useState({
        priceFull: '',
        priceHalf: '',
        priceUnit: '',
        initialStock: '',
    });

    // --- Derived: Inferred Attributes for Existing Product ---
    const activeProductAttributes = useMemo(() => {
        const p = mode === 'new' ? newProductData : selectedExistingProduct;
        if (!p) return [];

        if (mode === 'new') return newProductData.applicableAttributes;

        if (p.attributes) return Object.keys(p.attributes);
        if (p.applicableAttributes) return p.applicableAttributes;

        if (p.category.includes('profile')) return ['Color', 'Length'];
        if (p.category === 'glass') return ['Thickness'];
        if (p.category === 'accessories' && p.radius) return [];
        if (p.category === 'accessories') return [];
        return [];
    }, [mode, newProductData.applicableAttributes, selectedExistingProduct, newProductData.category]);

    // --- Derived: Matrix Preview (Cartesian Product) ---
    const matrixPreview = useMemo(() => {
        if (mode !== 'new' || newProductData.applicableAttributes.length === 0) return [];

        // For Accessories, we exclude 'Length' from the permutation generator
        // because we want to manually input it, not generate variants based on it.
        const generationAttributes = newProductData.category === 'accessories'
            ? newProductData.applicableAttributes.filter(a => a !== 'Length')
            : newProductData.applicableAttributes;

        if (generationAttributes.length === 0) return [];

        const potentialValues = generationAttributes.map(a => matrixSelections[a] || []);

        if (potentialValues.some(v => v.length === 0)) return [];

        if (potentialValues.length === 0) return [[]];

        const cartesian = (arrays) => {
            if (arrays.length === 0) return [[]];
            const [first, ...rest] = arrays;
            const restCart = cartesian(rest);
            return first.flatMap(f => restCart.map(r => [f, ...r]));
        };

        const combinations = cartesian(potentialValues);
        return combinations.map(combo => combo.join(' - '));

    }, [newProductData.applicableAttributes, matrixSelections, mode, newProductData.category]);

    // --- Handlers: New Product ---
    const handleNewChange = (e) => {
        const { name, value } = e.target;

        setNewProductData(prev => {
            const updates = { [name]: value };

            // Auto-toggle Track Offcuts for Accessories based on Length input
            if (name === 'length' && prev.category === 'accessories') {
                updates.trackOffcuts = !!value && value.trim() !== '';
            }
            // If checking specifically for 'attributes' logic, that's handled elsewhere.

            return { ...prev, ...updates };
        });
    };

    // Handler for Default Attributes
    const handleDefaultAttributeChange = (attrKey, value) => {
        const previousDefault = newProductData.defaultAttributes[attrKey];

        setNewProductData(prev => ({
            ...prev,
            defaultAttributes: {
                ...prev.defaultAttributes,
                [attrKey]: value
            }
        }));

        // Auto-select new default in Matrix (and deselect previous default)
        setMatrixSelections(prev => {
            const current = prev[attrKey] || [];
            let updated = [...current];

            // 1. Remove previous default if it exists in the selection
            if (previousDefault && previousDefault !== value) {
                updated = updated.filter(v => v !== previousDefault);
            }

            // 2. Add new value if available and not already selected
            if (value && !updated.includes(value)) {
                updated.push(value);
            }

            return {
                ...prev,
                [attrKey]: updated
            };
        });
    };

    const handleNewCategoryChange = (e) => {
        const cat = e.target.value;
        const defaultSub = config.subCategories[cat]?.[0]?.id || '';
        let defaults = [];
        if (cat.includes('profile')) defaults = ['Color', 'Length'];
        else if (cat === 'glass') defaults = ['Thickness'];

        setNewProductData(prev => ({
            ...prev,
            category: cat,
            subCategory: defaultSub,
            applicableAttributes: defaults,
            defaultAttributes: {} // Reset defaults on category change
        }));
        setMatrixSelections({});
        setMatrixValues({});
    };

    const toggleApplicableAttribute = (attrKey) => {
        setNewProductData(prev => {
            const has = prev.applicableAttributes.includes(attrKey);
            const nextAttrs = has
                ? prev.applicableAttributes.filter(a => a !== attrKey)
                : [...prev.applicableAttributes, attrKey];

            const nextDefaults = { ...prev.defaultAttributes };
            if (has) {
                // If removing attribute, remove its default too
                delete nextDefaults[attrKey];
                const nextMatrix = { ...matrixSelections };
                delete nextMatrix[attrKey];
                setMatrixSelections(nextMatrix);
            }
            // Logic to initialize matrixSelections if needed can go here, but usually empty initially

            return {
                ...prev,
                applicableAttributes: nextAttrs,
                defaultAttributes: nextDefaults
            };
        });
    };

    const toggleMatrixValue = (attrKey, value) => {
        setMatrixSelections(prev => {
            const current = prev[attrKey] || [];
            const has = current.includes(value);
            return {
                ...prev,
                [attrKey]: has ? current.filter(v => v !== value) : [...current, value]
            };
        });
    };

    const handleMatrixValueChange = (variantName, field, value) => {
        setMatrixValues(prev => ({
            ...prev,
            [variantName]: {
                ...(prev[variantName] || {}),
                [field]: value
            }
        }));

        // Auto-toggle Track Offcuts
        if (field === 'length' && newProductData.category === 'accessories') {
            const hasLength = !!value && value.trim() !== '';
            // Only update main state if it differs to avoid loops (though React handles equality check usually)
            setNewProductData(prev => {
                if (prev.trackOffcuts !== hasLength) {
                    return { ...prev, trackOffcuts: hasLength };
                }
                return prev;
            });
        }
    };

    // --- Handlers: Existing Variant ---
    const filteredExistingProducts = useMemo(() => {
        return products.filter(p =>
            p.category === filterCategory &&
            (p.subCategory === filterSubCategory || (!p.subCategory && filterSubCategory === 'general'))
        );
    }, [products, filterCategory, filterSubCategory]);

    const handleSelectExisting = (product) => {
        setSelectedExistingProduct(product);
        setVariantSelections({});
        // User requested NO initial amounts, so we start blank
        setVariantPricing({ priceFull: '', priceHalf: '', priceUnit: '', initialStock: '' });
    };

    const handleVariantSelection = (attrKey, value) => {
        setVariantSelections(prev => ({ ...prev, [attrKey]: value }));
    };

    const handlePricingChange = (e) => {
        const { name, value } = e.target;
        setVariantPricing(prev => ({ ...prev, [name]: value }));
    };

    // --- Handlers: Config ---
    const handleAddConfigItem = (newItem) => {
        if (!newItem) return;

        if (activeConfigTab === 'categories') {
            const newId = newItem.toLowerCase().replace(/\s+/g, '-');
            // Update Context
            addCategory({ id: newId, label: newItem, icon: '📦' });
            // Config update handled by useEffect
        } else if (activeConfigTab === 'subcats') {
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
        } else {
            // Dynamic Attributes
            setConfig(prev => ({
                ...prev,
                attributes: {
                    ...prev.attributes,
                    [activeConfigTab]: [
                        ...(prev.attributes[activeConfigTab] || []),
                        newItem
                    ]
                }
            }));
        }
    };

    // NEW: Handle adding a whole new Attribute Category (e.g. "Fabric")
    const handleAddAttributeCategory = (newCategoryName) => {
        if (!newCategoryName || config.attributes[newCategoryName]) return;

        setConfig(prev => ({
            ...prev,
            attributes: {
                ...prev.attributes,
                [newCategoryName]: []
            }
        }));
        setActiveConfigTab(newCategoryName);
    };

    const handleRemoveConfigItem = (itemToRemove, parentId = null) => {
        if (activeConfigTab === 'categories') {
            // Not implemented in context yet
            setConfig(prev => ({
                ...prev,
                categories: prev.categories.filter(c => c.id !== itemToRemove.id)
            }));
        } else if (activeConfigTab === 'subcats') {
            setConfig(prev => ({
                ...prev,
                subCategories: {
                    ...prev.subCategories,
                    [parentId]: prev.subCategories[parentId].filter(s => s.id !== itemToRemove.id)
                }
            }));
        } else {
            setConfig(prev => ({
                ...prev,
                attributes: {
                    ...prev.attributes,
                    [activeConfigTab]: prev.attributes[activeConfigTab].filter(v => v !== itemToRemove)
                }
            }));
        }
    };

    const handleSubmit = (e) => {
        e.preventDefault();
        setSubmitting(true);

        setTimeout(() => {
            if (mode === 'new') {
                let finalProduct = {};

                if (hasVariants) {
                    const variantCount = matrixPreview.length;
                    if (variantCount === 0) {
                        alert("Please generate at least one variant.");
                        setSubmitting(false);
                        return;
                    }

                    // Construct Variants Array
                    const variants = matrixPreview.map(name => {
                        const vals = matrixValues[name] || {};
                        const parts = name.split(' - ');
                        const attrs = {};
                        newProductData.applicableAttributes.forEach((key, i) => {
                            attrs[key] = parts[i];
                        });

                        return {
                            id: `v-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
                            name: name,
                            attributes: attrs,
                            price: parseFloat(vals.priceFull || 0),
                            stock: parseInt(vals.stock || 0),
                            details: {
                                priceFull: parseFloat(vals.priceFull || 0),
                                priceHalf: parseFloat(vals.priceHalf || 0),
                                priceUnit: parseFloat(vals.priceUnit || 0),
                            },
                            // Parse length from attributes if available, else from manual input
                            length: attrs['Length'] ? parseFloat(attrs['Length']) : (vals.length ? parseFloat(vals.length) : null)
                        };
                    });

                    finalProduct = {
                        id: `p-${Date.now()}`,
                        ...newProductData,
                        attributes: matrixSelections,
                        variants: variants,
                        stock: 0, // Explicitly 0 for variable products (Backend sums variants)
                        priceFull: 0,
                        priceHalf: 0,
                        priceFoot: 0,
                        image: 'https://placehold.co/300x200/555555/FFFFFF?text=New+Product'
                    };

                    alert(`Product Created: ${newProductData.name}\n${variants.length} Variants Generated.`);
                } else {
                    // Simple Product
                    finalProduct = {
                        id: `p-${Date.now()}`,
                        ...newProductData,
                        variants: [],
                        stock: parseInt(newProductData.stock || 0),
                        priceFull: parseFloat(newProductData.priceFull || 0),
                        priceHalf: parseFloat(newProductData.priceHalf || 0),
                        priceFoot: parseFloat(newProductData.priceFoot || 0),
                        attributes: {},
                        image: 'https://placehold.co/300x200/555555/FFFFFF?text=Simple+Product'
                    };
                    alert(`Product Created: ${newProductData.name}`);
                }

                addProduct(finalProduct);

                setNewProductData(prev => ({
                    name: '', itemCode: '', category: 'ke-profile', subCategory: 'window',
                    stock: '', priceFull: '', priceHalf: '', priceFoot: '', defaultAttributes: {}, applicableAttributes: ['Color']
                }));
                setMatrixSelections({});
                setMatrixValues({});
            } else {
                // ADD VARIANT TO EXISTING
                const updatedProduct = { ...selectedExistingProduct };

                const variantName = Object.values(variantSelections).join(' - ');
                const lengthVal = variantSelections['Length'] ? parseFloat(variantSelections['Length']) : (variantPricing.length ? parseFloat(variantPricing.length) : null);

                const newVariant = {
                    id: `v-${Date.now()}`,
                    attributes: { ...variantSelections },
                    price: parseFloat(variantPricing.priceFull || 0),
                    stock: parseInt(variantPricing.initialStock || 0),
                    details: {
                        priceFull: parseFloat(variantPricing.priceFull || 0),
                        priceHalf: parseFloat(variantPricing.priceHalf || 0),
                        priceUnit: parseFloat(variantPricing.priceUnit || 0),
                    },
                    length: lengthVal
                };

                if (!updatedProduct.variants) updatedProduct.variants = [];
                updatedProduct.variants.push(newVariant);

                // Auto-toggle Track Offcuts if length provided for accessories/profiles
                if (lengthVal && (updatedProduct.category === 'accessories' || updatedProduct.category.includes('profile'))) {
                    updatedProduct.trackOffcuts = true;
                }

                // Also update attributes map to include new values if they weren't there?
                // For simplified scope, assuming attributes map already exists or we just rely on variants list.

                updateProduct(updatedProduct);

                alert(`Variant Added!\n${selectedExistingProduct.name}\nVariant: ${variantName}`);
                setSelectedExistingProduct(null);
                setVariantSelections({});
                setVariantPricing({ priceFull: '', priceHalf: '', priceUnit: '', initialStock: '' });
            }
            setSubmitting(false);
        }, 800);
    };

    const isVariantComplete = useMemo(() => {
        if (!selectedExistingProduct) return false;

        // 1. All Attributes Selected
        const attrsComplete = activeProductAttributes.every(attr => variantSelections[attr]);

        // 2. Pricing & Stock Filled (Compulsory)
        const pricingComplete =
            variantPricing.initialStock !== '' &&
            variantPricing.priceFull !== '' &&
            variantPricing.priceHalf !== '' &&
            variantPricing.priceUnit !== '';

        return attrsComplete && pricingComplete;
    }, [activeProductAttributes, variantSelections, selectedExistingProduct, variantPricing]);


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
                    <button onClick={() => setConfigModalOpen(true)} className="px-4 py-2.5 rounded-xl border border-gray-200 bg-white text-gray-600 font-bold text-sm hover:bg-gray-50 flex items-center gap-2"><span>⚙️ Manage Options</span></button>
                    <div className="bg-gray-100 p-1 rounded-xl flex font-bold text-sm">
                        <button onClick={() => setMode('new')} className={`px-6 py-2.5 rounded-lg transition-all ${mode === 'new' ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-700'}`}>New Product</button>
                        <button onClick={() => setMode('variant')} className={`px-6 py-2.5 rounded-lg transition-all ${mode === 'variant' ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-700'}`}>Add Variant</button>
                    </div>
                </div>
            </header>

            {/* Content */}
            <div className="p-8 max-w-5xl mx-auto w-full pb-20">
                <form onSubmit={handleSubmit} className="space-y-8 animate-fade-in">


                    {/* === MODE: NEW PRODUCT === */}
                    {mode === 'new' && (
                        <div className="flex flex-col gap-8">

                            {/* Product Type Toggle */}
                            <div className="flex justify-center">
                                <div className="bg-gray-100 p-1.5 rounded-xl flex font-bold text-sm shadow-inner">
                                    <button type="button" onClick={() => setHasVariants(false)} className={`px-8 py-2.5 rounded-lg transition-all flex items-center gap-2 ${!hasVariants ? 'bg-white text-gray-900 shadow-sm ring-1 ring-gray-200' : 'text-gray-500 hover:text-gray-700'}`}>
                                        <span>📦</span> Simple Product
                                    </button>
                                    <button type="button" onClick={() => setHasVariants(true)} className={`px-8 py-2.5 rounded-lg transition-all flex items-center gap-2 ${hasVariants ? 'bg-white text-gray-900 shadow-sm ring-1 ring-gray-200' : 'text-gray-500 hover:text-gray-700'}`}>
                                        <span>🧩</span> Variable Product
                                    </button>
                                </div>
                            </div>

                            <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
                                {/* 1. Core Info (Left Top - Spans Full on Simple) */}
                                <div className={`lg:col-span-2 ${!hasVariants ? 'lg:col-span-3' : ''} bg-white p-8 rounded-3xl border border-gray-100 shadow-sm`}>
                                    <h2 className="text-lg font-bold text-gray-900 mb-6 flex items-center gap-3">
                                        <span className="w-8 h-8 rounded-full bg-blue-50 text-blue-600 flex items-center justify-center font-bold text-sm">1</span>
                                        Core Details
                                    </h2>
                                    <div className="space-y-6">
                                        <div>
                                            <label className="block text-xs font-bold text-gray-400 uppercase tracking-wide mb-2">Product Name</label>
                                            <input required type="text" name="name" value={newProductData.name} onChange={handleNewChange} className="w-full bg-gray-50 border-gray-200 rounded-xl px-4 py-3 font-bold focus:ring-2 focus:border-blue-500 transition-all" placeholder="e.g. Heavy Duty Sliding Track" />
                                        </div>
                                        <div>
                                            <label className="block text-xs font-bold text-gray-400 uppercase tracking-wide mb-2">Item Code <span className="text-gray-300 font-medium normal-case">(Max 5)</span></label>
                                            <input type="text" name="itemCode" maxLength={5} value={newProductData.itemCode || ''} onChange={handleNewChange} className="w-32 bg-gray-50 border-gray-200 rounded-xl px-4 py-3 font-medium text-gray-700 focus:ring-2 focus:border-blue-500 transition-all text-center tracking-widest uppercase" placeholder="XXXXX" />
                                        </div>
                                        <div className="grid grid-cols-2 gap-6">
                                            <div>
                                                <label className="block text-xs font-bold text-gray-400 uppercase tracking-wide mb-2">Category</label>
                                                <select name="category" value={newProductData.category} onChange={handleNewCategoryChange} className="w-full bg-gray-50 border-gray-200 rounded-xl px-4 py-3 font-medium focus:ring-2 focus:border-blue-500 transition-all cursor-pointer">
                                                    {categories.map(c => <option key={c.id} value={c.id}>{c.label}</option>)}
                                                </select>
                                            </div>
                                            <div>
                                                <label className="block text-xs font-bold text-gray-400 uppercase tracking-wide mb-2">Sub-Category</label>
                                                <select name="subCategory" value={newProductData.subCategory} onChange={handleNewChange} className="w-full bg-gray-50 border-gray-200 rounded-xl px-4 py-3 font-medium focus:ring-2 focus:border-blue-500 transition-all cursor-pointer">
                                                    {config.subCategories[newProductData.category]?.map(sub => <option key={sub.id} value={sub.id}>{sub.label}</option>)}
                                                </select>
                                            </div>
                                        </div>

                                    </div>

                                    {/* Track Offcuts for Variable Products (or global) */}
                                    {hasVariants && (
                                        <div className="mt-4 pt-4 border-t border-gray-100 flex items-center">
                                            <label className="flex items-center cursor-pointer gap-3">
                                                <div className="relative">
                                                    <input type="checkbox" name="trackOffcuts" checked={newProductData.trackOffcuts} onChange={(e) => setNewProductData(prev => ({ ...prev, trackOffcuts: e.target.checked }))} className="sr-only peer" />
                                                    <div className="w-11 h-6 bg-gray-200 peer-focus:outline-none peer-focus:ring-4 peer-focus:ring-blue-300 rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-blue-600"></div>
                                                </div>
                                                <span className="text-xs font-bold text-gray-500 uppercase">Track Offcuts (Apply to all variants)</span>
                                            </label>
                                        </div>
                                    )}

                                    {/* SIMPLE PRODUCT PRICING & STOCK */}
                                    {!hasVariants && (
                                        <div className="mt-8 pt-8 border-t border-gray-100 animate-fade-in">
                                            <h3 className="text-sm font-bold text-gray-900 mb-6 flex items-center gap-2">
                                                <span className="text-xl">💲</span> Pricing & Inventory
                                            </h3>
                                            <div className="grid grid-cols-2 md:grid-cols-4 gap-6">
                                                <div>
                                                    <label className="block text-xs font-bold text-blue-500 uppercase tracking-wide mb-2">Initial Stock</label>
                                                    <input type="number" name="stock" value={newProductData.stock} onChange={handleNewChange} className="w-full bg-blue-50/50 border-blue-100 text-blue-900 rounded-xl px-4 py-3 font-bold focus:ring-2 focus:border-blue-500 focus:bg-white transition-all shadow-sm" placeholder="0" />
                                                </div>
                                                <div>
                                                    <label className="block text-xs font-bold text-gray-400 uppercase tracking-wide mb-2">Price (Full)</label>
                                                    <input type="number" name="priceFull" value={newProductData.priceFull} onChange={handleNewChange} className="w-full bg-gray-50 border-gray-200 rounded-xl px-4 py-3 font-bold focus:ring-2 focus:border-blue-500 transition-all" placeholder="0.00" />
                                                </div>
                                                {newProductData.trackOffcuts && (
                                                    <>
                                                        <div>
                                                            <label className="block text-xs font-bold text-gray-400 uppercase tracking-wide mb-2">Price (Half)</label>
                                                            <input type="number" name="priceHalf" value={newProductData.priceHalf} onChange={handleNewChange} className="w-full bg-gray-50 border-gray-200 rounded-xl px-4 py-3 font-bold focus:ring-2 focus:border-blue-500 transition-all" placeholder="0.00" />
                                                        </div>
                                                        <div>
                                                            <label className="block text-xs font-bold text-gray-400 uppercase tracking-wide mb-2">Price (Unit/Ft)</label>
                                                            <input type="number" name="priceFoot" value={newProductData.priceFoot} onChange={handleNewChange} className="w-full bg-gray-50 border-gray-200 rounded-xl px-4 py-3 font-bold focus:ring-2 focus:border-blue-500 transition-all" placeholder="0.00" />
                                                        </div>
                                                    </>
                                                )}

                                                {/* Optional Length for Simple Products */}
                                                {(newProductData.category.includes('profile') || newProductData.category === 'accessories') && (
                                                    <div>
                                                        <label className="block text-xs font-bold text-gray-400 uppercase tracking-wide mb-2">Length (Optional)</label>
                                                        <input type="number" step="0.1" name="length" value={newProductData.length} onChange={handleNewChange} className="w-full bg-gray-50 border-gray-200 rounded-xl px-4 py-3 font-bold focus:ring-2 focus:border-blue-500 transition-all" placeholder="e.g. 6.0" />
                                                    </div>
                                                )}

                                                {/* Track Offcuts Toggle */}
                                                <div className="flex items-center">
                                                    <label className="flex items-center cursor-pointer gap-3">
                                                        <div className="relative">
                                                            <input type="checkbox" name="trackOffcuts" checked={newProductData.trackOffcuts} onChange={(e) => setNewProductData(prev => ({ ...prev, trackOffcuts: e.target.checked }))} className="sr-only peer" />
                                                            <div className="w-11 h-6 bg-gray-200 peer-focus:outline-none peer-focus:ring-4 peer-focus:ring-blue-300 rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-blue-600"></div>
                                                        </div>
                                                        <span className="text-xs font-bold text-gray-500 uppercase">Track Offcuts</span>
                                                    </label>
                                                </div>
                                            </div>
                                        </div>
                                    )}
                                </div>
                                {/* Variable Product Attributes */}
                                {hasVariants && (
                                    <>
                                        <div className="lg:col-span-1 lg:row-span-2 space-y-8 animate-fade-in">
                                            <div className="bg-white p-8 rounded-3xl border border-gray-100 shadow-sm">
                                                <h2 className="text-lg font-bold text-gray-900 mb-6 flex items-center gap-3">
                                                    <span className="w-8 h-8 rounded-full bg-purple-50 text-purple-600 flex items-center justify-center font-bold text-sm">2</span>
                                                    Defining Attributes
                                                </h2>
                                                <div className="space-y-3">
                                                    {Object.keys(config.attributes).map(attrKey => {
                                                        const isSelected = newProductData.applicableAttributes.includes(attrKey);
                                                        return (
                                                            <div key={attrKey} className={`p-4 rounded-xl border-2 transition-all flex flex-col gap-3 group ${isSelected ? 'border-purple-500 bg-purple-50/50' : 'border-gray-100 hover:border-purple-200'}`}>
                                                                <div onClick={() => toggleApplicableAttribute(attrKey)} className="flex items-center justify-between cursor-pointer">
                                                                    <span className={`font-bold ${isSelected ? 'text-purple-700' : 'text-gray-600'}`}>{attrKey}</span>
                                                                    <div className={`w-5 h-5 rounded-md border flex items-center justify-center transition-colors ${isSelected ? 'bg-purple-500 border-purple-500' : 'border-gray-300 bg-white'}`}>
                                                                        {isSelected && <svg className="w-3 h-3 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="3" d="M5 13l4 4L19 7"></path></svg>}
                                                                    </div>
                                                                </div>
                                                                {isSelected && attrKey !== 'Color' && (
                                                                    <div className="mt-1 pl-1">
                                                                        <label className="text-[10px] font-bold text-gray-500 uppercase mb-1 block">Default {attrKey}</label>
                                                                        <select className="w-full text-xs font-semibold bg-white border border-gray-200 rounded-lg py-1.5 px-2 text-gray-700 focus:outline-none focus:border-purple-500 cursor-pointer" value={newProductData.defaultAttributes[attrKey] || ''} onChange={(e) => handleDefaultAttributeChange(attrKey, e.target.value)} onClick={(e) => e.stopPropagation()}>
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
                                        </div>

                                        {/* 3. Matrix Generator */}
                                        {newProductData.applicableAttributes.length > 0 && (
                                            <div className="lg:col-span-2 bg-white p-8 rounded-3xl border border-gray-100 shadow-sm animate-slide-up">
                                                <h2 className="text-lg font-bold text-gray-900 mb-6 flex items-center gap-3">
                                                    <span className="w-8 h-8 rounded-full bg-emerald-50 text-emerald-600 flex items-center justify-center font-bold text-sm">3</span>
                                                    Generate Variants
                                                </h2>
                                                <div className="space-y-6">
                                                    <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                                                        {newProductData.applicableAttributes
                                                            .filter(attr => !(newProductData.category === 'accessories' && attr === 'Length'))
                                                            .map(attrKey => (
                                                                <div key={attrKey} className="bg-gray-50 p-4 rounded-xl">
                                                                    <h3 className="text-xs font-bold text-gray-900 uppercase mb-3">{attrKey} Values</h3>
                                                                    <div className="flex flex-wrap gap-2">
                                                                        {config.attributes[attrKey]?.map(val => {
                                                                            const isSelected = (matrixSelections[attrKey] || []).includes(val);
                                                                            return (<button key={val} type="button" onClick={() => toggleMatrixValue(attrKey, val)} className={`px-3 py-1.5 rounded-lg text-xs font-bold border transition-all ${isSelected ? 'bg-emerald-500 border-emerald-500 text-white shadow-sm' : 'bg-white border-gray-200 text-gray-600 hover:border-gray-300'}`}>{val}</button>)
                                                                        })}
                                                                    </div>
                                                                </div>
                                                            ))}
                                                    </div>

                                                    {/* Matrix Items */}
                                                    {matrixPreview.length > 0 ? (
                                                        <div className="bg-emerald-50/50 border border-emerald-100 rounded-xl p-4">
                                                            <div className="max-h-80 overflow-y-auto custom-scrollbar space-y-2">
                                                                {matrixPreview.map((name) => (
                                                                    <div key={name} className="bg-white p-3 rounded-xl border border-emerald-100/50 shadow-sm flex flex-col md:flex-row md:items-center gap-4">
                                                                        <div className="md:w-1/4 flex items-center gap-2">
                                                                            <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 shrink-0"></span>
                                                                            <span className="text-sm font-bold text-gray-700 truncate" title={name}>{name}</span>
                                                                        </div>
                                                                        <div className="flex-1 grid grid-cols-2 md:grid-cols-5 gap-2">
                                                                            {['stock', 'priceFull', ...(newProductData.trackOffcuts ? ['priceHalf', 'priceUnit'] : []), ...(newProductData.category === 'accessories' && newProductData.applicableAttributes.includes('Length') ? ['length'] : [])].map(field => (
                                                                                <div key={field}>
                                                                                    <label className="block text-[10px] text-gray-400 font-bold uppercase mb-1">{field}</label>
                                                                                    <input type="number" className="w-full bg-gray-50 border-gray-200 rounded-lg px-2 py-1.5 text-xs font-bold focus:border-emerald-500 text-gray-700" value={matrixValues[name]?.[field] || ''} onChange={(e) => handleMatrixValueChange(name, field, e.target.value)} />
                                                                                </div>
                                                                            ))}
                                                                        </div>
                                                                    </div>
                                                                ))}
                                                            </div>
                                                        </div>
                                                    ) : (<div className="text-center py-4 text-gray-400 text-xs italic bg-gray-50 rounded-xl border border-dashed border-gray-200">Select values to generate.</div>)}

                                                </div>
                                            </div>
                                        )}
                                    </>
                                )}


                                {/* 4. Product Images */}
                                <div className="lg:col-span-3 bg-white p-8 rounded-3xl border border-gray-100 shadow-sm animate-slide-up">
                                    <h2 className="text-lg font-bold text-gray-900 mb-6 flex items-center gap-3">
                                        <span className="w-8 h-8 rounded-full bg-orange-50 text-orange-600 flex items-center justify-center font-bold text-sm">4</span>
                                        Product Images
                                    </h2>
                                    <div className="border-2 border-dashed border-gray-200 rounded-2xl p-8 flex flex-col items-center justify-center text-center hover:border-orange-300 hover:bg-orange-50/10 transition-all cursor-pointer group">
                                        <div className="w-16 h-16 bg-gray-50 rounded-full flex items-center justify-center text-3xl mb-4 group-hover:scale-110 transition-transform">📸</div>
                                        <h3 className="text-sm font-bold text-gray-900 mb-1">Upload Product Image</h3>
                                        <p className="text-xs text-gray-400 mb-4">PNG, JPG up to 5MB</p>
                                        <input type="file" className="hidden" id="image-upload" onChange={(e) => {
                                            const file = e.target.files[0];
                                            if (file) {
                                                const reader = new FileReader();
                                                reader.onload = (ev) => setNewProductData(prev => ({ ...prev, image: ev.target.result }));
                                                reader.readAsDataURL(file);
                                            }
                                        }} />
                                        <label htmlFor="image-upload" className="px-6 py-2 bg-white border border-gray-200 rounded-xl text-xs font-bold text-gray-700 shadow-sm hover:bg-gray-50 cursor-pointer">
                                            Choose File
                                        </label>
                                        {newProductData.image && (
                                            <div className="mt-6 relative w-32 h-32 rounded-xl overflow-hidden border border-gray-200 shadow-sm">
                                                <img src={newProductData.image} alt="Preview" className="w-full h-full object-cover" />
                                                <button onClick={(e) => { e.preventDefault(); setNewProductData(prev => ({ ...prev, image: null })); }} className="absolute top-1 right-1 bg-white/90 text-red-500 rounded-full p-1 hover:bg-red-50">
                                                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M6 18L18 6M6 6l12 12"></path></svg>
                                                </button>
                                            </div>
                                        )}
                                    </div>
                                </div>



                            </div>
                        </div>

                    )}



                    {/* === MODE: EXISTING VARIANT === */}
                    {mode === 'variant' && (
                        <div className="max-w-4xl mx-auto space-y-8">
                            <div className="bg-white p-8 rounded-3xl border border-gray-100 shadow-lg shadow-gray-200/50">
                                <h2 className="text-xl font-bold text-gray-900 mb-6">1. Find Existing Product</h2>
                                {!selectedExistingProduct ? (
                                    <div className="space-y-6">
                                        <div className="flex flex-col gap-4">
                                            {/* Filters - Matching AdminProductsPage */}
                                            <div className="flex gap-2 w-full overflow-x-auto pb-1 scrollbar-hide border-b border-gray-100 pb-4">
                                                {categories.map(cat => (
                                                    <button
                                                        key={cat.id}
                                                        onClick={() => setFilterCategory(cat.id)}
                                                        type="button"
                                                        className={`px-4 py-2 rounded-lg text-sm font-bold transition-all whitespace-nowrap ${filterCategory === cat.id ? 'bg-gray-900 text-white shadow-lg shadow-gray-900/20' : 'bg-gray-100/50 text-gray-500 hover:bg-gray-100 border border-gray-100'}`}
                                                    >
                                                        {cat.label}
                                                    </button>
                                                ))}
                                            </div>

                                            <div className="flex gap-2 w-full overflow-x-auto pb-2 scrollbar-hide">
                                                {(config.subCategories[filterCategory] || []).map(u => (
                                                    <button
                                                        key={u.id}
                                                        onClick={() => setFilterSubCategory(u.id)}
                                                        type="button"
                                                        className={`flex-none px-4 py-2 rounded-lg text-xs font-bold uppercase tracking-wider transition-all whitespace-nowrap ${filterSubCategory === u.id ? 'bg-blue-100 text-blue-700 ring-1 ring-blue-200' : 'bg-gray-50 text-gray-400 hover:bg-gray-100'}`}
                                                    >
                                                        {u.label}
                                                    </button>
                                                ))}
                                            </div>

                                            {/* Product Grid */}
                                            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 mt-4 max-h-[400px] overflow-y-auto custom-scrollbar p-1">
                                                {filteredExistingProducts.length === 0 ? (
                                                    <div className="col-span-full py-12 text-center text-gray-400 italic bg-gray-50 rounded-xl border border-dashed border-gray-200">
                                                        No products found.
                                                    </div>
                                                ) : (
                                                    filteredExistingProducts.map(p => (
                                                        <div
                                                            key={p.id}
                                                            onClick={() => handleSelectExisting(p)}
                                                            className="flex flex-col p-4 bg-white border border-gray-100 rounded-2xl hover:border-blue-300 hover:shadow-lg hover:shadow-blue-500/10 transition-all cursor-pointer group"
                                                        >
                                                            <div className="flex justify-between items-start mb-2">
                                                                <div className="w-10 h-10 bg-gray-50 rounded-lg p-1 group-hover:bg-blue-50 transition-colors">
                                                                    <img src={p.image} alt={p.name} className="w-full h-full object-contain mix-blend-multiply opacity-50 group-hover:opacity-100 transition-opacity" />
                                                                </div>
                                                                <span className="text-[10px] font-bold uppercase tracking-wider text-gray-400 bg-gray-50 px-2 py-0.5 rounded-full">{p.category}</span>
                                                            </div>
                                                            <div className="font-bold text-gray-800 group-hover:text-blue-700 transition-colors line-clamp-2">{p.name}</div>
                                                            <div className="text-xs text-gray-400 mt-1">{p.variants?.length || 0} existing variants</div>
                                                        </div>
                                                    ))
                                                )}
                                            </div>
                                        </div>
                                    </div>
                                ) : (
                                    <div className="bg-blue-50 p-6 rounded-2xl border border-blue-100 flex items-center justify-between animate-pop-in">
                                        <div>
                                            <div className="font-bold text-blue-900 text-lg">{selectedExistingProduct.name}</div>
                                            <div className="text-sm text-blue-600 font-medium">Adding stock/variants</div>
                                        </div>
                                        <button onClick={() => setSelectedExistingProduct(null)} className="px-4 py-2 bg-white rounded-lg text-blue-600 font-bold text-sm shadow-sm hover:bg-blue-100">Change</button>
                                    </div>
                                )}
                            </div>

                            {selectedExistingProduct && (
                                <div className="bg-white p-8 rounded-3xl border border-gray-100 shadow-lg shadow-gray-200/50 animate-slide-up">
                                    <h2 className="text-xl font-bold text-gray-900 mb-6">2. Configure Variant</h2>
                                    <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-8">
                                        {activeProductAttributes.length > 0 ? (
                                            activeProductAttributes.map(attrKey => (
                                                <div key={attrKey} className="space-y-3">
                                                    <label className="text-xs font-bold text-gray-400 uppercase tracking-wide">{attrKey}</label>
                                                    <div className="flex flex-wrap gap-2">
                                                        {config.attributes[attrKey]?.map(val => (
                                                            <button
                                                                key={val}
                                                                type="button"
                                                                onClick={() => handleVariantSelection(attrKey, val)}
                                                                className={`px-4 py-2 rounded-lg text-sm font-bold border transition-all ${variantSelections[attrKey] === val ? 'bg-gray-900 text-white border-gray-900 shadow-md' : 'bg-white text-gray-600 border-gray-200 hover:border-gray-300'}`}
                                                            >
                                                                {val}
                                                            </button>
                                                        ))}
                                                    </div>
                                                </div>
                                            ))
                                        ) : (
                                            <div className="col-span-2 text-gray-400 text-sm italic">Standard product with no specific attributes.</div>
                                        )}
                                    </div>

                                    <div className="mt-8 bg-gradient-to-br from-gray-50 to-blue-50/50 p-6 rounded-2xl border border-blue-100">
                                        <h3 className="text-sm font-bold text-blue-900 mb-4 flex items-center gap-2">
                                            <span className="w-6 h-6 rounded-full bg-blue-100 text-blue-600 flex items-center justify-center text-xs">💲</span>
                                            Stock & Pricing Details
                                        </h3>
                                        <div className="grid grid-cols-2 md:grid-cols-4 gap-5">
                                            <div>
                                                <label className="block text-[10px] font-bold text-gray-400 uppercase mb-1">Stock Qty</label>
                                                <input type="number" name="initialStock" value={variantPricing.initialStock} onChange={handlePricingChange} className="w-full bg-white border-gray-200 text-gray-900 rounded-xl px-3 py-2.5 font-bold focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20 shadow-sm" placeholder="0" />
                                            </div>
                                            <div>
                                                <label className="block text-[10px] font-bold text-blue-400 uppercase mb-1">Price (Full)</label>
                                                <input type="number" name="priceFull" value={variantPricing.priceFull} onChange={handlePricingChange} className="w-full bg-white border-blue-200 text-gray-900 rounded-xl px-3 py-2.5 font-bold focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20 shadow-sm" placeholder="0.00" />
                                            </div>
                                            {selectedExistingProduct.trackOffcuts && (
                                                <>
                                                    <div>
                                                        <label className="block text-[10px] font-bold text-gray-400 uppercase mb-1">Price (Half)</label>
                                                        <input type="number" name="priceHalf" value={variantPricing.priceHalf} onChange={handlePricingChange} className="w-full bg-white border-gray-200 text-gray-900 rounded-xl px-3 py-2.5 font-bold focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20 shadow-sm" placeholder="0.00" />
                                                    </div>
                                                    <div>
                                                        <label className="block text-[10px] font-bold text-gray-400 uppercase mb-1">Price (Unit)</label>
                                                        <input type="number" name="priceUnit" value={variantPricing.priceUnit} onChange={handlePricingChange} className="w-full bg-white border-gray-200 text-gray-900 rounded-xl px-3 py-2.5 font-bold focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20 shadow-sm" placeholder="0.00" />
                                                    </div>
                                                </>
                                            )}
                                            {(selectedExistingProduct.category === 'accessories' && activeProductAttributes.includes('Length')) && (
                                                <div>
                                                    <label className="block text-[10px] font-bold text-gray-400 uppercase mb-1">Length</label>
                                                    <input type="number" step="0.1" name="length" value={variantPricing.length || ''} onChange={handlePricingChange} className="w-full bg-white border-gray-200 text-gray-900 rounded-xl px-3 py-2.5 font-bold focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20 shadow-sm" placeholder="e.g 6.0" />
                                                </div>
                                            )}
                                        </div>
                                    </div>
                                </div>
                            )}
                        </div>
                    )}

                    {/* Action Bar */}
                    <div className="fixed bottom-0 left-0 right-0 p-6 bg-white/90 backdrop-blur-md border-t border-gray-200 flex justify-center z-30">
                        <div className="w-full max-w-5xl flex justify-end gap-4">
                            <button type="submit" disabled={submitting || (mode === 'variant' && !isVariantComplete)} className="px-10 py-4 bg-gray-900 text-white font-bold rounded-2xl hover:bg-black transition-all shadow-xl shadow-gray-900/20 flex items-center gap-2 disabled:opacity-50 disabled:shadow-none min-w-[200px] justify-center">
                                {submitting ? <span className="animate-pulse">Processing...</span> : <span>{mode === 'new' ? 'Create Product' : 'Add Variant'}</span>}
                            </button>
                        </div>
                    </div>

                </form>
            </div >

            <ConfigModal
                isOpen={configModalOpen}
                onClose={() => setConfigModalOpen(false)}
                activeTab={activeConfigTab}
                onTabChange={setActiveConfigTab}
                config={config}
                selectedParentCategory={selectedParentCategory}
                onParentCategoryChange={setSelectedParentCategory}
                onAdd={handleAddConfigItem}
                onRemove={handleRemoveConfigItem}
                onAddCategory={handleAddAttributeCategory}
            />

        </div >
    );
}
