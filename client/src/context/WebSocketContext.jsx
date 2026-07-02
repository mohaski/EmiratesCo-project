import { createContext, useContext, useEffect, useRef } from 'react';
import { useAuth } from './AuthContext';
import { wsEvents } from '../utils/wsEvents';

const WS_URL = 'ws://localhost:8000/ws';
const INITIAL_RETRY_MS = 1500;
const MAX_RETRY_MS = 30000;

const WebSocketContext = createContext(null);
// eslint-disable-next-line react-refresh/only-export-components
export const useWebSocket = () => useContext(WebSocketContext);

export const WebSocketProvider = ({ children }) => {
    const { user } = useAuth();
    const retryRef = useRef(INITIAL_RETRY_MS);
    const timeoutRef = useRef(null);
    // Each connect cycle gets a generation number. Cleanup increments it to
    // invalidate in-flight sockets without force-closing them while CONNECTING
    // (which is what triggers the browser's "closed before established" error).
    const genRef = useRef(0);

    const connect = (gen) => {
        if (gen !== genRef.current) return;

        const ws = new WebSocket(WS_URL);

        ws.onopen = () => {
            // Stale socket from a previous cycle — close it now that it's OPEN
            // (closing an OPEN socket is silent; closing CONNECTING triggers the error)
            if (gen !== genRef.current) { ws.close(); return; }
            retryRef.current = INITIAL_RETRY_MS;
        };

        ws.onmessage = (e) => {
            try {
                const { type } = JSON.parse(e.data);
                if (type) wsEvents.emit(type);
            } catch { /* ignore malformed frames */ }
        };

        ws.onclose = () => {
            if (gen !== genRef.current) return;
            timeoutRef.current = setTimeout(() => {
                retryRef.current = Math.min(retryRef.current * 2, MAX_RETRY_MS);
                connect(gen);
            }, retryRef.current);
        };

        ws.onerror = () => ws.close();
    };

    useEffect(() => {
        if (!user) return;

        const gen = ++genRef.current;
        retryRef.current = INITIAL_RETRY_MS;
        clearTimeout(timeoutRef.current);

        const initTimer = setTimeout(() => connect(gen), 0);

        return () => {
            clearTimeout(initTimer);
            genRef.current++; // eslint-disable-line react-hooks/exhaustive-deps
            clearTimeout(timeoutRef.current);
        };
    }, [user]);

    return (
        <WebSocketContext.Provider value={null}>
            {children}
        </WebSocketContext.Provider>
    );
};
