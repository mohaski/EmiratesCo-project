import React, { createContext, useContext, useState, useEffect } from 'react';
import { MOCK_ORDERS, MOCK_INVOICES } from '../data/mockOrders';

const OrderContext = createContext();

export const useOrders = () => {
    const context = useContext(OrderContext);
    if (!context) {
        throw new Error('useOrders must be used within an OrderProvider');
    }
    return context;
};

export const OrderProvider = ({ children }) => {
    // --- State Initialization (with Persistence) ---
    const [orders, setOrders] = useState(() => {
        const saved = localStorage.getItem('emirates_orders_v3');
        return saved ? JSON.parse(saved) : MOCK_ORDERS;
    });

    const [invoices, setInvoices] = useState(() => {
        const saved = localStorage.getItem('emirates_invoices_v3');
        return saved ? JSON.parse(saved) : MOCK_INVOICES;
    });

    // --- Persistence Effects ---
    useEffect(() => {
        localStorage.setItem('emirates_orders_v3', JSON.stringify(orders));
    }, [orders]);

    useEffect(() => {
        localStorage.setItem('emirates_invoices_v3', JSON.stringify(invoices));
    }, [invoices]);

    // --- Actions ---

    // Save a new Invoice (Draft/Quote)
    const addInvoice = (invoiceData) => {
        const newInvoice = {
            ...invoiceData,
            id: invoiceData.id || `INV-${Date.now().toString().slice(-6)}`,
            date: invoiceData.date || new Date().toISOString(),
            status: 'draft', // 'draft', 'paid', 'converted'
        };
        setInvoices(prev => [newInvoice, ...prev]);
        return newInvoice;
    };

    // Convert an Invoice to an Order
    const convertInvoiceToOrder = (invoiceId) => {
        const invoice = invoices.find(inv => inv.id === invoiceId);
        if (!invoice) return;

        // Create new Order from Invoice
        const newOrder = {
            ...invoice,
            id: `ORD-${Date.now().toString().slice(-6)}`, // New Order ID
            invoiceReference: invoice.id,
            status: 'pending', // Initial order status
            date: new Date().toISOString(),
        };

        // Add to Orders
        setOrders(prev => [newOrder, ...prev]);

        // Update Invoice status (optional: remove from invoices list or mark as converted)
        // Let's mark it as converted so we can filter it or keep it for records
        setInvoices(prev => prev.map(inv =>
            inv.id === invoiceId ? { ...inv, status: 'converted' } : inv
        ));

        return newOrder;
    };

    const deleteInvoice = (id) => {
        setInvoices(prev => prev.filter(i => i.id !== id));
    };

    const deleteOrder = (id) => {
        setOrders(prev => prev.filter(o => o.id !== id));
    };

    const value = {
        orders,
        invoices,
        addInvoice,
        convertInvoiceToOrder,
        deleteInvoice,
        deleteOrder
    };

    return (
        <OrderContext.Provider value={value}>
            {children}
        </OrderContext.Provider>
    );
};
