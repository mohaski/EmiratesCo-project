// Which printers THIS till prints to, saved in this browser only: every till PC can have
// different printers installed, so the server can't know. thermal: the 80mm roll for the
// department slips; a4: the laser that takes long glass worksheets (empty = none, so glass
// stays on the roll). When storage is unavailable or cleared, the defaults apply, which is
// safe: everything prints on the thermal roll as before.
const KEY = 'emirates_pos_printers';
export const DEFAULT_THERMAL_PRINTER = 'XP-80C';

export function loadPrinterSettings() {
    try {
        const saved = JSON.parse(localStorage.getItem(KEY) || '{}');
        return {
            thermal: typeof saved.thermal === 'string' && saved.thermal.trim() ? saved.thermal.trim() : DEFAULT_THERMAL_PRINTER,
            a4: typeof saved.a4 === 'string' ? saved.a4.trim() : '',
        };
    } catch {
        return { thermal: DEFAULT_THERMAL_PRINTER, a4: '' };
    }
}

export function savePrinterSettings({ thermal, a4 }) {
    const clean = { thermal: (thermal || '').trim() || DEFAULT_THERMAL_PRINTER, a4: (a4 || '').trim() };
    try { localStorage.setItem(KEY, JSON.stringify(clean)); } catch { /* storage blocked: defaults stay in use */ }
    return clean;
}
