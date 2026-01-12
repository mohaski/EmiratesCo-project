import React, { useMemo } from 'react';
import { useOrders } from '../../context/OrderContext';

export default function StoreOrderModal({ order, onClose }) {
    const { updateOrderStatus } = useOrders();

    // Filter Items: ONLY Profile and Glass
    const storeItems = useMemo(() => {
        return (order.items || []).filter(item =>
            item.category === 'profile' || item.category === 'glass'
        );
    }, [order]);

    const handleConfirm = () => {
        if (window.confirm('Mark this order as Ready for Pickup?')) {
            updateOrderStatus(order.id, 'ready');
            onClose();
        }
    };

    return (
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 sm:p-6">
            <div
                className="absolute inset-0 bg-slate-900/60 backdrop-blur-sm transition-opacity"
                onClick={onClose}
            ></div>

            <div className="relative bg-white rounded-2xl shadow-2xl w-full max-w-4xl max-h-[90vh] flex flex-col overflow-hidden animate-scale-in">

                {/* Header */}
                <div className="px-8 py-6 border-b border-gray-100 flex justify-between items-center bg-gray-50/50">
                    <div>
                        <h2 className="text-2xl font-bold text-gray-900">Order Preparation</h2>
                        <div className="flex items-center gap-3 mt-1 text-sm text-gray-500">
                            <span className="font-mono font-bold text-purple-600">#{order.id}</span>
                            <span>•</span>
                            <span>{order.customer?.name}</span>
                        </div>
                    </div>
                    <button
                        onClick={onClose}
                        className="w-8 h-8 flex items-center justify-center rounded-full bg-gray-200 hover:bg-gray-300 transition-colors"
                    >
                        ✕
                    </button>
                </div>

                {/* Content - Filtered List */}
                <div className="flex-1 overflow-y-auto p-8 custom-scrollbar">
                    {storeItems.length > 0 ? (
                        <div className="space-y-6">
                            {storeItems.map((item, idx) => (
                                <div key={idx} className="flex gap-4 p-4 rounded-xl border border-gray-100 bg-gray-50/50 hover:bg-white hover:border-purple-100 hover:shadow-sm transition-all">
                                    {/* Image/Icon placeholder */}
                                    <div className="w-16 h-16 rounded-lg bg-white border border-gray-200 flex items-center justify-center text-2xl flex-shrink-0">
                                        {item.category === 'profile' ? '🏗️' : '💎'}
                                    </div>

                                    <div className="flex-1">
                                        <div className="flex justify-between items-start">
                                            <div>
                                                <h4 className="font-bold text-gray-900">{item.name}</h4>
                                                <p className="text-xs text-gray-500 uppercase tracking-wide font-bold mt-0.5">{item.category}</p>
                                            </div>
                                            <div className="text-right">
                                                <span className="bg-gray-900 text-white text-xs px-2 py-1 rounded font-bold">
                                                    Qty: {item.qty || 1}
                                                </span>
                                            </div>
                                        </div>

                                        {/* Tech Specs */}
                                        <div className="mt-3 text-sm text-gray-600 grid grid-cols-2 gap-x-8 gap-y-1">
                                            {/* Generic detail rendering */}
                                            {item.details?.length && (
                                                <div className="col-span-2 text-xs font-mono text-gray-500 border-l-2 border-purple-200 pl-2">
                                                    Length: {item.details.length}
                                                </div>
                                            )}
                                            {item.details?.color && (
                                                <div className="flex justify-between border-b border-gray-200 border-dashed py-1">
                                                    <span>Color</span>
                                                    <span className="font-bold">{item.details.color}</span>
                                                </div>
                                            )}
                                            {item.details?.thickness && (
                                                <div className="flex justify-between border-b border-gray-200 border-dashed py-1">
                                                    <span>Thickness</span>
                                                    <span className="font-bold">{item.details.thickness}</span>
                                                </div>
                                            )}
                                            {/* Render line items if profile/glass breakdown exists */}
                                            {item.details?.lineItems?.map((li, i) => (
                                                <div key={i} className="col-span-2 flex justify-between py-0.5 text-xs">
                                                    <span>{li.label} ({li.qty}x)</span>
                                                    <span className="font-mono">{li.meta?.length || li.meta?.l}</span>
                                                </div>
                                            ))}
                                        </div>
                                    </div>
                                </div>
                            ))}
                        </div>
                    ) : (
                        <div className="text-center py-12 text-gray-400">
                            <div className="text-4xl mb-3">✅</div>
                            <h3 className="text-lg font-bold text-gray-600">No Store Items</h3>
                            <p>This order contains only accessories (handled by cashier).</p>
                        </div>
                    )}
                </div>

                {/* Footer Actions */}
                <div className="p-6 border-t border-gray-100 bg-white flex justify-between items-center z-10">
                    <span className="text-sm text-gray-500">
                        Showing {storeItems.length} of {order.items?.length || 0} items
                    </span>
                    <button
                        onClick={handleConfirm}
                        className="bg-purple-600 hover:bg-purple-700 text-white px-8 py-3 rounded-xl font-bold shadow-lg shadow-purple-500/30 transform active:scale-95 transition-all flex items-center gap-2"
                    >
                        <span>✓ Confirm Preparation</span>
                    </button>
                </div>
            </div>
        </div>
    );
}
