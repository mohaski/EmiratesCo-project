import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';

export default function DashboardPage() {
    const { user, logout } = useAuth();
    const navigate = useNavigate();
    const [isMenuOpen, setIsMenuOpen] = useState(false);

    // Mock Data for Dashboard
    const stats = [
        { label: 'Total Sales Today', value: '$1,240.00', change: '+12%', color: 'blue' },
        { label: 'Orders Completed', value: '18', change: '+5', color: 'green' },
        { label: 'Pending Credit', value: '$450.00', change: '-2%', color: 'orange' },
        { label: 'New Customers', value: '3', change: '+2', color: 'purple' },
    ];

    const recentOrders = [
        { id: '#ORD-001', customer: 'John Doe', amount: '$320.00', status: 'Completed', time: '10:30 AM', type: 'Cash' },
        { id: '#ORD-002', customer: 'Walk-in Customer', amount: '$45.00', status: 'Completed', time: '11:15 AM', type: 'M-Pesa' },
        { id: '#ORD-003', customer: 'Sarah Smith', amount: '$850.00', status: 'Credit (Partial)', time: '12:00 PM', type: 'Split' },
        { id: '#ORD-004', customer: 'Construction Co.', amount: '$1,200.00', status: 'Pending', time: '1:45 PM', type: 'Credit' },
    ];

    return (
        <div className="min-h-screen bg-gray-50 flex flex-col font-sans text-gray-900">
            {/* Top Navigation */}
            <header className="bg-white/80 backdrop-blur-md border-b border-gray-200 sticky top-0 z-40 transition-all">
                <div className="max-w-7xl mx-auto px-4 sm:px-6 h-16 md:h-20 flex items-center justify-between">
                    <div className="flex items-center gap-4">
                        <div className="w-10 h-10 bg-blue-600 rounded-xl flex items-center justify-center text-white font-bold shadow-lg shadow-blue-500/20 transform hover:scale-105 transition-transform duration-300">
                            EC
                        </div>
                        <div>
                            <h1 className="text-xl font-bold text-gray-800 tracking-tight">EmiratesCo</h1>
                            <p className="text-[10px] sm:text-xs text-gray-500 font-bold tracking-widest uppercase">Sales Dashboard</p>
                        </div>
                    </div>

                    {/* Desktop User profile */}
                    <div className="hidden md:flex items-center gap-6">
                        <div className="text-right">
                            <div className="text-sm font-bold text-gray-900">{user?.name || 'Sales Agent'}</div>
                            <div className="text-xs text-gray-500">{new Date().toLocaleDateString(undefined, { weekday: 'long', month: 'short', day: 'numeric' })}</div>
                        </div>
                        <div className="w-10 h-10 rounded-full bg-gray-100 border border-gray-200 flex items-center justify-center text-gray-400">
                            <span className="text-lg">👤</span>
                        </div>
                    </div>

                    {/* Mobile Menu Button */}
                    <button
                        onClick={() => setIsMenuOpen(!isMenuOpen)}
                        className="md:hidden p-2 text-gray-600 hover:bg-gray-100 rounded-lg"
                    >
                        <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M4 6h16M4 12h16m-7 6h7"></path></svg>
                    </button>
                </div>

                {/* Mobile Menu Dropdown */}
                {isMenuOpen && (
                    <div className="md:hidden border-t border-gray-100 bg-white px-4 py-4 space-y-3 shadow-lg absolute w-full left-0 animate-slide-down">
                        <div className="flex items-center gap-3 pb-3 border-b border-gray-100">
                            <div className="w-10 h-10 rounded-full bg-gray-100 flex items-center justify-center text-gray-400">👤</div>
                            <div>
                                <div className="font-bold text-gray-900">{user?.name || 'Sales Agent'}</div>
                                <div className="text-xs text-gray-500">{new Date().toLocaleDateString()}</div>
                            </div>
                        </div>
                        <button onClick={() => { navigate('/sales'); setIsMenuOpen(false) }} className="w-full text-left px-4 py-3 bg-blue-50 text-blue-700 font-bold rounded-xl">New Sale</button>
                        <button className="w-full text-left px-4 py-3 hover:bg-gray-50 text-gray-700 font-medium rounded-xl">Orders</button>
                        <button className="w-full text-left px-4 py-3 hover:bg-gray-50 text-gray-700 font-medium rounded-xl">Settings</button>
                    </div>
                )}
            </header>

            <main className="flex-1 max-w-7xl mx-auto px-4 sm:px-6 py-6 md:py-10 w-full">

                {/* Welcome Section */}
                <div className="mb-8 md:mb-12 flex flex-col md:flex-row gap-6 md:items-center justify-between animate-fade-in-up">
                    <div>
                        <h2 className="text-2xl md:text-3xl font-bold text-gray-900">Good Afternoon, {user?.name?.split(' ')[0] || 'Agent'}! 👋</h2>
                        <p className="text-gray-500 mt-2 text-base md:text-lg">Review your daily performance and manage orders.</p>
                    </div>
                    <button
                        onClick={() => navigate('/sales')}
                        className="group flex items-center justify-center gap-3 bg-blue-600 hover:bg-blue-700 text-white px-6 md:px-8 py-3.5 md:py-4 rounded-2xl font-bold text-lg shadow-xl shadow-blue-600/20 transition-all transform hover:-translate-y-1 active:scale-95 w-full md:w-auto"
                    >
                        <span className="bg-blue-500/50 p-1.5 rounded-lg group-hover:bg-blue-500 transition-colors">
                            <svg className="w-5 h-5 md:w-6 md:h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 4v16m8-8H4"></path></svg>
                        </span>
                        <span>New Sale</span>
                        <span className="opacity-70 group-hover:translate-x-1 transition-transform">→</span>
                    </button>
                </div>

                {/* Stats Grid */}
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 md:gap-6 mb-8 md:mb-12">
                    {stats.map((stat, idx) => (
                        <div key={idx} className="bg-white p-5 md:p-6 rounded-2xl border border-gray-100 shadow-[0_4px_20px_rgba(0,0,0,0.03)] hover:shadow-[0_8px_30px_rgba(0,0,0,0.06)] transition-all duration-300 transform hover:-translate-y-1 group">
                            <div className="flex justify-between items-start mb-4">
                                <div className={`p-3 rounded-xl bg-${stat.color}-50 text-${stat.color}-600 group-hover:bg-${stat.color}-100 transition-colors`}>
                                    {/* Simplified Icon Logic */}
                                    {idx === 0 && '💰'}
                                    {idx === 1 && '🛒'}
                                    {idx === 2 && '⏳'}
                                    {idx === 3 && '👥'}
                                </div>
                                <span className={`text-xs font-bold px-2.5 py-1 rounded-full ${stat.change.startsWith('+') ? 'bg-green-50 text-green-600' : 'bg-red-50 text-red-600'}`}>
                                    {stat.change}
                                </span>
                            </div>
                            <div className="text-2xl md:text-3xl font-bold text-gray-900 mb-1 tracking-tight">{stat.value}</div>
                            <div className="text-sm text-gray-500 font-medium">{stat.label}</div>

                            {/* Decorative Blur blob */}
                            <div className={`absolute -bottom-4 -right-4 w-24 h-24 bg-${stat.color}-50 rounded-full blur-2xl opacity-0 group-hover:opacity-100 transition-opacity duration-500 pointer-events-none`}></div>
                        </div>
                    ))}
                </div>

                {/* Recent Activity & Quick Links */}
                <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">

                    {/* Recent Orders Table */}
                    <div className="lg:col-span-2 bg-white rounded-3xl border border-gray-100 overflow-hidden shadow-sm">
                        <div className="p-6 border-b border-gray-50 flex justify-between items-center bg-gray-50/30">
                            <h3 className="font-bold text-lg text-gray-900">Recent Orders</h3>
                            <button className="text-blue-600 text-sm font-bold hover:bg-blue-50 px-3 py-1 rounded-lg transition-colors">View All</button>
                        </div>
                        <div className="overflow-x-auto scrollbar-thin scrollbar-thumb-gray-200 hover:scrollbar-thumb-gray-300">
                            <table className="w-full text-left border-collapse min-w-[600px]">
                                <thead>
                                    <tr className="text-xs text-gray-400 uppercase border-b border-gray-100">
                                        <th className="px-6 py-4 font-bold tracking-wider">Order ID</th>
                                        <th className="px-6 py-4 font-bold tracking-wider">Customer</th>
                                        <th className="px-6 py-4 font-bold tracking-wider">Amount</th>
                                        <th className="px-6 py-4 font-bold tracking-wider">Status</th>
                                        <th className="px-6 py-4 font-bold tracking-wider">Method</th>
                                    </tr>
                                </thead>
                                <tbody className="text-sm">
                                    {recentOrders.map((order, i) => (
                                        <tr key={i} className="border-b border-gray-50 hover:bg-gray-50/50 transition-colors group">
                                            <td className="px-6 py-4 font-medium text-gray-900 group-hover:text-blue-600 transition-colors">{order.id}</td>
                                            <td className="px-6 py-4 text-gray-600">
                                                <div className="flex items-center gap-2">
                                                    <div className="w-6 h-6 rounded-full bg-gray-100 flex items-center justify-center text-[10px] text-gray-500 font-bold">
                                                        {order.customer.charAt(0)}
                                                    </div>
                                                    {order.customer}
                                                </div>
                                            </td>
                                            <td className="px-6 py-4 font-bold text-gray-900">{order.amount}</td>
                                            <td className="px-6 py-4">
                                                <span className={`px-2.5 py-1 rounded-md text-xs font-bold inline-flex items-center gap-1
                                                    ${order.status === 'Completed' ? 'bg-green-50 text-green-700 border border-green-100' :
                                                        order.status.includes('Credit') ? 'bg-orange-50 text-orange-700 border border-orange-100' : 'bg-gray-100 text-gray-600'}`}>
                                                    <span className={`w-1.5 h-1.5 rounded-full ${order.status === 'Completed' ? 'bg-green-500' : 'bg-orange-500'}`}></span>
                                                    {order.status}
                                                </span>
                                            </td>
                                            <td className="px-6 py-4 text-gray-500 font-medium text-xs uppercase">{order.type}</td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                    </div>

                    {/* Quick Access Sidebar */}
                    <div className="space-y-6">
                        <div className="bg-gradient-to-br from-slate-900 to-slate-800 rounded-3xl p-8 text-white shadow-xl shadow-slate-900/10 relative overflow-hidden group cursor-pointer transform transition-all hover:scale-[1.02]" onClick={() => navigate('/sales')}>
                            <div className="absolute top-0 right-0 p-8 opacity-10 transform translate-x-4 -translate-y-4 group-hover:scale-125 transition-transform duration-700">
                                <svg className="w-40 h-40" fill="currentColor" viewBox="0 0 24 24"><path d="M3 3h2l.4 2M7 13h10l4-8H5.4M7 13L5.4 5M7 13l-2.293 2.293c-.63.63-.184 1.707.707 1.707H17m0 0a2 2 0 100 4 2 2 0 000-4zm-8 2a2 2 0 11-4 0 2 2 0 014 0z"></path></svg>
                            </div>
                            <div className="relative z-10">
                                <h3 className="text-2xl font-bold mb-2">Start New Sale</h3>
                                <p className="text-slate-300 mb-8 text-sm leading-relaxed">Open the Point of Sale terminal to process new orders, manage cart, and checkout customers.</p>
                                <button className="bg-white text-slate-900 w-full py-4 rounded-xl text-sm font-bold hover:bg-blue-50 transition-colors shadow-lg shadow-black/20 flex items-center justify-center gap-2">
                                    <span>Open POS Terminal</span>
                                    <span>→</span>
                                </button>
                            </div>
                        </div>

                        <div className="bg-white rounded-3xl border border-gray-100 p-6 shadow-sm">
                            <h3 className="font-bold text-gray-900 mb-4 px-2">Quick Actions</h3>
                            <div className="space-y-2">
                                <button className="w-full text-left px-4 py-3.5 rounded-xl hover:bg-gray-50 transition-colors text-sm font-medium text-gray-700 flex items-center justify-between group">
                                    <span className="flex items-center gap-3">
                                        <span className="w-8 h-8 rounded-lg bg-blue-50 text-blue-600 flex items-center justify-center text-xs">👥</span>
                                        Manage Customers
                                    </span>
                                    <span className="text-gray-300 group-hover:text-blue-500 group-hover:translate-x-1 transition-all">→</span>
                                </button>
                                <button className="w-full text-left px-4 py-3.5 rounded-xl hover:bg-gray-50 transition-colors text-sm font-medium text-gray-700 flex items-center justify-between group">
                                    <span className="flex items-center gap-3">
                                        <span className="w-8 h-8 rounded-lg bg-purple-50 text-purple-600 flex items-center justify-center text-xs">📜</span>
                                        Transaction History
                                    </span>
                                    <span className="text-gray-300 group-hover:text-purple-500 group-hover:translate-x-1 transition-all">→</span>
                                </button>
                                <button className="w-full text-left px-4 py-3.5 rounded-xl hover:bg-gray-50 transition-colors text-sm font-medium text-gray-700 flex items-center justify-between group">
                                    <span className="flex items-center gap-3">
                                        <span className="w-8 h-8 rounded-lg bg-orange-50 text-orange-600 flex items-center justify-center text-xs">📦</span>
                                        Inventory & Stock
                                    </span>
                                    <span className="text-gray-300 group-hover:text-orange-500 group-hover:translate-x-1 transition-all">→</span>
                                </button>
                            </div>
                        </div>
                    </div>

                </div>
            </main>
        </div>
    );
}
