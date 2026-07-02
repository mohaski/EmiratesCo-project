import { useOrders } from '../context/OrderContext';
import { useNavigate } from 'react-router-dom';
import { useState, useCallback, useMemo, useDeferredValue } from 'react';
import OrderCard from '../components/orders/OrderCard';
import InvoiceCard from '../components/orders/InvoiceCard';

export default function OrdersPage() {
    const navigate = useNavigate();
    const { orders, invoices, loading, error, convertInvoiceToOrder, deleteOrder, deleteInvoice } = useOrders();
    const [activeTab, setActiveTab] = useState('orders');
    const [searchQuery, setSearchQuery] = useState('');
    const deferredQuery = useDeferredValue(searchQuery);

    const groupItemsByDate = useCallback((items) => {
        const groups = {};
        const sorted = [...items].sort((a, b) => new Date(b.date) - new Date(a.date));
        sorted.forEach(item => {
            const date = new Date(item.date);
            const today = new Date();
            const yesterday = new Date();
            yesterday.setDate(yesterday.getDate() - 1);
            let key = date.toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' });
            if (date.toDateString() === today.toDateString()) key = 'Today';
            else if (date.toDateString() === yesterday.toDateString()) key = 'Yesterday';
            if (!groups[key]) groups[key] = [];
            groups[key].push(item);
        });
        return Object.entries(groups).map(([title, items]) => ({ title, items }));
    }, []);

    const groupedOrders = useMemo(() => {
        if (activeTab !== 'orders') return [];
        const lq = deferredQuery.toLowerCase();
        return groupItemsByDate(orders.filter(o => !lq || String(o.id).toLowerCase().includes(lq) || (o.customer?.name || '').toLowerCase().includes(lq)));
    }, [activeTab, deferredQuery, orders, groupItemsByDate]);

    const groupedInvoices = useMemo(() => {
        if (activeTab !== 'invoices') return [];
        const lq = deferredQuery.toLowerCase();
        return groupItemsByDate(invoices.filter(i => !lq || String(i.id).toLowerCase().includes(lq) || (i.customer?.name || '').toLowerCase().includes(lq)));
    }, [activeTab, deferredQuery, invoices, groupItemsByDate]);

    const handleAddTo = useCallback((order) => navigate('/sales', { state: { mode: 'link', parentOrderId: order.id, customer: order.customer } }), [navigate]);

    const handleEdit = useCallback(async (order) => {
        try {
            // Fetch the full order including items (list endpoint returns items=[])
            const full = await import('../services/api').then(m => m.default.orderService.getOrder(order.id));
            navigate('/sales', { state: { mode: 'edit', orderData: { ...full, id: full.orderId, customer: order.customer } } });
        } catch (err) {
            console.error('Failed to fetch order for editing', err);
            // Fallback with shallow data
            navigate('/sales', { state: { mode: 'edit', orderData: order } });
        }
    }, [navigate]);
    const handleViewInvoice = useCallback((invoice) => navigate('/invoice/review', { state: { invoice } }), [navigate]);
    const handleConvertInvoice = useCallback((invoice) => navigate('/checkout', {
        state: {
            cartItems: invoice.items,
            customer: invoice.customer,
            enableTax: invoice.vat_enabled ?? false,
            sourceInvoiceId: invoice.id,
        }
    }), [navigate]);

    const tabs = [
        { id: 'orders', label: 'Sales Orders', color: '#3b82f6', count: orders.length },
        { id: 'invoices', label: 'Quotations', color: '#f59e0b', count: invoices.length },
    ];

    return (
        <div style={{ display: 'flex', flexDirection: 'column', height: '100%', background: 'var(--color-bg)' }}>

            {/* Error Banner */}
            {error && (
                <div style={{ background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.3)', color: '#fca5a5', padding: '0.75rem 2rem', fontSize: '0.8rem', fontWeight: 600 }}>
                    {error}
                </div>
            )}

            {/* Loading state */}
            {loading && (
                <div style={{ textAlign: 'center', padding: '2rem', color: '#475569', fontSize: '0.875rem' }}>
                    Loading...
                </div>
            )}

            {/* Header */}
            <div style={{
                padding: '1.5rem 2rem',
                borderBottom: '1px solid rgba(255,255,255,0.07)',
                background: 'rgba(9,14,26,0.8)',
                backdropFilter: 'blur(20px)',
                position: 'sticky', top: 0, zIndex: 20,
                display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '1rem', flexWrap: 'wrap',
            }}>
                <div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', marginBottom: '0.25rem' }}>
                        <div style={{ width: '8px', height: '8px', borderRadius: '50%', background: '#3b82f6', boxShadow: '0 0 8px rgba(59,130,246,0.8)' }} />
                        <h1 style={{ fontSize: '1.375rem', fontWeight: 800, color: '#f1f5f9', margin: 0, letterSpacing: '-0.025em' }}>Order Management</h1>
                    </div>
                    <p style={{ fontSize: '0.78rem', color: '#475569', margin: 0, marginLeft: '1.25rem', fontWeight: 500 }}>Track sales & manage quotations</p>
                </div>

                <div style={{ position: 'relative', minWidth: '280px' }}>
                    <span style={{ position: 'absolute', left: '0.875rem', top: '50%', transform: 'translateY(-50%)', color: '#475569', fontSize: '0.875rem' }}>🔍</span>
                    <input
                        type="text"
                        placeholder="Search by order ID or customer..."
                        style={{
                            width: '100%', background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.1)',
                            borderRadius: '0.75rem', padding: '0.625rem 1rem 0.625rem 2.25rem',
                            color: '#e2e8f0', fontSize: '0.82rem', outline: 'none', transition: 'border-color 0.2s', boxSizing: 'border-box',
                        }}
                        value={searchQuery}
                        onChange={e => setSearchQuery(e.target.value)}
                        onFocus={e => { e.target.style.borderColor = 'rgba(59,130,246,0.5)'; }}
                        onBlur={e => { e.target.style.borderColor = 'rgba(255,255,255,0.1)'; }}
                    />
                </div>
            </div>

            {/* Tabs */}
            <div style={{ padding: '0 2rem', borderBottom: '1px solid rgba(255,255,255,0.06)', display: 'flex', gap: '0.25rem' }}>
                {tabs.map(tab => (
                    <button
                        key={tab.id}
                        onClick={() => setActiveTab(tab.id)}
                        style={{
                            padding: '1rem 0.25rem', marginRight: '1.5rem',
                            background: 'none', border: 'none', cursor: 'pointer',
                            fontSize: '0.875rem', fontWeight: 700,
                            color: activeTab === tab.id ? '#f1f5f9' : '#475569',
                            borderBottom: activeTab === tab.id ? `2px solid ${tab.color}` : '2px solid transparent',
                            transition: 'all 0.2s', display: 'flex', alignItems: 'center', gap: '0.5rem',
                        }}
                    >
                        {tab.label}
                        <span style={{
                            fontSize: '0.65rem', fontWeight: 700,
                            background: activeTab === tab.id ? `${tab.color}20` : 'rgba(255,255,255,0.06)',
                            border: `1px solid ${activeTab === tab.id ? `${tab.color}30` : 'rgba(255,255,255,0.08)'}`,
                            color: activeTab === tab.id ? tab.color : '#475569',
                            borderRadius: '100px', padding: '1px 7px',
                        }}>{tab.count}</span>
                    </button>
                ))}
            </div>

            {/* Content */}
            <div style={{ flex: 1, overflowY: 'auto', padding: '1.5rem 2rem' }} className="custom-scrollbar">
                {activeTab === 'orders' && (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '2rem' }}>
                        {groupedOrders.map(group => (
                            <div key={group.title}>
                                <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', marginBottom: '0.875rem' }}>
                                    <span style={{ fontSize: '0.65rem', fontWeight: 700, color: '#475569', letterSpacing: '0.1em', textTransform: 'uppercase' }}>{group.title}</span>
                                    <div style={{ flex: 1, height: '1px', background: 'rgba(255,255,255,0.05)' }} />
                                    <span style={{ fontSize: '0.65rem', color: '#334155', fontWeight: 600 }}>{group.items.length} orders</span>
                                </div>
                                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.625rem' }}>
                                    {group.items.map(order => (
                                        <OrderCard key={order.id} order={order} onAddTo={handleAddTo} onEdit={handleEdit} />
                                    ))}
                                </div>
                            </div>
                        ))}
                        {groupedOrders.length === 0 && (
                            <div style={{ textAlign: 'center', padding: '4rem 0', color: '#334155' }}>
                                <div style={{ fontSize: '3rem', marginBottom: '0.75rem', opacity: 0.4 }}>📋</div>
                                <p style={{ fontWeight: 500, fontSize: '0.875rem' }}>No orders found {searchQuery && `for "${searchQuery}"`}</p>
                            </div>
                        )}
                    </div>
                )}
                {activeTab === 'invoices' && (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '2rem' }}>
                        {groupedInvoices.map(group => (
                            <div key={group.title}>
                                <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', marginBottom: '0.875rem' }}>
                                    <span style={{ fontSize: '0.65rem', fontWeight: 700, color: '#475569', letterSpacing: '0.1em', textTransform: 'uppercase' }}>{group.title}</span>
                                    <div style={{ flex: 1, height: '1px', background: 'rgba(255,255,255,0.05)' }} />
                                </div>
                                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.625rem' }}>
                                    {group.items.map(inv => (
                                        <InvoiceCard key={inv.id} invoice={inv} onView={handleViewInvoice} onConvert={handleConvertInvoice} />
                                    ))}
                                </div>
                            </div>
                        ))}
                        {groupedInvoices.length === 0 && (
                            <div style={{ textAlign: 'center', padding: '4rem 0', color: '#334155' }}>
                                <div style={{ fontSize: '3rem', marginBottom: '0.75rem', opacity: 0.4 }}>📄</div>
                                <p style={{ fontWeight: 500, fontSize: '0.875rem' }}>No quotations found {searchQuery && `for "${searchQuery}"`}</p>
                            </div>
                        )}
                    </div>
                )}
            </div>
        </div>
    );
}
