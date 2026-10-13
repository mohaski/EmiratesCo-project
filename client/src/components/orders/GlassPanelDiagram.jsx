// The cutting layout of one glass panel (see utils/glassCutPlan.js): every piece and
// leftover in place, cut lines weighted by stage (heavier = earlier) with numbered tags,
// and the first-stage strip sizes along the edge. Black on white only, so it prints on a
// 1-bit thermal head as well as on the A4 laser: pieces are plain or light-grey boxes,
// KEEP leftovers outlined, waste hatched. Inline attributes only - QZ Tray prints the
// node's own markup without the app's stylesheet. `look`: THERMAL_LOOK or SHEET_LOOK
// (utils/glassSheetLook.js); boxW/boxH: the space to fit into, in CSS px.
import { useId } from 'react';
import { r0 } from '../../utils/glassCutPlan';

const f1 = (n) => Math.round(n * 10) / 10;

export default function GlassPanelDiagram({ panel: p, boxW, boxH, look }) {
    const hatchId = `gh${useId().replace(/[^a-zA-Z0-9_-]/g, '')}`;
    const o = look;
    const padL = o.pad, padT = o.pad, padR = o.padR, padB = o.padR;
    const s = Math.min((boxW - padL - padR) / p.W, (boxH - padT - padB) / p.H);
    const X = (v) => padL + v * s;
    const Y = (v) => padT + v * s;
    const W = padL + p.W * s + padR;
    const H = padT + p.H * s + padB;
    const textWidth = (t, fs) => String(t).length * fs * o.charW;
    const txt = { fontFamily: o.font, fill: '#000' };

    const box = (r, key, fill, sw, dashed) => (
        <rect key={key} x={f1(X(r.x))} y={f1(Y(r.y))} width={f1(r.w * s)} height={f1(r.h * s)}
            fill={fill} stroke="#000" strokeWidth={sw} strokeDasharray={dashed ? '4 3' : undefined} />
    );

    // Cut lines and their stage tags.
    const lines = [];
    const tags = [];
    if (p.tree) {
        (function walk(n) {
            if (!n.axis) return;
            const sw = o.stageW[Math.min(n.depth, o.stageW.length - 1)];
            n.cuts.forEach((c) => {
                const key = `${n.depth}-${n.x}-${n.y}-${c}`;
                if (n.axis === 'x') {
                    lines.push(<line key={key} x1={f1(X(c))} y1={f1(Y(n.y))} x2={f1(X(c))} y2={f1(Y(n.y + n.h))} stroke="#000" strokeWidth={sw} />);
                    tags.push({ key, x: X(c), y: n.depth ? Y(n.y) + o.tagR + 1.5 : padT - o.tagR - 2.5, n: n.depth + 1 });
                } else {
                    lines.push(<line key={key} x1={f1(X(n.x))} y1={f1(Y(c))} x2={f1(X(n.x + n.w))} y2={f1(Y(c))} stroke="#000" strokeWidth={sw} />);
                    tags.push({ key, x: n.depth ? X(n.x) + o.tagR + 1.5 : padL - o.tagR - 2.5, y: Y(c), n: n.depth + 1 });
                }
            });
            n.kids.forEach(walk);
        })(p.tree);
    }

    // Label inside a piece/leftover: id + size, else id only, else number only; turned
    // on its side for tall strips. Nothing when even that doesn't fit (the list has it).
    const label = (r, key) => {
        const rw = r.w * s, rh = r.h * s;
        const cx = X(r.x) + rw / 2, cy = Y(r.y) + rh / 2;
        const size = `${r0(r.w)}×${r0(r.h)}`;
        let rows;
        if (r.kind === 'cut') rows = [[o.pieceLabel(r), o.fsId, 700], [size, o.fsDim, 500]];
        else if (r.kind === 'keep') rows = [[`KEEP${r.unrecorded ? '*' : ''}`, o.fsDim - 1, 700], [size, o.fsDim, 500]];
        else rows = [[size, o.fsDim - 0.5, 500]];
        const options = [rows, rows.slice(0, 1)];
        if (r.kind === 'cut' && o.pieceLabel(r) !== String(r.num)) options.push([[String(r.num), o.fsId, 700]]);
        const halo = r.kind === 'cut' ? o.pieceFill : '#fff';
        const wOf = (rr) => rr.reduce((m, [t, fs]) => Math.max(m, textWidth(t, fs)), 0);
        const hOf = (rr) => rr.reduce((a, [, fs]) => a + fs * 1.12, 0);
        for (const rr of options) {
            for (const rot of [false, true]) {
                const aw = rot ? rh : rw, ah = rot ? rw : rh;
                if (wOf(rr) + 5 > aw || hOf(rr) + 3 > ah) continue;
                let y = cy - hOf(rr) / 2;
                return (
                    <g key={key} transform={rot ? `rotate(-90 ${f1(cx)} ${f1(cy)})` : undefined}>
                        {rr.map(([t, fs, wt], i) => {
                            y += fs * 1.12;
                            return (
                                <text key={i} x={f1(cx)} y={f1(y - fs * 0.25)} textAnchor="middle" fontSize={fs} fontWeight={wt}
                                    stroke={halo} strokeWidth={3} strokeLinejoin="round" paintOrder="stroke" style={txt}>{t}</text>
                            );
                        })}
                    </g>
                );
            }
        }
        return null;
    };

    // First-stage strip sizes along the top (down cuts) or left edge (across cuts).
    const root = p.tree?.axis ? p.tree : null;
    const chain = (cuts, total) => {
        const b = [0, ...cuts, total];
        return b.slice(1).map((v, i) => [b[i], v]);
    };
    const room = (len, t) => len * s > textWidth(t, o.chainFs) + 2 * o.tagR + 4;
    const topDims = chain(root?.axis === 'x' ? root.cuts : [], p.W).filter(([a, b]) => room(b - a, r0(b - a)));
    const leftDims = chain(root?.axis === 'y' ? root.cuts : [], p.H).filter(([a, b]) => room(b - a, r0(b - a)));

    return (
        <svg width={f1(W)} height={f1(H)} viewBox={`0 0 ${f1(W)} ${f1(H)}`} style={{ display: 'block' }}
            role="img" aria-label={`Cutting layout of panel ${p.id}, ${r0(p.W)} by ${r0(p.H)} mm`}>
            <defs>
                <pattern id={hatchId} width={o.hatch} height={o.hatch} patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
                    <rect width={o.hatch} height={o.hatch} fill="#fff" />
                    <line x1="0" y1="0" x2="0" y2={o.hatch} stroke="#000" strokeWidth={o.hatchW} />
                </pattern>
            </defs>
            {p.rems.map((r, i) => box(r, `r${i}`, r.kind === 'waste' ? `url(#${hatchId})` : '#fff', o.remStroke, r.unrecorded))}
            {p.cuts.map((c, i) => box(c, `c${i}`, o.pieceFill, o.cutStroke, false))}
            <rect x={f1(X(0))} y={f1(Y(0))} width={f1(p.W * s)} height={f1(p.H * s)} fill="none" stroke="#000" strokeWidth={o.frame} />
            {lines}
            {p.rems.map((r, i) => label(r, `lr${i}`))}
            {p.cuts.map((c, i) => label(c, `lc${i}`))}
            {topDims.map(([a, b]) => (
                <text key={`td${a}`} x={f1(X((a + b) / 2))} y={f1(padT - 5)} textAnchor="middle" fontSize={o.chainFs} style={txt}>{r0(b - a)}</text>
            ))}
            {leftDims.map(([a, b]) => {
                const x = padL - 5, y = Y((a + b) / 2);
                return <text key={`ld${a}`} x={f1(x)} y={f1(y)} textAnchor="middle" fontSize={o.chainFs} style={txt} transform={`rotate(-90 ${f1(x)} ${f1(y)})`}>{r0(b - a)}</text>;
            })}
            <line x1={f1(X(0))} y1={f1(padT - 9)} x2={f1(X(0))} y2={f1(padT - 2)} stroke="#000" strokeWidth={0.8} />
            <line x1={f1(X(p.W))} y1={f1(padT - 9)} x2={f1(X(p.W))} y2={f1(padT - 2)} stroke="#000" strokeWidth={0.8} />
            <line x1={f1(padL - 9)} y1={f1(Y(0))} x2={f1(padL - 2)} y2={f1(Y(0))} stroke="#000" strokeWidth={0.8} />
            <line x1={f1(padL - 9)} y1={f1(Y(p.H))} x2={f1(padL - 2)} y2={f1(Y(p.H))} stroke="#000" strokeWidth={0.8} />
            {tags.map((t) => (
                <g key={`t${t.key}`}>
                    <circle cx={f1(t.x)} cy={f1(t.y)} r={o.tagR} fill="#fff" stroke="#000" strokeWidth={1.1} />
                    <text x={f1(t.x)} y={f1(t.y + o.tagFs * 0.36)} textAnchor="middle" fontSize={o.tagFs} fontWeight={700} style={txt}>{t.n}</text>
                </g>
            ))}
        </svg>
    );
}
