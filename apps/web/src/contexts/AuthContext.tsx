import { createContext, useContext, useState, useEffect, useRef, ReactNode } from 'react';
import { setAccessToken as setInMemoryAccessToken } from '../config/auth-token';
import { apiBaseUrl } from '../config/api';

interface User {
  id: string;
  email: string;
  name: string;
  role: 'ADMIN' | 'RECEPTIONIST';
}

interface RefreshResponse {
  accessToken: string;
  user: User;
}

interface AuthContextType {
  user: User | null;
  accessToken: string | null;
  isAuthenticated: boolean;
  isLoading: boolean;
  login: (email: string, password: string, rememberMe?: boolean) => Promise<void>;
  logout: () => Promise<void>;
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
  const accessTokenRef = useRef<string | null>(null);
  const refreshRequestRef = useRef<Promise<RefreshResponse> | null>(null);
  const logoutInProgressRef = useRef(false);

  const applyAccessToken = (token: string | null) => {
    accessTokenRef.current = token;
    setAccessToken(token);
    setInMemoryAccessToken(token);
  };

  const requestRefresh = () => {
    if (logoutInProgressRef.current) {
      return Promise.reject(new Error('Logout is in progress'));
    }
    if (refreshRequestRef.current) {
      return refreshRequestRef.current;
    }

    const request = (async () => {
      const response = await fetch(`${apiBaseUrl}/auth/refresh`, {
        method: 'POST',
        credentials: 'include',
      });
      if (!response.ok) {
        throw new Error('Failed to refresh token');
      }
      return response.json() as Promise<RefreshResponse>;
    })();

    refreshRequestRef.current = request;
    void request.then(
      () => {
        if (refreshRequestRef.current === request) refreshRequestRef.current = null;
      },
      () => {
        if (refreshRequestRef.current === request) refreshRequestRef.current = null;
      },
    );
    return request;
  };

  const refreshAccessToken = async () => {
    try {
      const data = await requestRefresh();
      if (logoutInProgressRef.current) return;
      setUser(data.user);
      applyAccessToken(data.accessToken);
    } catch (error) {
      if (!logoutInProgressRef.current) {
        clearRefreshTimer();
        setUser(null);
        applyAccessToken(null);
      }
      throw error;
    }
  };

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
        await refreshAccessToken();
        if (!logoutInProgressRef.current && accessTokenRef.current) startRefreshTimer();
      } catch {
        // refreshAccessToken clears auth state when recovery fails.
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

    logoutInProgressRef.current = false;
    setUser(data.user);
    applyAccessToken(data.accessToken);
    startRefreshTimer();
  };

  const logout = async () => {
    if (logoutInProgressRef.current) return;
    logoutInProgressRef.current = true;
    clearRefreshTimer();

    let tokenToRevoke = accessTokenRef.current;
    const pendingRefresh = refreshRequestRef.current;
    if (pendingRefresh) {
      try {
        const refreshed = await pendingRefresh;
        tokenToRevoke = refreshed.accessToken;
      } catch {
        // Continue with the current access token; the refresh cookie may still be valid.
      }
    }

    try {
      const response = await fetch(`${apiBaseUrl}/auth/logout`, {
        method: 'POST',
        credentials: 'include',
        headers: tokenToRevoke ? { Authorization: `Bearer ${tokenToRevoke}` } : {},
      });
      if (!response.ok) {
        throw new Error('Failed to invalidate the server session');
      }
    } finally {
      setUser(null);
      applyAccessToken(null);
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
