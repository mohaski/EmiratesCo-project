import { useEffect, useState } from 'react';
import api from '../../services/api';
import { showToast } from '../../utils/toast';

const CHOICES = [0, 2, 3, 4, 5, 6, 8, 10];

/**
 * CEO/admin: from how many panels (glass sheets/offcuts to cut) a glass worksheet prints on
 * the A4 printer instead of the thermal roll. Shop-wide; each till still needs its own A4
 * printer set up (Printers, on the receipt page), otherwise it keeps the thermal roll.
 */
export default function GlassA4Setting() {
    const [value, setValue] = useState(null);
    const [busy, setBusy] = useState(false);

    useEffect(() => {
        api.settingsService.getGlassPrint().then(r => setValue(Number(r?.a4MinPanels) || 0)).catch(() => {});
    }, []);

    const change = async (e) => {
        const next = Number(e.target.value);
        setBusy(true);
        try {
            const saved = await api.settingsService.setGlassPrint(next);
            setValue(saved.a4MinPanels);
            showToast(next ? `Glass worksheets with ${next} or more panels now print on A4.` : 'Glass worksheets now always print on the thermal roll.', 'success');
        } catch { /* the reason is already shown */ } finally {
            setBusy(false);
        }
    };

    if (value === null) return null;
    const options = CHOICES.includes(value) ? CHOICES : [...CHOICES, value].sort((a, b) => a - b);
    return (
        <label title="Glass worksheets cutting this many panels print on the A4 printer" style={{
            display: 'flex', alignItems: 'center', gap: '0.5rem', padding: '0.375rem 0.5rem 0.375rem 0.875rem', borderRadius: '0.75rem',
            background: value ? 'rgba(14,124,134,0.14)' : 'rgba(255,255,255,0.05)',
            border: `1px solid ${value ? 'rgba(45,212,191,0.4)' : 'rgba(255,255,255,0.1)'}`,
            color: value ? '#5eead4' : '#94a3b8', fontWeight: 700, fontSize: '0.78rem', whiteSpace: 'nowrap',
        }}>
            📄 Glass on A4
            <select value={value} onChange={change} disabled={busy} data-glass-a4-setting style={{
                background: 'rgba(9,14,26,0.9)', color: '#e2e8f0', border: '1px solid rgba(255,255,255,0.12)', borderRadius: '0.5rem',
                padding: '0.25rem 0.375rem', fontSize: '0.78rem', fontWeight: 600, cursor: busy ? 'wait' : 'pointer',
            }}>
                {options.map(n => <option key={n} value={n}>{n ? `from ${n} panels` : 'Off'}</option>)}
            </select>
        </label>
    );
}
