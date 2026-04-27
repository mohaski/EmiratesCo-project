export default function ConfirmationModal({ isOpen, onClose, onConfirm, title, message, confirmText = 'Confirm', confirmStyle = 'danger' }) {
    if (!isOpen) return null;

    const isDanger = confirmStyle === 'danger';

    return (
        <div style={{
            position: 'fixed', inset: 0, zIndex: 50,
            display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '1rem',
            background: 'rgba(9,14,26,0.85)', backdropFilter: 'blur(12px)',
        }} onClick={onClose}>
            <div onClick={e => e.stopPropagation()} style={{
                width: '100%', maxWidth: '420px',
                background: 'linear-gradient(145deg, rgba(13,20,38,0.99), rgba(9,14,26,0.99))',
                border: `1px solid ${isDanger ? 'rgba(239,68,68,0.2)' : 'rgba(59,130,246,0.2)'}`,
                borderRadius: '1.25rem', overflow: 'hidden',
                boxShadow: `0 32px 80px rgba(0,0,0,0.6), 0 0 0 1px ${isDanger ? 'rgba(239,68,68,0.08)' : 'rgba(59,130,246,0.08)'}`,
                animation: 'fadeInScale 0.2s ease',
            }}>
                {/* Icon + Title */}
                <div style={{
                    padding: '1.5rem 1.75rem 1.25rem',
                    borderBottom: '1px solid rgba(255,255,255,0.07)',
                    background: isDanger ? 'linear-gradient(135deg, rgba(239,68,68,0.07), rgba(0,0,0,0))' : 'linear-gradient(135deg, rgba(59,130,246,0.07), rgba(0,0,0,0))',
                }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
                        <div style={{
                            width: '40px', height: '40px', borderRadius: '10px', flexShrink: 0,
                            background: isDanger ? 'rgba(239,68,68,0.12)' : 'rgba(59,130,246,0.12)',
                            border: `1px solid ${isDanger ? 'rgba(239,68,68,0.25)' : 'rgba(59,130,246,0.25)'}`,
                            display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '1.25rem',
                        }}>{isDanger ? '⚠️' : 'ℹ️'}</div>
                        <h3 style={{ fontSize: '1rem', fontWeight: 800, color: '#f1f5f9', margin: 0 }}>{title}</h3>
                    </div>
                </div>

                <div style={{ padding: '1.25rem 1.75rem 1.5rem' }}>
                    <p style={{ fontSize: '0.875rem', color: '#64748b', lineHeight: 1.6, margin: '0 0 1.5rem' }}>{message}</p>

                    <div style={{ display: 'flex', gap: '0.75rem', justifyContent: 'flex-end' }}>
                        <button onClick={onClose} style={{
                            padding: '0.625rem 1.25rem', borderRadius: '0.75rem',
                            background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.08)',
                            color: '#64748b', fontWeight: 600, fontSize: '0.82rem', cursor: 'pointer', transition: 'all 0.15s',
                        }}
                        onMouseEnter={e => { e.currentTarget.style.background = 'rgba(255,255,255,0.1)'; }}
                        onMouseLeave={e => { e.currentTarget.style.background = 'rgba(255,255,255,0.06)'; }}
                        >Cancel</button>
                        <button onClick={onConfirm} style={{
                            padding: '0.625rem 1.25rem', borderRadius: '0.75rem', border: 'none', cursor: 'pointer',
                            background: isDanger ? 'linear-gradient(135deg, #ef4444, #dc2626)' : 'linear-gradient(135deg, #3b82f6, #06b6d4)',
                            color: '#fff', fontWeight: 700, fontSize: '0.82rem',
                            boxShadow: isDanger ? '0 4px 16px rgba(239,68,68,0.3)' : '0 4px 16px rgba(59,130,246,0.3)',
                            transition: 'all 0.15s',
                        }}
                        onMouseEnter={e => { e.currentTarget.style.transform = 'translateY(-1px)'; }}
                        onMouseLeave={e => { e.currentTarget.style.transform = 'translateY(0)'; }}
                        >{confirmText}</button>
                    </div>
                </div>
            </div>
        </div>
    );
}
