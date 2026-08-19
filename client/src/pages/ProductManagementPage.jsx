import { useState } from 'react';
import { useLocation } from 'react-router-dom';
import { ManageProductsTab } from './AdminProductsPage';
import { AddProductTab } from './AddProductPage';

// Admin/CEO's merged view of product-related work — one sidebar entry
// instead of two, same idea as Debt Management (Collect Debt/Dues Follow-Up
// tabs) and Tool Tracking (Worker Loans/Check Out/Return/Catalog tabs).
export default function ProductManagementPage() {
    const location = useLocation();
    // Dashboards' "Add Product" quick actions land straight on the Add
    // Product tab via navigate(..., { state: { tab: 'add' } }); everything
    // else (sidebar nav, direct URL) defaults to Manage Products.
    const [activeTab, setActiveTab] = useState(location.state?.tab === 'add' ? 'add' : 'manage');

    const tabs = [
        { id: 'manage', label: 'Manage Products', color: '#f59e0b' },
        { id: 'add', label: 'Add Product', color: '#3b82f6' },
    ];

    return (
        <div style={{ display: 'flex', flexDirection: 'column', height: '100%', background: 'var(--color-bg)' }}>
            {/* Header */}
            <div style={{
                padding: 'clamp(1rem, 4vw, 1.5rem) clamp(1rem, 5vw, 2rem) 0',
                background: 'rgba(9,14,26,0.8)',
                backdropFilter: 'blur(20px)',
                position: 'sticky', top: 0, zIndex: 20,
            }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', marginBottom: '0.25rem' }}>
                    <div style={{ width: '8px', height: '8px', borderRadius: '50%', background: '#f59e0b', boxShadow: '0 0 8px rgba(245,158,11,0.8)' }} />
                    <h1 style={{ fontSize: '1.375rem', fontWeight: 800, color: '#f1f5f9', margin: 0, letterSpacing: '-0.025em' }}>Product Management</h1>
                </div>
                <p style={{ fontSize: '0.78rem', color: '#475569', margin: 0, marginLeft: '1.25rem', marginBottom: '1rem', fontWeight: 500 }}>Create products, expand existing lines & manage the catalog</p>

                {/* Tabs */}
                <div style={{ borderBottom: '1px solid rgba(255,255,255,0.06)', display: 'flex', gap: '0.25rem' }}>
                    {tabs.map(tab => (
                        <button
                            key={tab.id}
                            onClick={() => setActiveTab(tab.id)}
                            style={{
                                padding: '0.75rem 0.25rem', marginRight: '1.5rem',
                                background: 'none', border: 'none', cursor: 'pointer',
                                fontSize: '0.875rem', fontWeight: 700,
                                color: activeTab === tab.id ? '#f1f5f9' : '#475569',
                                borderBottom: activeTab === tab.id ? `2px solid ${tab.color}` : '2px solid transparent',
                                transition: 'all 0.2s',
                            }}
                        >
                            {tab.label}
                        </button>
                    ))}
                </div>
            </div>

            {/* Content */}
            <div style={{ flex: 1, overflowY: 'auto' }} className="custom-scrollbar">
                {activeTab === 'manage' && <ManageProductsTab onAddProduct={() => setActiveTab('add')} />}
                {activeTab === 'add' && <AddProductTab />}
            </div>
        </div>
    );
}
