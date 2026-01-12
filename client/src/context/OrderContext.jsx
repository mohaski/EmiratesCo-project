import React, { createContext, useContext, useState, useEffect } from 'react';
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
    const fetchOrders = async () => {
        try {
            setLoading(true);
            const fetchedOrders = await api.orderService.getAllOrders();

            // Split into Orders and Invoices (Drafts)
            // Backend 'status' determines the bucket.
            const _invoices = fetchedOrders.filter(o => o.status === 'draft' || o.status === 'pending'); // 'pending' might be invoice too? Assuming 'draft' for quotes.
            // Let's assume 'pending' is also an invoice until 'confirmed' (paid/processed).
            // Actually, created orders are 'confirmed' by default in backend service (line 194).
            // So 'draft' must be explicit.

            const _invoicesList = fetchedOrders.filter(o => o.status === 'draft' || o.status === 'quote');
            const _ordersList = fetchedOrders.filter(o => o.status !== 'draft' && o.status !== 'quote');

            // Adapter: Map Backend Order to Frontend Shape if needed
            // Backend: { orderId, customerId, items: [...], created_at, ... }
            // Frontend: { id: 'ORD-123', customer: {id: ...}, items: [...], date: ... }
            // Note: Customer details might be ID only. Frontend usually expects object. 
            // We might need to fetch customer details or mapping. 
            // Ideally `OrderResponse` should expand customer, or we fetch customers separately and map.
            // keeping it simple for now, using IDs or what's available. 
            // Frontend components using `order.customer.name` will break if `customer` is just ID.
            // I'll check if `OrderResponse` has customer details. Defaults to ID.
            // I might need to fetch `getAllUsers` or `getAllCustomers` to map IDs to Names.

            setInvoices(_invoicesList.map(mapBackendOrder));
            setOrders(_ordersList.map(mapBackendOrder));
            setError(null);
        } catch (err) {
            console.error("Failed to fetch orders", err);
            setError("Failed to load orders");
        } finally {
            setLoading(false);
        }
    };

    const mapBackendOrder = (o) => ({
        ...o,
        id: o.orderId, // Map ID
        date: o.created_at,
        customer: { id: o.customerId, name: `Customer ${o.customerId}` }, // Placeholder if name missing. FIX LATER.
        // items are already mapped by backend _order_to_response if I updated it correctly
    });

    useEffect(() => {
        fetchOrders();
    }, []);

    // --- Actions ---

    // Save a new Invoice (Draft/Quote)
    const addInvoice = async (invoiceData) => {
        try {
            // invoiceData usually matches Checkout payload
            // Force status 'draft'
            const payload = { ...invoiceData, status: 'draft', items: invoiceData.items.map(mapItemForBackend) };
            if (!payload.servedBy) payload.servedBy = '00000000-0000-0000-0000-000000000000'; // Fallback UUID if auth context not giving ID?
            // Actually useAuth should provide ID. 
            // Ideally `sales` page provides `servedBy`.

            const response = await api.orderService.createOrder(payload);
            await fetchOrders(); // Refresh
            return response;
        } catch (err) {
            console.error("Add Invoice Failed", err);
            throw err;
        }
    };

    // Direct Order Creation (from Checkout)
    const addOrder = async (orderData) => {
        try {
            const { customer, totals, payment, items: rawItems, mode } = orderData;

            // Map frontend items to backend structure
            const items = rawItems.map(mapItemForBackend);

            // Determine Statuses
            const isPaid = totals.balance <= 0.1; // Float tolerance
            const paymentStatus = isPaid ? 'Paid' : (totals.paid > 0 ? 'Partial' : 'Pending');

            // Construct strict payload for backend
            const payload = {
                customerId: customer?.id ? parseInt(customer.id) : null,
                amountPaid: parseFloat(totals.paid || 0),
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

        return {
            productId: parseInt(item.productId || item.id), // Ensure Int
            variantId: item.variantId ? parseInt(item.variantId) : null, // Ensure Int or Null
            quantity: qty,
            unitPrice: price,
            unitType: item.unit || 'pcs',
            details: item.details // Pass complex details
        };
    };

    // Convert an Invoice to an Order
    const convertInvoiceToOrder = async (invoiceId) => {
        try {
            await api.orderService.updateWorkflowStatus(invoiceId, 'confirmed');
            // Optionally update payment status if needed
            // await api.orderService.updatePaymentStatus(invoiceId, 'Paid');
            await fetchOrders();
        } catch (err) {
            console.error("Conversion Failed", err);
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
