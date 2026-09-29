/**
 * Single typed API client for the LifeStyle backend.
 *
 * Rules enforced here (browser security):
 * - All requests use relative same-origin `/api/v1/...` URLs; the Next.js
 *   server rewrites them to the server-only `BACKEND_INTERNAL_URL`. No
 *   localhost or backend host is ever present in browser code.
 * - Bearer access tokens travel only in the `Authorization` header — never in
 *   URLs, query strings, or fragments.
 * - Redirects are never followed (`redirect: 'manual'`), so credentials are
 *   never forwarded to another destination.
 * - Access-token expiry (`TOKEN_EXPIRED` code only) triggers a single-flight
 *   refresh; other 401s never refresh. A request is retried at most once.
 * - Request timeouts produce retryable, user-safe network errors.
 */

import { ApiError, parseErrorResponse } from './errors';
import type { AuthSession } from '@/lib/auth/session';

export const API_BASE_PATH = '/api/v1';
export const DEFAULT_TIMEOUT_MS = 15_000;

export type HttpMethod = 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE';

export type QueryValue = string | number | boolean | undefined | null;

export interface RequestOptions {
  method?: HttpMethod;
  query?: Record<string, QueryValue>;
  /** JSON request body (already shaped to the verified backend contract). */
  body?: unknown;
  headers?: Record<string, string>;
  /** Required by the backend for transaction creation and subscription payment. */
  idempotencyKey?: string;
  /** In-memory auth session; enables bearer attachment and expiry handling. */
  auth?: AuthSession;
  timeoutMs?: number;
}

interface InternalState {
  tokenUsed: string | null;
  retried: boolean;
}

function buildUrl(path: string, query?: Record<string, QueryValue>): string {
  const qs = new URLSearchParams();
  if (query) {
    for (const [key, value] of Object.entries(query)) {
      if (value === undefined || value === null || value === '') continue;
      qs.set(key, String(value));
    }
  }
  const suffix = qs.toString();
  return suffix ? `${API_BASE_PATH}${path}?${suffix}` : `${API_BASE_PATH}${path}`;
}

async function readBody(res: Response): Promise<unknown> {
  if (res.status === 204 || res.status === 205) return undefined;
  const text = await res.text();
  if (!text) return undefined;
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return undefined;
  }
}

async function execute<T>(path: string, options: RequestOptions, state: InternalState): Promise<T> {
  const method = options.method ?? 'GET';
  const url = buildUrl(path, options.query);

  const headers: Record<string, string> = {
    Accept: 'application/json',
    ...options.headers
  };

  let payload: string | undefined;
  if (options.body !== undefined) {
    payload = JSON.stringify(options.body);
    headers['Content-Type'] = 'application/json';
  }
  if (options.idempotencyKey) {
    headers['Idempotency-Key'] = options.idempotencyKey;
  }

  const auth = options.auth;
  const token = auth ? auth.getAccessToken() : null;
  if (token) {
    headers.Authorization = `Bearer ${token}`;
    state.tokenUsed = token;
  }

  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  let res: Response;
  try {
    res = await fetch(url, {
      method,
      headers,
      body: payload,
      // Never follow redirects: bearer credentials must not reach another host.
      redirect: 'manual',
      cache: 'no-store',
      signal: controller.signal
    });
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') {
      throw new ApiError({ kind: 'timeout' });
    }
    throw new ApiError({ kind: 'network' });
  } finally {
    clearTimeout(timer);
  }

  // `redirect: 'manual'` surfaces opaque redirects in browsers; treat any 3xx
  // as a blocked security condition (we never follow it).
  if (res.type === 'opaqueredirect' || (res.status >= 300 && res.status < 400)) {
    throw new ApiError({ kind: 'redirect' });
  }

  const body = await readBody(res);

  if (res.ok) {
    return body as T;
  }

  const requestId = res.headers.get('X-Request-Id');
  throw parseErrorResponse(res.status, body, requestId);
}

async function executeWithAuthRetry<T>(
  path: string,
  options: RequestOptions,
  state: InternalState
): Promise<T> {
  try {
    return await execute<T>(path, options, state);
  } catch (error) {
    const apiError = error instanceof ApiError ? error : new ApiError({ kind: 'network' });
    const auth = options.auth;

    if (!auth || state.retried) throw apiError;

    if (apiError.code === 'TOKEN_EXPIRED') {
      const current = auth.getAccessToken();
      if (current && state.tokenUsed && current !== state.tokenUsed) {
        // Another in-flight request already rotated the token while this 401
        // was travelling: reuse the newer in-memory access token — never
        // submit the old refresh token again.
        state.retried = true;
        return execute<T>(path, options, state);
      }
      const fresh = await auth.refreshAccessToken();
      if (fresh) {
        state.retried = true;
        return execute<T>(path, options, state);
      }
      // Refresh failed or its outcome was uncertain: session was cleared.
      throw new ApiError({
        kind: 'http',
        status: 401,
        code: 'INVALID_REFRESH_TOKEN',
        requestId: apiError.requestId
      });
    }

    if (apiError.code === 'UNAUTHENTICATED' && state.tokenUsed) {
      // Session revoked server-side: end the local session (no refresh attempt).
      auth.endSession();
    }

    throw apiError;
  }
}

/**
 * Perform an API request. Feature code must use this (or feature wrappers
 * around it) — never call `fetch` directly.
 */
export async function apiFetch<T>(path: string, options: RequestOptions = {}): Promise<T> {
  return executeWithAuthRetry<T>(path, options, { tokenUsed: null, retried: false });
}

/**
 * Low-level request without auth retry/refresh semantics. Used only for the
 * refresh call itself (which carries the refresh token in its body) and for
 * pre-authentication endpoints.
 */
export async function rawApiFetch<T>(path: string, options: RequestOptions = {}): Promise<T> {
  return execute<T>(path, options, { tokenUsed: null, retried: false });
}
