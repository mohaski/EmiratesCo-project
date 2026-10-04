import { useEffect, useState } from 'react';
import { useRegisterSW } from 'virtual:pwa-register/react';

const DISMISS_KEY = 'pwa-install-dismissed';
const DISMISS_TTL = 7 * 24 * 60 * 60 * 1000; // 7 days

export default function PWAPrompt() {
    const [installPrompt, setInstallPrompt] = useState(null);
    const [showInstall, setShowInstall] = useState(false);

    const {
        needRefresh: [needRefresh],
        updateServiceWorker,
    } = useRegisterSW({
        onRegistered(sw) {
            if (!sw) return;
            // Check for a new version every 5 minutes and whenever the app comes back into
            // view. A long-open tab used to run old code for up to an hour after a deploy.
            setInterval(() => sw.update(), 5 * 60 * 1000);
            const onVisible = () => { if (document.visibilityState === 'visible') sw.update(); };
            document.addEventListener('visibilitychange', onVisible);
            window.addEventListener('focus', () => sw.update());
        },
        onRegisterError(err) {
            console.warn('[PWA] SW registration failed:', err);
        },
    });

    // A waiting update is applied on its own once the till is idle, so nobody keeps running
    // an old build for days because "Update now" was never pressed: no cart or edit in
    // progress, not on a checkout / receipt / password screen, nobody typing.
    useEffect(() => {
        if (!needRefresh) return undefined;
        const BUSY_PATHS = ['/checkout', '/checkout/receipt', '/change-password'];
        const isIdle = () => {
            if (BUSY_PATHS.includes(window.location.pathname)) return false;
            try {
                const cart = JSON.parse(localStorage.getItem('emirates_pos_cart') || '[]');
                if (Array.isArray(cart) && cart.length > 0) return false;
                if (localStorage.getItem('emirates_pos_edit_session')) return false;
            } catch { return false; }
            const el = document.activeElement;
            if (el && ['INPUT', 'TEXTAREA', 'SELECT'].includes(el.tagName)) return false;
            return true;
        };
        const timer = setInterval(() => { if (isIdle()) updateServiceWorker(true); }, 20000);
        return () => clearInterval(timer);
    }, [needRefresh, updateServiceWorker]);

    useEffect(() => {
        const handler = (e) => {
            e.preventDefault();
            const dismissed = localStorage.getItem(DISMISS_KEY);
            const expired = !dismissed || Date.now() - parseInt(dismissed, 10) > DISMISS_TTL;
            if (expired) {
                setInstallPrompt(e);
                setShowInstall(true);
            }
        };
        window.addEventListener('beforeinstallprompt', handler);
        return () => window.removeEventListener('beforeinstallprompt', handler);
    }, []);

    const handleInstall = async () => {
        if (!installPrompt) return;
        installPrompt.prompt();
        const { outcome } = await installPrompt.userChoice;
        setShowInstall(false);
        setInstallPrompt(null);
        if (outcome === 'dismissed') {
            localStorage.setItem(DISMISS_KEY, Date.now().toString());
        }
    };

    const handleDismissInstall = () => {
        setShowInstall(false);
        localStorage.setItem(DISMISS_KEY, Date.now().toString());
    };

    if (!needRefresh && !showInstall) return null;

    return (
        <>
            {needRefresh && (
                <div style={toast}>
                    <span style={{ fontSize: '0.8rem', color: '#cbd5e1', fontWeight: 500 }}>
                        New version available
                    </span>
                    <button onClick={() => updateServiceWorker(true)} style={btn('#3b82f6')}>
                        Update now
                    </button>
                </div>
            )}

            {showInstall && !needRefresh && (
                <div style={toast}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.625rem' }}>
                        <img src="/icon.svg" alt="" style={{ width: '28px', height: '28px', borderRadius: '6px' }} />
                        <span style={{ fontSize: '0.8rem', color: '#cbd5e1', fontWeight: 500 }}>
                            Install EmiratesCo app
                        </span>
                    </div>
                    <div style={{ display: 'flex', gap: '0.5rem' }}>
                        <button onClick={handleInstall} style={btn('#22c55e')}>Install</button>
                        <button onClick={handleDismissInstall} style={btn('rgba(255,255,255,0.08)')}>Later</button>
                    </div>
                </div>
            )}
        </>
    );
}

const toast = {
    position: 'fixed',
    bottom: '1.5rem',
    left: '50%',
    transform: 'translateX(-50%)',
    display: 'flex',
    alignItems: 'center',
    gap: '1rem',
    padding: '0.75rem 1rem',
    background: 'rgba(9, 14, 26, 0.96)',
    border: '1px solid rgba(255,255,255,0.12)',
    borderRadius: '0.875rem',
    backdropFilter: 'blur(20px)',
    boxShadow: '0 8px 40px rgba(0,0,0,0.5)',
    zIndex: 9999,
    whiteSpace: 'nowrap',
};

const btn = (bg) => ({
    padding: '0.35rem 0.875rem',
    background: bg,
    border: 'none',
    borderRadius: '0.5rem',
    color: '#f1f5f9',
    fontSize: '0.78rem',
    fontWeight: 600,
    cursor: 'pointer',
    transition: 'opacity 0.15s ease',
    minHeight: '32px',
});
