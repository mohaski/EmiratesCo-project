import { useState } from 'react';
import { listPrintersViaQZ } from '../../utils/qzPrint';
import { savePrinterSettings } from '../../utils/printerSettings';

/**
 * This till's printers (saved in this browser - utils/printerSettings.js): the thermal roll
 * for the department slips and, optionally, the A4 laser that takes long glass worksheets.
 * "Find printers" asks QZ Tray for what Windows has installed, so names can be picked
 * instead of typed. a4MinPanels is the shop-wide rule (set by the CEO on Orders).
 */
export default function PrinterSetupModal({ current, a4MinPanels, onClose, onSaved }) {
    const [thermal, setThermal] = useState(current.thermal);
    const [a4, setA4] = useState(current.a4);
    const [found, setFound] = useState(null);
    const [finding, setFinding] = useState(false);
    const [findError, setFindError] = useState('');

    const find = async () => {
        setFinding(true);
        setFindError('');
        try {
            setFound(await listPrintersViaQZ());
        } catch (err) {
            setFindError(err?.qzUnreachable
                ? 'QZ Tray is not running on this PC. Start it, reload this page, and try again. You can also type the names as Windows shows them.'
                : `QZ Tray could not list printers: ${err?.message || err}`);
        } finally {
            setFinding(false);
        }
    };

    const save = (e) => {
        e.preventDefault();
        onSaved(savePrinterSettings({ thermal, a4 }));
    };

    const labelStyle = { fontSize: '0.62rem', fontWeight: 700, color: '#64748b', letterSpacing: '0.08em', textTransform: 'uppercase', display: 'block', marginBottom: '0.375rem' };
    const inputStyle = {
        width: '100%', boxSizing: 'border-box', padding: '0.625rem 0.75rem', background: 'rgba(255,255,255,0.06)',
        border: '1px solid rgba(255,255,255,0.1)', borderRadius: '0.75rem', color: '#f1f5f9', fontSize: '0.875rem', outline: 'none',
    };
    const hint = { fontSize: '0.72rem', color: '#64748b', margin: '0.375rem 0 0' };
    const rule = a4MinPanels > 0
        ? `Glass worksheets that cut ${a4MinPanels} or more panels print on the A4 printer. Smaller ones, and every other slip, stay on the thermal roll.`
        : 'A4 printing for glass is switched off for the shop, so everything prints on the thermal roll.';

    return (
        <div onClick={onClose} style={{ position: 'fixed', inset: 0, zIndex: 60, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '1rem', background: 'rgba(9,14,26,0.85)', backdropFilter: 'blur(12px)' }}>
            <div onClick={e => e.stopPropagation()} role="dialog" aria-labelledby="printer-setup-title" style={{
                width: '100%', maxWidth: '440px', background: 'linear-gradient(145deg, rgba(13,20,38,0.99), rgba(9,14,26,0.99))',
                border: '1px solid rgba(255,255,255,0.1)', borderRadius: '1.5rem', overflow: 'hidden', boxShadow: '0 32px 80px rgba(0,0,0,0.7)',
            }}>
                <div style={{ padding: '1.25rem 1.75rem', borderBottom: '1px solid rgba(255,255,255,0.07)', display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '0.75rem' }}>
                    <div>
                        <h2 id="printer-setup-title" style={{ fontSize: '1rem', fontWeight: 800, color: '#f1f5f9', margin: 0 }}>Printers on this till</h2>
                        <p style={{ fontSize: '0.68rem', color: '#475569', margin: 0, letterSpacing: '0.06em', textTransform: 'uppercase' }}>Saved on this PC only</p>
                    </div>
                    <button type="button" onClick={onClose} aria-label="Close" style={{ width: '30px', height: '30px', borderRadius: '8px', border: '1px solid rgba(255,255,255,0.1)', background: 'rgba(255,255,255,0.05)', color: '#64748b', cursor: 'pointer' }}>✕</button>
                </div>

                <form onSubmit={save} style={{ padding: '1.25rem 1.75rem 1.5rem', display: 'flex', flexDirection: 'column', gap: '1rem' }}>
                    <p style={{ fontSize: '0.8rem', color: '#94a3b8', margin: 0, lineHeight: 1.5 }}>{rule}</p>

                    <div>
                        <label htmlFor="printer-thermal" style={labelStyle}>Thermal receipt printer (80mm)</label>
                        <input id="printer-thermal" list="printer-names" value={thermal} onChange={e => setThermal(e.target.value)} style={inputStyle} />
                    </div>
                    <div>
                        <label htmlFor="printer-a4" style={labelStyle}>A4 printer for glass worksheets</label>
                        <input id="printer-a4" list="printer-names" value={a4} onChange={e => setA4(e.target.value)} placeholder="None: glass stays on the thermal roll" style={inputStyle} />
                        <p style={hint}>Use the name exactly as Windows shows it. Print one sheet and check the 100 mm bar at the bottom with a ruler.</p>
                    </div>
                    <datalist id="printer-names">{(found || []).map(n => <option key={n} value={n} />)}</datalist>

                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', flexWrap: 'wrap' }}>
                        <button type="button" onClick={find} disabled={finding} style={{ padding: '0.5rem 0.875rem', borderRadius: '0.625rem', border: '1px solid rgba(255,255,255,0.12)', background: 'rgba(255,255,255,0.05)', color: '#cbd5e1', fontWeight: 700, fontSize: '0.78rem', cursor: finding ? 'wait' : 'pointer' }}>
                            {finding ? 'Looking…' : 'Find printers'}
                        </button>
                        {found && <span style={{ fontSize: '0.75rem', color: '#64748b' }}>{found.length} found. Pick one from the boxes above.</span>}
                    </div>
                    {findError && <p style={{ fontSize: '0.75rem', color: '#fbbf24', margin: 0, lineHeight: 1.5 }}>{findError}</p>}

                    <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.625rem', marginTop: '0.25rem' }}>
                        <button type="button" onClick={onClose} style={{ padding: '0.625rem 1rem', borderRadius: '0.75rem', border: '1px solid rgba(255,255,255,0.1)', background: 'transparent', color: '#94a3b8', fontWeight: 700, fontSize: '0.82rem', cursor: 'pointer' }}>Cancel</button>
                        <button type="submit" style={{ padding: '0.625rem 1.25rem', borderRadius: '0.75rem', border: 'none', background: 'linear-gradient(135deg, rgba(245,158,11,0.85), rgba(234,88,12,0.85))', color: '#fff', fontWeight: 700, fontSize: '0.82rem', cursor: 'pointer' }}>Save</button>
                    </div>
                </form>
            </div>
        </div>
    );
}
