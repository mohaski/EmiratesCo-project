// One glass panel on the 80mm thermal worksheet: the full-width cutting layout, the cut
// steps by stage, the pieces to tick off (numbered as on the drawing) and the leftovers.
// Replaces the old 92px sketch for glass (CuttingInstructions still serves bars).
import GlassPanelDiagram from './GlassPanelDiagram';
import { StageBadge, TickBox, PendingNotice } from './GlassSheetBits';
import { THERMAL_LOOK } from '../../utils/glassSheetLook';
import { r0, stepText, pieceGroups, numRange, sourceLabel } from '../../utils/glassCutPlan';

const TAPE_INNER = 278; // 302px tape minus 2x12px padding (ReceiptPage)

const Section = ({ children }) => (
    <div style={{ fontSize: '9px', fontWeight: 700, letterSpacing: '0.1em', textTransform: 'uppercase', marginTop: '5px', borderBottom: '1px solid #000' }}>
        {children}
    </div>
);

const Chip = ({ kind }) => (
    <span style={{
        display: 'inline-block', fontSize: '7.5px', fontWeight: 800, letterSpacing: '0.04em', padding: '1px 4px',
        borderRadius: '2px', lineHeight: 1.5, whiteSpace: 'nowrap', flexShrink: 0,
        border: kind === 'keep' ? '1px solid #000' : '1px dashed #000',
    }}>{kind === 'keep' ? 'KEEP' : 'WASTE'}</span>
);

export default function GlassPanelThermal({ panel: p, total }) {
    return (
        <section style={{ borderTop: '2px solid #000', margin: '10px 0 4px', paddingTop: '5px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', gap: '6px', fontSize: '9.5px', fontWeight: 700, letterSpacing: '0.04em' }}>
                <span>{p.id} &middot; PANEL {p.no} OF {total}</span>
                <span>{sourceLabel(p).toUpperCase()}</span>
            </div>
            <div style={{ fontSize: '13px', fontWeight: 700 }}>{r0(p.W)} x {r0(p.H)} mm</div>
            {p.dep && (
                <div style={{ fontSize: '10px', fontWeight: 700, border: '1.5px solid #000', padding: '2px 5px', margin: '3px 0' }}>
                    Cut from the KEEP piece of {p.dep.id} above. Cut {p.dep.id} first.
                </div>
            )}
            {p.pendingNotice && <PendingNotice notice={p.pendingNotice} />}

            {p.positioned ? (
                <div style={{ margin: '4px 0 2px' }}>
                    <GlassPanelDiagram panel={p} boxW={TAPE_INNER} boxH={236} look={THERMAL_LOOK} />
                </div>
            ) : (
                <div style={{ fontSize: '10px', fontWeight: 700, margin: '3px 0' }}>No layout was stored for this older cut. Cut the pieces below.</div>
            )}

            {p.positioned && (
                <>
                    <Section>Cuts</Section>
                    {p.tree ? p.steps.map((st, i) => {
                        const t = stepText(st);
                        return (
                            <div key={i} style={{ display: 'flex', gap: '6px', alignItems: 'baseline', fontSize: '11px', lineHeight: 1.4, marginTop: '3px' }}>
                                <StageBadge n={st.stage} />
                                <span><strong>{t.what}</strong> {t.dir} into {t.segs}</span>
                            </div>
                        );
                    }) : (
                        <div style={{ fontSize: '10.5px', marginTop: '3px' }}>Follow the drawing: no straight cut order fits this layout.</div>
                    )}
                </>
            )}

            <Section>Pieces</Section>
            {pieceGroups(p).map((g, i) => (
                <div key={i} style={{ display: 'flex', flexWrap: 'wrap', gap: '2px 7px', alignItems: 'center', marginTop: '3px', fontSize: '11px' }}>
                    <TickBox />
                    <strong>{numRange(g.nums)}</strong>
                    <span>{g.size}</span>
                    <span style={{ marginLeft: 'auto', fontSize: '10px', fontWeight: 700 }}>L{g.line.n}{g.nums.length > 1 ? ` ×${g.nums.length}` : ''}</span>
                </div>
            ))}

            {p.rems.length > 0 && (
                <>
                    <Section>Leftover</Section>
                    {p.rems.map((r, i) => (
                        <div key={i} style={{ display: 'flex', gap: '6px', alignItems: 'center', marginTop: '3px', fontSize: '11px', fontWeight: 700 }}>
                            <Chip kind={r.kind} />{r0(r.w)} x {r0(r.h)}{r.unrecorded ? ' *' : ''}
                        </div>
                    ))}
                    {p.rems.some(r => r.unrecorded) && (
                        <div style={{ fontSize: '9px', fontWeight: 700, marginTop: '2px' }}>* Not in the stock records (older sale).</div>
                    )}
                </>
            )}
        </section>
    );
}
