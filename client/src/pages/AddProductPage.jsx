import { useState, useMemo, useCallback } from 'react';
import { useProducts } from '../context/ProductContext';
import { useAttributes } from '../context/AttributeContext';
import ConfigModal from '../components/inventory/ConfigModal';

const buildSubCategoriesMap = cats => {
    const subs = {};
    cats.forEach(c => { subs[c.id] = c.subCategories || []; });
    return subs;
};

export default function AddProductPage() {
    const { products, categories, addProduct, addCategory, addProductVariants } = useProducts();
    const {
        attributeClasses,
        createAttributeClass, renameAttributeClass, deleteAttributeClass,
        addAttributeValue, renameAttributeValue, deleteAttributeValue,
    } = useAttributes();

    // Persisted attribute classes/values, reshaped into the { [name]: [...] } maps the rest of this page expects.
    const attributesMap = useMemo(() => {
        const m = {};
        attributeClasses.forEach(c => { m[c.name] = c.values.map(v => v.value); });
        return m;
    }, [attributeClasses]);
    const attributeTypesMap = useMemo(() => {
        const m = {};
        attributeClasses.forEach(c => { m[c.name] = c.type; });
        return m;
    }, [attributeClasses]);
    const findAttributeClassId = name => attributeClasses.find(c => c.name === name)?.id;
    const findAttributeValueId = (className, value) => attributeClasses.find(c => c.name === className)?.values.find(v => v.value === value)?.id;

    const [config, setConfig] = useState(() => ({ categories, subCategories: buildSubCategoriesMap(categories) }));

    // Re-sync config.categories/subCategories whenever the `categories` prop changes,
    // without routing through an effect (avoids an extra render+commit cascade).
    // Note: the initial value above already derives subCategories correctly, so this
    // only needs to catch *later* changes (e.g. a refetch after adding a category).
    const [syncedCategories, setSyncedCategories] = useState(categories);
    if (categories !== syncedCategories) {
        setSyncedCategories(categories);
        setConfig(prev => ({ ...prev, categories, subCategories: buildSubCategoriesMap(categories) }));
    }

    const [configModalOpen, setConfigModalOpen] = useState(false);
    const [activeConfigTab, setActiveConfigTab] = useState('categories');
    const [selectedParentCategory, setSelectedParentCategory] = useState(categories[0]?.id || '');
    const [mode, setMode] = useState('new');
    const [submitting, setSubmitting] = useState(false);

    const [newProductData, setNewProductData] = useState({
        name: '', itemCode: '', category: '', subCategory: '',
        image: null, applicableAttributes: ['Color'], defaultAttributes: {},
        trackOffcuts: false, unit: 'ft',
    });
    const [hasDimensions, setHasDimensions] = useState(false);
    const [dimensionValues, setDimensionValues] = useState([]); // [{ length, width }]
    const [dimensionInput, setDimensionInput] = useState({ length: '', width: '', unit: '' });

    // For category === 'accessories': explicit choice between length-tracked (cut/offcuts,
    // e.g. rubber rolls) and count-tracked (sold as Box/Pcs, e.g. screws) items.
    const [accessoryTrackingType, setAccessoryTrackingType] = useState(null); // 'length' | 'count' | null

    // Per-product values for "custom" attribute classes (e.g. Unit: Box / Pcs, or "1000pcs") —
    // entered per product instead of picked from a shared preset list. Keyed by attribute class
    // name; each value is { label, quantity, display } where display = `${quantity}${label}` when
    // a quantity is given (e.g. "1000pcs"), else just the label (e.g. "Box"). `quantity` is stored
    // on the generated variant's unit_quantity column, `display` is stored in variant.attributes.
    const [customAttributeValues, setCustomAttributeValues] = useState({});
    const [customAttributeInputs, setCustomAttributeInputs] = useState({}); // { [attrKey]: { quantity, label } }

    const [matrixSelections, setMatrixSelections] = useState({});
    const [matrixValues, setMatrixValues] = useState({});

    const [filterCategory, setFilterCategory] = useState(() => (categories && categories.length > 0) ? categories[0].id : 'ke-profile');
    const [filterSubCategory, setFilterSubCategory] = useState(() => {
        const validSubs = buildSubCategoriesMap(categories)[filterCategory] || [];
        return validSubs.length > 0 ? validSubs[0].id : '';
    });

    // Reset filterSubCategory to the first valid option whenever filterCategory (or the
    // available subcategories) changes; the user can still override it afterward by clicking a chip.
    const [prevFilterCategory, setPrevFilterCategory] = useState(filterCategory);
    const [prevSubCategoriesMap, setPrevSubCategoriesMap] = useState(config.subCategories);
    if (filterCategory !== prevFilterCategory || config.subCategories !== prevSubCategoriesMap) {
        setPrevFilterCategory(filterCategory);
        setPrevSubCategoriesMap(config.subCategories);
        const validSubs = config.subCategories[filterCategory] || [];
        setFilterSubCategory(validSubs.length > 0 ? validSubs[0].id : '');
    }

    const [selectedExistingProduct, setSelectedExistingProduct] = useState(null);

    // The active attribute set / dimension flag / track-offcuts state driving the matrix
    // generator, unified across both modes: in 'new' mode it comes from the in-progress
    // newProductData draft; in 'variant' mode it comes straight from the selected product's
    // own stored config, so "Add Variant" always offers the exact same attributes the
    // product was created with.
    const currentApplicableAttributes = useMemo(() => (
        mode === 'new' ? newProductData.applicableAttributes : (selectedExistingProduct?.applicableAttributes || [])
    ), [mode, newProductData.applicableAttributes, selectedExistingProduct]);
    const currentCategory = mode === 'new' ? newProductData.category : (selectedExistingProduct?.category || '');
    const currentHasDimensions = mode === 'new' ? hasDimensions : !!(selectedExistingProduct?.hasDimensions);
    const currentTrackOffcuts = mode === 'new' ? newProductData.trackOffcuts : !!(selectedExistingProduct?.trackOffcuts);
    const currentAccessoryTrackingType = mode === 'new'
        ? accessoryTrackingType
        : (currentCategory === 'accessories' ? (currentTrackOffcuts ? 'length' : 'count') : null);

    // Attributes that actually drive variant generation. For accessories, a built-in (list-type)
    // "Length" is excluded in favor of the free-form numeric field below — but a user-created
    // *custom* "Length" attribute is meant to generate distinct variants (e.g. "8cm"/"10cm"),
    // same as any other custom attribute, so it's kept.
    const generationAttributes = useMemo(() => (
        currentCategory === 'accessories'
            ? currentApplicableAttributes.filter(a => !(a === 'Length' && attributeTypesMap[a] !== 'custom'))
            : currentApplicableAttributes
    ), [currentApplicableAttributes, currentCategory, attributeTypesMap]);

    // Display label for a dimension pair, used both as the chip label and the generated variant's attribute value
    const dimensionLabel = p => `${p.length}×${p.width}${p.unit || ''}`;
    const dimensionLabels = useMemo(() => dimensionValues.map(dimensionLabel), [dimensionValues]);

    // 'Dimensions' behaves like any other generating attribute (Color, Thickness...) once enabled
    const generationKeys = useMemo(() => {
        const keys = [...generationAttributes];
        if (currentHasDimensions) keys.push('Dimensions');
        return keys;
    }, [generationAttributes, currentHasDimensions]);

    const matrixPreview = useMemo(() => {
        if (mode === 'variant' && !selectedExistingProduct) return [];
        // No distinguishing attributes selected — every product still gets a single variant row.
        if (generationKeys.length === 0) return ['Standard'];
        // Candidate values a generating attribute can take: Dimensions (length×width pairs),
        // "custom" classes (per-product free values, e.g. Box/Pcs), or a shared preset list.
        const potentialValues = generationKeys.map(k => {
            if (k === 'Dimensions') return dimensionLabels;
            if (attributeTypesMap[k] === 'custom') return (customAttributeValues[k] || []).map(v => v.display);
            return matrixSelections[k] || [];
        });
        if (potentialValues.some(v => v.length === 0)) return [];
        const cartesian = (arrays) => {
            if (arrays.length === 0) return [[]];
            const [first, ...rest] = arrays;
            const restCart = cartesian(rest);
            return first.flatMap(f => restCart.map(r => [f, ...r]));
        };
        return cartesian(potentialValues).map(combo => combo.join(' - '));
    }, [generationKeys, dimensionLabels, matrixSelections, attributeTypesMap, customAttributeValues, mode, selectedExistingProduct]);

    // Fields shown per generated variant row
    const matrixRowFields = useMemo(() => {
        const fields = ['stock', 'priceFull'];
        if (currentTrackOffcuts) {
            fields.push('priceHalf', 'priceUnit');
        } else if (currentCategory === 'accessories' && currentAccessoryTrackingType === 'count') {
            // Count-tracked accessories (Box/Pcs) still need a per-piece price, even though
            // they're not cut-to-length, so Price (Unit) isn't gated behind Track Offcuts here.
            fields.push('priceUnit');
        }
        // Length-tracked accessories always need a per-variant length. If "Length" is itself a
        // custom generating attribute its chosen value already becomes the variant's length
        // automatically (see buildGeneratedVariants) — the free numeric field is only needed
        // when there's no such generating attribute to source it from.
        if (currentCategory === 'accessories' && !generationKeys.includes('Length') &&
            (currentAccessoryTrackingType === 'length' || currentApplicableAttributes.includes('Length'))) {
            fields.push('length');
        }
        return fields;
    }, [currentTrackOffcuts, currentCategory, currentApplicableAttributes, currentAccessoryTrackingType, generationKeys]);

    // Reconstructs the {attrKey: value} map a generated variant-name string represents
    const attrsForVariantName = useCallback(name => {
        const attrs = {};
        if (generationKeys.length > 0) {
            const parts = name.split(' - ');
            generationKeys.forEach((key, i) => { attrs[key] = parts[i]; });
        }
        return attrs;
    }, [generationKeys]);
    const variantSignature = attrs => JSON.stringify(Object.keys(attrs).sort().map(k => [k, String(attrs[k])]));

    // Attribute combinations the selected product's variants already use — so "Add Variant"
    // can refuse to create a duplicate of one that already exists.
    const existingVariantSignatures = useMemo(() => {
        if (mode !== 'variant' || !selectedExistingProduct) return new Set();
        return new Set((selectedExistingProduct.variants || []).map(v => variantSignature(v.attributes || {})));
    }, [mode, selectedExistingProduct]);

    const isDuplicateVariant = useCallback(
        name => mode === 'variant' && existingVariantSignatures.has(variantSignature(attrsForVariantName(name))),
        [mode, existingVariantSignatures, attrsForVariantName]
    );

    // Builds the frontend-shape variant list from the current matrix selections — shared by
    // both "Create Product" (new mode) and "Add Variant(s)" (variant mode). Combinations that
    // already exist on the selected product are skipped rather than submitted as duplicates.
    const buildGeneratedVariants = () => matrixPreview.filter(name => !isDuplicateVariant(name)).map(name => {
        const vals = matrixValues[name] || {};
        const attrs = attrsForVariantName(name);
        const dimPair = attrs['Dimensions'] ? dimensionValues.find(p => dimensionLabel(p) === attrs['Dimensions']) : null;
        // Numeric quantity carried by whichever "custom" attribute value this variant used (e.g. 1000 for "1000pcs")
        let unitQuantity = null;
        for (const key of generationKeys) {
            if (attributeTypesMap[key] !== 'custom') continue;
            const match = (customAttributeValues[key] || []).find(v => v.display === attrs[key]);
            if (match?.quantity != null) { unitQuantity = match.quantity; break; }
        }
        return {
            id: `v-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
            name: generationKeys.length > 0 ? name : '',
            attributes: attrs,
            price: parseFloat(vals.priceFull || 0),
            stock: parseInt(vals.stock || 0),
            details: { priceFull: parseFloat(vals.priceFull || 0), priceHalf: parseFloat(vals.priceHalf || 0), priceUnit: parseFloat(vals.priceUnit || 0) },
            length: attrs['Length'] ? parseFloat(attrs['Length']) : (dimPair ? parseFloat(dimPair.length) : (vals.length ? parseFloat(vals.length) : null)),
            width: dimPair ? parseFloat(dimPair.width) : null,
            unitQuantity,
        };
    });

    const addDimensionPair = () => {
        const { length, width, unit } = dimensionInput;
        if (!length || !width) return;
        const label = dimensionLabel({ length, width, unit });
        setDimensionValues(prev => prev.some(p => dimensionLabel(p) === label) ? prev : [...prev, { length, width, unit }]);
        setDimensionInput({ length: '', width: '', unit: '' });
    };
    const removeDimensionPair = pair => {
        setDimensionValues(prev => prev.filter(p => dimensionLabel(p) !== dimensionLabel(pair)));
    };

    const addCustomAttributeValue = attrKey => {
        const { quantity, label } = customAttributeInputs[attrKey] || {};
        const trimmedLabel = (label || '').trim();
        if (!trimmedLabel) return;
        const parsedQuantity = quantity !== '' && quantity != null ? parseFloat(quantity) : null;
        const display = parsedQuantity ? `${parsedQuantity}${trimmedLabel}` : trimmedLabel;
        setCustomAttributeValues(prev => {
            const current = prev[attrKey] || [];
            return current.some(v => v.display === display) ? prev : { ...prev, [attrKey]: [...current, { label: trimmedLabel, quantity: parsedQuantity, display }] };
        });
        setCustomAttributeInputs(prev => ({ ...prev, [attrKey]: { quantity: '', label: '' } }));
    };
    const removeCustomAttributeValue = (attrKey, display) => {
        setCustomAttributeValues(prev => ({ ...prev, [attrKey]: (prev[attrKey] || []).filter(v => v.display !== display) }));
    };

    const handleNewChange = e => {
        const { name, value } = e.target;
        setNewProductData(prev => ({ ...prev, [name]: value }));
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
        let defaults = [];
        if (cat.includes('profile')) defaults = ['Color', 'Length'];
        else if (cat === 'glass') defaults = ['Thickness'];
        setHasDimensions(cat === 'glass');
        setDimensionValues([]);
        setDimensionInput({ length: '', width: '', unit: '' });
        setCustomAttributeValues({});
        setCustomAttributeInputs({});
        setAccessoryTrackingType(null);
        // Sub-Category is independent — picking a Category never auto-selects one, so the user
        // always has to choose it deliberately.
        setNewProductData(prev => ({ ...prev, category: cat, subCategory: '', applicableAttributes: defaults, defaultAttributes: {}, trackOffcuts: false }));
        setMatrixSelections({});
        setMatrixValues({});
    };

    const toggleApplicableAttribute = attrKey => {
        setNewProductData(prev => {
            const has = prev.applicableAttributes.includes(attrKey);
            const nextAttrs = has ? prev.applicableAttributes.filter(a => a !== attrKey) : [...prev.applicableAttributes, attrKey];
            const nextDefaults = { ...prev.defaultAttributes };
            if (has) {
                delete nextDefaults[attrKey];
                const nextMatrix = { ...matrixSelections }; delete nextMatrix[attrKey]; setMatrixSelections(nextMatrix);
                setCustomAttributeValues(prevCustom => { const { [attrKey]: _removed, ...rest } = prevCustom; return rest; });
            }
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
        if (mode === 'new' && field === 'length' && newProductData.category === 'accessories') {
            const hasLength = !!value && value.trim() !== '';
            setNewProductData(prev => prev.trackOffcuts !== hasLength ? { ...prev, trackOffcuts: hasLength } : prev);
        }
    };

    const filteredExistingProducts = useMemo(() => products.filter(p =>
        p.category === filterCategory && (p.subCategory === filterSubCategory || (!p.subCategory && filterSubCategory === 'general'))
    ), [products, filterCategory, filterSubCategory]);

    // Selecting a product to add variant(s) to resets the matrix generator so leftover
    // selections from a previous product (or the New Product flow) don't leak in.
    const handleSelectExisting = product => {
        setSelectedExistingProduct(product);
        setMatrixSelections({});
        setMatrixValues({});
        setDimensionValues([]);
        setDimensionInput({ length: '', width: '', unit: '' });
        setCustomAttributeValues({});
        setCustomAttributeInputs({});
    };

    const handleModeChange = m => {
        setMode(m);
        setMatrixSelections({});
        setMatrixValues({});
        setDimensionValues([]);
        setDimensionInput({ length: '', width: '', unit: '' });
        setCustomAttributeValues({});
        setCustomAttributeInputs({});
        setSelectedExistingProduct(null);
    };

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
            const classId = findAttributeClassId(activeConfigTab);
            if (classId) addAttributeValue(classId, newItem);
        }
    };

    // Creates a persisted attribute class (name + type) — used by ConfigModal's "New Class" form
    const handleAddAttributeCategory = (newCategoryName, isCustom = false) => {
        if (!newCategoryName || attributesMap[newCategoryName]) return;
        createAttributeClass(newCategoryName, isCustom ? 'custom' : 'list');
        setActiveConfigTab(newCategoryName);
    };

    const handleRemoveConfigItem = (itemToRemove, parentId = null) => {
        if (activeConfigTab === 'categories') {
            setConfig(prev => ({ ...prev, categories: prev.categories.filter(c => c.id !== itemToRemove.id) }));
        } else if (activeConfigTab === 'subcats') {
            setConfig(prev => ({ ...prev, subCategories: { ...prev.subCategories, [parentId]: prev.subCategories[parentId].filter(s => s.id !== itemToRemove.id) } }));
        } else {
            const valueId = findAttributeValueId(activeConfigTab, itemToRemove);
            if (valueId) deleteAttributeValue(valueId);
        }
    };

    // Rename an existing value within the currently active attribute class (e.g. "White" -> "Ivory")
    const handleRenameAttributeItem = oldValue => {
        const attrKey = activeConfigTab;
        const input = prompt('Rename value:', oldValue);
        if (input == null) return;
        const trimmed = input.trim();
        if (!trimmed || trimmed === oldValue) return;
        if ((attributesMap[attrKey] || []).includes(trimmed)) { alert(`"${trimmed}" already exists in ${attrKey}.`); return; }

        const valueId = findAttributeValueId(attrKey, oldValue);
        if (valueId) renameAttributeValue(valueId, trimmed);
        // Keep any in-progress selections pointing at the renamed value instead of going stale
        setMatrixSelections(prev => prev[attrKey] ? { ...prev, [attrKey]: prev[attrKey].map(v => v === oldValue ? trimmed : v) } : prev);
        setNewProductData(prev => prev.defaultAttributes[attrKey] === oldValue
            ? { ...prev, defaultAttributes: { ...prev.defaultAttributes, [attrKey]: trimmed } }
            : prev);
    };

    // Rename the attribute class itself (e.g. "Color" -> "Colour")
    const handleRenameAttributeClass = oldName => {
        const input = prompt('Rename attribute class:', oldName);
        if (input == null) return;
        const trimmed = input.trim();
        if (!trimmed || trimmed === oldName) return;
        if (attributesMap[trimmed]) { alert(`"${trimmed}" already exists.`); return; }

        const classId = findAttributeClassId(oldName);
        if (classId) renameAttributeClass(classId, trimmed);
        setNewProductData(prev => {
            const nextDefaults = { ...prev.defaultAttributes };
            if (oldName in nextDefaults) { nextDefaults[trimmed] = nextDefaults[oldName]; delete nextDefaults[oldName]; }
            return {
                ...prev,
                applicableAttributes: prev.applicableAttributes.map(a => a === oldName ? trimmed : a),
                defaultAttributes: nextDefaults,
            };
        });
        setMatrixSelections(prev => {
            if (!(oldName in prev)) return prev;
            const { [oldName]: vals, ...rest } = prev;
            return { ...rest, [trimmed]: vals };
        });
        setCustomAttributeValues(prev => {
            if (!(oldName in prev)) return prev;
            const { [oldName]: vals, ...rest } = prev;
            return { ...rest, [trimmed]: vals };
        });
        setCustomAttributeInputs(prev => {
            if (!(oldName in prev)) return prev;
            const { [oldName]: val, ...rest } = prev;
            return { ...rest, [trimmed]: val };
        });
        setActiveConfigTab(trimmed);
    };

    // Delete an entire attribute class and all its values
    const handleDeleteAttributeClass = className => {
        if (!confirm(`Delete the "${className}" attribute class and all its values?`)) return;

        const classId = findAttributeClassId(className);
        if (classId) deleteAttributeClass(classId);
        setNewProductData(prev => {
            const nextDefaults = { ...prev.defaultAttributes };
            delete nextDefaults[className];
            return {
                ...prev,
                applicableAttributes: prev.applicableAttributes.filter(a => a !== className),
                defaultAttributes: nextDefaults,
            };
        });
        setMatrixSelections(prev => {
            if (!(className in prev)) return prev;
            const { [className]: _removed, ...rest } = prev;
            return rest;
        });
        setCustomAttributeValues(prev => {
            if (!(className in prev)) return prev;
            const { [className]: _removed, ...rest } = prev;
            return rest;
        });
        setCustomAttributeInputs(prev => {
            if (!(className in prev)) return prev;
            const { [className]: _removed, ...rest } = prev;
            return rest;
        });
        setActiveConfigTab('categories');
    };

    const handleSubmit = e => {
        e.preventDefault();
        if (mode === 'new' && (!newProductData.category || !newProductData.subCategory)) {
            alert("Please select both a Category and a Sub-Category.");
            return;
        }
        if (mode === 'variant' && !selectedExistingProduct) {
            alert("Please select a product first.");
            return;
        }
        if (matrixPreview.length === 0) {
            alert("Please generate at least one variant.");
            return;
        }
        const variants = buildGeneratedVariants();
        if (mode === 'variant' && variants.length === 0) {
            alert("All selected variant(s) already exist for this product.");
            return;
        }
        setSubmitting(true);
        setTimeout(async () => {
            if (mode === 'new') {
                const finalProduct = { id: `p-${Date.now()}`, ...newProductData, hasDimensions, attributes: matrixSelections, variants, image: 'https://placehold.co/300x200/555555/FFFFFF?text=New+Product' };
                try {
                    await addProduct(finalProduct);
                    alert(`Product Created: ${newProductData.name}\n${variants.length} Variant(s) Generated.`);
                    setNewProductData({ name: '', itemCode: '', category: '', subCategory: '', image: null, defaultAttributes: {}, applicableAttributes: ['Color'], trackOffcuts: false, unit: 'ft' });
                    setHasDimensions(false);
                    setMatrixSelections({}); setMatrixValues({}); setDimensionValues([]); setDimensionInput({ length: '', width: '', unit: '' });
                    setCustomAttributeValues({}); setCustomAttributeInputs({});
                } catch { /* error toast already shown by api interceptor */ }
            } else {
                try {
                    await addProductVariants(selectedExistingProduct.id, variants);
                    alert(`${variants.length} Variant(s) Added!\n${selectedExistingProduct.name}`);
                    setSelectedExistingProduct(null);
                    setMatrixSelections({}); setMatrixValues({}); setDimensionValues([]); setDimensionInput({ length: '', width: '', unit: '' });
                    setCustomAttributeValues({}); setCustomAttributeInputs({});
                } catch { /* error toast already shown by api interceptor */ }
            }
            setSubmitting(false);
        }, 800);
    };

    const isVariantComplete = useMemo(() => {
        if (mode !== 'variant' || !selectedExistingProduct || matrixPreview.length === 0) return false;
        const rows = matrixPreview.filter(name => !isDuplicateVariant(name));
        if (rows.length === 0) return false;
        return rows.every(name => {
            const vals = matrixValues[name] || {};
            return vals.stock !== undefined && vals.stock !== '' && vals.priceFull !== undefined && vals.priceFull !== '';
        });
    }, [mode, selectedExistingProduct, matrixPreview, matrixValues, isDuplicateVariant]);

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
                            <button key={m} onClick={() => handleModeChange(m)} style={{ padding: '0.375rem 1rem', borderRadius: '0.5rem', border: 'none', cursor: 'pointer', fontWeight: 700, fontSize: '0.78rem', background: mode === m ? 'rgba(59,130,246,0.2)' : 'transparent', color: mode === m ? '#60a5fa' : '#64748b', transition: 'all 0.15s' }}>
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
                            <div style={{ display: 'grid', gridTemplateColumns: '1fr 320px', gap: '1.25rem', alignItems: 'start' }}>
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
                                                    <select required name="category" value={newProductData.category} onChange={handleNewCategoryChange} style={selectStyle} onFocus={onFocusBorder} onBlur={onBlurBorder}>
                                                        <option value="" disabled>Select Category...</option>
                                                        {categories.map(c => <option key={c.id} value={c.id}>{c.label}</option>)}
                                                    </select>
                                                </div>
                                                <div>
                                                    <label style={labelStyle}>Sub-Category</label>
                                                    <select required name="subCategory" value={newProductData.subCategory} onChange={handleNewChange} style={selectStyle} onFocus={onFocusBorder} onBlur={onBlurBorder}>
                                                        <option value="" disabled>Select Sub-Category...</option>
                                                        {config.subCategories[newProductData.category]?.map(sub => <option key={sub.id} value={sub.id}>{sub.label}</option>)}
                                                    </select>
                                                </div>
                                            </div>
                                            <div>
                                                <label style={labelStyle}>Measurement Unit <span style={{ color: '#334155', fontSize: '0.58rem', textTransform: 'none' }}>(shown on dimensions & per-unit pricing)</span></label>
                                                <select name="unit" value={newProductData.unit} onChange={handleNewChange} style={{ ...selectStyle, width: '140px' }} onFocus={onFocusBorder} onBlur={onBlurBorder}>
                                                    {['ft', 'mm', 'cm', 'm', 'in', 'pcs'].map(u => <option key={u} value={u}>{u}</option>)}
                                                </select>
                                            </div>
                                            {/* Track offcuts — accessories get an explicit Length vs Count choice instead */}
                                            {newProductData.category === 'accessories' ? (
                                                <div style={{ paddingTop: '0.75rem', borderTop: '1px solid rgba(255,255,255,0.06)' }}>
                                                    <label style={{ ...labelStyle, marginBottom: '0.5rem' }}>Tracked By</label>
                                                    <div style={{ display: 'flex', gap: '0.5rem' }}>
                                                        {[
                                                            { val: 'length', icon: '📏', label: 'Length', hint: 'Cut to size — offcuts tracked (e.g. rubber roll)' },
                                                            { val: 'count', icon: '🔢', label: 'Count', hint: 'Sold as Box / Pcs / units (e.g. screws)' },
                                                        ].map(opt => (
                                                            <button key={opt.val} type="button" onClick={() => {
                                                                setAccessoryTrackingType(opt.val);
                                                                setNewProductData(prev => ({ ...prev, trackOffcuts: opt.val === 'length' }));
                                                            }} style={{
                                                                flex: 1, padding: '0.625rem 0.75rem', borderRadius: '0.75rem', textAlign: 'left', cursor: 'pointer',
                                                                border: `1px solid ${accessoryTrackingType === opt.val ? 'rgba(59,130,246,0.5)' : 'rgba(255,255,255,0.1)'}`,
                                                                background: accessoryTrackingType === opt.val ? 'rgba(59,130,246,0.12)' : 'rgba(255,255,255,0.03)',
                                                                transition: 'all 0.15s',
                                                            }}>
                                                                <div style={{ fontSize: '0.82rem', fontWeight: 700, color: accessoryTrackingType === opt.val ? '#60a5fa' : '#94a3b8' }}>{opt.icon} {opt.label}</div>
                                                                <div style={{ fontSize: '0.6rem', color: '#475569', marginTop: '2px' }}>{opt.hint}</div>
                                                            </button>
                                                        ))}
                                                    </div>
                                                    {accessoryTrackingType === 'length' && (
                                                        <p style={{ fontSize: '0.65rem', color: '#475569', margin: '0.5rem 0 0' }}>Each variant gets its own Length input below. To generate separate variants by length (e.g. 8cm / 10cm) instead, add a custom "Length" attribute.</p>
                                                    )}
                                                    {accessoryTrackingType === 'count' && (
                                                        <p style={{ fontSize: '0.65rem', color: '#475569', margin: '0.5rem 0 0' }}>Add a custom attribute (e.g. "Unit": Box / Pcs) below to distinguish sale units.</p>
                                                    )}
                                                </div>
                                            ) : (
                                                <div style={{ paddingTop: '0.75rem', borderTop: '1px solid rgba(255,255,255,0.06)' }}>
                                                    <label style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', cursor: 'pointer' }}>
                                                        <button type="button" onClick={() => setNewProductData(prev => ({ ...prev, trackOffcuts: !prev.trackOffcuts }))} style={{ width: '44px', height: '24px', borderRadius: '100px', border: 'none', cursor: 'pointer', position: 'relative', background: newProductData.trackOffcuts ? 'linear-gradient(135deg, #3b82f6, #06b6d4)' : 'rgba(255,255,255,0.1)', transition: 'background 0.2s', flexShrink: 0 }}>
                                                            <span style={{ position: 'absolute', top: '3px', left: newProductData.trackOffcuts ? '22px' : '3px', width: '18px', height: '18px', borderRadius: '50%', background: '#fff', transition: 'left 0.2s', display: 'block' }} />
                                                        </button>
                                                        <span style={{ fontSize: '0.72rem', fontWeight: 700, color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.06em' }}>Track Offcuts (all variants)</span>
                                                    </label>
                                                </div>
                                            )}
                                        </div>
                                    </div>

                                    {/* Matrix Generator */}
                                    <div style={cardStyle}>
                                            <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', marginBottom: '1.25rem' }}>
                                                <div style={{ ...stepBadge(3), background: 'rgba(34,197,94,0.15)', border: '1px solid rgba(34,197,94,0.4)' }}>3</div>
                                                <h2 style={{ fontSize: '0.9rem', fontWeight: 800, color: '#f1f5f9', margin: 0 }}>Generate Variants</h2>
                                            </div>
                                            <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
                                                {/* Value toggles */}
                                                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: '0.75rem' }}>
                                                    {newProductData.applicableAttributes.filter(attr => !(newProductData.category === 'accessories' && attr === 'Length') && attributeTypesMap[attr] !== 'custom').map(attrKey => (
                                                        <div key={attrKey} style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.07)', borderRadius: '0.875rem', padding: '0.875rem' }}>
                                                            <p style={{ ...labelStyle, marginBottom: '0.625rem' }}>{attrKey} values</p>
                                                            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.375rem' }}>
                                                                {attributesMap[attrKey]?.map(val => {
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
                                                                    {matrixRowFields.map(field => (
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

                                {/* Attributes sidebar */}
                                <div style={cardStyle}>
                                        <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', marginBottom: '1.25rem' }}>
                                            <div style={{ ...stepBadge(2), background: 'rgba(168,85,247,0.15)', border: '1px solid rgba(168,85,247,0.4)', color: '#c084fc' }}>2</div>
                                            <h2 style={{ fontSize: '0.9rem', fontWeight: 800, color: '#f1f5f9', margin: 0 }}>Attributes</h2>
                                        </div>
                                        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                                            {Object.keys(attributesMap).map(attrKey => {
                                                const isSelected = newProductData.applicableAttributes.includes(attrKey);
                                                return (
                                                    <div key={attrKey} style={{ borderRadius: '0.875rem', border: `1px solid ${isSelected ? 'rgba(168,85,247,0.4)' : 'rgba(255,255,255,0.07)'}`, background: isSelected ? 'rgba(168,85,247,0.08)' : 'rgba(255,255,255,0.03)', padding: '0.75rem 1rem', transition: 'all 0.15s' }}>
                                                        <div onClick={() => toggleApplicableAttribute(attrKey)} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', cursor: 'pointer' }}>
                                                            <span style={{ fontSize: '0.82rem', fontWeight: 700, color: isSelected ? '#c084fc' : '#64748b' }}>{attrKey}</span>
                                                            <div style={{ width: '18px', height: '18px', borderRadius: '5px', border: `1px solid ${isSelected ? 'rgba(168,85,247,0.6)' : 'rgba(255,255,255,0.15)'}`, background: isSelected ? 'rgba(168,85,247,0.5)' : 'transparent', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                                                                {isSelected && <svg width="10" height="10" fill="none" stroke="#fff" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="3" d="M5 13l4 4L19 7" /></svg>}
                                                            </div>
                                                        </div>
                                                        {isSelected && attributeTypesMap[attrKey] === 'custom' && (
                                                            <div style={{ marginTop: '0.625rem' }}>
                                                                <label style={{ ...labelStyle, marginBottom: '0.25rem' }}>Add {attrKey} value</label>
                                                                <div style={{ display: 'flex', gap: '0.375rem' }}>
                                                                    <input type="number" placeholder="Qty (opt.)" value={customAttributeInputs[attrKey]?.quantity || ''}
                                                                        onChange={e => setCustomAttributeInputs(prev => ({ ...prev, [attrKey]: { ...(prev[attrKey] || {}), quantity: e.target.value } }))}
                                                                        onClick={e => e.stopPropagation()}
                                                                        onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); addCustomAttributeValue(attrKey); } }}
                                                                        onFocus={onFocusBorder} onBlur={onBlurBorder}
                                                                        style={{ ...inputStyle, flex: '0 0 90px', fontSize: '0.78rem', padding: '0.375rem 0.625rem' }} />
                                                                    <input type="text" placeholder="e.g. pcs, Box" value={customAttributeInputs[attrKey]?.label || ''}
                                                                        onChange={e => setCustomAttributeInputs(prev => ({ ...prev, [attrKey]: { ...(prev[attrKey] || {}), label: e.target.value } }))}
                                                                        onClick={e => e.stopPropagation()}
                                                                        onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); addCustomAttributeValue(attrKey); } }}
                                                                        onFocus={onFocusBorder} onBlur={onBlurBorder}
                                                                        style={{ ...inputStyle, fontSize: '0.78rem', padding: '0.375rem 0.625rem' }} />
                                                                    <button type="button" onClick={e => { e.stopPropagation(); addCustomAttributeValue(attrKey); }}
                                                                        style={{ flexShrink: 0, padding: '0 0.75rem', borderRadius: '0.625rem', border: '1px solid rgba(168,85,247,0.4)', background: 'rgba(168,85,247,0.15)', color: '#c084fc', cursor: 'pointer', fontSize: '0.78rem', fontWeight: 700 }}>+ Add</button>
                                                                </div>
                                                                <p style={{ fontSize: '0.6rem', color: '#475569', margin: '0.375rem 0 0' }}>Quantity + label combine into one value, e.g. 1000 + "pcs" → "1000pcs".</p>
                                                                {(customAttributeValues[attrKey] || []).length > 0 && (
                                                                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.375rem', marginTop: '0.5rem' }}>
                                                                        {customAttributeValues[attrKey].map(v => (
                                                                            <button key={v.display} type="button" onClick={e => { e.stopPropagation(); removeCustomAttributeValue(attrKey, v.display); }}
                                                                                style={{ ...chipBtn(true, 'purple'), display: 'flex', alignItems: 'center', gap: '0.3rem' }}>
                                                                                {v.display} <span style={{ opacity: 0.7 }}>✕</span>
                                                                            </button>
                                                                        ))}
                                                                    </div>
                                                                )}
                                                            </div>
                                                        )}
                                                        {isSelected && attributeTypesMap[attrKey] !== 'custom' && attrKey !== 'Color' && (
                                                            <div style={{ marginTop: '0.625rem' }}>
                                                                <label style={{ ...labelStyle, marginBottom: '0.25rem' }}>Default {attrKey}</label>
                                                                <select value={newProductData.defaultAttributes[attrKey] || ''} onChange={e => handleDefaultAttributeChange(attrKey, e.target.value)} onClick={e => e.stopPropagation()} style={{ ...selectStyle, fontSize: '0.78rem', padding: '0.375rem 0.625rem' }} onFocus={onFocusBorder} onBlur={onBlurBorder}>
                                                                    <option value="">No Default</option>
                                                                    {attributesMap[attrKey].map(opt => <option key={opt} value={opt}>{opt}</option>)}
                                                                </select>
                                                            </div>
                                                        )}
                                                    </div>
                                                );
                                            })}

                                            {/* Dimensions toggle — available for any category */}
                                            <div style={{ borderRadius: '0.875rem', border: `1px solid ${hasDimensions ? 'rgba(6,182,212,0.4)' : 'rgba(255,255,255,0.07)'}`, background: hasDimensions ? 'rgba(6,182,212,0.08)' : 'rgba(255,255,255,0.03)', padding: '0.75rem 1rem', transition: 'all 0.15s' }}>
                                                <div onClick={() => setHasDimensions(v => !v)} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', cursor: 'pointer' }}>
                                                    <div>
                                                        <span style={{ fontSize: '0.82rem', fontWeight: 700, color: hasDimensions ? '#22d3ee' : '#64748b' }}>Dimensions</span>
                                                        <p style={{ fontSize: '0.65rem', color: '#475569', margin: '2px 0 0' }}>Length × Width per variant</p>
                                                    </div>
                                                    <div style={{ width: '18px', height: '18px', borderRadius: '5px', border: `1px solid ${hasDimensions ? 'rgba(6,182,212,0.6)' : 'rgba(255,255,255,0.15)'}`, background: hasDimensions ? 'rgba(6,182,212,0.5)' : 'transparent', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                                                        {hasDimensions && <svg width="10" height="10" fill="none" stroke="#fff" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="3" d="M5 13l4 4L19 7" /></svg>}
                                                    </div>
                                                </div>
                                                {hasDimensions && (
                                                    <div style={{ marginTop: '0.625rem' }}>
                                                        <label style={{ ...labelStyle, marginBottom: '0.25rem' }}>Add Length × Width</label>
                                                        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.375rem' }}>
                                                            <input type="number" step="0.01" placeholder="Length" value={dimensionInput.length} onChange={e => setDimensionInput(prev => ({ ...prev, length: e.target.value }))} onClick={e => e.stopPropagation()} onFocus={onFocusBorder} onBlur={onBlurBorder} style={{ ...inputStyle, flex: '1 1 60px', minWidth: '60px', fontSize: '0.78rem', padding: '0.375rem 0.625rem' }} />
                                                            <input type="number" step="0.01" placeholder="Width" value={dimensionInput.width} onChange={e => setDimensionInput(prev => ({ ...prev, width: e.target.value }))} onClick={e => e.stopPropagation()} onFocus={onFocusBorder} onBlur={onBlurBorder} style={{ ...inputStyle, flex: '1 1 60px', minWidth: '60px', fontSize: '0.78rem', padding: '0.375rem 0.625rem' }} />
                                                            <input type="text" placeholder="Unit" value={dimensionInput.unit} onChange={e => setDimensionInput(prev => ({ ...prev, unit: e.target.value }))} onClick={e => e.stopPropagation()} onFocus={onFocusBorder} onBlur={onBlurBorder} style={{ ...inputStyle, flex: '0 1 56px', minWidth: '50px', fontSize: '0.78rem', padding: '0.375rem 0.625rem' }} />
                                                            <button type="button" onClick={e => { e.stopPropagation(); addDimensionPair(); }} style={{ flexShrink: 0, padding: '0 0.75rem', borderRadius: '0.625rem', border: '1px solid rgba(6,182,212,0.4)', background: 'rgba(6,182,212,0.15)', color: '#22d3ee', cursor: 'pointer', fontSize: '0.78rem', fontWeight: 700 }}>+ Add</button>
                                                        </div>
                                                        {dimensionValues.length > 0 && (
                                                            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.375rem', marginTop: '0.5rem' }}>
                                                                {dimensionValues.map(p => (
                                                                    <button key={dimensionLabel(p)} type="button" onClick={e => { e.stopPropagation(); removeDimensionPair(p); }} style={{ ...chipBtn(true, 'blue'), display: 'flex', alignItems: 'center', gap: '0.3rem' }}>
                                                                        {dimensionLabel(p)} <span style={{ opacity: 0.7 }}>✕</span>
                                                                    </button>
                                                                ))}
                                                            </div>
                                                        )}
                                                    </div>
                                                )}
                                            </div>
                                        </div>
                                    </div>
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
                                            <p style={{ fontSize: '0.72rem', color: '#60a5fa', margin: 0 }}>Adding new variant(s)</p>
                                        </div>
                                        <button onClick={() => setSelectedExistingProduct(null)} style={{ padding: '0.375rem 0.875rem', borderRadius: '0.625rem', border: '1px solid rgba(59,130,246,0.3)', background: 'rgba(59,130,246,0.1)', color: '#60a5fa', cursor: 'pointer', fontSize: '0.78rem', fontWeight: 700 }}>Change</button>
                                    </div>
                                )}
                            </div>

                            {/* Step 2: Configure — pick one or more values per attribute (same attributes
                                the product was created with) to generate one or more new variants at once */}
                            {selectedExistingProduct && (
                                <div style={cardStyle}>
                                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', marginBottom: '1.25rem' }}>
                                        <div style={{ ...stepBadge(2), background: 'rgba(168,85,247,0.15)', border: '1px solid rgba(168,85,247,0.4)', color: '#c084fc' }}>2</div>
                                        <h2 style={{ fontSize: '0.9rem', fontWeight: 800, color: '#f1f5f9', margin: 0 }}>Configure Variant(s)</h2>
                                    </div>
                                    {currentApplicableAttributes.length === 0 && !currentHasDimensions ? (
                                        <p style={{ fontSize: '0.82rem', color: '#475569', fontStyle: 'italic', marginBottom: '1rem' }}>Standard product with no specific attributes.</p>
                                    ) : (
                                        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: '0.75rem', marginBottom: '1.25rem' }}>
                                            {currentApplicableAttributes.filter(attr => !(currentCategory === 'accessories' && attr === 'Length' && attributeTypesMap[attr] !== 'custom')).map(attrKey => (
                                                <div key={attrKey} style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.07)', borderRadius: '0.875rem', padding: '0.875rem' }}>
                                                    <p style={{ ...labelStyle, marginBottom: '0.625rem' }}>{attrKey} values</p>
                                                    {attributeTypesMap[attrKey] === 'custom' ? (
                                                        <>
                                                            <div style={{ display: 'flex', gap: '0.375rem' }}>
                                                                <input type="number" placeholder="Qty (opt.)" value={customAttributeInputs[attrKey]?.quantity || ''}
                                                                    onChange={e => setCustomAttributeInputs(prev => ({ ...prev, [attrKey]: { ...(prev[attrKey] || {}), quantity: e.target.value } }))}
                                                                    onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); addCustomAttributeValue(attrKey); } }}
                                                                    onFocus={onFocusBorder} onBlur={onBlurBorder}
                                                                    style={{ ...inputStyle, flex: '0 0 90px', fontSize: '0.78rem', padding: '0.375rem 0.625rem' }} />
                                                                <input type="text" placeholder="e.g. pcs, Box" value={customAttributeInputs[attrKey]?.label || ''}
                                                                    onChange={e => setCustomAttributeInputs(prev => ({ ...prev, [attrKey]: { ...(prev[attrKey] || {}), label: e.target.value } }))}
                                                                    onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); addCustomAttributeValue(attrKey); } }}
                                                                    onFocus={onFocusBorder} onBlur={onBlurBorder}
                                                                    style={{ ...inputStyle, fontSize: '0.78rem', padding: '0.375rem 0.625rem' }} />
                                                                <button type="button" onClick={() => addCustomAttributeValue(attrKey)}
                                                                    style={{ flexShrink: 0, padding: '0 0.75rem', borderRadius: '0.625rem', border: '1px solid rgba(168,85,247,0.4)', background: 'rgba(168,85,247,0.15)', color: '#c084fc', cursor: 'pointer', fontSize: '0.78rem', fontWeight: 700 }}>+ Add</button>
                                                            </div>
                                                            {(customAttributeValues[attrKey] || []).length > 0 && (
                                                                <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.375rem', marginTop: '0.5rem' }}>
                                                                    {customAttributeValues[attrKey].map(v => (
                                                                        <button key={v.display} type="button" onClick={() => removeCustomAttributeValue(attrKey, v.display)}
                                                                            style={{ ...chipBtn(true, 'purple'), display: 'flex', alignItems: 'center', gap: '0.3rem' }}>
                                                                            {v.display} <span style={{ opacity: 0.7 }}>✕</span>
                                                                        </button>
                                                                    ))}
                                                                </div>
                                                            )}
                                                        </>
                                                    ) : (
                                                        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.375rem' }}>
                                                            {attributesMap[attrKey]?.map(val => {
                                                                const isSelected = (matrixSelections[attrKey] || []).includes(val);
                                                                return <button key={val} type="button" onClick={() => toggleMatrixValue(attrKey, val)} style={chipBtn(isSelected, 'green')}>{val}</button>;
                                                            })}
                                                        </div>
                                                    )}
                                                </div>
                                            ))}
                                            {currentHasDimensions && (
                                                <div style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.07)', borderRadius: '0.875rem', padding: '0.875rem' }}>
                                                    <p style={{ ...labelStyle, marginBottom: '0.625rem' }}>Dimensions (Length × Width)</p>
                                                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.375rem' }}>
                                                        <input type="number" step="0.01" placeholder="Length" value={dimensionInput.length} onChange={e => setDimensionInput(prev => ({ ...prev, length: e.target.value }))} onFocus={onFocusBorder} onBlur={onBlurBorder} style={{ ...inputStyle, flex: '1 1 60px', minWidth: '60px', fontSize: '0.78rem', padding: '0.375rem 0.625rem' }} />
                                                        <input type="number" step="0.01" placeholder="Width" value={dimensionInput.width} onChange={e => setDimensionInput(prev => ({ ...prev, width: e.target.value }))} onFocus={onFocusBorder} onBlur={onBlurBorder} style={{ ...inputStyle, flex: '1 1 60px', minWidth: '60px', fontSize: '0.78rem', padding: '0.375rem 0.625rem' }} />
                                                        <input type="text" placeholder="Unit" value={dimensionInput.unit} onChange={e => setDimensionInput(prev => ({ ...prev, unit: e.target.value }))} onFocus={onFocusBorder} onBlur={onBlurBorder} style={{ ...inputStyle, flex: '0 1 56px', minWidth: '50px', fontSize: '0.78rem', padding: '0.375rem 0.625rem' }} />
                                                        <button type="button" onClick={addDimensionPair} style={{ flexShrink: 0, padding: '0 0.75rem', borderRadius: '0.625rem', border: '1px solid rgba(6,182,212,0.4)', background: 'rgba(6,182,212,0.15)', color: '#22d3ee', cursor: 'pointer', fontSize: '0.78rem', fontWeight: 700 }}>+ Add</button>
                                                    </div>
                                                    {dimensionValues.length > 0 && (
                                                        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.375rem', marginTop: '0.5rem' }}>
                                                            {dimensionValues.map(p => (
                                                                <button key={dimensionLabel(p)} type="button" onClick={() => removeDimensionPair(p)} style={{ ...chipBtn(true, 'blue'), display: 'flex', alignItems: 'center', gap: '0.3rem' }}>
                                                                    {dimensionLabel(p)} <span style={{ opacity: 0.7 }}>✕</span>
                                                                </button>
                                                            ))}
                                                        </div>
                                                    )}
                                                </div>
                                            )}
                                        </div>
                                    )}

                                    {/* Generated variants matrix — one row per attribute-value combination */}
                                    {matrixPreview.length > 0 ? (
                                        <div style={{ maxHeight: '320px', overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '0.5rem' }} className="custom-scrollbar">
                                            {matrixPreview.map(name => {
                                                const duplicate = isDuplicateVariant(name);
                                                return (
                                                    <div key={name} style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', background: duplicate ? 'rgba(239,68,68,0.06)' : 'rgba(255,255,255,0.04)', border: `1px solid ${duplicate ? 'rgba(239,68,68,0.3)' : 'rgba(34,197,94,0.15)'}`, borderRadius: '0.875rem', padding: '0.75rem 1rem', flexWrap: 'wrap' }}>
                                                        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', minWidth: '120px' }}>
                                                            <span style={{ width: '6px', height: '6px', borderRadius: '50%', background: duplicate ? '#f87171' : '#4ade80', flexShrink: 0 }} />
                                                            <span style={{ fontSize: '0.78rem', fontWeight: 700, color: '#e2e8f0', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={name}>{name}</span>
                                                            {duplicate && <span style={{ fontSize: '0.58rem', fontWeight: 800, color: '#f87171', background: 'rgba(239,68,68,0.12)', padding: '2px 6px', borderRadius: '100px', whiteSpace: 'nowrap' }}>Already exists</span>}
                                                        </div>
                                                        <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap', flex: 1 }}>
                                                            {matrixRowFields.map(field => (
                                                                <div key={field} style={{ minWidth: '70px', flex: 1 }}>
                                                                    <label style={{ ...labelStyle, marginBottom: '2px' }}>{field}</label>
                                                                    <input type="number" disabled={duplicate} value={matrixValues[name]?.[field] || ''} onChange={e => handleMatrixValueChange(name, field, e.target.value)} style={{ ...inputStyle, padding: '0.375rem 0.5rem', fontSize: '0.78rem', opacity: duplicate ? 0.5 : 1, cursor: duplicate ? 'not-allowed' : 'text' }} onFocus={onFocusBorder} onBlur={onBlurBorder} />
                                                                </div>
                                                            ))}
                                                        </div>
                                                    </div>
                                                );
                                            })}
                                        </div>
                                    ) : (
                                        <div style={{ textAlign: 'center', padding: '1.5rem', border: '1px dashed rgba(255,255,255,0.08)', borderRadius: '0.875rem', color: '#334155', fontSize: '0.78rem', fontStyle: 'italic' }}>
                                            Select values above to generate variant(s)
                                        </div>
                                    )}
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
                                <span>{mode === 'new' ? '+ Create Product' : (() => {
                                    const pending = matrixPreview.filter(name => !isDuplicateVariant(name)).length;
                                    return pending > 1 ? `+ Add ${pending} Variants` : '+ Add Variant';
                                })()}</span>
                            )}
                        </button>
                    </div>
                </form>
            </div>

            <ConfigModal isOpen={configModalOpen} onClose={() => setConfigModalOpen(false)} activeTab={activeConfigTab} onTabChange={setActiveConfigTab} config={{ ...config, attributes: attributesMap, attributeTypes: attributeTypesMap }} selectedParentCategory={selectedParentCategory} onParentCategoryChange={setSelectedParentCategory} onAdd={handleAddConfigItem} onRemove={handleRemoveConfigItem} onAddCategory={handleAddAttributeCategory} onRenameItem={handleRenameAttributeItem} onRenameClass={handleRenameAttributeClass} onDeleteClass={handleDeleteAttributeClass} />
        </div>
    );
}
