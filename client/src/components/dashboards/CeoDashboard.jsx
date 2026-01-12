import React, { useState } from 'react';
import { DollarSign, ShoppingCart, TrendingUp, Users, ArrowUpRight, ArrowDownRight, Activity, UserPlus } from 'lucide-react';
import UserRegistrationModal from '../users/UserRegistrationModal';

const StatCard = ({ label, value, change, color, icon: Icon, action }) => (
    <div className="bg-white p-6 rounded-2xl shadow-sm border border-gray-100 hover:shadow-md transition-shadow group relative">
        <div className="flex justify-between items-start mb-4">
            <div className={`p-3 rounded-xl bg-${color}-50 text-${color}-600 group-hover:bg-${color}-100 transition-colors`}>
                <Icon className="w-6 h-6" />
            </div>
            {change && (
                <span className={`flex items-center text-xs font-bold px-2 py-1 rounded-full ${change.startsWith('+') ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'}`}>
                    {change.startsWith('+') ? <ArrowUpRight className="w-3 h-3 mr-1" /> : <ArrowDownRight className="w-3 h-3 mr-1" />}
                    {change}
                </span>
            )}
        </div>
        <div className="space-y-1">
            <h3 className="text-gray-500 text-sm font-medium uppercase tracking-wide">{label}</h3>
            <div className="flex items-end justify-between">
                <p className="text-2xl font-bold text-gray-900 tracking-tight">{value}</p>
                {action && (
                    <button
                        onClick={(e) => { e.stopPropagation(); action(); }}
                        className="p-2 bg-gray-50 hover:bg-gray-100 text-gray-600 rounded-lg transition-colors"
                        title="Register New User"
                    >
                        <UserPlus className="w-4 h-4" />
                    </button>
                )}
            </div>
        </div>
    </div>
);

const CeoDashboard = () => {
    const [showUserReg, setShowUserReg] = useState(false);

    // Mock Data (will replace with API later)
    const stats = [
        { label: 'Total Revenue', value: 'KES 1,240,000', change: '+12%', color: 'blue', icon: DollarSign },
        { label: 'Total Orders', value: '1,342', change: '+5%', color: 'green', icon: ShoppingCart },
        { label: 'Pending Credits', value: 'KES 450,000', change: '-2%', color: 'orange', icon: Activity },
        {
            label: 'Active Users',
            value: '24',
            change: '+2',
            color: 'purple',
            icon: Users,
            action: () => setShowUserReg(true)
        },
    ];

    const recentActivities = [
        { id: 1, user: 'John Doe', action: 'Registered new customer', time: '10 min ago' },
        { id: 2, user: 'Sarah Smith', action: 'Voided transaction #4422', time: '25 min ago' },
        { id: 3, user: 'System', action: 'Daily backup completed', time: '1 hour ago' },
    ];

    return (
        <div className="space-y-8 animate-fade-in-up">
            {/* Stats Grid */}
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
                {stats.map((stat, idx) => (
                    <StatCard key={idx} {...stat} />
                ))}
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                {/* Revenue Chart Placeholder */}
                <div className="lg:col-span-2 bg-white p-6 rounded-2xl shadow-sm border border-gray-100">
                    <div className="flex justify-between items-center mb-6">
                        <h3 className="text-lg font-bold text-gray-900">Revenue Overview</h3>
                        <select className="bg-gray-50 border-none text-sm font-medium text-gray-500 rounded-lg hover:bg-gray-100 cursor-pointer outline-none">
                            <option>This Week</option>
                            <option>This Month</option>
                            <option>This Year</option>
                        </select>
                    </div>
                    <div className="h-64 flex items-center justify-center bg-gray-50 rounded-xl border border-dashed border-gray-200 text-gray-400">
                        Chart Component Placeholder
                    </div>
                </div>

                {/* Global Recent Activity */}
                <div className="bg-white p-6 rounded-2xl shadow-sm border border-gray-100">
                    <h3 className="text-lg font-bold text-gray-900 mb-6">Recent Activity</h3>
                    <div className="space-y-6">
                        {recentActivities.map((activity) => (
                            <div key={activity.id} className="flex gap-4">
                                <div className="w-2 h-2 mt-2 rounded-full bg-blue-500 ring-4 ring-blue-50"></div>
                                <div>
                                    <p className="text-sm font-medium text-gray-900">{activity.user}</p>
                                    <p className="text-xs text-gray-500">{activity.action}</p>
                                    <p className="text-[10px] text-gray-400 mt-1">{activity.time}</p>
                                </div>
                            </div>
                        ))}
                    </div>
                </div>
            </div>

            {/* User Registration Modal */}
            <UserRegistrationModal isOpen={showUserReg} onClose={() => setShowUserReg(false)} />
        </div>
    );
};


export default CeoDashboard;
