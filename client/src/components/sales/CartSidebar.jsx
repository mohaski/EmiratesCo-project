import { useNavigate } from 'react-router-dom';

export default function CartSidebar({ cartItems, onRemoveItem, onEditItem, customer, actionLabel, onAction }) {
    const navigate = useNavigate();

    // Calculate Grand Total
    const grandTotal = cartItems.reduce((sum, item) => sum + item.totalPrice, 0);

    return (
        <div className="w-96 flex-shrink-0 bg-white border-l border-gray-100 flex flex-col h-full shadow-[0_0_50px_rgba(0,0,0,0.05)] z-30 font-sans tracking-tight">
            {/* Header */}
            <div className="px-8 py-8 bg-white z-10">
                <div className="flex items-center justify-between mb-8">
                    <div className="flex flex-col">
                        <h2 className="text-2xl font-bold text-gray-900">Order</h2>
                        <span className="text-gray-400 text-sm font-medium">
                            {customer ? (
                                <span className="text-blue-600 font-bold">{customer.name}</span>
                            ) : (
                                "#1024 • Table 5"
                            )}
                        </span>
                    </div>
                    <div className="w-10 h-10 rounded-full bg-gray-50 flex items-center justify-center text-gray-400">
                        👤
                    </div>
                </div>

                {/* Search/Customer */}
                <div className="relative">
                    <input
                        type="text"
                        placeholder={customer ? "Add specific note..." : "Add customer note..."}
                        className="w-full bg-gray-50 border-none rounded-lg py-3 px-4 text-gray-900 text-sm focus:ring-2 focus:ring-blue-500/20 transition-all outline-none placeholder-gray-400 font-medium"
                    />
                </div>
            </div>

            {/* Cart Items List */}
            <div className="flex-1 overflow-y-auto px-8 pb-4 space-y-8 custom-scrollbar">
                {cartItems.length === 0 ? (
                    <div className="h-full flex flex-col items-center justify-center text-gray-300 space-y-4 opacity-60">
                        <span className="text-4xl grayscale">🛒</span>
                        <p className="font-medium">No items added</p>
                    </div>
                ) : (
                    cartItems.map((item, idx) => (
                        <div key={idx} className="group relative">

                            {/* Top Row: Image & Name & Price */}
                            <div className="flex gap-4 mb-3">
                                <div className="w-12 h-12 rounded-lg bg-gray-100 overflow-hidden flex-shrink-0">
                                    <img src={item.image} className="w-full h-full object-cover mix-blend-multiply opacity-80 group-hover:opacity-100 transition-opacity" alt="" />
                                </div>
                                <div className="flex-1 min-w-0 flex flex-col justify-center">
                                    <div className="flex justify-between items-start">
                                        <h4 className="text-gray-900 font-bold text-sm leading-tight pr-4">{item.name}</h4>
                                        <span className="text-gray-900 font-bold text-sm leading-tight">${item.totalPrice.toFixed(0)}</span>
                                    </div>
                                    <div className="flex items-center gap-2 mt-1">
                                        <button
                                            onClick={() => onEditItem(idx)}
                                            className="text-xs text-blue-500 font-medium opacity-0 group-hover:opacity-100 transition-opacity -ml-1 px-1 hover:bg-blue-50 rounded flex items-center gap-1"
                                        >
                                            ✏️ Edit
                                        </button>
                                        <span className="text-gray-300 text-xs opacity-0 group-hover:opacity-100 transition-opacity">•</span>
                                        <button
                                            onClick={() => onRemoveItem(idx)}
                                            className="text-xs text-red-500 font-medium opacity-0 group-hover:opacity-100 transition-opacity px-1 hover:bg-red-50 rounded"
                                        >
                                            Remove
                                        </button>
                                    </div>
                                </div>
                            </div>

                            {/* Item Details: The "Classy Receipt" Look */}
                            <div className="pl-[64px] text-xs text-gray-500 space-y-2">

                                {/* Meta Tags (Color/Length/Thickness) */}
                                {(item.details.color || item.details.length || item.details.thickness) && (
                                    <div className="flex gap-3 mb-2 text-[11px] font-medium tracking-wide text-gray-400 uppercase">
                                        {item.details.color && (
                                            <span className="flex items-center gap-1">
                                                <span className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: item.details.color === 'White' ? '#eee' : item.details.color }}></span>
                                                {item.details.color}
                                            </span>
                                        )}
                                        {item.details.length && <span>{item.details.length}FT</span>}
                                        {item.details.thickness && <span className="text-blue-500">{item.details.thickness}</span>}
                                    </div>
                                )}

                                {/* Breakdown: Dot Leaders for cleaner look */}
                                {item.details.full > 0 && (
                                    <div className="flex items-baseline justify-between">
                                        <span>Full Lengths</span>
                                        <span className="flex-1 mx-2 border-b border-dotted border-gray-200 translate-y-[-3px]"></span>
                                        <span className="font-mono text-gray-900 font-medium">x{item.details.full}</span>
                                    </div>
                                )}
                                {item.details.half > 0 && (
                                    <div className="flex items-baseline justify-between">
                                        <span>Half Lengths</span>
                                        <span className="flex-1 mx-2 border-b border-dotted border-gray-200 translate-y-[-3px]"></span>
                                        <span className="font-mono text-gray-900 font-medium">x{item.details.half}</span>
                                    </div>
                                )}
                                {item.details.feet > 0 && (
                                    <div className="flex items-baseline justify-between">
                                        <span>Custom Feet</span>
                                        <span className="flex-1 mx-2 border-b border-dotted border-gray-200 translate-y-[-3px]"></span>
                                        <span className="font-mono text-gray-900 font-medium">{item.details.feet} ft</span>
                                    </div>
                                )}

                                {/* Glass Items List (New Mixed Logic) */}
                                {item.details.glassItems && item.details.glassItems.length > 0 ? (
                                    <div className="pt-2">
                                        <div className="mt-1 space-y-2">
                                            {item.details.glassItems.map((glassItem, gIdx) => (
                                                <div key={gIdx} className="flex justify-between items-start font-mono text-[11px]">
                                                    <div className="flex flex-col">
                                                        <span className="text-gray-700">{glassItem.label}</span>
                                                        <span className="text-[10px] text-gray-400">x{glassItem.qty} {glassItem.type === 'cut' ? '' : ''}</span>
                                                    </div>
                                                    <span className="text-gray-900 font-bold">${glassItem.totalPrice.toFixed(0)}</span>
                                                </div>
                                            ))}
                                        </div>
                                    </div>
                                ) : (
                                    <>
                                        {/* Glass Sheets (Legacy) */}
                                        {item.details.fullSheet > 0 && (
                                            <div className="flex items-baseline justify-between">
                                                <span>Full Sheets</span>
                                                <span className="flex-1 mx-2 border-b border-dotted border-gray-200 translate-y-[-3px]"></span>
                                                <span className="font-mono text-gray-900 font-medium">x{item.details.fullSheet}</span>
                                            </div>
                                        )}
                                        {item.details.halfSheet > 0 && (
                                            <div className="flex items-baseline justify-between">
                                                <span>Half Sheets</span>
                                                <span className="flex-1 mx-2 border-b border-dotted border-gray-200 translate-y-[-3px]"></span>
                                                <span className="font-mono text-gray-900 font-medium">x{item.details.halfSheet}</span>
                                            </div>
                                        )}

                                        {/* Cut Pieces List (Legacy) */}
                                        {item.details.cutPieces && item.details.cutPieces.length > 0 && (
                                            <div className="pt-2">
                                                <span className="text-[10px] uppercase font-bold text-gray-300 tracking-wider">Cuts</span>
                                                <div className="mt-1 space-y-1">
                                                    {item.details.cutPieces.map((cut, cIdx) => (
                                                        <div key={cIdx} className="flex justify-between font-mono text-[11px]">
                                                            <span>{cut.l} x {cut.w} {cut.u}</span>
                                                            <span className="text-gray-900">x{cut.q}</span>
                                                        </div>
                                                    ))}
                                                </div>
                                            </div>
                                        )}
                                    </>
                                )}

                                {/* Standard Qty */}
                                {item.details.qty !== undefined && (
                                    <div className="flex items-baseline justify-between">
                                        <span>Quantity</span>
                                        <span className="flex-1 mx-2 border-b border-dotted border-gray-200 translate-y-[-3px]"></span>
                                        <span className="font-mono text-gray-900 font-medium">{item.details.qty} {item.details.unit}</span>
                                    </div>
                                )}
                            </div>
                        </div>
                    ))
                )}
            </div>

            {/* Footer / Checkout */}
            <div className="p-8 bg-gray-50 border-t border-gray-100 z-10">
                <div className="space-y-4 mb-8">
                    <div className="flex justify-between text-gray-500 text-sm">
                        <span className="font-medium">Subtotal</span>
                        <span className="font-mono tracking-tight">${grandTotal.toFixed(2)}</span>
                    </div>
                    <div className="flex justify-between text-gray-500 text-sm">
                        <span className="font-medium">VAT (5%)</span>
                        <span className="font-mono tracking-tight">${(grandTotal * 0.05).toFixed(2)}</span>
                    </div>
                    <div className="flex justify-between text-gray-900 items-baseline pt-4 border-t border-gray-200">
                        <span className="font-bold text-xl">Total</span>
                        <span className="font-bold text-3xl tracking-tighter">${(grandTotal * 1.05).toFixed(2)}</span>
                    </div>
                </div>

                <button
                    onClick={() => {
                        if (onAction) onAction();
                        else navigate('/checkout', { state: { cartItems, customer } });
                    }}
                    disabled={cartItems.length === 0}
                    className="w-full py-4 bg-gray-900 hover:bg-black rounded-xl font-bold text-white shadow-xl shadow-gray-900/10 transform active:scale-[0.99] transition-all flex items-center justify-between px-6 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                    <span>{actionLabel || 'Checkout'}</span>
                    <span className="font-mono opacity-80">${(grandTotal * 1.05).toFixed(0)}</span>
                </button>
            </div>
        </div>
    );
}
