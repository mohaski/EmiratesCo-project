import { useState, useMemo, useEffect } from 'react';
import { useProducts } from '../context/ProductContext';
import AddStockModal from '../components/inventory/AddStockModal';

const PROFILE_COLORS = ['White', 'Silver', 'Gold', 'Bronze', 'Grey', 'Matt Black'];
const GLASS_THICKNESSES = ['4mm', '6mm', '8mm', '10mm', '12mm'];

export default function InventoryPage() {
    const { products, categories: CATEGORIES, updateProduct, updateProductVariant } = useProducts();
    const [searchTerm, setSearchTerm] = useState('');
    const [filterCategory, setFilterCategory] = useState('ke-profile');
    const [filterSubCategory, setFilterSubCategory] = useState('window');
    const [inventory, setInventory] = useState([]);
    const [recentUpdates, setRecentUpdates] = useState([]);
    const [isAddStockModalOpen, setAddStockModalOpen] = useState(false);
    const [selectedProduct, setSelectedProduct] = useState(null);
    const [selectedVariant, setSelectedVariant] = useState('');
    const [stockToAdd, setStockToAdd] = useState('');

    useEffect(() => {
        setInventory(products.map(p => {
            if (p.variants?.length > 0) {
                const stockMap = {};
                p.variants.forEach(v => { stockMap[v.name || Object.values(v.attributes).join(' - ')] = v.stock || 0; });
                return { ...p, stockVariants: stockMap, minStock: 10 };
            }
            const variants = {};
            if (p.category === 'glass') {
                (p.thicknessPrices ? p.thicknessPrices.map(t => t.thickness) : GLASS_THICKNESSES).forEach(t => { variants[t] = 50; });
            } else if (p.category?.includes('profile')) {
                PROFILE_COLORS.forEach(c => { variants[c] = 50; });
            } else { variants['Standard'] = 50; }
            return { ...p, stockVariants: variants, minStock: 10 };
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

    const handleAddStockClick = (product) => {
        setSelectedProduct(product);
        setSelectedVariant(Object.keys(product.stockVariants)[0]);
        setStockToAdd('');
        setAddStockModalOpen(true);
    };

    const confirmAddStock = async () => {
        if (!selectedProduct || !stockToAdd || !selectedVariant) return;
        const qty = parseInt(stockToAdd);
        if (isNaN(qty) || qty <= 0) return;
        const original = products.find(p => p.id === selectedProduct.id);
        if (!original?.variants) return;
        const targetVariant = original.variants.find(v => (v.name || Object.values(v.attributes).join(' - ')) === selectedVariant);
        if (targetVariant) {
            try {
                await updateProductVariant(targetVariant.id, { stock_change: qty });
                setRecentUpdates(prev => [{ id: Date.now(), product: `${selectedProduct.name} (${selectedVariant})`, qty, time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) }, ...prev]);
                setAddStockModalOpen(false);
            } catch { alert("Failed to update stock."); }
        }
    };

    const getTotalStock = (item) => !item.stockVariants ? 0 : Object.values(item.stockVariants).reduce((a, b) => a + b, 0);

    return (
        <div style={{ display: 'flex', flexDirection: 'column', height: '100%', background: 'var(--color-bg)', overflow: 'hidden' }}>

            {/* Header */}
            <header style={{
                padding: '1.25rem 2rem', borderBottom: '1px solid rgba(255,255,255,0.07)',
                background: 'rgba(9,14,26,0.9)', backdropFilter: 'blur(20px)',
                display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexShrink: 0,
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
                        Updates: <span style={{ color: '#f1f5f9', fontWeight: 700 }}>{recentUpdates.length}</span>
                    </span>
                </div>
            </header>

            <div style={{ flex: 1, display: 'flex', overflow: 'hidden' }}>
                {/* Main content */}
                <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
                    {/* Filters */}
                    <div style={{ padding: '1.25rem 2rem 0.75rem', flexShrink: 0, borderBottom: '1px solid rgba(255,255,255,0.05)' }}>
                        {/* Category tabs */}
                        <div style={{ display: 'flex', gap: '4px', background: 'rgba(255,255,255,0.04)', borderRadius: '0.75rem', padding: '4px', width: 'fit-content', marginBottom: '0.75rem' }}>
                            {CATEGORIES.map(cat => (
                                <button key={cat.id} onClick={() => handleCategoryChange(cat.id)} style={{
                                    padding: '0.5rem 1.25rem', borderRadius: '0.5rem', border: 'none', cursor: 'pointer',
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
                    <div style={{ flex: 1, overflowY: 'auto', padding: '1rem 2rem' }} className="custom-scrollbar">
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.625rem' }}>
                            {filteredInventory.map(item => {
                                const total = getTotalStock(item);
                                const isLow = total < item.minStock * 2;
                                return (
                                    <div key={item.id} style={{
                                        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                                        padding: '1rem 1.25rem',
                                        background: 'linear-gradient(135deg, rgba(255,255,255,0.05), rgba(255,255,255,0.02))',
                                        border: '1px solid rgba(255,255,255,0.08)',
                                        borderRadius: '0.875rem', transition: 'all 0.2s', gap: '1rem',
                                    }}
                                    onMouseEnter={e => { e.currentTarget.style.borderColor = 'rgba(59,130,246,0.25)'; e.currentTarget.style.background = 'linear-gradient(135deg, rgba(255,255,255,0.07), rgba(255,255,255,0.03))'; }}
                                    onMouseLeave={e => { e.currentTarget.style.borderColor = 'rgba(255,255,255,0.08)'; e.currentTarget.style.background = 'linear-gradient(135deg, rgba(255,255,255,0.05), rgba(255,255,255,0.02))'; }}
                                    >
                                        <div style={{ display: 'flex', alignItems: 'center', gap: '1rem', flex: 1, minWidth: 0 }}>
                                            <div style={{ width: '52px', height: '52px', flexShrink: 0, borderRadius: '10px', background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.1)', overflow: 'hidden', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                                                <img src={item.image} style={{ width: '80%', height: '80%', objectFit: 'contain', mixBlendMode: 'luminosity', opacity: 0.8 }} alt="" />
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
                                                    {isLow && (
                                                        <span style={{ fontSize: '0.65rem', fontWeight: 700, background: 'rgba(239,68,68,0.12)', border: '1px solid rgba(239,68,68,0.25)', color: '#f87171', borderRadius: '100px', padding: '1px 8px', animation: 'pulse 1.5s ease-in-out infinite' }}>
                                                            ⚠ Low Stock
                                                        </span>
                                                    )}
                                                </div>
                                            </div>
                                        </div>

                                        <div style={{ display: 'flex', alignItems: 'center', gap: '1.5rem' }}>
                                            <div style={{ textAlign: 'right' }}>
                                                <div style={{ fontSize: '0.62rem', fontWeight: 700, color: '#475569', letterSpacing: '0.08em', textTransform: 'uppercase', marginBottom: '2px' }}>Total Stock</div>
                                                <div style={{ fontSize: '1.5rem', fontWeight: 900, color: isLow ? '#f87171' : '#f1f5f9', fontFamily: 'var(--font-mono)', letterSpacing: '-0.02em' }}>{total}</div>
                                            </div>
                                            <button onClick={() => handleAddStockClick(item)} style={{
                                                padding: '0.625rem 1.25rem', borderRadius: '0.75rem', border: 'none', cursor: 'pointer',
                                                background: 'linear-gradient(135deg, #3b82f6, #06b6d4)',
                                                color: '#fff', fontWeight: 800, fontSize: '0.8rem',
                                                boxShadow: '0 4px 16px rgba(59,130,246,0.3)', transition: 'all 0.2s',
                                            }}
                                            onMouseEnter={e => { e.currentTarget.style.transform = 'translateY(-1px)'; e.currentTarget.style.boxShadow = '0 6px 20px rgba(59,130,246,0.4)'; }}
                                            onMouseLeave={e => { e.currentTarget.style.transform = 'translateY(0)'; e.currentTarget.style.boxShadow = '0 4px 16px rgba(59,130,246,0.3)'; }}
                                            >+ Restock</button>
                                        </div>
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

                {/* Right: Recent activity */}
                <div style={{
                    width: '280px', flexShrink: 0,
                    borderLeft: '1px solid rgba(255,255,255,0.07)',
                    background: 'rgba(0,0,0,0.2)',
                    display: 'flex', flexDirection: 'column',
                    padding: '1.25rem',
                }}>
                    <h3 style={{ fontSize: '0.8rem', fontWeight: 700, color: '#64748b', letterSpacing: '0.08em', textTransform: 'uppercase', margin: '0 0 1rem' }}>Recent Updates</h3>
                    <div style={{ flex: 1, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '0.5rem' }} className="custom-scrollbar">
                        {recentUpdates.length === 0 ? (
                            <p style={{ fontSize: '0.78rem', color: '#334155', textAlign: 'center', marginTop: '2rem', fontStyle: 'italic' }}>No updates this session</p>
                        ) : recentUpdates.map(u => (
                            <div key={u.id} style={{
                                padding: '0.75rem', borderRadius: '0.625rem',
                                background: 'rgba(34,197,94,0.07)', border: '1px solid rgba(34,197,94,0.15)',
                            }}>
                                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '0.25rem' }}>
                                    <span style={{ fontSize: '0.65rem', color: '#475569', fontFamily: 'var(--font-mono)' }}>{u.time}</span>
                                    <span style={{ fontSize: '0.65rem', fontWeight: 700, color: '#4ade80', background: 'rgba(34,197,94,0.1)', borderRadius: '100px', padding: '1px 6px' }}>+In</span>
                                </div>
                                <div style={{ fontSize: '0.78rem', fontWeight: 700, color: '#e2e8f0', marginBottom: '2px' }}>{u.product}</div>
                                <div style={{ fontSize: '0.7rem', color: '#64748b' }}>Added <span style={{ color: '#f1f5f9', fontWeight: 700 }}>{u.qty}</span> units</div>
                            </div>
                        ))}
                    </div>
                </div>
            </div>

            <AddStockModal
                isOpen={isAddStockModalOpen} onClose={() => setAddStockModalOpen(false)}
                product={selectedProduct} selectedVariant={selectedVariant}
                onVariantSelect={setSelectedVariant} stockToAdd={stockToAdd}
                onStockChange={setStockToAdd} onConfirm={confirmAddStock}
            />
        </div>
    );
}
