import { useEffect, useState } from 'react';
import api from '../../services/api';
import { showToast } from '../../utils/toast';

/**
 * CEO/admin switch for provisional offcuts (server: PROVISIONAL_OFFCUTS_PLAN.md). On: a bar
 * leftover of an open sale window can be cut by any till, marked provisional, so two sales
 * don't open two bars when one is enough. It can only change while no sale window is open -
 * the server refuses (409) with the reason otherwise, and that reason is shown.
 */
export default function ProvisionalOffcutsToggle() {
    const [enabled, setEnabled] = useState(null);
    const [busy, setBusy] = useState(false);

    useEffect(() => {
        api.windowService.getProvisionalSettings().then(r => setEnabled(!!r.enabled)).catch(() => {});
    }, []);

    const flip = async () => {
        const next = !enabled;
        if (!window.confirm(next
            ? 'Share open sales\' bar leftovers as provisional offcuts? Every till can then cut from them (marked provisional) instead of opening a new bar. Only possible while no sale window is open.'
            : 'Stop sharing open sales\' leftovers? Each window keeps its leftovers to itself again. Only possible while no sale window is open.')) return;
        setBusy(true);
        try {
            await api.windowService.setProvisionalSettings(next);
            setEnabled(next);
            showToast(next ? 'Provisional offcuts are on.' : 'Provisional offcuts are off.', 'success');
        } catch { /* the reason (e.g. windows still open) is already shown */ } finally {
            setBusy(false);
        }
    };

    if (enabled === null) return null;
    return (
        <button onClick={flip} disabled={busy} data-provisional-toggle style={{
            padding: '0.625rem 1rem', borderRadius: '0.75rem', cursor: busy ? 'wait' : 'pointer',
            background: enabled ? 'rgba(139,92,246,0.14)' : 'rgba(255,255,255,0.05)',
            border: `1px solid ${enabled ? 'rgba(167,139,250,0.45)' : 'rgba(255,255,255,0.1)'}`,
            color: enabled ? '#c4b5fd' : '#94a3b8', fontWeight: 700, fontSize: '0.78rem', whiteSpace: 'nowrap',
        }} title="Share open sales' bar leftovers with every till, marked provisional">
            🧩 Shared leftovers: {enabled ? 'On' : 'Off'}
        </button>
    );
}
