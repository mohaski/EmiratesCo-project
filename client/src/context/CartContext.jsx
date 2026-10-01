// @refresh reset
import React, { createContext, useContext, useState, useEffect, useCallback } from 'react';

const CartContext = createContext();

export const useCart = () => {
    const context = useContext(CartContext);
    if (!context) {
        throw new Error('useCart must be used within a CartProvider');
    }
    return context;
};

export const CartProvider = ({ children }) => {
    // 1. Initialize State from LocalStorage (Persistence)
    const [cartItems, setCartItems] = useState(() => {
        try {
            const saved = localStorage.getItem('emirates_pos_cart');
            return saved ? JSON.parse(saved) : [];
        } catch (e) {
            console.error("Failed to load cart from storage", e);
            return [];
        }
    });

    const [customer, setCustomer] = useState(() => {
        try {
            const saved = localStorage.getItem('emirates_pos_customer');
            return saved ? JSON.parse(saved) : null;
        } catch (e) {
            return null;
        }
    });

    // Tax state persistence
    const [taxEnabled, setTaxEnabled] = useState(() => {
        try {
            const saved = localStorage.getItem('emirates_pos_tax_enabled');
            return saved !== null ? JSON.parse(saved) : true;
        } catch (e) {
            return true;
        }
    });

    // Session Type Persistence ('sales' or 'invoice')
    const [sessionType, setSessionType] = useState(() => {
        try {
            return localStorage.getItem('emirates_pos_session_type') || 'sales';
        } catch (e) {
            return 'sales';
        }
    });

    // What this cart is tied to, if anything — { type: 'convert', id: invoiceId } when
    // converting a saved invoice, or { type: 'link', id: parentOrderId } when adding to an
    // existing order. Persisted so the connection survives a Sales <-> Checkout round trip
    // (each is a fresh page mount, so plain component state would lose it).
    const [linkedRef, setLinkedRef] = useState(() => {
        try {
            const saved = localStorage.getItem('emirates_pos_linked_ref');
            return saved ? JSON.parse(saved) : null;
        } catch (e) {
            return null;
        }
    });

    // The saved order this cart is an edit of, or null for a new sale:
    //   { orderId, version, nonce, originalTotal, originalBalance, vat }
    // Persisted with the cart, so a reload, "Back" from checkout or a trip to another page
    // keeps the edit (and the cashier's changes) instead of turning the cart into a new
    // sale or reloading the order as it was. Cleared only by saving, discarding, or loading
    // something else into the cart. `version` is sent with the save: an order changed on
    // another device since is refused rather than overwritten.
    const [editSession, setEditSession] = useState(() => {
        try {
            const saved = localStorage.getItem('emirates_pos_edit_session');
            return saved ? JSON.parse(saved) : null;
        } catch {
            return null;
        }
    });
    useEffect(() => {
        try {
            if (editSession) localStorage.setItem('emirates_pos_edit_session', JSON.stringify(editSession));
            else localStorage.removeItem('emirates_pos_edit_session');
        } catch { /* storage unavailable - the edit just won't survive a reload */ }
    }, [editSession]);
    // The calculators' stock check sends it along so the dry run first gives that order's
    // own material back, as the edit will.
    const editingOrderId = editSession?.orderId ?? null;

    // 2. Auto-save to LocalStorage whenever state changes
    useEffect(() => {
        localStorage.setItem('emirates_pos_cart', JSON.stringify(cartItems));
        localStorage.setItem('emirates_pos_customer', JSON.stringify(customer));
        localStorage.setItem('emirates_pos_tax_enabled', JSON.stringify(taxEnabled));
        localStorage.setItem('emirates_pos_session_type', sessionType);
        localStorage.setItem('emirates_pos_linked_ref', JSON.stringify(linkedRef));
    }, [cartItems, customer, taxEnabled, sessionType, linkedRef]);

    // Clear in-memory state when user logs out
    useEffect(() => {
        const handleLogout = () => {
            setCartItems([]);
            setCustomer(null);
            setSessionType('sales');
            setLinkedRef(null);
            setEditSession(null);
        };
        window.addEventListener('pos:logout', handleLogout);
        return () => window.removeEventListener('pos:logout', handleLogout);
    }, []);

    // --- Actions ---

    const addToCart = useCallback((item) => {
        setCartItems(prev => [...prev, item]);
    }, []);

    const updateCartItem = useCallback((index, updatedItem) => {
        setCartItems(prev => {
            const newCart = [...prev];
            newCart[index] = updatedItem;
            return newCart;
        });
    }, []);

    const removeFromCart = useCallback((index) => {
        setCartItems(prev => prev.filter((_, i) => i !== index));
    }, []);


    const clearCart = useCallback(() => {
        setCartItems([]);
        setCustomer(null);
        setLinkedRef(null);
        setEditSession(null);
        // We typically keep tax settings even after clearing
    }, []);

    // Used when editing a historical order (and resuming one). `editSession` is passed only
    // for a real edit of a saved order; anything else loaded ends any edit in progress.
    const loadOrder = useCallback((orderData, { editSession: session = null } = {}) => {
        setCartItems(orderData.items || []);
        setCustomer(orderData.customer || null);
        setEditSession(session);
    }, []);

    const value = {
        cartItems,
        customer,
        setCustomer,
        taxEnabled,
        setTaxEnabled,
        sessionType,
        setSessionType,
        linkedRef,
        setLinkedRef,
        addToCart,
        updateCartItem,
        removeFromCart,
        clearCart,
        loadOrder,
        editingOrderId,
        editSession,
        setEditSession,
    };

    return <CartContext.Provider value={value}>{children}</CartContext.Provider>;
};