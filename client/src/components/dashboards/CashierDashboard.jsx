import React from 'react';
import { useNavigate } from 'react-router-dom';
import { Plus, ShoppingBag, Clock, RotateCcw } from 'lucide-react';

const CashierDashboard = () => {
    const navigate = useNavigate();

    const quickActions = [
        { label: 'New Sale', icon: Plus, action: () => navigate('/sales'), color: 'blue', primary: true },
        { label: 'My Orders', icon: ShoppingBag, action: () => navigate('/orders'), color: 'purple' },
        { label: 'Refunds', icon: RotateCcw, action: () => navigate('/refunds'), color: 'orange' },
    ];

    return (
        <div className="space-y-8 animate-fade-in-up">
            {/* Quick Actions */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                {quickActions.map((item, idx) => {
                    const Icon = item.icon;
                    return (
                        <button
                            key={idx}
                            onClick={item.action}
                            className={`group relative overflow-hidden p-6 rounded-2xl shadow-lg transition-all transform hover:-translate-y-1 hover:shadow-xl text-left
                ${item.primary
                                    ? 'bg-gradient-to-br from-blue-600 to-indigo-700 text-white shadow-blue-500/30'
                                    : 'bg-white text-gray-800 border border-gray-100 hover:border-gray-200'
                                }`}
                        >
                            <div className={`absolute top-0 right-0 p-4 opacity-10 group-hover:opacity-20 transition-opacity`}>
                                <Icon className="w-24 h-24" />
                            </div>
                            <div className="relative z-10 flex flex-col h-full justify-between">
                                <div className={`p-3 w-fit rounded-xl mb-4 ${item.primary ? 'bg-white/20' : `bg-${item.color}-50 text-${item.color}-600`}`}>
                                    <Icon className="w-6 h-6" />
                                </div>
                                <div>
                                    <h3 className={`text-lg font-bold ${item.primary ? 'text-white' : 'text-gray-900'}`}>{item.label}</h3>
                                    <p className={`text-sm mt-1 ${item.primary ? 'text-blue-100' : 'text-gray-500'}`}>
                                        {item.primary ? 'Start a new transaction' : 'View history & details'}
                                    </p>
                                </div>
                            </div>
                        </button>
                    );
                })}
            </div>

            {/* My Stats & Recent */}
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                <div className="bg-white p-6 rounded-2xl shadow-sm border border-gray-100">
                    <h3 className="text-lg font-bold text-gray-900 mb-4">My Performance (Today)</h3>
                    <div className="space-y-4">
                        <div className="flex justify-between items-center p-4 bg-gray-50 rounded-xl">
                            <span className="text-gray-500 font-medium">Total Sales</span>
                            <span className="text-xl font-bold text-gray-900">KES 45,200</span>
                        </div>
                        <div className="flex justify-between items-center p-4 bg-gray-50 rounded-xl">
                            <span className="text-gray-500 font-medium">Orders Processed</span>
                            <span className="text-xl font-bold text-gray-900">12</span>
                        </div>
                        <div className="flex justify-between items-center p-4 bg-gray-50 rounded-xl">
                            <span className="text-gray-500 font-medium">Average Order</span>
                            <span className="text-xl font-bold text-gray-900">KES 3,766</span>
                        </div>
                    </div>
                </div>

                <div className="lg:col-span-2 bg-white p-6 rounded-2xl shadow-sm border border-gray-100">
                    <h3 className="text-lg font-bold text-gray-900 mb-4">Recent Transactions</h3>
                    <div className="overflow-x-auto">
                        <table className="w-full text-left">
                            <thead>
                                <tr className="border-b border-gray-100 text-xs font-semibold text-gray-500 uppercase tracking-wider">
                                    <th className="pb-3 pl-2">Time</th>
                                    <th className="pb-3">Customer</th>
                                    <th className="pb-3">Amount</th>
                                    <th className="pb-3">Status</th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-gray-50">
                                {[1, 2, 3].map((_, i) => (
                                    <tr key={i} className="group hover:bg-gray-50/50 transition-colors">
                                        <td className="py-3 pl-2 text-sm text-gray-500 flex items-center gap-2">
                                            <Clock className="w-3 h-3" /> 10:3{i} AM
                                        </td>
                                        <td className="py-3 text-sm font-medium text-gray-900">Walk-in Customer</td>
                                        <td className="py-3 text-sm font-bold text-gray-900">KES 2,400</td>
                                        <td className="py-3">
                                            <span className="px-2 py-1 rounded-full bg-green-100 text-green-700 text-xs font-bold">Paid</span>
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                </div>
            </div>
        </div>
    );
};

export default CashierDashboard;
