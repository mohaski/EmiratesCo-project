import { createContext, useContext, useState, useEffect, useCallback, useRef } from 'react';
import { setToastHandler } from '../utils/toast';

const ToastCtx = createContext(null);

const ICONS = {
    error:   '✕',
    warning: '⚠',
    success: '✓',
    info:    'ℹ',
};

const COLORS = {
    error:   { border: 'rgba(239,68,68,0.4)',  bg: 'rgba(239,68,68,0.1)',  text: '#f87171',  bar: '#ef4444' },
    warning: { border: 'rgba(251,191,36,0.4)', bg: 'rgba(251,191,36,0.08)', text: '#fbbf24', bar: '#f59e0b' },
    success: { border: 'rgba(34,197,94,0.4)',  bg: 'rgba(34,197,94,0.08)', text: '#4ade80',  bar: '#22c55e' },
    info:    { border: 'rgba(96,165,250,0.4)', bg: 'rgba(96,165,250,0.08)', text: '#93c5fd',  bar: '#3b82f6' },
};

function Toast({ id, message, type, onDismiss }) {
    const c = COLORS[type] ?? COLORS.error;
    const progressRef = useRef(null);

    useEffect(() => {
        const el = progressRef.current;
        if (!el) return;
        el.style.width = '100%';
        const raf = requestAnimationFrame(() => {
            el.style.transition = 'width 5000ms linear';
            el.style.width = '0%';
        });
        return () => cancelAnimationFrame(raf);
    }, []);

    return (
        <div style={{
            position: 'relative', overflow: 'hidden',
            display: 'flex', alignItems: 'flex-start', gap: '0.75rem',
            padding: '0.875rem 1rem 0.875rem 0.875rem',
            background: `linear-gradient(135deg, ${c.bg}, rgba(13,20,38,0.95))`,
            border: `1px solid ${c.border}`,
            borderRadius: '0.875rem', minWidth: '280px', maxWidth: '420px',
            boxShadow: '0 8px 32px rgba(0,0,0,0.5)',
            animation: 'toastSlideIn 0.2s ease',
        }}>
            {/* Coloured left bar */}
            <div style={{ position: 'absolute', left: 0, top: 0, bottom: 0, width: '3px', background: c.bar, borderRadius: '4px 0 0 4px' }} />

            {/* Icon */}
            <div style={{
                width: '22px', height: '22px', borderRadius: '50%', flexShrink: 0,
                background: c.bg, border: `1px solid ${c.border}`,
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                fontSize: '0.7rem', fontWeight: 900, color: c.text, marginLeft: '4px',
            }}>
                {ICONS[type] ?? ICONS.error}
            </div>

            {/* Message */}
            <span style={{
                flex: 1, fontSize: '0.82rem', fontWeight: 500, color: '#e2e8f0',
                lineHeight: 1.45, paddingTop: '2px', wordBreak: 'break-word',
            }}>
                {message}
            </span>

            {/* Dismiss */}
            <button
                onClick={() => onDismiss(id)}
                style={{
                    background: 'none', border: 'none', cursor: 'pointer',
                    color: '#475569', fontSize: '0.875rem', padding: '0 0 0 4px', flexShrink: 0,
                    lineHeight: 1,
                }}
                onMouseEnter={e => { e.currentTarget.style.color = '#94a3b8'; }}
                onMouseLeave={e => { e.currentTarget.style.color = '#475569'; }}
                aria-label="Dismiss"
            >
                ✕
            </button>

            {/* Progress bar */}
            <div ref={progressRef} style={{
                position: 'absolute', bottom: 0, left: 0, height: '2px',
                background: c.bar, opacity: 0.5, width: '100%',
            }} />
        </div>
    );
}

export function ToastProvider({ children }) {
    const [toasts, setToasts] = useState([]);

    const dismiss = useCallback((id) => {
        setToasts(prev => prev.filter(t => t.id !== id));
    }, []);

    const show = useCallback((message, type = 'error') => {
        const id = `${Date.now()}-${Math.random()}`;
        setToasts(prev => [...prev.slice(-4), { id, message: String(message), type }]);
        setTimeout(() => dismiss(id), 5200);
    }, [dismiss]);

    // Register handler so axios interceptor can call it
    useEffect(() => {
        setToastHandler(show);
    }, [show]);

    return (
        <ToastCtx.Provider value={show}>
            {children}

            {/* Toast container — bottom-right */}
            <div style={{
                position: 'fixed', bottom: '1.5rem', right: '1.5rem',
                zIndex: 9999, display: 'flex', flexDirection: 'column', gap: '0.625rem',
                alignItems: 'flex-end', pointerEvents: 'none',
            }}>
                <style>{`
                    @keyframes toastSlideIn {
                        from { opacity: 0; transform: translateX(24px); }
                        to   { opacity: 1; transform: translateX(0); }
                    }
                `}</style>
                {toasts.map(t => (
                    <div key={t.id} style={{ pointerEvents: 'auto' }}>
                        <Toast id={t.id} message={t.message} type={t.type} onDismiss={dismiss} />
                    </div>
                ))}
            </div>
        </ToastCtx.Provider>
    );
}

/** Call this inside any component to show a toast programmatically. */
export const useToast = () => useContext(ToastCtx);
