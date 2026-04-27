/** @type {import('tailwindcss').Config} */
export default {
    content: [
        "./index.html",
        "./src/**/*.{js,ts,jsx,tsx}",
    ],
    darkMode: 'class',
    theme: {
        extend: {
            colors: {
                // Core brand palette
                brand: {
                    50:  '#eff6ff',
                    100: '#dbeafe',
                    200: '#bfdbfe',
                    300: '#93c5fd',
                    400: '#60a5fa',
                    500: '#3b82f6',
                    600: '#2563eb',
                    700: '#1d4ed8',
                    800: '#1e40af',
                    900: '#1e3a8a',
                },
                // Cyan accent (glass/water)
                ice: {
                    50:  '#ecfeff',
                    100: '#cffafe',
                    200: '#a5f3fc',
                    300: '#67e8f9',
                    400: '#22d3ee',
                    500: '#06b6d4',
                    600: '#0891b2',
                    700: '#0e7490',
                    800: '#155e75',
                    900: '#164e63',
                },
                // Dark surface palette
                surface: {
                    50:  '#f8fafc',
                    100: '#f1f5f9',
                    200: '#e2e8f0',
                    300: '#cbd5e1',
                    400: '#94a3b8',
                    500: '#64748b',
                    600: '#475569',
                    700: '#334155',
                    800: '#1e293b',
                    850: '#162032',
                    900: '#0f172a',
                    950: '#090e1a',
                },
                // Metal palette (from before, preserved)
                metal: {
                    100: '#f5f5f7',
                    200: '#e5e5ea',
                    300: '#d1d1d6',
                    400: '#aeaeb2',
                    500: '#8e8e93',
                    600: '#636366',
                    700: '#48484a',
                    800: '#2c2c2e',
                    900: '#1c1c1e',
                },
                // Glass borders and highlights
                glass: {
                    border: 'rgba(255,255,255,0.08)',
                    'border-strong': 'rgba(255,255,255,0.15)',
                    surface: 'rgba(255,255,255,0.04)',
                    'surface-hover': 'rgba(255,255,255,0.07)',
                },
                // Status colors
                success: {
                    50: '#f0fdf4',
                    100: '#dcfce7',
                    400: '#4ade80',
                    500: '#22c55e',
                    600: '#16a34a',
                    900: '#14532d',
                },
                warning: {
                    50: '#fffbeb',
                    100: '#fef3c7',
                    400: '#fbbf24',
                    500: '#f59e0b',
                    600: '#d97706',
                    900: '#78350f',
                },
                danger: {
                    50: '#fff1f2',
                    100: '#ffe4e6',
                    400: '#f87171',
                    500: '#ef4444',
                    600: '#dc2626',
                    900: '#7f1d1d',
                },
            },
            fontFamily: {
                sans: ['Inter', 'system-ui', '-apple-system', 'BlinkMacSystemFont', 'sans-serif'],
                mono: ['JetBrains Mono', 'Fira Code', 'Consolas', 'monospace'],
                display: ['Inter', 'system-ui', 'sans-serif'],
            },
            fontSize: {
                '2xs': ['0.625rem', { lineHeight: '0.875rem' }],
            },
            backgroundImage: {
                'gradient-brand': 'linear-gradient(135deg, #3b82f6, #06b6d4)',
                'gradient-brand-hover': 'linear-gradient(135deg, #2563eb, #0891b2)',
                'gradient-success': 'linear-gradient(135deg, #22c55e, #10b981)',
                'gradient-warning': 'linear-gradient(135deg, #f59e0b, #ef4444)',
                'gradient-danger': 'linear-gradient(135deg, #ef4444, #dc2626)',
                'gradient-surface': 'linear-gradient(135deg, rgba(255,255,255,0.06), rgba(255,255,255,0.02))',
                'gradient-mesh': 'radial-gradient(at 40% 20%, hsla(228,100%,74%,0.08) 0px, transparent 50%), radial-gradient(at 80% 0%, hsla(189,100%,56%,0.06) 0px, transparent 50%), radial-gradient(at 0% 50%, hsla(355,100%,93%,0.04) 0px, transparent 50%)',
                'gradient-glow-blue': 'radial-gradient(ellipse at center, rgba(59, 130, 246, 0.15), transparent 70%)',
                'gradient-glow-cyan': 'radial-gradient(ellipse at center, rgba(6, 182, 212, 0.15), transparent 70%)',
            },
            boxShadow: {
                'glass': '0 4px 24px rgba(0,0,0,0.3), inset 0 1px 0 rgba(255,255,255,0.1)',
                'glass-sm': '0 2px 12px rgba(0,0,0,0.2), inset 0 1px 0 rgba(255,255,255,0.08)',
                'glass-lg': '0 8px 40px rgba(0,0,0,0.4), inset 0 1px 0 rgba(255,255,255,0.12)',
                'glow-blue': '0 0 20px rgba(59, 130, 246, 0.35)',
                'glow-cyan': '0 0 20px rgba(6, 182, 212, 0.35)',
                'glow-green': '0 0 20px rgba(34, 197, 94, 0.35)',
                'glow-amber': '0 0 20px rgba(245, 158, 11, 0.35)',
                'inner-glow': 'inset 0 0 20px rgba(59, 130, 246, 0.1)',
                'card': '0 1px 3px rgba(0,0,0,0.3), 0 4px 16px rgba(0,0,0,0.2)',
                'card-hover': '0 4px 20px rgba(0,0,0,0.4), 0 8px 40px rgba(0,0,0,0.2)',
                'nav-active': '0 0 0 1px rgba(59,130,246,0.4), 0 2px 8px rgba(59,130,246,0.2)',
            },
            borderRadius: {
                '4xl': '2rem',
                '5xl': '2.5rem',
            },
            animation: {
                'fade-in': 'fadeIn 0.4s ease-out',
                'fade-in-up': 'fadeInUp 0.5s ease-out',
                'fade-in-scale': 'fadeInScale 0.3s ease-out',
                'slide-in-right': 'slideInRight 0.3s ease-out',
                'slide-in-left': 'slideInLeft 0.3s ease-out',
                'slide-in-down': 'slideInDown 0.3s ease-out',
                'float': 'float 6s ease-in-out infinite',
                'pulse-slow': 'pulse 3s ease-in-out infinite',
                'shimmer': 'shimmer 2s linear infinite',
                'glow-pulse': 'glowPulse 2s ease-in-out infinite',
                'counter': 'counter 1s ease-out',
                'spin-slow': 'spin 8s linear infinite',
                'bounce-subtle': 'bounceSubtle 2s ease-in-out infinite',
            },
            keyframes: {
                fadeIn: {
                    '0%': { opacity: '0' },
                    '100%': { opacity: '1' },
                },
                fadeInUp: {
                    '0%': { opacity: '0', transform: 'translateY(16px)' },
                    '100%': { opacity: '1', transform: 'translateY(0)' },
                },
                fadeInScale: {
                    '0%': { opacity: '0', transform: 'scale(0.95)' },
                    '100%': { opacity: '1', transform: 'scale(1)' },
                },
                slideInRight: {
                    '0%': { opacity: '0', transform: 'translateX(20px)' },
                    '100%': { opacity: '1', transform: 'translateX(0)' },
                },
                slideInLeft: {
                    '0%': { opacity: '0', transform: 'translateX(-20px)' },
                    '100%': { opacity: '1', transform: 'translateX(0)' },
                },
                slideInDown: {
                    '0%': { opacity: '0', transform: 'translateY(-10px)' },
                    '100%': { opacity: '1', transform: 'translateY(0)' },
                },
                float: {
                    '0%, 100%': { transform: 'translateY(0)' },
                    '50%': { transform: 'translateY(-8px)' },
                },
                shimmer: {
                    '0%': { backgroundPosition: '-200% 0' },
                    '100%': { backgroundPosition: '200% 0' },
                },
                glowPulse: {
                    '0%, 100%': { opacity: '0.6', transform: 'scale(1)' },
                    '50%': { opacity: '1', transform: 'scale(1.05)' },
                },
                bounceSubtle: {
                    '0%, 100%': { transform: 'translateY(0)' },
                    '50%': { transform: 'translateY(-4px)' },
                },
            },
            backdropBlur: {
                xs: '2px',
                '2xl': '40px',
            },
            transitionTimingFunction: {
                'spring': 'cubic-bezier(0.34, 1.56, 0.64, 1)',
                'smooth': 'cubic-bezier(0.4, 0, 0.2, 1)',
            },
            transitionDuration: {
                '400': '400ms',
                '600': '600ms',
            },
            spacing: {
                '18': '4.5rem',
                '22': '5.5rem',
                '72': '18rem',
                '84': '21rem',
                '96': '24rem',
            },
        },
    },
    plugins: [],
}
