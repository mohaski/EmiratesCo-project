import { useState, useEffect, useMemo, useCallback, memo } from 'react';

function mmToSquareFeet(lengthMm, widthMm) {
    const MM_TO_FEET = 304.79999025;

    function roundToHalfWithRule(value) {
        const decimalPart = value - Math.floor(value);

        if (decimalPart >= 0.1) {
            // Roof (ceil) to nearest 0.5
            return Math.ceil(value * 2) / 2;
        } else {
            // Floor to nearest 0.5
            return Math.floor(value * 2) / 2;
        }
    }



    // Convert mm to feet
    const lengthFeet = lengthMm / MM_TO_FEET;
    const widthFeet = widthMm / MM_TO_FEET;

    // Apply rounding rule
    const roundedLength = roundToHalfWithRule(lengthFeet);
    const roundedWidth = roundToHalfWithRule(widthFeet);

    // Square feet
    return roundedLength * roundedWidth;
}

function inchesToSquareFeet(lengthInch, widthInch) {
    const INCHES_TO_FEET = 12;

    function roundToHalfWithRule(value) {
        const decimalPart = value - Math.floor(value);

        if (decimalPart >= 0.1) {
            // Roof (ceil) to nearest 0.5
            return Math.ceil(value * 2) / 2;
        } else {
            // Floor to nearest 0.5
            return Math.floor(value * 2) / 2;
        }
    }

    // Convert inches to feet
    const lengthFeet = lengthInch / INCHES_TO_FEET;
    const widthFeet = widthInch / INCHES_TO_FEET;

    // Apply rounding rule
    const roundedLength = roundToHalfWithRule(lengthFeet);
    const roundedWidth = roundToHalfWithRule(widthFeet);

    // Return square feet
    return roundedLength * roundedWidth;
}



// --- SUB-COMPONENT: Standard Calculator (Simple Items) ---
const StandardCalculator = memo(({ product, initialDetails, onUpdate }) => {
    const [qty, setQty] = useState(initialDetails?.qty || 1);

    useEffect(() => {
        const total = qty * product.price;
        onUpdate(total, { qty, unit: product.unit });
    }, [qty, product.price, product.unit, onUpdate]);

    return (
        <div className="bg-gray-50 p-8 rounded-2xl border border-gray-200 flex flex-col items-center justify-center">
            <h3 className="text-xl font-bold text-gray-800 mb-6">Quantity ({product.unit}s)</h3>
            <div className="flex items-center gap-6">
                <button onClick={() => setQty(Math.max(1, qty - 1))} className="w-16 h-16 rounded-2xl bg-white hover:bg-gray-100 text-2xl text-gray-600 transition-all border border-gray-200 shadow-sm font-bold">-</button>
                <span className="text-5xl font-bold text-gray-800 font-mono w-24 text-center">{qty}</span>
                <button onClick={() => setQty(qty + 1)} className="w-16 h-16 rounded-2xl bg-blue-50 hover:bg-blue-100 text-2xl text-blue-600 transition-all border border-blue-100 shadow-sm font-bold">+</button>
            </div>
            <p className="mt-4 text-blue-600 text-lg font-medium">Ksh{product.price} per {product.unit}</p>
        </div>
    );
});

// --- SUB-COMPONENT: Profile Calculator ---
const ProfileCalculator = memo(({ product, color, initialDetails, onUpdate }) => {
    const isKeProfile = product.category === 'ke-profile';
    const KE_LENGTHS = useMemo(() => [21, 17, 16, 15], []);

    const [fullQty, setFullQty] = useState(initialDetails?.full || 0);
    const [halfQty, setHalfQty] = useState(initialDetails?.half || 0);
    const [feet, setFeet] = useState(initialDetails?.feet || 0);
    const [length, setLength] = useState(initialDetails?.length || 21);

    // Calculate total whenever inputs change
    useEffect(() => {
        const total = (fullQty * product.priceFull) + (halfQty * product.priceHalf) + (feet * product.priceFoot);
        onUpdate(total, {
            full: fullQty,
            half: halfQty,
            feet: feet,
            color: color || 'White',
            length: isKeProfile ? length : null
        });
    }, [fullQty, halfQty, feet, length, product, color, isKeProfile, onUpdate]);

    return (
        <div className="space-y-6">
            {isKeProfile && (
                <div className="space-y-3">
                    <h3 className="text-sm font-bold text-gray-700 uppercase tracking-wide">Select Length</h3>
                    <div className="flex gap-3">
                        {KE_LENGTHS.map(len => (
                            <button
                                key={len}
                                onClick={() => setLength(len)}
                                className={`flex-1 py-2 rounded-xl text-sm font-bold border transition-all shadow-sm ${length === len
                                    ? 'bg-blue-600 text-white border-blue-600 shadow-blue-200'
                                    : 'bg-white text-gray-600 border-gray-200 hover:border-gray-300 hover:bg-gray-50'
                                    }`}
                            >
                                {len}ft
                            </button>
                        ))}
                    </div>
                </div>
            )}

            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                {/* Standard Lengths */}
                <div className="bg-gray-50 p-5 rounded-2xl border border-gray-200">
                    <h3 className="text-lg font-bold text-gray-800 mb-4 flex items-center gap-2"><span>📏</span> Standard Lengths</h3>
                    <div className="space-y-4">
                        <div className="flex items-center justify-between">
                            <div><p className="text-gray-600 font-medium">Full Length</p><p className="text-xs text-blue-600 font-bold">Ksh{product.priceFull}/pc</p></div>
                            <div className="flex items-center bg-white rounded-lg p-1 border border-gray-200 shadow-sm">
                                <button onClick={() => setFullQty(Math.max(0, fullQty - 1))} className="w-8 h-8 rounded-md bg-gray-100 text-gray-600 hover:bg-gray-200">-</button>
                                <input type="number" value={fullQty} onChange={(e) => setFullQty(Number(e.target.value))} className="w-12 text-center bg-transparent text-gray-800 font-mono focus:outline-none font-bold" />
                                <button onClick={() => setFullQty(fullQty + 1)} className="w-8 h-8 rounded-md bg-blue-50 text-blue-600 hover:bg-blue-100">+</button>
                            </div>
                        </div>
                        <div className="flex items-center justify-between pt-2 border-t border-gray-200">
                            <div><p className="text-gray-600 font-medium">Half Length</p><p className="text-xs text-blue-600 font-bold">Ksh{product.priceHalf}/pc</p></div>
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
                <div className="bg-gray-50 p-5 rounded-2xl border border-gray-200">
                    <h3 className="text-lg font-bold text-gray-800 mb-4 flex items-center gap-2"><span>✂️</span> Custom Cut</h3>
                    <div className="flex flex-col gap-2">
                        <label className="text-sm text-gray-500 font-medium">Total Feet Needed</label>
                        <div className="flex items-center gap-2">
                            <input type="number" value={feet} onChange={(e) => setFeet(Number(e.target.value))} className="w-full border border-gray-300 rounded-xl px-4 py-3 text-gray-800 text-lg font-mono focus:ring-2 focus:ring-blue-500/50 outline-none bg-white shadow-sm" placeholder="0" />
                            <span className="text-gray-500 font-bold">ft</span>
                        </div>
                        <p className="text-right text-xs text-blue-600 font-bold mt-1">Ksh{product.priceFoot} / ft</p>
                    </div>
                </div>
            </div>
        </div>
    );
});

// --- SUB-COMPONENT: Glass Calculator ---
const GlassCalculator = memo(({ product, initialDetails, onUpdate }) => {
    // Initial State Hydration
    const [glassItems, setGlassItems] = useState(initialDetails?.glassItems || []);

    // Fallback for thickness if missing
    const defaultThickness = product.thicknessPrices?.[0]?.thickness || '';
    const [thickness, setThickness] = useState(initialDetails?.glassItems?.[0]?.thickness || defaultThickness);

    // Inputs
    const [fullIn, setFullIn] = useState(0);
    const [halfIn, setHalfIn] = useState(0);
    const [cutL, setCutL] = useState('');
    const [cutW, setCutW] = useState('');
    const [cutQty, setCutQty] = useState('');
    const [unit, setUnit] = useState('ft');

    // Memoize Pricing for current selection
    const pricing = useMemo(() => {
        return product.thicknessPrices?.find(p => p.thickness === thickness) ||
            { priceFull: product.priceFullSheet || 0, priceHalf: product.priceHalfSheet || 0, priceSqFt: product.priceSqFt || 0 };
    }, [product, thickness]);

    // Update parent whenever glassItems changes
    useEffect(() => {
        const total = glassItems.reduce((sum, item) => sum + item.totalPrice, 0);
        onUpdate(total, { glassItems });
    }, [glassItems, onUpdate]);

    // Helpers
    const getArea = (l, w, u) => {
        if (u === 'ft') return l * w;
        if (u === 'mm') return mmToSquareFeet(l, w);
        if (u === 'inch') return inchesToSquareFeet(l, w)
        return 0;
    };

    const addStandard = (type, qty) => {
        if (qty <= 0) return;
        const price = type === 'full' ? pricing.priceFull : pricing.priceHalf;
        const newItem = {
            type,
            thickness,
            qty,
            unitPrice: price,
            totalPrice: price * qty,
            label: `${type === 'full' ? 'Full Sheet' : 'Half Sheet'} (${thickness})`
        };
        setGlassItems(prev => [...prev, newItem]);
        if (type === 'full') setFullIn(0); else setHalfIn(0);
    };

    const addCut = () => {
        if (!cutL || !cutW || !cutQty) return;
        const l = parseFloat(cutL), w = parseFloat(cutW), q = parseFloat(cutQty);
        const area = getArea(l, w, unit);
        const price = Math.floor(area * q * pricing.priceSqFt * 20) / 20;

        const newItem = {
            type: 'cut',
            thickness,
            l, w, q, u: unit,
            area,
            rate: pricing.priceSqFt,
            totalPrice: price,
            label: `Cut: ${l}x${w}${unit} (${thickness})`
        };
        setGlassItems(prev => [...prev, newItem]);
        setCutL(''); setCutW(''); setCutQty('');
    };

    return (
        <div className="space-y-6">
            {/* Thickness Selector */}
            {product.thicknessPrices && (
                <div className="bg-blue-50/50 p-4 rounded-xl border border-blue-100">
                    <div className="flex justify-between items-center mb-3">
                        <h3 className="text-sm font-bold text-gray-700 uppercase tracking-wide">Select Thickness</h3>
                        <span className="text-xs font-mono text-gray-400">Rate: Ksh{pricing.priceSqFt}/sqft</span>
                    </div>
                    <div className="flex gap-2 flex-wrap mb-2">
                        {product.thicknessPrices.map(t => (
                            <button
                                key={t.thickness}
                                onClick={() => setThickness(t.thickness)}
                                className={`px-4 py-2 rounded-xl text-sm font-bold border transition-all shadow-sm ${thickness === t.thickness
                                    ? 'bg-blue-600 text-white border-blue-600 shadow-blue-200'
                                    : 'bg-white text-gray-600 border-gray-200 hover:bg-gray-50'
                                    }`}
                            >
                                {t.thickness}
                            </button>
                        ))}
                    </div>
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
                            <button onClick={() => setFullIn(Math.max(0, fullIn - 1))} className="w-8 h-8 rounded-md bg-gray-100 text-gray-600 hover:bg-gray-200">-</button>
                            <input type="number" value={fullIn} onChange={e => setFullIn(Number(e.target.value))} className="w-full text-center bg-transparent text-gray-800 font-mono focus:outline-none font-bold" />
                            <button onClick={() => setFullIn(fullIn + 1)} className="w-8 h-8 rounded-md bg-blue-50 text-blue-600 hover:bg-blue-100">+</button>
                        </div>
                        <button onClick={() => addStandard('full', fullIn)} disabled={fullIn <= 0} className="px-4 py-2 bg-gray-800 text-white text-xs font-bold rounded-lg disabled:opacity-50">Add</button>
                    </div>
                </div>
                {/* Half Sheet Toggle */}
                <div className="bg-gray-50 p-4 rounded-2xl border border-gray-200 flex flex-col gap-2 shadow-sm">
                    <div className="flex justify-between items-center">
                        <h4 className="font-bold text-gray-800">Half Sheet</h4>
                        <p className="text-xs text-blue-600 font-bold">Ksh{pricing.priceHalf}</p>
                    </div>
                    <div className="flex items-center justify-end h-full">
                        <button onClick={() => addStandard('half', 1)} className="px-4 py-2 bg-gray-200 hover:bg-blue-600 hover:text-white text-gray-600 text-xs font-bold rounded-lg transition-colors">Add One</button>
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
                <div className="bg-gray-50 px-4 py-3 border-b border-gray-100"><h3 className="text-sm font-bold text-gray-800">📦 Order Summary ({glassItems.length})</h3></div>
                <div className="max-h-56 overflow-y-auto custom-scrollbar p-0">
                    {glassItems.map((item, idx) => (
                        <div key={idx} className="flex items-center justify-between p-3 border-b border-gray-50 hover:bg-gray-50">
                            <div>
                                <span className="text-sm font-bold text-gray-800">{item.label}</span>
                                <div className="text-xs text-gray-500">x{item.qty || item.area * item.q}sqft • Ksh{item.totalPrice.toFixed(2)}</div>
                            </div>
                            <button onClick={() => setGlassItems(prev => prev.filter((_, i) => i !== idx))} className="text-gray-400 hover:text-red-500 font-bold px-2">✕</button>
                        </div>
                    ))}
                    {glassItems.length === 0 && <div className="p-4 text-center text-gray-400 text-xs italic">No items added yet.</div>}
                </div>
            </div>
        </div>
    );
});

// --- MAIN COMPONENT ---
export default function ProductModal({ product, isOpen, onClose, onAddToOrder, color, initialDetails }) {
    // State lifted from children
    const [total, setTotal] = useState(0);
    const [details, setDetails] = useState(null);

    // Stable handler passed to children to update parent state
    const handleUpdate = useCallback((newTotal, newDetails) => {
        setTotal(newTotal);
        setDetails(newDetails);
    }, []);

    // Helper to add to order
    const handleAdd = () => {
        if (total <= 0) return;
        onAddToOrder({
            image: product.image,
            id: product.id,
            name: product.name,
            category: product.category,
            totalPrice: total,
            details: details
        });
        onClose();
    };

    if (!isOpen || !product) return null;

    const isProfile = product.category === 'ke-profile' || product.category === 'tz-profile';
    const isGlass = product.category === 'glass';

    return (
        <div className="absolute inset-0 z-50 flex items-center justify-center p-4">
            <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={onClose} />
            <div className="relative w-full max-w-3xl bg-white rounded-3xl shadow-2xl overflow-hidden animate-pop-in max-h-[90vh] flex flex-col border border-gray-200">

                {/* Header */}
                <div className="relative h-40 flex-shrink-0 bg-gray-50 border-b border-gray-100">
                    <img src={product.image} alt={product.name} className="w-full h-full object-cover opacity-90 mix-blend-multiply" />
                    <div className="absolute inset-0 bg-gradient-to-t from-gray-900/60 to-transparent" />
                    <button onClick={onClose} className="absolute top-4 right-4 w-10 h-10 rounded-full bg-white/90 text-gray-800 flex items-center justify-center hover:bg-red-500 hover:text-white transition-colors shadow-sm">✕</button>
                    <div className="absolute bottom-4 left-6">
                        <h2 className="text-3xl font-bold text-white drop-shadow-md">{product.name}</h2>
                        <div className="flex items-center gap-2">
                            <span className="bg-white/20 backdrop-blur-md px-2 py-0.5 rounded text-sm text-white font-medium border border-white/20">
                                {product.category.toUpperCase().replace('-', ' ')}
                            </span>
                            {isProfile && color && (
                                <span className="bg-white/90 backdrop-blur-md px-2 py-0.5 rounded text-sm text-gray-900 font-bold border border-white/20 shadow-sm flex items-center gap-1">
                                    <span className="w-2 h-2 rounded-full bg-current" style={{ color: color === 'White' ? '#ccc' : color === 'Brown' ? '#8B4513' : color === 'Silver' ? '#C0C0C0' : '#808080' }}></span>
                                    {color}
                                </span>
                            )}
                        </div>
                    </div>
                </div>

                {/* Content Area - Switches based on category */}
                <div className="p-6 space-y-6 overflow-y-auto flex-1 custom-scrollbar">
                    {/* Key={product.id} forces a remount when product changes, resetting child state automatically */}
                    {isProfile ? (
                        <ProfileCalculator
                            key={product.id}
                            product={product}
                            color={color}
                            initialDetails={initialDetails}
                            onUpdate={handleUpdate}
                        />
                    ) : isGlass ? (
                        <GlassCalculator
                            key={product.id}
                            product={product}
                            initialDetails={initialDetails}
                            onUpdate={handleUpdate}
                        />
                    ) : (
                        <StandardCalculator
                            key={product.id}
                            product={product}
                            initialDetails={initialDetails}
                            onUpdate={handleUpdate}
                        />
                    )}
                </div>

                {/* Footer */}
                <div className="p-6 border-t border-gray-200 bg-white flex items-center justify-between flex-shrink-0 z-10">
                    <div className="flex flex-col">
                        <span className="text-gray-500 text-sm font-medium">Total Amount</span>
                        <span className="text-4xl font-bold text-gray-900 tracking-tight">Ksh{total.toFixed(2)}</span>
                    </div>
                    <button onClick={handleAdd} disabled={total <= 0} className={`px-10 py-4 rounded-xl font-bold text-lg shadow-lg transform transition-all flex items-center gap-2 ${total > 0 ? 'bg-blue-600 hover:bg-blue-700 text-white hover:scale-[1.02] shadow-blue-500/20' : 'bg-gray-100 text-gray-400 cursor-not-allowed'}`}>
                        <span>{initialDetails ? 'Update Cart' : 'Add to Cart'}</span><span>→</span>
                    </button>
                </div>
            </div>
        </div>
    );
}