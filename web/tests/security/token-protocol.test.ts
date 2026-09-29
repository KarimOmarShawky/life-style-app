/**
 * Security suite: token storage, token transport, redirects, logging.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { apiFetch } from '@/lib/api/client';
import { createAuthSession, type AuthSession } from '@/lib/auth/session';
import { tokenPairFixture } from '../fixtures/dto';

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' }
  });
}

let fetchMock: ReturnType<typeof vi.fn>;
let session: AuthSession;

beforeEach(() => {
  fetchMock = vi.fn().mockResolvedValue(jsonResponse(200, { ok: true }));
  vi.stubGlobal('fetch', fetchMock);
  session = createAuthSession({ onSessionLost: vi.fn() });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('tokens never leave memory', () => {
  it('setTokens writes nothing to localStorage / sessionStorage / cookies', () => {
    session.setTokens(tokenPairFixture);
    expect(session.getAccessToken()).toBe(tokenPairFixture.accessToken);

    expect(window.localStorage.length).toBe(0);
    expect(window.sessionStorage.length).toBe(0);
    expect(document.cookie).toBe('');
    expect(
      JSON.stringify({
        ls: { ...window.localStorage },
        ss: { ...window.sessionStorage }
      })
    ).toBe('{"ls":{},"ss":{}}');
  });

  it('clear()/endSession() remove tokens from memory entirely', () => {
    session.setTokens(tokenPairFixture);
    session.clear();
    expect(session.getAccessToken()).toBeNull();
    expect(session.getRefreshToken()).toBeNull();
  });
});

describe('token transport rules', () => {
  it('sends the access token only as an Authorization header on a relative URL', async () => {
    session.setTokens(tokenPairFixture);
    await apiFetch('/tasks', { query: { limit: 25 }, auth: session });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url.startsWith('/api/v1/')).toBe(true);
    expect(url).not.toContain(tokenPairFixture.accessToken);
    expect(url).not.toContain(tokenPairFixture.refreshToken);
    expect(url).not.toMatch(/access_token|refresh_token|token=/i);
    const headers = init.headers as Record<string, string>;
    expect(headers.Authorization).toBe(`Bearer ${tokenPairFixture.accessToken}`);
  });

  it('keeps the refresh token in the request body only', async () => {
    session.setTokens(tokenPairFixture);
    await session.refreshAccessToken();
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).not.toContain(tokenPairFixture.refreshToken);
    expect(String(init.body)).toContain(tokenPairFixture.refreshToken);
  });

  it('uses redirect:"manual" on every authenticated request', async () => {
    session.setTokens(tokenPairFixture);
    await apiFetch('/tasks', { auth: session });
    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(init.redirect).toBe('manual');
  });

  it('turns any 3xx response into a blocked-redirect error (credentials never followed)', async () => {
    session.setTokens(tokenPairFixture);
    fetchMock.mockResolvedValue(
      new Response(null, { status: 302, headers: { Location: 'https://evil.example' } })
    );
    await expect(apiFetch('/tasks', { auth: session })).rejects.toMatchObject({
      kind: 'redirect'
    });
  });
});

describe('no credential logging', () => {
  it('never prints tokens to the console during a full auth-retry flow', async () => {
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    const infoSpy = vi.spyOn(console, 'info').mockImplementation(() => {});
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const debugSpy = vi.spyOn(console, 'debug').mockImplementation(() => {});

    session.setTokens(tokenPairFixture);
    fetchMock
      .mockResolvedValueOnce(
        jsonResponse(401, {
          success: false,
          error: { code: 'TOKEN_EXPIRED', message: 'expired', requestId: 'r' }
        })
      )
      .mockResolvedValueOnce(
        jsonResponse(200, { ...tokenPairFixture, accessToken: 'rotated', refreshToken: 'r2' })
      )
      .mockResolvedValueOnce(jsonResponse(200, { ok: true }));

    await apiFetch('/tasks', { auth: session });
    await session.refreshAccessToken().catch(() => {});

    const allCalls = [logSpy, infoSpy, warnSpy, errorSpy, debugSpy]
      .flatMap((spy) => spy.mock.calls)
      .flat()
      .map((value) => String(value))
      .join(' ');
    expect(allCalls).not.toContain(tokenPairFixture.accessToken);
    expect(allCalls).not.toContain(tokenPairFixture.refreshToken);
    expect(allCalls).not.toContain('rotated');
  });
});
