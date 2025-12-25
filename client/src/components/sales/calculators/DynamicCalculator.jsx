import React, { useState, useEffect, useMemo, memo } from 'react';

const DynamicCalculator = memo(({ product, initialDetails, onUpdate }) => {
    // 1. Identify Attributes
    // Check if attributes are explicit in product (new schema) or need inference
    // For now, we rely on product.attributes being present for this component to be chosen.
    const attributeKeys = Object.keys(product.attributes || {});

    // 2. State for selections
    // { "Color": "Silver", "Length": "21ft" }
    const [selections, setSelections] = useState(() => {
        const initial = initialDetails?.selections ? { ...initialDetails.selections } : {};
        attributeKeys.forEach(key => {
            if (!initial[key]) { // Only set if not already in initialDetails
                if (product.defaultAttributes && product.defaultAttributes[key]) {
                    initial[key] = product.defaultAttributes[key];
                } else if (product.attributes[key] && product.attributes[key].length > 0) {
                    initial[key] = product.attributes[key][0];
                }
            }
        });
        return initial;
    });

    const [qty, setQty] = useState(initialDetails?.qty || 1);

    // 3. Effect: Auto-select first options if not set (This useEffect is now largely redundant due to useState initialization,
    // but kept for any edge cases where initialDetails might override defaults and then some attributes are still missing)
    useEffect(() => {
        const next = { ...selections };
        let changed = false;
        attributeKeys.forEach(key => {
            if (!next[key]) {
                const options = product.attributes[key] || [];
                if (options.length > 0) {
                    next[key] = options[0];
                    changed = true;
                }
            }
        });
        if (changed) setSelections(next);
    }, [product.attributes, selections, attributeKeys]);

    // 4. Find Matching Variant
    const activeVariant = useMemo(() => {
        if (!product.variants) return null;
        return product.variants.find(v => {
            return attributeKeys.every(k => v.attributes[k] === selections[k]);
        });
    }, [product.variants, selections, attributeKeys]);

    // 5. Pricing
    // If variant found, use its price. Else fallback to product default or 0
    const currentPrice = activeVariant ? activeVariant.price : (product.priceFull || product.price || 0);
    const hasStock = activeVariant ? (activeVariant.stock !== undefined ? activeVariant.stock : true) : true;
    const stockCount = activeVariant?.stock;

    // 6. Update Parent
    useEffect(() => {
        const total = qty * currentPrice;

        // Construct description
        const variantName = attributeKeys.map(k => selections[k]).join(' - ');

        onUpdate(total, {
            selections,
            qty,
            variantId: activeVariant?.id,
            description: variantName,
            isDynamic: true
        });
    }, [qty, currentPrice, selections, activeVariant, onUpdate, attributeKeys]);

    return (
        <div className="space-y-6">
            <div className="bg-white p-6 rounded-2xl border border-gray-100 shadow-sm space-y-6">
                {/* Attribute Selectors */}
                {attributeKeys.map(key => (
                    <div key={key}>
                        <h3 className="text-xs font-bold text-gray-500 uppercase tracking-wide mb-3">{key}</h3>
                        <div className="flex flex-wrap gap-2">
                            {product.attributes[key].map(opt => {
                                const isSelected = selections[key] === opt;
                                return (
                                    <button
                                        key={opt}
                                        onClick={() => setSelections(prev => ({ ...prev, [key]: opt }))}
                                        className={`px-4 py-2 rounded-lg text-sm font-bold border transition-all ${isSelected
                                            ? 'bg-blue-600 text-white border-blue-600 shadow-md ring-2 ring-blue-200'
                                            : 'bg-gray-50 text-gray-700 border-gray-200 hover:bg-white hover:border-gray-300'
                                            }`}
                                    >
                                        {opt}
                                    </button>
                                );
                            })}
                        </div>
                    </div>
                ))}
            </div>

            {/* Price & Stock Display */}
            <div className="bg-gray-50 p-6 rounded-2xl border border-gray-200 text-center">
                {activeVariant ? (
                    <div className="space-y-1">
                        <div className="text-3xl font-bold text-gray-900">Ksh{currentPrice.toLocaleString()}</div>
                        {stockCount !== undefined && (
                            <div className={`text-sm font-bold ${stockCount > 0 ? 'text-emerald-600' : 'text-red-500'}`}>
                                {stockCount > 0 ? `${stockCount} in Stock` : 'Out of Stock'}
                            </div>
                        )}
                    </div>
                ) : (
                    <div className="text-gray-400 italic">Variant unavailable</div>
                )}
            </div>

            {/* Quantity Selector */}
            <div className="flex items-center justify-center gap-6">
                <button
                    onClick={() => setQty(Math.max(1, qty - 1))}
                    className="w-14 h-14 rounded-xl bg-white border border-gray-200 text-2xl font-bold text-gray-500 hover:bg-gray-50 shadow-sm"
                >-</button>
                <div className="text-center">
                    <div className="text-4xl font-black text-gray-800 font-mono">{qty}</div>
                    <div className="text-xs font-bold text-gray-400 uppercase mt-1">Quantity</div>
                </div>
                <button
                    onClick={() => setQty(qty + 1)}
                    className="w-14 h-14 rounded-xl bg-blue-50 border border-blue-100 text-2xl font-bold text-blue-600 hover:bg-blue-100 shadow-sm"
                >+</button>
            </div>
        </div>
    );
});

export default DynamicCalculator;
