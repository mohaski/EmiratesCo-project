import { createContext, useContext, useEffect } from 'react';
import { useAuth } from './AuthContext';
import { wsEvents } from '../utils/wsEvents';

// Same rule as api.js: explicit override wins, dev falls back to localhost,
// production derives ws(s)://<current-host>/ws so it works from any LAN client.
const WS_URL = import.meta.env.VITE_WS_URL || (import.meta.env.DEV
    ? 'ws://localhost:8000/ws'
    : `${window.location.protocol === 'https:' ? 'wss:' : 'ws:'}//${window.location.host}/ws`);
const INITIAL_RETRY_MS = 1500;
const MAX_RETRY_MS = 30000;
// Everything the server broadcasts. After a reconnect each is re-emitted once, so every
// screen refetches whatever it may have missed while the socket was down.
const ALL_EVENTS = ['orders_updated', 'invoices_updated', 'products_updated', 'attributes_updated',
    'tools_updated', 'cutting_status_updated', 'failover_status_updated'];
// Spread so a server restart doesn't have every till reconnect and refetch at once.
const jitter = (ms, spread = 0.3) => Math.round(ms * (1 - spread + Math.random() * spread * 2));

const WebSocketContext = createContext(null);
export const useWebSocket = () => useContext(WebSocketContext);

export const WebSocketProvider = ({ children }) => {
    const { user } = useAuth();
    const userId = user && !user.mustChangePassword ? String(user.userId) : null;

    useEffect(() => {
        if (!userId) return undefined;

        // Everything for this connection lives in this closure: a sign-out or a different
        // user runs the cleanup, which closes the socket and makes any late callback from
        // it a no-op (`alive`). Keyed on the user id, so refreshing the same user's details
        // (after a password change) keeps the connection.
        let alive = true;
        let ws = null;
        let retry = INITIAL_RETRY_MS;
        let hasConnected = false;
        let retryTimer = null;
        let replayTimer = null;

        const connect = () => {
            if (!alive) return;
            ws = new WebSocket(WS_URL);
            const socket = ws;

            socket.onopen = () => {
                if (!alive) { socket.close(); return; }
                retry = INITIAL_RETRY_MS;
                if (hasConnected) {
                    // A reconnect: events sent while we were away are gone for good.
                    replayTimer = setTimeout(() => {
                        if (alive) ALL_EVENTS.forEach(type => wsEvents.emit(type));
                    }, Math.random() * 3000);
                }
                hasConnected = true;
            };

            socket.onmessage = (e) => {
                if (!alive) return;
                try {
                    const { type } = JSON.parse(e.data);
                    if (type) wsEvents.emit(type);
                } catch { /* ignore malformed frames */ }
            };

            socket.onclose = () => {
                if (!alive) return;
                retryTimer = setTimeout(() => {
                    retry = Math.min(retry * 2, MAX_RETRY_MS);
                    connect();
                }, jitter(retry));
            };

            socket.onerror = () => socket.close();
        };

        // Deferred a tick: StrictMode mounts, unmounts and remounts in development, and
        // closing a socket that is still CONNECTING logs a browser error.
        const startTimer = setTimeout(connect, 0);

        return () => {
            alive = false;
            clearTimeout(startTimer);
            clearTimeout(retryTimer);
            clearTimeout(replayTimer);
            if (ws && ws.readyState === WebSocket.OPEN) ws.close();
            // A socket still CONNECTING closes itself in onopen (alive is false).
        };
    }, [userId]);

    return (
        <WebSocketContext.Provider value={null}>
            {children}
        </WebSocketContext.Provider>
    );
};
