import React from 'react';

// --- HELPER COMPONENT: Invoice Row ---
// Extracts the complex rendering logic for different product types (Glass, Profile, etc.)
const InvoiceItemRow = ({ item, index, productDef }) => {
    // Fallback object if product definition is missing
    const def = productDef || {};

    return (
        <tr className="group break-inside-avoid page-break-inside-avoid">
            <td className="py-4 text-slate-400 font-mono align-top">{index + 1}</td>
            <td className="py-4">
                <div className="font-bold text-slate-900">{item.name}</div>

                {/* Product Meta Tags */}
                {/* Product Meta Tags */}
                <div className="text-xs text-slate-500 mt-1 flex flex-wrap gap-2 mb-2">
                    {item.details.color && (
                        <span className="bg-slate-100 px-1.5 rounded flex items-center gap-1">
                            <span
                                className="w-2 h-2 rounded-full border border-slate-300"
                                style={{ backgroundColor: item.details.color === 'White' ? '#FFFFFF' : item.details.color }}
                            ></span>
                            {item.details.color}
                        </span>
                    )}

                    {/* Dynamic Extras */}
                    {item.details.extras ? (
                        Object.entries(item.details.extras).map(([key, val]) => {
                            if (key === 'Color' || key === 'Category') return null;
                            return (
                                <span key={key} className="bg-slate-100 px-1.5 rounded">
                                    {val}{key === 'Length' && typeof val === 'number' ? 'ft' : ''}
                                </span>
                            );
                        })
                    ) : (
                        /* Legacy Fallback */
                        <>
                            {item.details.length && <span className="bg-slate-100 px-1.5 rounded">{item.details.length}FT</span>}
                            {item.details.thickness && <span className="bg-slate-100 px-1.5 rounded">{item.details.thickness}</span>}
                        </>
                    )}
                </div>

                {/* Detailed Breakdown */}
                {/* BREAKDOWN (Universal vs Legacy) */}
                <div className="text-[10px] text-gray-500 mt-1 space-y-0.5">
                    {/* UNIVERSAL SCHEMA ONLY */}
                    {item.details.lineItems && (
                        <>
                            {/* Attributes */}
                            {item.details.attributes && item.details.attributes.length > 0 && (
                                <div className="flex flex-wrap gap-2 mb-1">
                                    {item.details.attributes.map((attr, idx) => (
                                        <span key={idx} className="bg-gray-100 px-1 py-0.5 rounded text-[9px] border border-gray-200">
                                            {attr.label}: <span className="font-medium text-gray-700">{attr.value}</span>
                                        </span>
                                    ))}
                                </div>
                            )}
                            {/* Line Items */}
                            {item.details.lineItems.map((li, idx) => (
                                <div key={idx} className="flex justify-between w-full border-b border-gray-100 border-dotted last:border-0 pb-0.5">
                                    <span>{li.label} {li.meta?.l && `(${li.meta.l}x${li.meta.w}${li.meta.u || ''})`}</span>
                                    <span className="font-mono">
                                        {li.qty} x {li.rate.toFixed(0)} = <span className="font-bold text-gray-700">{li.total.toFixed(0)}</span>
                                    </span>
                                </div>
                            ))}
                        </>
                    )}
                </div>
            </td>
            <td className="py-4 text-right font-mono font-medium text-slate-800 align-top">
                {(item.totalPrice).toFixed(2)}
            </td>
        </tr>
    );
};

export default InvoiceItemRow;
