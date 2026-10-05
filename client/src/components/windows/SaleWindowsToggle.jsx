import { useState } from 'react';
import api from '../../services/api';
import { useWindows } from '../../context/WindowContext';
import { showToast } from '../../utils/toast';

/** CEO/admin switch for sale windows. Off closes every open window first (their stock goes back). */
export default function SaleWindowsToggle() {
    const { enabled, refreshWindows } = useWindows();
    const [busy, setBusy] = useState(false);

    const flip = async () => {
        const next = !enabled;
        if (!next && !window.confirm('Turn sale windows off? Every open window on every till is closed and its items go back to stock.')) return;
        setBusy(true);
        try {
            const res = await api.windowService.setSettings(next);
            showToast(next ? 'Sale windows are on.' : `Sale windows are off${res.released ? ` - ${res.released} open window(s) closed` : ''}.`, 'success');
            await refreshWindows();
        } catch { /* reason already shown */ } finally {
            setBusy(false);
        }
    };

    return (
        <button onClick={flip} disabled={busy} data-windows-toggle style={{
            padding: '0.625rem 1rem', borderRadius: '0.75rem', cursor: busy ? 'wait' : 'pointer',
            background: enabled ? 'rgba(34,197,94,0.12)' : 'rgba(255,255,255,0.05)',
            border: `1px solid ${enabled ? 'rgba(34,197,94,0.4)' : 'rgba(255,255,255,0.1)'}`,
            color: enabled ? '#4ade80' : '#94a3b8', fontWeight: 700, fontSize: '0.78rem', whiteSpace: 'nowrap',
        }}>🪟 Sale windows: {enabled ? 'On' : 'Off'}</button>
    );
}
