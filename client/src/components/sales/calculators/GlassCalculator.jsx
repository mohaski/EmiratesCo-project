
import React, { memo, useState, useMemo, useEffect } from 'react';
import { mmToSquareFeet, inchesToSquareFeet } from '../../../utils/calculations';

// --- SUB-COMPONENT: Glass Calculator (Refactored) ---
const GlassCalculator = memo(({ product, initialDetails, onUpdate }) => {

    // 1. EXTRACT AVAILABLE OPTIONS (Dynamic)
    const extraAttributes = useMemo(() => {
        const extras = {};
        // Identify attributes from schema (Exclude Color/Category)
        const attrKeys = Array.isArray(product.attributes)
            ? product.attributes
            : Object.keys(product.attributes || {});

        const allowedKeys = attrKeys.filter(key => key !== 'Category' && key !== 'Color');

        if (product.variants && product.variants.length > 0) {
            product.variants.forEach(v => {
                allowedKeys.forEach(key => {
                    const val = v.attributes?.[key];
                    if (val) {
                        if (!extras[key]) extras[key] = new Set();
                        extras[key].add(val);
                    }
                });
            });
        }
        // fallback for legacy thicknessPrices to simulate Thickness attribute
        else if (product.thicknessPrices?.length > 0) {
            extras['Thickness'] = new Set(product.thicknessPrices.map(t => t.thickness));
        }

        return Object.entries(extras).reduce((acc, [key, set]) => {
            acc[key] = Array.from(set).sort((a, b) => {
                const numA = parseFloat(String(a).replace(/[^\d.]/g, ''));
                const numB = parseFloat(String(b).replace(/[^\d.]/g, ''));
                if (!isNaN(numA) && !isNaN(numB)) return numA - numB;
                return String(a).localeCompare(String(b));
            });
            return acc;
        }, {});
    }, [product]);

    // 2. STATE
    const [fullQty, setFullQty] = useState(initialDetails?.fullSheet || 0);
    const [halfQty, setHalfQty] = useState(initialDetails?.halfSheet || 0);
    const [cutPieces, setCutPieces] = useState(initialDetails?.cutPieces || []);

    // --- State: Dynamic Attributes (e.g. Thickness) ---
    const [extraSelections, setExtraSelections] = useState(() => {
        if (initialDetails?.extras) return initialDetails.extras;
        const defaults = {};
        Object.keys(extraAttributes).forEach(key => {
            if (product.defaultAttributes && product.defaultAttributes[key]) {
                defaults[key] = product.defaultAttributes[key];
            } else if (extraAttributes[key] && extraAttributes[key].length > 0) {
                defaults[key] = extraAttributes[key][0];
            }
        });
        // Legacy fallback
        if (!defaults['Thickness'] && initialDetails?.thickness) {
            defaults['Thickness'] = initialDetails.thickness;
        }
        return defaults;
    });

    // Inputs for adding new cuts
    const [cutL, setCutL] = useState('');
    const [cutW, setCutW] = useState('');
    const [cutQty, setCutQty] = useState('');
    const [unit, setUnit] = useState('ft');

    // Sync Extras
    useEffect(() => {
        setExtraSelections(prev => {
            const next = { ...prev };
            let changed = false;
            Object.keys(extraAttributes).forEach(key => {
                if (!next[key] || !extraAttributes[key].includes(next[key])) {
                    next[key] = extraAttributes[key][0];
                    changed = true;
                }
            });
            return changed ? next : prev;
        });
    }, [extraAttributes]);

    // 3. PRICING
    const pricing = useMemo(() => {
        // Find matching variant
        let match = null;
        if (product.variants?.length > 0) {
            match = product.variants.find(v => {
                return Object.entries(extraSelections).every(([key, val]) => v.attributes?.[key] === val);
            });
        }

        // Legacy fallback check (if utilizing thicknessPrices map)
        if (!match && product.thicknessPrices && extraSelections['Thickness']) {
            match = product.thicknessPrices.find(t => t.thickness === extraSelections['Thickness']);
        }

        if (match) {
            return {
                priceFull: match.details?.priceFull || match.priceFull || 0,
                priceHalf: match.details?.priceHalf || match.priceHalf || 0,
                priceSqFt: match.details?.priceUnit || match.priceSqFt || match.priceFoot || 0
            };
        }

        return {
            priceFull: product.priceFullSheet || 0,
            priceHalf: product.priceHalfSheet || 0,
            priceSqFt: product.priceSqFt || 0
        };
    }, [product, extraSelections]);

    // Update Parent
    useEffect(() => {
        const fullTotal = fullQty * pricing.priceFull;
        const halfTotal = halfQty * pricing.priceHalf;
        const cutsCost = cutPieces.reduce((sum, cut) => sum + (cut.area * cut.q * pricing.priceSqFt), 0);

        // --- UNIVERSAL SCHEMA GENERATION ---
        const lineItems = [];
        const attributes = [];

        // 1. Line Items
        if (fullQty > 0) {
            lineItems.push({
                type: 'sheet-full',
                label: 'Full Sheet',
                qty: fullQty,
                rate: pricing.priceFull,
                total: fullTotal,
                meta: {}
            });
        }
        if (halfQty > 0) {
            lineItems.push({
                type: 'sheet-half',
                label: 'Half Sheet',
                qty: halfQty,
                rate: pricing.priceHalf,
                total: halfTotal,
                meta: {}
            });
        }

        // Add each cut as a line item
        cutPieces.forEach(cut => {
            lineItems.push({
                type: 'glass-cut',
                label: `${cut.label}`, // e.g. "Cut: 24x24 ft"
                qty: cut.q,
                rate: (cut.area * pricing.priceSqFt), // Rate per piece (Area * RateSqFt)
                total: (cut.area * cut.q * pricing.priceSqFt),
                meta: {
                    l: cut.l, w: cut.w, u: cut.u, area: cut.area,
                    rateSqFt: pricing.priceSqFt
                }
            });
        });

        // 2. Attributes
        if (extraSelections['Thickness']) attributes.push({ label: 'Thickness', value: extraSelections['Thickness'] });
        Object.entries(extraSelections).forEach(([key, val]) => {
            if (key !== 'Thickness') attributes.push({ label: key, value: val });
        });

        onUpdate(fullTotal + halfTotal + cutsCost, {
            // Universal Schema
            lineItems,
            attributes,

            // Legacy / Specific Fields
            thickness: extraSelections['Thickness'] || '',
            fullSheet: fullQty,
            halfSheet: halfQty,
            cutPieces: cutPieces.map(c => ({ ...c, rate: pricing.priceSqFt, totalPrice: c.area * c.q * pricing.priceSqFt })),
            glassItems: [],
            extras: extraSelections,

            // Snapshot current rates
            priceFull: pricing.priceFull,
            priceHalf: pricing.priceHalf,
            priceSqFt: pricing.priceSqFt
        });
    }, [fullQty, halfQty, cutPieces, pricing, extraSelections, onUpdate]);

    // Helpers
    const getArea = (l, w, u) => {
        if (u === 'ft') return l * w;
        if (u === 'mm') return mmToSquareFeet(l, w);
        if (u === 'inch') return inchesToSquareFeet(l, w)
        return 0;
    };

    const addCut = () => {
        if (!cutL || !cutW || !cutQty) return;
        const l = parseFloat(cutL), w = parseFloat(cutW), q = parseFloat(cutQty);
        const area = getArea(l, w, unit);
        const newItem = { l, w, q, u: unit, area, label: `Cut: ${l}x${w}${unit}` };
        setCutPieces(prev => [...prev, newItem]);
        setCutL(''); setCutW(''); setCutQty('');
    };

    const removeCut = (index) => setCutPieces(prev => prev.filter((_, i) => i !== index));

    return (
        <div className="space-y-3">
            {/* DYNAMIC ATTRIBUTE SELECTORS */}
            {Object.entries(extraAttributes).length > 0 && (
                <div className="space-y-2">
                    {Object.entries(extraAttributes).map(([key, options]) => (
                        <div key={key} className="bg-blue-50/30 p-2 rounded-xl border border-blue-50">
                            {/* Header Removed/Simplified */}
                            <div className="flex justify-between items-center mb-1">
                                {key === 'Thickness' && <span className="text-[10px] font-mono text-gray-400">Rate: Ksh{pricing.priceSqFt}/sqft</span>}
                            </div>
                            <div className="flex gap-1.5 flex-wrap">
                                {options.map(opt => (
                                    <button
                                        key={opt}
                                        onClick={() => setExtraSelections(prev => ({ ...prev, [key]: opt }))}
                                        className={`px-3 py-1 rounded-lg text-xs font-bold border transition-all shadow-sm ${extraSelections[key] === opt
                                            ? 'bg-blue-600 text-white border-blue-600 shadow-blue-200'
                                            : 'bg-white text-gray-600 border-gray-200 hover:bg-gray-50'
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

            {/* Standard Sheets Adder */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <div className="bg-gray-50 p-4 rounded-2xl border border-gray-200 flex flex-col gap-2 shadow-sm">
                    <div className="flex justify-between items-center">
                        <h4 className="font-bold text-gray-800">Full Sheet</h4>
                        <p className="text-xs text-blue-600 font-bold">Ksh{pricing.priceFull}</p>
                    </div>
                    <div className="flex items-center gap-2">
                        <div className="flex items-center bg-white rounded-lg p-1 border border-gray-200 flex-1">
                            <button onClick={() => setFullQty(Math.max(0, fullQty - 1))} className="w-8 h-8 rounded-md bg-gray-100 text-gray-600 hover:bg-gray-200">-</button>
                            <input type="number" value={fullQty} onChange={e => setFullQty(Math.max(0, parseInt(e.target.value) || 0))} className="w-full text-center bg-transparent text-gray-800 font-mono focus:outline-none font-bold" />
                            <button onClick={() => setFullQty(fullQty + 1)} className="w-8 h-8 rounded-md bg-blue-50 text-blue-600 hover:bg-blue-100">+</button>
                        </div>
                    </div>
                </div>

                {/* Half Sheet Toggle */}
                <div className="bg-gray-50 p-3 rounded-xl border border-gray-200 flex flex-col justify-center shadow-sm">
                    <div className="flex justify-between items-center h-full">
                        <div>
                            <h4 className="font-bold text-gray-800 text-sm">Half Sheet</h4>
                            <p className="text-xs text-blue-600 font-bold">Ksh{pricing.priceHalf}</p>
                        </div>
                        <button
                            onClick={() => setHalfQty(halfQty > 0 ? 0 : 1)}
                            className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors focus:outline-none ${halfQty > 0 ? 'bg-blue-600' : 'bg-gray-200'}`}
                        >
                            <span className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${halfQty > 0 ? 'translate-x-6' : 'translate-x-1'}`} />
                        </button>
                    </div>
                </div>
            </div>

            {/* Cut Pieces Adder */}
            <div className="bg-gray-50 p-5 rounded-2xl border border-gray-200 shadow-sm">
                <div className="flex items-center justify-between mb-4">
                    <h3 className="text-lg font-bold text-gray-800 flex items-center gap-2"><span>📐</span> Cut Pieces</h3>
                    <div className="flex bg-white rounded-lg p-1 border border-gray-200 shadow-sm">
                        {['ft', 'inch', 'mm'].map(u => (
                            <button key={u} onClick={() => setUnit(u)} className={`px-3 py-1 rounded-md text-sm font-bold transition-all ${unit === u ? 'bg-blue-600 text-white' : 'text-gray-500 hover:bg-gray-100'}`}>{u}</button>
                        ))}
                    </div>
                </div>
                <div className="grid grid-cols-12 gap-2 mb-4 bg-white p-2 rounded-xl border border-gray-200 items-center shadow-sm">
                    <div className="col-span-3"><input type="number" placeholder="L" value={cutL} onChange={e => setCutL(e.target.value)} className="w-full bg-gray-50 border border-gray-200 rounded-lg px-2 py-2 text-sm focus:ring-1 focus:ring-blue-500 outline-none" /></div>
                    <div className="col-span-3"><input type="number" placeholder="W" value={cutW} onChange={e => setCutW(e.target.value)} className="w-full bg-gray-50 border border-gray-200 rounded-lg px-2 py-2 text-sm focus:ring-1 focus:ring-blue-500 outline-none" /></div>
                    <div className="col-span-2"><input type="number" placeholder="Qty" value={cutQty} onChange={e => setCutQty(e.target.value)} className="w-full bg-gray-50 border border-gray-200 rounded-lg px-2 py-2 text-sm focus:ring-1 focus:ring-blue-500 outline-none text-center" /></div>
                    <div className="col-span-4"><button onClick={addCut} className="w-full bg-blue-600 hover:bg-blue-700 text-white rounded-lg py-2 text-sm font-bold shadow-sm">Add</button></div>
                </div>
            </div>

            {/* List of Added Items */}
            <div className="bg-white rounded-xl border border-gray-200 overflow-hidden shadow-sm">
                <div className="bg-gray-50 px-4 py-3 border-b border-gray-100"><h3 className="text-sm font-bold text-gray-800">📦 Order Summary</h3></div>
                <div className="max-h-56 overflow-y-auto custom-scrollbar p-0">
                    {/* Full Sheet Entry */}
                    {fullQty > 0 && (
                        <div className="flex items-center justify-between p-3 border-b border-gray-50 hover:bg-gray-50">
                            <div>
                                <p className="font-bold text-gray-800 text-sm">Full Sheet ({pricing.priceFull > 0 ? '' : 'Base'})</p>
                                <p className="text-xs text-gray-500 font-mono">Qty: {fullQty} | Rate: Ksh{pricing.priceFull}</p>
                            </div>
                            <span className="font-bold text-blue-600">Ksh{(fullQty * pricing.priceFull).toLocaleString()}</span>
                        </div>
                    )}

                    {/* Half Sheet Entry */}
                    {halfQty > 0 && (
                        <div className="flex items-center justify-between p-3 border-b border-gray-50 hover:bg-gray-50">
                            <div>
                                <p className="font-bold text-gray-800 text-sm">Half Sheet</p>
                                <p className="text-xs text-gray-500 font-mono">Qty: {halfQty} | Rate: Ksh{pricing.priceHalf}</p>
                            </div>
                            <span className="font-bold text-blue-600">Ksh{(halfQty * pricing.priceHalf).toLocaleString()}</span>
                        </div>
                    )}

                    {/* Cut Pieces */}
                    {cutPieces.map((cut, idx) => (
                        <div key={idx} className="flex items-center justify-between p-3 border-b border-gray-50 hover:bg-gray-50 group">
                            <div>
                                <p className="font-bold text-gray-800 text-sm">{cut.label}</p>
                                <p className="text-xs text-gray-500 font-mono">Qty: {cut.q} | Area: {cut.area.toFixed(2)}sqft</p>
                            </div>
                            <div className="flex items-center gap-3">
                                <span className="font-bold text-blue-600">Ksh{(cut.area * cut.q * pricing.priceSqFt).toFixed(0)}</span>
                                <button onClick={() => removeCut(idx)} className="text-gray-400 hover:text-red-500 opacity-0 group-hover:opacity-100 transition-opacity">×</button>
                            </div>
                        </div>
                    ))}

                    {fullQty === 0 && halfQty === 0 && cutPieces.length === 0 && (
                        <div className="p-8 text-center text-gray-400 text-sm">No items added yet</div>
                    )}
                </div>
            </div>
        </div>
    );
});

export default GlassCalculator;
