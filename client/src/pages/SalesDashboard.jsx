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
import { editSignature, mapItemForBackend } from '../utils/orderItemMapping';
import WindowTabs, { WindowExpiryNotice } from '../components/sales/WindowTabs';
import { useWindows } from '../context/WindowContext';

// VAT is on by default except for individual customers (businesses and walk-ins are
// invoiced with VAT). One rule for picking a customer, linking and converting.
const defaultVat = (customer) => !customer || customer.type !== 'individual';

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
        setSessionType,
        linkedRef,
        setLinkedRef,
        editSession,
        setEditSession,
        // VAT lives with the cart (saved with it): page-local state reset it to "on" every
        // time Sales was opened, so coming back to an individual's cart added 16%.
        taxEnabled: enableTax,
        setTaxEnabled: setEnableTax,
        // A new sale with sale windows on: the cart is the active window on the server, and
        // every change above is a save that can be refused (CartContext).
        windowMode,
    } = useCart();
    const { enabled: windowsEnabled, activeWindow, openWindowWith, loaded: windowsLoaded } = useWindows();
    // The VAT toggle and the customer pick are saves in a window; a refused one is already on
    // screen as a toast, and must not surface as an unhandled rejection.
    const toggleTax = useCallback((value) => { Promise.resolve(setEnableTax(value)).catch(() => {}); }, [setEnableTax]);

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
    // Which way this page mount picked up an edit: 'fresh' (loaded from the order - may
    // re-run once the product list arrives, to resolve names) or 'kept' (the same edit was
    // already in progress - reload, Back from checkout - so the cart is left as it is).
    const editLoadRef = React.useRef(null);
    // The load effect below must run only on navigation / products arriving - never on a cart
    // change (its no-mode branch resets the customer). So it reads these through a ref, kept
    // current by this effect, which runs before it.
    const liveRef = React.useRef({});
    useEffect(() => { liveRef.current = { editSession, cartLength: cart.length, clearCart, windowMode }; });

    useEffect(() => {
        const { editSession, cartLength, clearCart, windowMode: inWindow } = liveRef.current;
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

            const isEdit = location.state?.mode === 'edit';
            const orderId = orderData.id ?? orderData.orderId ?? null;
            const nonce = location.state?.editNonce ?? null;
            // The same edit is already in progress (the page was reloaded, or the browser went
            // back to it): keep the cashier's changes rather than reloading the order as it was
            // when Edit was pressed.
            if (isEdit && editLoadRef.current !== 'fresh' && (editLoadRef.current === 'kept' || (
                editSession && nonce && editSession.orderId === orderId && editSession.nonce === nonce && cartLength > 0))) {
                editLoadRef.current = 'kept';
                if (editSession?.vat !== undefined) setEnableTax(editSession.vat);
                return;
            }
            if (isEdit) editLoadRef.current = 'fresh';
            const mappedItems = (orderData.items || []).map(backendItem => {
                // Edit mode: remember which saved item this line is, so a calculator reopening
                // it can ask whether its cuts were made (useEditCutAnswers).
                // `_source` is what the saved item holds - it never changes while the cart is
                // edited, so reopening the item still compares against, and adds back, the
                // saved quantities (utils/editHoldings, hooks/useEditCutAnswers).
                const saved = backendItem.details || {};
                const details = isEdit && backendItem.itemId
                    ? {
                        ...saved,
                        _sourceItemId: backendItem.itemId,
                        _source: {
                            variantId: backendItem.variantId ?? saved.variantId ?? null,
                            qty: saved.qty ?? null,
                            lineItems: saved.lineItems || [],
                        },
                    }
                    : saved;
                const productId = backendItem.productId ?? details.productId;
                const product = PRODUCTS.find(p => p.id === productId);
                return {
                    id: productId,
                    productId: productId,
                    name: product?.name ?? details.name ?? `Product #${productId}`,
                    category: product?.category ?? null,
                    totalPrice: backendItem.totalPrice ?? 0,
                    unit: backendItem.unitType ?? details.unitType ?? 'pcs',
                    qty: backendItem.quantity ?? details.quantity ?? 1,
                    price: backendItem.unitPrice ?? details.unitPrice ?? 0,
                    variantId: backendItem.variantId ?? details.variantId ?? null,
                    details,
                };
            });

            const vat = orderData.VAT_status ?? defaultVat(cust);
            loadOrder({ ...orderData, items: mappedItems }, {
                editSession: isEdit ? {
                    orderId,
                    orderNo: orderData.orderNo ?? null,   // the number people know it by
                    version: orderData.version ?? null,
                    nonce,
                    originalTotal: orderData.amountPayed ?? orderData.amountPaid ?? 0,
                    originalBalance: orderData.balance ?? 0,
                    // The order's discount — checkout starts from it, so an edit keeps it.
                    discount: orderData.discount ?? 0,
                    vat,
                    // What the order is now; checkout compares against it to spot an edit
                    // that changes nothing.
                    originalSig: editSignature(mappedItems, { customerId: cust?.id ?? orderData.customerId ?? null, vat, discount: orderData.discount ?? 0 }),
                } : null,
            });
            setEnableTax(vat);
        } else if (location.state?.mode === 'link' && location.state?.customer && windowsEnabled) {
            // "Add to order" with sale windows on: a new window tied to the parent order, for
            // its customer. Keyed by navigation so it opens exactly one window, and the
            // instruction is consumed - router state survives a reload, which would otherwise
            // open ANOTHER window on every refresh.
            if (loadedStateRef.current === location.key) return;
            loadedStateRef.current = location.key;
            // Adding to another order ends any edit in progress - its lines must not ride along.
            if (editSession) clearCart();
            setSessionType('sales');
            const cust = location.state.customer;
            openWindowWith({ customer: cust, parentOrderId: location.state.parentOrderId ?? null, VAT_status: defaultVat(cust) })
                .catch(() => {});
            navigate(location.pathname, { replace: true, state: null });
        } else if (location.state?.mode === 'link' && location.state?.customer) {
            if (loadedStateRef.current?.startsWith('link')) return;
            loadedStateRef.current = stateKey;
            // Adding to another order ends any edit in progress - its lines must not ride along.
            if (editSession) clearCart();
            setSelectedCustomer(location.state.customer);
            setLinkedRef({ type: 'link', id: location.state.parentOrderId ?? null });
            setEnableTax(defaultVat(location.state.customer));
        } else if (location.state?.mode === 'convert' && location.state?.cartItems && windowsEnabled) {
            // A quotation's items with sale windows on: into a new window, which HOLDS their
            // stock from now on - with the quotation's discount and VAT. If they can't all be
            // filled the window is closed again, and the reason is already on screen.
            if (loadedStateRef.current === location.key) return;
            loadedStateRef.current = location.key;
            if (editSession) clearCart();
            setSessionType('sales');
            const { cartItems: quoted, customer: cust, sourceInvoiceId, enableTax: vat, discount } = location.state;
            openWindowWith({
                items: quoted.map(mapItemForBackend),
                customer: cust || null,
                sourceInvoiceId: sourceInvoiceId ?? null,
                discount: discount ?? 0,
                VAT_status: vat ?? defaultVat(cust),
            }).catch(() => {});
            navigate(location.pathname, { replace: true, state: null });
        } else if (location.state?.mode === 'convert' && location.state?.cartItems) {
            // Editing a to-be-converted invoice's items — cartItems are already in
            // frontend cart-item shape (they round-trip from invoice.items as-is),
            // so no backend-shape mapping needed here (unlike the edit-order branch above).
            if (loadedStateRef.current?.startsWith('convert')) return;
            loadedStateRef.current = stateKey;
            loadOrder({ items: location.state.cartItems, customer: location.state.customer || null });
            setLinkedRef({ type: 'convert', id: location.state.sourceInvoiceId ?? null, discount: location.state.discount ?? 0 });
            setEnableTax(location.state.enableTax ?? defaultVat(location.state.customer));
        } else if (!location.state?.mode) {
            loadedStateRef.current = null;
            if (editSession) {
                // An edit is in progress (the cashier went to another page and came back): the
                // page stays in edit mode - the cart is NOT a new sale. It ends by saving it or
                // by "Discard edit" on the banner.
                if (editSession.vat !== undefined) setEnableTax(editSession.vat);
                return;
            }
            // The customer is left alone: a finished sale already cleared it (clearCart), and
            // clearing it here dropped the customer of a cart in progress (VAT then switched on
            // for an individual's cart) — or, with the cart shared between tabs, the customer
            // another tab had just picked. Only a link with nothing in the cart is stale.
            // Local carts only: a sale window carries its own link, and clearing it is a save -
            // which renews the setters this effect depends on, so it would run (and save) again
            // without end.
            if (!inWindow && cartLength === 0) setLinkedRef(null);
        }
    }, [location.state, location.key, location.pathname, navigate, loadOrder, setSelectedCustomer, setLinkedRef, setEnableTax, setSessionType, openWindowWith, windowsEnabled, PRODUCTS]);

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

    // Returns the save: in a sale window it can be refused, and the product modal then stays
    // open with what the cashier entered (the reason is already on screen).
    const handleAddToOrder = useCallback((orderItem) => {
        const save = editingIndex !== null ? updateCartItem(editingIndex, orderItem) : addToCart(orderItem);
        return Promise.resolve(save).then(() => setEditingIndex(null));
    }, [editingIndex, addToCart, updateCartItem]);

    const handleCustomerSelect = useCallback((customer) => {
        // The customer and its VAT default together - one save in a sale window.
        Promise.resolve(setSelectedCustomer(customer, { VAT_status: defaultVat(customer) })).catch(() => {});
        // A customer just registered in the overlay isn't in the list fetched on load —
        // add them, so searching finds them without reloading the page.
        if (customer?.id) setCustomers(prev => (prev.some(c => c.id === customer.id) ? prev : [...prev, customer]));
    }, [setSelectedCustomer]);

    // Keep the session's tax choice in step with the toggle, so it survives a reload too.
    // Functional update: this runs in the same commit as loadOrder when another order is
    // opened for editing, and spreading the render's `editSession` here wrote the PREVIOUS
    // order's session back over the new one — the cart then held order B while checkout
    // charged against, and saved to, order A.
    useEffect(() => {
        setEditSession(prev => (prev && prev.vat !== enableTax ? { ...prev, vat: enableTax } : prev));
    }, [enableTax, editSession, setEditSession]);

    // Edit mode is "an edit is in progress", not "arrived here from the Edit button": Back
    // from checkout, a reload or a detour through another page must not turn the edited
    // order's lines into a new sale.
    const isEditMode = !!editSession && ['edit', 'back', undefined].includes(location.state?.mode);
    const discardEdit = useCallback(() => {
        if (!window.confirm(`Discard your changes to order #${editSession?.orderNo ?? editSession?.orderId}? Nothing has been saved.`)) return;
        clearCart();
        navigate('/sales', { replace: true });
    }, [editSession, clearCart, navigate]);

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
                                    Edit: #{String(editSession?.orderNo ?? editSession?.orderId ?? '').slice(-6)}
                                </span>
                            )}
                            {isEditMode && (
                                <button data-testid="discard-edit" onClick={discardEdit} style={{
                                    fontSize: '0.65rem', fontWeight: 700, padding: '0.2rem 0.6rem',
                                    background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.3)',
                                    borderRadius: '100px', color: '#f87171', cursor: 'pointer',
                                }}>
                                    ✕ Discard edit
                                </button>
                            )}
                            {linkedRef?.type === 'link' && (
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
                            {linkedRef?.type === 'convert' && (
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
                                    Converting Invoice #{String(linkedRef.id ?? '').slice(-6)}
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

                {/* ── Customer Selection Overlay (sale windows) ── covers the product browser
                    only, never the cart panel: the window tabs must stay usable, so a cashier
                    who opened a window by mistake can switch back or close it without
                    inventing a customer first. */}
                {windowMode && windowsLoaded && !selectedCustomer && (
                    <CustomerSelectionOverlay
                        customers={customers}
                        onSelectCustomer={handleCustomerSelect}
                    />
                )}
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
                {windowMode && <WindowTabs />}
                {windowMode && <WindowExpiryNotice window={activeWindow} />}

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
                        onRemoveItem={(index) => { Promise.resolve(removeFromCart(index)).catch(() => {}); }}
                        onEditItem={handleEditCartItem}
                        customer={selectedCustomer}
                        onChangeCustomer={() => { Promise.resolve(setSelectedCustomer(null)).catch(() => {}); }}
                        enableTax={enableTax}
                        onToggleTax={toggleTax}
                        mode={isEditMode ? 'edit' : undefined}
                        originalTotal={0}
                        actionLabel={isEditMode ? 'Update Order' : 'Checkout'}
                        onAction={isEditMode ? () => {
                            navigate('/checkout', {
                                state: {
                                    cartItems: cart,
                                    fromCart: true,
                                    customer: selectedCustomer,
                                    enableTax,
                                    mode: 'edit',
                                    // amountPaid = what was already collected (used to compute the delta owed)
                                    originalTotal: editSession.originalTotal ?? 0,
                                    // balance = outstanding balance before this edit (shown to the cashier for context)
                                    originalBalance: editSession.originalBalance ?? 0,
                                    discount: editSession.discount ?? 0,
                                    orderVersion: editSession.version ?? null,
                                    orderData: { id: editSession.orderId },
                                },
                            });
                        } : windowMode ? undefined : linkedRef?.type === 'link' ? () => {
                            navigate('/checkout', {
                                state: {
                                    cartItems: cart,
                                    fromCart: true,
                                    customer: selectedCustomer,
                                    enableTax,
                                    parentOrderId: linkedRef.id,
                                },
                            });
                        } : linkedRef?.type === 'convert' ? () => {
                            navigate('/checkout', {
                                state: {
                                    cartItems: cart,
                                    fromCart: true,
                                    customer: selectedCustomer,
                                    enableTax,
                                    sourceInvoiceId: linkedRef.id,
                                    discount: linkedRef.discount ?? 0,
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
                cart={cart}
                cartIndex={editingIndex}
            />

            {/* ── Customer Selection Overlay ── */}
            {!windowMode && !selectedCustomer && (
                <CustomerSelectionOverlay
                    customers={customers}
                    onSelectCustomer={handleCustomerSelect}
                />
            )}
        </div>
    );
}
