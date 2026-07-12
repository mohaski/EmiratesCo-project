// @refresh reset
import React, { createContext, useContext, useState, useEffect, useCallback, useRef } from 'react';
import api from '../services/api';
import { wsEvents } from '../utils/wsEvents';

const OrderContext = createContext();

export const useOrders = () => {
    const context = useContext(OrderContext);
    if (!context) throw new Error('useOrders must be used within an OrderProvider');
    return context;
};

// ── Pure mappers (outside component — stable, no closure over state) ──────────

const mapBackendOrder = (o) => ({
    ...o,
    id: o.orderId,
    date: o.created_at,
    customer: {
        id: o.customerId,
        name: o.customerName || (o.customerId ? `Customer #${o.customerId}` : 'Walk-in Customer'),
    },
    fromInvoice: !!o.source_invoice_id,
    sourceInvoiceId: o.source_invoice_id || null,
});

const mapBackendInvoice = (inv) => ({
    ...inv,
    id: inv.invoiceId,
    date: inv.created_at,
    customer: {
        id: inv.customer_id,
        name: inv.customer_name || `Customer #${inv.customer_id}`,
        phone: inv.customer_phone,
        type: inv.customer_type,
    },
    isConverted: inv.status === 'converted',
    orderId: inv.order_id || null,
});

const mapItemForBackend = (item) => {
    const rawQty = parseFloat(item.qty || item.quantity);
    const qty = isNaN(rawQty) ? 1 : rawQty;

    const rawPrice = parseFloat(item.price || item.unitPrice);
    const price = isNaN(rawPrice) ? 0 : rawPrice;

    const rawVariantId = item.variantId ?? item.details?.variantId ?? null;

    return {
        productId: parseInt(item.productId || item.id),
        variantId: rawVariantId ? parseInt(rawVariantId) : null,
        quantity: qty,
        unitPrice: price,
        unitType: item.unit || 'pcs',
        details: item.details,
    };
};

// ── Provider ──────────────────────────────────────────────────────────────────

export const OrderProvider = ({ children }) => {
    const [orders, setOrders] = useState([]);
    const [invoices, setInvoices] = useState([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(null);

    // Prevent overlapping concurrent fetches
    const fetchingRef = useRef(false);

    const fetchOrders = useCallback(async ({ showLoading = false } = {}) => {
        if (fetchingRef.current) return;
        fetchingRef.current = true;
        if (showLoading) setLoading(true);
        try {
            const [ordersResult, invoicesResult] = await Promise.allSettled([
                api.orderService.getAllOrders(),
                api.invoiceService.getAll(),
            ]);

            if (ordersResult.status === 'fulfilled') {
                setOrders(ordersResult.value.map(mapBackendOrder));
            } else {
                console.error('Failed to fetch orders:', ordersResult.reason);
                setOrders([]);
            }

            if (invoicesResult.status === 'fulfilled') {
                setInvoices(invoicesResult.value.map(mapBackendInvoice));
            } else {
                console.error('Failed to fetch invoices:', invoicesResult.reason);
                setInvoices([]);
            }

            const anyFailed = ordersResult.status === 'rejected' || invoicesResult.status === 'rejected';
            setError(anyFailed ? 'Some data failed to load.' : null);
        } finally {
            setLoading(false);
            fetchingRef.current = false;
        }
    }, []); // eslint-disable-line react-hooks/exhaustive-deps

    // Initial load — [] is correct here since fetchOrders is stable (useCallback([]))
    useEffect(() => {
        fetchOrders({ showLoading: true });
    }, []); // eslint-disable-line react-hooks/exhaustive-deps

    // Silent background refresh on WS events (no loading flash)
    useEffect(() => {
        const off1 = wsEvents.on('orders_updated', () => fetchOrders());
        const off2 = wsEvents.on('invoices_updated', () => fetchOrders());
        return () => { off1(); off2(); };
    }, [fetchOrders]);

    // ── Actions ────────────────────────────────────────────────────────────────

    const addInvoice = useCallback(async (invoiceData) => {
        const { customer, items, totals, enableTax } = invoiceData;
        const parsedCustomerId = parseInt(customer?.id);
        const payload = {
            customer: {
                id: isNaN(parsedCustomerId) ? null : parsedCustomerId,
                name: customer?.name || 'Guest',
                phone: customer?.phone || null,
                type: customer?.type === 'new' ? 'guest' : 'registered',
            },
            items,
            subtotal: totals?.grandTotal ?? totals?.subtotal ?? 0,
            vat_amount: totals?.vat ?? 0,
            total: totals?.total ?? 0,
            discount: totals?.discount ?? 0,
            vat_enabled: Boolean(enableTax),
        };
        const response = await api.invoiceService.create(payload);
        // WS broadcast handles the refetch for other clients; do a local one too
        await fetchOrders();
        return response;
    }, [fetchOrders]);

    const addOrder = useCallback(async (orderData) => {
        const { customer, totals, payment, items: rawItems, parentOrderId, servedBy, sourceInvoiceId } = orderData;
        const items = rawItems.map(mapItemForBackend);

        const isPaid = totals.balance <= 0.1;
        const paymentStatus = isPaid ? 'Paid' : (totals.paid > 0 ? 'Partial' : 'Pending');

        const payload = {
            customerId: customer?.id ? parseInt(customer.id) : null,
            amountPaid: parseFloat(totals.paid || 0),
            parentOrderId: parentOrderId ? parseInt(parentOrderId) : null,
            sourceInvoiceId: sourceInvoiceId ? parseInt(sourceInvoiceId) : null,
            servedBy: servedBy || '00000000-0000-0000-0000-000000000000',
            VAT_status: Boolean(totals.tax > 0),
            discount: parseFloat(totals.discount || 0),
            paymentStatus,
            status: 'confirmed',
            paymentMethod: payment?.method || 'cash',
            paymentDetails: payment?.details || null,
            items,
        };

        const response = await api.orderService.createOrder(payload);
        await fetchOrders();
        return response;
    }, [fetchOrders]);

    const updateOrder = useCallback(async (orderId, orderData) => {
        const { customer, totals, payment, items: rawItems, servedBy } = orderData;
        const items = rawItems.map(mapItemForBackend);

        const isPaid = totals.balance <= 0.1;
        const paymentStatus = isPaid ? 'Paid' : (totals.paid > 0 ? 'Partial' : 'Unpaid');

        const payload = {
            customerId: customer?.id ? parseInt(customer.id) : null,
            amountPaid: parseFloat(totals.paid || 0),
            servedBy: servedBy || '00000000-0000-0000-0000-000000000000',
            VAT_status: Boolean(totals.tax > 0),
            discount: parseFloat(totals.discount || 0),
            paymentStatus,
            paymentMethod: payment?.method || 'cash',
            paymentDetails: payment?.details || null,
            items,
            notes: `Edited order #${orderId}`,
        };

        const response = await api.orderService.editOrder(orderId, payload);
        await fetchOrders();
        return response;
    }, [fetchOrders]);

    const convertInvoiceToOrder = useCallback(async (invoiceId, paymentData = {}) => {
        const payload = {
            amount_paid: paymentData.amount_paid ?? 0,
            payment_method: paymentData.payment_method ?? 'cash',
            payment_details: paymentData.payment_details ?? null,
            discount: paymentData.discount ?? null,
        };
        const result = await api.invoiceService.convert(invoiceId, payload);
        await fetchOrders();
        return result;
    }, [fetchOrders]);

    const updateOrderStatus = useCallback(async (orderId, newStatus) => {
        await api.orderService.updateWorkflowStatus(orderId, newStatus);
        await fetchOrders();
    }, [fetchOrders]);

    const deleteInvoice = useCallback(() => {
        console.warn('deleteInvoice not implemented on backend');
    }, []);

    // Cancelling requires the CEO-configured PIN; throws on wrong/missing PIN
    // so the caller (the cancel modal) can show an inline error.
    const cancelOrder = useCallback(async (orderId, pin) => {
        await api.orderService.cancelOrder(orderId, pin);
        await fetchOrders();
    }, [fetchOrders]);

    const value = {
        orders,
        invoices,
        loading,
        error,
        addInvoice,
        addOrder,
        updateOrder,
        convertInvoiceToOrder,
        deleteInvoice,
        cancelOrder,
        updateOrderStatus,
        refreshOrders: fetchOrders,
    };

    return (
        <OrderContext.Provider value={value}>
            {children}
        </OrderContext.Provider>
    );
};
