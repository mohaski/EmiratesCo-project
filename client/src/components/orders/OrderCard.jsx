import React, { memo } from 'react';

// --- OPTIMIZATION: Memoized Order Card ---
const OrderCard = memo(({ order, onAddTo, onEdit }) => (
    <div className="bg-white rounded-2xl p-6 border border-gray-100 shadow-sm hover:shadow-md transition-all group flex flex-col md:flex-row items-center justify-between gap-6">
        {/* Order Info */}
        <div className="flex-1 min-w-0">
            <div className="flex items-center gap-3 mb-1">
                <span className="bg-slate-100 text-slate-600 px-2 py-1 rounded text-xs font-mono font-bold">{order.id}</span>
                <span className="text-gray-400 text-xs font-medium">{new Date(order.date).toLocaleString()}</span>
            </div>
            <h3 className="text-xl font-bold text-slate-800 truncate">{order.customer.name}</h3>
            <p className="text-slate-500 text-sm mb-2">{order.items.length} items • {order.paymentMethod.toUpperCase()}</p>

            {/* Mini Items Preview */}
            <div className="flex gap-2 overflow-hidden py-1">
                {order.items.slice(0, 3).map((item, idx) => (
                    <span key={idx} className="text-xs bg-gray-50 text-gray-500 px-2 py-1 rounded border border-gray-100 truncate max-w-[150px]">
                        {item.name}
                    </span>
                ))}
                {order.items.length > 3 && <span className="text-xs text-gray-400 px-2 self-center">+{order.items.length - 3} more</span>}
            </div>
        </div>

        {/* Total */}
        <div className="text-right min-w-[120px]">
            <span className="block text-xs text-gray-400 font-bold uppercase tracking-wider">Total</span>
            <span className="text-2xl font-bold text-slate-800">Ksh{order.totalAmount.toLocaleString()}</span>
        </div>

        {/* Actions */}
        <div className="flex gap-3 min-w-[200px] justify-end">
            <button
                onClick={() => onAddTo(order)}
                className="px-5 py-2.5 rounded-xl bg-blue-50 text-blue-600 font-bold text-sm hover:bg-blue-100 transition-colors border border-blue-100 flex items-center gap-2"
            >
                <span>➕ Add To</span>
            </button>
            <button
                onClick={() => onEdit(order)}
                className="px-5 py-2.5 rounded-xl bg-slate-900 text-white font-bold text-sm hover:bg-slate-800 transition-colors shadow-lg shadow-slate-200 flex items-center gap-2"
            >
                <span>✏️ Edit</span>
            </button>
        </div>
    </div>
));

export default OrderCard;
