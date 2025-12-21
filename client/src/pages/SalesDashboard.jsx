import React, { useState, useEffect, useMemo, useCallback, memo } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import ProductCard from '../components/sales/ProductCard';
import ProductModal from '../components/sales/ProductModal';
import CartSidebar from '../components/sales/CartSidebar';
import { PRODUCTS, CATEGORIES } from '../data/mockProducts';
import { CUSTOMERS } from '../data/mockCustomers';
import logo from '../assets/logo.png';
import CustomerSelectionOverlay from '../components/sales/CustomerSelectionOverlay';

export default function SalesDashboard() {
    const location = useLocation();
    const navigate = useNavigate();

    // --- STATE ---
    const [activeCategory, setActiveCategory] = useState('ke-profile');
    const [activeSubCategory, setActiveSubCategory] = useState('window');
    const [searchQuery, setSearchQuery] = useState('');

    // Modal & Selection State
    const [selectedProduct, setSelectedProduct] = useState(null);
    const [modalOpen, setModalOpen] = useState(false);
    const [editingIndex, setEditingIndex] = useState(null);
    const [initialModalDetails, setInitialModalDetails] = useState(null);

    // Customer State
    const [selectedCustomer, setSelectedCustomer] = useState(location.state?.customer || null);

    // Cart State
    const [cart, setCart] = useState([]);

    // Profile Color State
    const [profileColor, setProfileColor] = useState('White');

    // --- CONSTANTS ---
    const PROFILE_COLORS = useMemo(() => [
        { name: 'White', hex: '#FFFFFF' },
        { name: 'Brown', hex: '#8B4513' },
        { name: 'Silver', hex: '#C0C0C0' },
        { name: 'Grey', hex: '#808080' }
    ], []);

    const PROFILE_SUB_CATEGORIES = useMemo(() => [
        { id: 'window', label: 'Window Profile' },
        { id: 'door', label: 'Door Profile' },
        { id: 'general', label: 'General Purpose' },
    ], []);

    const GLASS_SUB_CATEGORIES = useMemo(() => [
        { id: 'clear', label: 'Clear' },
        { id: 'oneway', label: 'One/Way' },
        { id: 'mirror', label: 'Mirror' },
        { id: 'tint', label: 'Tint' },
        { id: 'obscure', label: 'Obscure' },
        { id: 'alucoboard', label: 'Alucoboard' },
        { id: 'frost', label: 'Frost' },
    ], []);

    // --- INITIALIZATION EFFECT ---
    useEffect(() => {
        if (location.state?.mode === 'edit' && location.state?.orderData) {
            setCart(location.state.orderData.items);
            setSelectedCustomer(location.state.orderData.customer);
        } else if (location.state?.mode === 'link' && location.state?.customer) {
            setSelectedCustomer(location.state.customer);
            setCart([]);
        } else if (location.state?.cartItems) {
            setCart(location.state.cartItems);
        }
    }, [location.state]);

    // --- MEMOIZED HELPERS ---
    const isProfileCategory = useMemo(() =>
        activeCategory === 'ke-profile' || activeCategory === 'tz-profile',
        [activeCategory]);

    const isGlassCategory = useMemo(() =>
        activeCategory === 'glass',
        [activeCategory]);

    const currentSubCategories = useMemo(() =>
        isProfileCategory ? PROFILE_SUB_CATEGORIES : (isGlassCategory ? GLASS_SUB_CATEGORIES : []),
        [isProfileCategory, isGlassCategory, PROFILE_SUB_CATEGORIES, GLASS_SUB_CATEGORIES]);

    // --- SIDE EFFECTS ---
    useEffect(() => {
        if (isProfileCategory) {
            setActiveSubCategory('window');
        } else if (isGlassCategory) {
            setActiveSubCategory('clear');
        } else {
            setActiveSubCategory('all');
        }
    }, [activeCategory, isProfileCategory, isGlassCategory]);

    // --- OPTIMIZED HANDLERS (useCallback) ---
    const handleProductClick = useCallback((product) => {
        setSelectedProduct(product);
        setEditingIndex(null);
        setInitialModalDetails(null);
        setModalOpen(true);
    }, []);

    const handleEditCartItem = useCallback((index) => {
        setCart((currentCart) => {
            const item = currentCart[index];
            const originalProduct = PRODUCTS.find(p => p.id === item.id);
            if (originalProduct) {
                // We need to defer state updates to avoid conflicts during render
                // But in event handlers, it's fine.
                setSelectedProduct(originalProduct);
                setEditingIndex(index);
                setInitialModalDetails(item.details);
                setModalOpen(true);
            }
            return currentCart;
        });
    }, []);

    const handleAddToOrder = useCallback((orderItem) => {
        setCart(prevCart => {
            if (editingIndex !== null) {
                const newCart = [...prevCart];
                newCart[editingIndex] = orderItem;
                setEditingIndex(null); // Reset after update
                return newCart;
            } else {
                return [...prevCart, orderItem];
            }
        });
    }, [editingIndex]);

    const handleRemoveItem = useCallback((index) => {
        setCart(prev => prev.filter((_, i) => i !== index));
    }, []);

    const handleModalClose = useCallback(() => {
        setModalOpen(false);
        setEditingIndex(null);
        setInitialModalDetails(null);
    }, []);

    const handleCustomerSelect = useCallback((customer) => {
        setSelectedCustomer(customer);
    }, []);

    // --- PERFORMANCE: MEMOIZED FILTERING ---
    const filteredProducts = useMemo(() => {
        const lowerQuery = searchQuery.toLowerCase();

        return PRODUCTS.filter(p => {
            // 1. Category Check
            const matchesCategory = activeCategory === 'all' || p.category === activeCategory;
            if (!matchesCategory) return false;

            // 2. Sub-Category Check
            const matchesSubCategory = activeSubCategory === 'all' || p.usage === activeSubCategory;

            // 3. Search Check (Most expensive, do last)
            const matchesSearch = !lowerQuery || p.name.toLowerCase().includes(lowerQuery);

            if (isProfileCategory || isGlassCategory) {
                return matchesSubCategory && matchesSearch;
            }
            return matchesSearch;
        });
    }, [activeCategory, activeSubCategory, searchQuery, isProfileCategory, isGlassCategory]);

    return (
        <div className="flex h-full w-full overflow-hidden text-gray-800 font-sans relative">

            {/* --- Main Content area --- */}
            <div className="flex-1 flex flex-col relative bg-slate-50 min-w-0">

                {/* Top Header */}
                <div className="h-20 flex items-center justify-between px-8 border-b border-gray-200 bg-white/50 backdrop-blur-sm sticky top-0 z-10 transition-colors shrink-0">
                    <div>
                        <h1 className="text-2xl font-bold text-gray-800 tracking-tight">Sales Terminal</h1>
                        <div className="flex items-center gap-2">
                            <p className="text-xs text-gray-500 font-medium">Welcome back, Agent</p>
                            {location.state?.mode === 'edit' && (
                                <span className="bg-amber-100 text-amber-700 text-xs px-2 py-0.5 rounded font-bold border border-amber-200">
                                    Editing Order: {location.state.orderData.id}
                                </span>
                            )}
                            {location.state?.mode === 'link' && (
                                <span className="bg-blue-100 text-blue-700 text-xs px-2 py-0.5 rounded font-bold border border-blue-200">
                                    Adding to Order: {location.state.parentOrderId}
                                </span>
                            )}
                        </div>
                    </div>

                    {/* Product Search Bar */}
                    <div className="relative w-96">
                        <span className="absolute left-4 top-3 text-gray-400">🔍</span>
                        <input
                            type="text"
                            className="w-full bg-white border border-gray-200 rounded-2xl py-3 pl-10 pr-4 text-gray-800 shadow-sm focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 transition-all placeholder-gray-400"
                            placeholder="Search products..."
                            value={searchQuery}
                            onChange={(e) => setSearchQuery(e.target.value)}
                        />
                    </div>
                </div>

                {/* Categories Tab Bar */}
                <div className="px-8 py-6 shrink-0">
                    <div className="flex items-center justify-between mb-2">
                        <div className="flex gap-4 overflow-x-auto pb-2 scrollbar-hide">
                            {CATEGORIES.map(cat => (
                                <button
                                    key={cat.id}
                                    onClick={() => setActiveCategory(cat.id)}
                                    className={`flex items-center gap-2 px-6 py-4 rounded-2xl border transition-all whitespace-nowrap shadow-sm
                                    ${activeCategory === cat.id
                                            ? 'bg-blue-600 text-white border-blue-600 shadow-blue-500/25 scale-[1.02]'
                                            : 'bg-white text-gray-600 border-gray-200 hover:border-blue-300 hover:bg-blue-50/50'
                                        }`}
                                >
                                    <span className="text-xl filter drop-shadow-sm">{cat.icon}</span>
                                    <span className="font-medium">{cat.label}</span>
                                </button>
                            ))}
                        </div>
                    </div>

                    <div className="flex flex-col gap-3">
                        {/* GLOBAL COLOR SELECTOR */}
                        {isProfileCategory && (
                            <div className="flex items-center gap-2 bg-white p-1 rounded-xl border border-gray-200 shadow-sm animate-fade-in w-fit">
                                <span className="text-xs font-bold text-gray-500 px-2">Profile Color:</span>
                                <div className="flex gap-1">
                                    {PROFILE_COLORS.map(color => (
                                        <button
                                            key={color.name}
                                            onClick={() => setProfileColor(color.name)}
                                            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg border transition-all ${profileColor === color.name
                                                ? 'bg-gray-100 border-blue-400 ring-1 ring-blue-500/20 shadow-sm'
                                                : 'bg-white border-transparent hover:bg-gray-50'
                                                }`}
                                        >
                                            <div
                                                className="w-3 h-3 rounded-full border border-gray-300 shadow-sm"
                                                style={{ backgroundColor: color.hex }}
                                            />
                                            <span className={`text-xs font-semibold ${profileColor === color.name ? 'text-gray-900' : 'text-gray-500'}`}>
                                                {color.name}
                                            </span>
                                        </button>
                                    ))}
                                </div>
                            </div>
                        )}

                        {/* SUB CATEGORY FILTERS */}
                        {currentSubCategories.length > 0 && (
                            <div className="flex gap-2 flex-wrap">
                                {currentSubCategories.map(sub => (
                                    <button
                                        key={sub.id}
                                        onClick={() => setActiveSubCategory(sub.id)}
                                        className={`px-3 py-1 rounded-md text-xs font-medium transition-all ${activeSubCategory === sub.id
                                            ? 'bg-gray-800 text-white shadow-md'
                                            : 'bg-white text-gray-400 border border-gray-200 hover:border-gray-300 hover:bg-gray-50'
                                            }`}
                                    >
                                        {sub.label}
                                    </button>
                                ))}
                            </div>
                        )}
                    </div>
                </div>

                {/* Products Grid */}
                <div className="flex-1 overflow-y-auto px-8 pb-8 custom-scrollbar">
                    <div className="grid grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6">
                        {filteredProducts.map(product => (
                            <ProductCard
                                key={product.id}
                                product={product}
                                onClick={handleProductClick}
                            />
                        ))}
                    </div>
                </div>
            </div>

            {/* --- Right Cart Panel --- */}
            <CartSidebar
                cartItems={cart}
                onRemoveItem={handleRemoveItem}
                onEditItem={handleEditCartItem}
                customer={selectedCustomer}
                mode={location.state?.mode}
                originalTotal={location.state?.mode === 'edit' ? location.state.orderData.totalAmount : 0}
                actionLabel={location.state?.mode === 'edit' ? 'Update Order' : 'Checkout'}
                onAction={location.state?.mode === 'edit' ? () => {
                    alert("Order Updated Successfully!");
                    navigate('/orders');
                } : undefined}
            />

            {/* --- Product Modal --- */}
            <ProductModal
                product={selectedProduct}
                isOpen={modalOpen}
                onClose={handleModalClose}
                onAddToOrder={handleAddToOrder}
                color={initialModalDetails?.color || profileColor}
                initialDetails={initialModalDetails}
            />

            {/* --- OPTIMIZED CUSTOMER SELECTION OVERLAY --- */}
            {!selectedCustomer && (
                <CustomerSelectionOverlay
                    customers={CUSTOMERS}
                    onSelectCustomer={handleCustomerSelect}
                />
            )}
        </div>
    );
}


