// Turns a receipt's glass items into the panels a cutter works through — one panel per
// physical sheet/offcut that gets cut — with the cut order and the A4 page layout.
// Pure functions, no React: used by ReceiptPage (thermal slip + A4 sheet) and tested
// with `npm test` (glassCutPlan.test.js).
//
// Geometry comes from each 2D offcut_sources event (glassOffcutService._apply_candidate):
// cuts and remainders_created carry x/y on the source, and the layout is a guillotine
// layout (every cut runs edge to edge of the part it splits), so the cut order can be
// worked out from the positions alone — same idea as glassOffcutService._split.

const EPS = 1; // mm
export const r0 = (v) => Math.round(v);

const thicknessOf = (item) =>
    (item.details?.attributes || []).find(a => a.label === 'Thickness')?.value
    || item.details?.extras?.Thickness || '';

const hasXY = (r) => r.x != null && r.y != null;

/**
 * items: the glass department's receipt items, in printed order, each with
 * details.lineItems[].offcut_sources from the saved order.
 * Returns { lines, panels, types }:
 *  - lines: every line of every glass item, numbered L1.. across the whole worksheet,
 *    with the piece ids cut for it.
 *  - panels: in cutting order (glass type, then order line, and never before the panel
 *    whose leftover it is cut from), numbered P1..; pieces numbered P1-1.. in reading order.
 */
export function buildGlassPlan(items) {
    const lines = [];
    const raw = [];
    (items || []).forEach((item, itemIdx) => {
        const thickness = thicknessOf(item);
        const typeKey = `${item.name || ''}|${thickness}`;
        const typeLabel = `${item.name || ''} ${thickness}`.trim();
        // A sheet joint-packed across several cut-lines shares one group_id: one panel,
        // as groupJointGlassSources does for the old per-item instruction.
        const groups = new Map();
        (item.details?.lineItems || []).forEach((li, lineIdx) => {
            const L = {
                n: lines.length + 1, item: itemIdx, lineIdx, qty: li.qty, pieces: [],
                rawLabel: li.label || '', label: String(li.label || '').replace(/^Cut:\s*/i, ''),
            };
            lines.push(L);
            (li.offcut_sources || []).forEach((ev, evIdx) => {
                if (!ev || !Array.isArray(ev.cuts) || ev.cuts.length === 0 || ev.superseded) return;
                const key = ev.group_id || `${itemIdx}-${lineIdx}-${evIdx}`;
                if (!groups.has(key)) groups.set(key, []);
                groups.get(key).push({ L, ev });
            });
        });
        groups.forEach(members => {
            const ev = (members.find(m => m.ev.owns_consumption !== false) || members[0]).ev;
            const srcW = Number(ev.offcut_width), srcH = Number(ev.offcut_height);
            const allCuts = members.flatMap(m => m.ev.cuts.map(c => ({ c, L: m.L })));
            const rems = ev.remainders_created || [];
            const positioned = srcW > 0 && srcH > 0 && allCuts.every(({ c }) => hasXY(c)) && rems.every(hasXY);
            // Drawn long side horizontal, like the old sketch (canonicalWH): swap x/y on
            // everything when the source was recorded taller than wide.
            const t = srcH > srcW;
            const tr = (r) => {
                const x = Number(r.x ?? 0), y = Number(r.y ?? 0), w = Number(r.width), h = Number(r.height);
                return t ? { x: y, y: x, w: h, h: w } : { x, y, w, h };
            };
            const p = {
                typeKey, typeLabel, item: itemIdx, seq: raw.length, positioned,
                source: ev.source, offcutId: ev.offcut_id, sourcePieceId: ev.source_piece_id ?? null,
                W: t ? srcH : srcW, H: t ? srcW : srcH,
                cuts: allCuts.map(({ c, L }) => ({ ...tr(c), kind: 'cut', line: L })),
                rems: rems.map(r => ({ ...tr(r), kind: r.status === 'scrap' ? 'waste' : 'keep', pieceId: r.piece_id ?? null })),
                firstLine: Math.min(...members.map(m => m.L.n)),
                pendingNotice: members.map(m => m.ev.pending_source_notice).find(Boolean) || null,
            };
            if (positioned) fillGaps(p);
            raw.push(p);
        });
    });

    // A panel cut from another panel's KEEP leftover in this same order must come after it.
    raw.forEach(p => {
        p.dep = p.sourcePieceId
            ? raw.find(q => q !== p && q.rems.some(r => r.pieceId && r.pieceId === p.sourcePieceId)) || null
            : null;
    });

    const typeIdx = new Map();
    raw.forEach(p => { if (!typeIdx.has(p.typeKey)) typeIdx.set(p.typeKey, typeIdx.size); });
    const panels = [...raw].sort((a, b) =>
        typeIdx.get(a.typeKey) - typeIdx.get(b.typeKey) || a.firstLine - b.firstLine || a.seq - b.seq);
    for (let guard = 0; guard < panels.length * panels.length + 1; guard++) {
        const bad = panels.find(p => p.dep && panels.indexOf(p.dep) > panels.indexOf(p));
        if (!bad) break;
        panels.splice(panels.indexOf(bad), 1);
        panels.splice(panels.indexOf(bad.dep) + 1, 0, bad);
    }

    panels.forEach((p, i) => {
        p.no = i + 1;
        p.id = `P${p.no}`;
        p.cuts.sort((a, b) => a.y - b.y || a.x - b.x);
        p.cuts.forEach((c, j) => { c.num = j + 1; c.id = `${p.id}-${j + 1}`; c.line.pieces.push(c.id); });
        p.tree = p.positioned ? decompose({ x: 0, y: 0, w: p.W, h: p.H }, [...p.cuts, ...p.rems], 0) : null;
        p.steps = p.tree ? stepsOf(p.tree) : [];
    });
    return { lines, panels, types: [...typeIdx.keys()] };
}

// Older records can miss a leftover (the 2x2-grid bug fixed on 9 Oct 2026 left the empty
// cell unrecorded). Find the area nothing covers so the drawing still tiles the source,
// and mark it, rather than drawing a hole.
export function fillGaps(p) {
    const leaves = [...p.cuts, ...p.rems];
    const area = leaves.reduce((a, r) => a + r.w * r.h, 0);
    if (Math.abs(area - p.W * p.H) <= Math.max(1, 0.001 * p.W * p.H)) return;
    const uniq = (a) => [...new Set(a.map(v => Math.round(v * 10) / 10))].sort((x, y) => x - y);
    const xs = uniq([0, p.W, ...leaves.flatMap(r => [r.x, r.x + r.w])]);
    const ys = uniq([0, p.H, ...leaves.flatMap(r => [r.y, r.y + r.h])]);
    const inLeaf = (cx, cy) => leaves.some(r => cx > r.x && cx < r.x + r.w && cy > r.y && cy < r.y + r.h);
    const rects = [];
    for (let j = 0; j < ys.length - 1; j++) {
        let run = null;
        for (let i = 0; i < xs.length - 1; i++) {
            const free = !inLeaf((xs[i] + xs[i + 1]) / 2, (ys[j] + ys[j + 1]) / 2);
            if (free) { if (run) run.x1 = xs[i + 1]; else run = { x0: xs[i], x1: xs[i + 1] }; }
            if ((!free || i === xs.length - 2) && run) {
                rects.push({ x: run.x0, y: ys[j], w: run.x1 - run.x0, h: ys[j + 1] - ys[j] });
                run = null;
            }
        }
    }
    rects.sort((a, b) => a.x - b.x || a.w - b.w || a.y - b.y);
    const merged = [];
    rects.forEach(r => {
        const m = merged.find(q => q.x === r.x && q.w === r.w && Math.abs(q.y + q.h - r.y) < 0.5);
        if (m) m.h += r.h; else merged.push({ ...r });
    });
    merged.forEach(r => p.rems.push({ ...r, kind: Math.min(r.w, r.h) >= 100 ? 'keep' : 'waste', pieceId: null, unrecorded: true }));
}

// Guillotine tree. At each part, every straight edge-to-edge cut that crosses no piece is
// made in one stage (strips side by side), so a stage's cuts all run the same way. Returns
// null when the pieces don't form a guillotine tiling (then no cut order is shown).
export function decompose(rect, leaves, depth) {
    const node = { ...rect, depth, leaves, axis: null, cuts: [], kids: [] };
    if (leaves.length <= 1) return node;
    const span = (l, axis) => (axis === 'x' ? [l.x, l.x + l.w] : [l.y, l.y + l.h]);
    const candidates = (axis) => {
        const lo = axis === 'x' ? rect.x : rect.y;
        const hi = lo + (axis === 'x' ? rect.w : rect.h);
        const vals = new Set();
        leaves.forEach(l => span(l, axis).forEach(v => { if (v > lo + EPS && v < hi - EPS) vals.add(Math.round(v * 10) / 10); }));
        return [...vals].sort((a, b) => a - b)
            .filter(c => leaves.every(l => { const [s, e] = span(l, axis); return e <= c + EPS || s >= c - EPS; }));
    };
    const cx = candidates('x'), cy = candidates('y');
    if (!cx.length && !cy.length) return null;
    let axis;
    if (cx.length && cy.length) axis = cx.length > cy.length ? 'x' : cy.length > cx.length ? 'y' : (rect.w >= rect.h ? 'x' : 'y');
    else axis = cx.length ? 'x' : 'y';
    node.axis = axis;
    node.cuts = axis === 'x' ? cx : cy;
    const bounds = axis === 'x' ? [rect.x, ...cx, rect.x + rect.w] : [rect.y, ...cy, rect.y + rect.h];
    for (let i = 0; i < bounds.length - 1; i++) {
        const a = bounds[i], b = bounds[i + 1];
        const sub = axis === 'x' ? { x: a, y: rect.y, w: b - a, h: rect.h } : { x: rect.x, y: a, w: rect.w, h: b - a };
        const subLeaves = leaves.filter(l => { const [s, e] = span(l, axis); return s >= a - EPS && e <= b + EPS; });
        const kid = decompose(sub, subLeaves, depth + 1);
        if (!kid) return null;
        node.kids.push(kid);
    }
    return node;
}

// Cut steps by stage; identical parts at the same stage collapse into one step ("x3").
export function stepsOf(root) {
    const levels = [];
    (function walk(n) {
        if (!n.axis) return;
        (levels[n.depth] = levels[n.depth] || []).push(n);
        n.kids.forEach(walk);
    })(root);
    const out = [];
    levels.forEach((nodes, d) => {
        const groups = new Map();
        nodes.forEach(n => {
            const segs = n.kids.map(k => ({ size: r0(n.axis === 'x' ? k.w : k.h), role: k.axis ? 'part' : (k.leaves[0]?.kind || 'part') }));
            const sig = [n.axis, r0(n.w), r0(n.h), segs.map(s => s.size + s.role).join(',')].join('|');
            if (!groups.has(sig)) groups.set(sig, { stage: d + 1, axis: n.axis, w: r0(n.w), h: r0(n.h), segs, count: 0, root: d === 0 });
            groups.get(sig).count += 1;
        });
        out.push(...groups.values());
    });
    return out;
}

// "down" = cut lines parallel to the left edge (strips listed left to right);
// "across" = parallel to the top edge (strips listed top to bottom).
export function stepText(st) {
    const what = st.root ? 'Panel' : `${st.w}×${st.h}${st.count > 1 ? ` ×${st.count}` : ''}`;
    const dir = st.axis === 'x' ? 'down' : 'across';
    const segs = st.segs.map(g => (g.role === 'waste' ? `${g.size} waste` : g.role === 'keep' ? `${g.size} keep` : `${g.size}`)).join(' · ');
    return { what, dir, segs };
}

// Pieces of one panel grouped by size and order line.
export function pieceGroups(p) {
    const m = new Map();
    p.cuts.forEach(c => {
        const size = `${r0(c.w)}×${r0(c.h)}`;
        const key = `${size}|${c.line.n}`;
        if (!m.has(key)) m.set(key, { size, line: c.line, ids: [], nums: [] });
        m.get(key).ids.push(c.id);
        m.get(key).nums.push(c.num);
    });
    return [...m.values()];
}

export function leftoverText(p) {
    const list = (kind) => p.rems.filter(r => r.kind === kind).map(r => `${r0(r.w)}×${r0(r.h)}${r.unrecorded ? '*' : ''}`);
    const keep = list('keep'), waste = list('waste');
    return [keep.length ? `KEEP ${keep.join(', ')}` : '', waste.length ? `WASTE ${waste.join(', ')}` : ''].filter(Boolean).join(' · ');
}

export const sourceLabel = (p) => (p.source !== 'offcut' ? 'New sheet'
    : p.dep ? `KEEP from ${p.dep.id}` : `Offcut #${p.offcutId}`);

// 1,2,3,4 -> "1–4"; anything else listed.
export const numRange = (nums) => {
    const s = [...nums].sort((a, b) => a - b);
    return s.length > 2 && s.every((v, i) => i === 0 || v === s[i - 1] + 1) ? `${s[0]}–${s[s.length - 1]}` : s.join(',');
};

// A line's pieces per panel: "P1-1…14  P3-2".
export function pieceRanges(L) {
    const by = new Map();
    L.pieces.forEach(id => {
        const [pp, n] = id.split('-');
        if (!by.has(pp)) by.set(pp, []);
        by.get(pp).push(Number(n));
    });
    return [...by].map(([pp, ns]) => {
        ns.sort((a, b) => a - b);
        const consec = ns.every((v, i) => i === 0 || v === ns[i - 1] + 1);
        if (ns.length === 1) return `${pp}-${ns[0]}`;
        return consec ? `${pp}-${ns[0]}…${ns[ns.length - 1]}` : `${pp}-${ns.join(',')}`;
    }).join('  ');
}

/* ---------------- A4 sheet layout (paper millimetres) ---------------- */

// Page body = 297 - 2x10 margin - 14 header - 7 footer - 2x3 gaps.
export const SHEET = { bodyH: 250, gap: 4, cardH: 100, headH: 12, rowH: 4.6, signH: 14, typeH: 7 };
// Drawing area inside each card size. M = half width (4 per page), L = full width
// (2 per page), XL = a whole page.
export const CARD_BOX = { M: { w: 87, h: 50 }, L: { w: 112, h: 84 }, XL: { w: 184, h: 150 } };
// Characters per text line, counted for Arial (wider than the Arial Narrow the sheet asks
// for) so a till without Arial Narrow still doesn't overflow a card.
const CHARS = { M: 46, L: 38, XL: 55 };
const LINE_CAP = { M: 6, L: 18 };

export function textLines(p, size) {
    const cpl = CHARS[size];
    const steps = p.steps.reduce((a, st) => {
        const t = stepText(st);
        return a + Math.ceil((t.what.length + t.dir.length + t.segs.length + 9) / cpl);
    }, 0);
    const pieces = pieceGroups(p).reduce((a, g) => a + Math.ceil((g.ids.join('  ').length + g.ids.length * 2 + g.size.length + 8) / cpl), 0);
    const left = p.rems.length ? Math.ceil((leftoverText(p).length + 2) / cpl) : 0;
    return steps + pieces + left + (p.dep ? 1 : 0) + (p.pendingNotice ? 1 : 0) + (p.tree ? 0 : 1);
}

// Smallest piece's shorter side on paper, in mm, at a card size.
export function minPieceMm(p, size) {
    const b = CARD_BOX[size];
    const s = Math.min((b.w - 6) / p.W, (b.h - 6) / p.H);
    return Math.min(...p.cuts.map(c => Math.min(c.w, c.h))) * s;
}

// Smallest card whose drawing keeps every piece readable and whose text fits.
export function chooseCardSize(p) {
    if (!p.positioned) return textLines(p, 'M') <= LINE_CAP.M ? 'M' : 'L';
    if (textLines(p, 'M') <= LINE_CAP.M && minPieceMm(p, 'M') >= 6) return 'M';
    if (textLines(p, 'L') <= LINE_CAP.L && minPieceMm(p, 'L') >= 6) return 'L';
    return 'XL';
}

// The drawing area a card actually gets, in mm: a half-width card's drawing takes the room
// its text doesn't need; notes above the drawing (cut-from-P1, pending offcut) take room
// from the drawing on the wider cards, where the text sits beside it.
const TEXT_LINE_MM = 3.9;
const NOTE_MM = { dep: 6, pending: 7 };
export function diagramBoxMm(p) {
    const b = CARD_BOX[p.size];
    if (p.size === 'M') {
        const spare = Math.max(0, LINE_CAP.M - textLines(p, 'M'));
        return { w: b.w, h: b.h + spare * TEXT_LINE_MM - (p.pendingNotice ? 2 : 0) };
    }
    return { w: b.w, h: b.h - (p.dep ? NOTE_MM.dep : 0) - (p.pendingNotice ? NOTE_MM.pending : 0) };
}

export function linesBlockHeight(plan, width) {
    const cpl = width === 'half' ? 22 : 64;
    const rows = plan.lines.reduce((a, L) => a + Math.max(1, Math.ceil(pieceRanges(L).length / cpl)), 0);
    return SHEET.headH + SHEET.rowH * rows + SHEET.signH;
}

/**
 * Lays the plan out on A4 pages. Sets p.size and p.page on every panel and returns
 * pages: [[block, ...], ...] with blocks
 *   { kind: 'pick' } - pick list (page 1)
 *   { kind: 'type', label, n } - glass-type heading (only when the order has 2+ types)
 *   { kind: 'row', cards: [panel, panel?], side? } - side: the line check table sits in the
 *     empty half beside a lone last card
 *   { kind: 'lines' } - order-line check table
 * A card never splits across pages, a heading never sits alone at the bottom of a page,
 * and a lone half-width card pulls the next one of the same glass up beside it.
 */
export function paginateGlassSheet(plan) {
    plan.panels.forEach(p => { p.size = chooseCardSize(p); });
    const multi = plan.types.length > 1;
    const blocks = [{ kind: 'pick', h: SHEET.headH + SHEET.rowH * plan.panels.length }];
    plan.types.forEach(tk => {
        const ps = plan.panels.filter(p => p.typeKey === tk);
        if (multi) blocks.push({ kind: 'type', h: SHEET.typeH, label: ps[0].typeLabel, n: ps.length, keepNext: true });
        const queue = [...ps];
        const placed = new Set();
        let row = null;
        const flush = () => {
            if (!row) return;
            row.cards.forEach(c => placed.add(c));
            blocks.push(row);
            row = null;
        };
        while (queue.length) {
            const p = queue.shift();
            if (p.size === 'M') {
                if (row && row.cards.length === 1) { row.cards.push(p); flush(); }
                else { flush(); row = { kind: 'row', h: SHEET.cardH, cards: [p] }; }
                continue;
            }
            if (row) {
                const k = queue.findIndex(q => q.size === 'M' && (!q.dep || placed.has(q.dep) || row.cards.includes(q.dep)));
                if (k >= 0) row.cards.push(queue.splice(k, 1)[0]);
                flush();
            }
            blocks.push({ kind: 'row', h: p.size === 'XL' ? SHEET.bodyH : SHEET.cardH, cards: [p] });
            placed.add(p);
        }
        flush();
    });

    const last = blocks[blocks.length - 1];
    if (last.kind === 'row' && last.cards.length === 1 && last.cards[0].size === 'M' && linesBlockHeight(plan, 'half') <= SHEET.cardH) {
        last.side = true;
    } else {
        blocks.push({ kind: 'lines', h: linesBlockHeight(plan, 'full') });
    }

    const pages = [[]];
    let used = 0;
    blocks.forEach((b, i) => {
        let need = b.h + (used ? SHEET.gap : 0);
        const withNext = need + (b.keepNext && blocks[i + 1] ? SHEET.gap + blocks[i + 1].h : 0);
        if (used && used + withNext > SHEET.bodyH) {
            pages.push([]);
            used = 0;
            need = b.h;
        }
        pages[pages.length - 1].push(b);
        used += need;
    });
    pages.forEach((pg, pi) => pg.forEach(b => (b.cards || []).forEach(p => { p.page = pi + 1; })));
    return pages;
}
