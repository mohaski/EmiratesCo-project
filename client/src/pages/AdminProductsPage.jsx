import React, { useState, useMemo } from 'react';
import { useProducts } from '../context/ProductContext';
import ConfirmationModal from '../components/common/ConfirmationModal';
import ManageVariantsModal from '../components/inventory/ManageVariantsModal';
import EditProductModal from '../components/inventory/EditProductModal';
import { useNavigate } from 'react-router-dom';

export default function AdminProductsPage() {
    // Default to first category if available, else 'ke-profile' as safe fallback
    const { products, deleteProduct, categories } = useProducts();
    const navigate = useNavigate();

    const [selectedCategory, setSelectedCategory] = useState(() => {
        return (categories && categories.length > 0) ? categories[0].id : 'ke-profile';
    });
    const [selectedUsage, setSelectedUsage] = useState('window');

    // Dynamic Sub-Categories (Mirrors AddProductPage config)
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
            { id: 'oneway', label: 'One/Way' },
            { id: 'tint', label: 'Tinted' },
            { id: 'mirror', label: 'Mirror' },
            { id: 'frost', label: 'Frost' },
            { id: 'obscure', label: 'Obscure' },
            { id: 'alucoboard', label: 'Alucoboard' },
        ],
        'accessories': [
            { id: 'general', label: 'General' }
        ]
    };

    const usages = useMemo(() => {
        return SUB_CATEGORIES[selectedCategory] || [];
    }, [selectedCategory]);

    // Reset usage when category changes
    // (We use a ref or effect, but here we can just default safely in render or use an effect)
    // Actually, let's use a simple effect to reset if the current usage isn't valid for the new category
    // but better is to simple make "selectedUsage" derive or auto-select first if invalid.
    // For simplicity, let's just use effect.
    React.useEffect(() => {
        const validUsages = SUB_CATEGORIES[selectedCategory] || [];
        if (validUsages.length > 0) {
            // If current selectedUsage is not in the new valid list, reset to first
            const exists = validUsages.find(u => u.id === selectedUsage);
            if (!exists) {
                setSelectedUsage(validUsages[0].id);
            }
        } else {
            setSelectedUsage('');
        }
    }, [selectedCategory]);

    // Modal States
    const [deleteModal, setDeleteModal] = useState({ open: false, product: null });
    const [variantsModal, setVariantsModal] = useState({ open: false, product: null });
    const [editModal, setEditModal] = useState({ open: false, product: null });

    // Filter Logic - Category AND Usage
    const filteredProducts = useMemo(() => {
        return products.filter(p =>
            p.category === selectedCategory &&
            (p.usage === selectedUsage || (!p.usage && selectedUsage === 'general')) // Fallback for missing usage
        );
    }, [products, selectedCategory, selectedUsage]);

    // Handlers
    const confirmDeleteProduct = () => {
        if (deleteModal.product) {
            deleteProduct(deleteModal.product.id);
            setDeleteModal({ open: false, product: null });
        }
    };

    return (
        <div className="min-h-screen bg-gray-50 flex flex-col font-sans text-gray-900">
            {/* Header */}
            <header className="bg-white/80 backdrop-blur-md border-b border-gray-200 sticky top-0 z-30">
                <div className="max-w-7xl mx-auto px-6 h-20 flex items-center justify-between">
                    <div className="flex items-center gap-4">
                        <div className="w-10 h-10 bg-gray-900 rounded-xl flex items-center justify-center text-white text-xl shadow-lg">
                            👑
                        </div>
                        <div>
                            <h1 className="text-xl font-bold text-gray-900 tracking-tight">Product Management</h1>
                            <p className="text-xs text-gray-500 font-bold tracking-widest uppercase">CEO Control Center</p>
                        </div>
                    </div>
                    <button
                        onClick={() => navigate('/add-product')}
                        className="bg-blue-600 hover:bg-blue-700 text-white px-6 py-2.5 rounded-xl font-bold shadow-lg shadow-blue-500/20 transition-all hover:-translate-y-0.5 active:translate-y-0"
                    >
                        + Add New Product
                    </button>
                </div>
            </header>

            <main className="flex-1 max-w-7xl mx-auto px-6 py-8 w-full">

                {/* Stats / Overview */}
                <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-8">
                    <div className="bg-white p-6 rounded-2xl border border-gray-100 shadow-sm flex items-center justify-between">
                        <div>
                            <p className="text-gray-500 text-xs font-bold uppercase tracking-wide">Total Products</p>
                            <h3 className="text-3xl font-bold text-gray-900 mt-1">{products.length}</h3>
                        </div>
                        <div className="w-12 h-12 bg-blue-50 rounded-full flex items-center justify-center text-blue-600 text-xl">📦</div>
                    </div>
                    <div className="bg-white p-6 rounded-2xl border border-gray-100 shadow-sm flex items-center justify-between">
                        <div>
                            <p className="text-gray-500 text-xs font-bold uppercase tracking-wide">Variant Types</p>
                            <h3 className="text-3xl font-bold text-gray-900 mt-1">{products.reduce((acc, p) => acc + (p.variants?.length || 0), 0)}</h3>
                        </div>
                        <div className="w-12 h-12 bg-purple-50 rounded-full flex items-center justify-center text-purple-600 text-xl">🧬</div>
                    </div>
                    <div className="bg-white p-6 rounded-2xl border border-gray-100 shadow-sm flex items-center justify-between">
                        <div>
                            <p className="text-gray-500 text-xs font-bold uppercase tracking-wide">Categories</p>
                            <h3 className="text-3xl font-bold text-gray-900 mt-1">{categories.length}</h3>
                        </div>
                        <div className="w-12 h-12 bg-orange-50 rounded-full flex items-center justify-center text-orange-600 text-xl">📂</div>
                    </div>
                </div>

                {/* Filters */}
                <div className="bg-white p-4 rounded-2xl border border-gray-200 shadow-sm mb-6 flex flex-col gap-4">
                    {/* Primary Filter: Category */}
                    <div className="flex gap-2 w-full overflow-x-auto pb-1 scrollbar-hide border-b border-gray-100 pb-4">
                        {categories.map(cat => (
                            <button
                                key={cat.id}
                                onClick={() => setSelectedCategory(cat.id)}
                                className={`px-6 py-2.5 rounded-xl text-sm font-bold transition-all whitespace-nowrap ${selectedCategory === cat.id ? 'bg-gray-900 text-white shadow-lg shadow-gray-900/20' : 'bg-white text-gray-500 hover:bg-gray-50 border border-gray-200'}`}
                            >
                                {cat.label}
                            </button>
                        ))}
                    </div>

                    {/* Secondary Filter: Usage (Sub-category) */}
                    <div className="flex gap-2 w-full">
                        {usages.map(u => (
                            <button
                                key={u.id}
                                onClick={() => setSelectedUsage(u.id)}
                                className={`flex-1 md:flex-none px-4 py-2 rounded-lg text-xs font-bold uppercase tracking-wider transition-all ${selectedUsage === u.id ? 'bg-blue-100 text-blue-700 ring-1 ring-blue-200' : 'bg-gray-50 text-gray-400 hover:bg-gray-100'}`}
                            >
                                {u.label}
                            </button>
                        ))}
                    </div>
                </div>

                {/* Products Table */}
                <div className="bg-white rounded-2xl border border-gray-200 shadow-sm overflow-hidden">
                    <div className="overflow-x-auto">
                        <table className="w-full text-left border-collapse">
                            <thead>
                                <tr className="bg-gray-50/50 border-b border-gray-100 text-xs text-gray-500 uppercase tracking-wide">
                                    <th className="px-6 py-4 font-bold">Product</th>
                                    <th className="px-6 py-4 font-bold">Category</th>
                                    <th className="px-6 py-4 font-bold text-center">Variants</th>
                                    <th className="px-6 py-4 font-bold text-center">Price (Base)</th>
                                    <th className="px-6 py-4 font-bold text-right">Actions</th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-gray-100">
                                {filteredProducts.length === 0 ? (
                                    <tr>
                                        <td colSpan="5" className="px-6 py-20 text-center text-gray-400">
                                            No products found matching your search.
                                        </td>
                                    </tr>
                                ) : filteredProducts.map((p) => (
                                    <tr key={p.id} className="group hover:bg-blue-50/30 transition-colors">
                                        <td className="px-6 py-4">
                                            <div className="flex items-center gap-4">
                                                <div className="w-12 h-12 bg-gray-50 rounded-lg p-1 border border-gray-100 relative overflow-hidden group-hover:border-blue-200 transition-colors">
                                                    <img src={p.image} alt={p.name} className="w-full h-full object-contain mix-blend-multiply" />
                                                </div>
                                                <div>
                                                    <div className="font-bold text-gray-900">{p.name}</div>
                                                    <div className="text-xs text-gray-500">{p.sku || 'No SKU'}</div>
                                                </div>
                                            </div>
                                        </td>
                                        <td className="px-6 py-4">
                                            <span className="px-2.5 py-1 rounded-md bg-gray-100 text-gray-600 text-xs font-bold uppercase tracking-wider border border-gray-200">
                                                {categories.find(c => c.id === p.category)?.label || p.category}
                                            </span>
                                        </td>
                                        <td className="px-6 py-4 text-center">
                                            <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${p.variants?.length > 0 ? 'bg-purple-100 text-purple-800' : 'bg-gray-100 text-gray-600'}`}>
                                                {p.variants?.length || 0} Variants
                                            </span>
                                        </td>
                                        <td className="px-6 py-4 text-center font-mono text-sm text-gray-600">
                                            {p.priceFull || p.price || '-'}
                                        </td>
                                        <td className="px-6 py-4 text-right">
                                            <div className="flex items-center justify-end gap-2 opacity-100 transition-opacity">
                                                <button
                                                    onClick={() => setEditModal({ open: true, product: p })}
                                                    className="w-8 h-8 flex items-center justify-center rounded-lg text-gray-400 hover:text-blue-600 hover:bg-blue-50 transition-colors"
                                                    title="Edit Product Name"
                                                >
                                                    <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z" /></svg>
                                                </button>
                                                <button
                                                    onClick={() => setVariantsModal({ open: true, product: p })}
                                                    className="px-3 py-1.5 rounded-lg text-xs font-bold text-blue-600 bg-blue-50 hover:bg-blue-100 transition-colors border border-blue-100"
                                                >
                                                    Manage Variants
                                                </button>
                                                <button
                                                    onClick={() => setDeleteModal({ open: true, product: p })}
                                                    className="w-8 h-8 flex items-center justify-center rounded-lg text-gray-400 hover:text-red-600 hover:bg-red-50 transition-colors"
                                                    title="Delete Product"
                                                >
                                                    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"></path></svg>
                                                </button>
                                            </div>
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                </div>
            </main>

            {/* Modals */}
            <EditProductModal
                isOpen={editModal.open}
                onClose={() => setEditModal({ open: false, product: null })}
                product={editModal.product}
            />

            <ConfirmationModal
                isOpen={deleteModal.open}
                onClose={() => setDeleteModal({ open: false, product: null })}
                onConfirm={confirmDeleteProduct}
                title="Delete Product"
                message={`Are you sure you want to delete "${deleteModal.product?.name}"? This will permanently remove the product and ALL its variants. This action cannot be undone.`}
                confirmText="Delete Permanently"
                confirmStyle="danger"
            />

            <ManageVariantsModal
                isOpen={variantsModal.open}
                onClose={() => setVariantsModal({ open: false, product: null })}
                product={variantsModal.product}
            />

        </div>
    );
}
