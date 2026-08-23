import { useState, useMemo, useEffect, useCallback } from 'react';
import { useProducts } from '../context/ProductContext';
import { useAuth } from '../context/AuthContext';
import { useToast } from '../context/ToastContext';
import api from '../services/api';
import AddStockModal from '../components/inventory/AddStockModal';
import AddOffcutsModal from '../components/inventory/AddOffcutsModal';
import StockSessionDetailModal from '../components/inventory/StockSessionDetailModal';
import { getCategoryAccent, hexToRgba } from '../utils/colors';

const PROFILE_COLORS = ['White', 'Silver', 'Gold', 'Brown', 'Grey', 'Matt Black'];
const GLASS_THICKNESSES = ['4mm', '6mm', '8mm', '10mm', '12mm'];

function useWindowWidth() {
    const [width, setWidth] = useState(() =>
        typeof window !== 'undefined' ? window.innerWidth : 1280
    );
    useEffect(() => {
        const handler = () => setWidth(window.innerWidth);
        window.addEventListener('resize', handler, { passive: true });
        return () => window.removeEventListener('resize', handler);
    }, []);
    return width;
}

export default function InventoryPage() {
    const { products, categories: CATEGORIES } = useProducts();
    const { user } = useAuth();
    const windowWidth = useWindowWidth();
    const isMobile = windowWidth < 768;
    const showToast = useToast();
    const [searchTerm, setSearchTerm] = useState('');
    const [filterCategory, setFilterCategory] = useState('ke-profile');
    const [filterSubCategory, setFilterSubCategory] = useState('window');
    const [inventory, setInventory] = useState([]);
    const [cartItems, setCartItems] = useState([]);
    const [finalizing, setFinalizing] = useState(false);
    const [isAddStockModalOpen, setAddStockModalOpen] = useState(false);
    const [selectedProduct, setSelectedProduct] = useState(null);
    const [selectedVariant, setSelectedVariant] = useState('');
    const [stockToAdd, setStockToAdd] = useState('');
    // 'box' | 'pcs' — only meaningful for a packaged (count-tracked) accessory
    // variant, i.e. one with unitQuantity > 1 (see packagedFactor below).
    const [restockUnit, setRestockUnit] = useState('box');
    const [offcutsProduct, setOffcutsProduct] = useState(null);

    const canViewHistory = user?.role === 'ceo' || user?.role === 'admin';
    const canSubmitStock = user?.role === 'cashier' || user?.role === 'manager';
    // Offcuts is a manager-only action server-side (products/service.py's
    // add_offcuts_bulk requires manager/ceo/admin) — cashier can restock but not this.
    const canAddOffcuts = user?.role === 'manager';
    // CEO oversight: show every product's per-variant stock, not just the aggregate total.
    const canViewVariantBreakdown = user?.role === 'ceo';
    const canViewSessions = user?.role === 'ceo' || user?.role === 'manager';
    const [sidebarTab, setSidebarTab] = useState(canSubmitStock ? 'recent' : 'sessions');
    const [restockHistory, setRestockHistory] = useState([]);
    const [historyLoading, setHistoryLoading] = useState(false);
    const [sessions, setSessions] = useState([]);
    const [sessionsLoading, setSessionsLoading] = useState(false);
    const [openSession, setOpenSession] = useState(null);

    const loadHistory = useCallback(async () => {
        setHistoryLoading(true);
        try {
            const data = await api.productService.getRestockHistory();
            setRestockHistory(data);
        } catch { /* silently fail */ }
        finally { setHistoryLoading(false); }
    }, []);

    const loadSessions = useCallback(async () => {
        setSessionsLoading(true);
        try {
            const data = await api.stockSessionService.list();
            setSessions(data);
        } catch { /* silently fail */ }
        finally { setSessionsLoading(false); }
    }, []);

    useEffect(() => {
        if (sidebarTab === 'history' && canViewHistory) loadHistory();
        if (sidebarTab === 'sessions' && canViewSessions) loadSessions();
    }, [sidebarTab, canViewHistory, canViewSessions, loadHistory, loadSessions]);

    const openSessionDetail = async (sessionId) => {
        try {
            const data = await api.stockSessionService.getById(sessionId);
            setOpenSession(data);
        } catch { /* toast handled globally by the api interceptor */ }
    };

    useEffect(() => {
        setInventory(products.map(p => {
            if (p.variants?.length > 0) {
                const stockMap = {};
                // Per-variant low-stock alarm state (see Variant.low_stock_threshold) — kept
                // as a side map, not merged into stockMap's values, so every existing
                // consumer of stockVariants (AddStockModal, getTotalStock) keeps working
                // against plain numbers unchanged.
                const alarmMap = {};
                p.variants.forEach(v => {
                    // A packaged (count-tracked) variant's `stock` is tracked in individual
                    // pieces server-side (see server/entities/variants.py) — display/restock
                    // here in the variant's own pack unit (e.g. boxes) instead, matching what
                    // a manager actually thinks in. Bar/sheet (trackOffcuts) variants and
                    // unpackaged ones are already in their own natural unit (factor 1).
                    const factor = !p.trackOffcuts && v.unitQuantity ? v.unitQuantity : 1;
                    const label = v.name || Object.values(v.attributes).join(' - ');
                    stockMap[label] = (v.stock || 0) / factor;
                    // Out-of-stock always alerts, even with no CEO-configured threshold (0 = unset);
                    // a configured threshold (>0) additionally alerts earlier, before hitting zero.
                    alarmMap[label] = (v.stock || 0) <= 0 || ((v.lowStockThreshold || 0) > 0 && (v.stock || 0) < v.lowStockThreshold);
                });
                return { ...p, stockVariants: stockMap, stockVariantAlarms: alarmMap };
            }
            const variants = {};
            if (p.category === 'glass') {
                (p.thicknessPrices ? p.thicknessPrices.map(t => t.thickness) : GLASS_THICKNESSES).forEach(t => { variants[t] = 50; });
            } else if (p.category?.includes('profile')) {
                PROFILE_COLORS.forEach(c => { variants[c] = 50; });
            } else { variants['Standard'] = 50; }
            return { ...p, stockVariants: variants, stockVariantAlarms: {} };
        }));
    }, [products]);

    const filteredInventory = useMemo(() => inventory.filter(item => {
        const matchesSearch = item.name.toLowerCase().includes(searchTerm.toLowerCase());
        const matchesCategory = item.category === filterCategory;
        const matchesSub = matchesCategory ? item.subCategory === filterSubCategory : true;
        return matchesSearch && matchesCategory && matchesSub;
    }), [inventory, searchTerm, filterCategory, filterSubCategory]);

    const handleCategoryChange = (catId) => {
        setFilterCategory(catId);
        const subCats = CATEGORIES.find(c => c.id === catId)?.subCategories || [];
        setFilterSubCategory(subCats.length > 0 ? subCats[0].id : 'general');
    };

    // The raw (non-inventory-mapped) variant behind the modal's current selection —
    // needed for unitQuantity, which stockVariants already divided out for display.
    const selectedRawVariant = useMemo(() => {
        if (!selectedProduct || !selectedVariant) return null;
        const original = products.find(p => p.id === selectedProduct.id);
        return original?.variants?.find(v => (v.name || Object.values(v.attributes).join(' - ')) === selectedVariant) || null;
    }, [products, selectedProduct, selectedVariant]);
    // How many pieces make up one of this variant's own pack units (e.g. 500 for
    // "500pcs") — 1 for an unpackaged variant or a bar/sheet (trackOffcuts) product,
    // matching the same rule the inventory mapping above and addLineToCart use.
    const packagedFactor = !selectedProduct?.trackOffcuts && selectedRawVariant?.unitQuantity ? selectedRawVariant.unitQuantity : 1;
    const canAddPcs = packagedFactor > 1;
    const effectiveRestockUnit = canAddPcs ? restockUnit : 'box';

    const handleAddStockClick = (product) => {
        setSelectedProduct(product);
        setSelectedVariant(Object.keys(product.stockVariants)[0]);
        setStockToAdd('');
        setRestockUnit('box');
        setAddStockModalOpen(true);
    };

    // Adds a line to the local cart only — nothing is written to the DB until
    // "Finalize Session" is clicked (see finalizeSession below), which commits
    // every line in one server-side transaction via POST /stock-sessions/.
    const addLineToCart = () => {
        if (!selectedProduct || !stockToAdd || !selectedVariant) return;
        const qty = parseInt(stockToAdd);
        if (isNaN(qty) || qty <= 0) return;
        const original = products.find(p => p.id === selectedProduct.id);
        if (!original?.variants) return;
        const targetVariant = original.variants.find(v => (v.name || Object.values(v.attributes).join(' - ')) === selectedVariant);
        if (targetVariant) {
            // `qty` was typed either in the variant's own pack unit (box mode — the
            // stockVariants mapping above) or directly in pieces (pcs mode, e.g. a
            // loose delivery that doesn't fill a whole box) — the conversion factor
            // to pieces is captured now and sent alongside, since stock_quantity is
            // tracked in pieces server-side.
            const boxFactor = !original.trackOffcuts && targetVariant.unitQuantity ? targetVariant.unitQuantity : 1;
            const unit = boxFactor > 1 && restockUnit === 'pcs' ? 'pcs' : 'box';
            const factor = unit === 'pcs' ? 1 : boxFactor;
            const enteredUnit = unit === 'pcs' ? 'pcs' : (boxFactor > 1 ? selectedVariant : null);
            setCartItems(prev => [{
                id: Date.now(),
                type: 'stock',
                productId: original.id,
                variantId: targetVariant.id,
                productName: selectedProduct.name,
                variantLabel: selectedVariant,
                enteredQuantity: qty,
                enteredUnit,
                factor,
                time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
            }, ...prev]);
            setAddStockModalOpen(false);
        }
    };

    const removeCartLine = (id) => setCartItems(prev => prev.filter(item => item.id !== id));

    const finalizeSession = async () => {
        if (cartItems.length === 0 || finalizing) return;
        setFinalizing(true);
        try {
            const stockLines = cartItems.filter(item => item.type === 'stock').map(item => ({
                product_id: item.productId,
                variant_id: item.variantId,
                entered_quantity: item.enteredQuantity,
                entered_unit: item.enteredUnit,
                conversion_factor: item.factor,
            }));
            const offcutLines = cartItems.filter(item => item.type === 'offcut').map(item => ({
                product_id: item.productId,
                variant_id: item.variantId,
                length: item.length,
                width: item.width,
                height: item.height,
                quantity: item.quantity,
            }));
            await api.stockSessionService.finalize({ stock_lines: stockLines, offcut_lines: offcutLines });
            setCartItems([]);
            showToast('Stock session finalized', 'success');
        } catch {
            // toast already shown by the api interceptor
        } finally {
            setFinalizing(false);
        }
    };

    const getTotalStock = (item) => !item.stockVariants ? 0 : Object.values(item.stockVariants).reduce((a, b) => a + b, 0);

    // Offcuts are added to the same cart as restock lines instead of committing
    // immediately — see finalizeSession, which sends both stock_lines and
    // offcut_lines to POST /stock-sessions/ in one transaction.
    const handleSubmitOffcuts = (rows) => {
        const product = offcutsProduct;
        const time = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
        const newLines = rows.map((row, idx) => {
            const variant = product.variants?.find(v => v.id === row.variantId);
            return {
                id: `${Date.now()}-${idx}`,
                type: 'offcut',
                productId: product.id,
                variantId: row.variantId ?? null,
                productName: product.name,
                variantLabel: variant ? (variant.name || Object.values(variant.attributes || {}).join(' - ')) : null,
                length: row.length,
                width: row.width,
                height: row.height,
                quantity: row.quantity,
                time,
            };
        });
        setCartItems(prev => [...newLines, ...prev]);
        showToast(`${rows.length} offcut${rows.length > 1 ? 's' : ''} added to cart`, 'success');
    };

    return (
        <div style={{ display: 'flex', flexDirection: 'column', height: '100%', background: 'var(--color-bg)', overflow: 'hidden' }}>

            {/* Header */}
            <header style={{
                padding: 'clamp(1rem, 4vw, 1.25rem) clamp(1rem, 5vw, 2rem)', borderBottom: '1px solid rgba(255,255,255,0.07)',
                background: 'rgba(9,14,26,0.9)', backdropFilter: 'blur(20px)',
                display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexShrink: 0, flexWrap: 'wrap', gap: '0.75rem',
                position: 'sticky', top: 0, zIndex: 20,
            }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
                    <div style={{
                        width: '40px', height: '40px', borderRadius: '10px',
                        background: 'linear-gradient(135deg, rgba(59,130,246,0.2), rgba(6,182,212,0.15))',
                        border: '1px solid rgba(59,130,246,0.3)',
                        display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '1.1rem',
                    }}>📦</div>
                    <div>
                        <h1 style={{ fontSize: '1.125rem', fontWeight: 800, color: '#f1f5f9', margin: 0 }}>Stock Control</h1>
                        <p style={{ fontSize: '0.72rem', color: '#475569', margin: 0, fontWeight: 500 }}>Manage inventory & restock items</p>
                    </div>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: '1.25rem' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                        <div style={{ width: '8px', height: '8px', borderRadius: '50%', background: '#22c55e', boxShadow: '0 0 8px rgba(34,197,94,0.7)' }} />
                        <span style={{ fontSize: '0.72rem', color: '#475569', fontWeight: 600 }}>System Online</span>
                    </div>
                    <div style={{ width: '1px', height: '16px', background: 'rgba(255,255,255,0.08)' }} />
                    <span style={{ fontSize: '0.72rem', color: '#475569' }}>
                        Cart: <span style={{ color: '#f1f5f9', fontWeight: 700 }}>{cartItems.length}</span>
                    </span>
                </div>
            </header>

            <div style={{ flex: 1, display: 'flex', flexDirection: isMobile ? 'column' : 'row', overflow: 'hidden' }}>
                {/* Main content */}
                <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden', minHeight: isMobile ? '220px' : 'auto' }}>
                    {/* Filters */}
                    <div style={{ padding: 'clamp(1rem, 4vw, 1.25rem) clamp(1rem, 5vw, 2rem) 0.75rem', flexShrink: 0, borderBottom: '1px solid rgba(255,255,255,0.05)' }}>
                        {/* Category tabs */}
                        <div style={{ display: 'flex', gap: '4px', background: 'rgba(255,255,255,0.04)', borderRadius: '0.75rem', padding: '4px', width: 'fit-content', maxWidth: '100%', overflowX: 'auto', marginBottom: '0.75rem' }} className="scrollbar-hide">
                            {CATEGORIES.map(cat => (
                                <button key={cat.id} onClick={() => handleCategoryChange(cat.id)} style={{
                                    padding: '0.5rem 1.25rem', borderRadius: '0.5rem', border: 'none', cursor: 'pointer', whiteSpace: 'nowrap', flexShrink: 0,
                                    background: filterCategory === cat.id ? 'linear-gradient(135deg, #3b82f6, #06b6d4)' : 'transparent',
                                    color: filterCategory === cat.id ? '#fff' : '#64748b',
                                    fontWeight: 700, fontSize: '0.8rem', transition: 'all 0.2s',
                                }}>{cat.label}</button>
                            ))}
                        </div>

                        {/* Sub-category chips */}
                        {CATEGORIES.find(c => c.id === filterCategory)?.subCategories?.length > 0 && (
                            <div style={{ display: 'flex', gap: '0.375rem', flexWrap: 'wrap', marginBottom: '0.75rem' }}>
                                {CATEGORIES.find(c => c.id === filterCategory).subCategories.map(sub => (
                                    <button key={sub.id} onClick={() => setFilterSubCategory(sub.id)} style={{
                                        padding: '0.25rem 0.875rem', borderRadius: '100px', border: '1px solid', cursor: 'pointer',
                                        borderColor: filterSubCategory === sub.id ? 'rgba(59,130,246,0.4)' : 'rgba(255,255,255,0.08)',
                                        background: filterSubCategory === sub.id ? 'rgba(59,130,246,0.12)' : 'transparent',
                                        color: filterSubCategory === sub.id ? '#60a5fa' : '#64748b',
                                        fontWeight: 600, fontSize: '0.72rem', transition: 'all 0.15s',
                                    }}>{sub.label}</button>
                                ))}
                            </div>
                        )}

                        {/* Search */}
                        <div style={{ position: 'relative' }}>
                            <span style={{ position: 'absolute', left: '1rem', top: '50%', transform: 'translateY(-50%)', color: '#475569' }}>🔍</span>
                            <input type="text" placeholder="Search by name or item code..."
                                style={{
                                    width: '100%', background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.09)',
                                    borderRadius: '0.75rem', padding: '0.75rem 1rem 0.75rem 2.5rem',
                                    color: '#e2e8f0', fontSize: '0.875rem', outline: 'none', transition: 'border-color 0.2s', boxSizing: 'border-box',
                                }}
                                value={searchTerm} onChange={e => setSearchTerm(e.target.value)}
                                onFocus={e => { e.target.style.borderColor = 'rgba(59,130,246,0.4)'; }}
                                onBlur={e => { e.target.style.borderColor = 'rgba(255,255,255,0.09)'; }}
                            />
                        </div>
                    </div>

                    {/* Product list */}
                    <div style={{ flex: 1, overflowY: 'auto', padding: '1rem clamp(1rem, 5vw, 2rem)' }} className="custom-scrollbar">
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.625rem' }}>
                            {filteredInventory.map(item => {
                                const total = getTotalStock(item);
                                const showBreakdown = canViewVariantBreakdown && item.stockVariants && Object.keys(item.stockVariants).length > 0;
                                const accent = getCategoryAccent(item.category);
                                const initial = item.name?.trim()?.[0]?.toUpperCase() || '?';
                                return (
                                    <div key={item.id} style={{
                                        display: 'flex', flexDirection: 'column', gap: '0.75rem',
                                        padding: '1rem 1.25rem',
                                        background: 'linear-gradient(135deg, rgba(255,255,255,0.05), rgba(255,255,255,0.02))',
                                        border: '1px solid rgba(255,255,255,0.08)',
                                        borderRadius: '0.875rem', transition: 'all 0.2s',
                                    }}
                                    onMouseEnter={e => { e.currentTarget.style.borderColor = 'rgba(59,130,246,0.25)'; e.currentTarget.style.background = 'linear-gradient(135deg, rgba(255,255,255,0.07), rgba(255,255,255,0.03))'; }}
                                    onMouseLeave={e => { e.currentTarget.style.borderColor = 'rgba(255,255,255,0.08)'; e.currentTarget.style.background = 'linear-gradient(135deg, rgba(255,255,255,0.05), rgba(255,255,255,0.02))'; }}
                                    >
                                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '1rem', flexWrap: 'wrap' }}>
                                        <div style={{ display: 'flex', alignItems: 'center', gap: '1rem', flex: '1 1 200px', minWidth: 0 }}>
                                            <div className="product-tile" style={{ width: '52px', height: '52px', flexShrink: 0, borderRadius: '10px', background: hexToRgba(accent, 0.1), border: `1px solid ${hexToRgba(accent, 0.25)}`, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                                                <span style={{ position: 'relative', zIndex: 1, fontSize: '1.1rem', fontWeight: 800, color: accent }}>{initial}</span>
                                            </div>
                                            <div style={{ minWidth: 0 }}>
                                                <h3 style={{ fontSize: '0.9rem', fontWeight: 800, color: '#e2e8f0', margin: '0 0 0.25rem', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{item.name}</h3>
                                                <div style={{ display: 'flex', gap: '0.375rem', flexWrap: 'wrap', alignItems: 'center' }}>
                                                    <span style={{ fontSize: '0.65rem', fontWeight: 700, background: 'rgba(255,255,255,0.07)', border: '1px solid rgba(255,255,255,0.1)', color: '#64748b', borderRadius: '4px', padding: '1px 7px', textTransform: 'uppercase', letterSpacing: '0.06em' }}>
                                                        {CATEGORIES.find(c => c.id === item.category)?.label}
                                                    </span>
                                                    {item.itemCode && (
                                                        <span style={{ fontSize: '0.65rem', fontWeight: 700, background: 'rgba(59,130,246,0.1)', border: '1px solid rgba(59,130,246,0.2)', color: '#60a5fa', borderRadius: '4px', padding: '1px 7px', fontFamily: 'var(--font-mono)', textTransform: 'uppercase' }}>
                                                            {item.itemCode}
                                                        </span>
                                                    )}
                                                </div>
                                            </div>
                                        </div>

                                        <div style={{ display: 'flex', alignItems: 'center', gap: '1.5rem', flexWrap: 'wrap' }}>
                                            <div style={{ textAlign: 'right' }}>
                                                <div style={{ fontSize: '0.62rem', fontWeight: 700, color: '#475569', letterSpacing: '0.08em', textTransform: 'uppercase', marginBottom: '2px' }}>Total Stock</div>
                                                <div style={{ fontSize: '1.5rem', fontWeight: 900, color: '#f1f5f9', fontFamily: 'var(--font-mono)', letterSpacing: '-0.02em' }}>{total}</div>
                                            </div>
                                            {canAddOffcuts && item.trackOffcuts && item.variants?.length > 0 && (
                                                <button onClick={() => setOffcutsProduct(item)} style={{
                                                    padding: '0.625rem 1.125rem', borderRadius: '0.75rem', border: '1px solid rgba(6,182,212,0.3)', cursor: 'pointer',
                                                    background: 'rgba(6,182,212,0.1)',
                                                    color: '#22d3ee', fontWeight: 800, fontSize: '0.8rem', transition: 'all 0.2s',
                                                }}
                                                onMouseEnter={e => { e.currentTarget.style.background = 'rgba(6,182,212,0.18)'; }}
                                                onMouseLeave={e => { e.currentTarget.style.background = 'rgba(6,182,212,0.1)'; }}
                                                >✂️ Add Offcuts</button>
                                            )}
                                            {canSubmitStock && (
                                                <button onClick={() => handleAddStockClick(item)} style={{
                                                    padding: '0.625rem 1.25rem', borderRadius: '0.75rem', border: 'none', cursor: 'pointer',
                                                    background: 'linear-gradient(135deg, #3b82f6, #06b6d4)',
                                                    color: '#fff', fontWeight: 800, fontSize: '0.8rem',
                                                    boxShadow: '0 4px 16px rgba(59,130,246,0.3)', transition: 'all 0.2s',
                                                }}
                                                onMouseEnter={e => { e.currentTarget.style.transform = 'translateY(-1px)'; e.currentTarget.style.boxShadow = '0 6px 20px rgba(59,130,246,0.4)'; }}
                                                onMouseLeave={e => { e.currentTarget.style.transform = 'translateY(0)'; e.currentTarget.style.boxShadow = '0 4px 16px rgba(59,130,246,0.3)'; }}
                                                >+ Restock</button>
                                            )}
                                        </div>
                                    </div>
                                    {showBreakdown && (
                                        <div style={{ display: 'flex', gap: '0.375rem', flexWrap: 'wrap', paddingLeft: '0.125rem' }}>
                                            {Object.entries(item.stockVariants).map(([variantLabel, qty]) => {
                                                const isLow = !!item.stockVariantAlarms?.[variantLabel];
                                                return (
                                                    <span key={variantLabel} style={{
                                                        fontSize: '0.68rem', fontWeight: 600, color: isLow ? '#f87171' : '#94a3b8',
                                                        background: isLow ? 'rgba(239,68,68,0.1)' : 'rgba(255,255,255,0.04)',
                                                        border: `1px solid ${isLow ? 'rgba(239,68,68,0.3)' : 'rgba(255,255,255,0.08)'}`,
                                                        borderRadius: '100px', padding: '2px 9px',
                                                        animation: isLow ? 'pulse 1.5s ease-in-out infinite' : 'none',
                                                    }}>
                                                        {isLow && '⚠ '}{variantLabel}: <span style={{ color: isLow ? '#fca5a5' : '#e2e8f0', fontWeight: 700, fontFamily: 'var(--font-mono)' }}>{qty}</span>
                                                    </span>
                                                );
                                            })}
                                        </div>
                                    )}
                                    </div>
                                );
                            })}
                            {filteredInventory.length === 0 && (
                                <div style={{ textAlign: 'center', padding: '4rem 0' }}>
                                    <div style={{ fontSize: '3rem', marginBottom: '0.75rem', opacity: 0.3 }}>📭</div>
                                    <p style={{ color: '#334155', fontWeight: 500, fontSize: '0.875rem' }}>No products match the current filters</p>
                                </div>
                            )}
                        </div>
                    </div>
                </div>

                {/* Right sidebar */}
                <div style={{
                    width: isMobile ? '100%' : '300px', flexShrink: 0,
                    borderLeft: isMobile ? 'none' : '1px solid rgba(255,255,255,0.07)',
                    borderTop: isMobile ? '1px solid rgba(255,255,255,0.07)' : 'none',
                    background: 'rgba(0,0,0,0.2)',
                    display: 'flex', flexDirection: 'column',
                    padding: '1.25rem',
                    maxHeight: isMobile ? '48vh' : 'none',
                }}>
                    {/* Tab toggle */}
                    <div style={{ display: 'flex', gap: '4px', background: 'rgba(255,255,255,0.04)', borderRadius: '0.625rem', padding: '3px', marginBottom: '1rem' }}>
                        {canSubmitStock && (
                            <button onClick={() => setSidebarTab('recent')} style={{
                                flex: 1, padding: '0.375rem 0', borderRadius: '0.4rem', border: 'none', cursor: 'pointer',
                                background: sidebarTab === 'recent' ? 'rgba(255,255,255,0.09)' : 'transparent',
                                color: sidebarTab === 'recent' ? '#e2e8f0' : '#475569',
                                fontWeight: 700, fontSize: '0.72rem', transition: 'all 0.15s',
                            }}>This Session</button>
                        )}
                        {canViewSessions && (
                            <button onClick={() => setSidebarTab('sessions')} style={{
                                flex: 1, padding: '0.375rem 0', borderRadius: '0.4rem', border: 'none', cursor: 'pointer',
                                background: sidebarTab === 'sessions' ? 'rgba(59,130,246,0.15)' : 'transparent',
                                color: sidebarTab === 'sessions' ? '#60a5fa' : '#475569',
                                fontWeight: 700, fontSize: '0.72rem', transition: 'all 0.15s',
                            }}>Stock Sessions</button>
                        )}
                        {canViewHistory && (
                            <button onClick={() => setSidebarTab('history')} style={{
                                flex: 1, padding: '0.375rem 0', borderRadius: '0.4rem', border: 'none', cursor: 'pointer',
                                background: sidebarTab === 'history' ? 'rgba(59,130,246,0.15)' : 'transparent',
                                color: sidebarTab === 'history' ? '#60a5fa' : '#475569',
                                fontWeight: 700, fontSize: '0.72rem', transition: 'all 0.15s',
                            }}>Restock Audit</button>
                        )}
                    </div>

                    {sidebarTab === 'recent' ? (
                        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
                            <div style={{ flex: 1, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '0.5rem' }} className="custom-scrollbar">
                                {cartItems.length === 0 ? (
                                    <p style={{ fontSize: '0.78rem', color: '#334155', textAlign: 'center', marginTop: '2rem', fontStyle: 'italic' }}>No lines added yet</p>
                                ) : cartItems.map(item => (
                                    <div key={item.id} style={{
                                        padding: '0.75rem', borderRadius: '0.625rem',
                                        background: item.type === 'offcut' ? 'rgba(6,182,212,0.07)' : 'rgba(34,197,94,0.07)',
                                        border: `1px solid ${item.type === 'offcut' ? 'rgba(6,182,212,0.15)' : 'rgba(34,197,94,0.15)'}`,
                                    }}>
                                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.25rem' }}>
                                            <span style={{ fontSize: '0.65rem', color: '#475569', fontFamily: 'var(--font-mono)' }}>{item.time}</span>
                                            <div style={{ display: 'flex', alignItems: 'center', gap: '0.375rem' }}>
                                                <span style={{
                                                    fontSize: '0.65rem', fontWeight: 700, borderRadius: '100px', padding: '1px 6px',
                                                    color: item.type === 'offcut' ? '#22d3ee' : '#4ade80',
                                                    background: item.type === 'offcut' ? 'rgba(6,182,212,0.1)' : 'rgba(34,197,94,0.1)',
                                                }}>{item.type === 'offcut' ? '✂ Offcut' : '+In'}</span>
                                                <button onClick={() => removeCartLine(item.id)} title="Remove" style={{
                                                    background: 'none', border: 'none', cursor: 'pointer', color: '#64748b', fontSize: '0.72rem',
                                                }}>✕</button>
                                            </div>
                                        </div>
                                        <div style={{ fontSize: '0.78rem', fontWeight: 700, color: '#e2e8f0', marginBottom: '2px' }}>
                                            {item.productName}{item.variantLabel ? ` (${item.variantLabel})` : ''}
                                        </div>
                                        {item.type === 'offcut' ? (
                                            <div style={{ fontSize: '0.7rem', color: '#64748b' }}>
                                                {item.width != null
                                                    ? <>{item.width}×{item.height}mm</>
                                                    : <>{item.length} length</>} · qty <span style={{ color: '#f1f5f9', fontWeight: 700 }}>{item.quantity}</span>
                                            </div>
                                        ) : (
                                            <div style={{ fontSize: '0.7rem', color: '#64748b' }}>Add <span style={{ color: '#f1f5f9', fontWeight: 700 }}>{item.enteredQuantity}</span> {item.enteredUnit || 'units'}</div>
                                        )}
                                    </div>
                                ))}
                            </div>
                            <button onClick={finalizeSession} disabled={cartItems.length === 0 || finalizing} style={{
                                marginTop: '0.875rem', padding: '0.75rem', borderRadius: '0.75rem', border: 'none', flexShrink: 0,
                                cursor: cartItems.length === 0 || finalizing ? 'not-allowed' : 'pointer',
                                background: cartItems.length === 0 || finalizing ? 'rgba(255,255,255,0.06)' : 'linear-gradient(135deg, #3b82f6, #06b6d4)',
                                color: cartItems.length === 0 || finalizing ? '#334155' : '#fff',
                                fontWeight: 800, fontSize: '0.8rem', transition: 'all 0.2s',
                            }}>{finalizing ? 'Finalizing…' : `Finalize Session ${cartItems.length > 0 ? `(${cartItems.length})` : ''}`}</button>
                        </div>
                    ) : sidebarTab === 'sessions' ? (
                        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: '0.5rem', overflow: 'hidden' }}>
                            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '0.25rem' }}>
                                <span style={{ fontSize: '0.65rem', color: '#475569', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.08em' }}>
                                    {sessions.length} sessions
                                </span>
                                <button onClick={loadSessions} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#475569', fontSize: '0.72rem', fontWeight: 600 }}>
                                    Refresh
                                </button>
                            </div>

                            {sessionsLoading ? (
                                <p style={{ fontSize: '0.78rem', color: '#334155', textAlign: 'center', marginTop: '2rem' }}>Loading...</p>
                            ) : sessions.length === 0 ? (
                                <p style={{ fontSize: '0.78rem', color: '#334155', textAlign: 'center', marginTop: '2rem', fontStyle: 'italic' }}>No stock sessions yet</p>
                            ) : (
                                <div style={{ flex: 1, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '0.5rem' }} className="custom-scrollbar">
                                    {sessions.map(s => {
                                        const date = new Date(s.created_at);
                                        return (
                                            <button key={s.id} onClick={() => openSessionDetail(s.id)} style={{
                                                textAlign: 'left', padding: '0.75rem', borderRadius: '0.625rem', cursor: 'pointer',
                                                background: 'rgba(59,130,246,0.06)', border: '1px solid rgba(59,130,246,0.15)',
                                            }}>
                                                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '0.25rem' }}>
                                                    <span style={{ fontSize: '0.78rem', fontWeight: 800, color: '#e2e8f0' }}>Session #{s.id}</span>
                                                    <span style={{
                                                        fontSize: '0.68rem', fontWeight: 800, color: '#60a5fa',
                                                        background: 'rgba(59,130,246,0.1)', borderRadius: '100px', padding: '1px 7px',
                                                    }}>{s.item_count} line{s.item_count === 1 ? '' : 's'}</span>
                                                </div>
                                                <div style={{ fontSize: '0.65rem', color: '#64748b', display: 'flex', justifyContent: 'space-between' }}>
                                                    <span>{s.created_by}</span>
                                                    <span style={{ fontFamily: 'var(--font-mono)' }}>{date.toLocaleDateString()} {date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
                                                </div>
                                            </button>
                                        );
                                    })}
                                </div>
                            )}
                        </div>
                    ) : (
                        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: '0.5rem', overflow: 'hidden' }}>
                            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '0.25rem' }}>
                                <span style={{ fontSize: '0.65rem', color: '#475569', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.08em' }}>
                                    {restockHistory.length} entries
                                </span>
                                <button onClick={loadHistory} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#475569', fontSize: '0.72rem', fontWeight: 600 }}>
                                    Refresh
                                </button>
                            </div>

                            {historyLoading ? (
                                <p style={{ fontSize: '0.78rem', color: '#334155', textAlign: 'center', marginTop: '2rem' }}>Loading...</p>
                            ) : restockHistory.length === 0 ? (
                                <p style={{ fontSize: '0.78rem', color: '#334155', textAlign: 'center', marginTop: '2rem', fontStyle: 'italic' }}>No restock records yet</p>
                            ) : (
                                <div style={{ flex: 1, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '0.5rem' }} className="custom-scrollbar">
                                    {restockHistory.map(h => {
                                        const isAdd = h.qty_added > 0;
                                        const date = new Date(h.added_at);
                                        return (
                                            <div key={h.id} style={{
                                                padding: '0.75rem', borderRadius: '0.625rem',
                                                background: isAdd ? 'rgba(34,197,94,0.06)' : 'rgba(239,68,68,0.06)',
                                                border: `1px solid ${isAdd ? 'rgba(34,197,94,0.15)' : 'rgba(239,68,68,0.15)'}`,
                                            }}>
                                                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '0.375rem' }}>
                                                    <span style={{ fontSize: '0.78rem', fontWeight: 800, color: '#e2e8f0', flex: 1, marginRight: '0.5rem', lineHeight: 1.3 }}>
                                                        {h.product_name}{h.variant_name ? ` · ${h.variant_name}` : ''}
                                                    </span>
                                                    <span style={{
                                                        fontSize: '0.72rem', fontWeight: 800, flexShrink: 0,
                                                        color: isAdd ? '#4ade80' : '#f87171',
                                                        background: isAdd ? 'rgba(34,197,94,0.1)' : 'rgba(239,68,68,0.1)',
                                                        borderRadius: '100px', padding: '1px 7px',
                                                    }}>
                                                        {isAdd ? '+' : ''}{h.qty_added}
                                                    </span>
                                                </div>
                                                <div style={{ fontSize: '0.65rem', color: '#64748b', display: 'flex', justifyContent: 'space-between' }}>
                                                    <span>{h.stock_before} → {h.stock_after}</span>
                                                    <span style={{ color: '#475569' }}>{h.added_by}</span>
                                                </div>
                                                <div style={{ fontSize: '0.62rem', color: '#334155', marginTop: '0.25rem', fontFamily: 'var(--font-mono)' }}>
                                                    {date.toLocaleDateString()} {date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                                                </div>
                                            </div>
                                        );
                                    })}
                                </div>
                            )}
                        </div>
                    )}
                </div>
            </div>

            <AddStockModal
                isOpen={isAddStockModalOpen} onClose={() => setAddStockModalOpen(false)}
                product={selectedProduct} selectedVariant={selectedVariant}
                onVariantSelect={v => { setSelectedVariant(v); setRestockUnit('box'); }} stockToAdd={stockToAdd}
                onStockChange={setStockToAdd} onConfirm={addLineToCart}
                canAddPcs={canAddPcs} restockUnit={effectiveRestockUnit}
                onUnitChange={u => { setRestockUnit(u); setStockToAdd(''); }}
                packagedFactor={packagedFactor}
            />
            <AddOffcutsModal
                isOpen={!!offcutsProduct} onClose={() => setOffcutsProduct(null)}
                product={offcutsProduct} onSubmit={handleSubmitOffcuts}
            />
            <StockSessionDetailModal
                isOpen={!!openSession} onClose={() => setOpenSession(null)}
                session={openSession} onCorrected={() => openSessionDetail(openSession.id)}
            />
        </div>
    );
}
