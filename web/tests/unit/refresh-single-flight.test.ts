import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { apiFetch } from '@/lib/api/client';
import { createAuthSession, type AuthSession, type TokenPair } from '@/lib/auth/session';
import { envelopeError, tokenPairFixture } from '../fixtures/dto';

function jsonResponse(status: number, body: unknown, requestId = 'req-1'): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', 'X-Request-Id': requestId }
  });
}

function expiredResponse(): Response {
  return jsonResponse(401, JSON.parse(envelopeError('TOKEN_EXPIRED', 'access token expired')));
}

function okResponse(): Response {
  return jsonResponse(200, { ok: true });
}

let fetchMock: ReturnType<typeof vi.fn>;
let sessionLost: ReturnType<typeof vi.fn>;
let session: AuthSession;

beforeEach(() => {
  fetchMock = vi.fn();
  vi.stubGlobal('fetch', fetchMock);
  sessionLost = vi.fn();
  session = createAuthSession({ onSessionLost: sessionLost });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('session — single-flight refresh (explicit TOKEN_EXPIRED only)', () => {
  it('shares one refresh across concurrent callers', async () => {
    session.setTokens(tokenPairFixture);
    const rotated: TokenPair = {
      ...tokenPairFixture,
      accessToken: 'rotated-1',
      refreshToken: 'r2'
    };
    let resolveRefresh!: (r: Response) => void;
    fetchMock.mockImplementation(
      () =>
        new Promise<Response>((resolve) => {
          resolveRefresh = resolve;
        })
    );

    const a = session.refreshAccessToken();
    const b = session.refreshAccessToken();
    resolveRefresh(jsonResponse(200, rotated));

    expect(await a).toBe('rotated-1');
    expect(await b).toBe('rotated-1');
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(String(init.body)).toContain('refresh-token-value');
    expect(fetchMock.mock.calls[0]![0]).not.toContain('refresh-token-value');
  });

  it('clears everything and notifies on rotation failure — never retries the same token', async () => {
    session.setTokens(tokenPairFixture);
    fetchMock.mockRejectedValueOnce(new TypeError('network down'));

    const result = await session.refreshAccessToken();
    expect(result).toBeNull();
    expect(sessionLost).toHaveBeenCalledTimes(1);
    expect(session.getAccessToken()).toBeNull();
    expect(session.getRefreshToken()).toBeNull();

    // A second refresh attempt must not hit the network again with the
    // possibly-consumed refresh token — there is nothing left in memory.
    const again = await session.refreshAccessToken();
    expect(again).toBeNull();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('treats a malformed refresh body as a failed rotation', async () => {
    session.setTokens(tokenPairFixture);
    fetchMock.mockResolvedValueOnce(jsonResponse(200, { nonsense: true }));
    expect(await session.refreshAccessToken()).toBeNull();
    expect(sessionLost).toHaveBeenCalled();
  });
});

describe('apiFetch — TOKEN_EXPIRED handling', () => {
  it('refreshes once and retries the original request exactly once', async () => {
    session.setTokens(tokenPairFixture);
    fetchMock
      .mockResolvedValueOnce(expiredResponse())
      .mockResolvedValueOnce(
        jsonResponse(200, { ...tokenPairFixture, accessToken: 'rotated-2', refreshToken: 'r3' })
      )
      .mockResolvedValueOnce(okResponse());

    const result = await apiFetch<{ ok: boolean }>('/tasks', { auth: session });
    expect(result).toEqual({ ok: true });
    expect(fetchMock).toHaveBeenCalledTimes(3);
    const [, retryInit] = fetchMock.mock.calls[2] as [string, RequestInit];
    expect((retryInit.headers as Record<string, string>).Authorization).toBe('Bearer rotated-2');
  });

  it('coalesces parallel TOKEN_EXPIRED failures into ONE refresh', async () => {
    session.setTokens(tokenPairFixture);
    let dataCalls = 0;
    fetchMock.mockImplementation((url: string) => {
      if (String(url).includes('/auth/refresh')) {
        return Promise.resolve(
          jsonResponse(200, { ...tokenPairFixture, accessToken: 'rotated-4', refreshToken: 'r5' })
        );
      }
      dataCalls += 1;
      // First wave: both parallel requests expire; after refresh: succeed.
      return Promise.resolve(dataCalls <= 2 ? expiredResponse() : okResponse());
    });

    const [a, b] = await Promise.all([
      apiFetch('/tasks', { auth: session }),
      apiFetch('/projects', { auth: session })
    ]);
    expect(a).toEqual({ ok: true });
    expect(b).toEqual({ ok: true });

    const refreshCalls = fetchMock.mock.calls.filter(([url]) =>
      String(url).includes('/auth/refresh')
    );
    expect(refreshCalls).toHaveLength(1);
    expect(dataCalls).toBe(4); // 2 expired + 2 retried
  });

  it('gives up after a single retry even if the server keeps sending TOKEN_EXPIRED', async () => {
    session.setTokens(tokenPairFixture);
    fetchMock.mockImplementation((url: string) => {
      if (String(url).includes('/auth/refresh')) {
        return Promise.resolve(
          jsonResponse(200, { ...tokenPairFixture, accessToken: 'rotated-5', refreshToken: 'r6' })
        );
      }
      return Promise.resolve(expiredResponse());
    });

    await expect(apiFetch('/tasks', { auth: session })).rejects.toMatchObject({
      code: 'TOKEN_EXPIRED'
    });
    const refreshCalls = fetchMock.mock.calls.filter(([url]) =>
      String(url).includes('/auth/refresh')
    );
    expect(refreshCalls).toHaveLength(1);
  });

  it('never refreshes on plain UNAUTHENTICATED — it ends the session instead', async () => {
    session.setTokens(tokenPairFixture);
    fetchMock.mockResolvedValue(
      jsonResponse(401, JSON.parse(envelopeError('UNAUTHENTICATED', 'revoked')))
    );

    await expect(apiFetch('/tasks', { auth: session })).rejects.toMatchObject({
      code: 'UNAUTHENTICATED'
    });
    const refreshCalls = fetchMock.mock.calls.filter(([url]) =>
      String(url).includes('/auth/refresh')
    );
    expect(refreshCalls).toHaveLength(0);
    expect(sessionLost).toHaveBeenCalled();
    expect(session.getAccessToken()).toBeNull();
  });

  it('does not refresh on non-auth 4xx errors', async () => {
    session.setTokens(tokenPairFixture);
    fetchMock.mockResolvedValue(jsonResponse(404, JSON.parse(envelopeError('NOT_FOUND', 'gone'))));
    await expect(apiFetch('/tasks', { auth: session })).rejects.toMatchObject({
      code: 'NOT_FOUND'
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('does not attempt refresh without a session', async () => {
    fetchMock.mockResolvedValue(
      jsonResponse(401, JSON.parse(envelopeError('UNAUTHENTICATED', 'nope')))
    );
    await expect(apiFetch('/tasks')).rejects.toMatchObject({ code: 'UNAUTHENTICATED' });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
