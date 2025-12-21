import React, { useState, useEffect, useMemo, useCallback, useDeferredValue, memo } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import ProductCard from '../components/sales/ProductCard';
import ProductModal from '../components/sales/ProductModal';
import CartSidebar from '../components/sales/CartSidebar';
import { PRODUCTS, CATEGORIES } from '../data/mockProducts';
import { CUSTOMERS } from '../data/mockCustomers';

// --- PERFORMANCE: Local Memoization Wrapper ---
const MemoizedProductCard = memo(ProductCard);

export default function InvoiceGenPage() {
    const location = useLocation();
    const navigate = useNavigate();

    // --- STATE ---
    const [activeCategory, setActiveCategory] = useState('ke-profile');
    const [activeSubCategory, setActiveSubCategory] = useState('window');
    const [searchQuery, setSearchQuery] = useState('');

    // Performance: Defer the search query for filtering
    const deferredQuery = useDeferredValue(searchQuery);

    const [selectedProduct, setSelectedProduct] = useState(null);
    const [modalOpen, setModalOpen] = useState(false);
    const [editingIndex, setEditingIndex] = useState(null);
    const [initialModalDetails, setInitialModalDetails] = useState(null);

    const [selectedCustomer, setSelectedCustomer] = useState(location.state?.customer || null);

    const [cart, setCart] = useState(location.state?.cartItems || []);
    const [profileColor, setProfileColor] = useState('White');

    // --- CONSTANTS (Memoized) ---
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

    // --- EFFECT: Sub-category Reset ---
    useEffect(() => {
        if (isProfileCategory) {
            setActiveSubCategory('window');
        } else if (isGlassCategory) {
            setActiveSubCategory('clear');
        } else {
            setActiveSubCategory('all');
        }
    }, [activeCategory, isProfileCategory, isGlassCategory]);

    // --- STABLE HANDLERS ---
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
                // Defer UI updates slightly to avoid conflicts
                setTimeout(() => {
                    setSelectedProduct(originalProduct);
                    setEditingIndex(index);
                    setInitialModalDetails(item.details);
                    setModalOpen(true);
                }, 0);
            }
            return currentCart;
        });
    }, []);

    const handleAddToOrder = useCallback((orderItem) => {
        setCart(prevCart => {
            if (editingIndex !== null) {
                const newCart = [...prevCart];
                newCart[editingIndex] = orderItem;
                setEditingIndex(null);
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

    const handleReviewInvoice = useCallback(() => {
        navigate('/invoice/review', { state: { cartItems: cart, customer: selectedCustomer } });
    }, [cart, selectedCustomer, navigate]);

    const handleCustomerSelect = useCallback((customer) => {
        setSelectedCustomer(customer);
    }, []);

    // --- MEMOIZED FILTERING ---
    const filteredProducts = useMemo(() => {
        const lowerQuery = deferredQuery.toLowerCase();

        return PRODUCTS.filter(p => {
            const matchesCategory = activeCategory === 'all' || p.category === activeCategory;
            if (!matchesCategory) return false;

            const matchesSubCategory = activeSubCategory === 'all' || p.usage === activeSubCategory;
            const matchesSearch = !lowerQuery || p.name.toLowerCase().includes(lowerQuery);

            if (isProfileCategory || isGlassCategory) {
                return matchesSubCategory && matchesSearch;
            }
            return matchesSearch;
        });
    }, [activeCategory, activeSubCategory, deferredQuery, isProfileCategory, isGlassCategory]);

    return (
        <div className="flex h-full w-full overflow-hidden text-gray-800 font-sans bg-slate-100 relative">

            {/* --- Main Content area --- */}
            <div className="flex-1 flex flex-col relative min-w-0">

                {/* Top Header - Inverted Gold/Slate Theme */}
                <div className="h-20 flex items-center justify-between px-8 bg-slate-900 text-white shadow-md z-10 shrink-0">
                    <div>
                        <h1 className="text-2xl font-bold tracking-tight text-amber-500">Invoice Generator</h1>
                        <p className="text-xs text-slate-400 font-medium">Create Quotations & Estimates</p>
                    </div>

                    {/* Search Bar */}
                    <div className="relative w-96">
                        <span className="absolute left-4 top-3 text-slate-500">🔍</span>
                        <input
                            type="text"
                            className="w-full bg-slate-800 border border-slate-700 rounded-xl py-3 pl-10 pr-4 text-white shadow-inner focus:ring-1 focus:ring-amber-500 focus:border-amber-500 transition-all placeholder-slate-500"
                            placeholder="Search products..."
                            value={searchQuery}
                            onChange={(e) => setSearchQuery(e.target.value)}
                        />
                    </div>
                </div>

                {/* Categories Tab Bar */}
                <div className="px-8 py-6 shrink-0 bg-white border-b border-gray-200">
                    <div className="flex items-center justify-between mb-2">
                        <div className="flex gap-4 overflow-x-auto pb-2 scrollbar-hide">
                            {CATEGORIES.map(cat => (
                                <button
                                    key={cat.id}
                                    onClick={() => setActiveCategory(cat.id)}
                                    className={`flex items-center gap-2 px-6 py-4 rounded-xl border transition-all whitespace-nowrap shadow-sm
                                    ${activeCategory === cat.id
                                            ? 'bg-slate-900 text-amber-500 border-slate-900 ring-2 ring-amber-500/50'
                                            : 'bg-white text-gray-600 border-gray-200 hover:border-slate-300 hover:bg-slate-50'
                                        }`}
                                >
                                    <span className="text-xl filter drop-shadow-sm">{cat.icon}</span>
                                    <span className="font-medium">{cat.label}</span>
                                </button>
                            ))}
                        </div>
                    </div>

                    <div className="flex flex-col gap-3">
                        {isProfileCategory && (
                            <div className="flex items-center gap-2 bg-slate-50 p-1 rounded-lg border border-gray-200 w-fit">
                                <span className="text-xs font-bold text-gray-500 px-2">Profile Color:</span>
                                <div className="flex gap-1">
                                    {PROFILE_COLORS.map(color => (
                                        <button
                                            key={color.name}
                                            onClick={() => setProfileColor(color.name)}
                                            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md border transition-all ${profileColor === color.name
                                                ? 'bg-white border-amber-500 shadow-sm text-slate-900'
                                                : 'bg-transparent border-transparent hover:bg-gray-100'
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

                        {currentSubCategories.length > 0 && (
                            <div className="flex gap-2 flex-wrap">
                                {currentSubCategories.map(sub => (
                                    <button
                                        key={sub.id}
                                        onClick={() => setActiveSubCategory(sub.id)}
                                        className={`px-3 py-1 rounded-md text-xs font-medium transition-all ${activeSubCategory === sub.id
                                            ? 'bg-amber-500 text-white shadow-md'
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
                <div className="flex-1 overflow-y-auto px-8 py-8 custom-scrollbar bg-slate-50">
                    <div className="grid grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6">
                        {filteredProducts.map(product => (
                            <MemoizedProductCard
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
                actionLabel="Review Invoice"
                onAction={handleReviewInvoice}
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

            {/* --- OPTIMIZED CUSTOMER OVERLAY --- */}
            {!selectedCustomer && (
                <CustomerSelectionOverlay
                    customers={CUSTOMERS}
                    onSelectCustomer={handleCustomerSelect}
                />
            )}

        </div>
    );
}

// --- EXTRACTED OVERLAY COMPONENT ---
// Keeps input state isolated from the main grid to prevent render thrashing
const CustomerSelectionOverlay = memo(({ customers, onSelectCustomer }) => {
    const [customerSearch, setCustomerSearch] = useState('');
    const [newCustomerName, setNewCustomerName] = useState('');
    const [newCustomerPhone, setNewCustomerPhone] = useState('');

    const filteredCustomers = useMemo(() => {
        if (!customerSearch) return [];
        const lower = customerSearch.toLowerCase();
        return customers.filter(c => c.name.toLowerCase().includes(lower) || c.phone.includes(lower));
    }, [customers, customerSearch]);

    return (
        <div className="absolute inset-0 z-[60] bg-slate-900/80 backdrop-blur-md flex items-center justify-center p-4">
            <div className="bg-white rounded-2xl shadow-2xl max-w-2xl w-full overflow-hidden animate-pop-in border border-amber-500/20">
                <div className="p-8 bg-gradient-to-br from-slate-50 to-white">
                    <h2 className="text-3xl font-bold text-slate-800 mb-2">Invoice Details</h2>
                    <p className="text-slate-500 mb-8">Who is this quotation for?</p>

                    <div className="mb-8">
                        <label className="text-xs font-bold text-slate-400 uppercase tracking-wide mb-2 block">Search Client</label>
                        <div className="relative group">
                            <span className="absolute left-4 top-3.5 text-slate-400">🔍</span>
                            <input
                                type="text"
                                placeholder="Search by name or phone..."
                                className="w-full bg-white border border-slate-200 rounded-xl py-3 pl-10 pr-4 text-lg focus:ring-2 focus:ring-amber-500/20 focus:border-amber-500 outline-none transition-all"
                                value={customerSearch}
                                onChange={(e) => setCustomerSearch(e.target.value)}
                            />
                        </div>
                        {customerSearch && (
                            <div className="mt-2 space-y-2 max-h-48 overflow-y-auto custom-scrollbar">
                                {filteredCustomers.map(c => (
                                    <button
                                        key={c.id}
                                        onClick={() => onSelectCustomer(c)}
                                        className="w-full flex items-center justify-between p-3 rounded-xl hover:bg-amber-50 border border-transparent hover:border-amber-200 transition-all text-left group"
                                    >
                                        <div>
                                            <div className="font-bold text-slate-800">{c.name}</div>
                                            <div className="text-xs text-slate-500 font-mono">{c.phone}</div>
                                        </div>
                                        <span className="text-amber-500 opacity-0 group-hover:opacity-100 font-medium text-sm">Select</span>
                                    </button>
                                ))}
                                {filteredCustomers.length === 0 && (
                                    <p className="text-sm text-gray-400 p-2 italic">No clients found.</p>
                                )}
                            </div>
                        )}
                    </div>

                    <div className="flex items-center gap-4 py-4">
                        <span className="h-px bg-slate-200 flex-1"></span>
                        <span className="text-xs text-slate-400 font-bold uppercase">OR</span>
                        <span className="h-px bg-slate-200 flex-1"></span>
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mt-4">
                        <div>
                            <label className="text-xs font-bold text-slate-400 uppercase tracking-wide mb-2 block">New Client</label>
                            <div className="space-y-3">
                                <input
                                    type="text"
                                    placeholder="Client Name"
                                    className="w-full bg-white border border-slate-200 rounded-xl px-4 py-3 text-slate-800 outline-none focus:border-amber-500 transition-all font-medium"
                                    value={newCustomerName}
                                    onChange={(e) => setNewCustomerName(e.target.value)}
                                />
                                <input
                                    type="tel"
                                    placeholder="Phone Number"
                                    className="w-full bg-white border border-slate-200 rounded-xl px-4 py-3 text-slate-800 outline-none focus:border-amber-500 transition-all font-medium"
                                    value={newCustomerPhone}
                                    onChange={(e) => setNewCustomerPhone(e.target.value)}
                                    onKeyDown={(e) => {
                                        if (e.key === 'Enter' && newCustomerName.trim()) {
                                            onSelectCustomer({ id: 'new-' + Date.now(), name: newCustomerName, phone: newCustomerPhone, type: 'new' });
                                        }
                                    }}
                                />
                                <button
                                    onClick={() => {
                                        if (newCustomerName.trim()) {
                                            onSelectCustomer({ id: 'new-' + Date.now(), name: newCustomerName, phone: newCustomerPhone, type: 'new' });
                                        }
                                    }}
                                    disabled={!newCustomerName.trim()}
                                    className="w-full bg-slate-900 text-amber-500 py-3 rounded-xl font-bold disabled:opacity-50 hover:bg-black transition-colors shadow-lg flex items-center justify-center gap-2"
                                >
                                    <span>Create Profile</span>
                                    <span>→</span>
                                </button>
                            </div>
                        </div>
                        <div className="flex flex-col justify-end">
                            <button
                                onClick={() => onSelectCustomer({ id: 'guest', name: 'Guest Client', type: 'walk-in' })}
                                className="w-full bg-slate-100 text-slate-600 hover:bg-slate-200 font-bold py-3 rounded-xl border border-slate-300 transition-colors"
                            >
                                Guest Client
                            </button>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
});