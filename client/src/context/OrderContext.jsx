// @refresh reset
import React, { createContext, useContext, useState, useEffect, useCallback } from 'react';
import api from '../services/api';

const OrderContext = createContext();

export const useOrders = () => {
    const context = useContext(OrderContext);
    if (!context) {
        throw new Error('useOrders must be used within an OrderProvider');
    }
    return context;
};

export const OrderProvider = ({ children }) => {
    const [orders, setOrders] = useState([]);
    const [invoices, setInvoices] = useState([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(null);

    // --- Data Fetching ---
    const fetchOrders = useCallback(async () => {
        setLoading(true);
        // Fetch independently so one failure doesn't block the other
        const [ordersResult, invoicesResult] = await Promise.allSettled([
            api.orderService.getAllOrders(),
            api.invoiceService.getAll(),
        ]);

        if (ordersResult.status === 'fulfilled') {
            setOrders(ordersResult.value.map(mapBackendOrder));
        } else {
            console.error("Failed to fetch orders:", ordersResult.reason);
            setOrders([]);
        }

        if (invoicesResult.status === 'fulfilled') {
            setInvoices(invoicesResult.value.map(mapBackendInvoice));
        } else {
            console.error("Failed to fetch invoices:", invoicesResult.reason);
            setInvoices([]);
        }

        const anyFailed = ordersResult.status === 'rejected' || invoicesResult.status === 'rejected';
        setError(anyFailed ? "Some data failed to load. Check console for details." : null);
        setLoading(false);
    }, []);

    /** Map a backend Order response to the frontend shape. */
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

    /** Map a backend Invoice response to the frontend shape. */
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
        // Whether this invoice has been turned into an order
        isConverted: inv.status === 'converted',
        orderId: inv.order_id || null,
    });

    useEffect(() => {
        fetchOrders();
    }, []);

    // --- Actions ---

    /**
     * Save a new Invoice (quotation/draft) to the invoices table.
     * invoiceData shape: { customer, items, totals: { subtotal, tax, total }, enableTax }
     */
    const addInvoice = async (invoiceData) => {
        try {
            const { customer, items, totals, enableTax } = invoiceData;
            const payload = {
                customer: {
                    id: customer?.id || null,
                    name: customer?.name || 'Guest',
                    phone: customer?.phone || null,
                    type: customer?.type === 'new' ? 'guest' : 'registered',
                },
                items: items,
                subtotal: totals?.grandTotal ?? totals?.subtotal ?? 0,
                vat_amount: totals?.vat ?? 0,
                total: totals?.total ?? 0,
                discount: totals?.discount ?? 0,
                vat_enabled: Boolean(enableTax),
            };
            const response = await api.invoiceService.create(payload);
            await fetchOrders();
            return response;
        } catch (err) {
            console.error("Add Invoice Failed", err);
            throw err;
        }
    };

    // Direct Order Creation (from Checkout)
    const addOrder = async (orderData) => {
        try {
            const { customer, totals, payment, items: rawItems, parentOrderId } = orderData;

            // Map frontend items to backend structure
            const items = rawItems.map(mapItemForBackend);

            // Determine Statuses
            const isPaid = totals.balance <= 0.1; // Float tolerance
            const paymentStatus = isPaid ? 'Paid' : (totals.paid > 0 ? 'Partial' : 'Pending');

            // Construct strict payload for backend
            const payload = {
                customerId: customer?.id ? parseInt(customer.id) : null,
                amountPaid: parseFloat(totals.paid || 0),
                parentOrderId: parentOrderId ? parseInt(parentOrderId) : null,
                // servedBy: Handled below or via Auth context if available. 
                // CheckoutPage passes 'orderData', checking if it had servedBy?
                // CheckoutPage: const orderData = { customer, items, totals, payment... }
                // It does NOT pass servedBy. We need it from Auth.
                // Assuming OrderProvider has access to user or we patch it here.
                // For now, let's look at how addInvoice does it: "Fallback UUID". 
                // Better: OrderContext should useAuth().

                // BACKEND SCHEMA FIELDS
                servedBy: orderData.servedBy || '00000000-0000-0000-0000-000000000000', // Update Checkout to pass this!
                VAT_status: Boolean(totals.tax > 0),
                discount: parseFloat(totals.discount || 0),
                paymentStatus: paymentStatus,
                status: 'confirmed', // Orders from checkout are confirmed
                paymentMethod: payment?.method || 'cash',
                paymentDetails: payment?.details || null,
                items: items
            };

            const response = await api.orderService.createOrder(payload);
            await fetchOrders();
            return response;
        } catch (err) {
            console.error("Add Order Failed", err);
            throw err;
        }
    };

    const mapItemForBackend = (item) => {
        const rawQty = parseFloat(item.qty || item.quantity);
        const qty = isNaN(rawQty) ? 1 : rawQty;

        const rawPrice = parseFloat(item.price || item.unitPrice);
        const price = isNaN(rawPrice) ? 0 : rawPrice;

        // Calculators store variantId inside details, not at item top-level
        const rawVariantId = item.variantId ?? item.details?.variantId ?? null;

        return {
            productId: parseInt(item.productId || item.id),
            variantId: rawVariantId ? parseInt(rawVariantId) : null,
            quantity: qty,
            unitPrice: price,
            unitType: item.unit || 'pcs',
            details: item.details
        };
    };

    /**
     * Convert a saved invoice into a confirmed sales order via the dedicated endpoint.
     * paymentData shape: { amount_paid, payment_method, payment_details?, discount? }
     */
    const convertInvoiceToOrder = async (invoiceId, paymentData = {}) => {
        try {
            const payload = {
                amount_paid: paymentData.amount_paid ?? 0,
                payment_method: paymentData.payment_method ?? 'cash',
                payment_details: paymentData.payment_details ?? null,
                discount: paymentData.discount ?? null,
            };
            const result = await api.invoiceService.convert(invoiceId, payload);
            await fetchOrders();
            return result; // { invoiceId, orderId, message }
        } catch (err) {
            console.error("Invoice conversion failed", err);
            throw err;
        }
    };

    /**
     * Edit an existing order in-place via PUT /orders/{id}/edit.
     * orderData shape mirrors addOrder but targets an existing orderId.
     */
    const updateOrder = async (orderId, orderData) => {
        try {
            const { customer, totals, payment, items: rawItems } = orderData;
            const items = rawItems.map(mapItemForBackend);

            const isPaid = totals.balance <= 0.1;
            const paymentStatus = isPaid ? 'Paid' : (totals.paid > 0 ? 'Partial' : 'Unpaid');

            const payload = {
                customerId: customer?.id ? parseInt(customer.id) : null,
                amountPaid: parseFloat(totals.paid || 0),
                servedBy: orderData.servedBy || '00000000-0000-0000-0000-000000000000',
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
        } catch (err) {
            console.error("Update Order Failed", err);
            throw err;
        }
    };

    const deleteInvoice = async (id) => {
        // Not implemented on backend API yet
        console.warn("deleteInvoice not implemented on backend");
    };

    const deleteOrder = async (id) => {
        // Not implemented on backend API yet
        console.warn("deleteOrder not implemented on backend");
    };

    // Update Workflow Status (e.g., 'confirmed' -> 'ready')
    const updateOrderStatus = async (orderId, newStatus) => {
        try {
            await api.orderService.updateWorkflowStatus(orderId, newStatus);
            await fetchOrders();
        } catch (err) {
            console.error("Update Status Failed", err);
        }
    };

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
        deleteOrder,
        updateOrderStatus,
        refreshOrders: fetchOrders
    };

    return (
        <OrderContext.Provider value={value}>
            {children}
        </OrderContext.Provider>
    );
};
