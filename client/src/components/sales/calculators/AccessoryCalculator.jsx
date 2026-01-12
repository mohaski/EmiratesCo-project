import React, { useState, useEffect, useMemo, memo } from 'react';

const AccessoryCalculator = memo(({ product, initialDetails, onUpdate }) => {
    // --- 1. Determine Product Nature ---
    const hasVariants = product.variants && product.variants.length > 0;

    // --- 2. Attribute Selection State (For Variable Products) ---
    // If we have initial details, use them. Otherwise, try to pick defaults or first available.
    const [selections, setSelections] = useState(() => {
        if (initialDetails?.selectedAttributes) return initialDetails.selectedAttributes;

        const defaults = {};
        if (hasVariants) {
            // Populate with first available options or product defaults
            // Extract all attribute keys from first variant to know what to look for
            const attrKeys = Object.keys(product.variants[0].attributes || {});
            attrKeys.forEach(key => {
                // Try to find a default from product config or pick first value
                // For now, empty until user selects, or pick first valid option logic
                // Let's safe default to null to force user/UI to resolve
                defaults[key] = null;
            });
            // Smart Reset: Preselect if only one option exists?
            // Not strictly needed but good UX.
        }
        return defaults;
    });

    // --- 3. Resolve Variant ---
    const selectedVariant = useMemo(() => {
        if (!hasVariants) return product; // Treat product as the only "variant"

        // Find variant matching selections
        return product.variants.find(v => {
            return Object.entries(selections).every(([key, val]) => v.attributes[key] === val);
        }) || null;
    }, [product, hasVariants, selections]);

    // Available Attributes Logic (to drive UI selectors)
    const availableAttributes = useMemo(() => {
        if (!hasVariants) return {};

        const attrs = {};
        product.variants.forEach(v => {
            Object.entries(v.attributes).forEach(([key, val]) => {
                if (!attrs[key]) attrs[key] = new Set();
                attrs[key].add(val);
            });
        });

        // Convert Sets to Arrays
        const result = {};
        Object.keys(attrs).forEach(k => result[k] = Array.from(attrs[k]));
        return result;
    }, [product.variants, hasVariants]);

    // Auto-select first options by default
    useEffect(() => {
        if (hasVariants) {
            setSelections(prev => {
                const next = { ...prev };
                let changed = false;
                Object.entries(availableAttributes).forEach(([key, opts]) => {
                    // Always select first option if not already selected
                    if (opts.length > 0 && !next[key]) {
                        next[key] = opts[0];
                        changed = true;
                    }
                });
                return changed ? next : prev;
            });
        }
    }, [availableAttributes, hasVariants]);

    // --- 4. Core State ---
    // Offcut Mode State
    const [qtyFull, setQtyFull] = useState(initialDetails?.qtyFull || 0);
    const [qtyHalf, setQtyHalf] = useState(initialDetails?.qtyHalf || 0);

    // Single Custom Cut State (Reverted from Multiple)
    const [cutLength, setCutLength] = useState(initialDetails?.cutLength || '');

    // Standard Mode State
    const [qty, setQty] = useState(initialDetails?.qty || 1);
    const [salesMode, setSalesMode] = useState(initialDetails?.salesMode || 'roll'); // 'meter' or 'roll' for legacy rolls

    // Legacy Roll Handling
    const rollOptions = product.rollOptions || (product.priceRoll ? [{ label: 'Standard Roll', length: product.rollLength, price: product.priceRoll }] : []);
    const hasRollOption = rollOptions.length > 0 && !hasVariants;
    const [selectedRoll, setSelectedRoll] = useState(initialDetails?.selectedRoll || (hasRollOption ? rollOptions[0] : null));

    const [error, setError] = useState(null);

    // --- 5. Calculation Logic ---
    useEffect(() => {
        if (hasVariants && !selectedVariant) {
            onUpdate(0, { isValid: false, warning: 'Please select options' });
            return;
        }

        const activeItem = selectedVariant || product;
        const trackOffcuts = activeItem.trackOffcuts || product.trackOffcuts;

        let total = 0;
        const lineItems = [];
        const attributesDetail = [];
        let isValid = true;
        let finalError = null;

        // Populate Attributes
        if (hasVariants) {
            Object.entries(selections).forEach(([k, v]) => {
                if (v) attributesDetail.push({ label: k, value: v });
            });
        }
        if (!hasVariants && product.hasColor && initialDetails?.color) attributesDetail.push({ label: 'Color', value: initialDetails.color });

        const stock = activeItem.stock || 0;

        if (trackOffcuts) {
            // --- OFFCUT CALCULATION ---
            const pFull = activeItem.priceFull || activeItem.price || 0;
            const pHalf = activeItem.priceHalf || 0;
            const pCut = activeItem.priceUnit || activeItem.priceFoot || 0;

            const totalFullPrice = qtyFull * pFull;
            const totalHalfPrice = qtyHalf * pHalf;

            // Calculate Cuts Total (Single Cut Logic, Qty=1)
            let totalCutPrice = 0;
            const q = 1; // Fixed Qty
            const l = parseFloat(cutLength) || 0;

            if (l > 0) {
                totalCutPrice = l * pCut * q;
            }

            total = totalFullPrice + totalHalfPrice + totalCutPrice;

            if (qtyFull > stock) {
                finalError = `Insufficient Stock (Full). Have ${stock}`;
                isValid = false;
            }

            if (qtyFull > 0) lineItems.push({ type: 'accessory-full', label: 'Full', qty: qtyFull, rate: pFull, total: totalFullPrice });
            if (qtyHalf > 0) lineItems.push({ type: 'accessory-half', label: 'Half', qty: qtyHalf, rate: pHalf, total: totalHalfPrice });

            // Add Single Cut if exists
            if (totalCutPrice > 0) {
                lineItems.push({
                    type: 'accessory-cut',
                    label: `Cut ${l}${activeItem.unit || ''}`,
                    qty: q,
                    rate: pCut * l, // Rate per piece of this length (Total cost of the cut)
                    total: totalCutPrice,
                    meta: { length: l, unit: activeItem.unit || '' }
                });
            }

            onUpdate(total, {
                lineItems, // Containing Full, Half, and Cut
                attributes: attributesDetail,
                qtyFull,
                qtyHalf,
                cutLength: l > 0 ? l : null,
                cutQty: 1,
                trackOffcuts: true,
                variantId: hasVariants && selectedVariant ? (selectedVariant.variantId || selectedVariant.id) : null,
                isValid,
                warning: finalError
            });

        } else {
            // --- STANDARD CALCULATION ---
            if (hasRollOption && salesMode === 'roll') {
                const price = selectedRoll?.price || 0;
                total = qty * price;
                lineItems.push({ type: 'accessory-roll', label: selectedRoll?.label || 'Roll', qty: qty, rate: price, total, meta: { length: selectedRoll?.length } });
                attributesDetail.push({ label: 'Roll Type', value: selectedRoll?.label });

            } else {
                const price = activeItem.price || activeItem.priceFull || 0;
                total = qty * price;
                if (qty > stock) {
                    finalError = `Only ${stock} items available`;
                    isValid = false;
                }
                lineItems.push({ type: 'accessory-unit', label: 'Quantity', qty: qty, rate: price, total, meta: { unit: activeItem.unit } });
            }

            onUpdate(total, {
                lineItems,
                attributes: attributesDetail,
                qty: qty,
                salesMode,
                selectedRoll,
                variantId: activeItem.variantId || activeItem.id,
                isValid,
                warning: finalError
            });
        }
        setError(finalError);
    }, [hasVariants, selectedVariant, product, selections, qtyFull, qtyHalf, cutLength, qty, salesMode, selectedRoll, hasRollOption, onUpdate]);

    // --- UI HELPERS ---
    const handleVariantSelect = (key, val) => {
        setSelections(prev => ({ ...prev, [key]: val }));
    };

    // --- RENDER ---
    const activeItem = selectedVariant || product;
    const trackOffcuts = activeItem.trackOffcuts || activeItem.track_offcuts || product.trackOffcuts || product.track_offcuts;

    return (
        <div className="space-y-4">
            {/* 1. Attribute Selectors (if variable) */}
            {hasVariants && (
                <div className="space-y-2">
                    {Object.entries(availableAttributes).map(([key, options]) => (
                        <div key={key} className="space-y-1">
                            <label className="text-[10px] font-bold text-gray-400 uppercase mb-1 ml-1">{key}</label>
                            <div className="flex flex-wrap gap-1.5">
                                {options.map(opt => (
                                    <button
                                        key={opt}
                                        onClick={() => handleVariantSelect(key, opt)}
                                        className={`px-3 py-1.5 rounded-md text-xs font-bold border transition-all ${selections[key] === opt
                                            ? 'bg-blue-600 text-white border-blue-600 shadow-sm'
                                            : 'bg-white text-gray-600 border-gray-200 hover:border-gray-300'
                                            }`}
                                    >
                                        {opt}
                                    </button>
                                ))}
                            </div>
                        </div>
                    ))}
                </div>
            )}

            {/* 3. Input Section */}
            {trackOffcuts ? (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                    {/* Standard */}
                    <div className="bg-gray-50 p-5 rounded-xl border border-gray-200">
                        <h3 className="text-lg font-bold text-gray-800 mb-4 flex items-center gap-2">
                            <span>📏</span> Standard
                        </h3>
                        <div className="space-y-4">
                            {/* Full */}
                            <div className="flex flex-col gap-1">
                                <div className="flex items-center justify-between">
                                    <div className="text-gray-600 font-medium">Full</div>
                                    <div className="flex items-center bg-white rounded-lg p-1 border border-gray-200 shadow-sm">
                                        <button onClick={() => setQtyFull(Math.max(0, qtyFull - 1))} className="w-8 h-8 rounded-md bg-gray-100 text-gray-600 hover:bg-gray-200 font-bold">-</button>
                                        <input type="number" value={qtyFull} onChange={(e) => setQtyFull(Math.max(0, parseInt(e.target.value) || 0))} className="w-12 text-center bg-transparent text-gray-800 font-mono focus:outline-none font-bold" />
                                        <button onClick={() => setQtyFull(qtyFull + 1)} className="w-8 h-8 rounded-md bg-blue-50 text-blue-600 hover:bg-blue-100 font-bold">+</button>
                                    </div>
                                </div>
                            </div>

                            {/* Half (Toggle) */}
                            <div className="flex items-center justify-between pt-4 border-t border-gray-200">
                                <div className="text-gray-600 font-medium">Half</div>
                                <div className="flex items-center">
                                    <button
                                        onClick={() => setQtyHalf(qtyHalf > 0 ? 0 : 1)}
                                        className={`relative inline-flex h-8 w-14 items-center rounded-full transition-colors focus:outline-none ${qtyHalf > 0 ? 'bg-blue-600' : 'bg-gray-200'}`}
                                    >
                                        <span className={`inline-block h-6 w-6 transform rounded-full bg-white transition-transform ${qtyHalf > 0 ? 'translate-x-7' : 'translate-x-1'}`} />
                                    </button>
                                </div>
                            </div>
                        </div>
                    </div>

                    {/* Custom Cut (Single Item) */}
                    <div className="bg-gray-50 p-5 rounded-xl border border-gray-200 flex flex-col h-full">
                        <div className="flex justify-between items-center mb-4">
                            <h3 className="text-lg font-bold text-gray-800 flex items-center gap-2">
                                <span>✂️</span> Custom Cut
                            </h3>
                        </div>

                        <div className="flex-1 flex flex-col justify-center space-y-4">
                            <div className="flex items-center gap-2">
                                <div className="flex-1 relative">
                                    <input
                                        type="number"
                                        step="1"
                                        value={cutLength}
                                        onChange={(e) => setCutLength(e.target.value)}
                                        className="w-full pl-3 pr-8 py-3 rounded-xl border border-gray-200 text-lg font-bold focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 outline-none shadow-sm"
                                        placeholder="Length"
                                    />
                                    <span className="absolute right-3 top-4 text-xs text-gray-400 font-bold uppercase">{activeItem.unit || ''}</span>
                                </div>
                            </div>

                            <div className="text-xs text-right text-gray-500 font-medium">
                                Rate: <span className="text-blue-600 font-bold">Ksh{activeItem.priceUnit || activeItem.priceFoot || 0} / {activeItem.unit || 'unit'}</span>
                            </div>
                        </div>
                    </div>
                </div>

            ) : (
                /* --- SIMPLE / LEGACY UI --- */
                <div className="bg-gray-50 p-6 rounded-xl border border-gray-200 text-center">
                    {/* Simple Qty Input */}
                    <div className="space-y-3">
                        <label className="text-sm font-bold text-gray-500 uppercase tracking-wider">{hasRollOption ? 'Number of Rolls' : 'Quantity'}</label>
                        <div className="flex items-center justify-center gap-4">
                            <button onClick={() => setQty(Math.max(1, qty - 1))} className="w-12 h-12 rounded-xl bg-white border border-gray-200 text-xl font-bold text-gray-400 hover:text-gray-600 hover:border-gray-300 transition-all shadow-sm">-</button>
                            <span className="text-4xl font-black text-gray-800 w-24">{qty}</span>
                            <button onClick={() => setQty(qty + 1)} className="w-12 h-12 rounded-xl bg-blue-600 border border-blue-600 text-xl font-bold text-white hover:bg-blue-700 transition-all shadow-lg shadow-blue-500/30">+</button>
                        </div>
                        {hasRollOption && <p className="text-xs text-gray-400 font-medium">Standard Roll Length: {product.rollLength}m</p>}
                    </div>
                </div>
            )}

            {/* 4. Validation Messages */}
            {error && (
                <div className="mt-6 p-3 bg-red-50 text-red-600 text-xs font-bold rounded-xl flex items-center justify-center gap-2 animate-shake">
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"></path></svg>
                    {error}
                </div>
            )}
        </div>
    );
});

export default AccessoryCalculator;