import { createContext, useState, useContext, useEffect } from 'react';
import api from '../services/api';

const AuthContext = createContext(null);

export const AuthProvider = ({ children }) => {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);

  const fetchUser = async () => {
    try {
      // 1. Validate Token & Get ID
      const { userId } = await api.userService.getMe();
      // 2. Fetch Full Profile
      const userData = await api.userService.getUser(userId); // Assuming this returns the User object
      setUser(userData);
    } catch (error) {
      console.error("Auth Check Failed:", error);
      logout();
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    const token = localStorage.getItem('token');
    if (token) {
      fetchUser();
    } else {
      setLoading(false);
    }
  }, []);

  const login = async (username, password) => {
    try {
      // api.userService.login expects { email, password } but forces 'username' param.
      // We pass identifier (email or username) as 'email' property to match the service signature
      // Backend now accepts username in the 'username' (mapped from email) field.
      const response = await api.userService.login({ username: username, password: password });

      if (response.access_token) {
        localStorage.setItem('token', response.access_token);
        await fetchUser();
        return true;
      }
      return false;
    } catch (error) {
      console.error("Login Error:", error);
      throw error; // Let Login page handle the error message
    }
  };

  const logout = () => {
    localStorage.removeItem('token');
    setUser(null);
  };

  const updateUserRole = (role) => {
    // Logic for local updates if needed, though usually server-driven
    if (user) {
      setUser({ ...user, role });
    }
  };

  return (
    <AuthContext.Provider value={{ user, login, logout, updateUserRole, loading }}>
      {!loading && children}
    </AuthContext.Provider>
  );
};

export const useAuth = () => {
  return useContext(AuthContext);
};
