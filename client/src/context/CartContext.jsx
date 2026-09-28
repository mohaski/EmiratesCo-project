// @refresh reset
import React, { createContext, useContext, useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { useWindows } from './WindowContext';
import { useProducts } from './ProductContext';
import { mapItemForBackend, mapStoredItemToCart } from '../utils/orderItemMapping';

const CartContext = createContext();

export const useCart = () => {
    const context = useContext(CartContext);
    if (!context) {
        throw new Error('useCart must be used within a CartProvider');
    }
    return context;
};

/**
 * The cart the sales screen, checkout and calculators work with.
 *
 * Two backings behind one interface:
 *
 *   WINDOW mode — a new sale. The cart IS the active sale window on the server
 *   (WindowContext): its stock is held from the moment an item is added, so no other till
 *   can sell it. Every change is saved first and only then shown, which is why addToCart /
 *   updateCartItem / removeFromCart / setCustomer / setTaxEnabled return promises that
 *   reject when the server refuses (not enough stock, window expired, ...).
 *
 *   LOCAL mode — editing a saved order (it already holds its stock; the edit goes through
 *   update_order at checkout) and building a quotation (quotes never hold stock). The cart
 *   lives in this browser as before.
 */
export const CartProvider = ({ children }) => {
    const { activeWindow, saveWindow, openWindow, customerOf } = useWindows();
    const { products } = useProducts();

    // ── Local backing ─────────────────────────────────────────────────────────
    const [localItems, setLocalItems] = useState(() => {
        try {
            const saved = localStorage.getItem('emirates_pos_cart');
            return saved ? JSON.parse(saved) : [];
        } catch (e) {
            console.error("Failed to load cart from storage", e);
            return [];
        }
    });

    const [localCustomer, setLocalCustomer] = useState(() => {
        try {
            const saved = localStorage.getItem('emirates_pos_customer');
            return saved ? JSON.parse(saved) : null;
        } catch (e) {
            return null;
        }
    });

    const [localTax, setLocalTax] = useState(() => {
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

    // Local mode only: what this cart is tied to — { type: 'convert', id } or
    // { type: 'link', id }. In window mode the window itself carries these.
    const [localLinkedRef, setLocalLinkedRef] = useState(() => {
        try {
            const saved = localStorage.getItem('emirates_pos_linked_ref');
            return saved ? JSON.parse(saved) : null;
        } catch (e) {
            return null;
        }
    });

    useEffect(() => {
        localStorage.setItem('emirates_pos_cart', JSON.stringify(localItems));
        localStorage.setItem('emirates_pos_customer', JSON.stringify(localCustomer));
        localStorage.setItem('emirates_pos_tax_enabled', JSON.stringify(localTax));
        localStorage.setItem('emirates_pos_session_type', sessionType);
        localStorage.setItem('emirates_pos_linked_ref', JSON.stringify(localLinkedRef));
    }, [localItems, localCustomer, localTax, sessionType, localLinkedRef]);

    useEffect(() => {
        const handleLogout = () => {
            setLocalItems([]);
            setLocalCustomer(null);
            setSessionType('sales');
            setLocalLinkedRef(null);
        };
        window.addEventListener('pos:logout', handleLogout);
        return () => window.removeEventListener('pos:logout', handleLogout);
    }, []);

    // The order this cart is an edit of, or null for a new sale. The calculators' stock
    // check sends it along so the dry run first gives that order's own material back, as
    // the edit will. Not persisted: SalesDashboard sets it from the navigation state.
    const [editingOrderId, setEditingOrderId] = useState(null);

    const windowMode = sessionType === 'sales' && !editingOrderId;

    // ── Window backing ────────────────────────────────────────────────────────
    const windowItems = useMemo(
        () => (activeWindow?.items ?? []).map(i => mapStoredItemToCart(i, products)),
        [activeWindow, products],
    );

    // Two quick first-adds must share ONE new window, not open two.
    const openingRef = useRef(null);
    const ensureWindow = useCallback(async () => {
        if (activeWindow) return activeWindow;
        if (!openingRef.current) {
            openingRef.current = openWindow().finally(() => { openingRef.current = null; });
        }
        return openingRef.current;
    }, [activeWindow, openWindow]);

    /** Apply `transform` to the window's cart as it stands when this save's turn comes
     * (see WindowContext.saveWindow) — opening a window first if there is none. */
    const saveItems = useCallback(async (transform) => {
        const target = await ensureWindow();
        return saveWindow(target.windowId, {
            items: (w) => transform(w.items.map(i => mapStoredItemToCart(i, products))).map(mapItemForBackend),
        });
    }, [ensureWindow, saveWindow, products]);

    // ── Actions (same names in both modes) ────────────────────────────────────

    const addToCart = useCallback((item) => {
        if (windowMode) return saveItems(items => [...items, item]);
        setLocalItems(prev => [...prev, item]);
        return Promise.resolve();
    }, [windowMode, saveItems]);

    const updateCartItem = useCallback((index, updatedItem) => {
        if (windowMode) return saveItems(items => items.map((it, i) => (i === index ? updatedItem : it)));
        setLocalItems(prev => {
            const newCart = [...prev];
            newCart[index] = updatedItem;
            return newCart;
        });
        return Promise.resolve();
    }, [windowMode, saveItems]);

    const removeFromCart = useCallback((index) => {
        if (windowMode) return saveItems(items => items.filter((_, i) => i !== index));
        setLocalItems(prev => prev.filter((_, i) => i !== index));
        return Promise.resolve();
    }, [windowMode, saveItems]);

    /** `patch` (window mode) lets the caller save the matching VAT default in the same call. */
    const setCustomer = useCallback(async (customer, patch = {}) => {
        if (!windowMode) {
            setLocalCustomer(customer);
            return null;
        }
        if (!customer && !activeWindow) return null;
        const target = await ensureWindow();
        return saveWindow(target.windowId, { customer, ...patch });
    }, [windowMode, activeWindow, ensureWindow, saveWindow]);

    const setTaxEnabled = useCallback(async (enabled) => {
        if (!windowMode) {
            setLocalTax(enabled);
            return null;
        }
        if (!activeWindow) return null;
        return saveWindow(activeWindow.windowId, { VAT_status: Boolean(enabled) });
    }, [windowMode, activeWindow, saveWindow]);

    const setLinkedRef = useCallback(async (ref) => {
        if (!windowMode) {
            setLocalLinkedRef(ref);
            return null;
        }
        if (!activeWindow) return null;
        return saveWindow(activeWindow.windowId, {
            parentOrderId: ref?.type === 'link' ? ref.id : null,
            sourceInvoiceId: ref?.type === 'convert' ? ref.id : null,
        });
    }, [windowMode, activeWindow, saveWindow]);

    /** Resets the LOCAL cart. A window is never cleared by this — it ends only by being
     * confirmed or closed (WindowContext), which is what hands its stock on or back. */
    const clearCart = useCallback(() => {
        setLocalItems([]);
        setLocalCustomer(null);
        setLocalLinkedRef(null);
        setEditingOrderId(null);
    }, []);

    // Editing a saved order (and the legacy resume path) — always local.
    const loadOrder = useCallback((orderData, { editingOrderId: editing = null } = {}) => {
        setLocalItems(orderData.items || []);
        setLocalCustomer(orderData.customer || null);
        setEditingOrderId(editing);
    }, []);

    const windowLinkedRef = activeWindow?.sourceInvoiceId
        ? { type: 'convert', id: activeWindow.sourceInvoiceId }
        : activeWindow?.parentOrderId
            ? { type: 'link', id: activeWindow.parentOrderId }
            : null;

    const value = {
        windowMode,
        cartItems: windowMode ? windowItems : localItems,
        customer: windowMode ? customerOf(activeWindow) : localCustomer,
        setCustomer,
        taxEnabled: windowMode ? Boolean(activeWindow?.VAT_status) : localTax,
        setTaxEnabled,
        sessionType,
        setSessionType,
        linkedRef: windowMode ? windowLinkedRef : localLinkedRef,
        setLinkedRef,
        addToCart,
        updateCartItem,
        removeFromCart,
        clearCart,
        loadOrder,
        editingOrderId,
        setEditingOrderId,
        // The order whose material a stock check / offcut listing should treat as its own:
        // the order being edited, or the active window's held order.
        stockScopeOrderId: editingOrderId ?? (windowMode ? (activeWindow?.orderId ?? null) : null),
        // Only the active window's held order: offcut listings / glass previews accept a
        // window's order id to include its private leftovers, and refuse any other order.
        holdOrderId: windowMode ? (activeWindow?.orderId ?? null) : null,
        // Server's figures for the active window (what confirm will actually charge).
        windowTotals: windowMode && activeWindow
            ? { subtotal: activeWindow.subtotal, total: activeWindow.total, discount: activeWindow.discount }
            : null,
    };

    return <CartContext.Provider value={value}>{children}</CartContext.Provider>;
};
