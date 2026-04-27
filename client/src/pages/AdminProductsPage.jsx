import { useState, useMemo } from 'react';
import { useProducts } from '../context/ProductContext';
import ConfirmationModal from '../components/common/ConfirmationModal';
import ManageVariantsModal from '../components/inventory/ManageVariantsModal';
import EditProductModal from '../components/inventory/EditProductModal';
import { useNavigate } from 'react-router-dom';

const SUB_CATEGORIES = {
    'ke-profile': [{ id: 'window', label: 'Windows' }, { id: 'door', label: 'Doors' }, { id: 'general', label: 'General' }],
    'tz-profile': [{ id: 'window', label: 'Windows' }, { id: 'door', label: 'Doors' }, { id: 'general', label: 'General' }],
    'glass': [{ id: 'clear', label: 'Clear' }, { id: 'oneway', label: 'One/Way' }, { id: 'tint', label: 'Tinted' }, { id: 'mirror', label: 'Mirror' }, { id: 'frost', label: 'Frost' }, { id: 'obscure', label: 'Obscure' }, { id: 'alucoboard', label: 'Alucoboard' }],
    'accessories': [{ id: 'general', label: 'General' }],
};

export default function AdminProductsPage() {
    const { products, deleteProduct, categories } = useProducts();
    const navigate = useNavigate();

    const [selectedCategory, setSelectedCategory] = useState(() => (categories?.length > 0 ? categories[0].id : 'ke-profile'));
    const [selectedUsage, setSelectedUsage] = useState('window');

    const usages = useMemo(() => SUB_CATEGORIES[selectedCategory] || [], [selectedCategory]);

    const [deleteModal, setDeleteModal] = useState({ open: false, product: null });
    const [variantsModal, setVariantsModal] = useState({ open: false, product: null });
    const [editModal, setEditModal] = useState({ open: false, product: null });

    const filteredProducts = useMemo(() => products.filter(p =>
        p.category === selectedCategory &&
        (p.subCategory === selectedUsage || (!p.subCategory && selectedUsage === 'general'))
    ), [products, selectedCategory, selectedUsage]);

    const confirmDeleteProduct = () => {
        if (deleteModal.product) { deleteProduct(deleteModal.product.id); setDeleteModal({ open: false, product: null }); }
    };

    const statCards = [
        { label: 'Total Products', value: products.length, icon: '📦', color: '#3b82f6' },
        { label: 'Variants', value: products.reduce((acc, p) => acc + (p.variants?.length || 0), 0), icon: '🧬', color: '#a855f7' },
        { label: 'Categories', value: categories.length, icon: '📂', color: '#f59e0b' },
    ];

    return (
        <div style={{ display: 'flex', flexDirection: 'column', height: '100%', background: 'var(--color-bg)' }}>

            {/* Header */}
            <header style={{
                padding: '1.25rem 2rem', borderBottom: '1px solid rgba(255,255,255,0.07)',
                background: 'rgba(9,14,26,0.9)', backdropFilter: 'blur(20px)',
                display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                position: 'sticky', top: 0, zIndex: 30,
            }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
                    <div style={{
                        width: '40px', height: '40px', borderRadius: '10px',
                        background: 'linear-gradient(135deg, rgba(245,158,11,0.2), rgba(234,88,12,0.15))',
                        border: '1px solid rgba(245,158,11,0.3)',
                        display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '1.1rem',
                    }}>👑</div>
                    <div>
                        <h1 style={{ fontSize: '1.125rem', fontWeight: 800, color: '#f1f5f9', margin: 0 }}>Product Management</h1>
                        <p style={{ fontSize: '0.7rem', color: '#475569', margin: 0, fontWeight: 600, letterSpacing: '0.08em', textTransform: 'uppercase' }}>CEO Control Center</p>
                    </div>
                </div>
                <button onClick={() => navigate('/add-product')} style={{
                    padding: '0.625rem 1.5rem', borderRadius: '0.75rem', border: 'none', cursor: 'pointer',
                    background: 'linear-gradient(135deg, #3b82f6, #06b6d4)',
                    color: '#fff', fontWeight: 800, fontSize: '0.82rem',
                    boxShadow: '0 4px 16px rgba(59,130,246,0.3)', transition: 'all 0.2s',
                }}
                onMouseEnter={e => { e.currentTarget.style.transform = 'translateY(-1px)'; }}
                onMouseLeave={e => { e.currentTarget.style.transform = 'translateY(0)'; }}
                >+ Add Product</button>
            </header>

            <div style={{ flex: 1, overflowY: 'auto', padding: '1.5rem 2rem' }} className="custom-scrollbar">

                {/* Stats */}
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '1rem', marginBottom: '1.5rem' }}>
                    {statCards.map(s => (
                        <div key={s.label} style={{
                            background: 'linear-gradient(135deg, rgba(255,255,255,0.05), rgba(255,255,255,0.02))',
                            border: '1px solid rgba(255,255,255,0.08)', borderRadius: '1rem',
                            padding: '1.25rem', display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                        }}>
                            <div>
                                <p style={{ fontSize: '0.65rem', fontWeight: 700, color: '#475569', letterSpacing: '0.08em', textTransform: 'uppercase', margin: '0 0 4px' }}>{s.label}</p>
                                <h3 style={{ fontSize: '2rem', fontWeight: 900, color: '#f1f5f9', margin: 0, fontFamily: 'var(--font-mono)', letterSpacing: '-0.02em' }}>{s.value}</h3>
                            </div>
                            <div style={{ width: '44px', height: '44px', borderRadius: '10px', background: `${s.color}15`, border: `1px solid ${s.color}25`, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '1.25rem' }}>{s.icon}</div>
                        </div>
                    ))}
                </div>

                {/* Filters */}
                <div style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.07)', borderRadius: '1rem', padding: '1rem', marginBottom: '1rem' }}>
                    <div style={{ display: 'flex', gap: '4px', marginBottom: '0.75rem', paddingBottom: '0.75rem', borderBottom: '1px solid rgba(255,255,255,0.06)', overflowX: 'auto' }} className="scrollbar-hide">
                        {categories.map(cat => (
                            <button key={cat.id} onClick={() => setSelectedCategory(cat.id)} style={{
                                padding: '0.5rem 1.25rem', borderRadius: '0.625rem', border: 'none', cursor: 'pointer', whiteSpace: 'nowrap',
                                background: selectedCategory === cat.id ? 'linear-gradient(135deg, #3b82f6, #06b6d4)' : 'rgba(255,255,255,0.05)',
                                color: selectedCategory === cat.id ? '#fff' : '#64748b',
                                fontWeight: 700, fontSize: '0.8rem', transition: 'all 0.2s',
                            }}>{cat.label}</button>
                        ))}
                    </div>
                    <div style={{ display: 'flex', gap: '0.375rem', flexWrap: 'wrap' }}>
                        {usages.map(u => (
                            <button key={u.id} onClick={() => setSelectedUsage(u.id)} style={{
                                padding: '0.3rem 1rem', borderRadius: '100px', fontSize: '0.72rem', fontWeight: 700, cursor: 'pointer',
                                border: `1px solid ${selectedUsage === u.id ? 'rgba(59,130,246,0.4)' : 'rgba(255,255,255,0.08)'}`,
                                background: selectedUsage === u.id ? 'rgba(59,130,246,0.12)' : 'transparent',
                                color: selectedUsage === u.id ? '#60a5fa' : '#64748b',
                                transition: 'all 0.15s', textTransform: 'uppercase', letterSpacing: '0.06em',
                            }}>{u.label}</button>
                        ))}
                    </div>
                </div>

                {/* Products Table */}
                <div style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.07)', borderRadius: '1rem', overflow: 'hidden' }}>
                    <div style={{ overflowX: 'auto' }}>
                        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                            <thead>
                                <tr style={{ borderBottom: '1px solid rgba(255,255,255,0.07)' }}>
                                    {['Product', 'Category', 'Variants', 'Price (Base)', 'Actions'].map((h, i) => (
                                        <th key={h} style={{
                                            padding: '0.875rem 1.25rem', textAlign: i >= 2 ? 'center' : 'left',
                                            fontSize: '0.65rem', fontWeight: 700, color: '#475569',
                                            letterSpacing: '0.08em', textTransform: 'uppercase',
                                            background: 'rgba(0,0,0,0.2)',
                                        }}>{h}</th>
                                    ))}
                                </tr>
                            </thead>
                            <tbody>
                                {filteredProducts.length === 0 ? (
                                    <tr><td colSpan={5} style={{ padding: '3rem', textAlign: 'center', color: '#334155', fontSize: '0.875rem' }}>No products found</td></tr>
                                ) : filteredProducts.map(p => (
                                    <tr key={p.id} style={{ borderBottom: '1px solid rgba(255,255,255,0.04)', transition: 'background 0.15s' }}
                                    onMouseEnter={e => { e.currentTarget.style.background = 'rgba(59,130,246,0.04)'; }}
                                    onMouseLeave={e => { e.currentTarget.style.background = 'transparent'; }}
                                    >
                                        <td style={{ padding: '0.875rem 1.25rem' }}>
                                            <div style={{ display: 'flex', alignItems: 'center', gap: '0.875rem' }}>
                                                <div style={{ width: '44px', height: '44px', borderRadius: '10px', background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.09)', overflow: 'hidden', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                                                    <img src={p.image} alt={p.name} style={{ width: '80%', height: '80%', objectFit: 'contain', mixBlendMode: 'luminosity', opacity: 0.85 }} />
                                                </div>
                                                <div>
                                                    <div style={{ fontSize: '0.875rem', fontWeight: 700, color: '#e2e8f0' }}>{p.name}</div>
                                                    {p.itemCode && <div style={{ fontSize: '0.7rem', color: '#475569', fontFamily: 'var(--font-mono)', marginTop: '2px' }}>{p.itemCode}</div>}
                                                </div>
                                            </div>
                                        </td>
                                        <td style={{ padding: '0.875rem 1.25rem' }}>
                                            <span style={{ fontSize: '0.68rem', fontWeight: 700, background: 'rgba(255,255,255,0.07)', border: '1px solid rgba(255,255,255,0.1)', color: '#64748b', borderRadius: '6px', padding: '3px 10px', textTransform: 'uppercase', letterSpacing: '0.06em' }}>
                                                {categories.find(c => c.id === p.category)?.label || p.category}
                                            </span>
                                        </td>
                                        <td style={{ padding: '0.875rem 1.25rem', textAlign: 'center' }}>
                                            <span style={{
                                                fontSize: '0.72rem', fontWeight: 700, borderRadius: '100px', padding: '3px 10px',
                                                background: p.variants?.length > 0 ? 'rgba(168,85,247,0.12)' : 'rgba(255,255,255,0.06)',
                                                border: `1px solid ${p.variants?.length > 0 ? 'rgba(168,85,247,0.25)' : 'rgba(255,255,255,0.08)'}`,
                                                color: p.variants?.length > 0 ? '#c084fc' : '#475569',
                                            }}>{p.variants?.length || 0} Variants</span>
                                        </td>
                                        <td style={{ padding: '0.875rem 1.25rem', textAlign: 'center', fontFamily: 'var(--font-mono)', fontSize: '0.82rem', color: '#94a3b8' }}>
                                            {p.priceFull || p.price || '—'}
                                        </td>
                                        <td style={{ padding: '0.875rem 1.25rem' }}>
                                            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: '0.375rem' }}>
                                                <button onClick={() => setEditModal({ open: true, product: p })} style={{
                                                    width: '32px', height: '32px', borderRadius: '8px', border: 'none', cursor: 'pointer',
                                                    background: 'transparent', color: '#475569', display: 'flex', alignItems: 'center', justifyContent: 'center', transition: 'all 0.15s',
                                                }}
                                                onMouseEnter={e => { e.currentTarget.style.background = 'rgba(59,130,246,0.12)'; e.currentTarget.style.color = '#60a5fa'; }}
                                                onMouseLeave={e => { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.color = '#475569'; }}
                                                title="Edit">
                                                    <svg className="w-4 h-4" width="16" height="16" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z" /></svg>
                                                </button>
                                                <button onClick={() => setVariantsModal({ open: true, product: p })} style={{
                                                    padding: '0.375rem 0.875rem', borderRadius: '8px', border: '1px solid rgba(59,130,246,0.25)', cursor: 'pointer',
                                                    background: 'rgba(59,130,246,0.1)', color: '#60a5fa', fontSize: '0.72rem', fontWeight: 700, transition: 'all 0.15s',
                                                }}
                                                onMouseEnter={e => { e.currentTarget.style.background = 'rgba(59,130,246,0.2)'; }}
                                                onMouseLeave={e => { e.currentTarget.style.background = 'rgba(59,130,246,0.1)'; }}
                                                >Manage Variants</button>
                                                <button onClick={() => setDeleteModal({ open: true, product: p })} style={{
                                                    width: '32px', height: '32px', borderRadius: '8px', border: 'none', cursor: 'pointer',
                                                    background: 'transparent', color: '#475569', display: 'flex', alignItems: 'center', justifyContent: 'center', transition: 'all 0.15s',
                                                }}
                                                onMouseEnter={e => { e.currentTarget.style.background = 'rgba(239,68,68,0.12)'; e.currentTarget.style.color = '#f87171'; }}
                                                onMouseLeave={e => { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.color = '#475569'; }}
                                                title="Delete">
                                                    <svg width="16" height="16" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" /></svg>
                                                </button>
                                            </div>
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                </div>
            </div>

            <EditProductModal isOpen={editModal.open} onClose={() => setEditModal({ open: false, product: null })} product={editModal.product ? products.find(p => p.id === editModal.product.id) || editModal.product : null} />
            <ConfirmationModal isOpen={deleteModal.open} onClose={() => setDeleteModal({ open: false, product: null })} onConfirm={confirmDeleteProduct} title="Delete Product" message={`Are you sure you want to delete "${deleteModal.product?.name}"? This will permanently remove all variants.`} confirmText="Delete Permanently" confirmStyle="danger" />
            <ManageVariantsModal isOpen={variantsModal.open} onClose={() => setVariantsModal({ open: false, product: null })} product={variantsModal.product ? products.find(p => p.id === variantsModal.product.id) || variantsModal.product : null} />
        </div>
    );
}
