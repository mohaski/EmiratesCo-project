// Shared formatters/themes for rendering offcut_sources — used by both the
// printed worksheet (ReceiptPage, always black-on-white for thermal print)
// and the manager-facing order review screen (OrderSummaryPage, dark theme).

export const RECEIPT_THEME = { border: '#000', dim: '#333', label: 'inherit' };
export const REVIEW_THEME = { border: 'rgba(255,255,255,0.12)', dim: '#94a3b8', label: '#64748b' };

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
