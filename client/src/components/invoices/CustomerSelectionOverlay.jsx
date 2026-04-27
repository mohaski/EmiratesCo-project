import { useState, useMemo, memo } from 'react';

const CustomerSelectionOverlay = memo(({ customers, onSelectCustomer }) => {
    const [customerSearch, setCustomerSearch] = useState('');
    const [newCustomerName, setNewCustomerName] = useState('');
    const [newCustomerPhone, setNewCustomerPhone] = useState('');

    const filteredCustomers = useMemo(() => {
        if (!customerSearch) return [];
        const lower = customerSearch.toLowerCase();
        return customers.filter(c => c.name.toLowerCase().includes(lower) || c.phone?.includes(lower));
    }, [customers, customerSearch]);

    const inputStyle = {
        background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.1)',
        borderRadius: '0.75rem', padding: '0.75rem 1rem', color: '#f1f5f9',
        fontSize: '0.875rem', outline: 'none', width: '100%', boxSizing: 'border-box',
        transition: 'border-color 0.2s',
    };
    const labelStyle = { fontSize: '0.62rem', fontWeight: 700, color: '#475569', letterSpacing: '0.08em', textTransform: 'uppercase', display: 'block', marginBottom: '0.5rem' };

    return (
        <div style={{
            position: 'absolute', inset: 0, zIndex: 60,
            background: 'rgba(9,14,26,0.92)', backdropFilter: 'blur(16px)',
            display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '1.5rem',
        }}>
            <div style={{
                width: '100%', maxWidth: '580px',
                background: 'linear-gradient(145deg, rgba(13,20,38,0.99), rgba(9,14,26,0.99))',
                border: '1px solid rgba(245,158,11,0.15)', borderRadius: '1.5rem', overflow: 'hidden',
                boxShadow: '0 32px 80px rgba(0,0,0,0.7)', animation: 'fadeInScale 0.2s ease',
            }}>
                {/* Header */}
                <div style={{ padding: '1.75rem 2rem 1.25rem', borderBottom: '1px solid rgba(255,255,255,0.06)' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', marginBottom: '0.375rem' }}>
                        <div style={{ width: '36px', height: '36px', borderRadius: '10px', background: 'rgba(245,158,11,0.15)', border: '1px solid rgba(245,158,11,0.3)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '1rem' }}>📄</div>
                        <h2 style={{ fontSize: '1.125rem', fontWeight: 800, color: '#f1f5f9', margin: 0 }}>Invoice Details</h2>
                    </div>
                    <p style={{ fontSize: '0.78rem', color: '#475569', margin: 0 }}>Who is this quotation for?</p>
                </div>

                <div style={{ padding: '1.5rem 2rem' }}>
                    {/* Search existing */}
                    <div style={{ marginBottom: '1.25rem' }}>
                        <label style={labelStyle}>Search Client</label>
                        <div style={{ position: 'relative' }}>
                            <span style={{ position: 'absolute', left: '0.875rem', top: '50%', transform: 'translateY(-50%)', color: '#475569', fontSize: '0.875rem' }}>🔍</span>
                            <input type="text" placeholder="Search by name or phone..." value={customerSearch} onChange={e => setCustomerSearch(e.target.value)}
                                style={{ ...inputStyle, paddingLeft: '2.5rem' }}
                                onFocus={e => { e.target.style.borderColor = 'rgba(245,158,11,0.4)'; }}
                                onBlur={e => { e.target.style.borderColor = 'rgba(255,255,255,0.1)'; }}
                            />
                        </div>
                        {customerSearch && (
                            <div style={{ marginTop: '0.5rem', maxHeight: '200px', overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '0.375rem' }} className="custom-scrollbar">
                                {filteredCustomers.map(c => (
                                    <button key={c.id} onClick={() => onSelectCustomer(c)} style={{
                                        width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                                        padding: '0.75rem 1rem', borderRadius: '0.75rem', border: '1px solid rgba(255,255,255,0.07)',
                                        background: 'rgba(255,255,255,0.04)', cursor: 'pointer', textAlign: 'left', transition: 'all 0.15s',
                                    }}
                                    onMouseEnter={e => { e.currentTarget.style.borderColor = 'rgba(245,158,11,0.3)'; e.currentTarget.style.background = 'rgba(245,158,11,0.06)'; }}
                                    onMouseLeave={e => { e.currentTarget.style.borderColor = 'rgba(255,255,255,0.07)'; e.currentTarget.style.background = 'rgba(255,255,255,0.04)'; }}>
                                        <div>
                                            <p style={{ fontWeight: 700, color: '#f1f5f9', margin: '0 0 2px', fontSize: '0.875rem' }}>{c.name}</p>
                                            <p style={{ fontSize: '0.72rem', color: '#64748b', fontFamily: 'var(--font-mono)', margin: 0 }}>{c.phone}</p>
                                        </div>
                                        <span style={{ fontSize: '0.72rem', color: '#f59e0b', fontWeight: 700 }}>Select →</span>
                                    </button>
                                ))}
                                {filteredCustomers.length === 0 && (
                                    <p style={{ fontSize: '0.78rem', color: '#334155', padding: '0.5rem', fontStyle: 'italic' }}>No clients found.</p>
                                )}
                            </div>
                        )}
                    </div>

                    {/* Divider */}
                    <div style={{ display: 'flex', alignItems: 'center', gap: '1rem', margin: '1.25rem 0' }}>
                        <div style={{ flex: 1, height: '1px', background: 'rgba(255,255,255,0.07)' }} />
                        <span style={{ fontSize: '0.65rem', fontWeight: 700, color: '#334155', letterSpacing: '0.1em' }}>OR</span>
                        <div style={{ flex: 1, height: '1px', background: 'rgba(255,255,255,0.07)' }} />
                    </div>

                    {/* New client */}
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
                        <div>
                            <label style={labelStyle}>New Client</label>
                            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                                <input type="text" placeholder="Client Name" value={newCustomerName} onChange={e => setNewCustomerName(e.target.value)}
                                    style={inputStyle}
                                    onFocus={e => { e.target.style.borderColor = 'rgba(245,158,11,0.4)'; }}
                                    onBlur={e => { e.target.style.borderColor = 'rgba(255,255,255,0.1)'; }}
                                />
                                <input type="tel" placeholder="Phone Number" value={newCustomerPhone} onChange={e => setNewCustomerPhone(e.target.value)}
                                    style={inputStyle}
                                    onFocus={e => { e.target.style.borderColor = 'rgba(245,158,11,0.4)'; }}
                                    onBlur={e => { e.target.style.borderColor = 'rgba(255,255,255,0.1)'; }}
                                    onKeyDown={e => {
                                        if (e.key === 'Enter' && newCustomerName.trim())
                                            onSelectCustomer({ id: 'new-' + Date.now(), name: newCustomerName, phone: newCustomerPhone, type: 'new' });
                                    }}
                                />
                                <button onClick={() => { if (newCustomerName.trim()) onSelectCustomer({ id: 'new-' + Date.now(), name: newCustomerName, phone: newCustomerPhone, type: 'new' }); }}
                                    disabled={!newCustomerName.trim()} style={{
                                        padding: '0.75rem', borderRadius: '0.75rem', border: 'none', cursor: 'pointer',
                                        background: newCustomerName.trim() ? 'linear-gradient(135deg, rgba(245,158,11,0.2), rgba(234,88,12,0.15))' : 'rgba(255,255,255,0.04)',
                                        color: newCustomerName.trim() ? '#fbbf24' : '#334155',
                                        fontWeight: 700, fontSize: '0.82rem', transition: 'all 0.2s',
                                        border: `1px solid ${newCustomerName.trim() ? 'rgba(245,158,11,0.35)' : 'rgba(255,255,255,0.07)'}`,
                                    }}>
                                    Create Profile →
                                </button>
                            </div>
                        </div>
                        <div style={{ display: 'flex', flexDirection: 'column', justifyContent: 'flex-end' }}>
                            <button onClick={() => onSelectCustomer({ id: 'guest', name: 'Guest Client', type: 'walk-in' })} style={{
                                padding: '0.875rem', borderRadius: '0.75rem', border: '1px solid rgba(255,255,255,0.09)',
                                background: 'rgba(255,255,255,0.05)', color: '#94a3b8', fontWeight: 700, fontSize: '0.82rem',
                                cursor: 'pointer', transition: 'all 0.15s',
                            }}
                            onMouseEnter={e => { e.currentTarget.style.borderColor = 'rgba(255,255,255,0.15)'; e.currentTarget.style.color = '#cbd5e1'; }}
                            onMouseLeave={e => { e.currentTarget.style.borderColor = 'rgba(255,255,255,0.09)'; e.currentTarget.style.color = '#94a3b8'; }}>
                                👤 Guest Client
                            </button>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
});

export default CustomerSelectionOverlay;
