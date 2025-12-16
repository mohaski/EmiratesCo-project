import { useState, useEffect } from 'react';
import { useLocation } from 'react-router-dom';
import ProductCard from '../components/sales/ProductCard';
import ProductModal from '../components/sales/ProductModal';
import CartSidebar from '../components/sales/CartSidebar';
import { PRODUCTS, CATEGORIES } from '../data/mockProducts';
import { CUSTOMERS } from '../data/mockCustomers';
import logo from '../assets/logo.png';

export default function SalesDashboard() {
    const location = useLocation();
    const [activeCategory, setActiveCategory] = useState('ke-profile');
    // Sub-category state for Profiles
    const [activeSubCategory, setActiveSubCategory] = useState('window');

    const [searchQuery, setSearchQuery] = useState('');
    const [selectedProduct, setSelectedProduct] = useState(null);
    const [modalOpen, setModalOpen] = useState(false);

    // Edit State
    const [editingIndex, setEditingIndex] = useState(null);
    const [initialModalDetails, setInitialModalDetails] = useState(null);

    // --- Customer Selection State ---
    // Initialize from location state if returning from checkout
    const [selectedCustomer, setSelectedCustomer] = useState(location.state?.customer || null);
    const [customerSearch, setCustomerSearch] = useState('');
    const [newCustomerName, setNewCustomerName] = useState('');
    const [newCustomerPhone, setNewCustomerPhone] = useState('');

    // --- MOCK INITIAL CART FOR VISUALIZATION ---
    // Initialize from location state if returning from checkout
    const [cart, setCart] = useState(location.state?.cartItems || [
        {
            id: 'k1',
            name: 'Silver Anodized Profile (KE)',
            category: 'ke-profile',
            image: 'https://placehold.co/300x200/C0C0C0/333333?text=Silver+KE',
            totalPrice: 240,
            details: { full: 2, half: 0, feet: 0, color: 'Silver', length: 21 }
        },
        {
            id: 't1',
            name: 'Heavy Duty Frame (TZ)',
            category: 'tz-profile',
            image: 'https://placehold.co/300x200/555555/FFFFFF?text=Heavy+TZ',
            totalPrice: 650, // Mock total for complex item
            details: { full: 2, half: 1, feet: 8, color: 'Brown', length: null }
        },
        {
            id: 'g1',
            name: '6mm Clear Glass',
            category: 'glass',
            image: 'https://placehold.co/300x200/87CEEB/333333?text=6mm+Clear',
            totalPrice: 850,
            details: {
                fullSheet: 1,
                halfSheet: 1,
                cutPieces: [
                    { l: 4, w: 2, q: 2, u: 'ft' },
                    { l: 10, w: 5, q: 1, u: 'cm' }
                ]
            }
        },
        {
            id: 'a1',
            name: 'Steel Hinge Set',
            category: 'accessories',
            image: 'https://placehold.co/300x200/777777/FFFFFF?text=Hinges',
            totalPrice: 30,
            details: { qty: 2, unit: 'pair' }
        }
    ]);

    // Global Profile Color State
    const [profileColor, setProfileColor] = useState('White');

    const PROFILE_COLORS = [
        { name: 'White', hex: '#FFFFFF' },
        { name: 'Brown', hex: '#8B4513' },
        { name: 'Silver', hex: '#C0C0C0' },
        { name: 'Grey', hex: '#808080' }
    ];

    const PROFILE_SUB_CATEGORIES = [
        { id: 'window', label: 'Window Profile' },
        { id: 'door', label: 'Door Profile' },
        { id: 'general', label: 'General Purpose' },
    ];

    const GLASS_SUB_CATEGORIES = [
        { id: 'clear', label: 'Clear' },
        { id: 'oneway', label: 'One/Way' },
        { id: 'mirror', label: 'Mirror' },
        { id: 'tint', label: 'Tint' },
        { id: 'obscure', label: 'Obscure' },
        { id: 'alucoboard', label: 'Alucoboard' },
        { id: 'frost', label: 'Frost' },
    ];

    const isProfileCategory = activeCategory === 'ke-profile' || activeCategory === 'tz-profile';
    const isGlassCategory = activeCategory === 'glass';

    // Reset sub-category when main category changes
    useEffect(() => {
        if (isProfileCategory) {
            setActiveSubCategory('window');
        } else if (isGlassCategory) {
            setActiveSubCategory('clear');
        } else {
            setActiveSubCategory('all');
        }
    }, [activeCategory, isProfileCategory, isGlassCategory]);

    // --- Handlers ---
    const handleProductClick = (product) => {
        setSelectedProduct(product);
        setEditingIndex(null);
        setInitialModalDetails(null);
        setModalOpen(true);
    };

    const handleEditCartItem = (index) => {
        const item = cart[index];
        const originalProduct = PRODUCTS.find(p => p.id === item.id);

        if (originalProduct) {
            setSelectedProduct(originalProduct);
            setEditingIndex(index);
            setInitialModalDetails(item.details);
            setModalOpen(true);
        }
    };

    const handleAddToOrder = (orderItem) => {
        if (editingIndex !== null) {
            const newCart = [...cart];
            newCart[editingIndex] = orderItem;
            setCart(newCart);
            setEditingIndex(null);
        } else {
            setCart([...cart, orderItem]);
        }
    };

    const handleRemoveItem = (index) => {
        const newCart = [...cart];
        newCart.splice(index, 1);
        setCart(newCart);
    };

    const handleModalClose = () => {
        setModalOpen(false);
        setEditingIndex(null);
        setInitialModalDetails(null);
    };

    // --- Filter Logic ---
    const filteredProducts = PRODUCTS.filter(p => {
        const matchesCategory = activeCategory === 'all' || p.category === activeCategory;
        const matchesSubCategory = activeSubCategory === 'all' || p.usage === activeSubCategory;
        const matchesSearch = p.name.toLowerCase().includes(searchQuery.toLowerCase());

        // Apply sub-category filter for Profile OR Glass
        if (isProfileCategory || isGlassCategory) {
            return matchesCategory && matchesSubCategory && matchesSearch;
        }
        return matchesCategory && matchesSearch;
    });

    const currentSubCategories = isProfileCategory ? PROFILE_SUB_CATEGORIES : (isGlassCategory ? GLASS_SUB_CATEGORIES : []);

    return (
        <div className="flex h-full w-full overflow-hidden text-gray-800 font-sans">

            {/* --- Main Content area --- */}
            <div className="flex-1 flex flex-col relative bg-slate-50 min-w-0">

                {/* Top Header */}
                <div className="h-20 flex items-center justify-between px-8 border-b border-gray-200 bg-white/50 backdrop-blur-sm sticky top-0 z-10 transition-colors shrink-0">
                    <div>
                        <h1 className="text-2xl font-bold text-gray-800 tracking-tight">Sales Terminal</h1>
                        <p className="text-xs text-gray-500 font-medium">Welcome back, Agent</p>
                    </div>

                    {/* Search Bar */}
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
                        {/* GLOBAL COLOR SELECTOR - Only visible for Profile Categories */}
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

                        {/* SUB CATEGORY FILTERS (Dynamic for Profile/Glass) */}
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
            />

            {/* --- Product Modal --- */}
            <ProductModal
                product={selectedProduct}
                isOpen={modalOpen}
                onClose={handleModalClose}
                onAddToOrder={handleAddToOrder}
                // If editing, use the color from the item. If new, use global.
                color={initialModalDetails?.color || profileColor}
                initialDetails={initialModalDetails}
            />

            {/* --- CUSTOMER SELECTION OVERLAY --- */}
            {!selectedCustomer && (
                <div className="fixed inset-0 z-[60] bg-slate-900/50 backdrop-blur-md flex items-center justify-center p-4">
                    <div className="bg-white rounded-3xl shadow-2xl max-w-2xl w-full overflow-hidden animate-pop-in border border-gray-200">
                        <div className="p-8 bg-white">
                            <h2 className="text-3xl font-bold text-gray-800 mb-2">Who is this order for?</h2>
                            <p className="text-gray-500 mb-8">Select a registered customer or enter a new name.</p>

                            {/* Search Existing */}
                            <div className="mb-8">
                                <label className="text-xs font-bold text-gray-400 uppercase tracking-wide mb-2 block">Search Registered Customer</label>
                                <div className="relative group">
                                    <span className="absolute left-4 top-3.5 text-gray-400 group-focus-within:text-blue-500 transition-colors">🔍</span>
                                    <input
                                        type="text"
                                        placeholder="Search by name or phone..."
                                        className="w-full bg-gray-50 border border-gray-200 rounded-xl py-3 pl-10 pr-4 text-lg focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 outline-none transition-all"
                                        value={customerSearch}
                                        onChange={(e) => setCustomerSearch(e.target.value)}
                                    />
                                </div>
                                {/* Results List */}
                                <div className="mt-2 space-y-2 max-h-48 overflow-y-auto custom-scrollbar">
                                    {CUSTOMERS.filter(c => c.name.toLowerCase().includes(customerSearch.toLowerCase()) || c.phone.includes(customerSearch)).map(c => (
                                        <button
                                            key={c.id}
                                            onClick={() => setSelectedCustomer(c)}
                                            className="w-full flex items-center justify-between p-3 rounded-xl hover:bg-blue-50 border border-transparent hover:border-blue-100 transition-all text-left group"
                                        >
                                            <div>
                                                <div className="font-bold text-gray-800">{c.name}</div>
                                                <div className="text-xs text-gray-500 font-mono">{c.phone}</div>
                                            </div>
                                            <span className="text-blue-500 opacity-0 group-hover:opacity-100 font-medium text-sm">Select →</span>
                                        </button>
                                    ))}
                                </div>
                            </div>

                            <div className="flex items-center gap-4 py-4">
                                <span className="h-px bg-gray-200 flex-1"></span>
                                <span className="text-xs text-gray-400 font-bold uppercase">OR</span>
                                <span className="h-px bg-gray-200 flex-1"></span>
                            </div>

                            {/* One-time / New */}
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mt-4">
                                <div>
                                    <label className="text-xs font-bold text-gray-400 uppercase tracking-wide mb-2 block">New Customer Registration</label>
                                    <div className="space-y-3">
                                        <input
                                            type="text"
                                            placeholder="Full Name"
                                            className="w-full bg-gray-50 border border-gray-200 rounded-xl px-4 py-3 text-gray-800 outline-none focus:border-blue-500 transition-all font-medium"
                                            value={newCustomerName}
                                            onChange={(e) => setNewCustomerName(e.target.value)}
                                        />
                                        <input
                                            type="tel"
                                            placeholder="Phone Number (Required)"
                                            className="w-full bg-gray-50 border border-gray-200 rounded-xl px-4 py-3 text-gray-800 outline-none focus:border-blue-500 transition-all font-medium"
                                            value={newCustomerPhone}
                                            onChange={(e) => setNewCustomerPhone(e.target.value)}
                                            onKeyDown={(e) => {
                                                if (e.key === 'Enter' && newCustomerName.trim() && newCustomerPhone.trim()) {
                                                    setSelectedCustomer({ id: 'new-' + Date.now(), name: newCustomerName, phone: newCustomerPhone, type: 'new' });
                                                }
                                            }}
                                        />
                                        <button
                                            onClick={() => {
                                                if (newCustomerName.trim() && newCustomerPhone.trim()) {
                                                    setSelectedCustomer({ id: 'new-' + Date.now(), name: newCustomerName, phone: newCustomerPhone, type: 'new' });
                                                }
                                            }}
                                            disabled={!newCustomerName.trim() || !newCustomerPhone.trim()}
                                            className="w-full bg-gray-900 text-white py-3 rounded-xl font-bold disabled:opacity-50 hover:bg-black transition-colors shadow-lg shadow-gray-900/10 flex items-center justify-center gap-2"
                                        >
                                            <span>Register & Start Sale</span>
                                            <span>→</span>
                                        </button>
                                    </div>
                                </div>
                                <div className="flex flex-col justify-end">
                                    <button
                                        onClick={() => setSelectedCustomer({ id: 'walk-in', name: 'Walk-in Customer', type: 'walk-in' })}
                                        className="w-full bg-blue-50 text-blue-600 hover:bg-blue-100 font-bold py-3 rounded-xl border border-blue-200 transition-colors"
                                    >
                                        Walk-in Customer
                                    </button>
                                </div>
                            </div>

                        </div>
                    </div>
                </div>
            )}

        </div>
    );
}
