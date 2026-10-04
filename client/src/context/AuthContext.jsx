// @refresh reset
import { createContext, useState, useContext, useEffect, useCallback, useRef } from 'react';
import api from '../services/api';

const AuthContext = createContext(null);

// Who the saved cart belongs to. A session can end without "Sign Out" (expired token,
// deactivated account) and the cart is kept for that person — but the next person to sign
// in on the till must not inherit someone else's cart or edit in progress.
const CART_OWNER_KEY = 'emirates_pos_cart_owner';
const CART_KEYS = ['emirates_pos_cart', 'emirates_pos_customer', 'emirates_pos_session_type',
    'emirates_pos_edit_session', 'emirates_pos_linked_ref'];

const clearSavedCart = () => {
  CART_KEYS.forEach(k => localStorage.removeItem(k));
  // Stock Control sessions in progress (saved per user) go with the person too.
  Object.keys(localStorage).filter(k => k.startsWith('emirates_pos_stock_cart_')).forEach(k => localStorage.removeItem(k));
  localStorage.removeItem(CART_OWNER_KEY);
  // CartContext empties its in-memory state on this event.
  window.dispatchEvent(new Event('pos:logout'));
};

export const AuthProvider = ({ children }) => {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);
  // The server couldn't be reached while checking a saved session (network down, server
  // restarting during a failover switch). Not a reason to sign the till out.
  const [unreachable, setUnreachable] = useState(false);
  const retryRef = useRef({ timer: null, delay: 3000 });

  // Session over (expired, deactivated, user gone): back to the login screen, cart kept.
  const expireSession = useCallback(() => {
    localStorage.removeItem('token');
    setUnreachable(false);
    setUser(null);
  }, []);

  const fetchUser = useCallback(async () => {
    try {
      // 1. Validate Token & Get ID
      const { userId } = await api.userService.getMe();
      // 2. Fetch Full Profile
      const userData = await api.userService.getUser(userId);
      const owner = localStorage.getItem(CART_OWNER_KEY);
      if (owner && owner !== String(userData.userId)) clearSavedCart();
      localStorage.setItem(CART_OWNER_KEY, String(userData.userId));
      clearTimeout(retryRef.current.timer);
      retryRef.current.delay = 3000;
      setUnreachable(false);
      setUser(userData);
    } catch (error) {
      const status = error?.response?.status;
      if (status === 401 || status === 404) {
        // The token is no good or the account no longer exists.
        expireSession();
      } else if (!localStorage.getItem('token')) {
        expireSession();
      } else {
        // Network failure or a 5xx: keep the token (and the cart) and try again shortly.
        console.error("Auth check failed, will retry:", status ?? error?.message);
        setUnreachable(true);
        clearTimeout(retryRef.current.timer);
        retryRef.current.timer = setTimeout(() => { fetchUser(); }, retryRef.current.delay);
        retryRef.current.delay = Math.min(retryRef.current.delay * 2, 30000);
      }
    } finally {
      setLoading(false);
    }
  }, [expireSession]);

  useEffect(() => {
    const token = localStorage.getItem('token');
    if (token) {
      fetchUser();
    } else {
      setLoading(false);
    }
    const timers = retryRef.current;
    return () => clearTimeout(timers.timer);
  }, [fetchUser]);

  // api.js raises this when a request comes back 401 mid-session.
  useEffect(() => {
    const onExpired = () => expireSession();
    window.addEventListener('pos:session-expired', onExpired);
    return () => window.removeEventListener('pos:session-expired', onExpired);
  }, [expireSession]);

  const login = async (username, password) => {
    try {
      const response = await api.userService.login({ username: username, password: password });

      if (response.access_token) {
        localStorage.setItem('token', response.access_token);
        await fetchUser();
        // fetchUser clears the token itself if the account check fails.
        return !!localStorage.getItem('token');
      }
      return false;
    } catch (error) {
      // Not the error object itself: its request config holds the password in plain text.
      console.error("Login failed:", error?.response?.status ?? error?.message);
      throw error; // Let Login page handle the error message
    }
  };

  // "Sign Out": the person is done, so their cart and any edit in progress go too.
  const logout = () => {
    localStorage.removeItem('token');
    clearSavedCart();
    setUnreachable(false);
    setUser(null);
  };

  if (unreachable && !user) {
    return (
      <div style={{
        minHeight: '100vh', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
        gap: '0.75rem', padding: '1rem', background: '#090e1a', color: '#cbd5e1', textAlign: 'center',
      }}>
        <p style={{ margin: 0, fontSize: '1.05rem', fontWeight: 700, color: '#f1f5f9' }}>Can't reach the server</p>
        <p style={{ margin: 0, fontSize: '0.85rem', maxWidth: '420px' }}>
          You are still signed in and your cart is saved. Retrying automatically…
        </p>
        <button onClick={() => fetchUser()} style={{
          marginTop: '0.5rem', padding: '0.6rem 1.25rem', borderRadius: '0.6rem', border: 'none',
          background: '#3b82f6', color: '#fff', fontWeight: 600, cursor: 'pointer',
        }}>Retry now</button>
        <button onClick={logout} style={{ background: 'none', border: 'none', color: '#64748b', fontSize: '0.8rem', cursor: 'pointer' }}>
          Sign out instead
        </button>
      </div>
    );
  }

  return (
    <AuthContext.Provider value={{ user, login, logout, loading, refreshUser: fetchUser }}>
      {!loading && children}
    </AuthContext.Provider>
  );
};

export const useAuth = () => {
  return useContext(AuthContext);
};
