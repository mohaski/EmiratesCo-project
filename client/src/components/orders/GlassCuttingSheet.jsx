// The glass worksheet as A4 pages, for orders with many panels (ReceiptPage decides when).
// Page 1 opens with a pick list of every panel; each panel then gets a card (drawing, cut
// steps, pieces, leftovers, sign-off) sized by paginateGlassSheet; an order-line check
// table closes the sheet. Every page is a real 210x297mm node: `pageRef(i)` hands it to
// QZ Tray (one job per page) and the browser fallback prints the same nodes. `scale` only
// shrinks the on-screen preview, on wrappers outside those nodes.
// Inline styles only - QZ Tray prints the markup without the app's stylesheet.
import { Fragment } from 'react';
import GlassPanelDiagram from './GlassPanelDiagram';
import { StageBadge, TickBox, PendingNotice } from './GlassSheetBits';
import { SHEET_FONT, SHEET_LOOK } from '../../utils/glassSheetLook';
import { SHEET, diagramBoxMm, r0, stepText, pieceGroups, leftoverText, pieceRanges, sourceLabel } from '../../utils/glassCutPlan';

const MM = 96 / 25.4; // CSS px per mm

const S = {
    page: {
        width: '210mm', height: '297mm', padding: '10mm', boxSizing: 'border-box', background: '#fff', color: '#000',
        fontFamily: SHEET_FONT, fontSize: '8.4pt', lineHeight: 1.36, display: 'flex', flexDirection: 'column', gap: '3mm',
        fontVariantNumeric: 'tabular-nums', overflow: 'hidden',
    },
    head: { height: '14mm', flex: 'none', display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', gap: '6mm', borderBottom: '0.6mm solid #000', paddingBottom: '2mm', boxSizing: 'border-box' },
    body: { flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column', gap: `${SHEET.gap}mm` },
    foot: { height: '7mm', flex: 'none', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '4mm', borderTop: '0.3mm solid #000', fontSize: '7pt' },
    blockHead: { height: '7mm', display: 'flex', alignItems: 'flex-end', paddingBottom: '1.2mm', boxSizing: 'border-box', fontWeight: 700, fontSize: '9pt', textTransform: 'uppercase', letterSpacing: '0.06em' },
    table: { width: '100%', borderCollapse: 'collapse' },
    th: { height: '5mm', textAlign: 'left', fontSize: '6.8pt', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em', borderBottom: '0.4mm solid #000', padding: '0 1.5mm' },
    td: { height: `${SHEET.rowH}mm`, padding: '0 1.5mm', borderBottom: '0.15mm solid #9a9a9a', verticalAlign: 'middle' },
    card: { border: '0.35mm solid #000', padding: '2.4mm 3mm', display: 'flex', flexDirection: 'column', gap: '1.4mm', overflow: 'hidden', boxSizing: 'border-box', flex: 'none' },
    label: { fontSize: '6.6pt', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.08em', paddingTop: '0.5mm' },
};
const CARD_SIZE = { M: { width: '93mm', height: `${SHEET.cardH}mm` }, L: { width: '190mm', height: `${SHEET.cardH}mm` }, XL: { width: '190mm', height: `${SHEET.bodyH}mm` } };
const num = { textAlign: 'right' };
const mid = { textAlign: 'center' };

const Sign = ({ style }) => (
    <div style={{ display: 'flex', alignItems: 'flex-end', gap: '2mm', height: '5mm', flex: 'none', fontSize: '7pt', textTransform: 'uppercase', letterSpacing: '0.05em', ...style }}>
        <span>Cut by</span><i style={{ flex: 1, borderBottom: '0.3mm solid #000', height: '3.5mm' }} />
        <span>Checked</span><i style={{ flex: 1, borderBottom: '0.3mm solid #000', height: '3.5mm' }} />
    </div>
);

const TextGroup = ({ label, children }) => (
    <div style={{ display: 'grid', gridTemplateColumns: '11mm 1fr', gap: '1.5mm' }}>
        <span style={S.label}>{label}</span>
        <div style={{ minWidth: 0 }}>{children}</div>
    </div>
);

function CardText({ p }) {
    return (
        <>
            {p.positioned && (
                <TextGroup label="Cuts">
                    {p.tree ? p.steps.map((st, i) => {
                        const t = stepText(st);
                        return (
                            <div key={i} style={{ display: 'flex', gap: '1.4mm', alignItems: 'baseline' }}>
                                <StageBadge n={st.stage} size={13.6} fontSize="6.4pt" />
                                <span><b>{t.what}</b> {t.dir} into {t.segs}</span>
                            </div>
                        );
                    }) : <div>Follow the drawing: no straight cut order fits this layout.</div>}
                </TextGroup>
            )}
            <TextGroup label="Pieces">
                {pieceGroups(p).map((g, i) => (
                    <div key={i}>
                        {g.ids.map(id => <Fragment key={id}><span style={{ whiteSpace: 'nowrap' }}><TickBox size={10.6} />{id}</span>{' '}</Fragment>)}
                        <b>{g.size}</b> &middot; L{g.line.n}
                    </div>
                ))}
            </TextGroup>
            <TextGroup label="Left">
                <div>{p.rems.length ? leftoverText(p) : 'None'}</div>
                {p.rems.some(r => r.unrecorded) && <div style={{ fontSize: '7pt' }}>* Not in the stock records (older sale).</div>}
            </TextGroup>
        </>
    );
}

function PanelCard({ p }) {
    const box = diagramBoxMm(p);
    const top = (
        <div style={{ display: 'flex', alignItems: 'center', gap: '2.5mm', height: '6.5mm', flex: 'none' }}>
            <span style={{ fontWeight: 700, fontSize: '12pt', border: '0.5mm solid #000', padding: '0 1.6mm', lineHeight: 1.25 }}>{p.id}</span>
            <span style={{ flex: 1, fontSize: '8.6pt', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                <b>{sourceLabel(p)}</b> {r0(p.W)} × {r0(p.H)}
            </span>
            <span style={{ fontSize: '7.6pt', textTransform: 'uppercase', letterSpacing: '0.05em', whiteSpace: 'nowrap' }}>{p.typeLabel}</span>
        </div>
    );
    const notes = (
        <>
            {p.dep && (
                <div style={{ fontSize: '7.8pt', fontWeight: 700, border: '0.4mm solid #000', padding: '0.4mm 1.6mm', flex: 'none' }}>
                    Cut from {p.dep.id}&apos;s leftover in this order. Cut {p.dep.id} first.
                </div>
            )}
            {p.pendingNotice && <PendingNotice notice={p.pendingNotice} fontSize="7.8pt" />}
        </>
    );
    const drawing = p.positioned
        ? <div style={{ flex: 'none' }}><GlassPanelDiagram panel={p} boxW={box.w * MM} boxH={box.h * MM} look={SHEET_LOOK} /></div>
        : <div style={{ flex: 'none', fontWeight: 700 }}>No layout was stored for this older cut. Cut the pieces listed.</div>;
    const text = <div style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column', gap: '0.8mm' }}><CardText p={p} /></div>;

    if (p.size === 'L') {
        return (
            <div data-panel={p.id} style={{ ...S.card, ...CARD_SIZE.L }}>
                {top}{notes}
                <div style={{ display: 'flex', gap: '4mm', flex: 1, minHeight: 0 }}>
                    {drawing}
                    <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column' }}>{text}<Sign /></div>
                </div>
            </div>
        );
    }
    return <div data-panel={p.id} style={{ ...S.card, ...CARD_SIZE[p.size] }}>{top}{notes}{drawing}{text}<Sign /></div>;
}

function PickList({ plan }) {
    const pieces = plan.panels.reduce((a, p) => a + p.cuts.length, 0);
    return (
        <div style={{ flex: 'none' }}>
            <div style={S.blockHead}>Pick list &middot; {plan.panels.length} panels &middot; {pieces} pieces</div>
            <table style={S.table}>
                <thead><tr>
                    <th style={S.th}>Panel</th><th style={S.th}>Glass</th><th style={S.th}>Source</th>
                    <th style={{ ...S.th, ...num }}>Size mm</th><th style={{ ...S.th, ...num }}>Pieces</th>
                    <th style={{ ...S.th, ...num }}>Page</th><th style={{ ...S.th, ...mid }}>Fetched</th>
                </tr></thead>
                <tbody>{plan.panels.map(p => (
                    <tr key={p.id}>
                        <td style={S.td}><b>{p.id}</b></td>
                        <td style={S.td}>{p.typeLabel}</td>
                        <td style={S.td}>{sourceLabel(p)}{p.dep ? <i> (after {p.dep.id})</i> : null}</td>
                        <td style={{ ...S.td, ...num }}>{r0(p.W)} × {r0(p.H)}</td>
                        <td style={{ ...S.td, ...num }}>{p.cuts.length}</td>
                        <td style={{ ...S.td, ...num }}>{p.page}</td>
                        <td style={{ ...S.td, ...mid }}><TickBox size={10.6} /></td>
                    </tr>
                ))}</tbody>
            </table>
        </div>
    );
}

function LineCheck({ plan, half }) {
    const frame = half
        ? { width: '93mm', height: `${SHEET.cardH}mm`, border: '0.35mm solid #000', padding: '0 3mm 2.4mm', boxSizing: 'border-box', display: 'flex', flexDirection: 'column', flex: 'none' }
        : { flex: 'none' };
    return (
        <div style={frame}>
            <div style={S.blockHead}>Check by order line</div>
            <table style={S.table}>
                <thead><tr>
                    <th style={S.th}>Line</th><th style={S.th}>Ordered</th><th style={{ ...S.th, ...num }}>Qty</th>
                    <th style={S.th}>Pieces</th><th style={{ ...S.th, ...mid }}>Done</th>
                </tr></thead>
                <tbody>{plan.lines.map(L => (
                    <tr key={L.n}>
                        <td style={S.td}><b>L{L.n}</b></td>
                        <td style={S.td}>{L.label}</td>
                        <td style={{ ...S.td, ...num }}>{L.qty}</td>
                        <td style={S.td}>{pieceRanges(L) || '—'}</td>
                        <td style={{ ...S.td, ...mid }}><TickBox size={10.6} /></td>
                    </tr>
                ))}</tbody>
            </table>
            <Sign style={half ? { marginTop: 'auto' } : { marginTop: '5mm' }} />
        </div>
    );
}

function Block({ b, plan }) {
    if (b.kind === 'pick') return <PickList plan={plan} />;
    if (b.kind === 'lines') return <LineCheck plan={plan} />;
    if (b.kind === 'type') {
        return (
            <div style={{ height: `${SHEET.typeH}mm`, flex: 'none', background: '#000', color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '0 3mm', fontWeight: 700, fontSize: '9pt', letterSpacing: '0.08em', textTransform: 'uppercase' }}>
                <span>{b.label}</span><span>{b.n} panel{b.n > 1 ? 's' : ''}</span>
            </div>
        );
    }
    return (
        <div style={{ display: 'flex', gap: `${SHEET.gap}mm`, flex: 'none' }}>
            {b.cards.map(p => <PanelCard key={p.id} p={p} />)}
            {b.side && <LineCheck plan={plan} half />}
        </div>
    );
}

export default function GlassCuttingSheet({ plan, pages, orderNo, date, customerName, isUpdate, pageRef, scale = 1 }) {
    const total = pages.length;
    return (
        <div className="a4-sheet" style={{ display: 'flex', flexDirection: 'column', gap: '22px', alignItems: 'flex-start' }}>
            {pages.map((blocks, i) => (
                <figure key={i} style={{ margin: 0 }}>
                    <figcaption className="print-hidden" style={{ fontSize: '0.75rem', color: '#94a3b8', marginBottom: '6px', fontWeight: 600 }}>
                        A4 page {i + 1} of {total}
                    </figcaption>
                    <div className="a4-box" style={{ width: `calc(210mm * ${scale})`, height: `calc(297mm * ${scale})`, overflow: 'hidden', background: '#fff', boxShadow: '0 6px 24px rgba(0,0,0,0.4)' }}>
                        <div className="a4-scale" style={{ transform: `scale(${scale})`, transformOrigin: '0 0' }}>
                            <div ref={pageRef ? pageRef(i) : undefined} className="a4-page" style={S.page}>
                                <header style={S.head}>
                                    <div>
                                        <div style={{ fontWeight: 700, fontSize: '12pt', letterSpacing: '0.06em' }}>EMIRATESCO</div>
                                        <div style={{ fontSize: '6.8pt', letterSpacing: '0.1em', textTransform: 'uppercase' }}>Aluminium &amp; Glass Merchants</div>
                                    </div>
                                    <div style={{ flex: 1, textAlign: 'center' }}>
                                        <div style={{ fontWeight: 700, fontSize: '13pt', textTransform: 'uppercase', letterSpacing: '0.04em' }}>Glass cutting sheet</div>
                                        <div style={{ fontSize: '8pt' }}>
                                            Order No. {orderNo} &middot; {date} &middot; Prepared for: <b>{customerName}</b>
                                            {isUpdate && <b> (updated order: replaces the sheet printed before)</b>}
                                        </div>
                                    </div>
                                    <div style={{ fontSize: '9pt', whiteSpace: 'nowrap' }}>Page <b>{i + 1}</b> of {total}</div>
                                </header>
                                <div style={S.body}>
                                    {blocks.map((b, j) => <Block key={j} b={b} plan={plan} />)}
                                </div>
                                <footer style={S.foot}>
                                    <span>Order No. {orderNo} &middot; Internal worksheet &mdash; not a customer invoice</span>
                                    <span style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', width: '100mm', flex: 'none' }}>
                                        <span style={{ fontSize: '6.5pt' }}>This bar should measure 100 mm</span>
                                        <i style={{ display: 'block', width: '100mm', height: '1.6mm', border: '0.3mm solid #000', borderTop: 0, boxSizing: 'border-box' }} />
                                    </span>
                                </footer>
                            </div>
                        </div>
                    </div>
                </figure>
            ))}
        </div>
    );
}
