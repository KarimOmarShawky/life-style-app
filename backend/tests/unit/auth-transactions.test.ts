import { describe, it, expect, vi } from 'vitest';
import type pg from 'pg';
import { PgAuthRepository } from '../../src/features/auth/auth.repository.pg.js';
import { AuthService } from '../../src/features/auth/auth.service.js';
import type {
  AuthRepository,
  CreateRefreshTokenData,
  TokenWithSessionAndUser
} from '../../src/features/auth/auth.repository.js';
import type { PasswordHasher } from '../../src/core/security/password-hasher.js';
import type { TokenService } from '../../src/core/security/token-service.js';
import type { OtpStore } from '../../src/core/security/otp-service.js';
import type { EmailSender } from '../../src/infrastructure/external/email-sender.js';
import { hashRefreshToken } from '../../src/core/security/refresh-token.js';

type Action = 'register' | 'login' | 'refresh' | 'logout' | 'logoutAll' | 'reset' | 'change';
const actions: Action[] = [
  'register',
  'login',
  'refresh',
  'logout',
  'logoutAll',
  'reset',
  'change'
];
const oldRawToken = 'old-refresh-token-unit-only';
function fixture(options?: { missingUser?: boolean }) {
  const now = new Date();
  const future = new Date(now.getTime() + 60_000);
  const record: TokenWithSessionAndUser = {
    token: {
      id: 'token-1',
      session_id: 'session-1',
      user_id: 'user-1',
      token_hash: hashRefreshToken(oldRawToken),
      issued_at: now,
      expires_at: future,
      rotated_at: null,
      replaced_by: null,
      revoked_at: null
    },
    session: {
      id: 'session-1',
      userId: 'user-1',
      createdAt: now,
      lastUsedAt: now,
      absoluteExpiresAt: future,
      revokedAt: null,
      revokedReason: null,
      devicePlatform: 'android',
      deviceName: null,
      appVersion: null,
      createdIp: null
    },
    user: {
      id: 'user-1',
      email: 'unit@example.test',
      password_hash: 'stored-hash',
      display_name: 'Unit',
      timezone: 'UTC',
      locale: 'en',
      week_start: 1,
      default_currency: 'USD',
      status: 'active',
      email_verified_at: null,
      password_changed_at: now,
      last_login_at: null,
      deletion_scheduled_for: null,
      push_show_titles: false,
      created_at: now,
      updated_at: now
    }
  };
  const repo = {
    findUserByEmail: vi.fn(async () => (options?.missingUser ? null : record.user)),
    findUserById: vi.fn(async () => record.user),
    createUser: vi.fn(async () => record.user),
    createDefaultCategories: vi.fn(async () => {}),
    createSession: vi.fn(async () => record.session),
    createRefreshToken: vi.fn(async () => record.token),
    findRefreshTokenWithSession: vi.fn(
      async (_hash: Buffer): Promise<TokenWithSessionAndUser | null> => record
    ),
    rotateRefreshToken: vi.fn(
      async (_oldId: string, _next: CreateRefreshTokenData, _client?: pg.PoolClient) => true
    ),
    revokeSession: vi.fn(async () => {}),
    revokeAllUserSessions: vi.fn(async () => {}),
    updateUserPassword: vi.fn(async () => {}),
    updateLastLogin: vi.fn(async () => {}),
    deleteSessionPushDevices: vi.fn(async () => {}),
    deleteAllUserPushDevices: vi.fn(async () => {})
  } satisfies AuthRepository;
  const queries: string[] = [];
  let committed = false;
  const client = {
    query: vi.fn(async (sql: string) => {
      queries.push(sql);
      if (sql === 'COMMIT') committed = true;
      if (sql === 'ROLLBACK' && committed) throw new Error('Unexpected rollback after commit');
      return { rows: [], rowCount: 0 };
    }),
    release: vi.fn()
  };
  const pool = { connect: vi.fn(async () => client) };
  const hasher = {
    hash: vi.fn(async () => 'stored-hash'),
    verify: vi.fn(async () => true),
    dummyVerify: vi.fn(async () => false)
  } satisfies PasswordHasher;
  const tokens = {
    signAccessToken: vi.fn(async () => ({ token: 'signed-access-unit', expiresAt: future })),
    verifyAccessToken: vi.fn(async () => ({ sub: 'user-1', sid: 'session-1' }))
  } satisfies TokenService;
  const audit = { log: vi.fn(async () => {}) };
  const otp: OtpStore = {
    generateAndStoreCode: vi.fn(),
    verifyAndConsumeCode: vi.fn(async () => true),
    checkCooldown: vi.fn()
  };
  const email: EmailSender = { sendPasswordResetEmail: vi.fn(), sendReminderEmail: vi.fn() };
  const service = new AuthService(
    repo,
    pool as unknown as pg.Pool,
    hasher,
    tokens,
    otp,
    email,
    audit
  );
  const invoke = (action: Action) => {
    switch (action) {
      case 'refresh':
        return service.refresh(oldRawToken);
      case 'login':
        return service.login({ email: 'unit@example.test', password: 'ExistingPassword!123' });
      case 'register':
        return service.register({
          email: 'unit@example.test',
          password: 'NewPassword!123',
          displayName: 'Unit',
          timezone: 'UTC',
          locale: 'en',
          defaultCurrency: 'USD'
        });
      case 'logout':
        return service.logout({ accessToken: 'access-unit' });
      case 'logoutAll':
        return service.logoutAll('user-1');
      case 'reset':
        return service.resetPassword({
          email: 'unit@example.test',
          code: '123456',
          newPassword: 'NewPassword!123'
        });
      case 'change':
        return service.changePassword('user-1', 'session-1', {
          currentPassword: 'ExistingPassword!123',
          newPassword: 'NewPassword!123'
        });
    }
  };
  const failOperation = (action: Action, error: Error) => {
    switch (action) {
      case 'register':
      case 'login':
        repo.createSession.mockRejectedValueOnce(error);
        break;
      case 'refresh':
        repo.rotateRefreshToken.mockRejectedValueOnce(error);
        break;
      case 'logout':
        repo.revokeSession.mockRejectedValueOnce(error);
        break;
      case 'logoutAll':
        repo.revokeAllUserSessions.mockRejectedValueOnce(error);
        break;
      case 'reset':
      case 'change':
        repo.updateUserPassword.mockRejectedValueOnce(error);
        break;
    }
  };
  return {
    service,
    repo,
    record,
    tokens,
    pool,
    client,
    queries,
    invoke,
    audit,
    failOperation,
    hasher,
    otp
  };
}

describe('Auth transaction ownership and refresh lifecycle (in-memory dependencies)', () => {
  for (const action of actions) {
    it(`${action}: no rollback or masked error after successful commit`, async () => {
      const f = fixture();
      const signingError = new Error('Signer unavailable');
      if (['register', 'login', 'refresh'].includes(action))
        f.tokens.signAccessToken.mockRejectedValueOnce(signingError);
      else f.audit.log.mockRejectedValueOnce(signingError);
      await expect(f.invoke(action)).rejects.toBe(signingError);
      expect(f.queries).toEqual(['BEGIN', 'COMMIT']);
      expect(f.client.release).toHaveBeenCalledExactlyOnceWith(false);
    });
    it(`${action}: an open transaction rolls back normally without leaking a broken client`, async () => {
      const f = fixture();
      const original = new Error('Operation failed before commit');
      f.failOperation(action, original);
      await expect(f.invoke(action)).rejects.toBe(original);
      expect(f.queries).toEqual(['BEGIN', 'ROLLBACK']);
      expect(f.client.release).toHaveBeenCalledExactlyOnceWith(false);
      expect(f.audit.log).not.toHaveBeenCalled();
    });
    it(`${action}: failed BEGIN discards the client without rollback`, async () => {
      const f = fixture();
      const beginError = new Error('Connection lost during begin');
      f.client.query.mockRejectedValueOnce(beginError);
      await expect(f.invoke(action)).rejects.toBe(beginError);
      expect(f.client.query).toHaveBeenCalledExactlyOnceWith('BEGIN');
      expect(f.client.release).toHaveBeenCalledExactlyOnceWith(true);
    });
    it(`${action}: rollback failure preserves original error and discards client`, async () => {
      const f = fixture();
      const original = new Error('Original database operation failed');
      f.failOperation(action, original);
      f.client.query.mockImplementation(async (sql) => {
        if (sql === 'ROLLBACK') throw new Error('Rollback failed');
        return { rows: [], rowCount: 0 };
      });
      await expect(f.invoke(action)).rejects.toBe(original);
      expect(f.client.query).toHaveBeenCalledWith('ROLLBACK');
      expect(f.client.release).toHaveBeenCalledExactlyOnceWith(true);
    });
  }

  it('successful rotation stores only a token hash, respects absolute expiry, and signs once', async () => {
    const f = fixture();
    const result = await f.service.refresh(oldRawToken);
    expect(f.repo.findRefreshTokenWithSession).toHaveBeenCalledWith(hashRefreshToken(oldRawToken));
    const data = f.repo.rotateRefreshToken.mock.calls[0]![1];
    expect(data.tokenHash).toEqual(hashRefreshToken(result.refreshToken));
    expect(data).not.toHaveProperty('rawToken');
    expect(result.refreshToken).not.toBe(oldRawToken);
    expect(data.expiresAt).toEqual(f.record.session.absoluteExpiresAt);
    expect(f.tokens.signAccessToken).toHaveBeenCalledExactlyOnceWith({
      sub: 'user-1',
      sid: 'session-1'
    });
    expect(f.queries).toEqual(['BEGIN', 'COMMIT']);
  });

  it('lost atomic rotation race commits revocation and rejects without a post-commit rollback', async () => {
    const f = fixture();
    f.repo.rotateRefreshToken.mockResolvedValueOnce(false);
    await expect(f.invoke('refresh')).rejects.toMatchObject({
      httpStatus: 401,
      code: 'INVALID_REFRESH_TOKEN'
    });
    expect(f.repo.revokeSession).toHaveBeenCalledOnce();
    expect(f.repo.deleteSessionPushDevices).toHaveBeenCalledOnce();
    expect(f.queries).toEqual(['BEGIN', 'COMMIT']);
    expect(f.tokens.signAccessToken).not.toHaveBeenCalled();
    expect(f.audit.log).toHaveBeenCalledWith(
      expect.objectContaining({ eventType: 'auth.refresh.reuse_detected', outcome: 'failure' })
    );
  });

  it('reuse of an already rotated token revokes the session before issuing any token', async () => {
    const f = fixture();
    f.record.token.rotated_at = new Date();
    await expect(f.invoke('refresh')).rejects.toMatchObject({ httpStatus: 401 });
    expect(f.repo.revokeSession).toHaveBeenCalledOnce();
    expect(f.repo.deleteSessionPushDevices).toHaveBeenCalledOnce();
    expect(f.pool.connect).not.toHaveBeenCalled();
    expect(f.tokens.signAccessToken).not.toHaveBeenCalled();
  });

  for (const invalid of [
    'missing',
    'revoked-session',
    'expired-session',
    'revoked-token',
    'expired-token',
    'disabled-user'
  ] as const) {
    it(`rejects ${invalid} before connecting/rotating/signing`, async () => {
      const f = fixture();
      if (invalid === 'missing') f.repo.findRefreshTokenWithSession.mockResolvedValueOnce(null);
      if (invalid === 'revoked-session') f.record.session.revokedAt = new Date();
      if (invalid === 'expired-session') f.record.session.absoluteExpiresAt = new Date(0);
      if (invalid === 'revoked-token') f.record.token.revoked_at = new Date();
      if (invalid === 'expired-token') f.record.token.expires_at = new Date(0);
      if (invalid === 'disabled-user') f.record.user.status = 'disabled';
      await expect(f.invoke('refresh')).rejects.toMatchObject({
        httpStatus: 401,
        code: 'INVALID_REFRESH_TOKEN'
      });
      expect(f.pool.connect).not.toHaveBeenCalled();
      expect(f.repo.rotateRefreshToken).not.toHaveBeenCalled();
      expect(f.tokens.signAccessToken).not.toHaveBeenCalled();
    });
  }
});

describe('Last-login update transaction routing (SQL harness)', () => {
  it('login passes the active client to the last-login update', async () => {
    const f = fixture();
    await f.invoke('login');
    expect(f.repo.updateLastLogin).toHaveBeenCalledExactlyOnceWith('user-1', f.client);
  });

  it('repository uses the supplied client, while preserving nontransactional compatibility', async () => {
    const query = vi.fn(async () => ({ rows: [], rowCount: 1 }));
    const poolQuery = vi.fn(async () => ({ rows: [], rowCount: 1 }));
    const repo = new PgAuthRepository({ query: poolQuery } as unknown as pg.Pool);
    await repo.updateLastLogin('user-1', { query } as unknown as pg.PoolClient);
    expect(query).toHaveBeenCalledWith(expect.stringContaining('WHERE id = $1'), ['user-1']);
    expect(poolQuery).not.toHaveBeenCalled();
    await repo.updateLastLogin('user-2');
    expect(poolQuery).toHaveBeenCalledWith(expect.stringContaining('WHERE id = $1'), ['user-2']);
  });
});

describe('Invalid password-reset operation parity (not wall-clock or SMTP proof)', () => {
  for (const state of ['missing', 'disabled', 'wrong-code'] as const) {
    it(`${state} has the same generic error and one dummy comparison, without mutation`, async () => {
      const f = fixture({ missingUser: state === 'missing' });
      if (state === 'disabled') f.record.user.status = 'disabled';
      vi.mocked(f.otp.verifyAndConsumeCode).mockResolvedValue(false);
      await expect(f.invoke('reset')).rejects.toMatchObject({
        httpStatus: 400,
        code: 'INVALID_OR_EXPIRED_CODE'
      });
      expect(f.hasher.dummyVerify).toHaveBeenCalledTimes(1);
      expect(f.hasher.hash).not.toHaveBeenCalled();
      expect(f.pool.connect).not.toHaveBeenCalled();
      expect(f.repo.updateUserPassword).not.toHaveBeenCalled();
      expect(f.audit.log).not.toHaveBeenCalled();
    });
  }
});
