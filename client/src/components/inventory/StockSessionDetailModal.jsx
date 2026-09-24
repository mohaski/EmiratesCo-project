import { useState } from 'react';
import { useAuth } from '../../context/AuthContext';
import { useToast } from '../../context/ToastContext';
import api from '../../services/api';

const rowInput = {
    background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: '6px',
    color: '#e2e8f0', fontSize: '0.82rem', padding: '5px 8px', outline: 'none', fontFamily: 'var(--font-mono)',
};

// Read-only detail view of a finalized Stock Control batch, with a CEO-only
// inline correction control per line (see stockSessions/service.py's
// correct_stock_input_session_item). Restock lines reverse the old delta and
// re-apply a new one computed from the same conversion_factor captured at
// entry time. Offcut lines edit the pool row's dimensions/quantity directly,
// or can be deleted outright (delete_stock_input_session_offcut) — both only
// while the offcut is untouched since finalizing.
export default function StockSessionDetailModal({ isOpen, onClose, session, onCorrected }) {
    const { user } = useAuth();
    const showToast = useToast();
    const canEditItem = () => user?.role === 'ceo';

    const [editingItemId, setEditingItemId] = useState(null);
    const [editValue, setEditValue] = useState('');
    const [editOffcut, setEditOffcut] = useState({ length: '', width: '', height: '', quantity: '' });
    const [saving, setSaving] = useState(false);

    if (!isOpen || !session) return null;

    const startEdit = (item) => {
        setEditingItemId(item.id);
        if (item.line_type === 'offcut') {
            setEditOffcut({
                length: item.offcut_length ?? '',
                width: item.offcut_width ?? '',
                height: item.offcut_height ?? '',
                quantity: String(item.offcut_quantity ?? ''),
            });
        } else {
            setEditValue(String(item.entered_quantity));
        }
    };
    const cancelEdit = () => { setEditingItemId(null); setEditValue(''); };

    const saveEdit = async (item) => {
        setSaving(true);
        try {
            if (item.line_type === 'offcut') {
                const is2D = item.offcut_width != null;
                const quantity = parseInt(editOffcut.quantity, 10);
                if (isNaN(quantity) || quantity < 1) { setSaving(false); return; }
                const payload = { quantity };
                if (is2D) {
                    const width = parseFloat(editOffcut.width);
                    const height = parseFloat(editOffcut.height);
                    if (isNaN(width) || width <= 0 || isNaN(height) || height <= 0) { setSaving(false); return; }
                    payload.width = width;
                    payload.height = height;
                } else {
                    const length = parseFloat(editOffcut.length);
                    if (isNaN(length) || length <= 0) { setSaving(false); return; }
                    payload.length = length;
                }
                await api.stockSessionService.correctItem(session.id, item.id, payload);
            } else {
                const qty = parseFloat(editValue);
                if (isNaN(qty) || qty < 0) { setSaving(false); return; }
                await api.stockSessionService.correctItem(session.id, item.id, { entered_quantity: qty });
            }
            showToast('Line corrected', 'success');
            cancelEdit();
            onCorrected?.();
        } catch (err) {
            showToast(err?.response?.data?.detail || 'Failed to correct line.', 'error');
        } finally {
            setSaving(false);
        }
    };

    const deleteOffcut = async (item) => {
        if (!window.confirm('Permanently delete this offcut? This removes it from the pool entirely and cannot be undone.')) return;
        setSaving(true);
        try {
            await api.stockSessionService.deleteOffcutItem(session.id, item.id);
            showToast('Offcut deleted', 'success');
            cancelEdit();
            onCorrected?.();
        } catch (err) {
            showToast(err?.response?.data?.detail || 'Failed to delete offcut.', 'error');
        } finally {
            setSaving(false);
        }
    };

    return (
        <div style={{
            position: 'fixed', inset: 0, zIndex: 50, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '1rem',
            background: 'rgba(9,14,26,0.85)', backdropFilter: 'blur(10px)',
        }} onClick={onClose}>
            <div onClick={e => e.stopPropagation()} style={{
                width: '100%', maxWidth: '640px', maxHeight: 'min(88vh, calc(100dvh - 2rem))',
                background: 'linear-gradient(145deg, rgba(13,20,38,0.99), rgba(9,14,26,0.99))',
                border: '1px solid rgba(255,255,255,0.1)', borderRadius: '1.5rem', overflow: 'hidden',
                boxShadow: '0 32px 80px rgba(0,0,0,0.6), 0 0 0 1px rgba(59,130,246,0.1)',
                display: 'flex', flexDirection: 'column',
                animation: 'fadeInScale 0.2s ease',
            }}>
                {/* Header */}
                <div className="modal-header-pad" style={{
                    padding: '1.5rem 2rem', textAlign: 'center', flexShrink: 0,
                    borderBottom: '1px solid rgba(255,255,255,0.07)',
                    background: 'linear-gradient(135deg, rgba(59,130,246,0.08), rgba(6,182,212,0.04))',
                }}>
                    <div style={{
                        width: '56px', height: '56px', borderRadius: '14px', margin: '0 auto 0.875rem',
                        background: 'linear-gradient(135deg, rgba(59,130,246,0.2), rgba(6,182,212,0.15))',
                        border: '1px solid rgba(59,130,246,0.3)',
                        display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '1.5rem',
                    }}>📋</div>
                    <h3 style={{ fontSize: '1.1rem', fontWeight: 800, color: '#f1f5f9', margin: '0 0 4px' }}>Stock Session #{session.id}</h3>
                    <p style={{ fontSize: '0.78rem', color: '#64748b', margin: 0 }}>
                        {session.created_by} · {new Date(session.created_at).toLocaleString()}
                    </p>
                </div>

                <div style={{ flex: 1, overflowY: 'auto', padding: '1.25rem 2rem' }} className="custom-scrollbar modal-body-pad">
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.625rem' }}>
                        {session.items.map(item => {
                            const isOffcut = item.line_type === 'offcut';
                            const isDeleted = isOffcut && item.offcut_quantity === 0;
                            const isEditing = editingItemId === item.id;
                            return (
                                <div key={item.id} style={{
                                    padding: '0.875rem', borderRadius: '0.875rem',
                                    background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.07)',
                                }}>
                                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '0.75rem', flexWrap: 'wrap' }}>
                                        <div style={{ minWidth: 0, flex: '1 1 150px', overflowWrap: 'anywhere' }}>
                                            <div style={{ fontSize: '0.82rem', fontWeight: 800, color: '#e2e8f0' }}>
                                                {item.product_name}{item.variant_name ? ` · ${item.variant_name}` : ''}
                                            </div>
                                            {isOffcut ? (
                                                <div style={{
                                                    fontSize: '0.68rem', marginTop: '2px', fontFamily: 'var(--font-mono)',
                                                    color: isDeleted ? '#f87171' : '#64748b', textDecoration: isDeleted ? 'line-through' : 'none',
                                                }}>
                                                    {item.offcut_width != null
                                                        ? `${item.offcut_width}×${item.offcut_height}mm`
                                                        : `${item.offcut_length} length`} · qty {item.offcut_quantity}
                                                </div>
                                            ) : (
                                                <div style={{ fontSize: '0.68rem', color: '#64748b', marginTop: '2px', fontFamily: 'var(--font-mono)' }}>
                                                    {item.stock_before} → {item.stock_after}
                                                </div>
                                            )}
                                            {item.edited_by && (
                                                <div style={{ fontSize: '0.62rem', color: '#f59e0b', marginTop: '2px' }}>
                                                    {isDeleted ? 'Deleted' : 'Corrected'} by {item.edited_by} · {new Date(item.edited_at).toLocaleString()}
                                                </div>
                                            )}
                                        </div>

                                        {isOffcut && isEditing ? (
                                            <div style={{ display: 'flex', alignItems: 'center', gap: '0.375rem', flexShrink: 0, flexWrap: 'wrap' }}>
                                                {item.offcut_width != null ? (
                                                    <>
                                                        <input type="number" step="0.01" min="0" autoFocus placeholder="width" value={editOffcut.width}
                                                            onChange={e => setEditOffcut(v => ({ ...v, width: e.target.value }))}
                                                            style={{ ...rowInput, width: '64px' }} />
                                                        <span style={{ color: '#64748b', fontSize: '0.75rem' }}>×</span>
                                                        <input type="number" step="0.01" min="0" placeholder="height" value={editOffcut.height}
                                                            onChange={e => setEditOffcut(v => ({ ...v, height: e.target.value }))}
                                                            style={{ ...rowInput, width: '64px' }} />
                                                    </>
                                                ) : (
                                                    <input type="number" step="0.01" min="0" autoFocus placeholder="length" value={editOffcut.length}
                                                        onChange={e => setEditOffcut(v => ({ ...v, length: e.target.value }))}
                                                        style={{ ...rowInput, width: '72px' }} />
                                                )}
                                                <input type="number" step="1" min="1" placeholder="qty" value={editOffcut.quantity}
                                                    onChange={e => setEditOffcut(v => ({ ...v, quantity: e.target.value }))}
                                                    style={{ ...rowInput, width: '56px' }} />
                                                <button onClick={() => saveEdit(item)} disabled={saving} style={{
                                                    background: 'rgba(34,197,94,0.15)', border: '1px solid rgba(34,197,94,0.3)', color: '#4ade80',
                                                    borderRadius: '6px', padding: '5px 9px', cursor: 'pointer', fontSize: '0.75rem', fontWeight: 700,
                                                }}>✓</button>
                                                <button onClick={cancelEdit} disabled={saving} style={{
                                                    background: 'none', border: '1px solid rgba(255,255,255,0.1)', color: '#64748b',
                                                    borderRadius: '6px', padding: '5px 9px', cursor: 'pointer', fontSize: '0.75rem',
                                                }}>✕</button>
                                            </div>
                                        ) : isOffcut ? (
                                            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', flexShrink: 0 }}>
                                                <span style={{
                                                    fontSize: '0.78rem', fontWeight: 800,
                                                    color: isDeleted ? '#f87171' : '#22d3ee',
                                                    background: isDeleted ? 'rgba(248,113,113,0.1)' : 'rgba(6,182,212,0.1)',
                                                    borderRadius: '100px', padding: '2px 9px',
                                                }}>{isDeleted ? '🗑 Deleted' : '✂ Offcut'}</span>
                                                {!isDeleted && canEditItem(item) && (
                                                    <>
                                                        <button onClick={() => startEdit(item)} title="Correct this line" style={{
                                                            background: 'none', border: 'none', color: '#60a5fa', cursor: 'pointer', fontSize: '0.85rem',
                                                        }}>✎</button>
                                                        <button onClick={() => deleteOffcut(item)} disabled={saving} title="Delete this offcut permanently" style={{
                                                            background: 'none', border: 'none', color: '#f87171', cursor: 'pointer', fontSize: '0.85rem',
                                                        }}>🗑</button>
                                                    </>
                                                )}
                                            </div>
                                        ) : isEditing ? (
                                            <div style={{ display: 'flex', alignItems: 'center', gap: '0.375rem', flexShrink: 0, flexWrap: 'wrap' }}>
                                                <input type="number" step="0.01" min="0" autoFocus value={editValue}
                                                    onChange={e => setEditValue(e.target.value)}
                                                    style={{ ...rowInput, width: '80px' }} />
                                                <button onClick={() => saveEdit(item)} disabled={saving} style={{
                                                    background: 'rgba(34,197,94,0.15)', border: '1px solid rgba(34,197,94,0.3)', color: '#4ade80',
                                                    borderRadius: '6px', padding: '5px 9px', cursor: 'pointer', fontSize: '0.75rem', fontWeight: 700,
                                                }}>✓</button>
                                                <button onClick={cancelEdit} disabled={saving} style={{
                                                    background: 'none', border: '1px solid rgba(255,255,255,0.1)', color: '#64748b',
                                                    borderRadius: '6px', padding: '5px 9px', cursor: 'pointer', fontSize: '0.75rem',
                                                }}>✕</button>
                                            </div>
                                        ) : (
                                            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', flexShrink: 0 }}>
                                                <span style={{
                                                    fontSize: '0.78rem', fontWeight: 800, color: '#4ade80',
                                                    background: 'rgba(34,197,94,0.1)', borderRadius: '100px', padding: '2px 9px',
                                                }}>
                                                    +{item.entered_quantity}{item.entered_unit ? ` ${item.entered_unit}` : ''}
                                                </span>
                                                {canEditItem(item) && (
                                                    <button onClick={() => startEdit(item)} title="Correct this line" style={{
                                                        background: 'none', border: 'none', color: '#60a5fa', cursor: 'pointer', fontSize: '0.85rem',
                                                    }}>✎</button>
                                                )}
                                            </div>
                                        )}
                                    </div>
                                </div>
                            );
                        })}
                        {session.items.length === 0 && (
                            <p style={{ fontSize: '0.78rem', color: '#334155', textAlign: 'center', padding: '2rem 0', fontStyle: 'italic' }}>No lines in this session</p>
                        )}
                    </div>
                </div>

                {/* Footer */}
                <div className="modal-footer-pad" style={{ padding: '1.125rem 2rem', borderTop: '1px solid rgba(255,255,255,0.07)', flexShrink: 0 }}>
                    <button onClick={onClose} style={{
                        width: '100%', padding: '0.875rem', borderRadius: '0.875rem', border: '1px solid rgba(255,255,255,0.08)',
                        background: 'transparent', color: '#64748b', fontWeight: 700, cursor: 'pointer', fontSize: '0.875rem',
                    }}>Close</button>
                </div>
            </div>
        </div>
    );
}
