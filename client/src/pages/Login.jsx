import { useState } from 'react';
import { useAuth } from '../context/AuthContext';
import { useNavigate, Link } from 'react-router-dom';
import logo from '../assets/logo.png';

const EyeIcon = ({ open }) => open ? (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M9.88 9.88a3 3 0 1 0 4.24 4.24" />
        <path d="M10.73 5.08A10.43 10.43 0 0 1 12 5c7 0 10 7 10 7a13.16 13.16 0 0 1-1.67 2.68" />
        <path d="M6.61 6.61A13.526 13.526 0 0 0 2 12s3 7 10 7a9.74 9.74 0 0 0 5.39-1.61" />
        <line x1="2" x2="22" y1="2" y2="22" />
    </svg>
) : (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M2 12s3-7 10-7 10 7 10 7-3 7-10 7-10-7-10-7Z" />
        <circle cx="12" cy="12" r="3" />
    </svg>
);

export default function Login() {
    const [username, setUsername] = useState('');
    const [password, setPassword] = useState('');
    const [showPassword, setShowPassword] = useState(false);
    const [error, setError] = useState('');
    const [isLoading, setIsLoading] = useState(false);

    const { login } = useAuth();
    const navigate = useNavigate();

    const handleSubmit = async (e) => {
        e.preventDefault();
        setError('');
        if (!username || !password) { setError('Please enter both username and password'); return; }
        setIsLoading(true);
        try {
            const success = await login(username, password);
            if (success) { navigate('/'); }
            else { setError('Invalid credentials. Please try again.'); }
        } catch (err) {
            setError('Connection error. Please try again.');
        } finally {
            setIsLoading(false);
        }
    };

    return (
        <div style={{
            minHeight: '100vh',
            background: 'var(--color-bg)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            position: 'relative',
            overflow: 'hidden',
            fontFamily: 'var(--font-sans)',
        }}>
            {/* Animated background gradients */}
            <div style={{
                position: 'absolute', inset: 0, pointerEvents: 'none',
                background: `
                    radial-gradient(ellipse at 20% 50%, rgba(59,130,246,0.12) 0%, transparent 50%),
                    radial-gradient(ellipse at 80% 20%, rgba(6,182,212,0.10) 0%, transparent 45%),
                    radial-gradient(ellipse at 60% 80%, rgba(139,92,246,0.08) 0%, transparent 50%)
                `,
            }} />

            {/* Floating glass orbs */}
            <div style={{
                position: 'absolute', top: '15%', left: '10%',
                width: '300px', height: '300px', borderRadius: '50%',
                background: 'radial-gradient(circle, rgba(59,130,246,0.08), transparent 70%)',
                animation: 'float 8s ease-in-out infinite',
                pointerEvents: 'none',
            }} />
            <div style={{
                position: 'absolute', bottom: '20%', right: '8%',
                width: '250px', height: '250px', borderRadius: '50%',
                background: 'radial-gradient(circle, rgba(6,182,212,0.07), transparent 70%)',
                animation: 'float 10s ease-in-out infinite reverse',
                pointerEvents: 'none',
            }} />

            {/* Grid overlay */}
            <div style={{
                position: 'absolute', inset: 0, pointerEvents: 'none', opacity: 0.025,
                backgroundImage: `
                    linear-gradient(rgba(255,255,255,0.5) 1px, transparent 1px),
                    linear-gradient(90deg, rgba(255,255,255,0.5) 1px, transparent 1px)
                `,
                backgroundSize: '60px 60px',
            }} />

            {/* Login Card */}
            <div style={{
                width: '100%', maxWidth: '420px',
                margin: '0 1rem',
                background: 'linear-gradient(145deg, rgba(255,255,255,0.07), rgba(255,255,255,0.02))',
                border: '1px solid rgba(255,255,255,0.1)',
                borderRadius: '1.5rem',
                padding: '2.5rem',
                backdropFilter: 'blur(24px)',
                boxShadow: '0 24px 80px rgba(0,0,0,0.5), inset 0 1px 0 rgba(255,255,255,0.1)',
                position: 'relative',
                zIndex: 10,
                animation: 'fadeInScale 0.4s cubic-bezier(0.34,1.56,0.64,1)',
            }}>
                {/* Top glow line */}
                <div style={{
                    position: 'absolute', top: 0, left: '10%', right: '10%', height: '1px',
                    background: 'linear-gradient(90deg, transparent, rgba(59,130,246,0.6), rgba(6,182,212,0.6), transparent)',
                    borderRadius: '100px',
                }} />

                {/* Logo & Brand */}
                <div style={{ textAlign: 'center', marginBottom: '2rem' }}>
                    <div style={{
                        display: 'inline-flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        marginBottom: '1.25rem',
                    }}>
                        <div style={{
                            width: '64px', height: '64px',
                            borderRadius: '18px',
                            background: 'linear-gradient(135deg, #1e40af, #0e7490)',
                            border: '1px solid rgba(59,130,246,0.3)',
                            display: 'flex', alignItems: 'center', justifyContent: 'center',
                            boxShadow: '0 0 32px rgba(59,130,246,0.3), 0 0 60px rgba(6,182,212,0.15)',
                        }}>
                            <img src={logo} alt="Logo" style={{ width: '42px', height: '42px', objectFit: 'contain', filter: 'brightness(0) invert(1)' }} />
                        </div>
                    </div>
                    <h1 style={{
                        fontSize: '1.625rem', fontWeight: 800,
                        letterSpacing: '-0.025em',
                        background: 'linear-gradient(135deg, #f1f5f9, #94a3b8)',
                        backgroundClip: 'text', WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent',
                        marginBottom: '0.375rem',
                    }}>
                        EmiratesCo
                    </h1>
                    <p style={{ fontSize: '0.8rem', color: '#475569', fontWeight: 500, letterSpacing: '0.04em' }}>
                        Aluminium &amp; Glass Management
                    </p>
                </div>

                {/* Section label */}
                <div style={{
                    display: 'flex', alignItems: 'center', gap: '0.75rem',
                    marginBottom: '1.5rem',
                }}>
                    <div style={{ flex: 1, height: '1px', background: 'rgba(255,255,255,0.06)' }} />
                    <span style={{ fontSize: '0.7rem', fontWeight: 600, color: '#334155', letterSpacing: '0.1em', textTransform: 'uppercase' }}>
                        Sign In
                    </span>
                    <div style={{ flex: 1, height: '1px', background: 'rgba(255,255,255,0.06)' }} />
                </div>

                {/* Error */}
                {error && (
                    <div style={{
                        marginBottom: '1rem',
                        padding: '0.75rem 1rem',
                        background: 'rgba(239,68,68,0.1)',
                        border: '1px solid rgba(239,68,68,0.25)',
                        borderRadius: '0.75rem',
                        display: 'flex', alignItems: 'center', gap: '0.625rem',
                        animation: 'fadeInScale 0.2s ease',
                    }}>
                        <span style={{ fontSize: '0.875rem' }}>⚠️</span>
                        <span style={{ fontSize: '0.825rem', color: '#fca5a5', fontWeight: 500 }}>{error}</span>
                    </div>
                )}

                {/* Form */}
                <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
                    {/* Username */}
                    <div>
                        <label style={{ display: 'block', fontSize: '0.78rem', fontWeight: 600, color: '#64748b', marginBottom: '0.5rem', letterSpacing: '0.04em' }}>
                            USERNAME
                        </label>
                        <input
                            type="text"
                            value={username}
                            onChange={e => setUsername(e.target.value)}
                            placeholder="Enter your username"
                            autoComplete="username"
                            style={{
                                width: '100%',
                                background: 'rgba(255,255,255,0.05)',
                                border: '1px solid rgba(255,255,255,0.1)',
                                borderRadius: '0.75rem',
                                padding: '0.75rem 1rem',
                                color: '#f1f5f9',
                                fontSize: '0.9rem',
                                fontFamily: 'inherit',
                                outline: 'none',
                                transition: 'all 0.2s ease',
                                boxSizing: 'border-box',
                            }}
                            onFocus={e => { e.target.style.borderColor = 'rgba(59,130,246,0.5)'; e.target.style.boxShadow = '0 0 0 3px rgba(59,130,246,0.1)'; e.target.style.background = 'rgba(255,255,255,0.07)'; }}
                            onBlur={e => { e.target.style.borderColor = 'rgba(255,255,255,0.1)'; e.target.style.boxShadow = ''; e.target.style.background = 'rgba(255,255,255,0.05)'; }}
                        />
                    </div>

                    {/* Password */}
                    <div>
                        <label style={{ display: 'block', fontSize: '0.78rem', fontWeight: 600, color: '#64748b', marginBottom: '0.5rem', letterSpacing: '0.04em' }}>
                            PASSWORD
                        </label>
                        <div style={{ position: 'relative' }}>
                            <input
                                type={showPassword ? 'text' : 'password'}
                                value={password}
                                onChange={e => setPassword(e.target.value)}
                                placeholder="••••••••••"
                                autoComplete="current-password"
                                style={{
                                    width: '100%',
                                    background: 'rgba(255,255,255,0.05)',
                                    border: '1px solid rgba(255,255,255,0.1)',
                                    borderRadius: '0.75rem',
                                    padding: '0.75rem 3rem 0.75rem 1rem',
                                    color: '#f1f5f9',
                                    fontSize: '0.9rem',
                                    fontFamily: 'inherit',
                                    outline: 'none',
                                    transition: 'all 0.2s ease',
                                    boxSizing: 'border-box',
                                }}
                                onFocus={e => { e.target.style.borderColor = 'rgba(59,130,246,0.5)'; e.target.style.boxShadow = '0 0 0 3px rgba(59,130,246,0.1)'; e.target.style.background = 'rgba(255,255,255,0.07)'; }}
                                onBlur={e => { e.target.style.borderColor = 'rgba(255,255,255,0.1)'; e.target.style.boxShadow = ''; e.target.style.background = 'rgba(255,255,255,0.05)'; }}
                            />
                            <button
                                type="button"
                                onClick={() => setShowPassword(!showPassword)}
                                style={{
                                    position: 'absolute', right: '0.875rem', top: '50%', transform: 'translateY(-50%)',
                                    background: 'none', border: 'none', cursor: 'pointer',
                                    color: '#475569', display: 'flex', alignItems: 'center', justifyContent: 'center',
                                    padding: '0.25rem',
                                    transition: 'color 0.2s ease',
                                }}
                                onMouseEnter={e => { e.currentTarget.style.color = '#94a3b8'; }}
                                onMouseLeave={e => { e.currentTarget.style.color = '#475569'; }}
                            >
                                <EyeIcon open={showPassword} />
                            </button>
                        </div>
                    </div>

                    {/* Forgot Password */}
                    <div style={{ textAlign: 'right', marginTop: '-0.25rem' }}>
                        <Link
                            to="/forgot-password"
                            style={{ fontSize: '0.78rem', color: '#3b82f6', fontWeight: 500, textDecoration: 'none', transition: 'color 0.2s ease' }}
                            onMouseEnter={e => { e.currentTarget.style.color = '#60a5fa'; }}
                            onMouseLeave={e => { e.currentTarget.style.color = '#3b82f6'; }}
                        >
                            Forgot password?
                        </Link>
                    </div>

                    {/* Submit Button */}
                    <button
                        type="submit"
                        disabled={isLoading}
                        style={{
                            width: '100%',
                            padding: '0.875rem',
                            borderRadius: '0.875rem',
                            border: 'none',
                            background: isLoading ? 'rgba(59,130,246,0.4)' : 'linear-gradient(135deg, #3b82f6, #06b6d4)',
                            color: '#ffffff',
                            fontSize: '0.9rem',
                            fontWeight: 700,
                            fontFamily: 'inherit',
                            cursor: isLoading ? 'wait' : 'pointer',
                            transition: 'all 0.2s ease',
                            boxShadow: isLoading ? 'none' : '0 4px 20px rgba(59,130,246,0.35)',
                            letterSpacing: '0.02em',
                            marginTop: '0.5rem',
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            gap: '0.625rem',
                        }}
                        onMouseEnter={e => { if (!isLoading) { e.currentTarget.style.boxShadow = '0 6px 30px rgba(59,130,246,0.5)'; e.currentTarget.style.transform = 'translateY(-1px)'; } }}
                        onMouseLeave={e => { e.currentTarget.style.boxShadow = isLoading ? 'none' : '0 4px 20px rgba(59,130,246,0.35)'; e.currentTarget.style.transform = ''; }}
                    >
                        {isLoading ? (
                            <>
                                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" style={{ animation: 'spin 0.8s linear infinite' }}>
                                    <path d="M21 12a9 9 0 1 1-6.219-8.56" />
                                </svg>
                                Signing in…
                            </>
                        ) : 'Sign In →'}
                    </button>
                </form>

                {/* Footer */}
                <div style={{
                    marginTop: '1.75rem',
                    paddingTop: '1.25rem',
                    borderTop: '1px solid rgba(255,255,255,0.06)',
                    textAlign: 'center',
                }}>
                    <p style={{ fontSize: '0.72rem', color: '#334155', fontWeight: 500 }}>
                        Secure access powered by EmiratesCo Platform
                    </p>
                    <p style={{ fontSize: '0.68rem', color: '#1e293b', marginTop: '0.25rem' }}>
                        v2.0
                    </p>
                </div>
            </div>
        </div>
    );
}
