import { useEffect, useMemo, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import api from '../services/api';
import { BUCKET_ORDER, BUCKET_META, bucketOf } from '../utils/receiptCategories';

// 80mm thermal POS roll — ~72mm printable width. Pure black-on-white, monospace,
// single column: no side-by-side layout or colour tints survive a 1-bit thermal head.
const MONO = 'ui-monospace, "Cascadia Mono", "Segoe UI Mono", Consolas, "Courier New", monospace';
const TAPE_WIDTH = '302px'; // 80mm @ 96dpi, for the on-screen preview

const fmtLen = (n) => {
    const num = parseFloat(n);
    if (isNaN(num)) return '0ft';
    return `${(Math.round(num * 100) / 100).toString()}ft`;
};

// Describes exactly what a floor worker should cut and where the material comes from —
// only present on lines the backend actually deducted via the offcut/best-fit algorithm.
const CuttingInstructions = ({ sources }) => {
    if (!sources || sources.length === 0) return null;
    return (
        <div style={{ border: '1px dashed #000', padding: '5px 7px', margin: '5px 0 2px' }}>
            <div style={{ fontSize: '9px', fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase', marginBottom: '2px' }}>
                Cutting Instruction
            </div>
            {sources.map((src, idx) => (
                <div key={idx} style={{ fontSize: '10.5px', lineHeight: 1.4 }}>
                    {src.source === 'offcut'
                        ? <div>Cut <strong>{fmtLen(src.length_used)}</strong> from <strong>Offcut #{src.offcut_id}</strong> ({fmtLen(src.offcut_length)} available)</div>
                        : <div>Cut <strong>{fmtLen(src.length_used)}</strong> from a <strong>new bar</strong></div>
                    }
                    {src.remainder_created > 0 && (
                        <div style={{ fontSize: '9.5px', color: '#333', marginTop: '2px' }}>
                            &gt;&gt; {fmtLen(src.remainder_created)} remainder saved to stock
                        </div>
                    )}
                </div>
            ))}
        </div>
    );
};

const LeaderRow = ({ left, right }) => (
    <div style={{ display: 'flex', alignItems: 'baseline', gap: '4px', marginTop: '4px' }}>
        <span>{left}</span>
        <span style={{ flex: 1, borderBottom: '1px dotted #777', marginBottom: '3px' }} />
        <span style={{ fontSize: '10.5px', whiteSpace: 'nowrap' }}>{right}</span>
    </div>
);

const ReceiptItemRow = ({ item, index }) => (
    <div>
        <div style={{ fontWeight: 700, marginTop: '6px' }}>
            {String(index + 1).padStart(2, '0')} &middot; {item.name}
        </div>

        {item.details?.attributes && item.details.attributes.length > 0 && (
            <div style={{ fontSize: '10px', color: '#333', margin: '1px 0 4px' }}>
                {item.details.attributes.map((attr, idx) => (
                    <span key={idx}>
                        {idx > 0 && <span style={{ margin: '0 4px' }}>&middot;</span>}
                        {attr.label}: {attr.value}
                    </span>
                ))}
            </div>
        )}

        {(item.details?.lineItems || []).map((li, idx) => (
            <div key={idx}>
                <LeaderRow
                    left={`${li.label}${li.meta?.l ? ` (${li.meta.l}x${li.meta.w}${li.meta.u || ''})` : ''}`}
                    right={`qty ${li.qty}`}
                />
                <CuttingInstructions sources={li.offcut_sources} />
            </div>
        ))}
    </div>
);

const Rule = ({ dashed = true, style }) => (
    <div style={{ borderTop: dashed ? '1px dashed #000' : '1px solid #000', margin: '8px 0', ...style }} />
);

export default function ReceiptPage() {
    const location = useLocation();
    const navigate = useNavigate();

    const { orderId, cartItems, customer, categories, mode } = location.state || {};

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

    const receiptMeta = useMemo(() => ({
        number: orderId,
        date: new Date().toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }),
    }), [orderId]);

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
    const isLoading = Boolean(orderId) && !orderDetail && !loadError;
    const handlePrint = () => window.print();

    if (!orderId || !cartItems) {
        return (
            <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', flexDirection: 'column', gap: '1rem', background: 'var(--color-bg)' }}>
                <p style={{ color: '#64748b', fontSize: '0.875rem' }}>No receipt data found.</p>
                <button onClick={() => navigate('/orders')} style={{ color: '#fbbf24', fontWeight: 700, background: 'none', border: 'none', cursor: 'pointer', fontSize: '0.875rem' }}>← Return to Orders</button>
            </div>
        );
    }

    return (
        <div style={{ minHeight: '100vh', background: 'var(--color-bg)', padding: '2.5rem 1rem' }} className="print:bg-white print:p-0">
            <style type="text/css" media="print">{`
                @page { size: 80mm auto; margin: 3mm; }
                body { background-color: white !important; }
                .print-hidden { display: none !important; }
                .receipt-tape { box-shadow: none !important; width: 100% !important; }
                .receipt-section { page-break-after: always; break-after: page; }
                .receipt-section:last-of-type { page-break-after: auto; break-after: auto; }
            `}</style>

            {/* Action Bar */}
            <div className="print-hidden" style={{ maxWidth: '480px', margin: '0 auto 1.5rem', display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '1rem' }}>
                <button onClick={() => navigate('/orders')} style={{
                    display: 'flex', alignItems: 'center', gap: '0.5rem', background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.09)',
                    borderRadius: '0.75rem', padding: '0.5rem 1rem', color: '#94a3b8', cursor: 'pointer', fontWeight: 600, fontSize: '0.82rem', transition: 'all 0.15s',
                }}
                onMouseEnter={e => { e.currentTarget.style.color = '#f1f5f9'; e.currentTarget.style.borderColor = 'rgba(255,255,255,0.2)'; }}
                onMouseLeave={e => { e.currentTarget.style.color = '#94a3b8'; e.currentTarget.style.borderColor = 'rgba(255,255,255,0.09)'; }}>
                    ← Back to Orders
                </button>
                <div style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
                    {loadError && <span style={{ color: '#f87171', fontSize: '0.78rem', fontWeight: 600 }}>{loadError}</span>}
                    {isLoading && <span style={{ color: '#64748b', fontSize: '0.82rem' }}>Preparing receipt…</span>}
                    <button onClick={handlePrint} disabled={isLoading} style={{
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

            {visibleBuckets.length === 0 && (
                <div className="print-hidden" style={{ maxWidth: '480px', margin: '0 auto', textAlign: 'center', color: '#64748b', fontSize: '0.875rem' }}>
                    No departments were selected for this receipt.
                </div>
            )}

            {/* Strip(s) — one per checked/populated department, each its own torn-off slip */}
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '2rem', justifyContent: 'center', alignItems: 'flex-start' }}>
                {visibleBuckets.map((bucket, sheetIdx) => {
                    const meta = BUCKET_META[bucket];
                    return (
                        <div key={bucket} className="receipt-section">
                            <div
                                className="receipt-tape print:shadow-none"
                                style={{
                                    width: TAPE_WIDTH, background: '#ffffff', color: '#000000',
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
                                    <div style={{ fontSize: '9.5px', color: '#333', marginTop: '1px' }}>Sheet {sheetIdx + 1} of {visibleBuckets.length}</div>
                                </div>

                                <Rule />

                                <div>Prepared for:</div>
                                <div style={{ fontWeight: 700 }}>
                                    {customer?.name || 'Walk-in Customer'}
                                    {mode === 'edit' && <span style={{ fontWeight: 400, fontSize: '9.5px' }}> (updated order)</span>}
                                </div>

                                <Rule />

                                {grouped[bucket].map((item, idx) => (
                                    <ReceiptItemRow key={idx} item={item} index={idx} />
                                ))}

                                <Rule dashed={false} style={{ marginTop: '14px' }} />

                                <div style={{ marginTop: '10px' }}>
                                    <div style={{ borderBottom: '1px solid #000', height: '16px' }} />
                                    <div style={{ fontSize: '9px', color: '#333', margin: '2px 0 8px' }}>CUT BY &middot; DATE</div>
                                    <div style={{ borderBottom: '1px solid #000', height: '16px' }} />
                                    <div style={{ fontSize: '9px', color: '#333', marginTop: '2px' }}>CHECKED BY &middot; DATE</div>
                                </div>

                                <div style={{ fontSize: '9px', color: '#333', textAlign: 'center', marginTop: '8px' }}>
                                    Internal worksheet — not a customer invoice
                                </div>
                            </div>
                        </div>
                    );
                })}
            </div>
        </div>
    );
}
