import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import CeoDashboard from '../components/dashboards/CeoDashboard';
import CashierDashboard from '../components/dashboards/CashierDashboard';
import StockManagerDashboard from '../components/dashboards/StockManagerDashboard';


export default function DashboardPage() {
    const { user, logout } = useAuth();
    const navigate = useNavigate();
    const [isMenuOpen, setIsMenuOpen] = useState(false);

    // Determine which dashboard to show
    const renderDashboard = () => {
        const role = user?.role?.toLowerCase();

        // Normalize role or handle specific strings
        if (role === 'ceo' || role === 'admin') return <CeoDashboard />;
        if (role === 'storemanager' || role === 'stockmanager') return <StockManagerDashboard />;
        // Default for cashiers or undefined
        return <CashierDashboard />;
    };

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
                            <p className="text-[10px] sm:text-xs text-gray-500 font-bold tracking-widest uppercase">
                                {user?.role === 'ceo' || user?.role === 'admin' ? 'Executive Dashboard' : user?.role === 'storeManager' ? 'Inventory Dashboard' : 'Sales Dashboard'}
                            </p>
                        </div>
                    </div>

                    {/* Desktop Actions & Profile */}
                    <div className="hidden md:flex items-center gap-6">
                        <div className="text-right">
                            <div className="text-sm font-bold text-gray-900">{user?.name || 'User'}</div>
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
                                <div className="font-bold text-gray-900">{user?.name || 'User'}</div>
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
                        <h2 className="text-2xl md:text-3xl font-bold text-gray-900">Good Afternoon, {user?.firstName || user?.name?.split(' ')[0] || 'User'}! 👋</h2>
                        <p className="text-gray-500 mt-2 text-base md:text-lg">
                            {user?.role === 'ceo' || user?.role === 'admin' ? 'Here is the high-level overview of the business.' :
                                user?.role === 'storeManager' ? 'Check inventory levels and alerts.' :
                                    'Ready to process some new orders?'}
                        </p>
                    </div>
                    <div className="flex items-center gap-3">
                        <span className="text-sm font-medium text-gray-500">System Status:</span>
                        <span className="flex items-center gap-2 px-3 py-1 bg-green-100 text-green-700 rounded-full text-xs font-bold animate-pulse">
                            <span className="w-2 h-2 rounded-full bg-green-500"></span>
                            Online
                        </span>
                    </div>
                </div>

                {/* Dashboard Content Based on Role */}
                {renderDashboard()}

            </main>
        </div>
    );
}
