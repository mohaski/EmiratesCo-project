import { useState, useEffect, useCallback } from 'react';
import { useNavigate, useLocation, Outlet } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';

const NAV_ICONS = {
  overview: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="3" width="7" height="9" rx="1" /><rect x="14" y="3" width="7" height="5" rx="1" />
      <rect x="14" y="12" width="7" height="9" rx="1" /><rect x="3" y="16" width="7" height="5" rx="1" />
    </svg>
  ),
  orders: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
      <path d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2" />
      <rect x="9" y="3" width="6" height="4" rx="1.5" /><path d="M9 12h6M9 16h4" />
    </svg>
  ),
  activeOrders: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="22 12 18 12 15 21 9 3 6 12 2 12" />
    </svg>
  ),
  sales: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
      <rect x="2" y="3" width="20" height="14" rx="2" /><path d="M8 21h8M12 17v4" />
    </svg>
  ),
  invoice: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
      <path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z" />
      <polyline points="14 2 14 8 20 8" /><line x1="16" y1="13" x2="8" y2="13" /><line x1="16" y1="17" x2="8" y2="17" />
    </svg>
  ),
  inventory: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
      <path d="M21 16V8a2 2 0 00-1-1.73l-7-4a2 2 0 00-2 0l-7 4A2 2 0 003 8v8a2 2 0 001 1.73l7 4a2 2 0 002 0l7-4A2 2 0 0021 16z" />
      <polyline points="3.27 6.96 12 12.01 20.73 6.96" /><line x1="12" y1="22.08" x2="12" y2="12" />
    </svg>
  ),
  addProduct: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="10" /><line x1="12" y1="8" x2="12" y2="16" /><line x1="8" y1="12" x2="16" y2="12" />
    </svg>
  ),
  manageProducts: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
      <path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7" />
      <path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z" />
    </svg>
  ),
  settings: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.65 1.65 0 00.33 1.82l.06.06a2 2 0 010 2.83 2 2 0 01-2.83 0l-.06-.06a1.65 1.65 0 00-1.82-.33 1.65 1.65 0 00-1 1.51V21a2 2 0 01-4 0v-.09A1.65 1.65 0 009 19.4a1.65 1.65 0 00-1.82.33l-.06.06a2 2 0 01-2.83-2.83l.06-.06A1.65 1.65 0 004.68 15a1.65 1.65 0 00-1.51-1H3a2 2 0 010-4h.09A1.65 1.65 0 004.6 9a1.65 1.65 0 00-.33-1.82l-.06-.06a2 2 0 012.83-2.83l.06.06A1.65 1.65 0 009 4.68a1.65 1.65 0 001-1.51V3a2 2 0 014 0v.09a1.65 1.65 0 001 1.51 1.65 1.65 0 001.82-.33l.06-.06a2 2 0 012.83 2.83l-.06.06a1.65 1.65 0 00-.33 1.82V9a1.65 1.65 0 001.51 1H21a2 2 0 010 4h-.09a1.65 1.65 0 00-1.51 1z" />
    </svg>
  ),
  logout: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
      <path d="M9 21H5a2 2 0 01-2-2V5a2 2 0 012-2h4" /><polyline points="16 17 21 12 16 7" /><line x1="21" y1="12" x2="9" y2="12" />
    </svg>
  ),
  menu: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <line x1="3" y1="6" x2="21" y2="6" /><line x1="3" y1="12" x2="21" y2="12" /><line x1="3" y1="18" x2="21" y2="18" />
    </svg>
  ),
  close: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
    </svg>
  ),
};

const ROLE_LABELS = {
  ceo: 'Executive',
  admin: 'Administrator',
  seniorCashier: 'Senior Cashier',
  juniorCashier: 'Cashier',
  storeManager: 'Store Manager',
  stockmanager: 'Stock Manager',
};

function useWindowWidth() {
  const [width, setWidth] = useState(() =>
    typeof window !== 'undefined' ? window.innerWidth : 1280
  );
  useEffect(() => {
    const handler = () => setWidth(window.innerWidth);
    window.addEventListener('resize', handler, { passive: true });
    return () => window.removeEventListener('resize', handler);
  }, []);
  return width;
}

export default function Layout() {
  const navigate = useNavigate();
  const location = useLocation();
  const { logout, user } = useAuth();
  const windowWidth = useWindowWidth();

  const isMobile = windowWidth < 768;
  const isTablet = windowWidth >= 768 && windowWidth < 1024;
  const isDesktop = windowWidth >= 1024;

  const [isSidebarExpanded, setSidebarExpanded] = useState(true);
  const [isMobileOpen, setMobileOpen] = useState(false);

  // Close mobile menu on route change
  useEffect(() => { setMobileOpen(false); }, [location.pathname]);

  // Prevent body scroll when mobile menu is open
  useEffect(() => {
    if (isMobile && isMobileOpen) {
      document.body.style.overflow = 'hidden';
    } else {
      document.body.style.overflow = '';
    }
    return () => { document.body.style.overflow = ''; };
  }, [isMobile, isMobileOpen]);

  const menuItems = [
    { path: '/', label: 'Overview', iconKey: 'overview', roles: ['admin', 'ceo', 'seniorCashier', 'juniorCashier', 'storeManager'] },
    { path: '/store/active-orders', label: 'Active Orders', iconKey: 'activeOrders', roles: ['storeManager'] },
    { path: '/sales', label: 'Sales POS', iconKey: 'sales', roles: ['seniorCashier', 'juniorCashier'] },
    { path: '/invoice', label: 'Invoices', iconKey: 'invoice', roles: ['seniorCashier', 'juniorCashier'] },
    { path: '/orders', label: 'Order History', iconKey: 'orders', roles: ['seniorCashier'] },
    { path: '/inventory', label: 'Stock Control', iconKey: 'inventory', roles: ['seniorCashier'] },
    { path: '/add-product', label: 'Add Product', iconKey: 'addProduct', roles: ['admin', 'ceo'] },
    { path: '/manage-products', label: 'Manage Products', iconKey: 'manageProducts', roles: ['admin', 'ceo'] },
  ];

  const filteredItems = menuItems.filter(item => item.roles.includes(user?.role));
  const roleLabel = ROLE_LABELS[user?.role] || user?.role || 'User';
  const initials = (user?.firstName || user?.name || 'U').slice(0, 2).toUpperCase();

  // Sidebar width based on mode
  const sidebarWidth = isMobile
    ? '280px'
    : isTablet
    ? '4.5rem'
    : isSidebarExpanded
    ? '16rem'
    : '4.5rem';

  const showLabels = isMobile || (isDesktop && isSidebarExpanded);

  const handleNavigate = useCallback((path) => {
    navigate(path);
    if (isMobile) setMobileOpen(false);
  }, [navigate, isMobile]);

  const SidebarContent = () => (
    <aside style={{
      width: sidebarWidth,
      height: '100%',
      display: 'flex',
      flexDirection: 'column',
      background: 'rgba(9,14,26,0.98)',
      borderRight: isMobile ? 'none' : '1px solid rgba(255,255,255,0.07)',
      backdropFilter: 'blur(20px)',
      position: 'relative',
      flexShrink: 0,
      overflowY: 'auto',
      overflowX: 'hidden',
    }}>
      {/* Top glow */}
      <div style={{
        position: 'absolute', top: 0, left: 0, right: 0, height: '120px',
        background: 'radial-gradient(ellipse at 50% 0%, rgba(59,130,246,0.12), transparent 70%)',
        pointerEvents: 'none',
      }} />

      {/* Desktop collapse toggle */}
      {isDesktop && (
        <button
          onClick={() => setSidebarExpanded(!isSidebarExpanded)}
          style={{
            position: 'absolute', right: '-12px', top: '2rem',
            width: '24px', height: '24px', borderRadius: '50%',
            background: '#0d1426', border: '1px solid rgba(255,255,255,0.12)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            cursor: 'pointer', zIndex: 10, color: '#64748b',
            transition: 'all 0.2s ease',
            boxShadow: '0 2px 8px rgba(0,0,0,0.4)',
          }}
          onMouseEnter={e => { e.currentTarget.style.color = '#60a5fa'; e.currentTarget.style.borderColor = 'rgba(59,130,246,0.4)'; }}
          onMouseLeave={e => { e.currentTarget.style.color = '#64748b'; e.currentTarget.style.borderColor = 'rgba(255,255,255,0.12)'; }}
        >
          {isSidebarExpanded
            ? <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="15 18 9 12 15 6" /></svg>
            : <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="9 18 15 12 9 6" /></svg>
          }
        </button>
      )}

      {/* Brand / Logo */}
      <div style={{
        height: '4.5rem', display: 'flex', alignItems: 'center',
        padding: showLabels ? '0 1.25rem' : '0',
        justifyContent: showLabels ? 'flex-start' : 'center',
        borderBottom: '1px solid rgba(255,255,255,0.06)', flexShrink: 0,
      }}>
        <div style={{
          width: '36px', height: '36px', flexShrink: 0, borderRadius: '10px',
          background: 'linear-gradient(135deg, #3b82f6, #06b6d4)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          boxShadow: '0 0 16px rgba(59,130,246,0.35)',
          fontSize: '0.75rem', fontWeight: 800, color: '#fff', letterSpacing: '-0.02em',
        }}>EC</div>
        {showLabels && (
          <div style={{ marginLeft: '0.875rem' }}>
            <div style={{ fontSize: '0.9rem', fontWeight: 700, color: '#f1f5f9', letterSpacing: '-0.01em' }}>EmiratesCo</div>
            <div style={{ fontSize: '0.6rem', fontWeight: 600, color: '#3b82f6', letterSpacing: '0.1em', textTransform: 'uppercase' }}>Management</div>
          </div>
        )}
        {/* Mobile close button */}
        {isMobile && (
          <button
            onClick={() => setMobileOpen(false)}
            style={{
              marginLeft: 'auto', width: '32px', height: '32px', borderRadius: '8px',
              background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.1)',
              color: '#64748b', cursor: 'pointer', display: 'flex',
              alignItems: 'center', justifyContent: 'center',
            }}
          >
            <span style={{ width: '18px', height: '18px' }}>{NAV_ICONS.close}</span>
          </button>
        )}
      </div>

      {/* Navigation */}
      <nav style={{ flex: 1, padding: '0.875rem 0.625rem', overflowY: 'auto', overflowX: 'hidden' }} className="scrollbar-hide">
        <div style={{ display: 'flex', flexDirection: 'column', gap: '2px' }}>
          {filteredItems.map((item) => {
            const isActive = location.pathname === item.path;
            return (
              <button
                key={item.path}
                onClick={() => handleNavigate(item.path)}
                title={!showLabels ? item.label : ''}
                style={{
                  display: 'flex', alignItems: 'center', gap: '0.75rem',
                  padding: showLabels ? '0.75rem 0.875rem' : '0.75rem 0',
                  justifyContent: showLabels ? 'flex-start' : 'center',
                  borderRadius: '0.75rem',
                  border: isActive ? '1px solid rgba(59,130,246,0.25)' : '1px solid transparent',
                  background: isActive ? 'rgba(59,130,246,0.1)' : 'transparent',
                  color: isActive ? '#60a5fa' : '#64748b',
                  cursor: 'pointer', fontWeight: 500,
                  fontSize: isMobile ? '0.95rem' : '0.875rem',
                  transition: 'all 0.2s ease', position: 'relative',
                  overflow: 'hidden', width: '100%',
                  boxShadow: isActive ? '0 0 0 1px rgba(59,130,246,0.15), 0 2px 8px rgba(59,130,246,0.12)' : 'none',
                  whiteSpace: 'nowrap',
                  minHeight: isMobile ? '48px' : 'auto',
                }}
                onMouseEnter={e => { if (!isActive) { e.currentTarget.style.background = 'rgba(255,255,255,0.05)'; e.currentTarget.style.color = '#cbd5e1'; } }}
                onMouseLeave={e => { if (!isActive) { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.color = '#64748b'; } }}
              >
                {isActive && (
                  <div style={{
                    position: 'absolute', left: 0, top: '20%', bottom: '20%',
                    width: '3px', borderRadius: '0 2px 2px 0',
                    background: 'linear-gradient(180deg, #3b82f6, #06b6d4)',
                  }} />
                )}
                <span style={{ width: '20px', height: '20px', flexShrink: 0 }}>{NAV_ICONS[item.iconKey]}</span>
                {showLabels && <span style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>{item.label}</span>}
              </button>
            );
          })}
        </div>
      </nav>

      {/* Footer */}
      <div style={{ borderTop: '1px solid rgba(255,255,255,0.06)', padding: '0.75rem 0.625rem', flexShrink: 0 }}>
        {showLabels && (
          <div style={{
            display: 'flex', alignItems: 'center', gap: '0.75rem',
            padding: '0.625rem 0.875rem', marginBottom: '0.5rem',
            borderRadius: '0.75rem',
            background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.06)',
          }}>
            <div style={{
              width: '32px', height: '32px', flexShrink: 0, borderRadius: '50%',
              background: 'linear-gradient(135deg, #3b82f6, #06b6d4)',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              fontSize: '0.7rem', fontWeight: 700, color: '#fff',
            }}>{initials}</div>
            <div style={{ overflow: 'hidden', minWidth: 0 }}>
              <div style={{ fontSize: '0.8rem', fontWeight: 600, color: '#e2e8f0', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {user?.name || user?.firstName || 'User'}
              </div>
              <div style={{ fontSize: '0.65rem', fontWeight: 500, color: '#3b82f6', letterSpacing: '0.04em', textTransform: 'uppercase' }}>
                {roleLabel}
              </div>
            </div>
          </div>
        )}

        <button
          style={{
            display: 'flex', alignItems: 'center', gap: '0.75rem',
            padding: showLabels ? '0.5rem 0.875rem' : '0.5rem 0',
            justifyContent: showLabels ? 'flex-start' : 'center',
            borderRadius: '0.625rem', border: '1px solid transparent',
            background: 'transparent', color: '#475569', cursor: 'pointer',
            fontSize: '0.8rem', fontWeight: 500, width: '100%', transition: 'all 0.2s ease',
            minHeight: isMobile ? '44px' : 'auto',
          }}
          onMouseEnter={e => { e.currentTarget.style.background = 'rgba(255,255,255,0.04)'; e.currentTarget.style.color = '#94a3b8'; }}
          onMouseLeave={e => { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.color = '#475569'; }}
        >
          <span style={{ width: '18px', height: '18px', flexShrink: 0 }}>{NAV_ICONS.settings}</span>
          {showLabels && <span>Settings</span>}
        </button>

        <button
          onClick={logout}
          style={{
            display: 'flex', alignItems: 'center', gap: '0.75rem',
            padding: showLabels ? '0.5rem 0.875rem' : '0.5rem 0',
            justifyContent: showLabels ? 'flex-start' : 'center',
            borderRadius: '0.625rem', border: '1px solid transparent',
            background: 'transparent', color: '#ef4444', cursor: 'pointer',
            fontSize: '0.8rem', fontWeight: 500, width: '100%', transition: 'all 0.2s ease',
            minHeight: isMobile ? '44px' : 'auto',
          }}
          onMouseEnter={e => { e.currentTarget.style.background = 'rgba(239,68,68,0.08)'; e.currentTarget.style.borderColor = 'rgba(239,68,68,0.15)'; }}
          onMouseLeave={e => { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.borderColor = 'transparent'; }}
        >
          <span style={{ width: '18px', height: '18px', flexShrink: 0 }}>{NAV_ICONS.logout}</span>
          {showLabels && <span>Sign Out</span>}
        </button>
      </div>
    </aside>
  );

  return (
    <div style={{ display: 'flex', height: '100dvh', overflow: 'hidden', background: 'var(--color-bg)', flexDirection: 'column' }}>
      <div className="bg-mesh" />

      {/* ── MOBILE TOP BAR ── */}
      {isMobile && (
        <header style={{
          height: '56px', flexShrink: 0,
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          padding: '0 1rem',
          background: 'rgba(9,14,26,0.98)', backdropFilter: 'blur(20px)',
          borderBottom: '1px solid rgba(255,255,255,0.07)',
          zIndex: 50, position: 'relative',
        }}>
          <button
            onClick={() => setMobileOpen(true)}
            style={{
              width: '40px', height: '40px', borderRadius: '10px',
              background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.1)',
              color: '#94a3b8', cursor: 'pointer',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
            }}
          >
            <span style={{ width: '20px', height: '20px' }}>{NAV_ICONS.menu}</span>
          </button>

          <div style={{ display: 'flex', alignItems: 'center', gap: '0.625rem' }}>
            <div style={{
              width: '28px', height: '28px', borderRadius: '8px',
              background: 'linear-gradient(135deg, #3b82f6, #06b6d4)',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              fontSize: '0.65rem', fontWeight: 800, color: '#fff',
            }}>EC</div>
            <span style={{ fontSize: '0.9rem', fontWeight: 700, color: '#f1f5f9' }}>EmiratesCo</span>
          </div>

          <div style={{
            width: '32px', height: '32px', borderRadius: '50%',
            background: 'linear-gradient(135deg, #3b82f6, #06b6d4)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            fontSize: '0.65rem', fontWeight: 700, color: '#fff',
          }}>{initials}</div>
        </header>
      )}

      {/* ── BODY (sidebar + content) ── */}
      <div style={{ flex: 1, display: 'flex', overflow: 'hidden', position: 'relative' }}>

        {/* Mobile overlay backdrop */}
        {isMobile && isMobileOpen && (
          <div
            onClick={() => setMobileOpen(false)}
            style={{
              position: 'fixed', inset: 0, zIndex: 60,
              background: 'rgba(0,0,0,0.6)', backdropFilter: 'blur(4px)',
            }}
          />
        )}

        {/* Sidebar — always in DOM for tablet/desktop; overlay for mobile */}
        {isMobile ? (
          <div style={{
            position: 'fixed', top: 0, left: 0, bottom: 0,
            zIndex: 70, width: '280px',
            transform: isMobileOpen ? 'translateX(0)' : 'translateX(-100%)',
            transition: 'transform 0.3s cubic-bezier(0.4,0,0.2,1)',
            boxShadow: isMobileOpen ? '4px 0 40px rgba(0,0,0,0.6)' : 'none',
          }}>
            <SidebarContent />
          </div>
        ) : (
          <div style={{
            width: sidebarWidth,
            transition: 'width 0.3s cubic-bezier(0.4,0,0.2,1)',
            flexShrink: 0,
            zIndex: 40,
          }}>
            <SidebarContent />
          </div>
        )}

        {/* ── MAIN CONTENT ── */}
        <main style={{
          flex: 1, overflowY: 'auto', overflowX: 'hidden',
          position: 'relative', display: 'flex', flexDirection: 'column',
          minWidth: 0,
        }}>
          <Outlet />
        </main>
      </div>
    </div>
  );
}
