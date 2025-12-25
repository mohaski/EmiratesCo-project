import React, { useState, useEffect, memo } from 'react';

const StandardCalculator = memo(({ product, initialDetails, onUpdate }) => {
    const [qty, setQty] = useState(initialDetails?.qty || 1);
    useEffect(() => {
        const total = qty * product.price;

        // Universal Schema
        const lineItems = [{
            type: 'standard',
            label: product.name || 'Item',
            qty: qty,
            rate: product.price,
            total: total,
            meta: { unit: product.unit }
        }];

        const attributes = []; // Standard items usually have no extra attributes

        onUpdate(total, {
            lineItems,
            attributes,
            // Legacy
            qty,
            unit: product.unit
        });
    }, [qty, product.price, product.unit, product.name, onUpdate]);

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

export default StandardCalculator;
