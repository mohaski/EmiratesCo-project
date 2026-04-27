import { useState, useEffect, useCallback } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import api from '../services/api';
import ProductCard from '../components/sales/ProductCard';
import ProductModal from '../components/sales/ProductModal';
import CartSidebar from '../components/sales/CartSidebar';
import { useProducts } from '../context/ProductContext';
import { useCart } from '../context/CartContext';
import { useProductFiltering, PROFILE_COLORS } from '../hooks/useProductFiltering';
import CustomerSelectionOverlay from '../components/sales/CustomerSelectionOverlay';

export default function InvoiceGenPage() {
    const { products: PRODUCTS } = useProducts();
    const location = useLocation();
    const navigate = useNavigate();
    const [customers, setCustomers] = useState([]);

    const {
        activeCategory, setActiveCategory,
        activeSubCategory, setActiveSubCategory,
        searchQuery, setSearchQuery,
        profileColor, setProfileColor,
        filteredProducts, currentSubCategories, CATEGORIES, isProfileCategory,
    } = useProductFiltering();

    useEffect(() => {
        api.userService.getCustomers().then(fetched => {
            setCustomers(fetched.map(c => ({ id: c.customerId, name: c.name, phone: c.phoneNumber, type: c.type || 'registered' })));
        }).catch(console.error);
    }, []);

    const [selectedProduct, setSelectedProduct] = useState(null);
    const [modalOpen, setModalOpen] = useState(false);
    const [editingIndex, setEditingIndex] = useState(null);
    const [initialModalDetails, setInitialModalDetails] = useState(null);
    const [isCartOpen, setIsCartOpen] = useState(false);

    const { cartItems: cart, customer: selectedCustomer, setCustomer: setSelectedCustomer, addToCart, updateCartItem, removeFromCart, clearCart, sessionType, setSessionType } = useCart();
    const [enableTax, setEnableTax] = useState(() => location.state?.enableTax !== undefined ? location.state.enableTax : true);

    useEffect(() => {
        if (!location.state?.mode) { clearCart(); setSessionType('invoice'); }
        else if (sessionType !== 'invoice') setSessionType('invoice');
    }, [location.state, clearCart, setSessionType, sessionType]);

    const handleProductClick = useCallback(product => { setSelectedProduct(product); setEditingIndex(null); setInitialModalDetails(null); setModalOpen(true); }, []);
    const handleEditCartItem = useCallback(index => {
        const item = cart[index];
        if (!item) return;
        const orig = PRODUCTS.find(p => p.id === item.id);
        if (orig) setTimeout(() => { setSelectedProduct(orig); setEditingIndex(index); setInitialModalDetails(item.details); setModalOpen(true); setIsCartOpen(true); }, 0);
    }, [cart, PRODUCTS]);
    const handleAddToOrder = useCallback(orderItem => {
        if (editingIndex !== null) { updateCartItem(editingIndex, orderItem); setEditingIndex(null); }
        else addToCart(orderItem);
    }, [editingIndex, addToCart, updateCartItem]);
    const handleRemoveItem = useCallback(index => removeFromCart(index), [removeFromCart]);
    const handleModalClose = useCallback(() => { setModalOpen(false); setEditingIndex(null); setInitialModalDetails(null); }, []);
    const handleReviewInvoice = useCallback(() => navigate('/invoice/review', { state: { enableTax } }), [navigate, enableTax]);
    const handleCustomerSelect = useCallback(customer => {
        setSelectedCustomer(customer);
        setEnableTax(customer?.type !== 'individual');
    }, [setSelectedCustomer]);

    return (
        <div style={{ display: 'flex', height: '100%', width: '100%', overflow: 'hidden', background: 'var(--color-bg)', position: 'relative' }}>

            {/* Main area */}
            <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0, overflow: 'hidden' }}>

                {/* Header */}
                <div style={{
                    height: '72px', display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                    padding: '0 1.5rem', flexShrink: 0,
                    background: 'rgba(9,14,26,0.95)', borderBottom: '1px solid rgba(255,255,255,0.07)',
                    backdropFilter: 'blur(20px)',
                }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
                        <div style={{
                            width: '32px', height: '32px', borderRadius: '8px',
                            background: 'linear-gradient(135deg, rgba(245,158,11,0.2), rgba(234,88,12,0.15))',
                            border: '1px solid rgba(245,158,11,0.3)',
                            display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '0.9rem',
                        }}>📄</div>
                        <div>
                            <h1 style={{ fontSize: '0.9rem', fontWeight: 800, color: '#fbbf24', margin: 0 }}>Invoice Generator</h1>
                            <p style={{ fontSize: '0.62rem', color: '#475569', margin: 0 }}>Create quotations & estimates</p>
                        </div>
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
                        <div style={{ position: 'relative' }}>
                            <span style={{ position: 'absolute', left: '0.75rem', top: '50%', transform: 'translateY(-50%)', color: '#475569', fontSize: '0.875rem' }}>🔍</span>
                            <input type="text" placeholder="Search products..." value={searchQuery} onChange={e => setSearchQuery(e.target.value)}
                                style={{
                                    background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.09)',
                                    borderRadius: '0.625rem', padding: '0.5rem 1rem 0.5rem 2.25rem',
                                    color: '#e2e8f0', fontSize: '0.82rem', outline: 'none', width: '240px',
                                }}
                                onFocus={e => { e.target.style.borderColor = 'rgba(245,158,11,0.4)'; }}
                                onBlur={e => { e.target.style.borderColor = 'rgba(255,255,255,0.09)'; }}
                            />
                        </div>
                        {/* Mobile cart toggle */}
                        <button onClick={() => setIsCartOpen(!isCartOpen)} style={{
                            position: 'relative', padding: '0.5rem 0.75rem', borderRadius: '0.625rem',
                            background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.09)',
                            color: '#94a3b8', cursor: 'pointer', display: 'none',
                        }} className="md:hidden">
                            🛒
                            {cart.length > 0 && <span style={{ position: 'absolute', top: '-4px', right: '-4px', width: '16px', height: '16px', borderRadius: '50%', background: '#f59e0b', color: '#000', fontSize: '0.6rem', fontWeight: 800, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>{cart.length}</span>}
                        </button>
                    </div>
                </div>

                {/* Category tabs */}
                <div style={{ padding: '0.875rem 1.5rem', borderBottom: '1px solid rgba(255,255,255,0.06)', flexShrink: 0, background: 'rgba(9,14,26,0.6)' }}>
                    <div style={{ display: 'flex', gap: '0.5rem', overflowX: 'auto', marginBottom: '0.625rem' }} className="scrollbar-hide">
                        {CATEGORIES.map(cat => (
                            <button key={cat.id} onClick={() => setActiveCategory(cat.id)} style={{
                                display: 'flex', alignItems: 'center', gap: '0.5rem', padding: '0.5rem 1rem',
                                borderRadius: '0.75rem', border: '1px solid', whiteSpace: 'nowrap', cursor: 'pointer',
                                background: activeCategory === cat.id ? 'rgba(245,158,11,0.12)' : 'rgba(255,255,255,0.04)',
                                borderColor: activeCategory === cat.id ? 'rgba(245,158,11,0.35)' : 'rgba(255,255,255,0.08)',
                                color: activeCategory === cat.id ? '#fbbf24' : '#64748b',
                                fontWeight: 700, fontSize: '0.8rem', transition: 'all 0.2s',
                            }}>
                                <span>{cat.icon}</span><span>{cat.label}</span>
                            </button>
                        ))}
                    </div>

                    <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap', alignItems: 'center' }}>
                        {isProfileCategory && (
                            <div style={{ display: 'flex', gap: '0.25rem', background: 'rgba(255,255,255,0.04)', borderRadius: '0.625rem', padding: '3px', border: '1px solid rgba(255,255,255,0.07)', marginRight: '0.5rem' }}>
                                {PROFILE_COLORS.map(color => (
                                    <button key={color.name} onClick={() => setProfileColor(color.name)} style={{
                                        display: 'flex', alignItems: 'center', gap: '0.375rem', padding: '0.25rem 0.625rem',
                                        borderRadius: '5px', border: '1px solid', cursor: 'pointer', transition: 'all 0.15s',
                                        background: profileColor === color.name ? 'rgba(245,158,11,0.1)' : 'transparent',
                                        borderColor: profileColor === color.name ? 'rgba(245,158,11,0.35)' : 'transparent',
                                    }}>
                                        <span style={{ width: '10px', height: '10px', borderRadius: '50%', background: color.hex, border: '1px solid rgba(255,255,255,0.2)', display: 'inline-block', flexShrink: 0 }} />
                                        <span style={{ fontSize: '0.7rem', fontWeight: 600, color: profileColor === color.name ? '#fbbf24' : '#64748b' }}>{color.name}</span>
                                    </button>
                                ))}
                            </div>
                        )}
                        {currentSubCategories.map(sub => (
                            <button key={sub.id} onClick={() => setActiveSubCategory(sub.id)} style={{
                                padding: '0.25rem 0.875rem', borderRadius: '100px', fontSize: '0.72rem', fontWeight: 700, cursor: 'pointer',
                                border: `1px solid ${activeSubCategory === sub.id ? 'rgba(245,158,11,0.35)' : 'rgba(255,255,255,0.08)'}`,
                                background: activeSubCategory === sub.id ? 'rgba(245,158,11,0.12)' : 'transparent',
                                color: activeSubCategory === sub.id ? '#fbbf24' : '#64748b', transition: 'all 0.15s',
                            }}>{sub.label}</button>
                        ))}
                    </div>
                </div>

                {/* Products grid */}
                <div style={{ flex: 1, overflowY: 'auto', padding: '1.25rem 1.5rem' }} className="custom-scrollbar">
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))', gap: '1rem' }}>
                        {filteredProducts.map(product => (
                            <ProductCard key={product.id} product={product} onClick={handleProductClick} selectedColor={profileColor} />
                        ))}
                    </div>
                    {filteredProducts.length === 0 && (
                        <div style={{ textAlign: 'center', padding: '4rem 0', color: '#334155' }}>
                            <div style={{ fontSize: '3rem', opacity: 0.3, marginBottom: '0.75rem' }}>🔍</div>
                            <p style={{ fontWeight: 500, fontSize: '0.875rem' }}>No products match your search</p>
                        </div>
                    )}
                </div>
            </div>

            {/* Cart sidebar */}
            <div style={{ width: '360px', flexShrink: 0 }}>
                <CartSidebar cartItems={cart} onRemoveItem={handleRemoveItem} onEditItem={handleEditCartItem}
                    customer={selectedCustomer} onChangeCustomer={() => setSelectedCustomer(null)}
                    actionLabel="Review Invoice" onAction={handleReviewInvoice}
                    enableTax={enableTax} onToggleTax={setEnableTax} />
            </div>

            {/* Product modal */}
            <ProductModal product={selectedProduct} isOpen={modalOpen} onClose={handleModalClose} onAddToOrder={handleAddToOrder}
                color={initialModalDetails?.color || profileColor} initialDetails={initialModalDetails} source="invoice" />

            {/* Customer overlay */}
            {!selectedCustomer && <CustomerSelectionOverlay customers={customers} onSelectCustomer={handleCustomerSelect} />}
        </div>
    );
}
