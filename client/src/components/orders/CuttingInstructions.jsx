// Shared rendering for offcut_sources — describes exactly what a floor worker
// should cut and where the material comes from. Handles both the 1D
// (bar/profile, length-based) and 2D (glass, width x height) source shapes.
// Used by the printed worksheet (ReceiptPage) and the manager-facing order
// review screen (OrderSummaryPage) — see cuttingInstructionFormat.js for the
// shared formatters/themes that let one component serve both.
import { RECEIPT_THEME, fmtLen, fmtMm, groupCuts, canonicalWH } from '../../utils/cuttingInstructionFormat';

// Shown when the offcut this event consumed was itself produced by an order
// whose cutting hasn't been reported done yet — advisory only (see
// glassOffcutService._apply_candidate / inventoryService._pending_source_notice):
// doesn't block anything, just tells the cutter to double-check with a colleague
// (or themselves) before assuming the piece physically exists. Monochrome-safe
// (bold + border only) so it still reads clearly on a plain thermal print.
const PendingSourceNotice = ({ notice, theme }) => (
    <div style={{ fontSize: '9.5px', fontWeight: 700, color: theme.border, border: `1px solid ${theme.border}`, borderRadius: '3px', padding: '2px 5px', margin: '3px 0' }}>
        ⚠ Depends on an offcut from Order #{notice.order_id}
        {notice.customer_name ? ` (${notice.customer_name})` : ''} — not yet confirmed cut.
        Check with whoever's working that order, or if it was you, carry on.
    </div>
);

// One 1D (bar/profile) offcut_sources entry — {source, offcut_id, length_used, offcut_length, remainder_created}.
// `superseded` marks an event a manager correction has fully reversed and
// replaced with a separate new entry (see inventoryService.correct_profile_offcut_event) —
// kept in place as a historical record rather than deleted.
const CuttingInstructionLine1D = ({ src, theme, renderActions }) => (
    <div style={{ fontSize: '10.5px', lineHeight: 1.4, opacity: src.superseded ? 0.5 : 1 }}>
        <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: '0.5rem', flexWrap: 'wrap' }}>
            <div>
                {src.source === 'offcut'
                    ? <span>Cut <strong>{fmtLen(src.length_used)}</strong> from <strong>Offcut #{src.offcut_id}</strong> ({fmtLen(src.offcut_length)} available)</span>
                    : <span>Cut <strong>{fmtLen(src.length_used)}</strong> from a <strong>new bar</strong></span>
                }
                {src.superseded && <span style={{ color: theme.dim, fontWeight: theme.dimWeight }}> — replaced</span>}
            </div>
            {renderActions && renderActions(src)}
        </div>
        {src.pending_source_notice && <PendingSourceNotice notice={src.pending_source_notice} theme={theme} />}
        {src.remainder_created > 0 && (
            <div style={{ fontSize: '9.5px', color: theme.dim, fontWeight: theme.dimWeight, marginTop: '2px' }}>
                &gt;&gt; {fmtLen(src.remainder_created)} to stock
            </div>
        )}
    </div>
);

// Small sketch of where the cut(s) and remainder(s) sit within the sheet/offcut
// this event consumed — monochrome-safe (no reliance on color) so it stays
// legible on a plain black-and-white thermal print: the cut piece is a light
// fill, a kept remainder is a plain outline, and scrap is a dashed outline.
const CutSketch = ({ src, theme }) => {
    const srcW = src.offcut_width, srcH = src.offcut_height;
    if (!srcW || !srcH) return null;
    const { wide, narrow, transposed } = canonicalWH(srcW, srcH);
    // The sheet's own frame is always drawn wide (longer side horizontal);
    // every rect recorded against the original (possibly taller-than-wide)
    // frame needs its x/y and width/height swapped to land correctly once
    // that frame itself has been rotated onto its side.
    const mapRect = (r) => transposed
        ? { x: r.y, y: r.x, width: r.height, height: r.width }
        : { x: r.x, y: r.y, width: r.width, height: r.height };

    const maxPx = 92; // bigger than a bare outline needs, to leave room for the dimension labels below
    const scale = maxPx / wide;
    const w = Math.max(40, wide * scale), h = Math.max(40, narrow * scale);
    const strokeW = wide * 0.012;
    const fontSize = wide * 0.04;
    const pad = fontSize * 0.9; // how far a label sits in from the edge it hugs

    // Width along the top edge, height along the left edge (rotated) — like a
    // technical cutting diagram, rather than one combined "W×H" string
    // centered in the middle, which needs far more room than a thin piece has.
    // Each is independent: a long, thin sliver can still show its width even
    // though it's too short to hold a height label, and vice versa.
    //
    // The values shown come from `m` itself (the already-transposed rect),
    // NOT the piece's raw recorded width/height — when the sheet's frame gets
    // rotated onto its side (see mapRect above), what was the raw "width"
    // becomes the on-screen vertical extent and vice versa. Labeling with the
    // raw values would put the wrong number on the wrong edge whenever a
    // sheet needed transposing.
    const DimLabels = ({ m, color, weight }) => (
        <>
            {m.width > fontSize * 1.6 && m.height > fontSize && (
                <text x={m.x + m.width / 2} y={m.y + pad + fontSize * 0.35} textAnchor="middle"
                    fontSize={fontSize} fill={color} fontWeight={weight}>
                    {Math.round(m.width)}
                </text>
            )}
            {m.height > fontSize * 1.6 && m.width > fontSize && (
                <text x={m.x + pad} y={m.y + m.height / 2} textAnchor="middle"
                    fontSize={fontSize} fill={color} fontWeight={weight}
                    transform={`rotate(-90 ${m.x + pad} ${m.y + m.height / 2})`}>
                    {Math.round(m.height)}
                </text>
            )}
        </>
    );

    return (
        <svg width={w} height={h} viewBox={`0 0 ${wide} ${narrow}`} style={{ flexShrink: 0, marginTop: '1px' }}>
            <rect x={0} y={0} width={wide} height={narrow} fill="none" stroke={theme.border} strokeWidth={strokeW} />
            {(src.remainders_created || []).map((r, i) => {
                const m = mapRect(r);
                return (
                    <g key={i}>
                        <rect x={m.x} y={m.y} width={m.width} height={m.height}
                            fill="none" stroke={theme.dim} strokeWidth={strokeW}
                            strokeDasharray={r.status === 'scrap' ? `${strokeW * 2},${strokeW * 2}` : undefined} />
                        <DimLabels m={m} color={theme.dim} weight={theme.dimWeight} />
                    </g>
                );
            })}
            {(src.cuts || []).map((c, i) => {
                const m = mapRect(c);
                return (
                    <g key={i}>
                        <rect x={m.x} y={m.y} width={m.width} height={m.height}
                            fill={theme.border} fillOpacity={0.35} stroke={theme.border} strokeWidth={strokeW} />
                        <DimLabels m={m} color={theme.border} weight="700" />
                    </g>
                );
            })}
        </svg>
    );
};

// One 2D (glass) offcut_sources entry — a consumption EVENT, which may cover several
// physical pieces (possibly in mixed orientations) cut from the same source in one
// packing operation: {source, offcut_id, offcut_width, offcut_height,
//  cuts: [{width, height, rotated}, ...], remainders_created: [{width, height, status}, ...]}
const CuttingInstructionLine2D = ({ src, theme, renderActions }) => {
    const groups = groupCuts(src.cuts);
    const { wide, narrow } = canonicalWH(src.offcut_width, src.offcut_height);
    return (
        <div style={{ fontSize: '10.5px', lineHeight: 1.4, display: 'flex', gap: '6px', alignItems: 'flex-start' }}>
            <CutSketch src={src} theme={theme} />
            <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ display: 'flex', alignItems: 'baseline', gap: '0.5rem', justifyContent: 'space-between', flexWrap: 'wrap' }}>
                    <strong>{fmtMm(wide)} x {fmtMm(narrow)}</strong>
                    {renderActions && renderActions(src)}
                </div>
                {groups.map((g, i) => (
                    <div key={i}>
                        Cut <strong>{g.count > 1 ? `${g.count} x ` : ''}{fmtMm(g.width)} x {fmtMm(g.height)}</strong>
                        {g.rotated && <span style={{ color: theme.dim, fontWeight: theme.dimWeight }}> (rotated to fit)</span>}
                    </div>
                ))}
                {src.pending_source_notice && <PendingSourceNotice notice={src.pending_source_notice} theme={theme} />}
                {(src.remainders_created || []).map((r, i) => (
                    <div key={i} style={{ fontSize: '9.5px', color: theme.dim, fontWeight: theme.dimWeight, marginTop: '2px' }}>
                        {r.status === 'scrap'
                            ? <>&gt;&gt; {fmtMm(r.width)} x {fmtMm(r.height)} waste</>
                            : <>&gt;&gt; {fmtMm(r.width)} x {fmtMm(r.height)} to stock{r.is_popular ? ' ★ popular size' : ''}</>
                        }
                    </div>
                ))}
            </div>
        </div>
    );
};

// `renderActions(event)` is an optional render prop invoked per event, both 1D
// and 2D (e.g. for a manager "Correct" button) — only meaningful for owning
// events with something left to correct (see each caller's own correctable check).
export default function CuttingInstructions({ sources, theme = RECEIPT_THEME, renderActions }) {
    if (!sources || sources.length === 0) return null;
    return (
        <div style={{ border: `1px dashed ${theme.border}`, padding: '5px 7px', margin: '5px 0 2px' }}>
            <div style={{ fontSize: '9px', fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase', marginBottom: '2px', color: theme.label }}>
                Cutting Instruction
            </div>
            {sources.map((src, idx) => (
                'cuts' in src
                    ? <CuttingInstructionLine2D key={idx} src={src} theme={theme} renderActions={renderActions} />
                    : <CuttingInstructionLine1D key={idx} src={src} theme={theme} renderActions={renderActions} />
            ))}
        </div>
    );
}
