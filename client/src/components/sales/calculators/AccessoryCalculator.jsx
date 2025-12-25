import React, { useState, useEffect, memo } from 'react';

const AccessoryCalculator = memo(({ product, initialDetails, onUpdate }) => {
    const isMeter = product.unit === 'meter';
    const hasColor = product.hasColor;
    const hasThickness = product.thicknesses && product.thicknesses.length > 0;

    // Support either enhanced rollOptions OR legacy single priceRoll
    const rollOptions = product.rollOptions || (product.priceRoll ? [{ label: 'Standard Roll', length: product.rollLength, price: product.priceRoll }] : []);
    const hasRollOption = isMeter && rollOptions.length > 0;

    // Constants
    const ACCESSORY_COLORS = ['Black', 'Grey', 'White', 'Silver', 'Brown'];

    // State
    const [salesMode, setSalesMode] = useState(initialDetails?.salesMode || 'roll'); // 'meter' or 'roll'
    const [qty, setQty] = useState(initialDetails?.qty || 1);
    const [length, setLength] = useState(initialDetails?.length || (isMeter ? 1 : 0));
    const [color, setColor] = useState(initialDetails?.color || (hasColor ? 'Black' : null));
    const [thickness, setThickness] = useState(initialDetails?.thickness || (hasThickness ? product.thicknesses[0] : null));
    const [selectedRoll, setSelectedRoll] = useState(initialDetails?.selectedRoll || (hasRollOption ? rollOptions[0] : null));

    useEffect(() => {
        let total = 0;
        const lineItems = [];
        const attributes = [];

        // Attributes
        if (color) attributes.push({ label: 'Color', value: color });
        if (thickness) attributes.push({ label: 'Thickness', value: thickness });

        // Mode Switching Logic
        if (hasRollOption && salesMode === 'roll') {
            // Selling by Roll
            const price = selectedRoll?.price || 0;
            total = qty * price;

            lineItems.push({
                type: 'accessory-roll',
                label: selectedRoll?.label || 'Roll',
                qty: qty,
                rate: price,
                total: total,
                meta: { length: selectedRoll?.length }
            });
            if (selectedRoll?.label) attributes.push({ label: 'Roll Type', value: selectedRoll.label });

        } else if (isMeter) {
            // Selling by Meter
            const price = product.price;
            total = length * price;

            lineItems.push({
                type: 'accessory-meter',
                label: 'Meter Length',
                qty: length, // Length is basically quantity here
                rate: price,
                total: total,
                meta: { unit: 'm' }
            });

        } else {
            // Standard Unit Item
            const price = product.price;
            total = qty * price;

            lineItems.push({
                type: 'accessory-unit',
                label: 'Quantity',
                qty: qty,
                rate: price,
                total: total,
                meta: { unit: product.unit }
            });
        }

        onUpdate(total, {
            // Universal Schema
            lineItems,
            attributes,

            // Legacy
            qty: (hasRollOption && salesMode === 'roll') ? qty : (isMeter ? 1 : qty),
            length: (isMeter && salesMode === 'meter') ? length : null,
            color: color,
            thickness: thickness,
            unit: (hasRollOption && salesMode === 'roll') ? 'roll' : product.unit,
            salesMode: (hasRollOption) ? salesMode : null,
            rollLength: (hasRollOption && salesMode === 'roll') ? selectedRoll?.length : null,
            rollLabel: (hasRollOption && salesMode === 'roll') ? selectedRoll?.label : null
        });
    }, [qty, length, color, thickness, selectedRoll, product, isMeter, salesMode, hasRollOption, onUpdate]);

    return (
        <div className="space-y-3">
            {/* Color Selector */}
            {hasColor && (
                <div className="bg-gray-50 p-2 rounded-lg border border-gray-200">
                    <h3 className="text-xs font-bold text-gray-700 uppercase tracking-wide mb-2">Select Color</h3>
                    <div className="flex gap-1">
                        {ACCESSORY_COLORS.map(c => (
                            <button
                                key={c}
                                onClick={() => setColor(c)}
                                className={`flex items-center gap-1.5 px-2 py-1.5 rounded-md border transition-all ${color === c
                                    ? 'bg-white border-blue-500 ring-1 ring-blue-500 shadow-sm'
                                    : 'bg-white border-gray-200 hover:bg-gray-50'
                                    }`}
                            >
                                <span
                                    className="w-3 h-3 rounded-full border border-gray-200 shadow-inner"
                                    style={{
                                        background: c === 'Silver' ? 'linear-gradient(135deg, #f5f7fa 0%, #c3cfe2 100%)' :
                                            c === 'Gold' ? 'linear-gradient(135deg, #fceabb 0%, #f8b500 100%)' :
                                                c === 'Grey' ? '#808080' :
                                                    c === 'Black' ? '#222' :
                                                        c === 'Brown' ? '#8B4513' : c
                                    }}
                                ></span>
                                <span className={`text-xs font-semibold tracking-wide ${color === c ? 'text-gray-900' : 'text-gray-500'}`}>{c}</span>
                            </button>
                        ))}
                    </div>
                </div>
            )}

            {/* Thickness Selector */}
            {hasThickness && (
                <div className="bg-gray-50 p-2 rounded-lg border border-gray-200">
                    <h3 className="text-xs font-bold text-gray-700 uppercase tracking-wide mb-2">Thickness</h3>
                    <div className="flex gap-1">
                        {product.thicknesses.map(t => (
                            <button
                                key={t}
                                onClick={() => setThickness(t)}
                                className={`px-2 py-1 rounded text-xs font-bold transition-all border ${thickness === t
                                    ? 'bg-white border-blue-500 text-blue-600 shadow-sm'
                                    : 'bg-white border-gray-200 text-gray-600 hover:bg-gray-50'
                                    }`}
                            >
                                {t}
                            </button>
                        ))}
                    </div>
                </div>
            )}

            {/* Input Section */}
            <div className="bg-white p-4 rounded-xl border border-gray-100 shadow-lg shadow-blue-900/5 flex flex-col items-center justify-center relative overflow-hidden group">
                <div className="absolute top-0 left-0 w-full h-1 bg-gradient-to-r from-blue-400 to-purple-400 opacity-50"></div>

                {/* Roll vs Meter Toggle */}
                {hasRollOption && (
                    <div className="w-full max-w-xs mb-4">
                        {/* Toggle Switch */}
                        <div className="flex bg-gray-100 p-1 rounded-lg relative">
                            <button
                                onClick={() => setSalesMode('roll')}
                                className={`flex-1 py-1 rounded text-xs font-bold transition-all z-10 ${salesMode === 'roll' ? 'bg-white text-blue-600 shadow-sm' : 'text-gray-500 hover:text-gray-700'}`}
                            >
                                Full Roll
                            </button>
                            <button
                                onClick={() => setSalesMode('meter')}
                                className={`flex-1 py-1 rounded text-xs font-bold transition-all z-10 ${salesMode === 'meter' ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-700'}`}
                            >
                                Per Meter
                            </button>
                        </div>

                        {/* Sub-Selection for Roll Type (Big vs Small) */}
                        {salesMode === 'roll' && rollOptions.length > 1 && (
                            <div className="mt-2 flex gap-1 justify-center animate-fade-in">
                                {rollOptions.map((opt) => (
                                    <button
                                        key={opt.label}
                                        onClick={() => setSelectedRoll(opt)}
                                        className={`px-3 py-1 rounded text-[10px] font-bold border transition-all ${selectedRoll?.label === opt.label
                                            ? 'bg-blue-50 border-blue-200 text-blue-700'
                                            : 'bg-white border-gray-100 text-gray-500 hover:bg-gray-50'
                                            }`}
                                    >
                                        {opt.label} ({opt.length}m)
                                    </button>
                                ))}
                            </div>
                        )}
                    </div>
                )}

                {/* Meter Logic */}
                {isMeter && salesMode === 'meter' && (
                    <>
                        <h3 className="text-[10px] font-bold text-gray-400 uppercase tracking-widest mb-3">Total Length (Meters)</h3>
                        <div className="flex items-center gap-4 mb-2">
                            <button onClick={() => setLength(Math.max(1, length - 1))} className="w-10 h-10 rounded-xl bg-white hover:bg-gray-50 text-lg text-gray-400 hover:text-gray-600 border border-gray-200 shadow-sm font-bold transition-all active:scale-95">-</button>
                            <div className="flex flex-col items-center">
                                <input
                                    type="number"
                                    value={length}
                                    onChange={(e) => setLength(Math.max(0, parseFloat(e.target.value) || 0))}
                                    className="w-24 text-center bg-transparent border-none p-0 text-3xl font-black text-gray-800 font-mono focus:ring-0"
                                />
                                <span className="text-xs font-bold text-gray-400">meters</span>
                            </div>
                            <button onClick={() => setLength(length + 1)} className="w-10 h-10 rounded-xl bg-blue-50 hover:bg-blue-100 text-lg text-blue-600 hover:text-blue-700 border border-blue-100 shadow-sm font-bold transition-all active:scale-95">+</button>
                        </div>
                    </>
                )}

                {/* Quantity Logic (Rolls or Standard Items) */}
                {(!isMeter || (hasRollOption && salesMode === 'roll')) && (
                    <>
                        <h3 className="text-[10px] font-bold text-gray-400 uppercase tracking-widest mb-3">
                            {hasRollOption && salesMode === 'roll' ? 'Number of Rolls' : `Quantity (${product.unit}s)`}
                        </h3>
                        <div className="flex items-center gap-4 mb-2">
                            <button onClick={() => setQty(Math.max(1, qty - 1))} className="w-10 h-10 rounded-xl bg-white hover:bg-gray-50 text-lg text-gray-400 hover:text-gray-600 border border-gray-200 shadow-sm font-bold transition-all active:scale-95">-</button>
                            <span className="text-3xl font-black text-gray-800 font-mono w-16 text-center">{qty}</span>
                            <button onClick={() => setQty(qty + 1)} className="w-10 h-10 rounded-xl bg-blue-50 hover:bg-blue-100 text-lg text-blue-600 hover:text-blue-700 border border-blue-100 shadow-sm font-bold transition-all active:scale-95">+</button>
                        </div>
                        {(hasRollOption && salesMode === 'roll') && (
                            <p className="text-[10px] text-blue-500 font-bold mb-2">1 {selectedRoll?.label || 'Roll'} = {selectedRoll?.length} Meters</p>
                        )}
                    </>
                )}

                {/* Dynamic Price Summary */}
                <div className="mt-4 flex flex-col items-center animate-fade-in">
                    <p className="text-xs font-medium text-gray-400 mb-1">
                        {hasRollOption && salesMode === 'roll'
                            ? `${qty} x ${selectedRoll?.label || 'Roll'} @ Ksh${selectedRoll?.price}/roll` // Roll Price
                            : isMeter
                                ? `${length} meters × Ksh${product.price}/${product.unit}` // Meter Price
                                : `${qty} ${product.unit}s × Ksh${product.price}/${product.unit}` // Standard Price
                        }
                    </p>
                    <div className="px-3 py-1 bg-blue-50 text-blue-700 rounded-full text-xs font-bold border border-blue-100">
                        Total: Ksh{(
                            (hasRollOption && salesMode === 'roll') ? qty * (selectedRoll?.price || 0) :
                                (isMeter ? length * product.price : qty * product.price)
                        ).toLocaleString()}
                    </div>
                </div>
            </div>
        </div>
    );
});

export default AccessoryCalculator;
