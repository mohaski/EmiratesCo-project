import { useOrders, mapBackendOrder } from '../context/OrderContext';
import api from '../services/api';
import { useCart } from '../context/CartContext';
import { useWindows } from '../context/WindowContext';
import { mapItemForBackend } from '../utils/orderItemMapping';
import { useAuth } from '../context/AuthContext';
import { ROUTE_ROLES } from '../config/routePermissions';
import { useNavigate, useLocation } from 'react-router-dom';
import { useState, useEffect, useCallback, useMemo, useDeferredValue } from 'react';
import OrderCard from '../components/orders/OrderCard';
import InvoiceCard from '../components/orders/InvoiceCard';
import SetCancelPinModal from '../components/orders/SetCancelPinModal';
import SaleWindowsToggle from '../components/windows/SaleWindowsToggle';
import CuttingQueueSection from '../components/orders/CuttingQueueSection';
import useCancelOrderFlow from '../hooks/useCancelOrderFlow';
import { showToast } from '../utils/toast';
import { parseServerDate } from '../utils/dates';

export default function OrdersPage() {
    const navigate = useNavigate();
    const location = useLocation();
    const { user } = useAuth();
    const { orders, invoices, loading, error, cancelOrder } = useOrders();
    // Returning from View/Convert can ask to land back on the Invoices tab, on the
    // exact card that was clicked — both come in via navigation state.
    const [activeTab, setActiveTab] = useState(() => location.state?.activeTab || 'orders');
    const [highlightId, setHighlightId] = useState(() => location.state?.highlightId ?? null);
    const [searchQuery, setSearchQuery] = useState('');
    const deferredQuery = useDeferredValue(searchQuery);
    // The cancel sequence (reversal plan -> cut confirmation -> PIN -> 409 retry) is shared
    // with OrderSummaryPage; see hooks/useCancelOrderFlow.
    const { startCancel, cancelFlowModals } = useCancelOrderFlow({ cancelOrder });
    const [showSetPin, setShowSetPin] = useState(false);
    const [cuttingQueueCount, setCuttingQueueCount] = useState(0);
    const canSetPin = user?.role === 'ceo' || user?.role === 'admin';
    const isCeo = user?.role === 'ceo';
    // CEO is read-only on Sales Orders — no Add To, Edit, or Cancel (mirrors
    // cashier's existing read-only + Add To, minus the Add To).
    const canManageOrders = ['manager', 'admin'].includes(user?.role);

    // Clear the highlight after a moment so it doesn't linger forever
    useEffect(() => {
        if (!highlightId) return;
        const t = setTimeout(() => setHighlightId(null), 3000);
        return () => clearTimeout(t);
    }, [highlightId]);

    const groupItemsByDate = useCallback((items) => {
        const groups = {};
        const sorted = [...items].sort((a, b) => parseServerDate(b.date) - parseServerDate(a.date));
        sorted.forEach(item => {
            const date = parseServerDate(item.date);
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

    // The list holds the most recent orders only. Searching for an order number that isn't
    // among them looks it up on the server, so an older order can still be found, edited
    // or cancelled from here.
    const [lookedUp, setLookedUp] = useState(null); // { id, order | null }
    const wantedId = activeTab === 'orders' && /^\d+$/.test(deferredQuery.trim()) ? Number(deferredQuery.trim()) : null;
    const inList = wantedId != null && orders.some(o => (o.orderNo ?? o.id) === wantedId);
    useEffect(() => {
        if (wantedId == null || inList) return undefined;
        let alive = true;
        api.orderService.getOrderByNumber(wantedId)
            .then(o => { if (alive) setLookedUp({ id: wantedId, order: mapBackendOrder(o) }); })
            .catch(() => { if (alive) setLookedUp({ id: wantedId, order: null }); });
        return () => { alive = false; };
    }, [wantedId, inList]);

    // A customer-name search also asks the server, which searches every order, not just the
    // newest page loaded here.
    const nameQuery = activeTab === 'orders' && wantedId == null && deferredQuery.trim().length >= 2 ? deferredQuery.trim() : null;
    const [nameHits, setNameHits] = useState({ q: null, orders: [] });
    useEffect(() => {
        if (!nameQuery) return undefined;
        let alive = true;
        api.orderService.getAllOrders(0, 200, nameQuery)
            .then(list => { if (alive) setNameHits({ q: nameQuery, orders: list.map(mapBackendOrder) }); })
            .catch(() => {});
        return () => { alive = false; };
    }, [nameQuery]);

    const groupedOrders = useMemo(() => {
        if (activeTab !== 'orders') return [];
        const lq = deferredQuery.toLowerCase();
        // People search by the number on the receipt (orderNo), which is not the internal id.
        const matches = orders.filter(o => !lq || String(o.orderNo ?? o.id).toLowerCase().includes(lq) || (o.customer?.name || '').toLowerCase().includes(lq));
        const extra = lookedUp && lookedUp.order && lookedUp.id === wantedId && !inList ? [lookedUp.order] : [];
        const shown = new Set(matches.map(o => o.id));
        const older = nameHits.q === nameQuery && nameQuery ? nameHits.orders.filter(o => !shown.has(o.id)) : [];
        return groupItemsByDate([...matches, ...extra, ...older]);
    }, [activeTab, deferredQuery, orders, groupItemsByDate, lookedUp, wantedId, inList, nameHits, nameQuery]);

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
            navigate('/sales', { state: { mode: 'edit', editNonce: Date.now(), orderData: { ...full, id: full.orderId, customer: order.customer } } });
        } catch (err) {
            console.error('Failed to fetch order for editing', err);
            // No fallback to the list row: it has no items and no version, so editing it opened
            // an empty cart whose save rebuilt the order from nothing.
            showToast('Could not load this order to edit it. Check the connection and try again.', 'error');
        }
    }, [navigate]);
    const handleViewOrder = useCallback(async (order) => {
        try {
            // List endpoint returns items=[]; fetch the full order for the summary view
            const full = await import('../services/api').then(m => m.default.orderService.getOrder(order.id));
            navigate('/orders/review', { state: { order: { ...full, id: full.orderId, customer: order.customer } } });
        } catch (err) {
            console.error('Failed to fetch order for summary view', err);
            navigate('/orders/review', { state: { order } });
        }
    }, [navigate]);

    const handleViewInvoice = useCallback((invoice) => navigate('/invoice/review', { state: { invoice } }), [navigate]);
    // Converting a quotation is a new sale: its items go into a sale window, which holds
    // their stock from this moment, and checkout confirms that window. If the stock isn't
    // there any more the window is not kept, and the reason is shown.
    // Windows switched off: checkout of the quotation's items, as before.
    const { enabled: windowsEnabled, openWindowWith } = useWindows();
    const { setSessionType, setEditSession, editSession } = useCart();
    const handleConvertInvoice = useCallback((invoice) => {
        if (!windowsEnabled) {
            navigate('/checkout', {
                state: {
                    cartItems: invoice.items,
                    customer: invoice.customer,
                    enableTax: invoice.vat_enabled ?? false,
                    sourceInvoiceId: invoice.id,
                    discount: invoice.discount ?? 0,
                },
            });
            return;
        }
        // A window is a new sale: an edit in progress would hide it, so it has to end first.
        if (editSession && !window.confirm(`Discard your changes to order #${editSession.orderNo ?? editSession.orderId}? Nothing has been saved.`)) return;
        setSessionType('sales');
        setEditSession(null);
        openWindowWith({
            items: (invoice.items || []).map(mapItemForBackend),
            customer: invoice.customer?.id || invoice.customer?.name ? invoice.customer : null,
            sourceInvoiceId: invoice.id,
            discount: invoice.discount ?? 0,
            VAT_status: invoice.vat_enabled ?? false,
        })
            .then(() => navigate('/checkout', { state: { window: true } }))
            .catch(() => {});
    }, [navigate, openWindowWith, setSessionType, setEditSession, editSession, windowsEnabled]);

    // CEO doesn't work quotations or the cutting floor — both tabs are
    // manager/cashier/admin only (mirrors '/invoice' + '/invoice/review'
    // already being off-limits to ceo in routePermissions.js).
    const tabs = [
        { id: 'orders', label: 'Sales Orders', color: '#3b82f6', count: orders.length },
        ...(isCeo ? [] : [{ id: 'invoices', label: 'Quotations', color: '#f59e0b', count: invoices.length }]),
        ...(isCeo ? [] : [{ id: 'cutting', label: 'Cutting Queue', color: '#22d3ee', count: cuttingQueueCount }]),
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
                padding: 'clamp(1rem, 4vw, 1.5rem) clamp(1rem, 5vw, 2rem)',
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

                {canSetPin && (
                    <button onClick={() => setShowSetPin(true)} style={{
                        padding: '0.625rem 1rem', borderRadius: '0.75rem',
                        background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.1)',
                        color: '#94a3b8', fontWeight: 700, fontSize: '0.78rem', cursor: 'pointer',
                        display: 'flex', alignItems: 'center', gap: '0.375rem', whiteSpace: 'nowrap',
                    }}>🔐 Set Cancel PIN</button>
                )}
                {canSetPin && <SaleWindowsToggle />}

                {activeTab !== 'cutting' && (
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
                )}
            </div>

            {/* Tabs */}
            <div style={{ padding: '0 clamp(1rem, 5vw, 2rem)', borderBottom: '1px solid rgba(255,255,255,0.06)', display: 'flex', gap: '0.25rem', overflowX: 'auto', flexWrap: 'nowrap' }} className="scrollbar-hide">
                {tabs.map(tab => (
                    <button
                        key={tab.id}
                        onClick={() => setActiveTab(tab.id)}
                        style={{
                            padding: '1rem 0.25rem', marginRight: '1.5rem', flexShrink: 0,
                            background: 'none', border: 'none', cursor: 'pointer',
                            fontSize: '0.875rem', fontWeight: 700, whiteSpace: 'nowrap',
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
            <div style={{ flex: 1, overflowY: 'auto', padding: 'clamp(1rem, 4vw, 1.5rem) clamp(1rem, 5vw, 2rem)' }} className="custom-scrollbar">
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
                                        <OrderCard key={order.id} order={order} onAddTo={isCeo ? undefined : handleAddTo} onEdit={ROUTE_ROLES['/sales'].includes(user?.role) ? handleEdit : undefined} onCancel={startCancel} onView={handleViewOrder} highlighted={String(order.id) === String(highlightId)} canManage={canManageOrders} />
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
                                        <InvoiceCard key={inv.id} invoice={inv} onView={handleViewInvoice} onConvert={handleConvertInvoice} highlighted={String(inv.id) === String(highlightId)} />
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
                {activeTab === 'cutting' && (
                    <CuttingQueueSection onCountChange={setCuttingQueueCount} />
                )}
            </div>

            {cancelFlowModals}
            {showSetPin && (
                <SetCancelPinModal onClose={() => setShowSetPin(false)} />
            )}
        </div>
    );
}
