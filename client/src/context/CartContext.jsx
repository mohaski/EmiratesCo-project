// @refresh reset
import React, { createContext, useContext, useState, useEffect, useCallback, useMemo, useRef } from 'react';
import api from '../services/api';
import { useWindows } from './WindowContext';
import { useProducts } from './ProductContext';
import { mapItemForBackend, mapStoredItemToCart } from '../utils/orderItemMapping';
import { showToast } from '../utils/toast';

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
 *   WINDOW mode — a new sale, with sale windows switched on. The cart IS the active sale
 *   window on the server (WindowContext): its stock is held from the moment an item is
 *   added, so no other till can sell it. Every change is saved first and only then shown,
 *   which is why addToCart / updateCartItem / removeFromCart / setCustomer / setTaxEnabled /
 *   setLinkedRef return promises that reject when the server refuses (not enough stock,
 *   window expired, ...). Callers that close a dialog must wait for them.
 *
 *   LOCAL mode — editing a saved order (it already holds its stock; the edit goes through
 *   update_order at checkout), building a quotation (quotes never hold stock), or windows
 *   switched off. The cart lives in this browser exactly as before: saved to localStorage,
 *   followed across tabs, with the edit session surviving a reload.
 */
export const CartProvider = ({ children }) => {
    const { enabled: windowsEnabled, loaded: windowsLoaded, activeWindow, saveWindow, openWindow, openWindowWith, customerOf } = useWindows();
    const { products } = useProducts();

    // ── Local backing (unchanged from before sale windows) ───────────────────
    const [cartItems, setCartItems] = useState(() => {
        try {
            const saved = localStorage.getItem('emirates_pos_cart');
            return saved ? JSON.parse(saved) : [];
        } catch (e) {
            console.error("Failed to load cart from storage", e);
            return [];
        }
    });

    const [customer, setLocalCustomer] = useState(() => {
        try {
            const saved = localStorage.getItem('emirates_pos_customer');
            return saved ? JSON.parse(saved) : null;
        } catch {
            return null;
        }
    });

    const [taxEnabled, setLocalTax] = useState(() => {
        try {
            const saved = localStorage.getItem('emirates_pos_tax_enabled');
            return saved !== null ? JSON.parse(saved) : true;
        } catch {
            return true;
        }
    });

    const [sessionType, setSessionType] = useState(() => {
        try {
            return localStorage.getItem('emirates_pos_session_type') || 'sales';
        } catch {
            return 'sales';
        }
    });

    // What this cart is tied to, if anything — { type: 'convert', id: invoiceId } when
    // converting a saved invoice, or { type: 'link', id: parentOrderId } when adding to an
    // existing order. Persisted so the connection survives a Sales <-> Checkout round trip
    // (each is a fresh page mount, so plain component state would lose it). In window mode
    // the window itself carries these.
    const [linkedRef, setLocalLinkedRef] = useState(() => {
        try {
            const saved = localStorage.getItem('emirates_pos_linked_ref');
            return saved ? JSON.parse(saved) : null;
        } catch {
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

    // Window mode: a new sale with windows on. The edit session decides it — persisted, so a
    // reload in the middle of an edit stays an edit and never turns into a window.
    const windowMode = Boolean(windowsEnabled) && sessionType === 'sales' && !editSession;

    useEffect(() => {
        localStorage.setItem('emirates_pos_cart', JSON.stringify(cartItems));
        localStorage.setItem('emirates_pos_customer', JSON.stringify(customer));
        localStorage.setItem('emirates_pos_tax_enabled', JSON.stringify(taxEnabled));
        localStorage.setItem('emirates_pos_session_type', sessionType);
        localStorage.setItem('emirates_pos_linked_ref', JSON.stringify(linkedRef));
    }, [cartItems, customer, taxEnabled, sessionType, linkedRef]);

    // Another tab on this till changed the cart: follow it, instead of the next write here
    // silently overwriting it with this tab's older copy. (A write of the same value fires no
    // storage event, so the two tabs can't ping-pong.) Window carts follow the server instead.
    useEffect(() => {
        const parse = (v, fallback) => { try { return v == null ? fallback : JSON.parse(v); } catch { return fallback; } };
        const onStorage = (e) => {
            switch (e.key) {
                case 'emirates_pos_cart': setCartItems(parse(e.newValue, [])); break;
                case 'emirates_pos_customer': setLocalCustomer(parse(e.newValue, null)); break;
                case 'emirates_pos_linked_ref': setLocalLinkedRef(parse(e.newValue, null)); break;
                case 'emirates_pos_edit_session': setEditSession(parse(e.newValue, null)); break;
                case 'emirates_pos_tax_enabled': if (e.newValue != null) setLocalTax(parse(e.newValue, true)); break;
                case 'emirates_pos_session_type': if (e.newValue) setSessionType(e.newValue); break;
                default: break;
            }
        };
        window.addEventListener('storage', onStorage);
        return () => window.removeEventListener('storage', onStorage);
    }, []);

    // Clear in-memory state when user logs out
    useEffect(() => {
        const handleLogout = () => {
            setCartItems([]);
            setLocalCustomer(null);
            setSessionType('sales');
            setLocalLinkedRef(null);
            setEditSession(null);
        };
        window.addEventListener('pos:logout', handleLogout);
        return () => window.removeEventListener('pos:logout', handleLogout);
    }, []);

    // ── Window backing ────────────────────────────────────────────────────────
    const windowItems = useMemo(
        () => (activeWindow?.items ?? []).map(i => mapStoredItemToCart(i, products, { held: true })),
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
            items: (w) => transform(w.items.map(i => mapStoredItemToCart(i, products, { held: true }))).map(mapItemForBackend),
        });
    }, [ensureWindow, saveWindow, products]);

    // A cart this till built before windows were on (or while they were off) is invisible in
    // window mode - move it into a window once, which checks and holds its stock. Refused (not
    // enough stock any more): it stays saved here, and the cashier is told.
    const migratedRef = useRef(false);
    useEffect(() => {
        if (!windowMode || !windowsLoaded || migratedRef.current || cartItems.length === 0) return;
        migratedRef.current = true;
        openWindowWith({
            items: cartItems.map(mapItemForBackend),
            customer,
            VAT_status: Boolean(taxEnabled),
            ...(linkedRef?.type === 'link' ? { parentOrderId: linkedRef.id } : {}),
            ...(linkedRef?.type === 'convert' ? { sourceInvoiceId: linkedRef.id, discount: linkedRef.discount ?? 0 } : {}),
        }).then(() => {
            setCartItems([]);
            setLocalCustomer(null);
            setLocalLinkedRef(null);
            showToast('The cart on this till was moved into a sale window - its stock is now held.', 'info');
        }).catch(() => {
            showToast("This till's earlier cart couldn't be moved into a sale window (the reason is above). It is kept on this till.", 'warning');
        });
    }, [windowMode, windowsLoaded, cartItems, customer, taxEnabled, linkedRef, openWindowWith]);

    // ── Actions (same names in both modes) ────────────────────────────────────

    const addToCart = useCallback((item) => {
        if (windowMode) return saveItems(items => [...items, item]);
        setCartItems(prev => [...prev, item]);
        return Promise.resolve();
    }, [windowMode, saveItems]);

    const updateCartItem = useCallback((index, updatedItem) => {
        if (windowMode) {
            return saveItems(items => {
                const next = [...items];
                next[index] = updatedItem;
                return next;
            });
        }
        setCartItems(prev => {
            const newCart = [...prev];
            newCart[index] = updatedItem;
            return newCart;
        });
        return Promise.resolve();
    }, [windowMode, saveItems]);

    const removeFromCart = useCallback((index) => {
        if (windowMode) return saveItems(items => items.filter((_, i) => i !== index));
        setCartItems(prev => prev.filter((_, i) => i !== index));
        return Promise.resolve();
    }, [windowMode, saveItems]);

    /** `patch` (window mode) lets the caller save the matching VAT default in the same call. */
    const setCustomer = useCallback(async (next, patch = {}) => {
        if (!windowMode) {
            setLocalCustomer(next);
            if ('VAT_status' in patch) setLocalTax(Boolean(patch.VAT_status));
            return null;
        }
        if (!next && !activeWindow) return null;
        const target = await ensureWindow();
        return saveWindow(target.windowId, { customer: next, ...patch });
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
            ...(ref?.type === 'convert' && ref.discount != null ? { discount: ref.discount } : {}),
        });
    }, [windowMode, activeWindow, saveWindow]);

    /** Resets the LOCAL cart. A window is never cleared by this — it ends only by being
     * confirmed or closed (WindowContext), which is what hands its stock on or back. */
    const clearCart = useCallback(() => {
        setCartItems([]);
        setLocalCustomer(null);
        setLocalLinkedRef(null);
        setEditSession(null);
        // We typically keep tax settings even after clearing
    }, []);

    // Used when editing a historical order (and resuming one). `editSession` is passed only
    // for a real edit of a saved order; anything else loaded ends any edit in progress.
    // Always local: an edit already holds its stock.
    const loadOrder = useCallback((orderData, { editSession: session = null } = {}) => {
        setCartItems(orderData.items || []);
        setLocalCustomer(orderData.customer || null);
        setEditSession(session);
    }, []);

    /**
     * Would the active window's cart, with this line added (cartIndex null) or put in place of
     * line `cartIndex`, fit in stock? The real save, run and rolled back on the server - the
     * window's own material counted once, its other lines still held. With no window yet
     * nothing is held, so the plain check is already exact (null tells the caller to use it).
     */
    const checkWindowLine = useCallback(async (cartIndex, line) => {
        if (!windowMode || !activeWindow) return null;
        const current = activeWindow.items.map(i => mapItemForBackend(mapStoredItemToCart(i, products, { held: true })));
        const request = { productId: line.productId, variantId: line.variantId ?? null, quantity: line.quantity ?? 1,
            unitPrice: 0, unitType: line.unitType ?? 'pcs', details: { lineItems: line.lineItems } };
        const items = cartIndex != null && cartIndex < current.length
            ? current.map((it, i) => (i === cartIndex ? request : it))
            : [...current, request];
        return api.windowService.checkCart(activeWindow.windowId, {
            version: activeWindow.version,
            items,
            customerId: activeWindow.customerId ?? null,
            customerName: activeWindow.customerName ?? null,
            VAT_status: Boolean(activeWindow.VAT_status),
            discount: activeWindow.discount ?? 0,
            parentOrderId: activeWindow.parentOrderId ?? null,
            sourceInvoiceId: activeWindow.sourceInvoiceId ?? null,
        });
    }, [windowMode, activeWindow, products]);

    const windowLinkedRef = activeWindow?.sourceInvoiceId
        ? { type: 'convert', id: activeWindow.sourceInvoiceId, discount: activeWindow.discount ?? 0 }
        : activeWindow?.parentOrderId
            ? { type: 'link', id: activeWindow.parentOrderId }
            : null;

    const value = {
        windowMode,
        cartItems: windowMode ? windowItems : cartItems,
        customer: windowMode ? customerOf(activeWindow) : customer,
        setCustomer,
        // No window yet: VAT shows as the default for "no customer" (on) until one is picked.
        taxEnabled: windowMode ? (activeWindow ? Boolean(activeWindow.VAT_status) : true) : taxEnabled,
        setTaxEnabled,
        sessionType,
        setSessionType,
        linkedRef: windowMode ? windowLinkedRef : linkedRef,
        setLinkedRef,
        addToCart,
        updateCartItem,
        removeFromCart,
        clearCart,
        loadOrder,
        editingOrderId,
        editSession,
        setEditSession,
        checkWindowLine,
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
