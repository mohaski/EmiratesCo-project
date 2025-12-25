import React, { memo } from 'react';

// --- OPTIMIZATION: Memoized Invoice Card ---
const InvoiceCard = memo(({ invoice, onView }) => (
    <div className="bg-white rounded-2xl p-6 border border-amber-100 shadow-sm hover:shadow-md transition-all group flex flex-col md:flex-row items-center justify-between gap-6 relative overflow-hidden">
        <div className="absolute left-0 top-0 bottom-0 w-1 bg-amber-400"></div>

        <div className="flex-1 min-w-0 pl-2">
            <div className="flex items-center gap-3 mb-1">
                <span className="bg-amber-50 text-amber-700 px-2 py-1 rounded text-xs font-mono font-bold">{invoice.id}</span>
                <span className="text-gray-400 text-xs font-medium">{new Date(invoice.date).toLocaleString()}</span>
            </div>
            <h3 className="text-xl font-bold text-slate-800 truncate">{invoice.customer.name}</h3>
            <div className="flex items-center gap-2 mt-1">
                <span className="text-xs bg-green-100 text-green-700 px-2 py-0.5 rounded font-bold uppercase tracking-wide">Generated</span>
                <span className="text-slate-400 text-xs">{invoice.items} items</span>
            </div>
        </div>

        {/* Total */}
        <div className="w-full md:min-w-[120px] md:w-auto flex md:block justify-between items-center text-right border-t md:border-0 border-gray-100 pt-3 md:pt-0 mt-2 md:mt-0">
            <span className="block text-xs text-gray-400 font-bold uppercase tracking-wider">Estimate</span>
            <span className="text-2xl font-bold text-slate-800">Ksh{invoice.totalAmount.toLocaleString()}</span>
        </div>

        {/* Actions */}
        <div className="flex gap-3 min-w-[150px] justify-end">
            <button
                onClick={() => onView(invoice)}
                className="px-6 py-2.5 rounded-xl bg-amber-500 text-white font-bold text-sm hover:bg-amber-600 transition-colors shadow-lg shadow-amber-200 flex items-center gap-2"
            >
                <span>👁️ View</span>
            </button>
        </div>
    </div>
));

export default InvoiceCard;
