/**
 * In-memory authentication session (browser tab scope).
 *
 * MANDATORY security properties:
 * - Access + refresh tokens live only in this closure, referenced from a React
 *   provider ref. They are never written to cookies, localStorage,
 *   sessionStorage, IndexedDB, URLs, logs, analytics, or error reports.
 * - Nothing here is a server module singleton: an instance is created inside
 *   the client-side AuthProvider for the current tab only. SSR never holds
 *   tokens because instances only ever receive tokens after a browser login.
 * - A page reload discards the instance → the user must sign in again
 *   (intentional).
 * - Refresh is single-flight: concurrent expired requests share one refresh
 *   call so the rotating refresh token is consumed exactly once.
 * - Rotation failures (or uncertain outcomes) clear everything and notify the
 *   app to return the user to sign-in. A possibly-rotated refresh token is
 *   never retried.
 */

import { rawApiFetch } from '@/lib/api/client';

export interface TokenPair {
  accessToken: string;
  accessTokenExpiresAt: string;
  refreshToken: string;
  refreshTokenExpiresAt: string;
}

/** Refresh this long before the server-reported expiry to avoid edge races. */
const EXPIRY_LEEWAY_MS = 30_000;

export interface AuthSession {
  getAccessToken(): string | null;
  getRefreshToken(): string | null;
  setTokens(tokens: TokenPair): void;
  /** True when the access token is absent or within the expiry leeway. */
  isAccessTokenExpired(): boolean;
  /**
   * Single-flight refresh. Resolves with a fresh access token, or null when
   * the session could not be refreshed (tokens are then cleared and the
   * session-lost callback fires).
   */
  refreshAccessToken(): Promise<string | null>;
  /** Clear all in-memory credentials without notifying (local cleanup). */
  clear(): void;
  /** Clear credentials and notify the provider to return to sign-in. */
  endSession(): void;
}

export interface AuthSessionCallbacks {
  /** Invoked whenever the session must end (rotation failure / revocation). */
  onSessionLost: () => void;
}

export function createAuthSession(callbacks: AuthSessionCallbacks): AuthSession {
  let tokens: TokenPair | null = null;
  let refreshInFlight: Promise<string | null> | null = null;
  let expiryMs: number | null = null;

  function parseExpiry(value: string): number | null {
    const ms = Date.parse(value);
    return Number.isNaN(ms) ? null : ms;
  }

  function clear(): void {
    tokens = null;
    expiryMs = null;
  }

  function endSession(): void {
    clear();
    callbacks.onSessionLost();
  }

  async function refreshAccessToken(): Promise<string | null> {
    const current = tokens;
    if (!current) return null;

    if (refreshInFlight) return refreshInFlight;

    refreshInFlight = (async () => {
      try {
        // Refresh token travels ONLY in the documented request body.
        const next = await rawApiFetch<TokenPair>('/auth/refresh', {
          method: 'POST',
          body: { refreshToken: current.refreshToken },
          timeoutMs: 15_000
        });
        if (
          !next ||
          typeof next.accessToken !== 'string' ||
          typeof next.refreshToken !== 'string'
        ) {
          throw new Error('Malformed refresh response');
        }
        tokens = next;
        expiryMs = parseExpiry(next.accessTokenExpiresAt);
        return next.accessToken;
      } catch {
        // Rotation failed or its outcome is uncertain. The old refresh token
        // may already have been consumed — never retry it. Drop everything.
        clear();
        callbacks.onSessionLost();
        return null;
      } finally {
        refreshInFlight = null;
      }
    })();

    return refreshInFlight;
  }

  return {
    getAccessToken: () => tokens?.accessToken ?? null,
    getRefreshToken: () => tokens?.refreshToken ?? null,
    setTokens(next: TokenPair) {
      tokens = next;
      expiryMs = parseExpiry(next.accessTokenExpiresAt);
    },
    isAccessTokenExpired() {
      if (!tokens || expiryMs === null) return true;
      return Date.now() >= expiryMs - EXPIRY_LEEWAY_MS;
    },
    refreshAccessToken,
    clear,
    endSession
  };
}
