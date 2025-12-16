import { useState, useMemo } from 'react';
import { PRODUCTS, CATEGORIES } from '../data/mockProducts';

// --- Constants (Shared with Sales logic) ---
const PROFILE_COLORS = ['White', 'Silver', 'Gold', 'Bronze', 'Grey', 'Matt Black'];
const GLASS_THICKNESSES = ['4mm', '6mm', '8mm', '10mm', '12mm']; // Fallback if not in product

const SUB_CATEGORIES = {
    'ke-profile': [
        { id: 'window', label: 'Windows' },
        { id: 'door', label: 'Doors' },
        { id: 'general', label: 'General' },
    ],
    'tz-profile': [
        { id: 'window', label: 'Windows' },
        { id: 'door', label: 'Doors' },
        { id: 'general', label: 'General' },
    ],
    'glass': [
        { id: 'clear', label: 'Clear' },
        { id: 'one/way', label: 'One/Way' },
        { id: 'tint', label: 'Tinted' },
        { id: 'mirror', label: 'Mirror' },
        { id: 'frost', label: 'Frost' },
        { id: 'obscure', label: 'Obscure' },
        { id: 'alucoboard', label: 'Alucoboard' },
    ]
};

export default function InventoryPage() {
    const [searchTerm, setSearchTerm] = useState('');
    const [filterCategory, setFilterCategory] = useState('ke-profile');
    const [filterSubCategory, setFilterSubCategory] = useState('window');

    // --- Mock Inventory State with Variants ---
    const [inventory, setInventory] = useState(() =>
        PRODUCTS.map(p => {
            // Generate variant stock map
            const variants = {};

            if (p.category === 'glass') {
                // For Glass, variants are Thicknesses
                const thicks = p.thicknessPrices ? p.thicknessPrices.map(t => t.thickness) : GLASS_THICKNESSES;
                thicks.forEach(t => { variants[t] = Math.floor(Math.random() * 20); });
            } else if (p.category.includes('profile')) {
                // For Profiles, variants are Colors
                PROFILE_COLORS.forEach(c => { variants[c] = Math.floor(Math.random() * 30); });
            } else {
                // Accessories / Others - specific 'Standard' or null variant
                variants['Standard'] = Math.floor(Math.random() * 50);
            }

            return {
                ...p,
                stockVariants: variants,
                minStock: 10
            };
        })
    );

    // Recent Interactions Log
    const [recentUpdates, setRecentUpdates] = useState([]);

    // Modal State
    const [isAddStockModalOpen, setAddStockModalOpen] = useState(false);
    const [selectedProduct, setSelectedProduct] = useState(null);
    const [selectedVariant, setSelectedVariant] = useState('');
    const [stockToAdd, setStockToAdd] = useState('');

    // --- Derived State for Filtering ---
    const filteredInventory = useMemo(() => {
        return inventory.filter(item => {
            const matchesSearch = item.name.toLowerCase().includes(searchTerm.toLowerCase());
            const matchesCategory = filterCategory === 'all' || item.category === filterCategory;

            let matchesSub = true;
            if (filterSubCategory !== 'all' && filterCategory !== 'all') {
                // Assumes 'usage' field in mockProducts maps to subcategory
                matchesSub = item.usage === filterSubCategory;
            }

            return matchesSearch && matchesCategory && matchesSub;
        });
    }, [inventory, searchTerm, filterCategory, filterSubCategory]);

    // Handle Category Click (Reset Subcat)
    const handleCategoryChange = (catId) => {
        setFilterCategory(catId);
        setFilterSubCategory('all');
    };

    const handleAddStockClick = (product) => {
        setSelectedProduct(product);

        // Auto-select first variant
        const firstVariant = Object.keys(product.stockVariants)[0];
        setSelectedVariant(firstVariant);

        setStockToAdd('');
        setAddStockModalOpen(true);
    };

    const confirmAddStock = () => {
        if (!selectedProduct || !stockToAdd || !selectedVariant) return;

        const qty = parseInt(stockToAdd);
        if (isNaN(qty) || qty <= 0) return;

        // Update Inventory
        setInventory(prev => prev.map(item => {
            if (item.id === selectedProduct.id) {
                return {
                    ...item,
                    stockVariants: {
                        ...item.stockVariants,
                        [selectedVariant]: (item.stockVariants[selectedVariant] || 0) + qty
                    }
                };
            }
            return item;
        }));

        // Log Update
        setRecentUpdates(prev => [{
            id: Date.now(),
            product: `${selectedProduct.name} (${selectedVariant})`,
            qty: qty,
            time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
        }, ...prev]);

        setAddStockModalOpen(false);
    };

    // Calculate total stock for list display
    const getTotalStock = (item) => Object.values(item.stockVariants).reduce((a, b) => a + b, 0);

    return (
        <div className="flex-1 flex flex-col h-full bg-slate-50 font-sans text-gray-800 overflow-hidden">

            {/* Cashier Stock Header */}
            <header className="h-24 flex px-8 items-center justify-between border-b border-gray-200 bg-white sticky top-0 z-10 shadow-sm">
                <div>
                    <div className="flex items-center gap-3">
                        <div className="p-2 bg-blue-600 rounded-lg text-white">
                            <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 6v6m0 0v6m0-6h6m-6 0H6"></path></svg>
                        </div>
                        <h1 className="text-2xl font-bold tracking-tight text-gray-900">Stock Control</h1>
                    </div>
                    <p className="text-sm text-gray-500 font-medium mt-1 ml-11">Manage inventory, colors, and variants.</p>
                </div>

                {/* Session Stats */}
                <div className="flex items-center gap-6 text-sm font-medium text-gray-500 bg-gray-50 px-4 py-2 rounded-xl border border-gray-100">
                    <div className="flex items-center gap-2">
                        <span className="relative flex h-3 w-3">
                            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-green-400 opacity-75"></span>
                            <span className="relative inline-flex rounded-full h-3 w-3 bg-green-500"></span>
                        </span>
                        <span>System Online</span>
                    </div>
                    <div className="h-4 w-px bg-gray-300"></div>
                    <div>Updates: <span className="text-gray-900 font-bold">{recentUpdates.length}</span></div>
                </div>
            </header>

            <div className="flex-1 flex overflow-hidden">

                {/* Main Content: Search & List */}
                <div className="flex-1 flex flex-col overflow-hidden">

                    {/* Filter Bar (Categories & Subs) */}
                    <div className="p-8 pb-4 shrink-0 space-y-4">
                        {/* 1. Main Categories */}
                        <div className="flex gap-2 bg-white p-1.5 rounded-2xl border border-gray-100 shadow-sm w-fit">
                            {CATEGORIES.map(cat => (
                                <button
                                    key={cat.id}
                                    onClick={() => handleCategoryChange(cat.id)}
                                    className={`px-5 py-2.5 rounded-xl text-sm font-bold transition-all ${filterCategory === cat.id ? 'bg-gray-900 text-white shadow-md' : 'text-gray-500 hover:bg-gray-50'}`}
                                >
                                    {cat.label}
                                </button>
                            ))}
                        </div>

                        {/* 2. Sub Categories (Dynamic) */}
                        {(filterCategory === 'ke-profile' || filterCategory === 'tz-profile' || filterCategory === 'glass') && (
                            <div className="flex gap-2 overflow-x-auto pb-1 scrollbar-hide animate-fade-in">
                                {(filterCategory === 'glass' ? SUB_CATEGORIES['glass'] : SUB_CATEGORIES[filterCategory]).map(sub => (
                                    <button
                                        key={sub.id}
                                        onClick={() => setFilterSubCategory(sub.id)}
                                        className={`px-4 py-1.5 rounded-lg text-xs font-bold transition-all border ${filterSubCategory === sub.id ? 'bg-blue-50 text-blue-600 border-blue-200' : 'bg-white text-gray-500 border-gray-200 hover:border-gray-300'}`}
                                    >
                                        {sub.label}
                                    </button>
                                ))}
                            </div>
                        )}

                        {/* 3. Search */}
                        <div className="relative">
                            <span className="absolute left-6 top-4 text-gray-400 text-xl">🔍</span>
                            <input
                                type="text"
                                className="w-full bg-white border border-gray-200 rounded-2xl pl-16 pr-4 py-4 text-lg font-medium outline-none focus:ring-4 focus:ring-blue-500/10 focus:border-blue-500 transition-all shadow-sm placeholder-gray-400"
                                placeholder="Search by name, SKU, or variant..."
                                value={searchTerm}
                                onChange={(e) => setSearchTerm(e.target.value)}
                            />
                        </div>
                    </div>

                    {/* Inventory Table */}
                    <div className="flex-1 overflow-y-auto px-8 pb-8 custom-scrollbar">
                        <div className="grid grid-cols-1 gap-4">
                            {filteredInventory.map(item => {
                                const total = getTotalStock(item);
                                const isLow = total < item.minStock * 2; // Arbitrary low stock logic

                                return (
                                    <div key={item.id} className="bg-white p-4 rounded-xl border border-gray-200 shadow-sm flex items-center justify-between group hover:border-blue-300 transition-all">
                                        <div className="flex items-center gap-4">
                                            <div className="w-16 h-16 rounded-lg bg-gray-50 p-2 border border-gray-100 shrink-0">
                                                <img src={item.image} className="w-full h-full object-contain mix-blend-multiply" alt="" />
                                            </div>
                                            <div>
                                                <h3 className="font-bold text-gray-900 text-lg">{item.name}</h3>
                                                <div className="flex items-center gap-3 text-sm text-gray-500">
                                                    <span className="bg-gray-100 px-2 py-0.5 rounded text-xs uppercase tracking-wide font-bold">{CATEGORIES.find(c => c.id === item.category)?.label}</span>
                                                    {isLow && <span className="bg-red-50 text-red-600 px-2 py-0.5 rounded text-xs uppercase tracking-wide font-bold animate-pulse">Low Stock</span>}
                                                </div>
                                            </div>
                                        </div>

                                        <div className="flex items-center gap-8">
                                            <div className="text-right">
                                                <div className="text-xs font-bold text-gray-400 uppercase tracking-wide mb-1">Total Stock</div>
                                                <div className="text-2xl font-mono font-bold text-gray-900">{total}</div>
                                            </div>
                                            <button
                                                onClick={() => handleAddStockClick(item)}
                                                className="bg-gray-900 hover:bg-blue-600 text-white px-6 py-3 rounded-xl font-bold transition-colors shadow-lg shadow-gray-900/10 flex items-center gap-2"
                                            >
                                                <span>+ Restock</span>
                                            </button>
                                        </div>
                                    </div>
                                );
                            })}

                            {filteredInventory.length === 0 && (
                                <div className="text-center py-20 bg-gray-50/50 rounded-2xl border-2 border-dashed border-gray-200">
                                    <p className="text-gray-400 font-medium">No products found matching filters.</p>
                                </div>
                            )}
                        </div>
                    </div>
                </div>

                {/* Right Panel: Recent Activity */}
                <div className="w-80 bg-white border-l border-gray-200 p-6 hidden xl:flex flex-col">
                    <h3 className="font-bold text-gray-900 text-lg mb-6">Recent Updates</h3>
                    <div className="flex-1 overflow-y-auto space-y-4 custom-scrollbar">
                        {recentUpdates.length === 0 ? (
                            <p className="text-sm text-gray-400 text-center mt-10">No updates in this session.</p>
                        ) : (
                            recentUpdates.map(update => (
                                <div key={update.id} className="p-4 bg-gray-50 rounded-xl border border-gray-100 animate-fade-in">
                                    <div className="flex justify-between items-start mb-2">
                                        <span className="text-xs font-bold text-gray-400">{update.time}</span>
                                        <span className="text-xs font-bold text-green-600 bg-green-50 px-2 py-0.5 rounded">+ Stock In</span>
                                    </div>
                                    <div className="font-bold text-gray-900 text-sm mb-1">{update.product}</div>
                                    <div className="text-xs text-gray-600">Added <span className="font-bold text-gray-900">{update.qty}</span> units</div>
                                </div>
                            ))
                        )}
                    </div>
                </div>

            </div>

            {/* Add Stock Modal */}
            {isAddStockModalOpen && selectedProduct && (
                <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-gray-900/60 backdrop-blur-sm animate-fade-in">
                    <div className="bg-white rounded-3xl shadow-2xl w-full max-w-lg overflow-hidden animate-pop-in">
                        <div className="p-8 border-b border-gray-100 bg-gray-50/50 text-center">
                            <div className="w-16 h-16 bg-blue-100 text-blue-600 rounded-2xl flex items-center justify-center text-3xl mx-auto mb-4 shadow-sm">
                                📦
                            </div>
                            <h3 className="text-2xl font-bold text-gray-900">Restock Product</h3>
                            <p className="text-gray-500 mt-1">{selectedProduct.name}</p>
                        </div>

                        <div className="p-8 space-y-6">

                            {/* Variant Selector */}
                            <div>
                                <label className="text-xs font-bold text-gray-400 uppercase tracking-wide block mb-3">Select Variant</label>
                                <div className="grid grid-cols-3 gap-3">
                                    {Object.keys(selectedProduct.stockVariants).map(variant => (
                                        <button
                                            key={variant}
                                            onClick={() => setSelectedVariant(variant)}
                                            className={`px-3 py-3 rounded-xl border text-sm font-bold transition-all ${selectedVariant === variant
                                                ? 'bg-blue-600 text-white border-blue-600 shadow-md transform scale-105'
                                                : 'bg-white text-gray-600 border-gray-200 hover:bg-gray-50'
                                                }`}
                                        >
                                            {variant}
                                            <div className={`text-xs mt-1 font-mono ${selectedVariant === variant ? 'text-blue-200' : 'text-gray-400'}`}>
                                                Qty: {selectedProduct.stockVariants[variant]}
                                            </div>
                                        </button>
                                    ))}
                                </div>
                            </div>

                            {/* Quantity Input */}
                            <div>
                                <label className="text-xs font-bold text-gray-400 uppercase tracking-wide block mb-2">Quantity to Add</label>
                                <div className="relative">
                                    <button
                                        onClick={() => setStockToAdd(prev => Math.max(0, (parseInt(prev) || 0) - 1).toString())}
                                        className="absolute left-2 top-2 p-3 hover:bg-gray-100 rounded-lg text-gray-500 transition-colors"
                                    >
                                        −
                                    </button>
                                    <input
                                        type="number"
                                        autoFocus
                                        className="w-full text-center text-4xl font-bold text-gray-900 border border-gray-200 rounded-2xl py-5 focus:border-blue-500 focus:ring-4 focus:ring-blue-500/10 outline-none transition-all placeholder-gray-300"
                                        placeholder="0"
                                        value={stockToAdd}
                                        onChange={(e) => setStockToAdd(e.target.value)}
                                        onKeyDown={(e) => e.key === 'Enter' && confirmAddStock()}
                                    />
                                    <button
                                        onClick={() => setStockToAdd(prev => ((parseInt(prev) || 0) + 1).toString())}
                                        className="absolute right-2 top-2 p-3 hover:bg-gray-100 rounded-lg text-gray-500 transition-colors"
                                    >
                                        +
                                    </button>
                                </div>
                                <p className="mt-3 text-center text-xs font-bold text-gray-400">
                                    New Total: <span className="text-blue-600">{(selectedProduct.stockVariants[selectedVariant] || 0) + (parseInt(stockToAdd) || 0)}</span>
                                </p>
                            </div>
                        </div>

                        <div className="p-8 pt-0 flex gap-4">
                            <button
                                onClick={() => setAddStockModalOpen(false)}
                                className="flex-1 py-4 text-gray-500 font-bold hover:bg-gray-50 rounded-2xl transition-colors"
                            >
                                Cancel
                            </button>
                            <button
                                onClick={confirmAddStock}
                                disabled={!stockToAdd || parseInt(stockToAdd) <= 0}
                                className="flex-1 py-4 bg-gray-900 text-white font-bold rounded-2xl hover:bg-black transition-colors shadow-lg shadow-gray-900/20 disabled:opacity-50 disabled:shadow-none flex items-center justify-center gap-2"
                            >
                                <span>Confirm Restock</span>
                                <span>✓</span>
                            </button>
                        </div>
                    </div>
                </div>
            )}

        </div>
    );
}
