/**
 * tests/unit/sessions.test.ts
 *
 * Feature guide G6 (ADR-047): signed-in devices. Validation, the service
 * (ownership, re-authentication first, metadata-only responses, audit), the
 * repository's SQL and transaction steps (including the fallback to 'logout'
 * before the owner-run SQL), and the owner SQL / schema snapshots.
 */

import { readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type pg from 'pg';
import { AppError } from '../../src/core/errors/app-error.js';
import type {
  AuditEvent,
  AuditLogger
} from '../../src/infrastructure/database/postgres/audit-logger.js';
import {
  revokeSessionSchema,
  sessionIdParamsSchema
} from '../../src/features/sessions/sessions.validation.js';
import {
  PgSessionsRepository,
  SESSION_LIST_COLUMNS,
  SESSION_LIST_LIMIT,
  resetSessionRevokeReasonCache,
  type SessionRevokeResult,
  type SessionRow,
  type SessionsRepository
} from '../../src/features/sessions/sessions.repository.pg.js';
import { SessionsService } from '../../src/features/sessions/sessions.service.js';

const repoFile = (relative: string) =>
  readFileSync(new URL(`../../../${relative}`, import.meta.url), 'utf8');
const migrationSource = repoFile(
  'backend/src/infrastructure/database/postgres/migrations/1792770000000_auth_sessions_user_revoked.cjs'
);

const USER = randomUUID();
const CURRENT = randomUUID();
const OTHER = randomUUID();

function row(id: string, extra: Record<string, unknown> = {}): SessionRow {
  return {
    id,
    device_platform: 'android',
    device_name: 'Pixel 8',
    app_version: '1.4.0',
    created_at: new Date('2026-11-01T08:00:00Z'),
    last_used_at: new Date('2026-11-11T09:30:00Z'),
    ...extra
  } as SessionRow;
}

class FakeRepo implements SessionsRepository {
  rows: SessionRow[] = [];
  result: SessionRevokeResult = { outcome: 'revoked', reason: 'user_revoked' };
  listCalls: Array<[string, string | null, number]> = [];
  revokeCalls: Array<[string, string]> = [];
  async listActive(userId: string, currentSessionId: string | null, limit: number) {
    this.listCalls.push([userId, currentSessionId, limit]);
    return this.rows.slice(0, limit);
  }
  async revoke(userId: string, sessionId: string) {
    this.revokeCalls.push([userId, sessionId]);
    return this.result;
  }
}

function setup(reauth: (userId: string, password: string) => Promise<void> = async () => {}) {
  const repo = new FakeRepo();
  const events: AuditEvent[] = [];
  const audit: AuditLogger = { log: async (event) => void events.push(event) };
  const reauthenticate = vi.fn(reauth);
  return {
    repo,
    events,
    reauthenticate,
    service: new SessionsService(repo, reauthenticate, audit)
  };
}

describe('sessions validation (G6)', () => {
  it('accepts a UUID path id and a current password, and nothing else', () => {
    expect(sessionIdParamsSchema.safeParse({ id: OTHER }).success).toBe(true);
    expect(sessionIdParamsSchema.safeParse({ id: 'not-a-uuid' }).success).toBe(false);
    expect(sessionIdParamsSchema.safeParse({ id: OTHER, extra: '1' }).success).toBe(false);
    expect(revokeSessionSchema.safeParse({ currentPassword: 'x' }).success).toBe(true);
    for (const bad of [
      {},
      { currentPassword: '' },
      { currentPassword: 'x'.repeat(1025) },
      { currentPassword: 'x', userId: USER },
      { currentPassword: 7 }
    ]) {
      expect(revokeSessionSchema.safeParse(bad).success, JSON.stringify(bad)).toBe(false);
    }
  });
});

describe('SessionsService.list (G6)', () => {
  it('returns device metadata only, marks the current session and passes it to the query', async () => {
    const { repo, service } = setup();
    repo.rows = [
      row(CURRENT, { created_ip: '203.0.113.7', token_hash: Buffer.alloc(32) }),
      row(OTHER, { device_platform: 'ios', device_name: null, app_version: null })
    ];
    const result = await service.list(USER, CURRENT);
    expect(repo.listCalls).toEqual([[USER, CURRENT, SESSION_LIST_LIMIT + 1]]);
    expect(result).toEqual({
      truncated: false,
      sessions: [
        {
          id: CURRENT,
          devicePlatform: 'android',
          deviceName: 'Pixel 8',
          appVersion: '1.4.0',
          createdAt: '2026-11-01T08:00:00.000Z',
          lastUsedAt: '2026-11-11T09:30:00.000Z',
          current: true
        },
        {
          id: OTHER,
          devicePlatform: 'ios',
          deviceName: null,
          appVersion: null,
          createdAt: '2026-11-01T08:00:00.000Z',
          lastUsedAt: '2026-11-11T09:30:00.000Z',
          current: false
        }
      ]
    });
    const json = JSON.stringify(result);
    expect(json).not.toContain('203.0.113.7');
    expect(json).not.toMatch(/created_?ip|token|hash/i);
  });

  it('lists at most the limit and says when more sessions exist', async () => {
    const { repo, service } = setup();
    repo.rows = Array.from({ length: SESSION_LIST_LIMIT + 1 }, () => row(randomUUID()));
    const result = await service.list(USER, undefined);
    expect(result.sessions).toHaveLength(SESSION_LIST_LIMIT);
    expect(result.truncated).toBe(true);
    expect(result.sessions.every((session) => !session.current)).toBe(true);
    expect(repo.listCalls[0]?.[1]).toBeNull();
  });
});

describe('SessionsService.revoke (G6)', () => {
  const input = (sessionId: string) => ({
    userId: USER,
    currentSessionId: CURRENT,
    sessionId,
    currentPassword: 'CorrectHorse1!',
    meta: { ip: '198.51.100.4', userAgent: 'test', requestId: 'req-1' }
  });

  it('checks the password before touching the session', async () => {
    const { repo, service, reauthenticate } = setup(async () => {
      throw AppError.forbidden('Current password verification failed', 'REAUTHENTICATION_FAILED');
    });
    await expect(service.revoke(input(OTHER))).rejects.toMatchObject({
      httpStatus: 403,
      code: 'REAUTHENTICATION_FAILED'
    });
    expect(reauthenticate).toHaveBeenCalledWith(USER, 'CorrectHorse1!');
    expect(repo.revokeCalls).toEqual([]);
  });

  it('answers unknown and other-account ids with 404 NOT_FOUND', async () => {
    const { repo, service, events } = setup();
    repo.result = { outcome: 'not_found' };
    await expect(service.revoke(input(OTHER))).rejects.toMatchObject({
      httpStatus: 404,
      code: 'NOT_FOUND'
    });
    expect(repo.revokeCalls).toEqual([[USER, OTHER]]);
    expect(events).toEqual([]);
  });

  it('revokes another device, audits it without the password, and says it was not this one', async () => {
    const { service, events } = setup();
    await expect(service.revoke(input(OTHER))).resolves.toEqual({ revoked: true, current: false });
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      actorType: 'user',
      actorUserId: USER,
      sessionId: CURRENT,
      eventType: 'auth.session.revoke',
      outcome: 'success',
      entityType: 'auth_session',
      entityId: OTHER,
      metadata: { current: false, alreadyEnded: false, reason: 'user_revoked' }
    });
    expect(JSON.stringify(events)).not.toContain('CorrectHorse1!');
  });

  it('is idempotent and reports the current session', async () => {
    const { repo, service, events } = setup();
    repo.result = { outcome: 'already_ended' };
    await expect(service.revoke(input(CURRENT))).resolves.toEqual({ revoked: true, current: true });
    expect(events[0]?.metadata).toEqual({ current: true, alreadyEnded: true, reason: null });
  });
});

type Step = { sql: string; params?: unknown[] };

function fakePool(script: (sql: string, params?: unknown[]) => unknown) {
  const steps: Step[] = [];
  const released: boolean[] = [];
  const client = {
    query: vi.fn(async (sql: string, params?: unknown[]) => {
      steps.push(params === undefined ? { sql } : { sql, params });
      return script(sql, params) ?? { rows: [], rowCount: 0 };
    }),
    release: vi.fn((discard?: boolean) => void released.push(discard === true))
  };
  const pool = {
    connect: vi.fn(async () => client),
    query: vi.fn(async (sql: string, params?: unknown[]) => {
      steps.push({ sql, params: params ?? [] });
      return { rows: [row(CURRENT)] };
    })
  };
  return { pool: pool as unknown as pg.Pool, steps, released };
}

const compact = (sql: string) => sql.replace(/\s+/g, ' ').trim();

describe('PgSessionsRepository (G6)', () => {
  beforeEach(() => resetSessionRevokeReasonCache());

  it('lists only metadata columns of active sessions of the account, current first', async () => {
    const { pool, steps } = fakePool(() => undefined);
    await new PgSessionsRepository(pool).listActive(USER, CURRENT, 51);
    const sql = compact(steps[0]!.sql);
    expect(SESSION_LIST_COLUMNS).not.toMatch(/created_ip|token/);
    expect(sql).toContain(`SELECT ${SESSION_LIST_COLUMNS} FROM auth_sessions`);
    expect(sql).toContain(
      'WHERE user_id = $1 AND revoked_at IS NULL AND absolute_expires_at > now()'
    );
    expect(sql).toContain('ORDER BY (id = $2::uuid) DESC NULLS LAST, last_used_at DESC, id');
    expect(steps[0]!.params).toEqual([USER, CURRENT, 51]);
  });

  it('revokes the session, its refresh tokens and its push devices in one transaction', async () => {
    const { pool, steps, released } = fakePool((sql) =>
      sql.includes('FOR UPDATE') ? { rows: [{ revoked_at: null }] } : undefined
    );
    await expect(new PgSessionsRepository(pool).revoke(USER, OTHER)).resolves.toEqual({
      outcome: 'revoked',
      reason: 'user_revoked'
    });
    expect(steps.map((step) => compact(step.sql))).toEqual([
      'BEGIN',
      'SELECT revoked_at FROM auth_sessions WHERE id = $1 AND user_id = $2 FOR UPDATE',
      'SAVEPOINT session_revoke_reason',
      'UPDATE auth_sessions SET revoked_at = now(), revoked_reason = $3 WHERE id = $1 AND user_id = $2 AND revoked_at IS NULL',
      'RELEASE SAVEPOINT session_revoke_reason',
      'UPDATE refresh_tokens SET revoked_at = now() WHERE session_id = $1 AND user_id = $2 AND revoked_at IS NULL',
      'DELETE FROM push_devices WHERE session_id = $1 AND user_id = $2',
      'COMMIT'
    ]);
    expect(steps[3]!.params).toEqual([OTHER, USER, 'user_revoked']);
    for (const step of steps.filter((s) => s.params))
      expect(step.params!.slice(0, 2)).toEqual([OTHER, USER]);
    expect(released).toEqual([false]);
  });

  it('rolls back and reports not_found for an id the account does not own', async () => {
    const { pool, steps } = fakePool(() => undefined);
    await expect(new PgSessionsRepository(pool).revoke(USER, OTHER)).resolves.toEqual({
      outcome: 'not_found'
    });
    expect(steps.map((step) => compact(step.sql))).toEqual([
      'BEGIN',
      'SELECT revoked_at FROM auth_sessions WHERE id = $1 AND user_id = $2 FOR UPDATE',
      'ROLLBACK'
    ]);
  });

  it('cleans up an already ended session without changing its reason', async () => {
    const { pool, steps } = fakePool((sql) =>
      sql.includes('FOR UPDATE') ? { rows: [{ revoked_at: new Date() }] } : undefined
    );
    await expect(new PgSessionsRepository(pool).revoke(USER, OTHER)).resolves.toEqual({
      outcome: 'already_ended'
    });
    const sqls = steps.map((step) => compact(step.sql));
    expect(sqls.some((sql) => sql.startsWith('UPDATE auth_sessions'))).toBe(false);
    expect(sqls).toContain('DELETE FROM push_devices WHERE session_id = $1 AND user_id = $2');
    expect(sqls.at(-1)).toBe('COMMIT');
  });

  it("falls back to 'logout' until the owner SQL is applied, and remembers that for a while", async () => {
    const reasons: unknown[] = [];
    const script = (sql: string, params?: unknown[]) => {
      if (sql.includes('FOR UPDATE')) return { rows: [{ revoked_at: null }] };
      if (sql.includes('revoked_reason = $3')) {
        reasons.push(params?.[2]);
        if (params?.[2] === 'user_revoked') {
          throw Object.assign(new Error('violates check constraint'), {
            code: '23514',
            table: 'auth_sessions'
          });
        }
      }
      return undefined;
    };
    const first = fakePool(script);
    await expect(new PgSessionsRepository(first.pool).revoke(USER, OTHER)).resolves.toEqual({
      outcome: 'revoked',
      reason: 'logout'
    });
    expect(first.steps.map((step) => compact(step.sql))).toContain(
      'ROLLBACK TO SAVEPOINT session_revoke_reason'
    );
    expect(first.steps.at(-1)?.sql).toBe('COMMIT');

    // Within ten minutes the rejected value is not tried again.
    const second = fakePool(script);
    await new PgSessionsRepository(second.pool).revoke(USER, OTHER);
    expect(second.steps.some((step) => step.sql.startsWith('SAVEPOINT'))).toBe(false);
    expect(reasons).toEqual(['user_revoked', 'logout', 'logout']);
  });

  it('rolls back, releases the connection and rethrows any other error', async () => {
    const { pool, steps, released } = fakePool((sql) => {
      if (sql.includes('FOR UPDATE')) return { rows: [{ revoked_at: null }] };
      if (sql.startsWith('UPDATE refresh_tokens')) throw new Error('connection reset');
      return undefined;
    });
    await expect(new PgSessionsRepository(pool).revoke(USER, OTHER)).rejects.toThrow(
      'connection reset'
    );
    expect(steps.at(-1)?.sql).toBe('ROLLBACK');
    expect(released).toEqual([false]);
  });
});

describe('owner-run production SQL (G6)', () => {
  it('is byte-identical to the forward-only migration body and runs in one transaction', () => {
    const migrationBody = /pgm\.sql\(`\n([\s\S]*?)\n\s*`\);/.exec(migrationSource)![1]!;
    const ownerSql = repoFile('docs/auth/sql/auth-sessions-user-revoked.sql');
    const ownerBody = /-- BEGIN MIGRATION BODY\n([\s\S]*?)\n-- END MIGRATION BODY/.exec(
      ownerSql
    )![1]!;
    expect(ownerBody).toBe(migrationBody);
    expect(ownerSql).toMatch(/\nBEGIN;\n-- BEGIN MIGRATION BODY/);
    expect(ownerSql.trimEnd().endsWith('-- END MIGRATION BODY\nCOMMIT;')).toBe(true);
    expect(ownerSql).toContain('must NOT be run there');
    expect(migrationSource).toMatch(/exports\.down = \(\) => \{\n\s*throw new Error/);
  });

  it('keeps every earlier reason and only adds user_revoked', () => {
    const list = /CHECK \(revoked_reason IN \(([\s\S]*?)\)\);/.exec(migrationSource)![1]!;
    const reasons = list.split(',').map((value) => value.trim().replace(/'/g, ''));
    expect(reasons).toEqual([
      'logout',
      'logout_all',
      'password_change',
      'password_reset',
      'reuse_detected',
      'account_disabled',
      'account_deletion',
      'user_revoked'
    ]);
    // The pair check (revoked_at IS NULL) = (revoked_reason IS NULL) is not dropped.
    expect(migrationSource).toContain("LIKE '%revoked_reason = ANY%'");
  });

  it('keeps both schema snapshots in step with the migration', () => {
    for (const snapshot of [
      'schema.sql',
      'backend/src/infrastructure/database/postgres/schema-sql.ts'
    ]) {
      const text = repoFile(snapshot).replace(/\\n/g, '\n');
      expect(text, snapshot).toContain(
        "'reuse_detected', 'account_disabled', 'account_deletion', 'user_revoked'\n"
      );
    }
  });
});
