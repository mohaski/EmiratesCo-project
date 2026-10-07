import { useEffect } from 'react';
import { fmtLen, fmtMm } from '../../utils/cuttingInstructionFormat';
import { provisionalLabel } from '../../utils/provisional';

// Shared by CorrectOffcutModal (glass) and CorrectProfileOffcutModal (bars): "this source was
// never used" and the replacement source picker. The server side is core/inventory/cutCorrection.py.

const sectionLabel = { fontSize: '0.62rem', fontWeight: 700, color: '#475569', letterSpacing: '0.08em', textTransform: 'uppercase', display: 'block', marginBottom: '0.375rem' };
const inputStyle = { width: '90px', background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: '6px', color: '#e2e8f0', fontSize: '0.82rem', padding: '5px 8px', outline: 'none' };
const selectStyle = {
    width: '100%', boxSizing: 'border-box', padding: '0.625rem 0.75rem',
    background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: '0.625rem',
    color: '#e2e8f0', fontSize: '0.8rem', outline: 'none',
};

/** "This source was never used" checkbox. */
export function UnusedToggle({ checked, onChange, sourceLabel }) {
    return (
        <label style={{
            display: 'flex', alignItems: 'flex-start', gap: '0.625rem', cursor: 'pointer',
            padding: '0.75rem 1rem', borderRadius: '0.875rem',
            background: checked ? 'rgba(239,68,68,0.08)' : 'rgba(255,255,255,0.03)',
            border: `1px solid ${checked ? 'rgba(239,68,68,0.3)' : 'rgba(255,255,255,0.07)'}`,
        }}>
            <input type="checkbox" checked={checked} onChange={e => onChange(e.target.checked)}
                style={{ width: '16px', height: '16px', flexShrink: 0, marginTop: '2px', accentColor: '#ef4444' }} />
            <span>
                <span style={{ display: 'block', fontSize: '0.82rem', color: '#e2e8f0', fontWeight: 700 }}>
                    {sourceLabel} was never used
                </span>
                <span style={{ display: 'block', fontSize: '0.72rem', color: '#64748b', marginTop: '2px' }}>
                    None of these pieces came from it. Its leftovers are removed and every piece is re-supplied from what you choose below.
                </span>
            </span>
        </label>
    );
}

/** What happens to the never-used source. `wholeUnit`: it was a new bar/sheet from stock.
 * `parts`: the usable parts when it is damaged but partly usable (one or more). */
export function FatePicker({ fate, setFate, parts, setParts, wholeUnit, is2d, sourceLabel }) {
    const options = [
        { v: 'available', label: wholeUnit ? `Back to stock — still a whole ${is2d ? 'sheet' : 'bar'}` : 'Still good — the cutter just used another piece' },
        ...(wholeUnit ? [] : [{ v: 'avoid', label: 'Fine, but not for this order', hint: 'Back in the pool for other sales; this line is kept on new material from now on' }]),
        { v: 'scrap', label: 'Damaged — mark as scrap' },
        { v: 'remeasure', label: 'Damaged — part of it is usable', hint: 'Enter each usable part; the rest is written off' },
        { v: 'missing', label: "Missing — it doesn't exist" },
    ];
    const choose = (v) => {
        setFate(v);
        if (v === 'remeasure' && parts.length === 0) setParts([{}]);
    };
    const setPart = (idx, field, value) => setParts(parts.map((p, i) => i === idx ? { ...p, [field]: value } : p));
    return (
        <div style={{ marginTop: '1rem' }}>
            <span style={sectionLabel}>What happens to {sourceLabel}?</span>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.375rem' }}>
                {options.map(o => (
                    <label key={o.v} style={{
                        display: 'flex', alignItems: 'flex-start', gap: '0.5rem', cursor: 'pointer', padding: '0.5rem 0.75rem', borderRadius: '0.625rem',
                        background: fate === o.v ? 'rgba(245,158,11,0.08)' : 'transparent',
                        border: `1px solid ${fate === o.v ? 'rgba(245,158,11,0.3)' : 'rgba(255,255,255,0.06)'}`,
                    }}>
                        <input type="radio" name="source-fate" checked={fate === o.v} onChange={() => choose(o.v)}
                            style={{ marginTop: '2px', accentColor: '#f59e0b' }} />
                        <span>
                            <span style={{ display: 'block', fontSize: '0.8rem', color: '#e2e8f0', fontWeight: 600 }}>{o.label}</span>
                            {o.hint && <span style={{ display: 'block', fontSize: '0.68rem', color: '#64748b' }}>{o.hint}</span>}
                        </span>
                    </label>
                ))}
            </div>
            {fate === 'remeasure' && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem', marginTop: '0.625rem' }}>
                    {parts.map((p, idx) => (
                        <div key={idx} style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', flexWrap: 'wrap' }}>
                            <span style={{ fontSize: '0.72rem', color: '#64748b', width: '48px' }}>Part {idx + 1}</span>
                            {is2d ? (
                                <>
                                    <input type="number" min="0" placeholder="width mm" value={p.width ?? ''} style={inputStyle}
                                        onChange={e => setPart(idx, 'width', e.target.value)} />
                                    <span style={{ color: '#475569' }}>×</span>
                                    <input type="number" min="0" placeholder="height mm" value={p.height ?? ''} style={inputStyle}
                                        onChange={e => setPart(idx, 'height', e.target.value)} />
                                </>
                            ) : (
                                <>
                                    <input type="number" min="0" step="0.01" placeholder="length" value={p.length ?? ''} style={inputStyle}
                                        onChange={e => setPart(idx, 'length', e.target.value)} />
                                    <span style={{ color: '#64748b', fontSize: '0.78rem' }}>ft</span>
                                </>
                            )}
                            {parts.length > 1 && (
                                <button type="button" onClick={() => setParts(parts.filter((_, i) => i !== idx))} style={{
                                    background: 'none', border: 'none', color: '#64748b', cursor: 'pointer', fontSize: '0.9rem',
                                }}>✕</button>
                            )}
                        </div>
                    ))}
                    <button type="button" onClick={() => setParts([...parts, {}])} style={{
                        alignSelf: 'flex-start', background: 'none', border: 'none', color: '#fbbf24', fontSize: '0.75rem', fontWeight: 700, cursor: 'pointer', padding: 0,
                    }}>+ Add usable part</button>
                </div>
            )}
        </div>
    );
}

/** One source dropdown: the best fit, the original's usable parts, the offcuts that can cut
 * this piece (already filtered by the caller), or a new bar/sheet. Values are source tokens. */
export function SourceSelect({ value, onChange, offcuts, newOk, newLabel, is2d }) {
    const originals = offcuts.filter(o => o.original != null);
    const others = offcuts.filter(o => o.original == null);
    const size = (o) => is2d ? `${fmtMm(o.width)} x ${fmtMm(o.height)}` : fmtLen(o.length);
    const valid = value === 'auto' || (value === 'new' ? newOk
        : value.startsWith('original:') ? originals.some(o => `original:${o.original}` === value)
            : others.some(o => String(o.offcutId) === value));

    // A choice that is no longer on offer (the list changed under it) falls back to the best fit.
    useEffect(() => { if (!valid) onChange('auto'); }, [valid]); // eslint-disable-line react-hooks/exhaustive-deps

    return (
        <select value={valid ? value : 'auto'} onChange={e => onChange(e.target.value)} style={selectStyle}>
            <option value="auto">Let system choose (best fit)</option>
            {originals.map(o => (
                <option key={`o${o.original}`} value={`original:${o.original}`}>
                    ↩ The original{originals.length > 1 ? ` (part ${o.original + 1})` : ''} — {size(o)}
                </option>
            ))}
            {others.map(o => (
                <option key={o.offcutId} value={String(o.offcutId)}>
                    Offcut #{o.offcutId} — {size(o)} (qty {o.quantity}){o.provisional?.length
                        ? ` — provisional: ${provisionalLabel(o.provisional)} hasn't paid, the bar isn't cut yet` : ''}
                </option>
            ))}
            <option value="new" disabled={!newOk}>{newLabel}</option>
        </select>
    );
}

/** Glass: one source per piece. `options` is the preview's candidates
 * ({pieces, offcuts: [{..., fits: [piece positions]}], sheet: {fits, stock}}); `assign` maps
 * "line:cut" to a source token. Each dropdown lists only the sources that can cut that piece. */
export function PieceSourcePicker({ options, assign, setAssign }) {
    if (!options) return null;
    const { pieces, offcuts, sheet } = options;
    const stock = sheet?.stock ?? 0;
    return (
        <div style={{ marginTop: '1rem' }}>
            <span style={sectionLabel}>Replacement Source{pieces.length > 1 ? ' — choose for each piece' : ''}</span>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                {pieces.map((p, pos) => {
                    const key = `${p.line_idx}:${p.cut_idx}`;
                    const fitting = offcuts.filter(o => o.fits.includes(pos));
                    const sheetFits = (sheet?.fits || []).includes(pos);
                    return (
                        <div key={key} style={{ display: 'flex', alignItems: 'center', gap: '0.625rem', flexWrap: 'wrap' }}>
                            {pieces.length > 1 && (
                                <span style={{ fontSize: '0.78rem', color: '#e2e8f0', fontWeight: 600, minWidth: '110px' }}>
                                    {fmtMm(p.width)} x {fmtMm(p.height)}
                                </span>
                            )}
                            <div style={{ flex: '1 1 220px', minWidth: 0 }}>
                                <SourceSelect value={assign[key] || 'auto'} onChange={v => setAssign(a => ({ ...a, [key]: v }))}
                                    offcuts={fitting} is2d newOk={sheetFits && stock >= 1}
                                    newLabel={`New sheet (${stock} in stock${sheetFits ? '' : ", doesn't fit"})`} />
                            </div>
                        </div>
                    );
                })}
            </div>
            {offcuts.length === 0 && (
                <p style={{ fontSize: '0.7rem', color: '#64748b', margin: '0.375rem 0 0' }}>No existing offcut can cut these pieces.</p>
            )}
        </div>
    );
}
