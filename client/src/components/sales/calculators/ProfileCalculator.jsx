import React, { useState, useEffect, useMemo, memo } from 'react';

const TrashIcon = () => (
    <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" viewBox="0 0 20 20" fill="currentColor">
        <path fillRule="evenodd" d="M9 2a1 1 0 00-.894.553L7.382 4H4a1 1 0 000 2v10a2 2 0 002 2h8a2 2 0 002-2V6a1 1 0 100-2h-3.382l-.724-1.447A1 1 0 0011 2H9zM7 8a1 1 0 012 0v6a1 1 0 11-2 0V8zm5-1a1 1 0 00-1 1v6a1 1 0 102 0V8a1 1 0 00-1-1z" clipRule="evenodd" />
    </svg>
);

const ProfileCalculator = memo(({ product, color, initialDetails, onUpdate }) => {
    // 1. EXTRACT AVAILABLE OPTIONS (Based on Product Schema)
    const extraAttributes = useMemo(() => {
        const extras = {};

        // Identify attributes from schema (Exclude Color/Category)
        const attrKeys = Array.isArray(product.attributes)
            ? product.attributes
            : Object.keys(product.attributes || {});

        const allowedKeys = attrKeys.filter(key => key !== 'Color' && key !== 'Category');

        if (product.variants && product.variants.length > 0) {
            product.variants.forEach(v => {
                // strict color filtering
                if (color && v.attributes?.Color) {
                    if (v.attributes.Color !== color) return;
                }

                // Collect allowed attributes
                allowedKeys.forEach(key => {
                    const val = v.attributes?.[key];
                    if (val) {
                        if (!extras[key]) extras[key] = new Set();
                        extras[key].add(val);
                    }
                });
            });
        }

        // Convert Sets to sorted Arrays
        return Object.entries(extras).reduce((acc, [key, set]) => {
            acc[key] = Array.from(set).sort((a, b) => {
                // Numeric sort for Length using regex to support '21ft'
                const numA = parseFloat(String(a).replace(/[^\d.]/g, ''));
                const numB = parseFloat(String(b).replace(/[^\d.]/g, ''));
                if (!isNaN(numA) && !isNaN(numB)) {
                    if (key === 'Length') return numB - numA; // Descending for Length
                    return numA - numB; // Ascending for others
                }
                return String(a).localeCompare(String(b));
            });
            // Reverse Length for typical "Largest First" display if desired? 
            if (key === 'Length' && acc[key][0] < acc[key][acc[key].length - 1]) acc[key].reverse();
            return acc;
        }, {});
    }, [product, color]);

    // 2. STATE
    const [fullQty, setFullQty] = useState(initialDetails?.full || 0);
    const [halfQty, setHalfQty] = useState(initialDetails?.half || 0);
    const [feet, setFeet] = useState(initialDetails?.feet || 0);

    // --- State: Dynamic Attributes (e.g. Color, Length) ---
    // Initialize with defaults if available
    const [extraSelections, setExtraSelections] = useState(() => {
        const defaults = {};
        Object.keys(extraAttributes).forEach(key => {
            if (product.defaultAttributes && product.defaultAttributes[key]) {
                defaults[key] = product.defaultAttributes[key];
            } else if (extraAttributes[key] && extraAttributes[key].length > 0) {
                // If checking 'Color', DO NOT default to first option automatically
                // Only default others like Length/Thickness if desired
                if (key !== 'Color') {
                    defaults[key] = extraAttributes[key][0];
                }
            }
        });
        // Merge with initialDetails if provided
        return initialDetails?.extras ? { ...defaults, ...initialDetails.extras } : defaults;
    });

    // Update selections if defaults change (unlikely but good practice) or product changes
    useEffect(() => {
        setExtraSelections(prev => {
            const next = { ...prev };
            Object.keys(extraAttributes).forEach(key => {
                // If current selection is invalid for new product, reset
                if (!extraAttributes[key].includes(next[key])) {
                    if (product.defaultAttributes && product.defaultAttributes[key]) {
                        next[key] = product.defaultAttributes[key];
                    } else if (extraAttributes[key].length > 0) {
                        next[key] = extraAttributes[key][0];
                    }
                }
            });
            return next;
        });
    }, [product, extraAttributes]);

    // Sync Extras if attributes change (e.g. switching color changes available sizes)
    useEffect(() => {
        setExtraSelections(prev => {
            const next = { ...prev };
            let changed = false;
            Object.keys(extraAttributes).forEach(key => {
                // Determine if we should auto-select:
                // If 'Color', don't auto-select unless we have a prior valid selection or default
                if (!next[key] || !extraAttributes[key].includes(next[key])) {
                    if (key !== 'Color') {
                        next[key] = extraAttributes[key][0];
                        changed = true;
                    } else {
                        // For Color, if invalid, leave undefined (force user selection)
                        // Unless there's only 1 option? Common UX pattern is usually force selection.
                        // User asked to remove default selection for color.
                        delete next[key];
                        changed = true;
                    }
                }
            });
            return changed ? next : prev;
        });
    }, [extraAttributes]);

    // Derived Numeric Length for Calculation (if Length is selected)
    const selectedLengthNum = useMemo(() => {
        if (extraSelections['Length']) {
            const val = parseInt(String(extraSelections['Length']).replace(/\D/g, ''));
            return val || 0;
        }
        return 0; // fallback if no length attribute
    }, [extraSelections]);

    // 3. DETERMINE ACTIVE PRICING BASED ON SELECTION
    const pricing = useMemo(() => {
        let matchingVariant = null;

        if (product.variants) {
            matchingVariant = product.variants.find(v => {
                // 1. Color Check
                if (color && v.attributes?.Color) {
                    if (v.attributes.Color !== color) return false;
                }

                // 2. All Extra Attributes Check (Includes Length if present)
                const extrasMatch = Object.entries(extraSelections).every(([key, val]) => {
                    return v.attributes && v.attributes[key] === val;
                });
                if (!extrasMatch) return false;

                return true;
            });
        }

        if (matchingVariant) {
            const pFull = matchingVariant.details?.priceFull || matchingVariant.price || product.priceFull || 0;
            const pHalf = matchingVariant.details?.priceHalf || (matchingVariant.price ? matchingVariant.price / 2 : 0) || product.priceHalf || 0;

            // Per Foot Calculation
            let pFoot = matchingVariant.details?.priceUnit || product.priceFoot || 0;

            if (!pFoot && selectedLengthNum > 0 && matchingVariant.price) {
                pFoot = matchingVariant.price / selectedLengthNum;
            }

            return {
                priceFull: pFull,
                priceHalf: pHalf,
                priceFoot: pFoot
            };
        }

        // Fallback to Root Product Prices
        return {
            priceFull: product.priceFull || 0,
            priceHalf: product.priceHalf || 0,
            priceFoot: product.priceFoot || 0
        };

    }, [product, color, extraSelections, selectedLengthNum]);


    // 4. UPDATE PARENT
    useEffect(() => {
        const total = (fullQty * pricing.priceFull) +
            (halfQty * pricing.priceHalf) +
            (feet * pricing.priceFoot);

        // --- UNIVERSAL SCHEMA GENERATION ---
        const lineItems = [];
        const attributes = [];

        // 1. Line Items (The Receipt)
        if (fullQty > 0) {
            lineItems.push({
                type: 'profile-full',
                label: 'Full Length',
                qty: fullQty,
                rate: pricing.priceFull,
                total: fullQty * pricing.priceFull,
                meta: { length: extraSelections['Length'] }
            });
        }
        if (halfQty > 0) {
            lineItems.push({
                type: 'profile-half',
                label: 'Half Length',
                qty: halfQty,
                rate: pricing.priceHalf,
                total: halfQty * pricing.priceHalf,
                meta: { length: extraSelections['Length'] }
            });
        }
        if (feet > 0) {
            lineItems.push({
                type: 'profile-feet',
                label: `Custom Feet (${feet}ft)`,
                qty: feet,
                rate: pricing.priceFoot,
                total: feet * pricing.priceFoot,
                meta: { unit: 'ft' }
            });
        }

        // 2. Attributes (Display Tags)
        if (color) attributes.push({ label: 'Color', value: color });
        if (extraSelections['Length']) attributes.push({ label: 'Length', value: extraSelections['Length'] });

        Object.entries(extraSelections).forEach(([key, val]) => {
            if (key !== 'Length' && key !== 'Color') {
                attributes.push({ label: key, value: val });
            }
        });

        onUpdate(total, {
            // New Universal Format
            lineItems,
            attributes,

            // Legacy / Specific Fields (Kept for compatibility until Phase 3)
            full: fullQty,
            half: halfQty,
            feet: feet,
            color: color || 'White',
            length: extraSelections['Length'] || null,
            extras: extraSelections,
            unitPrice: pricing.priceFull,
            priceFull: pricing.priceFull,
            priceHalf: pricing.priceHalf,
            priceFoot: pricing.priceFoot
        });
    }, [fullQty, halfQty, feet, pricing, color, extraSelections, onUpdate]);

    const handleExtraChange = (key, val) => {
        setExtraSelections(prev => ({ ...prev, [key]: val }));
    };

    return (
        <div className="space-y-3">
            {/* DYNAMIC ATTRIBUTE SELECTORS (Includes Length if defined in attributes) */}
            {Object.entries(extraAttributes).length > 0 && (
                <div className="space-y-2">
                    {Object.entries(extraAttributes).map(([key, options]) => (
                        <div key={key} className="space-y-1">
                            {/* Header Removed per user request */}
                            <div className="flex flex-wrap gap-1.5">
                                {options.map(opt => (
                                    <button
                                        key={opt}
                                        onClick={() => handleExtraChange(key, opt)}
                                        className={`px-3 py-1.5 rounded-md text-xs font-bold border transition-all ${extraSelections[key] === opt
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

            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                {/* Standard Lengths */}
                <div className="bg-gray-50 p-5 rounded-xl border border-gray-200">
                    <h3 className="text-lg font-bold text-gray-800 mb-4 flex items-center gap-2"><span>📏</span> Standard Lengths</h3>
                    <div className="space-y-4">
                        <div className="flex items-center justify-between">
                            <div><p className="text-gray-600 font-medium">Full Length</p><p className="text-xs text-blue-600 font-bold">Ksh{pricing.priceFull}/pc</p></div>
                            <div className="flex items-center bg-white rounded-lg p-1 border border-gray-200 shadow-sm">
                                <button onClick={() => setFullQty(Math.max(0, fullQty - 1))} className="w-8 h-8 rounded-md bg-gray-100 text-gray-600 hover:bg-gray-200">-</button>
                                <input type="number" value={fullQty} onChange={(e) => setFullQty(Number(e.target.value))} className="w-12 text-center bg-transparent text-gray-800 font-mono focus:outline-none font-bold" />
                                <button onClick={() => setFullQty(fullQty + 1)} className="w-8 h-8 rounded-md bg-blue-50 text-blue-600 hover:bg-blue-100">+</button>
                            </div>
                        </div>
                        <div className="flex items-center justify-between pt-2 border-t border-gray-200">
                            <div><p className="text-gray-600 font-medium">Half Length</p><p className="text-xs text-blue-600 font-bold">Ksh{pricing.priceHalf}/pc</p></div>
                            <div className="flex items-center">
                                <button
                                    onClick={() => setHalfQty(halfQty > 0 ? 0 : 1)}
                                    className={`relative inline-flex h-8 w-14 items-center rounded-full transition-colors focus:outline-none ${halfQty > 0 ? 'bg-blue-600' : 'bg-gray-200'}`}
                                >
                                    <span className={`inline-block h-6 w-6 transform rounded-full bg-white transition-transform ${halfQty > 0 ? 'translate-x-7' : 'translate-x-1'}`} />
                                </button>
                            </div>
                        </div>
                    </div>
                </div>

                {/* Custom Cut */}
                <div className="bg-gray-50 p-5 rounded-xl border border-gray-200">
                    <h3 className="text-lg font-bold text-gray-800 mb-4 flex items-center gap-2"><span>✂️</span> Custom Cut</h3>
                    <div className="flex flex-col gap-2">
                        <label className="text-sm text-gray-500 font-medium">Total Feet Needed</label>
                        <div className="flex items-center gap-2">
                            <input type="number" value={feet} onChange={(e) => setFeet(Number(e.target.value))} className="w-full border border-gray-300 rounded-xl px-4 py-3 text-gray-800 text-lg font-mono focus:ring-2 focus:ring-blue-500/50 outline-none bg-white shadow-sm" placeholder="0" />
                            <span className="text-gray-500 font-bold">ft</span>
                        </div>
                        <p className="text-right text-xs text-blue-600 font-bold mt-1">Ksh{pricing.priceFoot} / ft</p>
                    </div>
                </div>
            </div>
        </div>
    );
});

export default ProfileCalculator;
