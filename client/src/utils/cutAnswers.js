/**
 * Cut-answer helpers shared by the confirmation dialog, the calculators (edit mode) and the
 * Correct-answers dialog. An answer for one cut line:
 *   { physicalState: 'not_cut' | 'already_cut', resolution, laterCuts: { "<item_id>": state } }
 */

/** Is this line fully answered - its own cut and every later cut from the same material? */
export function lineAnswered(line, answer) {
    if (!answer?.physicalState || answer.physicalState === 'unknown') return false;
    return (line.later_cuts || []).every(lc => {
        const v = answer.laterCuts?.[String(lc.item_id)];
        return v === 'not_cut' || v === 'already_cut';
    });
}

export function answersComplete(lines, answers) {
    return (lines || []).every(l => lineAnswered(l, answers?.[l.line_ref]));
}

/** The API payload for a set of answers, limited to the given lines. */
export function answersPayload(lines, answers) {
    const payload = {};
    (lines || []).forEach(l => {
        const a = answers?.[l.line_ref];
        if (!a?.physicalState) return;
        payload[l.line_ref] = {
            physicalState: a.physicalState,
            resolution: a.physicalState === 'already_cut' ? (a.resolution || 'return_to_pool') : null,
            laterCuts: { ...(a.laterCuts || {}) },
        };
    });
    return payload;
}

// offcut_selection too: reopening an item and closing it must not read as a change. A pick-only
// change is still a change to the server, which then asks at checkout instead.
const IGNORED_LINE_KEYS = new Set(['offcut_sources', 'stock_sources', '_resolved_as_2d', 'rate', 'total', 'label', 'offcut_selection']);

function canonical(value) {
    if (Array.isArray(value)) return value.map(canonical);
    if (value && typeof value === 'object') {
        const out = {};
        Object.keys(value).sort().forEach(k => { out[k] = canonical(value[k]); });
        return out;
    }
    return value;
}

/** Mirrors orderService._stock_signature for the parts a calculator controls. */
export function stockSignature(lineItems, variantId) {
    const lines = (lineItems || []).map(line => {
        if (!line || typeof line !== 'object') return line;
        const keep = {};
        Object.entries(line).forEach(([k, v]) => { if (!IGNORED_LINE_KEYS.has(k)) keep[k] = v; });
        if (keep.meta && typeof keep.meta === 'object') {
            const drop = new Set(['rateSqFt']);
            if (keep.type === 'sheet-half') ['l', 'w', 'u'].forEach(k => drop.add(k));
            const meta = {};
            Object.entries(keep.meta).forEach(([k, v]) => { if (!drop.has(k)) meta[k] = v; });
            keep.meta = meta;
        }
        return canonical(keep);
    });
    return JSON.stringify({ v: variantId ?? null, l: lines });
}
