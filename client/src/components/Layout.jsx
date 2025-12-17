import { useState } from 'react';
import { useNavigate, useLocation, Outlet } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import logo from '../assets/logo.png';

export default function Layout() {
    const navigate = useNavigate();
    const location = useLocation();
    const { logout, user } = useAuth();
    const [isSidebarOpen, setSidebarOpen] = useState(false);

    const menuItems = [
        { path: '/', label: 'Overview', icon: <svg className="w-6 h-6 flex-shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="3" width="7" height="9"></rect><rect x="14" y="3" width="7" height="5"></rect><rect x="14" y="12" width="7" height="9"></rect><rect x="3" y="16" width="7" height="5"></rect></svg>, roles: ['admin', 'senior', 'junior'] },
        { path: '/sales', label: 'Sales POS', icon: <svg className="w-6 h-6 flex-shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="3" width="7" height="7"></rect><rect x="14" y="3" width="7" height="7"></rect><rect x="14" y="14" width="7" height="7"></rect><rect x="3" y="14" width="7" height="7"></rect></svg>, roles: ['senior', 'junior'] },
        { path: '/invoice', label: 'Invoices', icon: <svg className="w-6 h-6 flex-shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path><polyline points="14 2 14 8 20 8"></polyline><line x1="16" y1="13" x2="8" y2="13"></line><line x1="16" y1="17" x2="8" y2="17"></line><polyline points="10 9 9 9 8 9"></polyline></svg>, roles: ['senior', 'junior'] },
        { path: '/orders', label: 'Orders History', icon: <svg className="w-6 h-6 flex-shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M9 5H7a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V7a2 2 0 0 0-2-2h-2"></path><rect x="9" y="3" width="6" height="4" rx="2"></rect><path d="M9 14h6"></path><path d="M9 18h6"></path><path d="M9 10h6"></path></svg>, roles: ['senior'] },
        { path: '/inventory', label: 'Stock Control', icon: <svg className="w-6 h-6 flex-shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"></path><polyline points="3.27 6.96 12 12.01 20.73 6.96"></polyline><line x1="12" y1="22.08" x2="12" y2="12"></line></svg>, roles: ['senior'] },
        { path: '/add-product', label: 'Add Product', icon: <svg className="w-6 h-6 flex-shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"></circle><line x1="12" y1="8" x2="12" y2="16"></line><line x1="8" y1="12" x2="16" y2="12"></line></svg>, roles: ['admin'] },
    ];

    const filteredItems = menuItems.filter(item => item.roles.includes(user?.role));

    return (
        <div className="flex h-screen bg-slate-50 overflow-hidden text-gray-800 font-sans">
            {/* Sidebar */}
            <aside
                className={`${isSidebarOpen ? 'w-64' : 'w-20'} flex-shrink-0 bg-white/70 backdrop-blur-md border-r border-gray-200 flex flex-col transition-all duration-300 ease-in-out relative shadow-sm z-50`}
            >
                {/* Toggle Button */}
                <button
                    onClick={() => setSidebarOpen(!isSidebarOpen)}
                    className="absolute -right-3 top-8 w-6 h-6 rounded-full bg-white border border-gray-200 text-gray-500 shadow-sm flex items-center justify-center hover:text-blue-600 hover:border-blue-200 z-10"
                >
                    {isSidebarOpen ? (
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="15 18 9 12 15 6"></polyline></svg>
                    ) : (
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="9 18 15 12 9 6"></polyline></svg>
                    )}
                </button>

                {/* Logo Section */}
                <div className={`h-24 flex items-center ${isSidebarOpen ? 'px-6' : 'justify-center'} border-b border-gray-200/50`}>
                    <img src={logo} className="w-10 h-10 object-contain drop-shadow-sm" alt="Logo" />
                    {isSidebarOpen && (
                        <div className="ml-3 overflow-hidden whitespace-nowrap animate-fade-in">
                            <h2 className="font-bold text-gray-800 tracking-wide">EmiratesCo</h2>
                            <p className="text-xs text-blue-500 font-medium">Management</p>
                        </div>
                    )}
                </div>

                {/* Navigation */}
                <nav className="flex-1 py-6 space-y-2 px-3">
                    {filteredItems.map((item) => {
                        const isActive = location.pathname === item.path;
                        return (
                            <button
                                key={item.path}
                                onClick={() => navigate(item.path)}
                                className={`w-full flex items-center ${isSidebarOpen ? 'px-4' : 'justify-center'} py-3 rounded-xl transition-all group
                                    ${isActive
                                        ? 'bg-blue-50 text-blue-600 ring-1 ring-blue-200 shadow-sm'
                                        : 'text-gray-500 hover:bg-gray-100/50 hover:text-gray-900'
                                    }`}
                                title={!isSidebarOpen ? item.label : ''}
                            >
                                {item.icon}
                                {isSidebarOpen && <span className="ml-3 font-medium">{item.label}</span>}
                            </button>
                        );
                    })}
                </nav>

                {/* Footer: Account & Logout */}
                <div className={`p-4 border-t border-gray-200/50 bg-gray-50/50`}>
                    <div className={`flex flex-col gap-2`}>
                        {/* Settings */}
                        <div className={`px-4 py-2 mb-2 text-xs text-center text-gray-400 font-mono border-b border-gray-100 ${!isSidebarOpen && 'hidden'}`}>
                            {user?.name} | <span className="text-blue-500 font-bold uppercase">{user?.role}</span>
                        </div>
                        <button className={`w-full flex items-center ${isSidebarOpen ? 'px-4' : 'justify-center'} py-2 rounded-lg text-gray-500 hover:text-gray-900 hover:bg-gray-200/50 transition-all`}>
                            <svg className="w-5 h-5 flex-shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="3"></circle><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"></path></svg>
                            {isSidebarOpen && <span className="ml-3 font-medium text-sm">Settings</span>}
                        </button>

                        {/* Logout */}
                        <button
                            onClick={logout}
                            className={`w-full flex items-center ${isSidebarOpen ? 'px-4' : 'justify-center'} py-2 rounded-lg text-red-500 hover:text-red-600 hover:bg-red-50 transition-all`}
                        >
                            <svg className="w-5 h-5 flex-shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"></path><polyline points="16 17 21 12 16 7"></polyline><line x1="21" y1="12" x2="9" y2="12"></line></svg>
                            {isSidebarOpen && <span className="ml-3 font-medium text-sm">Logout</span>}
                        </button>
                    </div>
                </div>
            </aside>

            {/* Main Content Area */}
            <main className="flex-1 overflow-y-auto overflow-x-hidden relative flex flex-col">
                <Outlet />
            </main>
        </div>
    );
}
