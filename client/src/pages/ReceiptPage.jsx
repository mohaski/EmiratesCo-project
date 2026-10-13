import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import api from '../services/api';
import { BUCKET_ORDER, BUCKET_META, bucketOf } from '../utils/receiptCategories';
import CuttingInstructions from '../components/orders/CuttingInstructions';
import GlassPanelThermal from '../components/orders/GlassPanelThermal';
import GlassCuttingSheet from '../components/orders/GlassCuttingSheet';
import PrinterSetupModal from '../components/orders/PrinterSetupModal';
import { groupJointGlassSources } from '../utils/cuttingInstructionFormat';
import { buildGlassPlan, paginateGlassSheet } from '../utils/glassCutPlan';
import { printTapesViaQZ, printA4PagesViaQZ } from '../utils/qzPrint';
import { loadPrinterSettings } from '../utils/printerSettings';

// 80mm thermal POS roll — ~72mm printable width. Pure black-on-white, monospace,
// single column: no side-by-side layout or colour tints survive a 1-bit thermal head.
const MONO = 'ui-monospace, "Cascadia Mono", "Segoe UI Mono", Consolas, "Courier New", monospace';
const TAPE_WIDTH = '302px'; // 80mm @ 96dpi, for the on-screen preview
const A4_PX = 210 * 96 / 25.4; // an A4 page's width in CSS px
const GLASS_A4_DEFAULT = 3; // server default (core/settings/service.py), if the setting can't be read
const a4SentNote = (printer, pages) => ({ tone: 'ok', text: `Glass cutting sheet sent to ${printer} (${pages} page${pages === 1 ? '' : 's'}).` });

const LeaderRow = ({ left, right }) => (
    <div style={{ display: 'flex', alignItems: 'baseline', gap: '4px', marginTop: '4px' }}>
        <span>{left}</span>
        <span style={{ flex: 1, borderBottom: '1px dotted #777', marginBottom: '3px' }} />
        <span style={{ fontSize: '10.5px', whiteSpace: 'nowrap' }}>{right}</span>
    </div>
);

// Labels that only ever describe a variant's SIZE/pack, not its physical
// identity (glass sheet "Dimensions", profile/accessory bar "Length" — see
// server/core/inventory/poolKey.py). Once a cut is involved, the actual
// source is whatever the pooled offcut engine picked — shown accurately by
// CuttingInstructions below — so the nominal variant's own size is not just
// redundant but can be outright misleading (a pooled offcut may come from a
// differently-sized sheet/bar entirely). Kept for a pure full-sheet/full-bar
// line, which has no CuttingInstructions of its own (full sales aren't cut —
// see inventoryService.py's dispatcher) and where the size is the only way
// to tell which physical stock to pull, since a product can stock more than
// one sheet size per thickness.
const SIZE_ONLY_LABELS = new Set(['Dimensions', 'Length']);

// `glass` (glass department only): this item's panels from the worksheet-wide cut plan
// (utils/glassCutPlan.js), the plan's panel count, and the L-numbers of its lines - the
// panels replace the old per-sheet sketch with a full-width layout and the cut order.
const ReceiptItemRow = ({ item, index, glass }) => {
    const lineItems = item.details?.lineItems || [];
    const hasPooledCut = lineItems.some(li => {
        const t = li.type || '';
        return t === 'glass-cut' || t.includes('cut') || t.includes('half');
    });
    const visibleAttributes = (item.details?.attributes || []).filter(attr => !hasPooledCut || !SIZE_ONLY_LABELS.has(attr.label));
    // A sheet joint-packed across several cut-lines (see
    // glassOffcutService._apply_candidate's owns_consumption/group_id) needs
    // to print ONCE, with every cut and the real leftover together — not
    // split back into per-line fragments where only one line's box would
    // show any remainder at all. See groupJointGlassSources.
    const glassGroups = groupJointGlassSources(lineItems);

    return (
    <div>
        <div style={{ fontWeight: 700, marginTop: '6px' }}>
            {String(index + 1).padStart(2, '0')} &middot; {item.name}
        </div>

        {visibleAttributes.length > 0 && (
            <div style={{ fontSize: '10px', color: '#000', fontWeight: 700, margin: '1px 0 4px' }}>
                {visibleAttributes.map((attr, idx) => (
                    <span key={idx}>
                        {idx > 0 && <span style={{ margin: '0 4px' }}>&middot;</span>}
                        {attr.label}: {attr.value}
                    </span>
                ))}
            </div>
        )}

        {lineItems.map((li, idx) => (
            <LeaderRow
                key={idx}
                left={`${glass ? `L${glass.lineNos.get(idx)} ` : ''}${li.label}${li.meta?.l ? ` (${li.meta.l}x${li.meta.w}${li.meta.u || ''})` : ''}`}
                right={`qty ${li.qty}`}
            />
        ))}

        {lineItems.map((li, idx) => {
            const is2D = (li.offcut_sources || []).some(s => 'cuts' in s);
            if (is2D) return null; // printed once per physical sheet below instead
            return <CuttingInstructions key={idx} sources={li.offcut_sources} />;
        })}
        {glass
            ? glass.panels.map(p => <GlassPanelThermal key={p.id} panel={p} total={glass.total} />)
            : glassGroups.map((g, gi) => (
                <CuttingInstructions key={`glass-${gi}`} sources={[g.mergedSrc]} />
            ))}
    </div>
    );
};

const Rule = ({ dashed = true, style }) => (
    <div style={{ borderTop: dashed ? '1px dashed #000' : '1px solid #000', margin: '8px 0', ...style }} />
);

export default function ReceiptPage() {
    const location = useLocation();
    const navigate = useNavigate();

    const { orderId, orderNo, cartItems, customer, categories, mode } = location.state || {};

    const [orderDetail, setOrderDetail] = useState(null);
    const [loadError, setLoadError] = useState(null);

    useEffect(() => {
        if (!orderId) return;
        let cancelled = false;
        api.orderService.getOrder(orderId)
            .then(data => { if (!cancelled) setOrderDetail(data); })
            .catch(err => { if (!cancelled) { console.error('Failed to load order for receipt', err); setLoadError('Could not load cutting details — showing order without offcut instructions.'); } });
        return () => { cancelled = true; };
    }, [orderId]);

    // The printed number is the gap-free order number (orders.order_no), not the internal id:
    // from the confirm response for a new sale, else from the loaded order.
    const receiptMeta = useMemo(() => ({
        number: orderNo ?? orderDetail?.orderNo ?? orderId,
        date: new Date().toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }),
    }), [orderId, orderNo, orderDetail?.orderNo]);

    // Merge the pre-submit cart snapshot (names, categories, display breakdown) with the
    // authoritative post-submit order (offcut_sources), matched positionally — one OrderItem
    // is created per cart item, in the same order, by orderService.create_order.
    const mergedItems = useMemo(() => {
        if (!cartItems) return [];
        return cartItems.map((item, i) => {
            const backendLineItems = orderDetail?.items?.[i]?.details?.lineItems;
            if (!backendLineItems || !item.details?.lineItems) return item;
            const lineItems = item.details.lineItems.map((li, j) => ({
                ...li,
                offcut_sources: backendLineItems[j]?.offcut_sources || null,
            }));
            return { ...item, details: { ...item.details, lineItems } };
        });
    }, [cartItems, orderDetail]);

    const grouped = useMemo(() => {
        const buckets = { profile: [], glass: [], accessory: [] };
        mergedItems.forEach(item => {
            const bucket = bucketOf(item.category);
            if (bucket) buckets[bucket].push(item);
        });
        return buckets;
    }, [mergedItems]);

    const visibleBuckets = BUCKET_ORDER.filter(b => categories?.[b] && grouped[b].length > 0);

    // Glass worksheet: one cut plan for the whole department - panels numbered P1.. across
    // every glass item in cutting order - drawn on the thermal slip and, for a big job, on A4.
    const glassPlan = useMemo(() => buildGlassPlan(grouped.glass), [grouped.glass]);
    const glassPages = useMemo(() => (glassPlan.panels.length ? paginateGlassSheet(glassPlan) : []), [glassPlan]);
    const glassRows = useMemo(() => grouped.glass.map((_, i) => ({
        panels: glassPlan.panels.filter(p => p.item === i),
        total: glassPlan.panels.length,
        lineNos: new Map(glassPlan.lines.filter(L => L.item === i).map(L => [L.lineIdx, L.n])),
    })), [grouped.glass, glassPlan]);

    // Where the glass worksheet prints. The shop sets how many panels make it an A4 job (CEO,
    // on Orders); each till says which A4 printer it has (Printers). A till without one keeps
    // printing glass on the thermal roll.
    const [printers, setPrinters] = useState(loadPrinterSettings);
    const [showPrinterSetup, setShowPrinterSetup] = useState(false);
    const [a4MinPanels, setA4MinPanels] = useState(null);
    useEffect(() => {
        let cancelled = false;
        api.settingsService.getGlassPrint()
            .then(r => { if (!cancelled) setA4MinPanels(Number(r?.a4MinPanels) || 0); })
            .catch(() => { if (!cancelled) setA4MinPanels(GLASS_A4_DEFAULT); });
        return () => { cancelled = true; };
    }, []);
    const glassPanelCount = glassPlan.panels.length;
    const glassSelected = visibleBuckets.includes('glass');
    const a4Due = glassSelected && a4MinPanels > 0 && glassPanelCount >= a4MinPanels;
    const toA4 = a4Due && Boolean(printers.a4);

    const isLoading = (Boolean(orderId) && !orderDetail && !loadError) || a4MinPanels === null;

    // Keyed by bucket name so we can hand the actual rendered tape nodes to QZ Tray
    // in visibleBuckets order, one print job per department slip.
    const tapeRefs = useRef(new Map());
    const setTapeRef = useCallback((bucket) => (el) => {
        if (el) tapeRefs.current.set(bucket, el);
        else tapeRefs.current.delete(bucket);
    }, []);

    // QZ Tray (a local desktop agent — see utils/qzPrint.js) prints straight to the
    // thermal printer with no dialog. Chrome's own --kiosk-printing flag is a known
    // broken feature that still shows the dialog, so this is the only reliable silent
    // route; if QZ Tray isn't installed/running on this till, fall back to the browser
    // print dialog so printing still works, just not silently.
    // Slips QZ Tray already printed before failing part-way: left out of the browser
    // fallback (hidden in @media print), which used to print every slip again.
    const [skipBuckets, setSkipBuckets] = useState([]);
    // Giving up on QZ Tray can take 20s+ (Chrome throttles repeated failed WebSocket
    // connects), by which time the seller may have moved on — the fallback dialog then
    // popped up over whatever page they were on, printing that page instead of the slips.
    const mountedRef = useRef(false);
    useEffect(() => {
        mountedRef.current = true;
        return () => { mountedRef.current = false; };
    }, []);

    // The A4 pages, in order, for QZ Tray (see GlassCuttingSheet).
    const pageRefs = useRef(new Map());
    const setPageRef = useCallback((i) => (el) => {
        if (el) pageRefs.current.set(i, el);
        else pageRefs.current.delete(i);
    }, []);
    const a4Nodes = useCallback(() => glassPages.map((_, i) => pageRefs.current.get(i)).filter(Boolean), [glassPages]);

    // What happened to the last print, when it isn't simply "it printed": { tone, text }.
    const [printNote, setPrintNote] = useState(null);
    // Browser dialog fallback. 'tape' prints the thermal slips (minus skipBuckets); 'a4'
    // prints only the A4 pages at A4 size, and the seller picks the A4 printer in the dialog.
    const [printMode, setPrintMode] = useState('tape');
    const browserPrint = useCallback((what) => {
        setPrintMode(what);
        // Let the print-only styles render before the dialog snapshots the page.
        setTimeout(() => {
            if (!mountedRef.current) return;
            window.print();
            setPrintMode('tape');
        }, 50);
    }, []);

    // A4 first, when this is an A4 job: whether it worked decides if the glass slip still
    // goes on the roll. Then every slip for the roll, as before. State is only set after a
    // print attempt (this also runs from the auto-print effect).
    const handlePrint = useCallback(async () => {
        let glassOnA4 = false;
        let qzDown = false;
        let note = null;
        if (toA4) {
            const pages = a4Nodes();
            try {
                await printA4PagesViaQZ(pages, printers.a4);
                glassOnA4 = true;
                note = a4SentNote(printers.a4, pages.length);
            } catch (err) {
                if (!mountedRef.current) return;
                console.warn('A4 print via QZ Tray failed', err);
                if (err?.qzUnreachable) {
                    glassOnA4 = true;
                    qzDown = true;
                    note = { tone: 'warn', text: 'QZ Tray is not running, so the glass cutting sheet has not printed. Click "Print A4 sheet" and choose the A4 printer.' };
                } else if (err?.printedCount > 0) {
                    glassOnA4 = true;
                    note = { tone: 'warn', text: `The A4 printer stopped after page ${err.printedCount} of ${pages.length}. Click "Print A4 sheet" to print the sheet again.` };
                } else {
                    note = { tone: 'warn', text: `The A4 printer "${printers.a4}" did not take the job (${err?.message || 'no reason given'}), so the glass worksheet printed on the receipt printer instead.` };
                }
            }
        }
        const skipGlass = glassOnA4 ? ['glass'] : [];
        const buckets = visibleBuckets.filter(b => tapeRefs.current.get(b) && !skipGlass.includes(b));
        const nodes = buckets.map(b => tapeRefs.current.get(b));
        if (nodes.length === 0) {
            // Only the glass sheet was due and QZ Tray is down: its dialog is the only one.
            if (qzDown) {
                setPrintNote({ tone: 'warn', text: 'QZ Tray is not running. Choose the A4 printer in the print dialog.' });
                browserPrint('a4');
            } else if (note) {
                setPrintNote(note);
            }
            return;
        }
        try {
            await printTapesViaQZ(nodes, printers.thermal);
            if (mountedRef.current && note) setPrintNote(note);
        } catch (err) {
            if (!mountedRef.current) return;
            console.warn('QZ Tray print failed, falling back to browser print dialog', err);
            const done = buckets.slice(0, err?.printedCount || 0);
            setSkipBuckets([...done, ...skipGlass]);
            if (note) setPrintNote(note);
            browserPrint('tape');
        }
    }, [visibleBuckets, toA4, a4Nodes, printers, browserPrint]);

    // "Print A4 sheet": the A4 version on demand, for any glass job (QZ Tray when this till
    // has an A4 printer, else the browser dialog).
    const handlePrintA4 = useCallback(async () => {
        setPrintNote(null);
        const pages = a4Nodes();
        if (printers.a4) {
            try {
                await printA4PagesViaQZ(pages, printers.a4);
                if (mountedRef.current) setPrintNote(a4SentNote(printers.a4, pages.length));
                return;
            } catch (err) {
                if (!mountedRef.current) return;
                console.warn('A4 print via QZ Tray failed, falling back to browser print dialog', err);
            }
        }
        setPrintNote({ tone: 'warn', text: 'Choose the A4 printer in the print dialog.' });
        browserPrint('a4');
    }, [a4Nodes, printers, browserPrint]);

    // On-screen A4 preview: open by default for an A4 job; pages shrink to the column.
    const [showA4, setShowA4] = useState(null);
    const a4Open = showA4 ?? a4Due;
    const hasGlassSheet = glassSelected && glassPanelCount > 0;
    const a4SectionRef = useRef(null);
    const [a4Scale, setA4Scale] = useState(0.6);
    useEffect(() => {
        const el = a4SectionRef.current;
        if (!el || typeof ResizeObserver === 'undefined') return undefined;
        const ro = new ResizeObserver(() => { if (el.clientWidth > 0) setA4Scale(Math.min(1, el.clientWidth / A4_PX)); });
        ro.observe(el);
        return () => ro.disconnect();
    }, [hasGlassSheet]);

    // Auto-print the worksheet(s) the moment they're ready, so the seller doesn't have
    // to click through — cutting/checking staff just tear off what the printer produces.
    // Guarded with a ref (not just isLoading) so it fires exactly once per visit, not on
    // every re-render once loading settles.
    // Also once per ORDER across reloads (sessionStorage): an app update or a refresh on
    // this page used to print every slip again. "Print" still reprints on demand.
    const hasAutoPrintedRef = useRef(false);
    useEffect(() => {
        if (!isLoading && !hasAutoPrintedRef.current && visibleBuckets.length > 0) {
            hasAutoPrintedRef.current = true;
            const key = `emirates_pos_auto_printed_${orderId}`;
            let already = false;
            try { already = sessionStorage.getItem(key) === '1'; sessionStorage.setItem(key, '1'); } catch { /* storage blocked */ }
            if (!already) handlePrint();
        }
    }, [isLoading, visibleBuckets.length, handlePrint, orderId]);

    const panelsText = `${glassPanelCount} panel${glassPanelCount === 1 ? '' : 's'} to cut`;
    const a4RouteText = toA4
        ? `${panelsText}, so this sheet prints on the A4 printer "${printers.a4}". The glass slip above is the fallback.`
        : a4Due
            ? `${panelsText}: an A4 job, but this till has no A4 printer set up, so the glass worksheet prints on the thermal roll. Add one under Printers.`
            : a4MinPanels > 0
                ? `${panelsText}, under the ${a4MinPanels}-panel mark, so it prints on the thermal roll. "Print A4 sheet" prints this version on demand.`
                : `A4 printing is off for the shop, so glass prints on the thermal roll. "Print A4 sheet" prints this version on demand.`;
    const secondaryButton = {
        display: 'flex', alignItems: 'center', gap: '0.375rem', background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.1)',
        borderRadius: '0.75rem', padding: '0.5rem 0.875rem', color: '#cbd5e1', cursor: 'pointer', fontWeight: 600, fontSize: '0.8rem', whiteSpace: 'nowrap',
    };

    if (!orderId || !cartItems) {
        return (
            <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', flexDirection: 'column', gap: '1rem', background: 'var(--color-bg)' }}>
                <p style={{ color: '#64748b', fontSize: '0.875rem' }}>No receipt data found.</p>
                <button onClick={() => navigate('/orders')} style={{ color: '#fbbf24', fontWeight: 700, background: 'none', border: 'none', cursor: 'pointer', fontSize: '0.875rem' }}>← Return to Orders</button>
            </div>
        );
    }

    return (
        <div style={{ minHeight: '100vh', background: 'var(--color-bg)', padding: '2.5rem 1rem' }} className="receipt-page">
            <style type="text/css" media="print">{printMode === 'a4' ? `
                /* Browser fallback for the A4 glass sheet: only its pages, at true size,
                   one per sheet of paper. Each page carries its own 10mm margin. */
                @page { size: A4; margin: 0; }
                html, body { background-color: #fff !important; margin: 0 !important; padding: 0 !important; }
                .print-hidden, .receipt-strip-row { display: none !important; }
                .receipt-page { padding: 0 !important; background: #fff !important; min-height: 0 !important; }
                .a4-section { max-width: none !important; margin: 0 !important; }
                .a4-pages, .a4-sheet { display: block !important; }
                .a4-sheet figure { margin: 0 !important; }
                .a4-box { width: auto !important; height: auto !important; overflow: visible !important; box-shadow: none !important; }
                .a4-scale { transform: none !important; }
                .a4-page { page-break-after: always; break-after: page; }
                .a4-sheet figure:last-of-type .a4-page { page-break-after: auto; break-after: auto; }
            ` : `
                /* XP-80T (and 80mm thermal generally): zero the page margin and let the
                   tape's own inner padding be the only margin — a printer-driver margin
                   here would double up with it and eat into the ~72mm printable width. */
                @page { size: 80mm auto; margin: 0; }
                html, body { background-color: #fff !important; margin: 0 !important; padding: 0 !important; }
                .print-hidden, .a4-section { display: none !important; }
                .receipt-page { padding: 0 !important; background: #fff !important; }
                .receipt-strip-row { display: block !important; gap: 0 !important; }
                .receipt-tape { box-shadow: none !important; width: 100% !important; }
                .receipt-section { width: 100% !important; page-break-after: always; break-after: page; }
                .receipt-section:last-of-type { page-break-after: auto; break-after: auto; }
                .receipt-section[data-skip-print="true"] { display: none !important; }
            `}</style>

            {/* Action Bar */}
            <div className="print-hidden" style={{ maxWidth: '720px', margin: '0 auto 1.5rem', display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '1rem' }}>
                <button onClick={() => navigate('/orders')} style={{
                    display: 'flex', alignItems: 'center', gap: '0.5rem', background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.09)',
                    borderRadius: '0.75rem', padding: '0.5rem 1rem', color: '#94a3b8', cursor: 'pointer', fontWeight: 600, fontSize: '0.82rem', transition: 'all 0.15s',
                }}
                onMouseEnter={e => { e.currentTarget.style.color = '#f1f5f9'; e.currentTarget.style.borderColor = 'rgba(255,255,255,0.2)'; }}
                onMouseLeave={e => { e.currentTarget.style.color = '#94a3b8'; e.currentTarget.style.borderColor = 'rgba(255,255,255,0.09)'; }}>
                    ← Back to Orders
                </button>
                <div style={{ display: 'flex', alignItems: 'center', gap: '1rem', flexWrap: 'wrap' }}>
                    {loadError && <span style={{ color: '#f87171', fontSize: '0.78rem', fontWeight: 600 }}>{loadError}</span>}
                    {isLoading && <span style={{ color: '#64748b', fontSize: '0.82rem' }}>Preparing receipt…</span>}
                    <button onClick={() => setShowPrinterSetup(true)} style={secondaryButton} title="Which printers this till uses">
                        ⚙️ Printers
                    </button>
                    {hasGlassSheet && (
                        <button onClick={handlePrintA4} disabled={isLoading} style={{ ...secondaryButton, cursor: isLoading ? 'not-allowed' : 'pointer' }} title="Print the glass worksheet on A4">
                            📄 Print A4 sheet
                        </button>
                    )}
                    <button onClick={() => { setPrintNote(null); handlePrint(); }} disabled={isLoading} style={{
                        padding: '0.625rem 1.5rem', borderRadius: '0.75rem', border: 'none',
                        background: isLoading ? 'rgba(245,158,11,0.3)' : 'linear-gradient(135deg, rgba(245,158,11,0.85), rgba(234,88,12,0.85))',
                        color: '#fff', fontWeight: 700, fontSize: '0.82rem', cursor: isLoading ? 'not-allowed' : 'pointer',
                        boxShadow: isLoading ? 'none' : '0 4px 16px rgba(245,158,11,0.25)', transition: 'all 0.2s',
                        display: 'flex', alignItems: 'center', gap: '0.5rem',
                    }}>
                        🖨️ Print Receipt
                    </button>
                </div>
            </div>

            {printNote && (
                <div className="print-hidden" role="status" style={{
                    maxWidth: '720px', margin: '0 auto 1.25rem', padding: '0.625rem 0.875rem', borderRadius: '0.75rem', fontSize: '0.8rem', fontWeight: 600, lineHeight: 1.5,
                    background: printNote.tone === 'ok' ? 'rgba(34,197,94,0.1)' : 'rgba(245,158,11,0.1)',
                    border: `1px solid ${printNote.tone === 'ok' ? 'rgba(34,197,94,0.25)' : 'rgba(245,158,11,0.3)'}`,
                    color: printNote.tone === 'ok' ? '#4ade80' : '#fbbf24',
                }}>
                    {printNote.tone === 'ok' ? '✓ ' : '⚠️ '}{printNote.text}
                </div>
            )}

            {visibleBuckets.length === 0 && (
                <div className="print-hidden" style={{ maxWidth: '480px', margin: '0 auto', textAlign: 'center', color: '#64748b', fontSize: '0.875rem' }}>
                    No departments were selected for this receipt.
                </div>
            )}

            {/* Strip(s) — one per checked/populated department, each its own torn-off slip */}
            <div className="receipt-strip-row" style={{ display: 'flex', flexWrap: 'wrap', gap: '2rem', justifyContent: 'center', alignItems: 'flex-start' }}>
                {visibleBuckets.map((bucket, sheetIdx) => {
                    const meta = BUCKET_META[bucket];
                    return (
                        <div key={bucket} className="receipt-section" data-skip-print={skipBuckets.includes(bucket) ? 'true' : undefined}>
                            {bucket === 'glass' && toA4 && (
                                <div className="print-hidden" style={{ maxWidth: TAPE_WIDTH, fontSize: '0.72rem', fontWeight: 600, color: '#94a3b8', marginBottom: '0.5rem', lineHeight: 1.45 }}>
                                    Goes to the A4 printer. This slip prints only if the A4 printer can&apos;t.
                                </div>
                            )}
                            <div
                                ref={setTapeRef(bucket)}
                                className="receipt-tape print:shadow-none"
                                style={{
                                    width: `min(${TAPE_WIDTH}, 100%)`, boxSizing: 'border-box', background: '#ffffff', color: '#000000',
                                    fontFamily: MONO, fontSize: '11.5px', lineHeight: 1.5,
                                    padding: '14px 12px', boxShadow: '0 6px 24px rgba(0,0,0,0.4)',
                                }}
                            >
                                <div style={{ textAlign: 'center' }}>
                                    <div style={{ fontSize: '15px', fontWeight: 700, letterSpacing: '0.02em' }}>EMIRATESCO</div>
                                    <div style={{ fontSize: '9.5px', letterSpacing: '0.08em', textTransform: 'uppercase', marginTop: '1px' }}>Aluminium &amp; Glass Merchants</div>
                                </div>

                                <Rule dashed={false} />

                                <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                                    <span>Order No. {receiptMeta.number}</span>
                                    <span>{receiptMeta.date}</span>
                                </div>

                                <Rule />

                                <div style={{ textAlign: 'center' }}>
                                    <div style={{ fontSize: '12px', fontWeight: 700, textTransform: 'uppercase' }}>{meta.label} Worksheet</div>
                                    <div style={{ fontSize: '9.5px', color: '#000', fontWeight: 700, marginTop: '1px' }}>Sheet {sheetIdx + 1} of {visibleBuckets.length}</div>
                                </div>

                                <Rule />

                                <div>Prepared for:</div>
                                <div style={{ fontWeight: 700 }}>
                                    {customer?.name || 'Walk-in Customer'}
                                    {mode === 'edit' && <span style={{ fontWeight: 400, fontSize: '9.5px' }}> (updated order)</span>}
                                </div>

                                <Rule />

                                {grouped[bucket].map((item, idx) => (
                                    <ReceiptItemRow key={idx} item={item} index={idx} glass={bucket === 'glass' ? glassRows[idx] : undefined} />
                                ))}

                                <Rule dashed={false} style={{ marginTop: '14px' }} />

                                <div style={{ marginTop: '10px' }}>
                                    <div style={{ borderBottom: '1px solid #000', height: '16px' }} />
                                    <div style={{ fontSize: '9px', color: '#000', fontWeight: 700, margin: '2px 0 8px' }}>CUT BY &middot; DATE</div>
                                    <div style={{ borderBottom: '1px solid #000', height: '16px' }} />
                                    <div style={{ fontSize: '9px', color: '#000', fontWeight: 700, marginTop: '2px' }}>CHECKED BY &middot; DATE</div>
                                </div>

                                <div style={{ fontSize: '9px', color: '#000', fontWeight: 700, textAlign: 'center', marginTop: '8px' }}>
                                    Internal worksheet — not a customer invoice
                                </div>
                            </div>
                        </div>
                    );
                })}
            </div>

            {/* The glass worksheet as A4 pages: what the A4 printer gets, and what "Print A4 sheet" prints */}
            {hasGlassSheet && (
                <section ref={a4SectionRef} className="a4-section" style={{ maxWidth: '820px', margin: '2.5rem auto 0' }}>
                    <div className="print-hidden" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '1rem', flexWrap: 'wrap', marginBottom: '1rem' }}>
                        <div style={{ minWidth: 0, flex: '1 1 320px' }}>
                            <h2 style={{ fontSize: '1rem', fontWeight: 800, color: '#f1f5f9', margin: 0 }}>Glass cutting sheet &middot; A4</h2>
                            <p style={{ fontSize: '0.8rem', color: '#94a3b8', margin: '0.25rem 0 0', lineHeight: 1.5 }}>{a4RouteText}</p>
                        </div>
                        <button onClick={() => setShowA4(!a4Open)} style={secondaryButton}>{a4Open ? 'Hide preview' : 'Show preview'}</button>
                    </div>
                    <div className="a4-pages" style={{ display: a4Open ? 'block' : 'none' }}>
                        <GlassCuttingSheet
                            plan={glassPlan}
                            pages={glassPages}
                            orderNo={receiptMeta.number}
                            date={receiptMeta.date}
                            customerName={customer?.name || 'Walk-in Customer'}
                            isUpdate={mode === 'edit'}
                            pageRef={setPageRef}
                            scale={a4Scale}
                        />
                    </div>
                </section>
            )}

            {showPrinterSetup && (
                <PrinterSetupModal
                    current={printers}
                    a4MinPanels={a4MinPanels ?? GLASS_A4_DEFAULT}
                    onClose={() => setShowPrinterSetup(false)}
                    onSaved={(saved) => { setPrinters(saved); setShowPrinterSetup(false); }}
                />
            )}
        </div>
    );
}
