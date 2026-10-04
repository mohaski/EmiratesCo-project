import { Component } from 'react';

// A deploy replaces the hashed JS chunks; a tab still running the old build then
// fails to lazy-load a page. One reload fetches the new build — the cooldown stops a
// genuinely missing chunk from reloading forever.
const CHUNK_RELOAD_KEY = 'emirates_pos_chunk_reload';
const CHUNK_RELOAD_COOLDOWN_MS = 30_000;
const isChunkLoadError = (error) =>
    error?.name === 'ChunkLoadError' ||
    /dynamically imported module|Importing a module script failed|Loading chunk .* failed/i.test(error?.message || '');

/**
 * Catches render errors so one broken page shows a recoverable message instead of
 * blanking the whole app. Cart state lives in CartContext (above every boundary)
 * and is persisted to localStorage, so recovering never loses the cart.
 * Pass `resetKey` (e.g. the pathname) to clear the error when the user navigates away.
 */
export default class ErrorBoundary extends Component {
    constructor(props) {
        super(props);
        this.state = { error: null, resetKey: props.resetKey };
    }

    static getDerivedStateFromError(error) {
        return { error };
    }

    static getDerivedStateFromProps(props, state) {
        if (props.resetKey !== state.resetKey) {
            return { error: null, resetKey: props.resetKey };
        }
        return null;
    }

    componentDidCatch(error, info) {
        console.error('Render error caught by ErrorBoundary:', error, info?.componentStack);
        if (isChunkLoadError(error)) {
            let lastReload = 0;
            try { lastReload = Number(sessionStorage.getItem(CHUNK_RELOAD_KEY)) || 0; } catch { /* storage blocked */ }
            if (Date.now() - lastReload > CHUNK_RELOAD_COOLDOWN_MS) {
                try { sessionStorage.setItem(CHUNK_RELOAD_KEY, String(Date.now())); } catch { /* storage blocked */ }
                window.location.reload();
            }
        }
    }

    render() {
        if (!this.state.error) return this.props.children;
        const chunk = isChunkLoadError(this.state.error);
        return (
            <div role="alert" style={{
                display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
                gap: '0.75rem', padding: '2rem 1rem', minHeight: this.props.fullScreen ? '100vh' : '240px',
                textAlign: 'center', color: '#cbd5e1', background: this.props.fullScreen ? '#090e1a' : 'transparent',
            }}>
                <p style={{ margin: 0, fontSize: '1rem', fontWeight: 700, color: '#f1f5f9' }}>
                    {chunk ? 'A new version of the app is available.' : 'Something went wrong on this screen.'}
                </p>
                <p style={{ margin: 0, fontSize: '0.85rem', maxWidth: '420px' }}>
                    {chunk
                        ? 'Reload to continue. Your cart is saved.'
                        : 'Your cart is saved. Reload the page, or go back and try again.'}
                </p>
                <button onClick={() => window.location.reload()} style={{
                    marginTop: '0.5rem', padding: '0.6rem 1.25rem', borderRadius: '0.6rem', border: 'none',
                    background: '#3b82f6', color: '#fff', fontWeight: 600, cursor: 'pointer',
                }}>
                    Reload
                </button>
            </div>
        );
    }
}
