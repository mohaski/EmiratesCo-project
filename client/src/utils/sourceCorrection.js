// Request fields for the offcut corrections (see SourceCorrectionFields and the server's
// CorrectOffcutRequest / CorrectProfileOffcutRequest).

/** The single-choice request fields a source token maps to:
 * 'auto' | 'new' | 'original:<k>' (part k of the never-used source) | an offcut id. */
export const choiceFields = (choice) => {
    const token = String(choice);
    return {
        forced_offcut_id: /^\d+$/.test(token) ? parseInt(token, 10) : null,
        force_new_source: token === 'new',
        use_original: token.startsWith('original:'),
        original_part: token.startsWith('original:') ? parseInt(token.split(':')[1], 10) || 0 : 0,
    };
};

const partOk = (p, is2d) => is2d ? parseFloat(p.width) > 0 && parseFloat(p.height) > 0 : parseFloat(p.length) > 0;

/** `parts`: the usable parts of a damaged source, [{width, height}] or [{length}]. */
export const remeasureValid = (fate, parts, is2d) => fate !== 'remeasure' || (parts.length > 0 && parts.every(p => partOk(p, is2d)));

export const remeasurePayload = (fate, parts, is2d) => fate !== 'remeasure' ? null : parts.map(p => (is2d
    ? { width: parseFloat(p.width), height: parseFloat(p.height) }
    : { length: parseFloat(p.length) }));

/** Per-piece choices for the request: only the pieces given something other than the best fit. */
export const assignmentsPayload = (assign) => Object.entries(assign)
    .filter(([, token]) => token && token !== 'auto')
    .map(([key, source]) => {
        const [line_idx, cut_idx] = key.split(':').map(Number);
        return { line_idx, cut_idx, source };
    });
