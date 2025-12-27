import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import ProductCard from '../components/sales/ProductCard';
import ProductModal from '../components/sales/ProductModal';
import CartSidebar from '../components/sales/CartSidebar';
import { useProducts } from '../context/ProductContext';
import { useCart } from '../context/CartContext';
import { CUSTOMERS } from '../data/mockCustomers';
import { useProductFiltering, PROFILE_COLORS } from '../hooks/useProductFiltering';
import logo from '../assets/logo.png';
import CustomerSelectionOverlay from '../components/sales/CustomerSelectionOverlay';

export default function SalesDashboard() {
    const location = useLocation();
    const navigate = useNavigate();

    // --- CONTEXT ---
    const { products: PRODUCTS } = useProducts();

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
    // Modal & Selection State
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
        removeFromCart,
        loadOrder
    } = useCart();

    // Mobile Cart Drawer State
    const [isCartOpen, setIsCartOpen] = useState(false);


    // --- INITIALIZATION EFFECT ---
    useEffect(() => {
        // Only override context logic if strictly necessary (e.g. Editing/Resuming)
        // Normal navigation shouldn't wipe the cart because Context handles persistence.

        if ((location.state?.mode === 'edit' || location.state?.mode === 'resume') && location.state?.orderData) {
            // Load historical order
            loadOrder(location.state.orderData);

            // Tax Logic for historical
            const cust = location.state.orderData.customer;
            setEnableTax(!cust || cust.type === 'corporate');

        } else if (location.state?.mode === 'link' && location.state?.customer) {
            // Linking (New Order for specific customer)
            // Ideally clear cart? 
            // clearCart(); // Dependent on UX requirements. Assume yes for new link.
            setSelectedCustomer(location.state.customer);
            setEnableTax(!location.state.customer || location.state.customer.type === 'corporate');
        }
        // Note: We removed the generic `location.state.cartItems` check because Context persistence > passing state.
    }, [location.state, loadOrder, setSelectedCustomer, setEnableTax]);


    // --- OPTIMIZED HANDLERS (useCallback) ---
    const handleProductClick = useCallback((product) => {
        setSelectedProduct(product);
        setEditingIndex(null);
        setInitialModalDetails(null);
        setModalOpen(true);
    }, []);

    const handleEditCartItem = useCallback((index) => {
        // Access current cart from context/prop directly
        const item = cart[index];
        if (!item) return;
        const originalProduct = PRODUCTS.find(p => p.id === item.id);
        if (originalProduct) {
            // We need to defer state updates to avoid conflicts during render
            // But in event handlers, it's fine.
            setSelectedProduct(originalProduct);
            setEditingIndex(index);
            setInitialModalDetails(item.details);
            setModalOpen(true);
            setIsCartOpen(true); // Open drawer on edit
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

    const handleCustomerSelect = useCallback((customer) => {
        setSelectedCustomer(customer);
        // Auto-set tax defaults when changing customer
        setEnableTax(!customer || customer.type === 'corporate');
    }, []);

    return (
        <div className="flex h-full w-full overflow-hidden text-gray-800 font-sans relative">

            {/* --- Main Content area --- */}
            <div className={`flex-1 flex flex-col relative bg-slate-50 min-w-0 transition-all duration-300 ${isCartOpen ? 'md:mr-0' : ''}`}>

                {/* Top Header */}
                <div className="h-20 flex items-center justify-between px-8 border-b border-gray-200 bg-white/50 backdrop-blur-sm sticky top-0 z-10 transition-colors shrink-0">
                    <div>
                        <h1 className="text-xl md:text-2xl font-bold text-gray-800 tracking-tight">Sales Terminal</h1>
                        <div className="flex items-center gap-2">
                            <p className="text-xs text-gray-500 font-medium">Welcome back, Agent</p>
                            {location.state?.mode === 'edit' && (
                                <span className="bg-amber-100 text-amber-700 text-xs px-2 py-0.5 rounded font-bold border border-amber-200">
                                    Edit: {location.state.orderData.id}
                                </span>
                            )}
                            {location.state?.mode === 'link' && (
                                <span className="bg-blue-100 text-blue-700 text-xs px-2 py-0.5 rounded font-bold border border-blue-200">
                                    Link: {location.state.parentOrderId}
                                </span>
                            )}
                        </div>
                    </div>
                    {/* Mobile Cart Toggle */}
                    <button
                        onClick={() => setIsCartOpen(!isCartOpen)}
                        className="md:hidden relative p-2 text-gray-700 bg-gray-100 rounded-xl hover:bg-gray-200 transition-colors"
                    >
                        <span className="text-xl">🛒</span>
                        {cart.length > 0 && (
                            <span className="absolute -top-1 -right-1 bg-red-500 text-white text-[10px] font-bold w-5 h-5 flex items-center justify-center rounded-full border-2 border-white shadow-sm">
                                {cart.length}
                            </span>
                        )}
                    </button>

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

                    {/* Cart Sidebar Component */}
                    <div className="flex-1 overflow-hidden relative">
                        <CartSidebar
                            cartItems={cart}
                            onRemoveItem={handleRemoveItem}
                            onEditItem={handleEditCartItem}
                            customer={selectedCustomer}
                            enableTax={enableTax}
                            onToggleTax={setEnableTax}
                            mode={location.state?.mode === 'edit' ? 'edit' : undefined}
                            originalTotal={location.state?.mode === 'edit' ? location.state.orderData.totalAmount : 0}
                            actionLabel={location.state?.mode === 'edit' ? 'Update Order' : 'Checkout'}
                            onAction={location.state?.mode === 'edit' ? () => {
                                navigate('/checkout', {
                                    state: {
                                        cartItems: cart,
                                        customer: selectedCustomer,
                                        mode: 'edit',
                                        originalTotal: location.state.orderData.totalAmount || 0,
                                        orderId: location.state.orderData.id
                                    }
                                });
                            } : undefined}
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
                        <span className="absolute -top-2 -right-2 bg-blue-600 text-white text-xs font-bold w-6 h-6 flex items-center justify-center rounded-full border-2 border-white">
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


