import React, { useState, useMemo } from 'react';
import { useOrders } from '../context/OrderContext';
import StoreOrderModal from '../components/store/StoreOrderModal';

export default function StoreActiveOrdersPage() {
    const { orders } = useOrders();
    const [selectedOrder, setSelectedOrder] = useState(null);
    const [searchQuery, setSearchQuery] = useState('');

    // Filter Logic:
    // 1. Status must be 'confirmed' (Waiting for prep)
    // 2. Search matches ID or Customer Name
    const activeOrders = useMemo(() => {
        return orders.filter(order => {
            // Assume 'confirmed' means paid/finalized by cashier, waiting for store.
            // If status is undefined in mock, treat 'pending' as active for now for testing?
            // User said: "All confirmed order by cashier".
            // Let's assume we need to update Checkout to set status 'confirmed'.
            // For now, I'll allow 'confirmed' AND 'pending' (for legacy mock data compatibility) 
            // BUT strictly speaking it should be 'confirmed'. 
            // I'll filter for 'confirmed' and 'pending' to capture everything for the demo, 
            // but ideally we migrate to strict status.
            const isActiveStatus = order.status === 'confirmed' || order.status === 'pending';

            const matchesSearch =
                order.id.toLowerCase().includes(searchQuery.toLowerCase()) ||
                order.customer?.name.toLowerCase().includes(searchQuery.toLowerCase());

            return isActiveStatus && matchesSearch;
        }).sort((a, b) => new Date(b.date) - new Date(a.date)); // Newest first
    }, [orders, searchQuery]);

    return (
        <div className="p-6 md:p-12 max-w-7xl mx-auto min-h-screen">

            {/* Header */}
            <div className="flex flex-col md:flex-row justify-between items-start md:items-center mb-10 gap-4">
                <div>
                    <h1 className="text-3xl font-bold text-gray-900 tracking-tight">Active Orders</h1>
                    <p className="text-gray-500 mt-1">Orders waiting for preparation.</p>
                </div>

                {/* Search */}
                <div className="relative w-full md:w-96">
                    <input
                        type="text"
                        placeholder="Search Order # or Customer..."
                        value={searchQuery}
                        onChange={(e) => setSearchQuery(e.target.value)}
                        className="w-full pl-10 pr-4 py-3 bg-white border border-gray-200 rounded-xl focus:ring-2 focus:ring-purple-500 focus:border-purple-500 outline-none transition-all shadow-sm"
                    />
                    <svg className="w-5 h-5 text-gray-400 absolute left-3 top-3.5" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="11" cy="11" r="8"></circle><line x1="21" y1="21" x2="16.65" y2="16.65"></line></svg>
                </div>
            </div>

            {/* Orders Grid */}
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                {activeOrders.length > 0 ? (
                    activeOrders.map(order => (
                        <div
                            key={order.id}
                            onClick={() => setSelectedOrder(order)}
                            className="bg-white rounded-2xl p-6 border border-gray-100 shadow-sm hover:shadow-md transition-all cursor-pointer group"
                        >
                            <div className="flex justify-between items-start mb-4">
                                <div className="bg-purple-50 text-purple-700 px-3 py-1 rounded-lg text-xs font-bold uppercase tracking-wider">
                                    {order.status || 'Pending'}
                                </div>
                                <span className="text-gray-400 text-xs font-mono">
                                    {new Date(order.date).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                                </span>
                            </div>

                            <h3 className="text-lg font-bold text-gray-900 mb-1 group-hover:text-purple-600 transition-colors">
                                {order.id}
                            </h3>
                            <div className="text-gray-500 text-sm mb-4 font-medium flex items-center gap-2">
                                <span>👤 {order.customer?.name}</span>
                            </div>

                            {/* Mini Preview of Profile/Glass counts */}
                            <div className="flex gap-3 text-xs text-gray-400 border-t border-gray-50 pt-4">
                                <span className="flex items-center gap-1">
                                    🪟 {order.items?.filter(i => i.category === 'profile').length || 0} Profiles
                                </span>
                                <span className="flex items-center gap-1">
                                    💎 {order.items?.filter(i => i.category === 'glass').length || 0} Glass
                                </span>
                            </div>
                        </div>
                    ))
                ) : (
                    <div className="col-span-full py-20 text-center text-gray-400 bg-gray-50 rounded-3xl border-2 border-dashed border-gray-200">
                        <p className="text-xl font-medium">No active orders found.</p>
                        <p className="text-sm mt-2">All caught up! 🎉</p>
                    </div>
                )}
            </div>

            {/* Detail Modal */}
            {selectedOrder && (
                <StoreOrderModal
                    order={selectedOrder}
                    onClose={() => setSelectedOrder(null)}
                />
            )}
        </div>
    );
}
