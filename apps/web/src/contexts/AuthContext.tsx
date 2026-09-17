import { createContext, useContext, useState, useEffect, useRef, ReactNode } from 'react';
import { setAccessToken as setInMemoryAccessToken } from '../config/auth-token';
import { apiBaseUrl } from '../config/api';

interface User {
  id: string;
  email: string;
  name: string;
  role: 'ADMIN' | 'RECEPTIONIST';
}

interface AuthContextType {
  user: User | null;
  accessToken: string | null;
  isAuthenticated: boolean;
  isLoading: boolean;
  login: (email: string, password: string, rememberMe?: boolean) => Promise<void>;
  logout: () => void;
  refreshAccessToken: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

// The access token itself is good for 15 minutes (see auth.service.ts on
// the backend: expiresIn: '15m'). Refreshing every 13 minutes renews it
// with 2 minutes of headroom, so a request never lands in that last-second
// gap between "about to expire" and "actually expired".
const REFRESH_INTERVAL_MS = 13 * 60 * 1000;

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [accessToken, setAccessToken] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const refreshTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const clearRefreshTimer = () => {
    if (refreshTimerRef.current) {
      clearInterval(refreshTimerRef.current);
      refreshTimerRef.current = null;
    }
  };

  const startRefreshTimer = () => {
    clearRefreshTimer();
    refreshTimerRef.current = setInterval(() => {
      refreshAccessToken().catch(() => {
        // refreshAccessToken already clears auth state on failure — nothing
        // else to do here besides letting the interval stop itself.
        clearRefreshTimer();
      });
    }, REFRESH_INTERVAL_MS);
  };

  useEffect(() => {
    // On mount, try to refresh the session using the refresh token cookie.
    // This recovers the session without needing localStorage for accessToken.
    const recoverSession = async () => {
      try {
        const response = await fetch(`${apiBaseUrl}/auth/refresh`, {
          method: 'POST',
          credentials: 'include',
        });

        if (response.ok) {
          const data = await response.json();
          setUser(data.user);
          setAccessToken(data.accessToken);
          setInMemoryAccessToken(data.accessToken);
          startRefreshTimer();
        } else {
          setUser(null);
          setAccessToken(null);
          setInMemoryAccessToken(null);
        }
      } catch (error) {
        console.error('Session recovery failed:', error);
        setUser(null);
        setAccessToken(null);
        setInMemoryAccessToken(null);
      } finally {
        setIsLoading(false);
      }
    };

    recoverSession();

    // Stop the timer if the component unmounts (e.g. hot reload in dev).
    return () => clearRefreshTimer();
  }, []);

  const login = async (email: string, password: string, rememberMe = false) => {
    const response = await fetch(`${apiBaseUrl}/auth/login`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      credentials: 'include',
      body: JSON.stringify({ email, password, rememberMe }),
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({ message: 'البريد الإلكتروني أو كلمة المرور غير صحيحة' }));
      const error = new Error(errorData.message || 'البريد الإلكتروني أو كلمة المرور غير صحيحة') as Error & { status?: number };
      error.status = response.status;
      throw error;
    }

    const data = await response.json();

    setUser(data.user);
    setAccessToken(data.accessToken);
    setInMemoryAccessToken(data.accessToken);
    startRefreshTimer();
  };

  const logout = async () => {
    clearRefreshTimer();
    try {
      await fetch(`${apiBaseUrl}/auth/logout`, {
        method: 'POST',
        credentials: 'include',
      });
    } catch {
      // Ignore logout errors
    } finally {
      setUser(null);
      setAccessToken(null);
      setInMemoryAccessToken(null);
    }
  };

  const refreshAccessToken = async () => {
    try {
      const response = await fetch(`${apiBaseUrl}/auth/refresh`, {
        method: 'POST',
        credentials: 'include',
      });

      if (!response.ok) {
        throw new Error('Failed to refresh token');
      }

      const data = await response.json();

      setAccessToken(data.accessToken);
      if (data.user) {
        setUser(data.user);
      }
      setInMemoryAccessToken(data.accessToken);
    } catch (error) {
      clearRefreshTimer();
      setUser(null);
      setAccessToken(null);
      setInMemoryAccessToken(null);
      throw error;
    }
  };

  const value: AuthContextType = {
    user,
    accessToken,
    isAuthenticated: !!user,
    isLoading,
    login,
    logout,
    refreshAccessToken,
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
}
