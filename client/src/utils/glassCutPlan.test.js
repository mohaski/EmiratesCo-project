// Run with `npm test` (Node's built-in test runner, no extra packages).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildGlassPlan, paginateGlassSheet, stepText, leftoverText, pieceRanges, numRange, diagramBoxMm, textLines, SHEET } from './glassCutPlan.js';
import { order370, order211, order229, order161 } from './glassCutPlan.fixtures.js';

const area = (r) => r.w * r.h;
const clone = (x) => JSON.parse(JSON.stringify(x));

// Every panel's pieces + leftovers cover the sheet exactly, and every cut stage splits its
// part into strips that add back up to the part.
function assertConsistent(plan) {
    for (const p of plan.panels) {
        if (!p.positioned) continue;
        const covered = [...p.cuts, ...p.rems].reduce((a, r) => a + area(r), 0);
        assert.ok(Math.abs(covered - p.W * p.H) <= 1, `${p.id} tiles its ${p.W}x${p.H} source`);
        assert.ok(p.tree, `${p.id} has a cut order`);
        for (const st of p.steps) {
            const total = st.segs.reduce((a, s) => a + s.size, 0);
            assert.ok(Math.abs(total - (st.axis === 'x' ? st.w : st.h)) <= st.segs.length, `${p.id} stage ${st.stage} strips add up`);
        }
    }
}

test('order 370: joint-packed lines merge into one panel per sheet', () => {
    const plan = buildGlassPlan(order370);
    assert.equal(plan.panels.length, 10);
    assert.equal(plan.panels.reduce((a, p) => a + p.cuts.length, 0), 28);
    assert.deepEqual(plan.lines.map(L => L.pieces.length), [8, 20]);
    // Some sheets carry pieces of both lines.
    assert.ok(plan.panels.some(p => new Set(p.cuts.map(c => c.line.n)).size === 2));
    assertConsistent(plan);
    // 1650x2140 recorded tall: drawn wide, first cut across.
    const p1 = plan.panels[0];
    assert.equal(p1.W, 2140);
    assert.equal(p1.H, 1650);
    assert.equal(stepText(p1.steps[0]).dir, 'across');
});

test('order 211: unrecorded grid cells become a marked KEEP piece; repeated strips collapse', () => {
    const plan = buildGlassPlan(order211);
    assert.equal(plan.panels.length, 6);
    assertConsistent(plan);
    const p1 = plan.panels[0];
    assert.equal(p1.cuts.length, 14);
    const gap = p1.rems.filter(r => r.unrecorded);
    assert.deepEqual(gap.map(r => [r.w, r.h, r.kind]), [[888, 438, 'keep']]);
    const text = p1.steps.map(st => { const t = stepText(st); return `${st.stage} ${t.what}: ${t.dir} into ${t.segs}`; });
    assert.deepEqual(text, [
        '1 Panel: down into 1776 · 54 waste',
        '2 1776×1780: across into 438 · 438 · 438 · 438 · 28 waste',
        '3 1776×438 ×3: down into 444 · 444 · 444 · 444',
        '3 1776×438: down into 444 · 444 · 888 keep',
    ]);
    assert.equal(leftoverText(p1), 'KEEP 888×438* · WASTE 54×1780, 1776×28');
    assert.equal(pieceRanges(plan.lines[0]), 'P1-1…14');
});

test('order 229: a panel cut from a same-order leftover always comes after it', () => {
    for (const items of [order229, clone(order229).reverse()]) {
        const plan = buildGlassPlan(items);
        assert.equal(plan.panels.length, 2);
        const dependent = plan.panels.find(p => p.dep);
        assert.ok(dependent, 'dependency found');
        assert.ok(plan.panels.indexOf(dependent.dep) < plan.panels.indexOf(dependent));
        assert.equal(dependent.no, 2);
        assertConsistent(plan);
    }
});

test('order 161: empty events are ignored and two glass types stay grouped', () => {
    const plan = buildGlassPlan(order161);
    assert.equal(plan.panels.length, 8);
    assert.equal(plan.types.length, 2);
    const typeOrder = plan.panels.map(p => p.typeKey);
    assert.deepEqual(typeOrder, [...typeOrder].sort((a, b) => plan.types.indexOf(a) - plan.types.indexOf(b)));
    assertConsistent(plan);
});

test('A4 pages: no page overflows, every panel is placed once, page numbers match', () => {
    for (const [name, items, wantPages] of [['370', order370, 3], ['211', order211, 2], ['229', order229, 1], ['161', order161, 3]]) {
        const plan = buildGlassPlan(items);
        const pages = paginateGlassSheet(plan);
        assert.equal(pages.length, wantPages, `order ${name} pages`);
        const seen = [];
        pages.forEach((blocks, i) => {
            const used = blocks.reduce((a, b, j) => a + b.h + (j ? SHEET.gap : 0), 0);
            assert.ok(used <= SHEET.bodyH + 0.01, `order ${name} page ${i + 1} fits (${used}mm)`);
            assert.notEqual(blocks[blocks.length - 1].kind, 'type', `order ${name} page ${i + 1} doesn't end on a heading`);
            blocks.forEach(b => (b.cards || []).forEach(p => { seen.push(p.id); assert.equal(p.page, i + 1); }));
        });
        assert.deepEqual([...seen].sort(), plan.panels.map(p => p.id).sort(), `order ${name} panels placed once`);
        assert.equal(pages[0][0].kind, 'pick', 'pick list opens page 1');
        const hasLines = pages.flat().some(b => b.kind === 'lines' || b.side);
        assert.ok(hasLines, `order ${name} has the line check table`);
        if (plan.types.length > 1) assert.equal(pages.flat().filter(b => b.kind === 'type').length, plan.types.length);
    }
});

test('a panel never sits on an earlier page than the panel it is cut from', () => {
    const plan = buildGlassPlan(clone(order229).reverse());
    paginateGlassSheet(plan);
    plan.panels.filter(p => p.dep).forEach(p => assert.ok(p.page >= p.dep.page));
});

test('old cuts without positions: listed without a drawing or cut order', () => {
    const items = clone(order211);
    items[0].details.lineItems[0].offcut_sources.forEach(ev => {
        ev.cuts.forEach(c => { delete c.x; delete c.y; });
    });
    const plan = buildGlassPlan(items);
    const p = plan.panels.find(x => !x.positioned);
    assert.ok(p);
    assert.equal(p.tree, null);
    assert.deepEqual(p.steps, []);
    assert.doesNotThrow(() => paginateGlassSheet(plan));
});

test('a layout that is not guillotine-cut gets no cut order', () => {
    // Pinwheel: four 2x1 blocks around a centre square on a 3x3 sheet.
    const r = (x, y, width, height) => ({ x, y, width, height });
    const items = [{ name: 'Clear', details: { attributes: [], lineItems: [{ label: 'Cut', qty: 4, offcut_sources: [{
        source: 'sheet', offcut_width: 300, offcut_height: 300, owns_consumption: true,
        cuts: [r(0, 0, 200, 100), r(200, 0, 100, 200), r(100, 200, 200, 100), r(0, 100, 100, 200)],
        remainders_created: [{ ...r(100, 100, 100, 100), status: 'scrap' }],
    }] }] } }];
    const p = buildGlassPlan(items).panels[0];
    assert.equal(p.positioned, true);
    assert.equal(p.tree, null);
});

test('superseded events are not panels', () => {
    const items = clone(order229);
    items[1].details.lineItems.forEach(li => li.offcut_sources.forEach(ev => { ev.superseded = true; }));
    assert.equal(buildGlassPlan(items).panels.length, 1);
});

test('numRange', () => {
    assert.equal(numRange([3, 1, 2, 4]), '1–4');
    assert.equal(numRange([1, 2]), '1,2');
    assert.equal(numRange([1, 3, 4]), '1,3,4');
});

test('card drawings never take more height than the card leaves them', () => {
    // Half-width card: 100mm minus title, sign-off, padding and the text lines it needs.
    for (const items of [order370, order211, order229, order161]) {
        const plan = buildGlassPlan(items);
        paginateGlassSheet(plan);
        for (const p of plan.panels) {
            const box = diagramBoxMm(p);
            if (p.size === 'M') {
                const used = 6.5 + box.h + textLines(p, 'M') * 3.9 + 5 + 4.8 + 4 * 1.4 + (p.pendingNotice ? 5.5 : 0);
                assert.ok(used <= SHEET.cardH + 0.5, `${p.id} M card needs ${used.toFixed(1)}mm`);
            }
            if (p.size === 'L') {
                const notes = (p.dep ? 6 : 0) + (p.pendingNotice ? 7 : 0);
                assert.ok(6.5 + notes + box.h + 4.8 + 2 * 1.4 <= SHEET.cardH + 0.5, `${p.id} L card drawing fits`);
            }
        }
    }
});
