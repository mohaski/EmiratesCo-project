import React from 'react';
import { Package, AlertTriangle, TrendingDown, Box, PlusCircle } from 'lucide-react';
import { useNavigate } from 'react-router-dom';

const StockManagerDashboard = () => {
    const navigate = useNavigate();

    return (
        <div className="space-y-8 animate-fade-in-up">
            {/* Top Stats */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                <div className="bg-white p-6 rounded-2xl shadow-sm border border-gray-100 flex items-center gap-4">
                    <div className="p-4 bg-blue-50 text-blue-600 rounded-xl">
                        <Package className="w-8 h-8" />
                    </div>
                    <div>
                        <p className="text-gray-500 font-medium">Total Products</p>
                        <h3 className="text-3xl font-bold text-gray-900">4,230</h3>
                    </div>
                </div>
                <div className="bg-white p-6 rounded-2xl shadow-sm border border-gray-100 flex items-center gap-4">
                    <div className="p-4 bg-orange-50 text-orange-600 rounded-xl">
                        <AlertTriangle className="w-8 h-8" />
                    </div>
                    <div>
                        <p className="text-gray-500 font-medium">Low Stock Items</p>
                        <h3 className="text-3xl font-bold text-gray-900">12</h3>
                    </div>
                </div>
                <div className="bg-white p-6 rounded-2xl shadow-sm border border-gray-100 flex items-center gap-4">
                    <div className="p-4 bg-purple-50 text-purple-600 rounded-xl">
                        <Box className="w-8 h-8" />
                    </div>
                    <div>
                        <p className="text-gray-500 font-medium">Total Value</p>
                        <h3 className="text-3xl font-bold text-gray-900 text-sm">KES 12.4M</h3>
                    </div>
                </div>
            </div>

            {/* Main Content */}
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                {/* Low Stock Alerts */}
                <div className="lg:col-span-2 bg-white rounded-2xl shadow-sm border border-gray-100 overflow-hidden">
                    <div className="p-6 border-b border-gray-100 flex justify-between items-center">
                        <h3 className="text-lg font-bold text-gray-900 flex items-center gap-2">
                            <div className="w-2 h-2 rounded-full bg-red-500 animate-pulse"></div>
                            Low Stock Alerts
                        </h3>
                        <button className="text-sm font-bold text-blue-600 hover:text-blue-700">View All</button>
                    </div>
                    <div className="divide-y divide-gray-50">
                        {[1, 2, 3, 4].map((i) => (
                            <div key={i} className="p-4 flex items-center justify-between hover:bg-gray-50/50 transition-colors">
                                <div className="flex items-center gap-4">
                                    <div className="w-12 h-12 bg-gray-100 rounded-lg flex items-center justify-center">
                                        <Package className="w-6 h-6 text-gray-400" />
                                    </div>
                                    <div>
                                        <h4 className="font-bold text-gray-900">Clear Glass 6mm</h4>
                                        <p className="text-xs text-gray-500">Inventory ID: #GLS-00{i}</p>
                                    </div>
                                </div>
                                <div className="text-right">
                                    <div className="text-red-600 font-bold bg-red-50 px-3 py-1 rounded-full text-xs">Only 4 left</div>
                                    <p className="text-xs text-gray-400 mt-1">Reorder Level: 10</p>
                                </div>
                            </div>
                        ))}
                    </div>
                </div>

                {/* Quick Actions */}
                <div className="space-y-6">
                    <div className="bg-gradient-to-br from-gray-900 to-gray-800 rounded-2xl p-6 text-white shadow-xl shadow-gray-500/20">
                        <h3 className="text-lg font-bold mb-2">Actions</h3>
                        <p className="text-gray-400 text-sm mb-6">Manage your inventory efficiently.</p>

                        <button onClick={() => navigate('/add-product')} className="w-full flex items-center gap-3 p-3 bg-white/10 hover:bg-white/20 rounded-xl backdrop-blur-sm transition-all mb-3 text-left">
                            <PlusCircle className="w-5 h-5 text-green-400" />
                            <span className="font-medium">Add New Product</span>
                        </button>
                        <button onClick={() => navigate('/inventory')} className="w-full flex items-center gap-3 p-3 bg-white/10 hover:bg-white/20 rounded-xl backdrop-blur-sm transition-all text-left">
                            <Box className="w-5 h-5 text-blue-400" />
                            <span className="font-medium">View Full Inventory</span>
                        </button>
                    </div>
                </div>
            </div>
        </div>
    );
};

export default StockManagerDashboard;
