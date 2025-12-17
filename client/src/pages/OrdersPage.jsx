import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { MOCK_ORDERS, MOCK_INVOICES } from '../data/mockOrders';

export default function OrdersPage() {
    const navigate = useNavigate();
    const [activeTab, setActiveTab] = useState('orders'); // 'orders' | 'invoices'
    const [searchQuery, setSearchQuery] = useState('');

    const filteredOrders = MOCK_ORDERS.filter(o =>
        o.id.toLowerCase().includes(searchQuery.toLowerCase()) ||
        o.customer.name.toLowerCase().includes(searchQuery.toLowerCase())
    ).sort((a, b) => new Date(b.date) - new Date(a.date));

    const filteredInvoices = MOCK_INVOICES.filter(i =>
        i.id.toLowerCase().includes(searchQuery.toLowerCase()) ||
        i.customer.name.toLowerCase().includes(searchQuery.toLowerCase())
    ).sort((a, b) => new Date(b.date) - new Date(a.date));

    // -- Actions --
    const handleAddTo = (order) => {
        // Start a new order linked to this one
        navigate('/sales', {
            state: {
                mode: 'link',
                parentOrderId: order.id,
                customer: order.customer
            }
        });
    };

    const handleEdit = (order) => {
        // Re-open this order for editing
        navigate('/sales', {
            state: {
                mode: 'edit',
                orderData: order
            }
        });
    };

    const handleViewInvoice = (invoice) => {
        // Mock reconstruction of cart items for review
        // In real app, fetch items from DB
        navigate('/invoice/review', {
            state: {
                cartItems: [], // load real items here
                customer: invoice.customer
            }
        });
    };

    return (
        <div className="flex flex-col h-full bg-slate-50 relative overflow-hidden">

            {/* Header */}
            <div className="bg-white/80 backdrop-blur-md border-b border-gray-200 px-8 py-6 flex flex-col md:flex-row md:items-center justify-between gap-4 z-10 sticky top-0">
                <div>
                    <h1 className="text-3xl font-bold text-slate-800 tracking-tight">Order Management</h1>
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
            <div className="px-8 mt-6">
                <div className="flex gap-6 border-b border-gray-200">
                    <button
                        onClick={() => setActiveTab('orders')}
                        className={`pb-4 px-2 font-bold text-lg transition-all relative ${activeTab === 'orders' ? 'text-slate-800' : 'text-gray-400 hover:text-gray-600'}`}
                    >
                        Sales Orders
                        {activeTab === 'orders' && <span className="absolute bottom-0 left-0 w-full h-1 bg-slate-800 rounded-t-full"></span>}
                    </button>
                    <button
                        onClick={() => setActiveTab('invoices')}
                        className={`pb-4 px-2 font-bold text-lg transition-all relative ${activeTab === 'invoices' ? 'text-amber-600' : 'text-gray-400 hover:text-gray-600'}`}
                    >
                        Quotations & Invoices
                        {activeTab === 'invoices' && <span className="absolute bottom-0 left-0 w-full h-1 bg-amber-500 rounded-t-full"></span>}
                    </button>
                </div>
            </div>

            {/* Content List */}
            <div className="flex-1 overflow-y-auto p-8 custom-scrollbar">

                {activeTab === 'orders' && (
                    <div className="grid grid-cols-1 gap-4">
                        {filteredOrders.map(order => (
                            <div key={order.id} className="bg-white rounded-2xl p-6 border border-gray-100 shadow-sm hover:shadow-md transition-all group flex flex-col md:flex-row items-center justify-between gap-6">

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
                                    <span className="text-2xl font-bold text-slate-800">${order.totalAmount.toLocaleString()}</span>
                                </div>

                                {/* Actions */}
                                <div className="flex gap-3 min-w-[200px] justify-end">
                                    <button
                                        onClick={() => handleAddTo(order)}
                                        className="px-5 py-2.5 rounded-xl bg-blue-50 text-blue-600 font-bold text-sm hover:bg-blue-100 transition-colors border border-blue-100 flex items-center gap-2"
                                    >
                                        <span>➕ Add To</span>
                                    </button>
                                    <button
                                        onClick={() => handleEdit(order)}
                                        className="px-5 py-2.5 rounded-xl bg-slate-900 text-white font-bold text-sm hover:bg-slate-800 transition-colors shadow-lg shadow-slate-200 flex items-center gap-2"
                                    >
                                        <span>✏️ Edit</span>
                                    </button>
                                </div>
                            </div>
                        ))}
                    </div>
                )}

                {activeTab === 'invoices' && (
                    <div className="grid grid-cols-1 gap-4">
                        {filteredInvoices.map(inv => (
                            <div key={inv.id} className="bg-white rounded-2xl p-6 border border-amber-100 shadow-sm hover:shadow-md transition-all group flex flex-col md:flex-row items-center justify-between gap-6 relative overflow-hidden">
                                <div className="absolute left-0 top-0 bottom-0 w-1 bg-amber-400"></div>

                                <div className="flex-1 min-w-0 pl-2">
                                    <div className="flex items-center gap-3 mb-1">
                                        <span className="bg-amber-50 text-amber-700 px-2 py-1 rounded text-xs font-mono font-bold">{inv.id}</span>
                                        <span className="text-gray-400 text-xs font-medium">{new Date(inv.date).toLocaleString()}</span>
                                    </div>
                                    <h3 className="text-xl font-bold text-slate-800 truncate">{inv.customer.name}</h3>
                                    <div className="flex items-center gap-2 mt-1">
                                        <span className="text-xs bg-green-100 text-green-700 px-2 py-0.5 rounded font-bold uppercase tracking-wide">Generated</span>
                                        <span className="text-slate-400 text-xs">{inv.items} items</span>
                                    </div>
                                </div>

                                <div className="text-right min-w-[120px]">
                                    <span className="block text-xs text-gray-400 font-bold uppercase tracking-wider">Estimate</span>
                                    <span className="text-2xl font-bold text-slate-800">${inv.totalAmount.toLocaleString()}</span>
                                </div>

                                <div className="flex gap-3 min-w-[150px] justify-end">
                                    <button
                                        onClick={() => handleViewInvoice(inv)}
                                        className="px-6 py-2.5 rounded-xl bg-amber-500 text-white font-bold text-sm hover:bg-amber-600 transition-colors shadow-lg shadow-amber-200 flex items-center gap-2"
                                    >
                                        <span>👁️ View</span>
                                    </button>
                                </div>
                            </div>
                        ))}
                    </div>
                )}
            </div>
        </div>
    );
}
