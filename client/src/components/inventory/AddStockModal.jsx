import React from 'react';

const AddStockModal = ({
    isOpen,
    onClose,
    product,
    selectedVariant,
    onVariantSelect,
    stockToAdd,
    onStockChange,
    onConfirm
}) => {
    if (!isOpen || !product) return null;

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-gray-900/60 backdrop-blur-sm animate-fade-in">
            <div className="bg-white rounded-3xl shadow-2xl w-full max-w-lg overflow-hidden animate-pop-in">
                <div className="p-8 border-b border-gray-100 bg-gray-50/50 text-center">
                    <div className="w-16 h-16 bg-blue-100 text-blue-600 rounded-2xl flex items-center justify-center text-3xl mx-auto mb-4 shadow-sm">
                        📦
                    </div>
                    <h3 className="text-2xl font-bold text-gray-900">Restock Product</h3>
                    <p className="text-gray-500 mt-1">{product.name}</p>
                </div>

                <div className="p-8 space-y-6">

                    {/* Variant Selector */}
                    <div>
                        <label className="text-xs font-bold text-gray-400 uppercase tracking-wide block mb-3">Select Variant</label>
                        <div className="grid grid-cols-3 gap-3">
                            {Object.keys(product.stockVariants).map(variant => (
                                <button
                                    key={variant}
                                    onClick={() => onVariantSelect(variant)}
                                    className={`px-3 py-3 rounded-xl border text-sm font-bold transition-all ${selectedVariant === variant
                                        ? 'bg-blue-600 text-white border-blue-600 shadow-md transform scale-105'
                                        : 'bg-white text-gray-600 border-gray-200 hover:bg-gray-50'
                                        }`}
                                >
                                    {variant}
                                    <div className={`text-xs mt-1 font-mono ${selectedVariant === variant ? 'text-blue-200' : 'text-gray-400'}`}>
                                        Qty: {product.stockVariants[variant]}
                                    </div>
                                </button>
                            ))}
                        </div>
                    </div>

                    {/* Quantity Input */}
                    <div>
                        <label className="text-xs font-bold text-gray-400 uppercase tracking-wide block mb-2">Quantity to Add</label>
                        <div className="relative">
                            <button
                                onClick={() => onStockChange(Math.max(0, (parseInt(stockToAdd) || 0) - 1).toString())}
                                className="absolute left-2 top-2 p-3 hover:bg-gray-100 rounded-lg text-gray-500 transition-colors"
                            >
                                −
                            </button>
                            <input
                                type="number"
                                autoFocus
                                className="w-full text-center text-4xl font-bold text-gray-900 border border-gray-200 rounded-2xl py-5 focus:border-blue-500 focus:ring-4 focus:ring-blue-500/10 outline-none transition-all placeholder-gray-300"
                                placeholder="0"
                                value={stockToAdd}
                                onChange={(e) => onStockChange(e.target.value)}
                                onKeyDown={(e) => e.key === 'Enter' && onConfirm()}
                            />
                            <button
                                onClick={() => onStockChange(((parseInt(stockToAdd) || 0) + 1).toString())}
                                className="absolute right-2 top-2 p-3 hover:bg-gray-100 rounded-lg text-gray-500 transition-colors"
                            >
                                +
                            </button>
                        </div>
                        <p className="mt-3 text-center text-xs font-bold text-gray-400">
                            New Total: <span className="text-blue-600">{(product.stockVariants[selectedVariant] || 0) + (parseInt(stockToAdd) || 0)}</span>
                        </p>
                    </div>
                </div>

                <div className="p-8 pt-0 flex gap-4">
                    <button
                        onClick={onClose}
                        className="flex-1 py-4 text-gray-500 font-bold hover:bg-gray-50 rounded-2xl transition-colors"
                    >
                        Cancel
                    </button>
                    <button
                        onClick={onConfirm}
                        disabled={!stockToAdd || parseInt(stockToAdd) <= 0}
                        className="flex-1 py-4 bg-gray-900 text-white font-bold rounded-2xl hover:bg-black transition-colors shadow-lg shadow-gray-900/20 disabled:opacity-50 disabled:shadow-none flex items-center justify-center gap-2"
                    >
                        <span>Confirm Restock</span>
                        <span>✓</span>
                    </button>
                </div>
            </div>
        </div>
    );
};

export default AddStockModal;
