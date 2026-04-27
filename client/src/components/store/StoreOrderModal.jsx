import { useMemo, useState } from 'react';
import { useOrders } from '../../context/OrderContext';
import OffcutReassignModal from './OffcutReassignModal';

export default function StoreOrderModal({ order, onClose, onRefresh }) {
    const { updateOrderStatus } = useOrders();
    const [reassignTarget, setReassignTarget] = useState(null);

    const orderId = order.order?.orderId ?? order.id ?? order.orderId;
    const customerName = order.order?.customerName ?? order.customer?.name ?? 'Walk-in';
    const createdAt = order.order?.created_at;

    const storeItems = useMemo(() => {
        if (order.store_items) return order.store_items;
        return (order.items ?? [])
            .filter(i => {
                const cat = i.category || i.details?.category || '';
                return cat === 'profile' || cat === 'glass';
            })
            .map(i => ({
                ...i,
                item_id: i.item_id ?? i.id,
                product_name: i.product_name ?? i.name,
                category: i.category || i.details?.category || 'profile',
                available_offcuts: [],
                has_cuts: false,
                track_offcuts: false,
            }));
    }, [order]);

    const handleConfirm = async () => {
        if (window.confirm('Mark this order as Ready for Pickup?')) {
            await updateOrderStatus(orderId, 'ready');
            onClose();
        }
    };

    const timeStr = createdAt
        ? new Date(createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
        : '';

    return (
        <>
        <div style={{
            position: 'fixed', inset: 0, zIndex: 100,
            display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '1rem',
        }}>
            <div style={{
                position: 'absolute', inset: 0,
                background: 'rgba(9,14,26,0.88)', backdropFilter: 'blur(14px)',
            }} onClick={onClose} />

            <div style={{
                position: 'relative', width: '100%', maxWidth: '820px', maxHeight: '92vh',
                background: 'rgba(11,17,32,0.98)',
                border: '1px solid rgba(255,255,255,0.1)',
                borderRadius: '1.5rem', overflow: 'hidden',
                boxShadow: '0 32px 80px rgba(0,0,0,0.7)',
                display: 'flex', flexDirection: 'column',
            }}>
                {/* Header */}
                <div style={{
                    padding: '1.25rem 1.75rem',
                    borderBottom: '1px solid rgba(255,255,255,0.07)',
                    background: 'linear-gradient(135deg, rgba(168,85,247,0.1), transparent)',
                    display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                    flexShrink: 0,
                }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
                        <div style={{
                            fontFamily: 'var(--font-mono)', fontSize: '1.75rem', fontWeight: 900,
                            color: '#f1f5f9', letterSpacing: '-0.03em',
                            lineHeight: 1,
                        }}>
                            <span style={{ color: 'rgba(192,132,252,0.6)', fontSize: '1.1rem' }}>#</span>
                            {orderId}
                        </div>
                        <div style={{ borderLeft: '1px solid rgba(255,255,255,0.1)', paddingLeft: '1rem' }}>
                            <div style={{ fontSize: '0.92rem', fontWeight: 700, color: '#e2e8f0' }}>
                                {customerName}
                            </div>
                            <div style={{ fontSize: '0.72rem', color: '#475569', marginTop: '1px' }}>
                                {timeStr && `${timeStr} · `}
                                <span style={{ color: '#c084fc', fontWeight: 700 }}>{storeItems.length}</span> item{storeItems.length !== 1 ? 's' : ''}
                            </div>
                        </div>
                    </div>
                    <button onClick={onClose} style={{
                        width: '32px', height: '32px', borderRadius: '8px',
                        border: '1px solid rgba(255,255,255,0.1)', background: 'rgba(255,255,255,0.05)',
                        color: '#64748b', cursor: 'pointer', display: 'flex',
                        alignItems: 'center', justifyContent: 'center', flexShrink: 0,
                    }}
                    onMouseEnter={e => { e.currentTarget.style.background = 'rgba(239,68,68,0.15)'; e.currentTarget.style.color = '#f87171'; }}
                    onMouseLeave={e => { e.currentTarget.style.background = 'rgba(255,255,255,0.05)'; e.currentTarget.style.color = '#64748b'; }}
                    >✕</button>
                </div>

                {/* Items */}
                <div style={{ flex: 1, overflowY: 'auto', padding: '1.25rem 1.75rem', display: 'flex', flexDirection: 'column', gap: '0.875rem' }} className="custom-scrollbar">
                    {storeItems.length === 0 ? (
                        <div style={{ textAlign: 'center', padding: '3rem 0' }}>
                            <div style={{ fontSize: '2.5rem', marginBottom: '0.75rem' }}>✅</div>
                            <p style={{ color: '#475569', fontSize: '0.875rem' }}>No store items — accessories only.</p>
                        </div>
                    ) : storeItems.map((item, idx) => (
                        <ItemCard
                            key={item.item_id ?? idx}
                            item={item}
                            onReassign={(cutLineIndex) => setReassignTarget({ item, cutLineIndex })}
                        />
                    ))}
                </div>

                {/* Footer */}
                <div style={{
                    padding: '1rem 1.75rem', borderTop: '1px solid rgba(255,255,255,0.07)',
                    display: 'flex', justifyContent: 'flex-end',
                    background: 'rgba(0,0,0,0.25)', flexShrink: 0,
                }}>
                    <button onClick={handleConfirm} style={{
                        padding: '0.75rem 2rem', borderRadius: '0.875rem', border: 'none', cursor: 'pointer',
                        background: 'linear-gradient(135deg, #a855f7, #7c3aed)',
                        color: '#fff', fontWeight: 800, fontSize: '0.9rem',
                        boxShadow: '0 4px 20px rgba(168,85,247,0.4)', transition: 'all 0.2s',
                    }}
                    onMouseEnter={e => { e.currentTarget.style.transform = 'translateY(-1px)'; e.currentTarget.style.boxShadow = '0 6px 24px rgba(168,85,247,0.5)'; }}
                    onMouseLeave={e => { e.currentTarget.style.transform = 'translateY(0)'; e.currentTarget.style.boxShadow = '0 4px 20px rgba(168,85,247,0.4)'; }}
                    >✓ Mark Ready for Pickup</button>
                </div>
            </div>
        </div>

        {reassignTarget && (
            <OffcutReassignModal
                orderId={orderId}
                item={reassignTarget.item}
                cutLineIndex={reassignTarget.cutLineIndex}
                onClose={() => setReassignTarget(null)}
                onSuccess={() => { onRefresh?.(); setReassignTarget(null); }}
            />
        )}
        </>
    );
}

function ItemCard({ item, onReassign }) {
    const isProfile = item.category === 'profile';
    const lineItems = item.details?.lineItems ?? [];
    const d = item.details ?? {};

    const accentColor = isProfile ? '#c084fc' : '#22d3ee';
    const accentBg = isProfile ? 'rgba(168,85,247,0.1)' : 'rgba(6,182,212,0.1)';
    const accentBorder = isProfile ? 'rgba(168,85,247,0.2)' : 'rgba(6,182,212,0.2)';

    return (
        <div style={{
            borderRadius: '1rem', overflow: 'hidden',
            border: `1px solid ${accentBorder}`,
            background: accentBg,
        }}>
            {/* Item header */}
            <div style={{
                padding: '0.875rem 1.125rem',
                borderBottom: lineItems.length > 0 ? `1px solid ${accentBorder}` : 'none',
                display: 'flex', gap: '0.875rem', alignItems: 'flex-start',
            }}>
                {/* Icon */}
                <div style={{
                    width: '44px', height: '44px', flexShrink: 0, borderRadius: '10px',
                    background: isProfile ? 'rgba(168,85,247,0.15)' : 'rgba(6,182,212,0.15)',
                    border: `1px solid ${accentBorder}`,
                    display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '1.35rem',
                }}>
                    {isProfile ? '🏗️' : '💎'}
                </div>

                <div style={{ flex: 1, minWidth: 0 }}>
                    {/* Name + category */}
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', flexWrap: 'wrap', marginBottom: '0.3rem' }}>
                        <span style={{ fontSize: '0.95rem', fontWeight: 800, color: '#f1f5f9' }}>
                            {item.product_name}
                        </span>
                        {item.variant_name && (
                            <span style={{ fontSize: '0.8rem', color: '#64748b', fontWeight: 500 }}>
                                · {item.variant_name}
                            </span>
                        )}
                        <span style={{
                            fontSize: '0.6rem', fontWeight: 800, textTransform: 'uppercase', letterSpacing: '0.1em',
                            color: accentColor, background: `${accentBg}`, border: `1px solid ${accentBorder}`,
                            borderRadius: '100px', padding: '1px 7px',
                        }}>{item.category}</span>
                    </div>

                    {/* Spec chips in a row */}
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.5rem 1.25rem' }}>
                        {d.color && <SpecChip label="Color" value={d.color} color="#e2e8f0" />}
                        {d.length && <SpecChip label="Bar" value={`${d.length} ft`} color={accentColor} />}
                        {d.width && d.height && <SpecChip label="Size" value={`${d.width} × ${d.height} ft`} color={accentColor} />}
                        {d.thickness && <SpecChip label="Thickness" value={d.thickness} color="#22d3ee" />}
                        {d.quantity && <SpecChip label="Qty" value={`×${d.quantity}`} color="#f1f5f9" />}
                    </div>
                </div>
            </div>

            {/* Preparation lines */}
            {lineItems.length > 0 && (
                <div style={{ padding: '0.25rem 0' }}>
                    <div style={{ padding: '0.5rem 1.125rem 0.25rem', fontSize: '0.65rem', fontWeight: 800, textTransform: 'uppercase', letterSpacing: '0.1em', color: '#334155' }}>
                        Preparation
                    </div>
                    {lineItems.map((li, i) => {
                        // 'profile-cut', 'cut', 'cut-custom' → cut; 'profile-half', 'half' → half
                        const isCut = !!li.type?.includes('cut') && !li.type?.includes('full');
                        const isHalf = !isCut && !!li.type?.includes('half');
                        const cutLen = li.meta?.length ?? null;
                        const sources = li.offcut_sources ?? [];

                        return (
                            <div key={i} style={{
                                padding: '0.625rem 1.125rem',
                                borderTop: '1px solid rgba(255,255,255,0.04)',
                                background: isCut ? 'rgba(168,85,247,0.04)' : 'transparent',
                            }}>
                                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '0.75rem', flexWrap: 'wrap' }}>
                                    {/* Left: line description */}
                                    <div style={{ flex: 1 }}>
                                        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                                            <span style={{ fontSize: '0.85rem' }}>
                                                {isCut ? '✂' : isHalf ? '⬛' : '▬'}
                                            </span>
                                            <span style={{ fontSize: '0.82rem', fontWeight: 700, color: isCut ? '#c084fc' : '#94a3b8', fontFamily: 'var(--font-mono)' }}>
                                                {li.qty}×{' '}
                                                {isCut
                                                    ? (cutLen ? `${cutLen} ft custom cut` : 'custom cut')
                                                    : isHalf
                                                    ? 'half bar'
                                                    : (li.label ?? 'full bar')}
                                            </span>
                                        </div>

                                        {/* Offcut sources for cut lines */}
                                        {isCut && (
                                            <div style={{ marginTop: '0.35rem', marginLeft: '1.625rem' }}>
                                                {sources.length > 0 ? (
                                                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.3rem' }}>
                                                        {sources.map((s, si) => (
                                                            <span key={si} style={{
                                                                fontSize: '0.65rem', padding: '2px 8px', borderRadius: '100px',
                                                                background: s.source === 'offcut' ? 'rgba(167,139,250,0.12)' : 'rgba(251,146,60,0.12)',
                                                                border: `1px solid ${s.source === 'offcut' ? 'rgba(167,139,250,0.3)' : 'rgba(251,146,60,0.3)'}`,
                                                                color: s.source === 'offcut' ? '#a78bfa' : '#fb923c',
                                                                fontFamily: 'var(--font-mono)',
                                                            }}>
                                                                {s.source === 'offcut'
                                                                    ? `Offcut #${s.offcut_id} (${s.offcut_length} ft)`
                                                                    : `Full bar (${s.offcut_length} ft)`}
                                                                {s.remainder_created > 0 && ` → ${s.remainder_created} ft left`}
                                                            </span>
                                                        ))}
                                                    </div>
                                                ) : (
                                                    <span style={{ fontSize: '0.65rem', color: '#334155', fontStyle: 'italic' }}>
                                                        Source not recorded
                                                    </span>
                                                )}
                                            </div>
                                        )}
                                    </div>

                                    {/* Reassign button — shown whenever product tracks offcuts and this is a cut */}
                                    {isCut && item.track_offcuts && (
                                        <button
                                            onClick={() => onReassign(i)}
                                            style={{
                                                padding: '5px 14px', borderRadius: '8px', flexShrink: 0,
                                                border: '1px solid rgba(168,85,247,0.4)',
                                                background: 'rgba(168,85,247,0.1)', color: '#c084fc',
                                                fontSize: '0.72rem', fontWeight: 700, cursor: 'pointer',
                                                transition: 'all 0.15s', whiteSpace: 'nowrap',
                                            }}
                                            onMouseEnter={e => { e.currentTarget.style.background = 'rgba(168,85,247,0.22)'; e.currentTarget.style.borderColor = 'rgba(168,85,247,0.6)'; }}
                                            onMouseLeave={e => { e.currentTarget.style.background = 'rgba(168,85,247,0.1)'; e.currentTarget.style.borderColor = 'rgba(168,85,247,0.4)'; }}
                                        >
                                            ↕ Reassign
                                        </button>
                                    )}
                                </div>
                            </div>
                        );
                    })}
                </div>
            )}
        </div>
    );
}

function SpecChip({ label, value, color }) {
    return (
        <div style={{ fontSize: '0.73rem', color: '#475569' }}>
            {label}:{' '}
            <span style={{ color, fontWeight: 700 }}>{value}</span>
        </div>
    );
}
