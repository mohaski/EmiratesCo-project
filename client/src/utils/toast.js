/**
 * Module-level bridge so the axios interceptor (outside React) can trigger
 * toasts that are rendered by ToastContext.
 */
let _handler = null;

export const setToastHandler = (fn) => { _handler = fn; };

/**
 * Show a toast notification.
 * @param {string} message
 * @param {'error'|'warning'|'success'|'info'} type
 */
export const showToast = (message, type = 'error') => {
    if (_handler) {
        _handler(message, type);
    } else {
        // Fallback before React mounts
        console.error('[Toast]', message);
    }
};

/**
 * Extract a user-readable message from an axios error response.
 * Handles FastAPI's string detail, list detail (Pydantic errors), structured
 * detail objects ({message, reasons|plan}), and network failures.
 * Always returns a string, so it is safe to render directly as a React child.
 * `fallback` is used when the response carries no usable message.
 */
export const extractErrorMessage = (error, fallback = 'An error occurred.') => {
    if (!error) return 'An unexpected error occurred.';
    const data = error.response?.data;
    if (!data) {
        if (error.code === 'ERR_NETWORK' || error.message?.includes('Network Error')) {
            return 'Cannot reach the server. Check your network connection.';
        }
        return error.message || 'An unexpected error occurred.';
    }
    const detail = data.detail;
    if (typeof detail === 'string' && detail) return detail;
    if (Array.isArray(detail)) {
        return detail.map(e => e?.msg || String(e)).filter(Boolean).join(' · ') || 'Validation error.';
    }
    if (detail && typeof detail === 'object') {
        const reasons = Array.isArray(detail.reasons) ? detail.reasons : [];
        const text = [detail.message, ...reasons].filter(r => typeof r === 'string' && r).join(' ');
        if (text) return text;
    }
    return typeof data.message === 'string' && data.message ? data.message : fallback;
};
