import React, { createContext, useCallback, useContext, useEffect, useState } from "react";
import { api } from "../api";
import { clearStoredToken, getStoredToken, setStoredToken } from "../api";

export interface User {
  id: string;
  email: string;
  displayName: string;
  createdAt: string;
}

interface AuthState {
  user: User | null;
  loading: boolean;
  error: string | null;
}

interface AuthContextValue extends AuthState {
  login: (email: string, password: string) => Promise<void>;
  register: (email: string, password: string, displayName: string) => Promise<void>;
  logout: () => void;
  clearError: () => void;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const clearError = useCallback(() => setError(null), []);

  const logout = useCallback(() => {
    clearStoredToken();
    setUser(null);
  }, []);

  const register = useCallback(
    async (email: string, password: string, displayName: string) => {
      setError(null);
      try {
        const { data } = await api.post<{ user: User; token: string }>("/auth/register", {
          email,
          password,
          displayName,
        });
        setStoredToken(data.token);
        setUser(data.user);
      } catch (err) {
        const msg =
          (err as { response?: { data?: { error?: string } } })?.response?.data?.error ||
          (err as Error)?.message ||
          "Something went wrong";
        setError(msg);
        throw err;
      }
    },
    []
  );

  const login = useCallback(async (email: string, password: string) => {
    setError(null);
    try {
      const { data } = await api.post<{ user: User; token: string }>("/auth/login", {
        email,
        password,
      });
      setStoredToken(data.token);
      setUser(data.user);
    } catch (err) {
      const msg =
        (err as { response?: { data?: { error?: string } } })?.response?.data?.error ||
        (err as Error)?.message ||
        "Something went wrong";
      setError(msg);
      throw err;
    }
  }, []);

  useEffect(() => {
    const token = getStoredToken();
    if (!token) {
      setLoading(false);
      return;
    }
    api
      .get<{ user: User }>("/auth/me")
      .then((res) => setUser(res.data.user))
      .catch(() => {
        clearStoredToken();
        setUser(null);
      })
      .finally(() => setLoading(false));
  }, []);

  const value: AuthContextValue = {
    user,
    loading,
    error,
    login,
    register,
    logout,
    clearError,
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}
