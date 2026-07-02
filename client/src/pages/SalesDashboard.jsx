import React, { useState, useEffect, useCallback } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import api from '../services/api';
import ProductCard from '../components/sales/ProductCard';
import ProductModal from '../components/sales/ProductModal';
import CartSidebar from '../components/sales/CartSidebar';
import { useProducts } from '../context/ProductContext';
import { useCart } from '../context/CartContext';
import { useProductFiltering, PROFILE_COLORS } from '../hooks/useProductFiltering';
import CustomerSelectionOverlay from '../components/sales/CustomerSelectionOverlay';

const SearchIcon = () => (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <circle cx="11" cy="11" r="8" /><line x1="21" y1="21" x2="16.65" y2="16.65" />
    </svg>
);

const CartIcon = () => (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <circle cx="9" cy="21" r="1" /><circle cx="20" cy="21" r="1" />
        <path d="M1 1h4l2.68 13.39a2 2 0 001.99 1.61h9.72a2 2 0 001.99-1.61L23 6H6" />
    </svg>
);

const ChevronRightIcon = () => (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
        <polyline points="9 18 15 12 9 6" />
    </svg>
);

export default function SalesDashboard() {
    const location = useLocation();
    const navigate = useNavigate();

    // Responsive breakpoint
    const [windowWidth, setWindowWidth] = useState(() => window.innerWidth);
    useEffect(() => {
        const h = () => setWindowWidth(window.innerWidth);
        window.addEventListener('resize', h, { passive: true });
        return () => window.removeEventListener('resize', h);
    }, []);
    const isMobileView = windowWidth < 900;

    const { products: PRODUCTS } = useProducts();

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

    const [selectedProduct, setSelectedProduct] = useState(null);
    const [modalOpen, setModalOpen] = useState(false);
    const [editingIndex, setEditingIndex] = useState(null);
    const [initialModalDetails, setInitialModalDetails] = useState(null);
    const [isCartOpen, setIsCartOpen] = useState(false);
    const [customers, setCustomers] = useState([]);

    const {
        cartItems: cart,
        customer: selectedCustomer,
        setCustomer: setSelectedCustomer,
        addToCart,
        updateCartItem,
        removeFromCart,
        loadOrder,
        clearCart,
        sessionType,
        setSessionType
    } = useCart();

    const [enableTax, setEnableTax] = useState(() =>
        location.state?.enableTax !== undefined ? location.state.enableTax : true
    );

    useEffect(() => {
        if (!location.state?.mode && sessionType !== 'sales') {
            clearCart();
            setSessionType('sales');
        }
    }, [sessionType, setSessionType, clearCart, location.state]);

    useEffect(() => {
        let cancelled = false;
        const fetchCustomers = async () => {
            try {
                const fetched = await api.userService.getCustomers();
                if (!cancelled) {
                    setCustomers(fetched.map(c => ({ id: c.customerId, name: c.name, phone: c.phoneNumber, type: c.type })));
                }
            } catch (err) {
                if (!cancelled) console.error('Failed to load customers', err);
            }
        };
        fetchCustomers();
        return () => { cancelled = true; };
    }, []);

    // Track whether we have already loaded this specific navigation state so
    // cart edits (add/remove) don't trigger a re-load of the original items.
    const loadedStateRef = React.useRef(null);

    useEffect(() => {
        // Key includes whether products are loaded — so the effect re-runs once
        // after products arrive (to resolve names) but not on cart mutations.
        const productsReady = PRODUCTS.length > 0 ? 'ready' : 'empty';
        const stateKey = `${location.state?.orderData?.id ?? location.state?.mode ?? 'none'}-${productsReady}`;

        if ((location.state?.mode === 'edit' || location.state?.mode === 'resume') && location.state?.orderData) {
            // Only load once per (navigation × products-ready) combination
            if (loadedStateRef.current === stateKey) return;
            loadedStateRef.current = stateKey;

            const orderData = location.state.orderData;
            const cust = orderData.customer;

            const mappedItems = (orderData.items || []).map(backendItem => {
                const details = backendItem.details || {};
                const productId = backendItem.productId ?? details.productId;
                const product = PRODUCTS.find(p => p.id === productId);
                return {
                    id: productId,
                    productId: productId,
                    name: product?.name ?? details.name ?? `Product #${productId}`,
                    image: product?.image ?? null,
                    totalPrice: backendItem.totalPrice ?? 0,
                    unit: backendItem.unitType ?? details.unitType ?? 'pcs',
                    qty: backendItem.quantity ?? details.quantity ?? 1,
                    price: backendItem.unitPrice ?? details.unitPrice ?? 0,
                    variantId: backendItem.variantId ?? details.variantId ?? null,
                    details,
                };
            });

            loadOrder({ ...orderData, items: mappedItems });
            setEnableTax(orderData.VAT_status ?? (!cust || cust.type === 'corporate'));
        } else if (location.state?.mode === 'link' && location.state?.customer) {
            if (loadedStateRef.current?.startsWith('link')) return;
            loadedStateRef.current = stateKey;
            setSelectedCustomer(location.state.customer);
            setEnableTax(!location.state.customer || location.state.customer.type === 'corporate');
        } else if (!location.state?.mode) {
            loadedStateRef.current = null;
            setSelectedCustomer(null);
        }
    }, [location.state, loadOrder, setSelectedCustomer, PRODUCTS]);

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
            setSelectedProduct(originalProduct);
            setEditingIndex(index);
            setInitialModalDetails(item.details);
            setModalOpen(true);
            setIsCartOpen(true);
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

    const handleCustomerSelect = useCallback((customer) => {
        setSelectedCustomer(customer);
        setEnableTax(!customer || customer.type !== 'individual');
    }, [setSelectedCustomer]);

    const isEditMode = location.state?.mode === 'edit';

    return (
        <div style={{
            display: 'flex',
            height: '100%',
            minHeight: 0,
            background: 'var(--color-bg)',
            color: 'var(--color-text)',
            overflow: 'hidden',
            position: 'relative',
        }}>

            {/* ── LEFT: Product Browser ── */}
            <div style={{
                flex: 1,
                display: 'flex',
                flexDirection: 'column',
                minWidth: 0,
                position: 'relative',
            }}>

                {/* Header */}
                <div style={{
                    height: '72px',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    padding: '0 1.75rem',
                    borderBottom: '1px solid rgba(255,255,255,0.06)',
                    background: 'rgba(9,14,26,0.8)',
                    backdropFilter: 'blur(12px)',
                    flexShrink: 0,
                    position: 'sticky',
                    top: 0,
                    zIndex: 10,
                }}>
                    <div>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '0.625rem' }}>
                            <h1 style={{ fontSize: '1.1rem', fontWeight: 700, color: '#f1f5f9', letterSpacing: '-0.01em' }}>
                                Sales Terminal
                            </h1>
                            {isEditMode && (
                                <span style={{
                                    fontSize: '0.65rem', fontWeight: 700,
                                    padding: '0.2rem 0.6rem',
                                    background: 'rgba(245,158,11,0.12)',
                                    border: '1px solid rgba(245,158,11,0.25)',
                                    borderRadius: '100px',
                                    color: '#fbbf24',
                                    letterSpacing: '0.06em',
                                    textTransform: 'uppercase',
                                }}>
                                    Edit: #{String(location.state?.orderData?.id ?? '').slice(-6)}
                                </span>
                            )}
                            {location.state?.mode === 'link' && (
                                <span style={{
                                    fontSize: '0.65rem', fontWeight: 700,
                                    padding: '0.2rem 0.6rem',
                                    background: 'rgba(59,130,246,0.12)',
                                    border: '1px solid rgba(59,130,246,0.25)',
                                    borderRadius: '100px',
                                    color: '#60a5fa',
                                    letterSpacing: '0.06em',
                                    textTransform: 'uppercase',
                                }}>
                                    Linked Order
                                </span>
                            )}
                        </div>
                        <div style={{ fontSize: '0.75rem', color: '#475569', marginTop: '2px' }}>
                            {filteredProducts.length} products • {cart.length} in cart
                        </div>
                    </div>

                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.625rem' }}>
                        {/* Search */}
                        <div style={{ position: 'relative', width: isMobileView ? 'clamp(100px, 30vw, 200px)' : '280px' }}>
                            <span style={{
                                position: 'absolute', left: '12px', top: '50%', transform: 'translateY(-50%)',
                                color: '#475569', pointerEvents: 'none',
                            }}>
                                <SearchIcon />
                            </span>
                            <input
                                type="text"
                                placeholder="Search products..."
                                value={searchQuery}
                                onChange={e => setSearchQuery(e.target.value)}
                                style={{
                                    width: '100%',
                                    background: 'rgba(255,255,255,0.06)',
                                    border: '1px solid rgba(255,255,255,0.1)',
                                    borderRadius: '0.75rem',
                                    padding: '0.625rem 0.875rem 0.625rem 2.5rem',
                                    color: '#f1f5f9',
                                    fontSize: '0.875rem',
                                    fontFamily: 'inherit',
                                    outline: 'none',
                                    transition: 'all 0.2s ease',
                                }}
                                onFocus={e => { e.target.style.borderColor = 'rgba(59,130,246,0.5)'; e.target.style.background = 'rgba(255,255,255,0.08)'; e.target.style.boxShadow = '0 0 0 3px rgba(59,130,246,0.1)'; }}
                                onBlur={e => { e.target.style.borderColor = 'rgba(255,255,255,0.1)'; e.target.style.background = 'rgba(255,255,255,0.06)'; e.target.style.boxShadow = ''; }}
                            />
                        </div>

                        {/* Mobile cart toggle */}
                        <button
                            onClick={() => setIsCartOpen(!isCartOpen)}
                            style={{
                                position: 'relative',
                                width: '44px', height: '44px',
                                borderRadius: '0.75rem',
                                background: 'rgba(255,255,255,0.06)',
                                border: '1px solid rgba(255,255,255,0.1)',
                                display: 'flex', alignItems: 'center', justifyContent: 'center',
                                color: '#94a3b8',
                                cursor: 'pointer',
                                transition: 'all 0.2s ease',
                            }}
                            onMouseEnter={e => { e.currentTarget.style.background = 'rgba(59,130,246,0.12)'; e.currentTarget.style.color = '#60a5fa'; }}
                            onMouseLeave={e => { e.currentTarget.style.background = 'rgba(255,255,255,0.06)'; e.currentTarget.style.color = '#94a3b8'; }}
                        >
                            <CartIcon />
                            {cart.length > 0 && (
                                <span style={{
                                    position: 'absolute', top: '-6px', right: '-6px',
                                    width: '18px', height: '18px',
                                    background: 'linear-gradient(135deg, #3b82f6, #06b6d4)',
                                    borderRadius: '50%',
                                    fontSize: '0.6rem', fontWeight: 700, color: '#fff',
                                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                                    border: '2px solid var(--color-bg)',
                                }}>
                                    {cart.length}
                                </span>
                            )}
                        </button>
                    </div>
                </div>

                {/* Category Tabs */}
                <div style={{
                    padding: '1rem 1.75rem 0',
                    flexShrink: 0,
                    borderBottom: '1px solid rgba(255,255,255,0.05)',
                    background: 'rgba(255,255,255,0.01)',
                }}>
                    {/* Main Category Pills */}
                    <div style={{ display: 'flex', gap: '0.5rem', overflowX: 'auto', paddingBottom: '0.875rem' }} className="scrollbar-hide">
                        {CATEGORIES.map(cat => {
                            const isActive = activeCategory === cat.id;
                            return (
                                <button
                                    key={cat.id}
                                    onClick={() => setActiveCategory(cat.id)}
                                    style={{
                                        display: 'flex', alignItems: 'center', gap: '0.5rem',
                                        padding: '0.625rem 1.125rem',
                                        borderRadius: '0.75rem',
                                        border: isActive ? '1px solid rgba(59,130,246,0.4)' : '1px solid rgba(255,255,255,0.08)',
                                        background: isActive ? 'rgba(59,130,246,0.15)' : 'rgba(255,255,255,0.03)',
                                        color: isActive ? '#60a5fa' : '#64748b',
                                        fontSize: '0.875rem',
                                        fontWeight: 600,
                                        cursor: 'pointer',
                                        whiteSpace: 'nowrap',
                                        transition: 'all 0.2s ease',
                                        boxShadow: isActive ? '0 0 0 1px rgba(59,130,246,0.15), 0 4px 12px rgba(59,130,246,0.12)' : 'none',
                                        flexShrink: 0,
                                    }}
                                    onMouseEnter={e => { if (!isActive) { e.currentTarget.style.background = 'rgba(255,255,255,0.06)'; e.currentTarget.style.color = '#94a3b8'; } }}
                                    onMouseLeave={e => { if (!isActive) { e.currentTarget.style.background = 'rgba(255,255,255,0.03)'; e.currentTarget.style.color = '#64748b'; } }}
                                >
                                    <span style={{ fontSize: '1.1rem' }}>{cat.icon}</span>
                                    <span>{cat.label}</span>
                                </button>
                            );
                        })}
                    </div>

                    {/* Sub-filters row */}
                    {(isProfileCategory || currentSubCategories.length > 0) && (
                        <div style={{ display: 'flex', alignItems: 'center', gap: '0.875rem', paddingBottom: '0.875rem', flexWrap: 'wrap' }}>
                            {/* Profile color selector */}
                            {isProfileCategory && (
                                <div style={{
                                    display: 'flex', alignItems: 'center', gap: '0.5rem',
                                    padding: '0.375rem 0.75rem',
                                    background: 'rgba(255,255,255,0.03)',
                                    border: '1px solid rgba(255,255,255,0.07)',
                                    borderRadius: '0.625rem',
                                }}>
                                    <span style={{ fontSize: '0.65rem', fontWeight: 600, color: '#475569', letterSpacing: '0.06em', textTransform: 'uppercase' }}>Color:</span>
                                    <div style={{ display: 'flex', gap: '4px' }}>
                                        {PROFILE_COLORS.map(color => (
                                            <button
                                                key={color.name}
                                                onClick={() => setProfileColor(color.name)}
                                                title={color.name}
                                                style={{
                                                    display: 'flex', alignItems: 'center', gap: '5px',
                                                    padding: '0.25rem 0.5rem',
                                                    borderRadius: '0.375rem',
                                                    border: profileColor === color.name ? '1px solid rgba(59,130,246,0.5)' : '1px solid transparent',
                                                    background: profileColor === color.name ? 'rgba(59,130,246,0.12)' : 'transparent',
                                                    cursor: 'pointer',
                                                    transition: 'all 0.15s ease',
                                                }}
                                            >
                                                <div style={{
                                                    width: '12px', height: '12px', borderRadius: '50%',
                                                    background: color.hex,
                                                    border: '1px solid rgba(255,255,255,0.15)',
                                                    flexShrink: 0,
                                                }} />
                                                <span style={{ fontSize: '0.72rem', fontWeight: 600, color: profileColor === color.name ? '#93c5fd' : '#475569' }}>
                                                    {color.name}
                                                </span>
                                            </button>
                                        ))}
                                    </div>
                                </div>
                            )}

                            {/* Sub-categories */}
                            {currentSubCategories.map(sub => {
                                const isActive = activeSubCategory === sub.id;
                                return (
                                    <button
                                        key={sub.id}
                                        onClick={() => setActiveSubCategory(sub.id)}
                                        style={{
                                            padding: '0.3rem 0.75rem',
                                            borderRadius: '0.375rem',
                                            border: isActive ? '1px solid rgba(255,255,255,0.2)' : '1px solid rgba(255,255,255,0.07)',
                                            background: isActive ? 'rgba(255,255,255,0.1)' : 'transparent',
                                            color: isActive ? '#e2e8f0' : '#475569',
                                            fontSize: '0.78rem', fontWeight: 500,
                                            cursor: 'pointer',
                                            transition: 'all 0.15s ease',
                                        }}
                                    >
                                        {sub.label}
                                    </button>
                                );
                            })}
                        </div>
                    )}
                </div>

                {/* Product Grid */}
                <div style={{ flex: 1, overflowY: 'auto', padding: '1.5rem 1.75rem' }} className="scrollbar-hide">
                    {filteredProducts.length === 0 ? (
                        <div style={{
                            display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
                            height: '300px', color: '#334155', gap: '0.75rem',
                        }}>
                            <span style={{ fontSize: '3rem', opacity: 0.4 }}>🔍</span>
                            <div style={{ fontSize: '1rem', fontWeight: 600, color: '#475569' }}>No products found</div>
                            <div style={{ fontSize: '0.875rem', color: '#334155' }}>Try adjusting your search or filters</div>
                        </div>
                    ) : (
                        <div style={{
                            display: 'grid',
                            gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))',
                            gap: '1rem',
                        }}>
                            {filteredProducts.map(product => (
                                <ProductCard
                                    key={product.id}
                                    product={product}
                                    onClick={handleProductClick}
                                    selectedColor={profileColor}
                                />
                            ))}
                        </div>
                    )}
                </div>
            </div>

            {/* ── Mobile Cart Backdrop ── */}
            {isMobileView && isCartOpen && (
                <div
                    onClick={() => setIsCartOpen(false)}
                    style={{
                        position: 'fixed', inset: 0,
                        background: 'rgba(0,0,0,0.65)',
                        backdropFilter: 'blur(6px)',
                        zIndex: 48,
                        animation: 'fadeIn 0.2s ease',
                    }}
                />
            )}

            {/* ── RIGHT: Cart Panel ── */}
            <div style={{
                // Mobile/tablet: slide-in drawer from right
                // Desktop: fixed-width side panel
                ...(isMobileView ? {
                    position: 'fixed',
                    top: 0, right: 0, bottom: 0,
                    width: 'min(380px, 100vw)',
                    zIndex: 50,
                    transform: isCartOpen ? 'translateX(0)' : 'translateX(100%)',
                    transition: 'transform 0.3s cubic-bezier(0.4,0,0.2,1)',
                    boxShadow: isCartOpen ? '-8px 0 40px rgba(0,0,0,0.6)' : 'none',
                } : {
                    width: 'clamp(300px, 28vw, 400px)',
                    flexShrink: 0,
                    position: 'relative',
                    zIndex: 30,
                }),
                display: 'flex',
                flexDirection: 'column',
                borderLeft: '1px solid rgba(255,255,255,0.07)',
                background: 'rgba(9,14,26,0.97)',
                backdropFilter: 'blur(16px)',
            }}>
                {/* Cart header */}
                <div style={{
                    minHeight: '64px',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    padding: '0.875rem 1.25rem',
                    borderBottom: '1px solid rgba(255,255,255,0.06)',
                    flexShrink: 0,
                    gap: '0.75rem',
                }}>
                    <div>
                        <h2 style={{ fontSize: '0.95rem', fontWeight: 700, color: '#f1f5f9' }}>Order Cart</h2>
                        <div style={{ fontSize: '0.72rem', color: '#475569', marginTop: '2px' }}>
                            {cart.length === 0 ? 'Empty' : `${cart.length} item${cart.length !== 1 ? 's' : ''}`}
                        </div>
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                        {cart.length > 0 && (
                            <div style={{
                                padding: '0.3rem 0.75rem',
                                background: 'linear-gradient(135deg, #3b82f6, #06b6d4)',
                                borderRadius: '100px',
                                fontSize: '0.7rem', fontWeight: 700, color: '#fff',
                            }}>
                                {cart.length}
                            </div>
                        )}
                        {isMobileView && (
                            <button
                                onClick={() => setIsCartOpen(false)}
                                style={{
                                    width: '32px', height: '32px', borderRadius: '8px',
                                    background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.1)',
                                    color: '#64748b', cursor: 'pointer',
                                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                                    flexShrink: 0,
                                }}
                            >✕</button>
                        )}
                    </div>
                </div>

                {/* Cart body */}
                <div style={{ flex: 1, overflow: 'hidden', position: 'relative' }}>
                    <CartSidebar
                        cartItems={cart}
                        onRemoveItem={(index) => removeFromCart(index)}
                        onEditItem={handleEditCartItem}
                        customer={selectedCustomer}
                        onChangeCustomer={() => setSelectedCustomer(null)}
                        enableTax={enableTax}
                        onToggleTax={setEnableTax}
                        mode={isEditMode ? 'edit' : undefined}
                        originalTotal={0}
                        actionLabel={isEditMode ? 'Update Order' : 'Checkout'}
                        onAction={isEditMode ? () => {
                            const od = location.state.orderData;
                            navigate('/checkout', {
                                state: {
                                    cartItems: cart,
                                    customer: selectedCustomer,
                                    enableTax,
                                    mode: 'edit',
                                    // amountPaid = what was already collected (used to compute the delta owed)
                                    originalTotal: od.amountPayed ?? od.amountPaid ?? 0,
                                    // balance = outstanding balance before this edit (shown to the cashier for context)
                                    originalBalance: od.balance ?? 0,
                                    orderData: { id: od.id ?? od.orderId },
                                },
                            });
                        } :location.state?.mode === 'link' ? () => {
                            navigate('/checkout', {
                                state: {
                                    cartItems: cart,
                                    customer: selectedCustomer,
                                    enableTax,
                                    parentOrderId: location.state.parentOrderId,
                                },
                            });
                        } : undefined}
                    />
                </div>
            </div>

            {/* ── Mobile Floating Cart Button ── */}
            {isMobileView && !isCartOpen && cart.length > 0 && (
                <button
                    onClick={() => setIsCartOpen(true)}
                    style={{
                        position: 'fixed', bottom: '1.5rem', right: '1.5rem',
                        zIndex: 30,
                        width: '60px', height: '60px',
                        borderRadius: '50%',
                        background: 'linear-gradient(135deg, #3b82f6, #06b6d4)',
                        border: 'none',
                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                        cursor: 'pointer',
                        boxShadow: '0 8px 32px rgba(59,130,246,0.4)',
                        animation: 'bounceSubtle 2s ease-in-out infinite',
                    }}
                >
                    <CartIcon />
                    <span style={{
                        position: 'absolute', top: '-4px', right: '-4px',
                        width: '20px', height: '20px',
                        background: '#ef4444', borderRadius: '50%',
                        fontSize: '0.65rem', fontWeight: 700, color: '#fff',
                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                        border: '2px solid var(--color-bg)',
                    }}>
                        {cart.length}
                    </span>
                </button>
            )}

            {/* ── Product Modal ── */}
            <ProductModal
                product={selectedProduct}
                isOpen={modalOpen}
                onClose={() => { setModalOpen(false); setEditingIndex(null); setInitialModalDetails(null); }}
                onAddToOrder={handleAddToOrder}
                color={initialModalDetails?.color || profileColor}
                initialDetails={initialModalDetails}
                source="sales"
            />

            {/* ── Customer Selection Overlay ── */}
            {!selectedCustomer && (
                <CustomerSelectionOverlay
                    customers={customers}
                    onSelectCustomer={handleCustomerSelect}
                />
            )}
        </div>
    );
}
