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

    // 2. Auto-save to LocalStorage whenever state changes
    useEffect(() => {
        localStorage.setItem('emirates_pos_cart', JSON.stringify(cartItems));
        localStorage.setItem('emirates_pos_customer', JSON.stringify(customer));
        localStorage.setItem('emirates_pos_tax_enabled', JSON.stringify(taxEnabled));
    }, [cartItems, customer, taxEnabled]);

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
        // We typically keep tax settings even after clearing
    }, []);

    // Used when editing a historical order
    const loadOrder = useCallback((orderData) => {
        setCartItems(orderData.items || []);
        setCustomer(orderData.customer || null);
    }, []);

    const value = {
        cartItems,
        customer,
        setCustomer,
        taxEnabled,
        setTaxEnabled,
        addToCart,
        updateCartItem,
        removeFromCart,
        clearCart,
        loadOrder
    };

    return <CartContext.Provider value={value}>{children}</CartContext.Provider>;
};