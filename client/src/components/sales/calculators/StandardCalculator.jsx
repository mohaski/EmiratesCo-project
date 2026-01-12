import React, { useState, useEffect, memo } from 'react';

const StandardCalculator = memo(({ product, initialDetails, onUpdate }) => {
    const [qty, setQty] = useState(initialDetails?.qty || 1);
    const stock = product.stock || 0;
    const [error, setError] = useState(null);

    useEffect(() => {
        // Validation
        const isValid = qty <= stock;

        if (!isValid) {
            setError(`Only ${stock} items available in stock`);
        } else {
            setError(null);
        }

        const total = qty * product.price;

        const lineItems = [{
            type: 'standard',
            label: product.name || 'Item',
            qty: qty,
            rate: product.price,
            total: total,
            meta: { unit: product.unit }
        }];

        const attributes = [];

        onUpdate(total, {
            lineItems,
            attributes,
            qty,
            unit: product.unit,
            isValid // Pass validation status
        });
    }, [qty, product.price, product.unit, product.name, onUpdate, stock]);

    return (
        <div className="bg-gray-50 p-8 rounded-2xl border border-gray-200 flex flex-col items-center justify-center">
            <h3 className="text-xl font-bold text-gray-800 mb-6">Quantity ({product.unit}s)</h3>
            <div className="flex flex-col items-center gap-2">
                <div className="flex items-center gap-6">
                    <button onClick={() => setQty(Math.max(1, qty - 1))} className="w-16 h-16 rounded-2xl bg-white hover:bg-gray-100 text-2xl text-gray-600 transition-all border border-gray-200 shadow-sm font-bold">-</button>
                    <span className={`text-5xl font-bold font-mono w-24 text-center ${error ? 'text-red-500' : 'text-gray-800'}`}>{qty}</span>
                    <button onClick={() => setQty(qty + 1)} className="w-16 h-16 rounded-2xl bg-blue-50 hover:bg-blue-100 text-2xl text-blue-600 transition-all border border-blue-100 shadow-sm font-bold">+</button>
                </div>
                {error && (
                    <div className="text-red-500 text-xs font-bold uppercase tracking-wide animate-pulse flex items-center gap-1 mt-2">
                        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"></path></svg>
                        {error}
                    </div>
                )}
            </div>
            <p className="mt-4 text-blue-600 text-lg font-medium">Ksh{product.price} per {product.unit}</p>
            <p className="text-xs text-gray-400 mt-1 font-medium">Available Stock: {stock}</p>
        </div>
    );
});

export default StandardCalculator;
