import React, { useState, useMemo, useCallback, useDeferredValue, memo } from 'react';
import { useNavigate } from 'react-router-dom';
import { MOCK_ORDERS, MOCK_INVOICES } from '../data/mockOrders';

// --- Imports ---
import OrderCard from '../components/orders/OrderCard';
import InvoiceCard from '../components/orders/InvoiceCard';

// --- MAIN COMPONENT ---
export default function OrdersPage() {
    const navigate = useNavigate();
    const [activeTab, setActiveTab] = useState('orders'); // 'orders' | 'invoices'
    const [searchQuery, setSearchQuery] = useState('');

    // OPTIMIZATION: Deferred value keeps the UI responsive while filtering
    const deferredQuery = useDeferredValue(searchQuery);

    // --- OPTIMIZATION: Memoized Filtering ---
    const filteredOrders = useMemo(() => {
        // Return empty if not active tab to save calculation
        if (activeTab !== 'orders') return [];

        const lowerQuery = deferredQuery.toLowerCase();
        return MOCK_ORDERS.filter(o =>
            !lowerQuery ||
            o.id.toLowerCase().includes(lowerQuery) ||
            o.customer.name.toLowerCase().includes(lowerQuery)
        ).sort((a, b) => new Date(b.date) - new Date(a.date));
    }, [activeTab, deferredQuery]);

    const filteredInvoices = useMemo(() => {
        if (activeTab !== 'invoices') return [];

        const lowerQuery = deferredQuery.toLowerCase();
        return MOCK_INVOICES.filter(i =>
            !lowerQuery ||
            i.id.toLowerCase().includes(lowerQuery) ||
            i.customer.name.toLowerCase().includes(lowerQuery)
        ).sort((a, b) => new Date(b.date) - new Date(a.date));
    }, [activeTab, deferredQuery]);

    // -- Actions (Stable Handlers) --
    const handleAddTo = useCallback((order) => {
        navigate('/sales', {
            state: {
                mode: 'link',
                parentOrderId: order.id,
                customer: order.customer
            }
        });
    }, [navigate]);

    const handleEdit = useCallback((order) => {
        navigate('/sales', {
            state: {
                mode: 'edit',
                orderData: order
            }
        });
    }, [navigate]);

    const handleViewInvoice = useCallback((invoice) => {
        navigate('/invoice/review', {
            state: {
                cartItems: [], // load real items here
                customer: invoice.customer
            }
        });
    }, [navigate]);

    return (
        <div className="flex flex-col h-full bg-slate-50 relative overflow-hidden">

            {/* Header */}
            <div className="bg-white/80 backdrop-blur-md border-b border-gray-200 px-4 md:px-8 py-6 flex flex-col md:flex-row md:items-center justify-between gap-4 z-10 sticky top-0">
                <div>
                    <h1 className="text-2xl md:text-3xl font-bold text-slate-800 tracking-tight">Order Management</h1>
                    <p className="text-slate-500 font-medium">Track Sales & Manage Invoices</p>
                </div>

                {/* Search */}
                <div className="relative w-full md:w-96">
                    <span className="absolute left-4 top-3.5 text-gray-400">🔍</span>
                    <input
                        type="text"
                        placeholder="Search Order ID or Customer..."
                        className="w-full pl-10 pr-4 py-3 rounded-xl border border-gray-200 bg-gray-50 focus:bg-white focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 transition-all outline-none"
                        value={searchQuery}
                        onChange={(e) => setSearchQuery(e.target.value)}
                    />
                </div>
            </div>

            {/* Tabs */}
            <div className="px-4 md:px-8 mt-6">
                <div className="flex gap-6 border-b border-gray-200 overflow-x-auto scrollbar-hide">
                    <button
                        onClick={() => setActiveTab('orders')}
                        className={`pb-4 px-2 font-bold text-lg transition-all relative whitespace-nowrap ${activeTab === 'orders' ? 'text-slate-800' : 'text-gray-400 hover:text-gray-600'}`}
                    >
                        Sales Orders
                        {activeTab === 'orders' && <span className="absolute bottom-0 left-0 w-full h-1 bg-slate-800 rounded-t-full"></span>}
                    </button>
                    <button
                        onClick={() => setActiveTab('invoices')}
                        className={`pb-4 px-2 font-bold text-lg transition-all relative whitespace-nowrap ${activeTab === 'invoices' ? 'text-amber-600' : 'text-gray-400 hover:text-gray-600'}`}
                    >
                        Quotations & Invoices
                        {activeTab === 'invoices' && <span className="absolute bottom-0 left-0 w-full h-1 bg-amber-500 rounded-t-full"></span>}
                    </button>
                </div>
            </div>

            {/* Content List */}
            <div className="flex-1 overflow-y-auto p-4 md:p-8 custom-scrollbar">

                {activeTab === 'orders' && (
                    <div className="grid grid-cols-1 gap-4">
                        {filteredOrders.map(order => (
                            <OrderCard
                                key={order.id}
                                order={order}
                                onAddTo={handleAddTo}
                                onEdit={handleEdit}
                            />
                        ))}
                        {filteredOrders.length === 0 && (
                            <div className="text-center text-gray-400 py-12">No orders found matching "{searchQuery}"</div>
                        )}
                    </div>
                )}

                {activeTab === 'invoices' && (
                    <div className="grid grid-cols-1 gap-4">
                        {filteredInvoices.map(inv => (
                            <InvoiceCard
                                key={inv.id}
                                invoice={inv}
                                onView={handleViewInvoice}
                            />
                        ))}
                        {filteredInvoices.length === 0 && (
                            <div className="text-center text-gray-400 py-12">No invoices found matching "{searchQuery}"</div>
                        )}
                    </div>
                )}
            </div>
        </div>
    );
}