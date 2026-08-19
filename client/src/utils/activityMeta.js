// Shared lookup/formatting for rendering edit_history rows (GET /orders/audit/history) —
// used by both the CeoDashboard "Activity" widget and the full ActivityLogPage.
// entity_type values come from server/entities/editHistory.py writers across
// ordering, inventory/products, and stockSessions.
export const ACTIVITY_META = {
    order: { icon: '📝', color: '#3b82f6', label: 'Order edited' },
    order_status: { icon: '🔄', color: '#3b82f6', label: 'Order status changed' },
    order_cancellation: { icon: '🚫', color: '#ef4444', label: 'Order cancelled' },
    restock: { icon: '📦', color: '#22c55e', label: 'Stock restocked' },
    stock_batch: { icon: '📋', color: '#22c55e', label: 'Stock session finalized' },
    stock_batch_correction: { icon: '✏️', color: '#f59e0b', label: 'Stock line corrected' },
    manual_offcut: { icon: '✂️', color: '#06b6d4', label: 'Offcut added' },
    offcut_correction: { icon: '✂️', color: '#f59e0b', label: 'Offcut corrected' },
    profile_offcut_correction: { icon: '✂️', color: '#f59e0b', label: 'Profile offcut corrected' },
};

export const DEFAULT_ACTIVITY_META = { icon: '🔧', color: '#a855f7', label: 'Activity' };

export const activityMeta = (entityType) => ACTIVITY_META[entityType] || DEFAULT_ACTIVITY_META;

/** stock_batch is one generic entity_type covering two very different actions
 * (restocking vs. adding offcuts, or both at once) — a flat "Stock session
 * finalized" badge doesn't tell a CEO which one happened at a glance. This
 * inspects the session's actual lines and picks a badge that matches; every
 * other entity_type just falls back to the static activityMeta lookup. */
export const activityMetaForItem = (item) => {
    if (item.entity_type === 'stock_batch') {
        const lines = item.after_snapshot?.lines || [];
        const hasRestock = lines.some(l => l.type === 'restock');
        const hasOffcut = lines.some(l => l.type === 'offcut');
        if (hasOffcut && !hasRestock) return { icon: '✂️', color: '#06b6d4', label: 'Offcuts added' };
        if (hasRestock && !hasOffcut) return { icon: '📦', color: '#22c55e', label: 'Stock restocked' };
    }
    return activityMeta(item.entity_type);
};

export const timeAgo = (iso) => {
    const mins = Math.floor((Date.now() - new Date(iso).getTime()) / 60000);
    if (mins < 1) return 'just now';
    if (mins < 60) return `${mins}m ago`;
    const hours = Math.floor(mins / 60);
    if (hours < 24) return `${hours}h ago`;
    return `${Math.floor(hours / 24)}d ago`;
};

const money = (n) => `KSH ${Math.abs(Number(n) || 0).toLocaleString(undefined, { maximumFractionDigits: 0 })}`;

/** One line/piece of a finalized stock-batch session (see
 * stockSessions/service.py's lines_summary) — shared between the compact
 * activity-log summary and the full per-line "Details" list. */
export const describeStockBatchLine = (line) => {
    const name = [line.product_name, line.variant_name].filter(Boolean).join(' · ');
    if (line.type === 'offcut') {
        const size = line.width != null ? `${line.width}×${line.height}mm` : `${line.length} length`;
        const qty = line.quantity ?? '?';
        return `${name}: +${qty} offcut${qty === 1 ? '' : 's'} (${size})`;
    }
    return `${name}: +${line.entered_quantity ?? '?'}${line.entered_unit ? ` ${line.entered_unit}` : ''}`;
};

/** A short one-line "what happened" string, covering every entity_type this
 * app writes to edit_history so the log rarely has to fall back to raw JSON. */
export const summarizeActivity = (item) => {
    const before = item.before_snapshot || {};
    const after = item.after_snapshot || {};
    switch (item.entity_type) {
        case 'order':
            return after.financial_note || `Total now ${money(after.total)}`;
        case 'order_status':
            return `${before.status ?? '?'} → ${after.status ?? '?'}`;
        case 'order_cancellation':
            return `Cancelled (was ${before.status ?? 'active'})`;
        case 'restock': {
            const change = after.change;
            const name = [after.product_name, after.variant_name].filter(Boolean).join(' · ');
            if (change == null) return name || null;
            return `${change > 0 ? '+' : ''}${change} → ${after.stock_quantity ?? '?'} in stock${name ? ` · ${name}` : ''}`;
        }
        case 'stock_batch': {
            const lines = after.lines || [];
            if (lines.length === 0) return `${after.item_count ?? '?'} line${after.item_count === 1 ? '' : 's'} finalized`;
            const preview = lines.slice(0, 2).map(describeStockBatchLine).join(', ');
            const rest = lines.length > 2 ? ` +${lines.length - 2} more` : '';
            return `${preview}${rest}`;
        }
        case 'stock_batch_correction':
            return `Line #${after.item_id ?? '?'} → qty ${after.entered_quantity ?? '?'} (stock now ${after.stock_after ?? '?'})`;
        case 'manual_offcut':
            return `${after.count ?? '?'} offcut${after.count === 1 ? '' : 's'} added to ${after.product_name ?? 'product'}`;
        case 'offcut_correction':
        case 'profile_offcut_correction':
            return `Cutting event corrected on item #${after.item_id ?? '?'}, line ${(after.line_idx ?? 0) + 1}`;
        default:
            return null;
    }
};

/** Flattened { key, before, after, changed } rows for the "before → after" detail
 * table — used instead of a raw JSON dump so the expanded view stays readable.
 * Values that are objects/arrays are compactly stringified rather than nested. */
export const diffSnapshot = (before = {}, after = {}) => {
    const compact = (v) => {
        if (v == null) return '—';
        if (typeof v === 'object') return JSON.stringify(v);
        return String(v);
    };
    const keys = Array.from(new Set([...Object.keys(before), ...Object.keys(after)]));
    return keys.map(key => ({
        key,
        before: compact(before[key]),
        after: compact(after[key]),
        changed: compact(before[key]) !== compact(after[key]),
    }));
};

/** Deterministic pastel-ish color for a username, so the same person always
 * gets the same avatar color across the page without a server-assigned one. */
export const colorForName = (name) => {
    const palette = ['#3b82f6', '#22c55e', '#f59e0b', '#a855f7', '#06b6d4', '#ef4444', '#ec4899', '#14b8a6'];
    let hash = 0;
    for (let i = 0; i < (name || '').length; i++) hash = (hash * 31 + name.charCodeAt(i)) >>> 0;
    return palette[hash % palette.length];
};

export const initials = (name) => (name || '?').trim().split(/\s+/).map(p => p[0]).slice(0, 2).join('').toUpperCase();
