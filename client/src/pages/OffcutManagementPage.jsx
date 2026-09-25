import { useState, useEffect, useCallback, useMemo } from 'react';
import api from '../services/api';
import { useProducts } from '../context/ProductContext';
import { useToast } from '../context/ToastContext';
import { wsEvents } from '../utils/wsEvents';
import { getCategoryAccent, hexToRgba } from '../utils/colors';
import { subCategoriesFor, matchesSubCategory } from '../utils/subCategories';
import ConfirmationModal from '../components/common/ConfirmationModal';

const editInput = {
    background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(6,182,212,0.35)', borderRadius: '6px',
    color: '#e2e8f0', fontSize: '0.8rem', padding: '4px 7px', outline: 'none', fontFamily: 'var(--font-mono)',
    width: '74px', boxSizing: 'border-box',
};

/** Trim trailing zeros so 11.0 reads as 11 but 11.25 keeps its precision. */
const num = (n) => (n == null ? '—' : String(Number(n)));

/** How a piece is measured depends on the product family: 2D (glass) rows carry
 * width x height in mm, 1D (bar/profile) rows a single length in the product's
 * own unit. Both shapes live in the same table, so every display goes through here. */
const describeSize = (row) => (row.has_dimensions
    ? `${num(row.width)} × ${num(row.height)} mm`
    : `${num(row.length)} ${row.unit || ''}`.trim());

function Checkbox({ checked, indeterminate = false, onChange, title }) {
    return (
        <button
            type="button"
            onClick={onChange}
            title={title}
            aria-pressed={checked}
            style={{
                width: '18px', height: '18px', flexShrink: 0, borderRadius: '5px', cursor: 'pointer', padding: 0,
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                background: checked || indeterminate ? 'linear-gradient(135deg, #06b6d4, #3b82f6)' : 'rgba(255,255,255,0.05)',
                border: `1px solid ${checked || indeterminate ? 'rgba(6,182,212,0.6)' : 'rgba(255,255,255,0.18)'}`,
                color: '#fff', fontSize: '0.7rem', fontWeight: 900, lineHeight: 1,
            }}
        >
            {checked ? '✓' : indeterminate ? '–' : ''}
        </button>
    );
}

/** One offcut row — read-only until the CEO opens it for editing, at which point
 * the size cell becomes the input(s) that product's measurement shape calls for. */
function OffcutRow({ row, selected, onToggleSelect, isEditing, onStartEdit, onCancelEdit, onSave }) {
    const [draft, setDraft] = useState({});
    const [saving, setSaving] = useState(false);

    useEffect(() => {
        if (isEditing) {
            setDraft(row.has_dimensions
                ? { width: String(row.width ?? ''), height: String(row.height ?? ''), quantity: String(row.quantity) }
                : { length: String(row.length ?? ''), quantity: String(row.quantity) });
        }
    }, [isEditing, row]);

    const draftValid = row.has_dimensions
        ? parseFloat(draft.width) > 0 && parseFloat(draft.height) > 0 && parseInt(draft.quantity) > 0
        : parseFloat(draft.length) > 0 && parseInt(draft.quantity) > 0;

    const handleSave = async () => {
        if (!draftValid || saving) return;
        setSaving(true);
        try {
            // Send only what actually moved — the endpoint patches field by field,
            // so an untouched dimension is left exactly as the cutting job recorded it.
            const changes = {};
            if (row.has_dimensions) {
                if (parseFloat(draft.width) !== row.width) changes.width = parseFloat(draft.width);
                if (parseFloat(draft.height) !== row.height) changes.height = parseFloat(draft.height);
            } else if (parseFloat(draft.length) !== row.length) {
                changes.length = parseFloat(draft.length);
            }
            if (parseInt(draft.quantity) !== row.quantity) changes.quantity = parseInt(draft.quantity);
            await onSave(row.offcutId, changes);
        } finally {
            setSaving(false);
        }
    };

    return (
        <div style={{
            display: 'flex', alignItems: 'center', gap: '0.75rem', flexWrap: 'wrap',
            padding: '0.6rem 0.875rem', borderRadius: '0.625rem',
            background: selected ? 'rgba(6,182,212,0.08)' : 'rgba(255,255,255,0.025)',
            border: `1px solid ${selected ? 'rgba(6,182,212,0.35)' : 'rgba(255,255,255,0.06)'}`,
            transition: 'background 0.15s, border-color 0.15s',
        }}>
            <Checkbox checked={selected} onChange={onToggleSelect} />

            <span style={{
                fontSize: '0.65rem', color: '#475569', fontFamily: 'var(--font-mono)',
                background: 'rgba(255,255,255,0.04)', borderRadius: '4px', padding: '1px 6px', flexShrink: 0,
            }}>#{row.offcutId}</span>

            {/* Size + quantity — the two things this page exists to correct */}
            {isEditing ? (
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', flexWrap: 'wrap', flex: '1 1 260px' }}>
                    {row.has_dimensions ? (
                        <>
                            <input type="number" step="1" min="0" value={draft.width ?? ''} placeholder="width"
                                onChange={e => setDraft(d => ({ ...d, width: e.target.value }))} style={editInput} />
                            <span style={{ color: '#475569' }}>×</span>
                            <input type="number" step="1" min="0" value={draft.height ?? ''} placeholder="height"
                                onChange={e => setDraft(d => ({ ...d, height: e.target.value }))} style={editInput} />
                            <span style={{ color: '#475569', fontSize: '0.72rem' }}>mm</span>
                        </>
                    ) : (
                        <>
                            <input type="number" step="0.01" min="0" value={draft.length ?? ''} placeholder="length"
                                onChange={e => setDraft(d => ({ ...d, length: e.target.value }))} style={editInput} />
                            <span style={{ color: '#475569', fontSize: '0.72rem' }}>{row.unit}</span>
                        </>
                    )}
                    <span style={{ color: '#475569', fontSize: '0.72rem', marginLeft: '0.4rem' }}>qty</span>
                    <input type="number" step="1" min="1" value={draft.quantity ?? ''}
                        onChange={e => setDraft(d => ({ ...d, quantity: e.target.value }))} style={{ ...editInput, width: '58px' }} />
                </div>
            ) : (
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.625rem', flex: '1 1 260px', minWidth: 0 }}>
                    <span style={{ fontSize: '0.85rem', fontWeight: 700, color: '#e2e8f0', fontFamily: 'var(--font-mono)' }}>
                        {describeSize(row)}
                    </span>
                    <span style={{ fontSize: '0.75rem', color: '#64748b' }}>× {row.quantity} pc{row.quantity === 1 ? '' : 's'}</span>
                    {row.status === 'scrap' && (
                        <span style={{
                            fontSize: '0.62rem', fontWeight: 800, color: '#f59e0b', textTransform: 'uppercase', letterSpacing: '0.05em',
                            background: 'rgba(245,158,11,0.12)', border: '1px solid rgba(245,158,11,0.28)',
                            borderRadius: '100px', padding: '1px 7px',
                        }}>scrap</span>
                    )}
                </div>
            )}

            <span style={{ fontSize: '0.68rem', color: '#475569', flexShrink: 0 }}>
                {row.source_item_id ? `from cut #${row.source_item_id}` : 'entered by hand'}
                {row.created_at ? ` · ${new Date(row.created_at).toLocaleDateString()}` : ''}
            </span>

            <div style={{ display: 'flex', gap: '0.4rem', marginLeft: 'auto', flexShrink: 0 }}>
                {isEditing ? (
                    <>
                        <button onClick={onCancelEdit} style={{
                            background: 'none', border: 'none', cursor: 'pointer', color: '#64748b', fontSize: '0.75rem', fontWeight: 700,
                        }}>Cancel</button>
                        <button onClick={handleSave} disabled={!draftValid || saving} style={{
                            border: 'none', borderRadius: '0.5rem', padding: '0.35rem 0.75rem',
                            cursor: draftValid && !saving ? 'pointer' : 'not-allowed',
                            background: draftValid && !saving ? 'linear-gradient(135deg, #06b6d4, #3b82f6)' : 'rgba(255,255,255,0.06)',
                            color: draftValid && !saving ? '#fff' : '#334155', fontSize: '0.75rem', fontWeight: 800,
                        }}>{saving ? 'Saving…' : 'Save'}</button>
                    </>
                ) : (
                    <button onClick={onStartEdit} style={{
                        background: 'none', border: 'none', cursor: 'pointer', color: '#60a5fa', fontSize: '0.75rem', fontWeight: 700,
                    }}>Edit</button>
                )}
            </div>
        </div>
    );
}

/** One product's whole offcut pool, split into its variants — the same card
 * identity (accent tile, name, item code) Manage Products gives the product,
 * so the CEO recognises the row they came here for. */
function ProductOffcutCard({ product, variantGroups, pieces, collapsed, onToggleCollapsed, selectedIds, onToggleProduct, onToggleVariant, onToggleOne, editingId, setEditingId, onSave }) {
    const accent = getCategoryAccent(product.category);
    const initial = product.name?.trim()?.[0]?.toUpperCase() || '?';
    const allRows = variantGroups.flatMap(g => g.items);
    const selectedCount = allRows.filter(r => selectedIds.has(r.offcutId)).length;

    return (
        <div style={{
            background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.07)',
            borderRadius: '1rem', overflow: 'hidden', marginBottom: '0.875rem',
        }}>
            {/* Product header */}
            <div style={{
                display: 'flex', alignItems: 'center', gap: '0.875rem', flexWrap: 'wrap',
                padding: '0.875rem 1.25rem', background: 'rgba(0,0,0,0.2)',
                borderBottom: collapsed ? 'none' : '1px solid rgba(255,255,255,0.06)',
            }}>
                {allRows.length > 0 && (
                    <Checkbox
                        checked={selectedCount === allRows.length}
                        indeterminate={selectedCount > 0 && selectedCount < allRows.length}
                        onChange={() => onToggleProduct(allRows)}
                        title="Select every offcut of this product"
                    />
                )}
                <button onClick={onToggleCollapsed} style={{
                    display: 'flex', alignItems: 'center', gap: '0.875rem', flex: 1, minWidth: 0,
                    background: 'none', border: 'none', cursor: 'pointer', padding: 0, textAlign: 'left',
                }}>
                    <div className="product-tile" style={{
                        width: '40px', height: '40px', borderRadius: '10px', flexShrink: 0,
                        background: hexToRgba(accent, 0.1), border: `1px solid ${hexToRgba(accent, 0.25)}`,
                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                    }}>
                        <span style={{ position: 'relative', zIndex: 1, fontSize: '1rem', fontWeight: 800, color: accent }}>{initial}</span>
                    </div>
                    <div style={{ minWidth: 0 }}>
                        <div style={{ fontSize: '0.875rem', fontWeight: 700, color: '#e2e8f0' }}>{product.name}</div>
                        {product.itemCode && (
                            <div style={{ fontSize: '0.68rem', color: '#475569', fontFamily: 'var(--font-mono)', marginTop: '2px' }}>{product.itemCode}</div>
                        )}
                    </div>
                </button>
                <span style={{
                    fontSize: '0.72rem', fontWeight: 700, borderRadius: '100px', padding: '3px 10px', flexShrink: 0,
                    background: pieces > 0 ? 'rgba(6,182,212,0.12)' : 'rgba(255,255,255,0.06)',
                    border: `1px solid ${pieces > 0 ? 'rgba(6,182,212,0.25)' : 'rgba(255,255,255,0.08)'}`,
                    color: pieces > 0 ? '#22d3ee' : '#475569',
                }}>{pieces} piece{pieces === 1 ? '' : 's'}</span>
                <button onClick={onToggleCollapsed} style={{
                    background: 'none', border: 'none', cursor: 'pointer', color: '#475569', fontSize: '0.75rem', flexShrink: 0,
                }}>{collapsed ? '▸' : '▾'}</button>
            </div>

            {!collapsed && (
                <div style={{ padding: '0.875rem 1.25rem' }}>
                    {allRows.length === 0 ? (
                        <p style={{ fontSize: '0.78rem', color: '#334155', fontStyle: 'italic', margin: 0, textAlign: 'center', padding: '0.5rem 0' }}>
                            No offcuts recorded for this product
                        </p>
                    ) : variantGroups.map(group => {
                        const selectedInGroup = group.items.filter(i => selectedIds.has(i.offcutId)).length;
                        return (
                            <div key={group.key} style={{ marginBottom: '0.875rem' }}>
                                <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.5rem' }}>
                                    <Checkbox
                                        checked={selectedInGroup === group.items.length}
                                        indeterminate={selectedInGroup > 0 && selectedInGroup < group.items.length}
                                        onChange={() => onToggleVariant(group.items)}
                                        title="Select this variant's offcuts"
                                    />
                                    <span style={{
                                        fontSize: '0.68rem', fontWeight: 700, color: '#22d3ee',
                                        background: 'rgba(6,182,212,0.1)', border: '1px solid rgba(6,182,212,0.22)',
                                        borderRadius: '100px', padding: '1px 8px',
                                    }}>{group.variant_label || 'No variant'}</span>
                                    <div style={{ flex: 1, height: '1px', background: 'rgba(255,255,255,0.06)' }} />
                                    <span style={{ fontSize: '0.66rem', color: '#475569', fontWeight: 600 }}>
                                        {group.items.length} size{group.items.length === 1 ? '' : 's'}
                                    </span>
                                </div>
                                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.375rem' }}>
                                    {group.items.map(row => (
                                        <OffcutRow
                                            key={row.offcutId}
                                            row={row}
                                            selected={selectedIds.has(row.offcutId)}
                                            onToggleSelect={() => onToggleOne(row.offcutId)}
                                            isEditing={editingId === row.offcutId}
                                            onStartEdit={() => setEditingId(row.offcutId)}
                                            onCancelEdit={() => setEditingId(null)}
                                            onSave={onSave}
                                        />
                                    ))}
                                </div>
                            </div>
                        );
                    })}
                </div>
            )}
        </div>
    );
}

/**
 * CEO-only oversight of the entire offcut pool. Managers add offcuts from Stock
 * Control and cutting jobs create them automatically; this is the one place the
 * numbers can be corrected or a piece written off entirely when the pool drifts
 * from what's physically in the yard.
 *
 * Organized by category then sub-category, exactly as Manage Products is — a CEO
 * goes looking for "the Euro Profile window jams", not for an offcut id, and
 * only products that track offcuts have anything to show here.
 */
export default function OffcutManagementPage() {
    const showToast = useToast();
    const { products, categories } = useProducts();

    const [rows, setRows] = useState([]);
    const [loading, setLoading] = useState(true);
    const [selectedCategory, setSelectedCategory] = useState(() => (categories?.length > 0 ? categories[0].id : 'ke-profile'));
    const [selectedUsage, setSelectedUsage] = useState('window');
    const [showScrap, setShowScrap] = useState(true);
    const [selectedIds, setSelectedIds] = useState(() => new Set());
    const [editingId, setEditingId] = useState(null);
    const [collapsed, setCollapsed] = useState(() => new Set());
    const [confirmOpen, setConfirmOpen] = useState(false);
    const [deleting, setDeleting] = useState(false);

    const usages = useMemo(
        () => subCategoriesFor(selectedCategory, categories),
        [selectedCategory, categories],
    );

    // Same guard Manage Products needs — 'window' only exists for a Profile
    // category, so switching to Glass would otherwise leave the selection
    // pointing at a pill that isn't even shown, hiding every product. Derived
    // rather than corrected in an effect, so there's no render where the page
    // is filtering on a sub-category the current category doesn't have.
    const activeUsage = useMemo(() => (
        usages.some(u => u.id === selectedUsage) ? selectedUsage : (usages[0]?.id ?? 'general')
    ), [usages, selectedUsage]);

    const load = useCallback(async () => {
        setLoading(true);
        try {
            const data = await api.productService.getAllOffcuts();
            setRows(data);
            // Drop anything that no longer exists rather than leaving a stale id
            // in the selection, which would fail the whole next batch delete.
            const live = new Set(data.map(r => r.offcutId));
            setSelectedIds(prev => new Set([...prev].filter(id => live.has(id))));
        } catch {
            /* toast handled globally by the api interceptor */
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => { load(); }, [load]);
    useEffect(() => wsEvents.on('products_updated', () => { load(); }), [load]);

    // Offcuts keyed by product, so each product card can pick up its own without
    // rescanning the whole pool once per card.
    const offcutsByProduct = useMemo(() => {
        const map = new Map();
        for (const row of rows) {
            if (!showScrap && row.status === 'scrap') continue;
            if (!map.has(row.product_id)) map.set(row.product_id, []);
            map.get(row.product_id).push(row);
        }
        return map;
    }, [rows, showScrap]);

    // The catalogue drives the listing, filtered the same way Manage Products
    // filters it — plus track_offcuts, since a counted product has no pool.
    const visibleProducts = useMemo(() => products.filter(p =>
        p.trackOffcuts && p.category === selectedCategory && matchesSubCategory(p, activeUsage)
    ), [products, selectedCategory, activeUsage]);

    const cards = useMemo(() => visibleProducts.map(product => {
        const productRows = offcutsByProduct.get(product.id) || [];
        const byVariant = new Map();
        for (const row of productRows) {
            const key = row.variant_id ?? 'none';
            if (!byVariant.has(key)) byVariant.set(key, { key, variant_label: row.variant_label, items: [] });
            byVariant.get(key).items.push(row);
        }
        return {
            product,
            variantGroups: [...byVariant.values()],
            pieces: productRows.reduce((sum, r) => sum + r.quantity, 0),
        };
    }), [visibleProducts, offcutsByProduct]);

    const visibleRows = useMemo(() => cards.flatMap(c => c.variantGroups.flatMap(g => g.items)), [cards]);

    const stats = useMemo(() => ({
        pieces: visibleRows.reduce((sum, r) => sum + r.quantity, 0),
        products: cards.filter(c => c.pieces > 0).length,
        scrap: visibleRows.filter(r => r.status === 'scrap').reduce((sum, r) => sum + r.quantity, 0),
    }), [visibleRows, cards]);

    const toggleOne = (id) => setSelectedIds(prev => {
        const next = new Set(prev);
        next.has(id) ? next.delete(id) : next.add(id);
        return next;
    });

    const toggleMany = (items) => setSelectedIds(prev => {
        const next = new Set(prev);
        const allSelected = items.every(i => next.has(i.offcutId));
        items.forEach(i => (allSelected ? next.delete(i.offcutId) : next.add(i.offcutId)));
        return next;
    });

    // Changing what's on screen drops the selection. Deletion is permanent, so a
    // row must never be able to sit selected-but-hidden behind a filter and get
    // swept up in a batch the CEO can't see — and "Select all N" would otherwise
    // mean something different from what the count says.
    const changeFilter = (apply) => {
        setSelectedIds(new Set());
        setEditingId(null);
        apply();
    };

    const toggleCollapsed = (productId) => setCollapsed(prev => {
        const next = new Set(prev);
        next.has(productId) ? next.delete(productId) : next.add(productId);
        return next;
    });

    const handleSave = async (offcutId, changes) => {
        if (Object.keys(changes).length === 0) {
            setEditingId(null);
            return;
        }
        try {
            const updated = await api.productService.updateOffcut(offcutId, changes);
            setRows(prev => prev.map(r => (r.offcutId === offcutId ? updated : r)));
            setEditingId(null);
            showToast('Offcut updated.', 'success');
        } catch {
            /* toast handled globally by the api interceptor */
        }
    };

    const handleBulkDelete = async () => {
        setDeleting(true);
        try {
            const ids = [...selectedIds];
            await api.productService.bulkDeleteOffcuts(ids);
            setRows(prev => prev.filter(r => !selectedIds.has(r.offcutId)));
            setSelectedIds(new Set());
            setConfirmOpen(false);
            showToast(`${ids.length} offcut${ids.length === 1 ? '' : 's'} deleted.`, 'success');
        } catch {
            // A stale id rejects the whole batch server-side, so reload to show
            // the CEO what's actually still there before they try again.
            setConfirmOpen(false);
            load();
        } finally {
            setDeleting(false);
        }
    };

    const selectedPieces = useMemo(
        () => rows.filter(r => selectedIds.has(r.offcutId)).reduce((sum, r) => sum + r.quantity, 0),
        [rows, selectedIds],
    );

    const statCards = [
        { label: 'Pieces Here', value: stats.pieces, icon: '✂️', color: '#06b6d4' },
        { label: 'Products With Offcuts', value: stats.products, icon: '📦', color: '#3b82f6' },
        { label: 'Scrap Pieces', value: stats.scrap, icon: '⚠️', color: '#f59e0b' },
        { label: 'Selected', value: selectedIds.size, icon: '🗑️', color: selectedIds.size ? '#ef4444' : '#475569' },
    ];

    return (
        <div style={{ display: 'flex', flexDirection: 'column', height: '100%', background: 'var(--color-bg)' }}>
            {/* Header — same shape as Product Management's */}
            <div style={{
                padding: 'clamp(1rem, 4vw, 1.5rem) clamp(1rem, 5vw, 2rem) 1rem',
                background: 'rgba(9,14,26,0.8)', backdropFilter: 'blur(20px)',
                borderBottom: '1px solid rgba(255,255,255,0.06)',
                position: 'sticky', top: 0, zIndex: 20,
            }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', marginBottom: '0.25rem' }}>
                    <div style={{ width: '8px', height: '8px', borderRadius: '50%', background: '#06b6d4', boxShadow: '0 0 8px rgba(6,182,212,0.8)' }} />
                    <h1 style={{ fontSize: '1.375rem', fontWeight: 800, color: '#f1f5f9', margin: 0, letterSpacing: '-0.025em' }}>Offcut Management</h1>
                </div>
                <p style={{ fontSize: '0.78rem', color: '#475569', margin: 0, marginLeft: '1.25rem', fontWeight: 500 }}>
                    Every leftover piece in the system — correct a measurement or write off what's no longer there
                </p>
            </div>

            <div style={{ flex: 1, overflowY: 'auto', padding: 'clamp(1rem, 4vw, 1.5rem) clamp(1rem, 5vw, 2rem)' }} className="custom-scrollbar">

                {/* Stats */}
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(180px, 100%), 1fr))', gap: '1rem', marginBottom: '1.5rem' }}>
                    {statCards.map(s => (
                        <div key={s.label} style={{
                            background: 'linear-gradient(135deg, rgba(255,255,255,0.05), rgba(255,255,255,0.02))',
                            border: '1px solid rgba(255,255,255,0.08)', borderRadius: '1rem',
                            padding: '1.25rem', display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                        }}>
                            <div>
                                <p style={{ fontSize: '0.65rem', fontWeight: 700, color: '#475569', letterSpacing: '0.08em', textTransform: 'uppercase', margin: '0 0 4px' }}>{s.label}</p>
                                <h3 style={{ fontSize: '2rem', fontWeight: 900, color: '#f1f5f9', margin: 0, fontFamily: 'var(--font-mono)', letterSpacing: '-0.02em' }}>{s.value}</h3>
                            </div>
                            <div style={{ width: '44px', height: '44px', borderRadius: '10px', background: `${s.color}15`, border: `1px solid ${s.color}25`, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '1.25rem' }}>{s.icon}</div>
                        </div>
                    ))}
                </div>

                {/* Category / sub-category filters — same control as Manage Products */}
                <div style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.07)', borderRadius: '1rem', padding: '1rem', marginBottom: '1rem' }}>
                    <div style={{ display: 'flex', gap: '4px', marginBottom: '0.75rem', paddingBottom: '0.75rem', borderBottom: '1px solid rgba(255,255,255,0.06)', overflowX: 'auto' }} className="scrollbar-hide">
                        {categories.map(cat => (
                            <button key={cat.id} onClick={() => changeFilter(() => setSelectedCategory(cat.id))} style={{
                                padding: '0.5rem 1.25rem', borderRadius: '0.625rem', border: 'none', cursor: 'pointer', whiteSpace: 'nowrap',
                                background: selectedCategory === cat.id ? 'linear-gradient(135deg, #3b82f6, #06b6d4)' : 'rgba(255,255,255,0.05)',
                                color: selectedCategory === cat.id ? '#fff' : '#64748b',
                                fontWeight: 700, fontSize: '0.8rem', transition: 'all 0.2s',
                            }}>{cat.label}</button>
                        ))}
                    </div>
                    <div style={{ display: 'flex', gap: '0.375rem', flexWrap: 'wrap', alignItems: 'center' }}>
                        {usages.map(u => (
                            <button key={u.id} onClick={() => changeFilter(() => setSelectedUsage(u.id))} style={{
                                padding: '0.3rem 1rem', borderRadius: '100px', fontSize: '0.72rem', fontWeight: 700, cursor: 'pointer',
                                border: `1px solid ${activeUsage === u.id ? 'rgba(59,130,246,0.4)' : 'rgba(255,255,255,0.08)'}`,
                                background: activeUsage === u.id ? 'rgba(59,130,246,0.12)' : 'transparent',
                                color: activeUsage === u.id ? '#60a5fa' : '#64748b',
                                transition: 'all 0.15s', textTransform: 'uppercase', letterSpacing: '0.06em',
                            }}>{u.label}</button>
                        ))}
                        <button onClick={() => changeFilter(() => setShowScrap(s => !s))} style={{
                            marginLeft: 'auto', background: 'none', border: 'none', cursor: 'pointer',
                            color: showScrap ? '#94a3b8' : '#f59e0b', fontSize: '0.75rem', fontWeight: 700,
                        }}>{showScrap ? 'Hide scrap' : 'Show scrap'}</button>
                        {visibleRows.length > 0 && (
                            <button onClick={() => toggleMany(visibleRows)} style={{
                                background: 'none', border: 'none', cursor: 'pointer', color: '#60a5fa', fontSize: '0.75rem', fontWeight: 700,
                            }}>
                                {visibleRows.every(r => selectedIds.has(r.offcutId)) ? 'Deselect these' : `Select all ${visibleRows.length}`}
                            </button>
                        )}
                    </div>
                </div>

                {/* Product cards */}
                {loading && rows.length === 0 ? (
                    <p style={{ fontSize: '0.85rem', color: '#334155', textAlign: 'center', padding: '3rem', fontStyle: 'italic' }}>Loading offcuts…</p>
                ) : cards.length === 0 ? (
                    <div style={{
                        background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.07)', borderRadius: '1rem',
                        padding: '3rem', textAlign: 'center', color: '#334155', fontSize: '0.875rem',
                    }}>No offcut-tracking products in this category</div>
                ) : cards.map(card => (
                    <ProductOffcutCard
                        key={card.product.id}
                        product={card.product}
                        variantGroups={card.variantGroups}
                        pieces={card.pieces}
                        collapsed={collapsed.has(card.product.id)}
                        onToggleCollapsed={() => toggleCollapsed(card.product.id)}
                        selectedIds={selectedIds}
                        onToggleProduct={toggleMany}
                        onToggleVariant={toggleMany}
                        onToggleOne={toggleOne}
                        editingId={editingId}
                        setEditingId={setEditingId}
                        onSave={handleSave}
                    />
                ))}
            </div>

            {/* Batch action bar — only present once something is selected */}
            {selectedIds.size > 0 && (
                <div style={{
                    flexShrink: 0, padding: '0.875rem clamp(1rem, 5vw, 2rem)',
                    borderTop: '1px solid rgba(239,68,68,0.2)',
                    background: 'rgba(9,14,26,0.97)', backdropFilter: 'blur(20px)',
                    display: 'flex', alignItems: 'center', gap: '0.875rem', flexWrap: 'wrap',
                }}>
                    <span style={{ fontSize: '0.82rem', fontWeight: 700, color: '#e2e8f0' }}>
                        {selectedIds.size} offcut{selectedIds.size === 1 ? '' : 's'} selected
                        <span style={{ color: '#64748b', fontWeight: 500 }}> · {selectedPieces} piece{selectedPieces === 1 ? '' : 's'}</span>
                    </span>
                    <button onClick={() => setSelectedIds(new Set())} style={{
                        background: 'none', border: 'none', cursor: 'pointer', color: '#64748b', fontSize: '0.78rem', fontWeight: 700,
                    }}>Clear selection</button>
                    <button onClick={() => setConfirmOpen(true)} style={{
                        marginLeft: 'auto', padding: '0.625rem 1.25rem', borderRadius: '0.75rem', border: 'none',
                        background: 'linear-gradient(135deg, #ef4444, #dc2626)', color: '#fff',
                        fontSize: '0.82rem', fontWeight: 800, cursor: 'pointer',
                        boxShadow: '0 4px 16px rgba(239,68,68,0.25)',
                    }}>Delete selected</button>
                </div>
            )}

            <ConfirmationModal
                isOpen={confirmOpen}
                onClose={() => !deleting && setConfirmOpen(false)}
                onConfirm={handleBulkDelete}
                title="Delete these offcuts?"
                message={`${selectedIds.size} offcut row${selectedIds.size === 1 ? '' : 's'} (${selectedPieces} physical piece${selectedPieces === 1 ? '' : 's'}) will be removed from the pool permanently. Cutting jobs will no longer be able to draw from them. This cannot be undone.`}
                confirmText={deleting ? 'Deleting…' : 'Delete permanently'}
            />
        </div>
    );
}
