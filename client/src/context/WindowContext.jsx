// @refresh reset
import React, { createContext, useContext, useState, useEffect, useCallback, useRef, useMemo } from 'react';
import api from '../services/api';
import { wsEvents } from '../utils/wsEvents';
import { showToast } from '../utils/toast';
import { useAuth } from './AuthContext';
import { WINDOW_LIMIT, windowItemToRequest } from '../utils/saleWindows';

/**
 * Sale windows — parallel open checkouts.
 *
 * A cashier waiting for one customer to pay parks that cart in a window and serves the
 * next customer in another. The SERVER owns every window (core/ordering/windowService.py):
 * its stock is deducted the moment its cart is saved, so every other window, till and
 * device already sees the reduced stock. This context only mirrors the cashier's open
 * windows and funnels every change through the API:
 *
 *   - a cart change is a save of the whole cart, and can be refused (not enough stock,
 *     changed on another device, window expired) — callers must treat it as fallible;
 *   - saves to one window are queued, so two quick changes never race on its version;
 *   - a window idle for 15 minutes is closed by the server and its stock released. The
 *     countdown shown here is the server's, re-read on every sync; switching to a window,
 *     saving it, or pressing "keep holding" restarts it.
 *
 * Windows belong to the logged-in cashier, not the device: the same cashier sees the same
 * windows everywhere. The device id is sent for the audit trail only.
 */

const WindowContext = createContext();

export const useWindows = () => {
    const context = useContext(WindowContext);
    if (!context) throw new Error('useWindows must be used within a WindowProvider');
    return context;
};

const REFRESH_MS = 60_000;

const DEVICE_KEY = 'emirates_pos_device_id';
const activeKey = (userId) => `emirates_pos_active_window_${userId}`;
const customersKey = (userId) => `emirates_pos_window_customers_${userId}`;

const readJSON = (key, fallback) => {
    try {
        const raw = localStorage.getItem(key);
        return raw ? JSON.parse(raw) : fallback;
    } catch {
        return fallback;
    }
};
const writeJSON = (key, value) => {
    try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* storage full/blocked: cosmetic only */ }
};

const getDeviceId = () => {
    try {
        let id = localStorage.getItem(DEVICE_KEY);
        if (!id) {
            id = (window.crypto?.randomUUID?.() ?? `dev-${Date.now()}-${Math.random().toString(36).slice(2)}`);
            localStorage.setItem(DEVICE_KEY, id);
        }
        return id;
    } catch {
        return null;
    }
};

const stamp = (w) => ({ ...w, _syncedAt: Date.now() });

export const WindowProvider = ({ children }) => {
    const { user } = useAuth();
    const userId = user?.userId ?? null;

    const [windows, setWindows] = useState([]);
    const [activeId, setActiveIdState] = useState(null);
    const [loaded, setLoaded] = useState(false);
    const [busyIds, setBusyIds] = useState(() => new Set());

    // Refs mirror state for the async queue, which must read the LATEST version.
    const windowsRef = useRef([]);
    const queuesRef = useRef(new Map());          // windowId -> tail promise of its save queue
    const closedByUsRef = useRef(new Set());       // windows this tab confirmed/released
    const knownRef = useRef(new Map());            // windowId -> label, to notice disappearances
    // The customer object picked for each window ({ id, name, phone, type }). The server keeps
    // only id + name; the type decides VAT defaults and whether a balance can be left owing.
    const customersRef = useRef({});
    const registeredRef = useRef(null);            // registered customers, fetched on demand

    const commit = useCallback((next) => {
        windowsRef.current = next;
        setWindows(next);
    }, []);

    const setActiveId = useCallback((id) => {
        setActiveIdState(id);
        if (userId) writeJSON(activeKey(userId), id);
    }, [userId]);

    const upsert = useCallback((w) => {
        const others = windowsRef.current.filter(x => x.windowId !== w.windowId);
        const next = [...others, stamp(w)].sort((a, b) => a.windowId - b.windowId);
        commit(next);
        knownRef.current.set(w.windowId, w.label);
        return next;
    }, [commit]);

    const drop = useCallback((windowId) => {
        closedByUsRef.current.add(windowId);
        knownRef.current.delete(windowId);
        const next = windowsRef.current.filter(w => w.windowId !== windowId);
        commit(next);
        setActiveIdState(prev => {
            if (prev !== windowId) return prev;
            const fallback = next[0]?.windowId ?? null;
            if (userId) writeJSON(activeKey(userId), fallback);
            return fallback;
        });
        const cached = { ...customersRef.current };
        delete cached[windowId];
        customersRef.current = cached;
        if (userId) writeJSON(customersKey(userId), cached);
    }, [commit, userId]);

    const refresh = useCallback(async () => {
        if (!userId) return;
        let list;
        try {
            list = await api.windowService.list();
        } catch {
            return; // offline or server restarting — the next sync catches up
        }
        // A window that vanished without this tab closing it expired, or was confirmed or
        // closed on another device. Ask the server which, so the cashier sees exactly why
        // (the 410 it answers is shown by the global error toast).
        for (const [id] of knownRef.current) {
            if (!list.some(w => w.windowId === id) && !closedByUsRef.current.has(id)) {
                api.windowService.get(id).catch(() => {});
            }
        }
        knownRef.current = new Map(list.map(w => [w.windowId, w.label]));
        const next = list.map(stamp);
        commit(next);
        setLoaded(true);
        setActiveIdState(prev => {
            if (prev && next.some(w => w.windowId === prev)) return prev;
            const saved = readJSON(activeKey(userId), null);
            const pick = next.some(w => w.windowId === saved) ? saved : (next[0]?.windowId ?? null);
            writeJSON(activeKey(userId), pick);
            return pick;
        });
    }, [userId, commit]);

    // Load on login, clear on logout.
    useEffect(() => {
        windowsRef.current = [];
        queuesRef.current = new Map();
        knownRef.current = new Map();
        closedByUsRef.current = new Set();
        registeredRef.current = null;
        setWindows([]);
        setLoaded(false);
        if (!userId) {
            setActiveIdState(null);
            customersRef.current = {};
            return;
        }
        customersRef.current = readJSON(customersKey(userId), {});
        setActiveIdState(readJSON(activeKey(userId), null));
        refresh();
    }, [userId, refresh]);

    // Stay in sync: server pushes, a slow poll as a safety net, and on returning to the tab.
    useEffect(() => {
        if (!userId) return undefined;
        const off = wsEvents.on('windows_updated', () => refresh());
        const timer = setInterval(refresh, REFRESH_MS);
        const onVisible = () => { if (document.visibilityState === 'visible') refresh(); };
        document.addEventListener('visibilitychange', onVisible);
        return () => { off(); clearInterval(timer); document.removeEventListener('visibilitychange', onVisible); };
    }, [userId, refresh]);

    const setBusy = useCallback((windowId, busy) => {
        setBusyIds(prev => {
            const next = new Set(prev);
            if (busy) next.add(windowId); else next.delete(windowId);
            return next;
        });
    }, []);

    /** Run `task(currentWindow)` after every earlier save to the same window has settled. */
    const enqueue = useCallback((windowId, task) => {
        const tail = queuesRef.current.get(windowId) ?? Promise.resolve();
        const run = tail.catch(() => {}).then(async () => {
            const current = windowsRef.current.find(w => w.windowId === windowId);
            if (!current) throw new Error('This window is no longer open.');
            setBusy(windowId, true);
            try {
                return await task(current);
            } finally {
                setBusy(windowId, false);
            }
        });
        queuesRef.current.set(windowId, run);
        return run;
    }, [setBusy]);

    const handleFailure = useCallback((err) => {
        const status = err?.response?.status;
        // 409 changed elsewhere / 410 expired or closed: our copy is stale either way.
        if (status === 409 || status === 410) refresh();
        throw err;
    }, [refresh]);

    const openWindow = useCallback(async ({ activate = true } = {}) => {
        if (windowsRef.current.length >= WINDOW_LIMIT) {
            showToast(`You already have ${WINDOW_LIMIT} open windows. Confirm or close one first.`, 'warning');
            throw new Error('window limit');
        }
        const w = await api.windowService.open(getDeviceId());
        upsert(w);
        if (activate) setActiveId(w.windowId);
        return w;
    }, [upsert, setActiveId]);

    /**
     * Save a window's cart. `patch` may carry any of:
     *   items            OrderItemRequest[] (see mapItemForBackend), or a function
     *                    (currentWindow) => OrderItemRequest[] evaluated when this save's turn
     *                    in the queue comes — use that form for "add/remove one item", so two
     *                    quick changes each build on the other instead of the second one
     *                    overwriting the first. Omitted: keep the cart.
     *   customer         { id, name, type, phone } | null
     *   VAT_status, discount, parentOrderId, sourceInvoiceId
     * Anything omitted keeps its current value. Resolves to the saved window; rejects if the
     * server refused (the reason is already on screen as a toast).
     */
    const saveWindow = useCallback((windowId, patch = {}) => enqueue(windowId, async (w) => {
        let customerId = w.customerId ?? null;
        let customerName = w.customerName ?? null;
        if ('customer' in patch) {
            const c = patch.customer;
            customerId = c?.id ? parseInt(c.id, 10) : null;
            customerName = c?.name ?? null;
            const cached = { ...customersRef.current };
            if (c) cached[windowId] = c; else delete cached[windowId];
            customersRef.current = cached;
            if (userId) writeJSON(customersKey(userId), cached);
        }
        const payload = {
            version: w.version,
            items: typeof patch.items === 'function'
                ? patch.items(w)
                : (patch.items ?? w.items.map(windowItemToRequest)),
            customerId,
            customerName,
            VAT_status: patch.VAT_status ?? w.VAT_status,
            discount: patch.discount ?? w.discount ?? 0,
            parentOrderId: 'parentOrderId' in patch ? patch.parentOrderId : (w.parentOrderId ?? null),
            sourceInvoiceId: 'sourceInvoiceId' in patch ? patch.sourceInvoiceId : (w.sourceInvoiceId ?? null),
        };
        try {
            const saved = await api.windowService.setCart(windowId, payload);
            upsert(saved);
            return saved;
        } catch (err) {
            return handleFailure(err);
        }
    }), [enqueue, upsert, handleFailure, userId]);

    const touchWindow = useCallback((windowId) => enqueue(windowId, async () => {
        try {
            const w = await api.windowService.touch(windowId);
            upsert(w);
            return w;
        } catch (err) {
            return handleFailure(err);
        }
    }), [enqueue, upsert, handleFailure]);

    const switchTo = useCallback((windowId) => {
        setActiveId(windowId);
        // Coming back to a window is activity — its idle clock restarts.
        touchWindow(windowId).catch(() => {});
    }, [setActiveId, touchWindow]);

    /** payment: { amountPaid, paymentMethod, paymentDetails, idempotencyKey }. */
    const confirmWindow = useCallback((windowId, payment) => enqueue(windowId, async (w) => {
        try {
            const res = await api.windowService.confirm(windowId, { version: w.version, ...payment });
            drop(windowId);
            return res;
        } catch (err) {
            return handleFailure(err);
        }
    }), [enqueue, drop, handleFailure]);

    const releaseWindow = useCallback((windowId) => enqueue(windowId, async () => {
        try {
            await api.windowService.release(windowId);
        } catch (err) {
            if (err?.response?.status !== 410) return handleFailure(err);
        }
        drop(windowId);
        return null;
    }), [enqueue, drop, handleFailure]);

    /**
     * Open a window already filled in (converting a quotation, "add to order"): `patch` is
     * anything saveWindow takes. If the save is refused — typically not enough stock for the
     * quotation's items — the new window is closed again, since there is nothing to sell.
     */
    const openWindowWith = useCallback(async (patch) => {
        const w = await openWindow();
        try {
            return await saveWindow(w.windowId, patch);
        } catch (err) {
            releaseWindow(w.windowId).catch(() => {});
            throw err;
        }
    }, [openWindow, saveWindow, releaseWindow]);

    const fetchRegistered = useCallback(async () => {
        if (registeredRef.current) return registeredRef.current;
        try {
            const list = await api.userService.getCustomers();
            registeredRef.current = list.map(c => ({ id: c.customerId, name: c.name, phone: c.phoneNumber, type: c.type }));
        } catch {
            registeredRef.current = [];
        }
        return registeredRef.current;
    }, []);

    /** The customer object for a window: what this device picked, else rebuilt from the
     * server's id + name (a window opened on another device). */
    const customerOf = useCallback((w) => {
        if (!w) return null;
        const cached = customersRef.current[w.windowId];
        if (cached && (cached.id ?? null) === (w.customerId ?? null)) return cached;
        if (w.customerId) {
            const known = registeredRef.current?.find(c => c.id === w.customerId);
            return known ?? { id: w.customerId, name: w.customerName, type: 'individual' };
        }
        if (w.customerName) return { id: null, name: w.customerName, type: 'walk-in' };
        return null;
    }, []);

    // Windows opened elsewhere carry only a customer id; fetch the list once to name/type them.
    useEffect(() => {
        if (windows.some(w => w.customerId && !customersRef.current[w.windowId]) && !registeredRef.current) {
            fetchRegistered().then(() => setWindows(ws => [...ws]));
        }
    }, [windows, fetchRegistered]);

    const activeWindow = useMemo(
        () => windows.find(w => w.windowId === activeId) ?? null,
        [windows, activeId],
    );

    const value = {
        windows,
        loaded,
        activeWindow,
        activeWindowId: activeWindow?.windowId ?? null,
        isBusy: (windowId) => busyIds.has(windowId),
        canOpenMore: windows.length < WINDOW_LIMIT,
        openWindow,
        openWindowWith,
        switchTo,
        saveWindow,
        touchWindow,
        confirmWindow,
        releaseWindow,
        refreshWindows: refresh,
        customerOf,
    };

    return <WindowContext.Provider value={value}>{children}</WindowContext.Provider>;
};
