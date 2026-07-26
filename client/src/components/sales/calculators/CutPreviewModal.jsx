import { useEffect, useState } from 'react';
import api from '../../../services/api';

/**
 * Dry-run preview of how the 2D glass offcut engine would cut the current cart's
 * cut pieces — same scoring/batching the real sale uses, but nothing is deducted.
 * Renders one to-scale diagram per physical sheet/offcut actually touched (the
 * backend consolidates any offcut this same preview created and then immediately
 * reused into the sheet it came from, so a cashier sees "here's the one sheet
 * and everything cut from it," not a chain of synthetic intermediate offcuts)
 * so a cashier/manager can check the optimization before committing to the order.
 *
 * Props:
 *   productId, variantId  – identify which product/variant to preview against
 *   cutPieces             – the calculator's current cutPieces state: [{l, w, q, u, label}]
 *   onClose                – close callback
 */
export default function CutPreviewModal({ productId, variantId, cutPieces, onClose }) {
    const [groups, setGroups] = useState(null); // one merged group per physical sheet/offcut touched
    const [optimization, setOptimization] = useState(null); // multi-strategy search summary
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState('');

    useEffect(() => {
        let cancelled = false;
        setLoading(true);
        setError('');
        const cuts = cutPieces.map(c => ({ l: c.l, w: c.w, qty: c.q, u: c.u }));
        api.productService.previewGlassCuts(productId, variantId, cuts)
            .then(response => {
                if (cancelled) return;
                setGroups(response.groups);
                setOptimization(response.optimization);
            })
            .catch(err => {
                if (cancelled) return;
                const detail = err?.response?.data?.detail;
                setError(detail || 'Could not compute a preview — this combination of cuts may not fit any offcut or the full sheet.');
            })
            .finally(() => { if (!cancelled) setLoading(false); });
        return () => { cancelled = true; };
    }, [productId, variantId, cutPieces]);

    return (
        <div style={{ position: 'fixed', inset: 0, zIndex: 300, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '1rem' }}>
            <div style={{ position: 'absolute', inset: 0, background: 'rgba(9,14,26,0.9)', backdropFilter: 'blur(16px)' }} onClick={onClose} />

            <div style={{
                position: 'relative', width: '100%', maxWidth: '720px', maxHeight: '90vh',
                background: 'linear-gradient(145deg, rgba(13,20,38,0.99), rgba(9,14,26,0.99))',
                border: '1px solid rgba(59,130,246,0.2)',
                borderRadius: '1.5rem', overflow: 'hidden',
                boxShadow: '0 32px 80px rgba(0,0,0,0.7)',
                display: 'flex', flexDirection: 'column',
                animation: 'fadeInScale 0.2s ease',
            }}>
                <div style={{
                    padding: '1.25rem 1.5rem', borderBottom: '1px solid rgba(255,255,255,0.07)',
                    background: 'linear-gradient(135deg, rgba(59,130,246,0.1), transparent)',
                    flexShrink: 0, display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start',
                }}>
                    <div>
                        <h3 style={{ fontSize: '1rem', fontWeight: 800, color: '#f1f5f9', margin: '0 0 3px' }}>Cut Preview</h3>
                        <p style={{ fontSize: '0.75rem', color: '#64748b', margin: 0 }}>
                            Dry run of the optimizer &mdash; nothing is deducted until the order is placed
                        </p>
                    </div>
                    <button onClick={onClose} style={{
                        width: '30px', height: '30px', borderRadius: '8px', border: '1px solid rgba(255,255,255,0.1)',
                        background: 'rgba(255,255,255,0.05)', color: '#64748b', cursor: 'pointer',
                        display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
                    }}>✕</button>
                </div>

                <div style={{ flex: 1, overflowY: 'auto', padding: '1.25rem 1.5rem' }} className="custom-scrollbar">
                    {loading && <p style={{ fontSize: '0.8rem', color: '#475569' }}>Computing preview&hellip;</p>}

                    {!loading && error && (
                        <div style={{
                            padding: '0.75rem 1rem', borderRadius: '0.875rem',
                            background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.25)',
                            color: '#f87171', fontSize: '0.8rem',
                        }}>
                            {error}
                        </div>
                    )}

                    {!loading && !error && groups && groups.length === 0 && (
                        <p style={{ fontSize: '0.8rem', color: '#334155', fontStyle: 'italic' }}>No cut pieces to preview yet.</p>
                    )}

                    {!loading && !error && groups && groups.length > 0 && (
                        <>
                            <OptimizationSummary optimization={optimization} />
                            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.75rem' }}>
                                {groups.map((g, gi) => (
                                    <CutDiagram key={gi} eventIndex={gi} result={g} />
                                ))}
                            </div>
                        </>
                    )}
                </div>

                <div style={{
                    padding: '1rem 1.5rem', borderTop: '1px solid rgba(255,255,255,0.07)',
                    display: 'flex', justifyContent: 'flex-end', gap: '0.75rem',
                    background: 'rgba(0,0,0,0.3)', flexShrink: 0,
                }}>
                    <button onClick={onClose} style={{
                        padding: '0.625rem 1.25rem', borderRadius: '0.75rem',
                        border: '1px solid rgba(255,255,255,0.1)', background: 'rgba(255,255,255,0.05)',
                        color: '#e2e8f0', fontSize: '0.82rem', cursor: 'pointer', fontWeight: 600,
                    }}>
                        Close
                    </button>
                </div>
            </div>
        </div>
    );
}

const COLORS = {
    cut: { fill: 'rgba(59,130,246,0.35)', stroke: '#3b82f6' },
    available: { fill: 'rgba(34,197,94,0.25)', stroke: '#22c55e' },
    popular: { fill: 'rgba(251,191,36,0.28)', stroke: '#fbbf24' }, // remainder matches a historically popular size — likely to sell
    scrap: { fill: 'rgba(248,113,113,0.2)', stroke: '#f87171' },
    source: { fill: 'rgba(255,255,255,0.03)', stroke: 'rgba(255,255,255,0.25)' },
};

const fmtMm = (n) => `${Math.round(n)}mm`;

// Matches the STRATEGIES names in server/core/inventory/glassOffcutService.py
const STRATEGY_LABELS = {
    area_desc_larger_remainder: 'Largest piece first, consolidated leftover',
    area_desc_smaller_remainder: 'Largest piece first, compact leftover',
    longest_side_desc: 'Longest side first',
    shortest_side_desc: 'Shortest side first',
    perimeter_desc: 'Largest perimeter first',
};

// Shows the multi-strategy search itself, not just its result — the optimizer
// tries several packing heuristics and keeps whichever produces the fewest
// sheets, then least true scrap, then the MOST sellable leftover (★ score —
// remainders matching sizes that have actually sold before), then least
// fragmentation. This makes that comparison visible instead of silently
// applying one hidden answer, and shows why a strategy won even when two tie
// on sheet count: it's the one that left behind offcuts likely to resell.
function OptimizationSummary({ optimization }) {
    if (!optimization || !optimization.trials || optimization.trials.length === 0) return null;
    return (
        <div style={{
            background: 'rgba(34,211,238,0.06)', border: '1px solid rgba(34,211,238,0.2)',
            borderRadius: '0.875rem', padding: '0.75rem 1rem', marginBottom: '1rem',
        }}>
            <div style={{ fontSize: '0.72rem', fontWeight: 700, color: '#22d3ee', marginBottom: '0.5rem' }}>
                Optimizer compared {optimization.strategies_tried} packing strategies
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '3px' }}>
                {optimization.trials.map((t, i) => (
                    <div key={i} style={{
                        display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '0.75rem',
                        fontSize: '0.68rem', color: t.won ? '#e2e8f0' : '#64748b', fontWeight: t.won ? 700 : 400,
                    }}>
                        <span>{t.won ? '✓ ' : ''}{STRATEGY_LABELS[t.name] || t.name}</span>
                        <span style={{ fontFamily: 'var(--font-mono)', whiteSpace: 'nowrap' }}>
                            {t.sheets_consumed} sheet{t.sheets_consumed === 1 ? '' : 's'}
                            {t.total_remainder_pieces > 0 ? `, ${t.total_remainder_pieces} leftover piece${t.total_remainder_pieces === 1 ? '' : 's'}` : ''}
                            {t.total_sellability_score > 0 && <span style={{ color: '#fbbf24' }}> ★{t.total_sellability_score.toFixed(0)}</span>}
                        </span>
                    </div>
                ))}
            </div>
        </div>
    );
}

// Groups pieces within one sheet/offcut by identical (width, height, rotated) —
// packing can mix orientations and different requested sizes onto the same
// source (e.g. 3 pieces one way + 1 rotated into the leftover space, or entirely
// different cut sizes sharing one sheet), so the legend can't assume uniform dims.
const groupCuts = (cuts) => {
    const groups = [];
    (cuts || []).forEach(c => {
        const existing = groups.find(g => g.width === c.width && g.height === c.height && g.rotated === c.rotated);
        if (existing) existing.count += 1;
        else groups.push({ width: c.width, height: c.height, rotated: c.rotated, count: 1 });
    });
    return groups;
};

// One "result" = one physical sheet/offcut actually touched, with every piece
// cut from it pooled together (the backend already merged any chain of synthetic
// same-preview offcuts back into the sheet they came from — see
// products/service.py's _consolidate_preview_events). Shape: {source, offcut_id,
// offcut_width, offcut_height, cuts: [{x, y, width, height, rotated}, ...], remainders_created: [...]}
function CutDiagram({ result, eventIndex }) {
    const srcW = result.offcut_width;
    const srcH = result.offcut_height;
    const cuts = result.cuts || [];
    const anyRotated = cuts.some(c => c.rotated);
    const maxPx = 220;
    const scale = maxPx / Math.max(srcW, srcH);
    const displayW = Math.max(40, srcW * scale);
    const displayH = Math.max(40, srcH * scale);
    const strokeW = Math.max(srcW, srcH) * 0.006;

    return (
        <div style={{
            background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.08)',
            borderRadius: '0.875rem', padding: '0.75rem', width: `${Math.max(displayW, 180)}px`,
        }}>
            <div style={{ fontSize: '0.68rem', color: '#94a3b8', marginBottom: '0.5rem', fontWeight: 700 }}>
                {result.source === 'offcut' ? `Offcut #${result.offcut_id}` : `Sheet ${eventIndex + 1}`}
                {cuts.length > 1 && <span style={{ color: '#22d3ee' }}> &middot; {cuts.length} pieces</span>}
                {anyRotated && <span style={{ color: '#fbbf24' }}> &middot; rotated</span>}
            </div>

            <svg
                width={displayW} height={displayH}
                viewBox={`0 0 ${srcW} ${srcH}`}
                style={{ display: 'block', margin: '0 auto' }}
            >
                <rect x={0} y={0} width={srcW} height={srcH} fill={COLORS.source.fill} stroke={COLORS.source.stroke} strokeWidth={strokeW} />
                {(result.remainders_created || []).map((r, i) => {
                    const c = r.status === 'scrap' ? COLORS.scrap : (r.is_popular ? COLORS.popular : COLORS.available);
                    return (
                        <rect key={i} x={r.x} y={r.y} width={r.width} height={r.height}
                            fill={c.fill} stroke={c.stroke} strokeWidth={Math.max(srcW, srcH) * (r.is_popular ? 0.007 : 0.004)} />
                    );
                })}
                {cuts.map((c, i) => (
                    <rect key={i} x={c.x} y={c.y} width={c.width} height={c.height}
                        fill={COLORS.cut.fill} stroke={COLORS.cut.stroke} strokeWidth={strokeW} />
                ))}
            </svg>

            <div style={{ marginTop: '0.5rem', fontSize: '0.68rem', lineHeight: 1.6 }}>
                {groupCuts(cuts).map((g, i) => (
                    <LegendRow
                        key={i}
                        color={COLORS.cut.stroke}
                        label={`Cut ${g.count > 1 ? `${g.count} x ` : ''}${fmtMm(g.width)} × ${fmtMm(g.height)}${g.rotated ? ' (rotated)' : ''}`}
                    />
                ))}
                <div style={{ color: '#475569', marginBottom: '2px' }}>
                    from {fmtMm(srcW)} &times; {fmtMm(srcH)} {result.source === 'offcut' ? 'offcut' : 'sheet'}
                </div>
                {(result.remainders_created || []).map((r, i) => (
                    <LegendRow
                        key={i}
                        color={r.status === 'scrap' ? COLORS.scrap.stroke : (r.is_popular ? COLORS.popular.stroke : COLORS.available.stroke)}
                        label={`${r.status === 'scrap' ? 'Scrap' : 'Saved'} ${fmtMm(r.width)} × ${fmtMm(r.height)}${r.is_popular ? ' ★ popular size' : ''}`}
                    />
                ))}
            </div>
        </div>
    );
}

const LegendRow = ({ color, label }) => (
    <div style={{ display: 'flex', alignItems: 'center', gap: '0.375rem', color: '#94a3b8' }}>
        <span style={{ width: '9px', height: '9px', borderRadius: '2px', background: color, flexShrink: 0 }} />
        <span>{label}</span>
    </div>
);
