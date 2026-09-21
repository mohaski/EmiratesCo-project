// Shared formatters/themes for rendering offcut_sources — used by both the
// printed worksheet (ReceiptPage, always black-on-white for thermal print)
// and the manager-facing order review screen (OrderSummaryPage, dark theme).

// dim/dimWeight: thermal printers render gray, normal-weight text too faint to
// read — the receipt theme uses solid black + bold so "dim" only means
// "secondary", not "hard to print".
// strong: primary dimension numbers (source size, cut size) — deliberately
// distinct from `dim` (waste/stock annotations) so the two can't be confused
// at a glance.
export const RECEIPT_THEME = { border: '#000', dim: '#000', label: 'inherit', dimWeight: 700, strong: '#000' };
export const REVIEW_THEME = { border: 'rgba(255,255,255,0.12)', dim: '#94a3b8', label: '#64748b', dimWeight: 400, strong: '#e2e8f0' };

export const fmtLen = (n) => {
    const num = parseFloat(n);
    if (isNaN(num)) return '0ft';
    return `${(Math.round(num * 100) / 100).toString()}ft`;
};

export const fmtMm = (n) => {
    const num = parseFloat(n);
    if (isNaN(num)) return '0mm';
    return `${Math.round(num)}mm`;
};

// Canonicalizes a sheet/offcut's own two dimensions so the longer side is
// always presented as "width" — both in text ("1650 x 1022mm", never
// "1022 x 1650mm" for the identical physical piece) and in a diagram (drawn
// wide, never tall). `transposed` tells a diagram whether it must swap x/y
// (and width/height) on everything it draws, so cuts/remainders stay
// geometrically correct inside the now width-first frame.
export const canonicalWH = (w, h) => {
    const transposed = h > w;
    return { wide: transposed ? h : w, narrow: transposed ? w : h, transposed };
};

// Groups pieces within one event by identical (width, height, rotated) — a
// recursively-packed event can mix orientations (e.g. 3 pieces one way + 1
// rotated into the leftover space), so it's no longer safe to assume every
// cut in an event shares the same size.
export const groupCuts = (cuts) => {
    const groups = [];
    (cuts || []).forEach(c => {
        const existing = groups.find(g => g.width === c.width && g.height === c.height && g.rotated === c.rotated);
        if (existing) existing.count += 1;
        else groups.push({ width: c.width, height: c.height, rotated: c.rotated, count: 1 });
    });
    return groups;
};

// Groups a single OrderItem's glass (2D) cut-lines' offcut_sources by the
// physical sheet-opening event that produced them (server-side group_id —
// see glassOffcutService._apply_candidate's owns_consumption/group_id docs),
// so lines that were joint-packed onto ONE sheet render as ONE combined
// cutting instruction — cuts and remainders pooled together — instead of
// splitting back into per-line fragments where only the "owning" line ever
// carries the real remainders. Mirrors what the pre-confirmation dry-run
// preview already shows for an in-progress cart (server-side
// _consolidate_preview_events), just applied to an already-placed order.
//
// Returns [{ ownerLineIdx, ownerEventIdx, mergedSrc, cutOrigins }, ...] — one
// per distinct physical sheet actually touched. `mergedSrc` is ready to hand
// straight to <CuttingInstructions sources={[mergedSrc]} />. `cutOrigins` is
// parallel to `mergedSrc.cuts`: cutOrigins[i] = {lineIdx, cutIdx} says which
// ORIGINAL cut-line piece `i` belongs to, and that piece's own index within
// that line's un-merged event.cuts — enough for a correction UI to flag a
// missed cut against the right line even when it isn't the line that owns
// the recorded consumption. 1D (profile/bar) sources aren't part of this
// joint-packing feature and are left out entirely — render those per-line,
// as before.
export const groupJointGlassSources = (lineItems) => {
    const groups = new Map();
    (lineItems || []).forEach((li, lineIdx) => {
        (li.offcut_sources || []).forEach((ev, eventIdx) => {
            if (!('cuts' in ev)) return;
            const key = ev.group_id || `single-${lineIdx}-${eventIdx}`;
            if (!groups.has(key)) groups.set(key, []);
            groups.get(key).push({ lineIdx, eventIdx, ev });
        });
    });

    return Array.from(groups.values()).map(members => {
        const owner = members.find(m => m.ev.owns_consumption !== false) || members[0];
        const cuts = [];
        const cutOrigins = [];
        members.forEach(({ lineIdx, ev }) => {
            (ev.cuts || []).forEach((c, cutIdx) => {
                cuts.push(c);
                cutOrigins.push({ lineIdx, cutIdx });
            });
        });
        return {
            ownerLineIdx: owner.lineIdx,
            ownerEventIdx: owner.eventIdx,
            cutOrigins,
            mergedSrc: { ...owner.ev, cuts, remainders_created: owner.ev.remainders_created || [] },
        };
    });
};
