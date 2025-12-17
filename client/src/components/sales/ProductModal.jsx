import { useState, useEffect } from 'react';

export default function ProductModal({ product, isOpen, onClose, onAddToOrder, color, initialDetails }) {
    if (!isOpen || !product) return null;

    const isProfile = product.category === 'ke-profile' || product.category === 'tz-profile';
    const isKeProfile = product.category === 'ke-profile';
    const isGlass = product.category === 'glass';

    const KE_LENGTHS = [21, 17, 16, 15];

    // --- States for Profile Logic ---
    const [fullLengthQty, setFullLengthQty] = useState(0);
    const [halfLengthQty, setHalfLengthQty] = useState(0);
    const [feetInput, setFeetInput] = useState(0);
    const [selectedLength, setSelectedLength] = useState(21); // Default for KE

    // --- States for Glass Logic ---
    // Unified list of all glass items (Full Sheets, Half Sheets, Cut Pieces)
    const [glassItems, setGlassItems] = useState([]);

    // Temporary Inputs for Glass Adder
    const [glassFullInput, setGlassFullInput] = useState(0);
    const [glassHalfInput, setGlassHalfInput] = useState(0);
    const [newItemL, setNewItemL] = useState('');
    const [newItemW, setNewItemW] = useState('');
    const [newItemQty, setNewItemQty] = useState('');
    const [unit, setUnit] = useState('ft');

    // Thickness Selection
    const [selectedThickness, setSelectedThickness] = useState('');

    // --- State for Standard Logic (Accessories) ---
    const [standardQty, setStandardQty] = useState(1);

    // Get current pricing based on selection
    const currentPricing = product?.thicknessPrices?.find(p => p.thickness === selectedThickness) ||
        { priceFull: product?.priceFullSheet || 0, priceHalf: product?.priceHalfSheet || 0, priceSqFt: product?.priceSqFt || 0 };

    // Reset or Hydrate states when product opens
    useEffect(() => {
        if (initialDetails) {
            // --- EDIT MODE: HYDRATE STATE ---

            // Profile Logic
            setFullLengthQty(initialDetails.full || 0);
            setHalfLengthQty(initialDetails.half || 0);
            setFeetInput(initialDetails.feet || 0);
            if (initialDetails.length) setSelectedLength(initialDetails.length);

            // Glass Logic
            if (initialDetails.glassItems) {
                setGlassItems(initialDetails.glassItems);
            } else {
                // Fallback for old data structure migration (optional but good practice)
                const migratedItems = [];
                if (initialDetails.fullSheet) migratedItems.push({ type: 'full', qty: initialDetails.fullSheet, thickness: initialDetails.thickness, price: product.priceFullSheet });
                if (initialDetails.halfSheet) migratedItems.push({ type: 'half', qty: initialDetails.halfSheet, thickness: initialDetails.thickness, price: product.priceHalfSheet });
                if (initialDetails.cutPieces) {
                    initialDetails.cutPieces.forEach(p => migratedItems.push({ ...p, type: 'cut', thickness: initialDetails.thickness, price: 0 })); // Re-calc price if needed
                }
                setGlassItems(migratedItems);
            }

            // Set initial thickness selection
            if (initialDetails.glassItems && initialDetails.glassItems.length > 0) {
                setSelectedThickness(initialDetails.glassItems[0].thickness);
            } else if (product?.thicknessPrices?.length > 0) {
                setSelectedThickness(product.thicknessPrices[0].thickness);
            }

            // Accessories Logic
            setStandardQty(initialDetails.qty || 1);

            // Reset temp inputs
            setNewItemL('');
            setNewItemW('');
            setNewItemQty('');
            setGlassFullInput(0);
            setGlassHalfInput(0);
            setUnit('ft');

        } else {
            // --- ADD MODE: RESET STATE ---
            setFullLengthQty(0);
            setHalfLengthQty(0);
            setFeetInput(0);
            setStandardQty(1);
            setSelectedLength(21);

            // Glass Reset
            setGlassItems([]);
            setGlassFullInput(0);
            setGlassHalfInput(0);
            setNewItemL('');
            setNewItemW('');
            setNewItemQty('');
            setUnit('ft');

            // Set default thickness
            if (product && product.thicknessPrices && product.thicknessPrices.length > 0) {
                setSelectedThickness(product.thicknessPrices[0].thickness);
            } else {
                setSelectedThickness('');
            }
        }
    }, [product, isOpen, initialDetails]);

    // Helper: Calculate Area
    const getAreaInSqFt = (l, w, u) => {
        if (u === 'ft') return l * w;
        if (u === 'cm') return (l / 30.48) * (w / 30.48);
        if (u === 'mm') return (l / 304.8) * (w / 304.8);
        return 0;
    };

    // --- Glass Handlers ---

    const addStandardSheet = (type, forcedQty) => { // type = 'full' or 'half'
        const qty = forcedQty !== undefined ? forcedQty : (type === 'full' ? glassFullInput : glassHalfInput);
        if (qty <= 0) return;

        const pricePerItem = type === 'full' ? currentPricing.priceFull : currentPricing.priceHalf;
        const totalLinePrice = pricePerItem * qty;

        const newItem = {
            type, // 'full' | 'half'
            thickness: selectedThickness,
            qty: qty,
            unitPrice: pricePerItem,
            totalPrice: totalLinePrice,
            // standard display info
            label: `${type === 'full' ? 'Full Sheet' : 'Half Sheet'} (${selectedThickness})`
        };

        setGlassItems([...glassItems, newItem]);

        // Reset input
        if (type === 'full') setGlassFullInput(0);
        else setGlassHalfInput(0);
    };

    const addCutPiece = () => {
        if (newItemL && newItemW && newItemQty) {
            const l = parseFloat(newItemL);
            const w = parseFloat(newItemW);
            const q = parseFloat(newItemQty);
            const area = getAreaInSqFt(l, w, unit);
            const linePrice = area * q * currentPricing.priceSqFt;

            const newItem = {
                type: 'cut',
                thickness: selectedThickness,
                l, w, q, u: unit,
                area: area,
                rate: currentPricing.priceSqFt,
                totalPrice: linePrice,
                label: `Cut: ${l}x${w}${unit} (${selectedThickness})`
            };

            setGlassItems([...glassItems, newItem]);
            setNewItemL('');
            setNewItemW('');
            setNewItemQty('');
        }
    };

    const removeGlassItem = (idx) => {
        const newItems = [...glassItems];
        newItems.splice(idx, 1);
        setGlassItems(newItems);
    };

    // Calculate Total Price
    const calculateTotal = () => {
        if (isProfile) {
            const fullTotal = fullLengthQty * product.priceFull;
            const halfTotal = halfLengthQty * product.priceHalf;
            const feetTotal = feetInput * product.priceFoot;
            return fullTotal + halfTotal + feetTotal;
        } else if (isGlass) {
            return glassItems.reduce((sum, item) => sum + item.totalPrice, 0);
        } else {
            return standardQty * product.price;
        }
    };

    const handleAdd = () => {
        const total = calculateTotal();
        if (total <= 0) return;

        let details = {};

        if (isProfile) {
            details = {
                full: fullLengthQty,
                half: halfLengthQty,
                feet: feetInput,
                color: color || 'White',
                length: isKeProfile ? selectedLength : null
            };
        } else if (isGlass) {
            details = {
                glassItems: glassItems // Save the whole list
            };
        } else {
            details = { qty: standardQty, unit: product.unit };
        }

        const orderItem = {
            image: product.image,
            id: product.id,
            name: product.name,
            category: product.category,
            totalPrice: total,
            details: details
        };

        onAddToOrder(orderItem);
        onClose();
    };


    return (
        <div className="absolute inset-0 z-50 flex items-center justify-center p-4">
            <div
                className="absolute inset-0 bg-black/40 backdrop-blur-sm"
                onClick={onClose}
            />

            <div className="relative w-full max-w-3xl bg-white rounded-3xl shadow-2xl overflow-hidden animate-pop-in max-h-[90vh] flex flex-col scale-100 transform border border-gray-200">
                {/* Header */}
                <div className="relative h-40 flex-shrink-0 bg-gray-50 border-b border-gray-100">
                    <img
                        src={product.image}
                        alt={product.name}
                        // Use mix-blend-mode to make image sit nicely on light bg
                        className="w-full h-full object-cover opacity-90 mix-blend-multiply"
                    />
                    <div className="absolute inset-0 bg-gradient-to-t from-gray-900/60 to-transparent" />

                    <button
                        onClick={onClose}
                        className="absolute top-4 right-4 w-10 h-10 rounded-full bg-white/90 text-gray-800 flex items-center justify-center hover:bg-red-500 hover:text-white transition-colors shadow-sm"
                    >
                        ✕
                    </button>

                    <div className="absolute bottom-4 left-6">
                        <h2 className="text-3xl font-bold text-white drop-shadow-md">{product.name}</h2>
                        <div className="flex items-center gap-2">
                            <span className="bg-white/20 backdrop-blur-md px-2 py-0.5 rounded text-sm text-white font-medium border border-white/20">
                                {product.category.toUpperCase().replace('-', ' ')}
                            </span>
                            {isProfile && (
                                <span className="bg-white/90 backdrop-blur-md px-2 py-0.5 rounded text-sm text-gray-900 font-bold border border-white/20 shadow-sm flex items-center gap-1">
                                    <span className="w-2 h-2 rounded-full bg-current" style={{ color: color === 'White' ? '#ccc' : color === 'Brown' ? '#8B4513' : color === 'Silver' ? '#C0C0C0' : '#808080' }}></span>
                                    {color}
                                </span>
                            )}
                        </div>
                    </div>
                </div>

                <div className="p-6 space-y-6 overflow-y-auto flex-1 custom-scrollbar">

                    {/* --- KE PROFILE LENGTH SELECTION --- */}
                    {isKeProfile && (
                        <div className="space-y-3">
                            <h3 className="text-sm font-bold text-gray-700 uppercase tracking-wide">Select Length</h3>
                            <div className="flex gap-3">
                                {KE_LENGTHS.map(len => (
                                    <button
                                        key={len}
                                        onClick={() => setSelectedLength(len)}
                                        className={`flex-1 py-2 rounded-xl text-sm font-bold border transition-all shadow-sm ${selectedLength === len
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

                    {/* --- PROFILE CALCULATOR LOGIC --- */}
                    {isProfile && (
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-6 pt-2">
                            {/* Standard Lengths */}
                            <div className="bg-gray-50 p-5 rounded-2xl border border-gray-200">
                                <h3 className="text-lg font-bold text-gray-800 mb-4 flex items-center gap-2"><span>📏</span> Standard Lengths</h3>
                                <div className="space-y-4">
                                    <div className="flex items-center justify-between">
                                        <div><p className="text-gray-600 font-medium">Full Length</p><p className="text-xs text-blue-600 font-bold">${product.priceFull}/pc</p></div>
                                        <div className="flex items-center bg-white rounded-lg p-1 border border-gray-200 shadow-sm">
                                            <button onClick={() => setFullLengthQty(Math.max(0, fullLengthQty - 1))} className="w-8 h-8 rounded-md bg-gray-100 text-gray-600 hover:bg-gray-200">-</button>
                                            <input type="number" value={fullLengthQty} onChange={(e) => setFullLengthQty(Number(e.target.value))} className="w-12 text-center bg-transparent text-gray-800 font-mono focus:outline-none font-bold" />
                                            <button onClick={() => setFullLengthQty(fullLengthQty + 1)} className="w-8 h-8 rounded-md bg-blue-50 text-blue-600 hover:bg-blue-100">+</button>
                                        </div>
                                    </div>
                                    <div className="flex items-center justify-between pt-2 border-t border-gray-200">
                                        <div><p className="text-gray-600 font-medium">Half Length</p><p className="text-xs text-blue-600 font-bold">${product.priceHalf}/pc</p></div>
                                        <div className="flex items-center">
                                            <button
                                                onClick={() => setHalfLengthQty(halfLengthQty > 0 ? 0 : 1)}
                                                className={`relative inline-flex h-8 w-14 items-center rounded-full transition-colors focus:outline-none ${halfLengthQty > 0 ? 'bg-blue-600' : 'bg-gray-200'}`}
                                            >
                                                <span className={`inline-block h-6 w-6 transform rounded-full bg-white transition-transform ${halfLengthQty > 0 ? 'translate-x-7' : 'translate-x-1'}`} />
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
                                        <input type="number" value={feetInput} onChange={(e) => setFeetInput(Number(e.target.value))} className="w-full border border-gray-300 rounded-xl px-4 py-3 text-gray-800 text-lg font-mono focus:ring-2 focus:ring-blue-500/50 outline-none bg-white shadow-sm" placeholder="0" />
                                        <span className="text-gray-500 font-bold">ft</span>
                                    </div>
                                    <p className="text-right text-xs text-blue-600 font-bold mt-1">${product.priceFoot} / ft</p>
                                </div>
                            </div>
                        </div>
                    )}

                    {/* --- GLASS CALCULATOR LOGIC --- */}
                    {isGlass && (
                        <div className="space-y-6">

                            {/* Thickness Selection & Pricing Display */}
                            {product.thicknessPrices && product.thicknessPrices.length > 0 && (
                                <div className="bg-blue-50/50 p-4 rounded-xl border border-blue-100">
                                    <div className="space-y-3">
                                        <div className="flex justify-between items-center">
                                            <h3 className="text-sm font-bold text-gray-700 uppercase tracking-wide">Select Thickness</h3>
                                            <span className="text-xs font-mono text-gray-400">Current Rate: ${currentPricing.priceSqFt}/sqft</span>
                                        </div>
                                        <div className="flex gap-2 flex-wrap">
                                            {product.thicknessPrices.map(t => (
                                                <button
                                                    key={t.thickness}
                                                    onClick={() => setSelectedThickness(t.thickness)}
                                                    className={`px-4 py-2 rounded-xl text-sm font-bold border transition-all shadow-sm ${selectedThickness === t.thickness
                                                        ? 'bg-blue-600 text-white border-blue-600 shadow-blue-200 scale-105'
                                                        : 'bg-white text-gray-600 border-gray-200 hover:border-gray-300 hover:bg-gray-50'
                                                        }`}
                                                >
                                                    {t.thickness}
                                                </button>
                                            ))}
                                        </div>
                                        {/* Reference Prices for Current Thickness */}
                                        <div className="flex gap-4 text-xs text-gray-500 pt-2 border-t border-blue-100/50">
                                            <span>Full Sheet: <b>${currentPricing.priceFull}</b></span>
                                            <span>Half Sheet: <b>${currentPricing.priceHalf}</b></span>
                                            <span>Cut: <b>${currentPricing.priceSqFt}/ft²</b></span>
                                        </div>
                                    </div>
                                </div>
                            )}

                            {/* Adder Section: Standard Sheets (Horizontal Layout) */}
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                                <div className="bg-gray-50 p-4 rounded-2xl border border-gray-200 flex flex-col gap-2 shadow-sm">
                                    <div className="flex justify-between items-center">
                                        <h4 className="font-bold text-gray-800">Full Sheet</h4>
                                        <p className="text-xs text-blue-600 font-bold">${currentPricing.priceFull}</p>
                                    </div>
                                    <div className="flex items-center gap-2">
                                        <div className="flex items-center bg-white rounded-lg p-1 border border-gray-200 flex-1">
                                            <button onClick={() => setGlassFullInput(Math.max(0, glassFullInput - 1))} className="w-8 h-8 rounded-md bg-gray-100 text-gray-600 hover:bg-gray-200">-</button>
                                            <input type="number" value={glassFullInput} onChange={(e) => setGlassFullInput(Number(e.target.value))} className="w-full text-center bg-transparent text-gray-800 font-mono focus:outline-none font-bold" />
                                            <button onClick={() => setGlassFullInput(glassFullInput + 1)} className="w-8 h-8 rounded-md bg-blue-50 text-blue-600 hover:bg-blue-100">+</button>
                                        </div>
                                        <button onClick={() => addStandardSheet('full')} disabled={glassFullInput <= 0} className="px-4 py-2 bg-gray-800 text-white text-xs font-bold rounded-lg disabled:opacity-50 hover:bg-gray-700">Add</button>
                                    </div>
                                </div>
                                <div className="bg-gray-50 p-4 rounded-2xl border border-gray-200 flex flex-col gap-2 shadow-sm">
                                    <div className="flex justify-between items-center">
                                        <h4 className="font-bold text-gray-800">Half Sheet</h4>
                                        <p className="text-xs text-blue-600 font-bold">${currentPricing.priceHalf}</p>
                                    </div>
                                    <div className="flex items-center justify-end h-full">
                                        {(() => {
                                            const isHalfSheetSelected = glassItems.some(i => i.type === 'half' && i.thickness === selectedThickness);
                                            return (
                                                <button
                                                    onClick={() => {
                                                        if (isHalfSheetSelected) {
                                                            setGlassItems(glassItems.filter(i => !(i.type === 'half' && i.thickness === selectedThickness)));
                                                        } else {
                                                            addStandardSheet('half', 1);
                                                        }
                                                    }}
                                                    className={`relative inline-flex h-8 w-14 items-center rounded-full transition-colors focus:outline-none ${isHalfSheetSelected ? 'bg-blue-600' : 'bg-gray-200'}`}
                                                >
                                                    <span className={`inline-block h-6 w-6 transform rounded-full bg-white transition-transform ${isHalfSheetSelected ? 'translate-x-7' : 'translate-x-1'}`} />
                                                </button>
                                            );
                                        })()}
                                    </div>
                                </div>
                            </div>

                            {/* Section 2: Cut Pieces Calculator */}
                            <div className="bg-gray-50 p-5 rounded-2xl border border-gray-200 shadow-sm">
                                <div className="flex items-center justify-between mb-4">
                                    <h3 className="text-lg font-bold text-gray-800 flex items-center gap-2"><span>📐</span> Cut Pieces</h3>
                                    <div className="flex bg-white rounded-lg p-1 border border-gray-200 shadow-sm">
                                        {['ft', 'cm', 'mm'].map((u) => (
                                            <button
                                                key={u}
                                                onClick={() => setUnit(u)}
                                                className={`px-3 py-1 rounded-md text-sm font-bold transition-all ${unit === u ? 'bg-blue-600 text-white shadow-sm' : 'text-gray-500 hover:bg-gray-100'}`}
                                            >
                                                {u}
                                            </button>
                                        ))}
                                    </div>
                                </div>

                                {/* Header Labels */}
                                <div className="grid grid-cols-12 gap-2 text-xs text-gray-500 font-bold mb-2 px-1 uppercase tracking-wide text-center">
                                    <div className="col-span-3 text-left pl-2">Length</div>
                                    <div className="col-span-3 text-left">Width</div>
                                    <div className="col-span-2">Qty</div>
                                    <div className="col-span-2">Price</div>
                                    <div className="col-span-2"></div>
                                </div>

                                {/* Adder Row */}
                                <div className="grid grid-cols-12 gap-2 mb-4 bg-white p-2 rounded-xl border border-gray-200 items-center shadow-sm">
                                    <div className="col-span-3"><input type="number" placeholder="L" value={newItemL} onChange={e => setNewItemL(e.target.value)} className="w-full bg-gray-50 border border-gray-200 rounded-lg px-2 py-2 text-gray-800 text-sm focus:ring-1 focus:ring-blue-500 outline-none" /></div>
                                    <div className="col-span-3"><input type="number" placeholder="W" value={newItemW} onChange={e => setNewItemW(e.target.value)} className="w-full bg-gray-50 border border-gray-200 rounded-lg px-2 py-2 text-gray-800 text-sm focus:ring-1 focus:ring-blue-500 outline-none" /></div>
                                    <div className="col-span-2"><input type="number" placeholder="Qty" value={newItemQty} onChange={e => setNewItemQty(e.target.value)} className="w-full bg-gray-50 border border-gray-200 rounded-lg px-2 py-2 text-gray-800 text-sm focus:ring-1 focus:ring-blue-500 outline-none text-center" /></div>
                                    <div className="col-span-2 text-center text-gray-400 text-xs">-</div>
                                    <div className="col-span-2"><button onClick={addCutPiece} className="w-full bg-blue-600 hover:bg-blue-700 text-white rounded-lg py-2 text-sm font-bold transition-colors shadow-sm">Add</button></div>
                                </div>
                            </div>

                            {/* --- GLASS ORDER SUMMARY (Added Items) --- */}
                            <div className="bg-white rounded-xl border border-gray-200 overflow-hidden shadow-sm">
                                <div className="bg-gray-50 px-4 py-3 border-b border-gray-100 flex justify-between items-center">
                                    <h3 className="text-sm font-bold text-gray-800 uppercase tracking-wide">📦 Order Summary</h3>
                                    <span className="text-xs text-gray-500">{glassItems.length} items</span>
                                </div>
                                <div className="max-h-56 overflow-y-auto custom-scrollbar p-0">
                                    {glassItems.map((item, idx) => (
                                        <div key={idx} className="flex items-center justify-between p-3 border-b border-gray-50 hover:bg-gray-50 transition-colors">
                                            <div className="flex flex-col">
                                                <span className="text-sm font-bold text-gray-800">{item.label}</span>
                                                <div className="text-xs text-gray-500 flex gap-2">
                                                    <span>x{item.qty}</span>
                                                    <span>•</span>
                                                    <span>${item.unitPrice ? item.unitPrice + '/ea' : item.rate + '/ft²'}</span>
                                                </div>
                                            </div>
                                            <div className="flex items-center gap-3">
                                                <span className="font-mono font-bold text-blue-600">${item.totalPrice?.toFixed(2)}</span>
                                                <button onClick={() => removeGlassItem(idx)} className="w-6 h-6 rounded-full bg-gray-100 text-gray-400 hover:bg-red-50 hover:text-red-500 flex items-center justify-center transition-all">✕</button>
                                            </div>
                                        </div>
                                    ))}
                                    {glassItems.length === 0 && (
                                        <div className="p-8 text-center text-gray-400 text-sm italic">
                                            No items added to this order yet.
                                        </div>
                                    )}
                                </div>
                            </div>
                        </div>
                    )}

                    {/* --- STANDARD PRODUCT LOGIC (Accessories) --- */}
                    {!isProfile && !isGlass && (
                        <div className="bg-gray-50 p-8 rounded-2xl border border-gray-200 flex flex-col items-center justify-center">
                            <h3 className="text-xl font-bold text-gray-800 mb-6">Quantity ({product.unit}s)</h3>
                            <div className="flex items-center gap-6">
                                <button onClick={() => setStandardQty(Math.max(1, standardQty - 1))} className="w-16 h-16 rounded-2xl bg-white hover:bg-gray-100 text-2xl text-gray-600 transition-all border border-gray-200 shadow-sm font-bold">-</button>
                                <span className="text-5xl font-bold text-gray-800 font-mono w-24 text-center">{standardQty}</span>
                                <button onClick={() => setStandardQty(standardQty + 1)} className="w-16 h-16 rounded-2xl bg-blue-50 hover:bg-blue-100 text-2xl text-blue-600 transition-all border border-blue-100 shadow-sm font-bold">+</button>
                            </div>
                            <p className="mt-4 text-blue-600 text-lg font-medium">${product.price} per {product.unit}</p>
                        </div>
                    )}

                </div>

                {/* Footer */}
                <div className="p-6 border-t border-gray-200 bg-white flex items-center justify-between flex-shrink-0 z-10">
                    <div className="flex flex-col">
                        <span className="text-gray-500 text-sm font-medium">Total Amount</span>
                        <span className="text-4xl font-bold text-gray-900 tracking-tight">${calculateTotal().toFixed(2)}</span>
                    </div>
                    <button onClick={handleAdd} disabled={calculateTotal() <= 0} className={`px-10 py-4 rounded-xl font-bold text-lg shadow-lg transform transition-all flex items-center gap-2 ${calculateTotal() > 0 ? 'bg-blue-600 hover:bg-blue-700 text-white hover:scale-[1.02] shadow-blue-500/20' : 'bg-gray-100 text-gray-400 cursor-not-allowed'}`}>
                        <span>{initialDetails ? 'Update Cart' : 'Add to Cart'}</span><span>→</span>
                    </button>
                </div>

            </div>
        </div>
    );
}
