import { useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import logo from '../assets/logo.png';

const roles = [
    {
        id: 'admin',
        title: 'CEO / Admin',
        description: 'Full system access — overview, products, analytics, and settings.',
        icon: '👑',
        accent: '#f59e0b',
        accentRgb: '245,158,11',
        gradient: 'linear-gradient(135deg, #f59e0b, #d97706)',
    },
    {
        id: 'senior',
        title: 'Senior Cashier',
        description: 'Manage sales, inventory, orders, and view full reports.',
        icon: '💼',
        accent: '#3b82f6',
        accentRgb: '59,130,246',
        gradient: 'linear-gradient(135deg, #3b82f6, #06b6d4)',
    },
    {
        id: 'junior',
        title: 'Junior Cashier',
        description: 'Process sales transactions and view basic dashboard.',
        icon: '🧾',
        accent: '#22c55e',
        accentRgb: '34,197,94',
        gradient: 'linear-gradient(135deg, #22c55e, #16a34a)',
    },
    {
        id: 'store_manager',
        title: 'Store Manager',
        description: 'Oversee active orders and manage workshop preparation.',
        icon: '🏭',
        accent: '#a855f7',
        accentRgb: '168,85,247',
        gradient: 'linear-gradient(135deg, #a855f7, #7c3aed)',
    }
];

export default function RoleSelectionPage() {
    const { updateUserRole } = useAuth();
    const navigate = useNavigate();

    const handleSelectRole = roleId => {
        updateUserRole(roleId);
        navigate('/');
    };

    return (
        <div style={{ minHeight: '100vh', background: '#090e1a', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: '2rem', position: 'relative', overflow: 'hidden' }}>

            {/* Ambient orbs */}
            <div style={{ position: 'absolute', top: '-15%', left: '-10%', width: '45%', height: '45%', background: 'radial-gradient(circle, rgba(59,130,246,0.12) 0%, transparent 70%)', borderRadius: '50%', filter: 'blur(60px)', pointerEvents: 'none' }} />
            <div style={{ position: 'absolute', bottom: '-15%', right: '-10%', width: '45%', height: '45%', background: 'radial-gradient(circle, rgba(168,85,247,0.10) 0%, transparent 70%)', borderRadius: '50%', filter: 'blur(60px)', pointerEvents: 'none' }} />
            <div style={{ position: 'absolute', top: '40%', left: '50%', transform: 'translate(-50%,-50%)', width: '30%', height: '30%', background: 'radial-gradient(circle, rgba(6,182,212,0.06) 0%, transparent 70%)', borderRadius: '50%', filter: 'blur(80px)', pointerEvents: 'none' }} />

            <div style={{ position: 'relative', zIndex: 1, width: '100%', maxWidth: '900px' }}>

                {/* Header */}
                <div style={{ textAlign: 'center', marginBottom: '3.5rem' }}>
                    <img src={logo} alt="EmiratesCo" style={{ height: '72px', objectFit: 'contain', marginBottom: '1.5rem', filter: 'brightness(1.2) saturate(1.3)', mixBlendMode: 'screen' }} />
                    <h1 style={{ fontSize: '2rem', fontWeight: 900, color: '#f1f5f9', margin: '0 0 0.625rem', letterSpacing: '-0.03em' }}>Welcome Back</h1>
                    <p style={{ fontSize: '0.95rem', color: '#475569', margin: 0, fontWeight: 500 }}>Select your session role to continue</p>
                </div>

                {/* Role grid */}
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '1.25rem' }}>
                    {roles.map(role => (
                        <button
                            key={role.id}
                            onClick={() => handleSelectRole(role.id)}
                            style={{
                                background: `linear-gradient(145deg, rgba(${role.accentRgb},0.07) 0%, rgba(255,255,255,0.03) 100%)`,
                                border: `1px solid rgba(${role.accentRgb},0.18)`,
                                borderRadius: '1.5rem',
                                padding: '1.75rem 1.5rem',
                                cursor: 'pointer',
                                textAlign: 'left',
                                display: 'flex',
                                flexDirection: 'column',
                                gap: 0,
                                transition: 'all 0.25s cubic-bezier(0.4,0,0.2,1)',
                                position: 'relative',
                                overflow: 'hidden',
                            }}
                            onMouseEnter={e => {
                                e.currentTarget.style.transform = 'translateY(-4px)';
                                e.currentTarget.style.borderColor = `rgba(${role.accentRgb},0.45)`;
                                e.currentTarget.style.boxShadow = `0 20px 50px rgba(0,0,0,0.5), 0 0 0 1px rgba(${role.accentRgb},0.2), 0 0 40px rgba(${role.accentRgb},0.12)`;
                                e.currentTarget.style.background = `linear-gradient(145deg, rgba(${role.accentRgb},0.12) 0%, rgba(255,255,255,0.04) 100%)`;
                            }}
                            onMouseLeave={e => {
                                e.currentTarget.style.transform = 'translateY(0)';
                                e.currentTarget.style.borderColor = `rgba(${role.accentRgb},0.18)`;
                                e.currentTarget.style.boxShadow = 'none';
                                e.currentTarget.style.background = `linear-gradient(145deg, rgba(${role.accentRgb},0.07) 0%, rgba(255,255,255,0.03) 100%)`;
                            }}
                        >
                            {/* Icon */}
                            <div style={{
                                width: '52px', height: '52px', borderRadius: '14px',
                                background: role.gradient,
                                display: 'flex', alignItems: 'center', justifyContent: 'center',
                                fontSize: '1.5rem', marginBottom: '1.25rem',
                                boxShadow: `0 8px 24px rgba(${role.accentRgb},0.35)`,
                            }}>
                                {role.icon}
                            </div>

                            <h3 style={{ fontSize: '1rem', fontWeight: 800, color: '#f1f5f9', margin: '0 0 0.5rem', letterSpacing: '-0.01em' }}>{role.title}</h3>
                            <p style={{ fontSize: '0.78rem', color: '#475569', lineHeight: 1.6, margin: '0 0 1.5rem', flex: 1 }}>{role.description}</p>

                            <div style={{ display: 'flex', alignItems: 'center', gap: '0.375rem', fontSize: '0.72rem', fontWeight: 700, color: role.accent, letterSpacing: '0.08em', textTransform: 'uppercase' }}>
                                <span>Continue</span>
                                <svg width="14" height="14" fill="none" stroke="currentColor" viewBox="0 0 24 24" style={{ transition: 'transform 0.2s' }}>
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M17 8l4 4m0 0l-4 4m4-4H3" />
                                </svg>
                            </div>

                            {/* Top shine line */}
                            <div style={{ position: 'absolute', top: 0, left: '10%', right: '10%', height: '1px', background: `linear-gradient(90deg, transparent, rgba(${role.accentRgb},0.4), transparent)` }} />
                        </button>
                    ))}
                </div>

                <p style={{ textAlign: 'center', marginTop: '2.5rem', fontSize: '0.72rem', color: '#1e293b', fontWeight: 500 }}>
                    © 2025 EmiratesCo Aluminium & Glass · Dubai, UAE
                </p>
            </div>
        </div>
    );
}
