import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import ProductCard from '../components/sales/ProductCard';
import ProductModal from '../components/sales/ProductModal';
import CartSidebar from '../components/sales/CartSidebar';
import { useProducts } from '../context/ProductContext';
import { useCart } from '../context/CartContext'; // Import Context
import { CUSTOMERS } from '../data/mockCustomers';
import { useProductFiltering, PROFILE_COLORS } from '../hooks/useProductFiltering';

import CustomerSelectionOverlay from '../components/invoices/CustomerSelectionOverlay';

export default function InvoiceGenPage() {
    const { products: PRODUCTS } = useProducts(); // Keep for specific helpers if needed, but hook handles filtering
    const location = useLocation();
    const navigate = useNavigate();

    // --- HOOKS ---
    const {
        activeCategory, setActiveCategory,
        activeSubCategory, setActiveSubCategory,
        searchQuery, setSearchQuery,
        profileColor, setProfileColor,
        filteredProducts,
        currentSubCategories,
        CATEGORIES,
        isProfileCategory
    } = useProductFiltering();

    // --- LOCAL STATE (UI Only) ---
    const [selectedProduct, setSelectedProduct] = useState(null);
    const [modalOpen, setModalOpen] = useState(false);
    const [editingIndex, setEditingIndex] = useState(null);
    const [initialModalDetails, setInitialModalDetails] = useState(null);

    // --- GLOBAL CART STATE (Context) ---
    const {
        cartItems: cart,
        customer: selectedCustomer,
        setCustomer: setSelectedCustomer,
        taxEnabled: enableTax,
        setTaxEnabled: setEnableTax,
        addToCart,
        updateCartItem,
        removeFromCart
    } = useCart();

    // Mobile Cart Drawer State
    const [isCartOpen, setIsCartOpen] = useState(false);

    // --- STABLE HANDLERS ---
    const handleProductClick = useCallback((product) => {
        setSelectedProduct(product);
        setEditingIndex(null);
        setInitialModalDetails(null);
        setModalOpen(true);
    }, []);

    const handleEditCartItem = useCallback((index) => {
        const item = cart[index];
        if (!item) return;

        const originalProduct = PRODUCTS.find(p => p.id === item.id);
        if (originalProduct) {
            // Defer UI updates slightly to avoid conflicts
            setTimeout(() => {
                setSelectedProduct(originalProduct);
                setEditingIndex(index);
                setInitialModalDetails(item.details);
                setModalOpen(true);
                setIsCartOpen(true); // Open drawer on edit
            }, 0);
        }
    }, [cart, PRODUCTS]);

    const handleAddToOrder = useCallback((orderItem) => {
        if (editingIndex !== null) {
            updateCartItem(editingIndex, orderItem);
            setEditingIndex(null);
        } else {
            addToCart(orderItem);
        }
    }, [editingIndex, addToCart, updateCartItem]);

    const handleRemoveItem = useCallback((index) => {
        removeFromCart(index);
    }, [removeFromCart]);

    const handleModalClose = useCallback(() => {
        setModalOpen(false);
        setEditingIndex(null);
        setInitialModalDetails(null);
    }, []);

    const handleReviewInvoice = useCallback(() => {
        // Navigate implies we rely on Context Persistence now
        navigate('/invoice/review');
    }, [navigate]);

    const handleCustomerSelect = useCallback((customer) => {
        setSelectedCustomer(customer);
        setEnableTax(!customer || customer.type === 'corporate');
    }, [setSelectedCustomer, setEnableTax]);

    return (
        <div className="flex h-full w-full overflow-hidden text-gray-800 font-sans bg-slate-100 relative">

            {/* --- Main Content area --- */}
            <div className={`flex-1 flex flex-col relative min-w-0 transition-all duration-300 ${isCartOpen ? 'md:mr-0' : ''}`}>

                {/* Top Header - Inverted Gold/Slate Theme */}
                <div className="h-auto md:h-20 flex flex-col md:flex-row md:items-center justify-between px-4 md:px-8 bg-slate-900 text-white shadow-md z-10 shrink-0 gap-4 md:gap-0 py-4 md:py-0 transition-all">
                    <div className="flex items-center justify-between w-full md:w-auto">
                        <div>
                            <h1 className="text-xl md:text-2xl font-bold tracking-tight text-amber-500">Invoice Generator</h1>
                            <p className="text-[10px] md:text-xs text-slate-400 font-medium">Create Quotations & Estimates</p>
                        </div>
                        {/* Mobile Cart Toggle */}
                        <button
                            onClick={() => setIsCartOpen(!isCartOpen)}
                            className="md:hidden relative p-2 text-white bg-slate-800 rounded-xl hover:bg-slate-700 transition-colors border border-slate-700"
                        >
                            <span className="text-xl">🛒</span>
                            {cart.length > 0 && (
                                <span className="absolute -top-1 -right-1 bg-amber-500 text-white text-[10px] font-bold w-5 h-5 flex items-center justify-center rounded-full border-2 border-slate-900 shadow-sm">
                                    {cart.length}
                                </span>
                            )}
                        </button>
                    </div>

                    {/* Search Bar */}
                    <div className="relative w-full md:w-96">
                        <span className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-500">🔍</span>
                        <input
                            type="text"
                            className="w-full bg-slate-800 border border-slate-700 rounded-xl py-2.5 pl-10 pr-4 text-white shadow-inner focus:ring-1 focus:ring-amber-500 focus:border-amber-500 transition-all placeholder-slate-500"
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
                            <ProductCard
                                key={product.id}
                                product={product}
                                onClick={handleProductClick}
                            />
                        ))}
                    </div>
                </div>
            </div>

            {/* --- Mobile Cart Overlay --- */}
            {isCartOpen && (
                <div
                    className="fixed inset-0 bg-black/50 z-40 md:hidden backdrop-blur-sm animate-fade-in"
                    onClick={() => setIsCartOpen(false)}
                />
            )}

            {/* --- Right Cart Panel (Responsive Drawer) --- */}
            <div className={`
                fixed inset-y-0 right-0 z-50 w-[85vw] sm:w-96 bg-white shadow-2xl transform transition-transform duration-300 ease-in-out
                md:relative md:translate-x-0 md:shadow-none md:border-l md:border-gray-200 md:w-[400px] shrink-0
                ${isCartOpen ? 'translate-x-0' : 'translate-x-full md:translate-x-0'}
            `}>
                <div className="h-full flex flex-col">
                    {/* Mobile Cart Header */}
                    <div className="md:hidden flex items-center justify-between p-4 border-b border-gray-100 bg-gray-50/50">
                        <h3 className="font-bold text-lg">Your Cart ({cart.length})</h3>
                        <button onClick={() => setIsCartOpen(false)} className="p-2 bg-gray-200 rounded-full hover:bg-gray-300 text-gray-600">
                            ✕
                        </button>
                    </div>

                    {/* Cart Sidebar */}
                    <div className="flex-1 overflow-hidden relative">
                        <CartSidebar
                            cartItems={cart}
                            onRemoveItem={handleRemoveItem}
                            onEditItem={handleEditCartItem}
                            customer={selectedCustomer}
                            actionLabel="Review Invoice"
                            onAction={handleReviewInvoice}
                            enableTax={enableTax}
                            onToggleTax={setEnableTax}
                        />
                    </div>
                </div>
            </div>

            {/* --- Mobile Floating Checkout Button (Only if Cart has items and is closed) --- */}
            {!isCartOpen && cart.length > 0 && (
                <div className="md:hidden fixed bottom-6 right-6 z-30 animate-bounce-subtle">
                    <button
                        onClick={() => setIsCartOpen(true)}
                        className="bg-gray-900 text-white p-4 rounded-full shadow-xl shadow-gray-900/40 flex items-center justify-center relative hover:scale-105 active:scale-95 transition-all"
                    >
                        <span className="text-2xl">🛒</span>
                        <span className="absolute -top-2 -right-2 bg-amber-500 text-white text-xs font-bold w-6 h-6 flex items-center justify-center rounded-full border-2 border-white">
                            {cart.length}
                        </span>
                    </button>
                </div>
            )}

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
