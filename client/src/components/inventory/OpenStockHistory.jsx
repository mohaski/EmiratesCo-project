import { useState, useEffect, useCallback } from 'react';
import api from '../../services/api';

/**
 * CEO view of how opened packs are actually being used.
 *
 * Three figures are shown side by side and deliberately never merged, because
 * each is known with different confidence (see
 * server/core/inventory/openContainers/utilization.py):
 *
 *   Labelled  what the pack claims to hold. A supplier's figure.
 *   Sold      what was billed out of it. Exact -- every sub-pack sale records
 *             itself against the pack it came from.
 *   Measured  what it physically yielded, if a manager measured it at close.
 *
 * "Sold" minus "Measured" is the number worth watching: material that left a
 * pack without any sale recording it. The old counted model absorbed that into
 * a drifting piece count where it was invisible.
 */

const label = {
    fontSize: '0.6rem', fontWeight: 700, color: '#475569',
    letterSpacing: '0.07em', textTransform: 'uppercase',
};
const card = {
    background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)',
    borderRadius: '0.75rem', padding: '0.875rem', marginBottom: '0.625rem',
};

const num = (v, unit = '') => (v == null ? '—' : `${Number(v).toLocaleString(undefined, { maximumFractionDigits: 2 })}${unit}`);
const money = (v) => (v == null ? '—' : `KSH ${Number(v).toLocaleString(undefined, { maximumFractionDigits: 0 })}`);

const duration = (hours) => {
    if (hours == null) return '—';
    if (hours < 1) return `${Math.round(hours * 60)}m`;
    if (hours < 48) return `${hours.toFixed(1)}h`;
    return `${(hours / 24).toFixed(1)} days`;
};

/** Green when a pack beat its label, amber when it fell short. Neither is an
 *  error -- the point is that the label was never reliable. */
const varianceColor = (v) => (v == null ? '#475569' : v < 0 ? '#fbbf24' : '#4ade80');

function Stat({ title, value, sub, color }) {
    return (
        <div style={{ flex: '1 1 110px', minWidth: 0 }}>
            <div style={label}>{title}</div>
            <div style={{
                fontSize: '0.95rem', fontWeight: 800, marginTop: '2px',
                fontFamily: 'var(--font-mono)', color: color || '#f1f5f9',
            }}>{value}</div>
            {sub && <div style={{ fontSize: '0.62rem', color: '#475569', marginTop: '1px' }}>{sub}</div>}
        </div>
    );
}

function PackRow({ pack, expanded, onToggle }) {
    const [usage, setUsage] = useState(null);
    const [loadingUsage, setLoadingUsage] = useState(false);

    useEffect(() => {
        if (!expanded || usage) return;
        setLoadingUsage(true);
        api.openContainerService.usage(pack.id)
            .then(setUsage)
            .catch(() => { /* toasted by the interceptor */ })
            .finally(() => setLoadingUsage(false));
    }, [expanded, usage, pack.id]);

    const variantName = pack.variant_name || Object.values(pack.attributes || {}).join(' - ') || 'Standard';
    const isOpen = pack.status === 'open';

    return (
        <div style={card}>
            <div onClick={onToggle} style={{ cursor: 'pointer' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', gap: '0.75rem', flexWrap: 'wrap' }}>
                    <div style={{ minWidth: 0 }}>
                        <p style={{ fontSize: '0.85rem', fontWeight: 700, color: '#f1f5f9', margin: 0 }}>
                            {pack.product_name}
                            <span style={{
                                marginLeft: '0.5rem', fontSize: '0.6rem', fontWeight: 700, padding: '2px 7px',
                                borderRadius: '100px', verticalAlign: 'middle',
                                background: isOpen ? 'rgba(74,222,128,0.14)' : 'rgba(148,163,184,0.12)',
                                color: isOpen ? '#4ade80' : '#94a3b8',
                            }}>{isOpen ? 'OPEN' : 'FINISHED'}</span>
                        </p>
                        <p style={{ fontSize: '0.7rem', color: '#64748b', margin: '2px 0 0' }}>{variantName}</p>
                    </div>
                    <div style={{ fontSize: '0.62rem', color: '#475569', textAlign: 'right' }}>
                        <div>Opened {pack.opened_at ? new Date(pack.opened_at).toLocaleDateString() : '—'}{pack.opened_by_name ? ` · ${pack.opened_by_name}` : ''}</div>
                        {pack.closed_at && <div>Closed {new Date(pack.closed_at).toLocaleDateString()}{pack.closed_by_name ? ` · ${pack.closed_by_name}` : ''}</div>}
                    </div>
                </div>

                <div style={{
                    display: 'flex', gap: '0.75rem', flexWrap: 'wrap', marginTop: '0.75rem',
                    paddingTop: '0.75rem', borderTop: '1px solid rgba(255,255,255,0.06)',
                }}>
                    <Stat title="Labelled" value={num(pack.nominal_quantity, pack.unit || '')} />
                    <Stat title="Sold" value={num(pack.units_sold, pack.unit || '')} color="#60a5fa" />
                    <Stat title="Measured" value={num(pack.actual_quantity, pack.unit || '')}
                        sub={pack.actual_quantity == null ? 'not measured' : null} />
                    <Stat title="vs Label" value={num(pack.variance_vs_label, pack.unit || '')}
                        color={varianceColor(pack.variance_vs_label)} />
                    <Stat title="Unbilled" value={num(pack.unaccounted_units, pack.unit || '')}
                        color={pack.unaccounted_units > 0 ? '#f87171' : '#475569'}
                        sub={pack.unaccounted_units == null ? 'needs a measurement' : null} />
                    <Stat title={isOpen ? 'Open for' : 'Lasted'} value={duration(pack.duration_hours)} />
                </div>

                {pack.notes && (
                    <p style={{ fontSize: '0.65rem', color: '#64748b', margin: '0.5rem 0 0', fontStyle: 'italic' }}>{pack.notes}</p>
                )}
                <p style={{ fontSize: '0.62rem', color: '#3b82f6', margin: '0.5rem 0 0', fontWeight: 700 }}>
                    {expanded ? '▾ Hide sales' : '▸ Show the sales that came out of this pack'}
                </p>
            </div>

            {expanded && (
                <div style={{ marginTop: '0.75rem', paddingTop: '0.75rem', borderTop: '1px solid rgba(255,255,255,0.06)' }}>
                    {loadingUsage ? (
                        <p style={{ fontSize: '0.72rem', color: '#475569', margin: 0 }}>Loading sales…</p>
                    ) : !usage || usage.lines.length === 0 ? (
                        <p style={{ fontSize: '0.72rem', color: '#475569', margin: 0 }}>
                            No sales recorded against this pack yet.
                        </p>
                    ) : (
                        <>
                            <div className="table-scroll">
                                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.7rem' }}>
                                    <thead>
                                        <tr style={{ color: '#475569', textAlign: 'left' }}>
                                            <th style={{ padding: '0.3rem 0.4rem', fontWeight: 700 }}>Order</th>
                                            <th style={{ padding: '0.3rem 0.4rem', fontWeight: 700 }}>Customer</th>
                                            <th style={{ padding: '0.3rem 0.4rem', fontWeight: 700 }}>Date</th>
                                            <th style={{ padding: '0.3rem 0.4rem', fontWeight: 700 }}>By</th>
                                            <th style={{ padding: '0.3rem 0.4rem', fontWeight: 700, textAlign: 'right' }}>Units</th>
                                            <th style={{ padding: '0.3rem 0.4rem', fontWeight: 700, textAlign: 'right' }}>Value</th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {usage.lines.map(l => (
                                            <tr key={l.item_id} style={{
                                                borderTop: '1px solid rgba(255,255,255,0.05)',
                                                color: l.item_status === 'returned' ? '#64748b' : '#cbd5e1',
                                                textDecoration: l.item_status === 'returned' ? 'line-through' : 'none',
                                            }}>
                                                <td style={{ padding: '0.35rem 0.4rem', fontFamily: 'var(--font-mono)' }}>#{l.order_id}</td>
                                                <td style={{ padding: '0.35rem 0.4rem' }}>{l.customer_name || '—'}</td>
                                                <td style={{ padding: '0.35rem 0.4rem' }}>{l.sold_at ? new Date(l.sold_at).toLocaleDateString() : '—'}</td>
                                                <td style={{ padding: '0.35rem 0.4rem' }}>{l.served_by || '—'}</td>
                                                <td style={{ padding: '0.35rem 0.4rem', textAlign: 'right', fontFamily: 'var(--font-mono)' }}>{num(l.units)}</td>
                                                <td style={{ padding: '0.35rem 0.4rem', textAlign: 'right', fontFamily: 'var(--font-mono)' }}>{money(l.revenue)}</td>
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                            </div>
                            <div style={{
                                display: 'flex', justifyContent: 'flex-end', gap: '1.25rem',
                                marginTop: '0.5rem', fontSize: '0.72rem', fontWeight: 700,
                            }}>
                                <span style={{ color: '#94a3b8' }}>
                                    {num(usage.total_units, ` ${pack.unit || ''}`)} sold
                                </span>
                                <span style={{ color: '#4ade80' }}>{money(usage.total_revenue)}</span>
                            </div>
                        </>
                    )}
                </div>
            )}
        </div>
    );
}

function UtilizationRow({ row }) {
    const pct = row.yield_vs_label_pct;
    return (
        <div style={card}>
            <div style={{ display: 'flex', justifyContent: 'space-between', gap: '0.75rem', flexWrap: 'wrap' }}>
                <div style={{ minWidth: 0 }}>
                    <p style={{ fontSize: '0.85rem', fontWeight: 700, color: '#f1f5f9', margin: 0 }}>{row.product_name}</p>
                    <p style={{ fontSize: '0.7rem', color: '#64748b', margin: '2px 0 0' }}>{row.variant_name || 'Standard'}</p>
                </div>
                <div style={{ textAlign: 'right' }}>
                    <p style={{ fontSize: '0.95rem', fontWeight: 800, color: '#4ade80', fontFamily: 'var(--font-mono)', margin: 0 }}>
                        {money(row.total_revenue)}
                    </p>
                    <p style={{ ...label, margin: '2px 0 0' }}>from {row.packs_opened} pack(s)</p>
                </div>
            </div>

            <div style={{
                display: 'flex', gap: '0.75rem', flexWrap: 'wrap', marginTop: '0.75rem',
                paddingTop: '0.75rem', borderTop: '1px solid rgba(255,255,255,0.06)',
            }}>
                <Stat title="Labelled" value={num(row.nominal_quantity, row.unit || '')} />
                <Stat title="Avg yield" value={num(row.avg_yield, row.unit || '')}
                    color={pct == null ? '#f1f5f9' : pct < 95 ? '#fbbf24' : '#4ade80'}
                    sub={pct != null ? `${pct}% of label` : 'no finished packs yet'} />
                <Stat title="Range"
                    value={row.min_yield == null ? '—' : `${num(row.min_yield)}–${num(row.max_yield)}`}
                    sub={row.packs_finished ? `${row.packs_finished} finished` : null} />
                <Stat title="Unbilled" value={num(row.total_unaccounted, row.unit || '')}
                    color={row.total_unaccounted > 0 ? '#f87171' : '#475569'}
                    sub={row.measured_count ? `${row.measured_count} measured` : 'none measured'} />
                <Stat title="On shelf" value={`${row.sealed_remaining} sealed`}
                    sub={row.packs_open_now ? `${row.packs_open_now} open now` : null} />
            </div>

            {row.measured_count === 0 && row.packs_finished > 0 && (
                /* Without a measurement the yield figures only reflect what was
                   billed, so they can't reveal anything lost along the way. */
                <p style={{ fontSize: '0.62rem', color: '#fbbf24', margin: '0.5rem 0 0' }}>
                    No pack of this item has been measured at close — yield here is only what was sold,
                    so any waste or loss is invisible.
                </p>
            )}
        </div>
    );
}

export default function OpenStockHistory() {
    const [view, setView] = useState('summary');
    const [rows, setRows] = useState([]);
    const [packs, setPacks] = useState([]);
    const [loading, setLoading] = useState(true);
    const [expandedId, setExpandedId] = useState(null);

    const load = useCallback(async () => {
        setLoading(true);
        try {
            const [util, finished, open] = await Promise.all([
                api.openContainerService.utilization(),
                api.openContainerService.list('finished'),
                api.openContainerService.list('open'),
            ]);
            setRows(util || []);
            // Open packs first, then finished newest-first -- what's live now is
            // what a CEO scanning this is most likely looking for.
            setPacks([...(open || []), ...(finished || [])]);
        } catch {
            // toasted by the interceptor
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => { load(); }, [load]);

    return (
        <div>
            <div style={{ display: 'flex', gap: '4px', marginBottom: '0.875rem' }}>
                {[['summary', 'By item'], ['packs', `Every pack (${packs.length})`]].map(([key, text]) => (
                    <button key={key} onClick={() => setView(key)} style={{
                        padding: '0.3rem 0.75rem', borderRadius: '100px', fontSize: '0.68rem', fontWeight: 700,
                        cursor: 'pointer', transition: 'all 0.15s',
                        border: `1px solid ${view === key ? 'rgba(59,130,246,0.45)' : 'rgba(255,255,255,0.1)'}`,
                        background: view === key ? 'rgba(59,130,246,0.12)' : 'transparent',
                        color: view === key ? '#60a5fa' : '#64748b',
                    }}>{text}</button>
                ))}
            </div>

            {loading ? (
                <p style={{ color: '#475569', fontSize: '0.8rem', textAlign: 'center', padding: '2rem 0' }}>Loading…</p>
            ) : view === 'summary' ? (
                rows.length === 0 ? (
                    <p style={{ color: '#475569', fontSize: '0.8rem', textAlign: 'center', padding: '2rem 0' }}>
                        Nothing to report yet — history builds up as packs are opened and finished.
                    </p>
                ) : rows.map(r => <UtilizationRow key={r.variant_id} row={r} />)
            ) : (
                packs.length === 0 ? (
                    <p style={{ color: '#475569', fontSize: '0.8rem', textAlign: 'center', padding: '2rem 0' }}>
                        No packs have been opened yet.
                    </p>
                ) : packs.map(p => (
                    <PackRow key={p.id} pack={p} expanded={expandedId === p.id}
                        onToggle={() => setExpandedId(expandedId === p.id ? null : p.id)} />
                ))
            )}
        </div>
    );
}
