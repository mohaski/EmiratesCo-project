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
// correct_stock_input_session_item — reverses the old delta and re-applies a
// new one computed from the same conversion_factor captured at entry time).
export default function StockSessionDetailModal({ isOpen, onClose, session, onCorrected }) {
    const { user } = useAuth();
    const showToast = useToast();
    const canEdit = user?.role === 'ceo';

    const [editingItemId, setEditingItemId] = useState(null);
    const [editValue, setEditValue] = useState('');
    const [saving, setSaving] = useState(false);

    if (!isOpen || !session) return null;

    const startEdit = (item) => {
        setEditingItemId(item.id);
        setEditValue(String(item.entered_quantity));
    };
    const cancelEdit = () => { setEditingItemId(null); setEditValue(''); };

    const saveEdit = async (item) => {
        const qty = parseFloat(editValue);
        if (isNaN(qty) || qty < 0) return;
        setSaving(true);
        try {
            await api.stockSessionService.correctItem(session.id, item.id, { entered_quantity: qty });
            showToast('Line corrected', 'success');
            cancelEdit();
            onCorrected?.();
        } catch {
            showToast('Failed to correct line.', 'error');
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
                width: '100%', maxWidth: '640px', maxHeight: '88vh',
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
                            const isEditing = editingItemId === item.id;
                            return (
                                <div key={item.id} style={{
                                    padding: '0.875rem 1rem', borderRadius: '0.875rem',
                                    background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.07)',
                                }}>
                                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '0.75rem', flexWrap: 'wrap' }}>
                                        <div style={{ minWidth: 0 }}>
                                            <div style={{ fontSize: '0.82rem', fontWeight: 800, color: '#e2e8f0' }}>
                                                {item.product_name}{item.variant_name ? ` · ${item.variant_name}` : ''}
                                            </div>
                                            {isOffcut ? (
                                                <div style={{ fontSize: '0.68rem', color: '#64748b', marginTop: '2px', fontFamily: 'var(--font-mono)' }}>
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
                                                    Corrected by {item.edited_by} · {new Date(item.edited_at).toLocaleString()}
                                                </div>
                                            )}
                                        </div>

                                        {isOffcut ? (
                                            <span style={{
                                                fontSize: '0.78rem', fontWeight: 800, color: '#22d3ee', flexShrink: 0,
                                                background: 'rgba(6,182,212,0.1)', borderRadius: '100px', padding: '2px 9px',
                                            }}>✂ Offcut</span>
                                        ) : isEditing ? (
                                            <div style={{ display: 'flex', alignItems: 'center', gap: '0.375rem', flexShrink: 0 }}>
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
                                                {canEdit && (
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
