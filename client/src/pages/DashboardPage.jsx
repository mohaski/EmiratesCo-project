import { useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';

export default function DashboardPage() {
    const { user, logout } = useAuth();
    const navigate = useNavigate();

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
            <header className="bg-white border-b border-gray-200 sticky top-0 z-30">
                <div className="max-w-7xl mx-auto px-6 h-20 flex items-center justify-between">
                    <div className="flex items-center gap-4">
                        <div className="w-10 h-10 bg-blue-600 rounded-xl flex items-center justify-center text-white font-bold shadow-blue-200 shadow-lg">
                            EC
                        </div>
                        <div>
                            <h1 className="text-xl font-bold text-gray-800 tracking-tight">EmiratesCo</h1>
                            <p className="text-xs text-gray-500 font-medium tracking-wide">SALES DASHBOARD</p>
                        </div>
                    </div>
                    <div className="flex items-center gap-6">
                        <div className="text-right hidden md:block">
                            <div className="text-sm font-bold text-gray-900">{user?.name || 'Sales Agent'}</div>
                            <div className="text-xs text-gray-500">{new Date().toLocaleDateString(undefined, { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })}</div>
                        </div>
                    </div>
                </div>
            </header>

            <main className="flex-1 max-w-7xl mx-auto px-6 py-8 w-full">

                {/* Welcome Section */}
                <div className="mb-10 flex flex-col md:flex-row gap-8 items-start md:items-center justify-between">
                    <div>
                        <h2 className="text-3xl font-bold text-gray-900">Good Afternoon, {user?.name?.split(' ')[0] || 'Agent'}! 👋</h2>
                        <p className="text-gray-500 mt-2 text-lg">Here's what's happening in your store today.</p>
                    </div>
                    <button
                        onClick={() => navigate('/sales')}
                        className="group flex items-center gap-3 bg-blue-600 hover:bg-blue-700 text-white px-8 py-4 rounded-2xl font-bold text-lg shadow-xl shadow-blue-600/20 transition-all transform hover:-translate-y-1 active:scale-95"
                    >
                        <span className="bg-blue-500 p-2 rounded-lg group-hover:bg-blue-600 transition-colors">
                            <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 4v16m8-8H4"></path></svg>
                        </span>
                        <span>New Sale / POS</span>
                        <span className="opacity-70 group-hover:translate-x-1 transition-transform">→</span>
                    </button>
                </div>

                {/* Stats Grid */}
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 mb-12">
                    {stats.map((stat, idx) => (
                        <div key={idx} className="bg-white p-6 rounded-2xl border border-gray-100 shadow-sm hover:shadow-md transition-shadow">
                            <div className="flex justify-between items-start mb-4">
                                <div className={`p-3 rounded-xl bg-${stat.color}-50 text-${stat.color}-600`}>
                                    {/* Simplified Icon Logic based on idx */}
                                    {idx === 0 && '💰'}
                                    {idx === 1 && '🛒'}
                                    {idx === 2 && '⏳'}
                                    {idx === 3 && '👥'}
                                </div>
                                <span className={`text-xs font-bold px-2 py-1 rounded-lg ${stat.change.startsWith('+') ? 'bg-green-50 text-green-600' : 'bg-red-50 text-red-600'}`}>
                                    {stat.change}
                                </span>
                            </div>
                            <div className="text-3xl font-bold text-gray-900 mb-1">{stat.value}</div>
                            <div className="text-sm text-gray-500 font-medium">{stat.label}</div>
                        </div>
                    ))}
                </div>

                {/* Recent Activity & Quick Links */}
                <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">

                    {/* Recent Orders Table */}
                    <div className="lg:col-span-2 bg-white rounded-3xl border border-gray-200 overflow-hidden shadow-sm">
                        <div className="p-6 border-b border-gray-100 flex justify-between items-center bg-gray-50/50">
                            <h3 className="font-bold text-lg text-gray-900">Recent Orders</h3>
                            <button className="text-blue-600 text-sm font-bold hover:underline">View All</button>
                        </div>
                        <div className="overflow-x-auto">
                            <table className="w-full text-left border-collapse">
                                <thead>
                                    <tr className="text-xs text-gray-400 uppercase border-b border-gray-100">
                                        <th className="px-6 py-4 font-bold">Order ID</th>
                                        <th className="px-6 py-4 font-bold">Customer</th>
                                        <th className="px-6 py-4 font-bold">Amount</th>
                                        <th className="px-6 py-4 font-bold">Status</th>
                                        <th className="px-6 py-4 font-bold">Method</th>
                                    </tr>
                                </thead>
                                <tbody className="text-sm">
                                    {recentOrders.map((order, i) => (
                                        <tr key={i} className="border-b border-gray-50 hover:bg-gray-50/50 transition-colors">
                                            <td className="px-6 py-4 font-medium text-gray-900">{order.id}</td>
                                            <td className="px-6 py-4 text-gray-600">{order.customer}</td>
                                            <td className="px-6 py-4 font-bold text-gray-900">{order.amount}</td>
                                            <td className="px-6 py-4">
                                                <span className={`px-2 py-1 rounded-md text-xs font-bold 
                                                    ${order.status === 'Completed' ? 'bg-green-50 text-green-600' :
                                                        order.status.includes('Credit') ? 'bg-orange-50 text-orange-600' : 'bg-gray-100 text-gray-600'}`}>
                                                    {order.status}
                                                </span>
                                            </td>
                                            <td className="px-6 py-4 text-gray-500">{order.type}</td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                    </div>

                    {/* Quick Access Sidebar */}
                    <div className="space-y-6">
                        <div className="bg-gradient-to-br from-gray-900 to-gray-800 rounded-3xl p-6 text-white shadow-xl shadow-gray-900/10 relative overflow-hidden group cursor-pointer" onClick={() => navigate('/sales')}>
                            <div className="absolute top-0 right-0 p-8 opacity-10 transform translate-x-4 -translate-y-4 group-hover:scale-110 transition-transform">
                                <svg className="w-32 h-32" fill="currentColor" viewBox="0 0 24 24"><path d="M3 3h2l.4 2M7 13h10l4-8H5.4M7 13L5.4 5M7 13l-2.293 2.293c-.63.63-.184 1.707.707 1.707H17m0 0a2 2 0 100 4 2 2 0 000-4zm-8 2a2 2 0 11-4 0 2 2 0 014 0z"></path></svg>
                            </div>
                            <div className="relative z-10">
                                <h3 className="text-2xl font-bold mb-2">Start Sale</h3>
                                <p className="text-gray-400 mb-6">Open the Point of Sale terminal to process new orders.</p>
                                <button className="bg-white text-gray-900 px-4 py-2 rounded-xl text-sm font-bold hover:bg-gray-100 transition-colors">
                                    Open POS →
                                </button>
                            </div>
                        </div>

                        <div className="bg-white rounded-3xl border border-gray-200 p-6 shadow-sm">
                            <h3 className="font-bold text-gray-900 mb-4">Quick Links</h3>
                            <div className="space-y-3">
                                <button className="w-full text-left px-4 py-3 rounded-xl bg-gray-50 hover:bg-gray-100 transition-colors text-sm font-medium text-gray-700 flex items-center justify-between group">
                                    <span>Manage Customers</span>
                                    <span className="text-gray-400 group-hover:translate-x-1 transition-transform">→</span>
                                </button>
                                <button className="w-full text-left px-4 py-3 rounded-xl bg-gray-50 hover:bg-gray-100 transition-colors text-sm font-medium text-gray-700 flex items-center justify-between group">
                                    <span>Transaction History</span>
                                    <span className="text-gray-400 group-hover:translate-x-1 transition-transform">→</span>
                                </button>
                                <button className="w-full text-left px-4 py-3 rounded-xl bg-gray-50 hover:bg-gray-100 transition-colors text-sm font-medium text-gray-700 flex items-center justify-between group">
                                    <span>Inventory & Stock</span>
                                    <span className="text-gray-400 group-hover:translate-x-1 transition-transform">→</span>
                                </button>
                            </div>
                        </div>
                    </div>

                </div>
            </main>
        </div>
    );
}
