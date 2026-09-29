'use client';

/**
 * Client-side auth provider.
 *
 * - Holds the in-memory token session in a ref owned by this browser tab.
 * - Private user data lives only in React state on the client; it is never
 *   rendered on the server (SSR sees `status: 'loading'` with no user).
 * - On page reload the provider starts empty → sign-in is required again.
 * - No cookies, no storage, no URL state, no cross-tab sharing.
 */

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode
} from 'react';
import { useRouter } from 'next/navigation';
import { createAuthSession, type AuthSession, type TokenPair } from './session';
import { apiFetch } from '@/lib/api/client';

export interface SessionUser {
  id: string;
  email: string;
  displayName: string;
  timezone: string;
  locale: string;
  weekStart: number;
  defaultCurrency: string;
  pushShowTitles: boolean;
  status: 'active' | 'disabled' | 'pending_deletion';
  emailVerified: boolean;
  createdAt: string;
}

export type AuthStatus = 'loading' | 'authenticated' | 'anonymous';

export interface AuthContextValue {
  status: AuthStatus;
  user: SessionUser | null;
  session: AuthSession;
  signIn: (tokens: TokenPair, user: SessionUser) => void;
  signOut: () => Promise<void>;
  signOutAllDevices: () => Promise<void>;
  replaceUser: (user: SessionUser) => void;
  refreshUser: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const router = useRouter();
  const [status, setStatus] = useState<AuthStatus>('loading');
  const [user, setUser] = useState<SessionUser | null>(null);
  const routerRef = useRef(router);
  routerRef.current = router;

  const sessionRef = useRef<AuthSession | null>(null);
  if (sessionRef.current === null) {
    sessionRef.current = createAuthSession({
      onSessionLost: () => {
        // Tokens were already cleared inside the session. Drop user data and
        // send the user back to sign-in.
        setUser(null);
        setStatus('anonymous');
        const path = routerRef.current;
        path.replace('/login');
      }
    });
  }
  const session = sessionRef.current;

  useEffect(() => {
    // Memory-only tokens are never restored after a reload — mark the session
    // as anonymous once mounted. (Intentional: reload ⇒ sign in again.)
    setStatus((current) => (current === 'loading' ? 'anonymous' : current));
  }, []);

  const signIn = useCallback(
    (tokens: TokenPair, nextUser: SessionUser) => {
      session.setTokens(tokens);
      setUser(nextUser);
      setStatus('authenticated');
    },
    [session]
  );

  const signOut = useCallback(async () => {
    // Attempt backend revocation first; local credentials are cleared either way.
    try {
      if (session.isAccessTokenExpired()) {
        await session.refreshAccessToken();
      }
      const refreshToken = session.getRefreshToken();
      await rawLogout(session, refreshToken ?? undefined);
    } catch {
      // Revocation failure must not trap the user in a signed-in UI.
    } finally {
      session.clear();
      setUser(null);
      setStatus('anonymous');
      routerRef.current.replace('/login');
    }
  }, [session]);

  const signOutAllDevices = useCallback(async () => {
    await apiFetch<void>('/auth/logout-all', { method: 'POST', auth: session });
    session.clear();
    setUser(null);
    setStatus('anonymous');
    routerRef.current.replace('/login');
  }, [session]);

  const replaceUser = useCallback((next: SessionUser) => {
    setUser(next);
  }, []);

  const refreshUser = useCallback(async () => {
    const result = await apiFetch<{ user: SessionUser }>('/users/me', { auth: session });
    setUser(result.user);
  }, [session]);

  const value = useMemo<AuthContextValue>(
    () => ({ status, user, session, signIn, signOut, signOutAllDevices, replaceUser, refreshUser }),
    [status, user, session, signIn, signOut, signOutAllDevices, replaceUser, refreshUser]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

async function rawLogout(session: AuthSession, refreshToken?: string): Promise<void> {
  const { rawApiFetch } = await import('@/lib/api/client');
  const token = session.getAccessToken();
  await rawApiFetch<void>('/auth/logout', {
    method: 'POST',
    ...(token ? { headers: { Authorization: `Bearer ${token}` } } : {}),
    body: refreshToken ? { refreshToken } : {},
    auth: undefined
  });
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) {
    throw new Error('useAuth must be used within AuthProvider');
  }
  return ctx;
}
