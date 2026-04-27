import { useState, useMemo, memo } from 'react';
import api from '../../services/api';

const CustomerSelectionOverlay = memo(({ customers, onSelectCustomer }) => {
    const [customerSearch, setCustomerSearch] = useState('');
    const [newCustomerName, setNewCustomerName] = useState('');
    const [newCustomerPhone, setNewCustomerPhone] = useState('');
    const [newCustomerType, setNewCustomerType] = useState('individual');
    const [isRegistering, setIsRegistering] = useState(false);

    const filteredCustomers = useMemo(() => {
        if (!customerSearch) return [];
        const lower = customerSearch.toLowerCase();
        return customers.filter(c =>
            c.name.toLowerCase().includes(lower) || c.phone.includes(lower)
        );
    }, [customers, customerSearch]);

    const handleRegister = async () => {
        if (!newCustomerName.trim() || !newCustomerPhone.trim()) return;
        setIsRegistering(true);
        try {
            const response = await api.userService.createCustomer({
                name: newCustomerName, phoneNumber: newCustomerPhone, type: newCustomerType
            });
            onSelectCustomer({ id: response.customerId, name: newCustomerName, phone: newCustomerPhone, type: newCustomerType });
        } catch (err) {
            console.error("Registration failed", err);
            alert("Registration failed: " + (err.response?.data?.detail || "Please check phone number format"));
        } finally {
            setIsRegistering(false);
        }
    };

    const inputStyle = {
        width: '100%', background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.1)',
        borderRadius: '0.75rem', padding: '0.75rem 1rem', color: '#f1f5f9',
        fontSize: '0.875rem', outline: 'none', transition: 'border-color 0.2s', boxSizing: 'border-box',
        fontFamily: 'var(--font-sans)',
    };

    return (
        <div style={{
            position: 'absolute', inset: 0, zIndex: 60,
            background: 'rgba(9,14,26,0.85)', backdropFilter: 'blur(12px)',
            display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '1rem',
        }}>
            <div style={{
                width: '100%', maxWidth: '680px',
                background: 'linear-gradient(145deg, rgba(13,20,38,0.98), rgba(9,14,26,0.98))',
                border: '1px solid rgba(255,255,255,0.1)',
                borderRadius: '1.5rem',
                boxShadow: '0 32px 80px rgba(0,0,0,0.6), 0 0 0 1px rgba(59,130,246,0.1)',
                overflow: 'hidden',
            }}>
                {/* Header */}
                <div style={{
                    padding: '1.75rem 2rem 1.25rem',
                    borderBottom: '1px solid rgba(255,255,255,0.07)',
                    background: 'linear-gradient(135deg, rgba(59,130,246,0.08), rgba(6,182,212,0.04))',
                }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.875rem' }}>
                        <div style={{
                            width: '40px', height: '40px', borderRadius: '10px',
                            background: 'linear-gradient(135deg, #3b82f6, #06b6d4)',
                            display: 'flex', alignItems: 'center', justifyContent: 'center',
                            fontSize: '1.1rem', boxShadow: '0 0 16px rgba(59,130,246,0.3)',
                        }}>👤</div>
                        <div>
                            <h2 style={{ fontSize: '1.1rem', fontWeight: 800, color: '#f1f5f9', margin: 0 }}>Select Customer</h2>
                            <p style={{ fontSize: '0.75rem', color: '#64748b', margin: '2px 0 0' }}>Choose existing or register new</p>
                        </div>
                    </div>
                </div>

                <div style={{ padding: '1.5rem 2rem' }}>
                    {/* Search Existing */}
                    <div style={{ marginBottom: '1.5rem' }}>
                        <label style={{ fontSize: '0.65rem', fontWeight: 700, color: '#475569', letterSpacing: '0.08em', textTransform: 'uppercase', display: 'block', marginBottom: '0.5rem' }}>
                            Search Registered Customer
                        </label>
                        <div style={{ position: 'relative' }}>
                            <span style={{ position: 'absolute', left: '0.875rem', top: '50%', transform: 'translateY(-50%)', color: '#475569', fontSize: '0.875rem' }}>🔍</span>
                            <input
                                type="text"
                                placeholder="Search by name or phone..."
                                style={{ ...inputStyle, paddingLeft: '2.25rem' }}
                                value={customerSearch}
                                onChange={e => setCustomerSearch(e.target.value)}
                                onFocus={e => { e.target.style.borderColor = 'rgba(59,130,246,0.5)'; }}
                                onBlur={e => { e.target.style.borderColor = 'rgba(255,255,255,0.1)'; }}
                            />
                        </div>

                        {customerSearch && (
                            <div style={{ marginTop: '0.5rem', maxHeight: '180px', overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '4px' }} className="custom-scrollbar">
                                {filteredCustomers.length === 0 ? (
                                    <p style={{ fontSize: '0.78rem', color: '#475569', padding: '0.5rem', textAlign: 'center', fontStyle: 'italic' }}>No customers found</p>
                                ) : filteredCustomers.map(c => (
                                    <button key={c.id} onClick={() => onSelectCustomer(c)} style={{
                                        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                                        padding: '0.625rem 0.875rem', borderRadius: '0.625rem',
                                        background: 'rgba(255,255,255,0.04)', border: '1px solid transparent',
                                        cursor: 'pointer', transition: 'all 0.15s', textAlign: 'left', width: '100%',
                                    }}
                                    onMouseEnter={e => { e.currentTarget.style.background = 'rgba(59,130,246,0.1)'; e.currentTarget.style.borderColor = 'rgba(59,130,246,0.2)'; }}
                                    onMouseLeave={e => { e.currentTarget.style.background = 'rgba(255,255,255,0.04)'; e.currentTarget.style.borderColor = 'transparent'; }}
                                    >
                                        <div>
                                            <div style={{ fontSize: '0.875rem', fontWeight: 700, color: '#e2e8f0' }}>{c.name}</div>
                                            <div style={{ fontSize: '0.72rem', color: '#64748b', fontFamily: 'var(--font-mono)' }}>{c.phone}</div>
                                        </div>
                                        <span style={{ fontSize: '0.75rem', color: '#3b82f6', fontWeight: 600 }}>Select →</span>
                                    </button>
                                ))}
                            </div>
                        )}
                    </div>

                    {/* Divider */}
                    <div style={{ display: 'flex', alignItems: 'center', gap: '1rem', marginBottom: '1.5rem' }}>
                        <div style={{ flex: 1, height: '1px', background: 'rgba(255,255,255,0.07)' }} />
                        <span style={{ fontSize: '0.65rem', fontWeight: 700, color: '#334155', letterSpacing: '0.1em', textTransform: 'uppercase' }}>OR</span>
                        <div style={{ flex: 1, height: '1px', background: 'rgba(255,255,255,0.07)' }} />
                    </div>

                    {/* New Customer + Walk-in */}
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1.5rem' }}>
                        <div>
                            <label style={{ fontSize: '0.65rem', fontWeight: 700, color: '#475569', letterSpacing: '0.08em', textTransform: 'uppercase', display: 'block', marginBottom: '0.625rem' }}>
                                New Registration
                            </label>

                            {/* Type toggle */}
                            <div style={{ display: 'flex', gap: '0.375rem', marginBottom: '0.75rem', background: 'rgba(255,255,255,0.04)', borderRadius: '0.625rem', padding: '3px' }}>
                                {['individual', 'cooperate'].map(t => (
                                    <button key={t} onClick={() => setNewCustomerType(t)} style={{
                                        flex: 1, padding: '0.375rem 0', borderRadius: '0.5rem', fontSize: '0.72rem', fontWeight: 700, border: 'none', cursor: 'pointer',
                                        background: newCustomerType === t ? 'linear-gradient(135deg, #3b82f6, #06b6d4)' : 'transparent',
                                        color: newCustomerType === t ? '#fff' : '#64748b',
                                        transition: 'all 0.15s',
                                    }}>
                                        {t === 'individual' ? 'Individual' : 'Corporate'}
                                    </button>
                                ))}
                            </div>

                            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                                <input type="text" placeholder="Full Name" style={inputStyle} value={newCustomerName} onChange={e => setNewCustomerName(e.target.value)}
                                    onFocus={e => { e.target.style.borderColor = 'rgba(59,130,246,0.5)'; }} onBlur={e => { e.target.style.borderColor = 'rgba(255,255,255,0.1)'; }} />
                                <input type="tel" placeholder="Phone Number" style={inputStyle} value={newCustomerPhone} onChange={e => setNewCustomerPhone(e.target.value)}
                                    onFocus={e => { e.target.style.borderColor = 'rgba(59,130,246,0.5)'; }} onBlur={e => { e.target.style.borderColor = 'rgba(255,255,255,0.1)'; }}
                                    onKeyDown={e => e.key === 'Enter' && handleRegister()} />
                                <button onClick={handleRegister} disabled={!newCustomerName.trim() || !newCustomerPhone.trim() || isRegistering} style={{
                                    padding: '0.75rem', borderRadius: '0.75rem', border: 'none', cursor: 'pointer',
                                    background: 'linear-gradient(135deg, #3b82f6, #06b6d4)',
                                    color: '#fff', fontWeight: 800, fontSize: '0.82rem',
                                    opacity: (!newCustomerName.trim() || !newCustomerPhone.trim() || isRegistering) ? 0.5 : 1,
                                    transition: 'opacity 0.2s', boxShadow: '0 4px 16px rgba(59,130,246,0.3)',
                                }}>
                                    {isRegistering ? 'Registering...' : 'Register & Start →'}
                                </button>
                            </div>
                        </div>

                        <div style={{ display: 'flex', flexDirection: 'column', justifyContent: 'flex-end', gap: '0.75rem' }}>
                            <div style={{ padding: '1rem', background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.07)', borderRadius: '0.875rem', marginBottom: '0.25rem' }}>
                                <p style={{ fontSize: '0.72rem', color: '#64748b', margin: '0 0 0.5rem', fontWeight: 600 }}>Quick Options</p>
                                <p style={{ fontSize: '0.7rem', color: '#334155', margin: 0, lineHeight: 1.5 }}>
                                    For customers without registration, use Walk-in. For registered clients, search by name or phone.
                                </p>
                            </div>
                            <button onClick={() => onSelectCustomer({ id: 'walk-in', name: 'Walk-in Customer', type: 'walk-in' })} style={{
                                padding: '0.875rem', borderRadius: '0.875rem',
                                background: 'rgba(59,130,246,0.1)', border: '1px solid rgba(59,130,246,0.25)',
                                color: '#60a5fa', fontWeight: 700, fontSize: '0.875rem', cursor: 'pointer',
                                transition: 'all 0.2s',
                            }}
                            onMouseEnter={e => { e.currentTarget.style.background = 'rgba(59,130,246,0.18)'; }}
                            onMouseLeave={e => { e.currentTarget.style.background = 'rgba(59,130,246,0.1)'; }}
                            >
                                🚶 Walk-in Customer
                            </button>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
});

export default CustomerSelectionOverlay;
