import { createHash } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import { EventEmitter } from 'node:events';
import { describe, it, expect, vi } from 'vitest';
import express, { type Request, type Response } from 'express';
import request from 'supertest';
import type pg from 'pg';
import {
  ACCOUNT_ARCHIVE_LIMITS,
  streamAccountArchive
} from '../../src/features/users/account-archive.js';
import {
  ACCOUNT_ARCHIVE_EXCLUSIONS,
  ACCOUNT_ARCHIVE_OWNED_EXCLUSIONS,
  ACCOUNT_ARCHIVE_SOURCES
} from '../../src/features/users/account-archive.sources.js';
import { USER_OWNED_TABLES_IN_DELETE_ORDER } from '../../src/features/users/users.repository.pg.js';
import { UsersController } from '../../src/features/users/users.controller.js';
import { UsersService } from '../../src/features/users/users.service.js';
import { createUsersRouter } from '../../src/features/users/users.routes.js';
import { MemoryRateLimiter, type RateLimiter } from '../../src/core/middleware/rate-limiter.js';
import { globalErrorHandler } from '../../src/core/middleware/error-handler.js';
import { AppError } from '../../src/core/errors/app-error.js';

// SQL/control-flow harness only. No live database, Redis or external provider.
function fixture(data: Record<string, unknown[]> = {}, failure = '') {
  let table = '',
    offset = 0;
  const release = vi.fn();
  const query = vi.fn(async (sql: string, _params: unknown[] = []) => {
    if (failure && sql.startsWith(failure)) throw new Error('private database/provider diagnostic');
    if (sql.startsWith('DECLARE')) {
      table = /FROM public\.(\w+)/.exec(sql)![1]!;
      offset = 0;
    }
    if (sql.startsWith('FETCH')) {
      const values = data[table] ?? (table === 'users' ? [{ id: 'user-a' }] : []);
      const rows = values
        .slice(offset, offset + ACCOUNT_ARCHIVE_LIMITS.fetchRows)
        .map((value) => ({ payload: value === null ? null : JSON.stringify(value) }));
      offset += rows.length;
      return { rows };
    }
    return { rows: [] };
  });
  const client = Object.assign(new EventEmitter(), { query, release });
  const pool = { connect: vi.fn(async () => client) };
  return { pool: pool as unknown as pg.Pool, connect: pool.connect, query, release, client };
}
async function collect(stream: ReturnType<typeof streamAccountArchive>) {
  const lines: string[] = [];
  while (true) {
    const next = await stream.next();
    if (next.done) return { lines, summary: next.value };
    lines.push(next.value);
  }
}
const signal = () => new AbortController().signal;

function httpFixture(
  limiter: RateLimiter = new MemoryRateLimiter(),
  failure = '',
  authenticated = true
) {
  const sql = fixture({ notes: [{ id: 'note-a', body: 'Personal note' }] }, failure);
  const audit = { log: vi.fn(async () => {}) };
  const repo = {
    getUserProfile: vi.fn(async () => ({ id: 'user-a', password_hash: 'private-hash' })),
    streamUserArchive: vi.fn((id: string, abort: AbortSignal) =>
      streamAccountArchive(sql.pool, id, abort)
    )
  };
  const hasher = {
    hash: vi.fn(async () => 'unused-unit-hash'),
    verify: vi.fn(async (value: string) => value === 'correct-password'),
    dummyVerify: vi.fn(async () => false)
  };
  const service = new UsersService(repo as never, audit, hasher);
  const controller = new UsersController(service);
  const app = express();
  app.use(express.json());
  app.use(
    '/users',
    createUsersRouter({
      controller,
      rateLimiter: limiter,
      authenticate: (req, _res, next) => {
        if (!authenticated) return next(AppError.unauthenticated());
        req.user = { id: 'user-a' } as NonNullable<Request['user']>;
        next();
      }
    })
  );
  app.use(globalErrorHandler);
  return { app, sql, repo, hasher, audit, controller, service };
}

describe('Bounded domain archive (SQL harness, not PostgreSQL execution)', () => {
  it('covers every currently owned domain table plus profile/session metadata with explicit safe columns', () => {
    const tables = ACCOUNT_ARCHIVE_SOURCES.map((s) => s.table);
    // Owned tables kept out of the versioned v1 archive on purpose (V-06). They
    // are still erased with the account; see the deletion-order assertion below.
    const archiveExcluded = new Set<string>([...ACCOUNT_ARCHIVE_OWNED_EXCLUSIONS]);
    expect(new Set(tables)).toEqual(
      new Set([
        'users',
        'auth_sessions',
        ...[...USER_OWNED_TABLES_IN_DELETE_ORDER].filter((table) => !archiveExcluded.has(table))
      ])
    );
    for (const table of archiveExcluded) {
      expect(USER_OWNED_TABLES_IN_DELETE_ORDER).toContain(table);
      const documented = ACCOUNT_ARCHIVE_EXCLUSIONS.join(' ').toLowerCase();
      expect(documented).toContain(table.replace(/_/g, ' ').replace('password reset requests', 'password-reset request records'));
    }
    const migrations = readdirSync('src/infrastructure/database/postgres/migrations')
      .map((name) =>
        readFileSync(`src/infrastructure/database/postgres/migrations/${name}`, 'utf8')
      )
      .join('\n');
    const createdOwned = [...migrations.matchAll(/CREATE TABLE (\w+) \(([\s\S]*?)\n    \);/g)]
      .filter((match) => /\buser_id\s+UUID/.test(match[2]!) && match[1] !== 'refresh_tokens')
      .map((match) => match[1]!);
    // A table can also gain its ownership key later (for example
    // password_reset_requests, whose user_id was added with ALTER TABLE for
    // V-06); ownership is what matters, not when the column was declared.
    const alteredOwned = [...migrations.matchAll(/ALTER TABLE (\w+)([\s\S]*?);/g)]
      .filter((match) => /ADD COLUMN[^;]*\buser_id\b/i.test(match[2]!))
      .map((match) => match[1]!);
    const ownedInMigrations = [...new Set([...createdOwned, ...alteredOwned])];
    expect(new Set(tables)).toEqual(
      new Set(['users', ...ownedInMigrations.filter((table) => !archiveExcluded.has(table))])
    );
    for (const source of ACCOUNT_ARCHIVE_SOURCES) {
      const start = migrations.indexOf(`CREATE TABLE ${source.table} (`);
      expect(start).toBeGreaterThan(-1);
      const ddl = migrations.slice(start, migrations.indexOf('\n    );', start));
      for (const column of source.columns
        .split(',')
        .map((value) => value.trim().split(/::|\s/)[0]!)) {
        expect(ddl).toMatch(new RegExp(`\\b${column}\\s+`, 'i'));
      }
      expect(source.columns).not.toMatch(
        /\*|password_hash|token_hash|push_token|search_vector|last_error|idempotency_fingerprint/
      );
    }
  });

  it('reads one read-only repeatable snapshot, fetches bounded pages and hashes exact UTF-8 output', async () => {
    const f = fixture({
      tasks: Array.from({ length: 33 }, (_, i) => ({ id: `task-${i}`, title: 'مهمة' }))
    });
    const result = await collect(streamAccountArchive(f.pool, 'user-a', signal()));
    expect(result.summary?.counts.tasks).toBe(33);
    expect(result.summary?.records).toBe(34);
    expect(result.summary?.sha256).toBe(
      createHash('sha256').update(result.lines.join('')).digest('hex')
    );
    expect(result.summary?.bytesBeforeComplete).toBe(Buffer.byteLength(result.lines.join('')));
    expect(JSON.parse(result.lines[0]!)).toMatchObject({
      type: 'manifest',
      version: 1,
      includesSoftDeleted: true
    });
    const sql = f.query.mock.calls.map(([text]) => text);
    expect(sql[0]).toBe('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
    expect(sql.at(-1)).toBe('COMMIT');
    expect(sql).not.toContain('ROLLBACK');
    for (const [text, values] of f.query.mock.calls.filter(([text]) =>
      text.startsWith('DECLARE')
    )) {
      expect(values).toEqual(['user-a']);
      expect(text).toMatch(/WHERE (?:id|user_id) = \$1 ORDER BY id/);
      expect(text).toContain('octet_length');
      expect(text).not.toMatch(/deleted_at IS NULL|SELECT \*/);
    }
    expect(
      sql.filter((text) => text.startsWith('FETCH')).every((text) => text.includes('FORWARD 32'))
    ).toBe(true);
    expect(f.release).toHaveBeenCalledExactlyOnceWith();
  });

  it('preserves high precision monetary values as strings rather than JS floating point', async () => {
    for (const [table, field] of [
      ['transactions', 'amount'],
      ['subscriptions', 'amount'],
      ['budgets', 'amount_limit'],
      ['goals', 'target_value'],
      ['goals', 'current_value']
    ]) {
      expect(ACCOUNT_ARCHIVE_SOURCES.find((s) => s.table === table)?.columns).toContain(
        `${field}::text AS ${field}`
      );
    }
    const f = fixture({
      transactions: [{ id: 'tx', amount: '900719925474099.1234', currency: 'KWD' }]
    });
    const { lines } = await collect(streamAccountArchive(f.pool, 'money-user', signal()));
    expect(lines.join('')).toContain('"amount":"900719925474099.1234"');
  });

  it('returns controlled missing-account failure before any archive line and rolls back', async () => {
    const f = fixture({ users: [] });
    await expect(streamAccountArchive(f.pool, 'missing', signal()).next()).rejects.toMatchObject({
      httpStatus: 404
    });
    expect(f.query).toHaveBeenLastCalledWith('ROLLBACK', []);
    expect(f.release).toHaveBeenCalledExactlyOnceWith();
  });

  for (const failure of ['DECLARE', 'FETCH', 'COMMIT']) {
    it(`does not return a summary on ${failure} failure; rollback and release occur`, async () => {
      const f = fixture({}, failure);
      await expect(
        collect(streamAccountArchive(f.pool, `failure-${failure}`, signal()))
      ).rejects.toThrow();
      expect(f.query).toHaveBeenLastCalledWith('ROLLBACK', []);
      expect(f.release).toHaveBeenCalledOnce();
    });
  }

  for (const oversized of [null, { body: 'x'.repeat(ACCOUNT_ARCHIVE_LIMITS.recordBytes + 1) }]) {
    it('rejects a DB size sentinel or oversized payload, not a silently truncated successful archive', async () => {
      const f = fixture({ notes: [oversized] });
      await expect(
        collect(streamAccountArchive(f.pool, 'large-record', signal()))
      ).rejects.toMatchObject({ httpStatus: 413 });
      expect(f.query).toHaveBeenLastCalledWith('ROLLBACK', []);
    });
  }

  it('enforces a total byte budget (small test-only limit) without accumulating the archive', async () => {
    const original = ACCOUNT_ARCHIVE_LIMITS.totalBytes;
    try {
      Reflect.set(
        ACCOUNT_ARCHIVE_LIMITS,
        'totalBytes',
        ACCOUNT_ARCHIVE_LIMITS.footerReserveBytes + 10
      );
      await expect(
        collect(streamAccountArchive(fixture().pool, 'byte-limit', signal()))
      ).rejects.toMatchObject({ httpStatus: 413 });
    } finally {
      Reflect.set(ACCOUNT_ARCHIVE_LIMITS, 'totalBytes', original);
    }
  });

  it('consumer cancellation rolls back and releases the cursor connection', async () => {
    const f = fixture(),
      stream = streamAccountArchive(f.pool, 'early-return', signal());
    await stream.next();
    await stream.return(undefined);
    expect(f.query).toHaveBeenLastCalledWith('ROLLBACK', []);
    expect(f.release).toHaveBeenCalledOnce();
  });

  it('disconnect abort destroys the connection once and cannot return a completion summary', async () => {
    const abort = new AbortController(),
      f = fixture(),
      stream = streamAccountArchive(f.pool, 'aborted', abort.signal);
    await stream.next();
    abort.abort();
    await expect(stream.next()).rejects.toMatchObject({ httpStatus: 503 });
    expect(f.release).toHaveBeenCalledExactlyOnceWith(true);
  });

  it('a pre-aborted request never acquires a connection; late acquisition is discarded', async () => {
    const abort = new AbortController();
    abort.abort();
    const f = fixture();
    await expect(
      streamAccountArchive(f.pool, 'pre-abort', abort.signal).next()
    ).rejects.toMatchObject({ httpStatus: 503 });
    expect(f.connect).not.toHaveBeenCalled();
    const late = new AbortController();
    f.connect.mockImplementationOnce(async () => {
      late.abort();
      return f.client;
    });
    await expect(streamAccountArchive(f.pool, 'late-abort', late.signal).next()).rejects.toThrow();
    expect(f.release).toHaveBeenCalledExactlyOnceWith(true);
  });

  it('bounds stuck query time and discards its client (fake timers, not server cancellation proof)', async () => {
    vi.useFakeTimers();
    try {
      const f = fixture();
      f.query.mockImplementationOnce(() => new Promise(() => {}));
      const result = expect(
        streamAccountArchive(f.pool, 'query-timeout', signal()).next()
      ).rejects.toMatchObject({ httpStatus: 503 });
      await vi.advanceTimersByTimeAsync(ACCOUNT_ARCHIVE_LIMITS.queryMs + 1);
      await result;
      expect(f.release).toHaveBeenCalledExactlyOnceWith(true);
    } finally {
      vi.useRealTimers();
    }
  });

  it('handles asynchronous checked-out client errors while paused without an uncaught error or success', async () => {
    const f = fixture(),
      stream = streamAccountArchive(f.pool, 'connection-error', signal());
    await stream.next();
    f.client.emit('error', new Error('private connection diagnostic'));
    await expect(stream.next()).rejects.toMatchObject({ httpStatus: 503 });
    expect(f.release).toHaveBeenCalledExactlyOnceWith(true);
    expect(f.client.listenerCount('error')).toBe(0);
  });

  it('caps concurrent archives and same-user overlap before acquiring extra connections', async () => {
    const a = streamAccountArchive(fixture().pool, 'capacity-a', signal());
    const b = streamAccountArchive(fixture().pool, 'capacity-b', signal());
    try {
      await a.next();
      await b.next();
      const f = fixture();
      await expect(
        streamAccountArchive(f.pool, 'capacity-c', signal()).next()
      ).rejects.toMatchObject({ httpStatus: 429 });
      await expect(
        streamAccountArchive(f.pool, 'capacity-a', signal()).next()
      ).rejects.toMatchObject({ httpStatus: 429 });
      expect(f.connect).not.toHaveBeenCalled();
    } finally {
      await a.return(undefined);
      await b.return(undefined);
    }
  });
});

describe('Archive HTTP/security/streaming flow (in-process harness)', () => {
  it('requires authentication, strict current-password proof and rejects identity injection', async () => {
    const f = httpFixture();
    for (const [body, status] of [
      [{}, 400],
      [{ currentPassword: 'wrong' }, 403],
      [{ currentPassword: 'correct-password', userId: 'other' }, 400]
    ] as const) {
      expect((await request(f.app).post('/users/me/export/archive').send(body)).status).toBe(
        status
      );
    }
    expect(f.sql.connect).not.toHaveBeenCalled();
    const anonymous = httpFixture(undefined, '', false);
    expect(
      (
        await request(anonymous.app)
          .post('/users/me/export/archive')
          .send({ currentPassword: 'correct-password' })
      ).status
    ).toBe(401);
    expect(anonymous.hasher.verify).not.toHaveBeenCalled();
  });

  it('streams attachment with no-store and exact footer digest/counts only after commit and audit', async () => {
    const f = httpFixture();
    const response = await request(f.app)
      .post('/users/me/export/archive')
      .send({ currentPassword: 'correct-password' });
    expect(response.status).toBe(200);
    expect(response.headers['content-type']).toContain('application/x-ndjson');
    expect(response.headers['content-disposition']).toContain('.ndjson');
    expect(response.headers['cache-control']).toBe('no-store');
    const lines = response.text.trimEnd().split('\n'),
      footer = JSON.parse(lines.pop()!);
    expect(footer).toMatchObject({
      type: 'complete',
      records: 2,
      counts: { profile: 1, notes: 1 }
    });
    expect(footer.sha256).toBe(
      createHash('sha256')
        .update(lines.join('\n') + '\n')
        .digest('hex')
    );
    expect(f.audit.log).toHaveBeenCalledWith(
      expect.objectContaining({ eventType: 'user.domain_archive.generated', outcome: 'success' })
    );
    expect(JSON.stringify(f.audit.log.mock.calls)).not.toContain('Personal note');
    expect(response.text).not.toMatch(/correct-password|private-hash|private database/);
  });

  it('an abort while audit is stalled never emits a completion footer or holds the export client', async () => {
    const f = httpFixture(),
      abort = new AbortController();
    f.audit.log.mockImplementationOnce(() => new Promise(() => {}));
    const stream = f.service.streamUserArchive('user-a', abort.signal);
    await stream.next();
    await stream.next();
    await stream.next();
    const pending = expect(stream.next()).rejects.toMatchObject({ httpStatus: 503 });
    await vi.waitFor(() => expect(f.audit.log).toHaveBeenCalledOnce());
    abort.abort();
    await pending;
    expect(f.sql.release).toHaveBeenCalledExactlyOnceWith();
  });

  it('rate-limit failure happens before password work or DB acquisition', async () => {
    const f = httpFixture({
      consume: vi.fn(async () => {
        throw AppError.serviceUnavailable();
      })
    } as unknown as RateLimiter);
    const response = await request(f.app)
      .post('/users/me/export/archive')
      .send({ currentPassword: 'correct-password' });
    expect(response.status).toBe(503);
    expect(f.hasher.verify).not.toHaveBeenCalled();
    expect(f.sql.connect).not.toHaveBeenCalled();
  });

  it('pre-header DB failure has a sanitized ordinary 503, not an NDJSON success', async () => {
    const f = httpFixture(undefined, 'DECLARE');
    const response = await request(f.app)
      .post('/users/me/export/archive')
      .send({ currentPassword: 'correct-password' });
    expect(response.status).toBe(503);
    expect(response.text).not.toContain('private database');
    expect(response.headers['content-disposition']).toBeUndefined();
    expect(f.audit.log).not.toHaveBeenCalled();
  });

  it('waits for drain before fetching further chunks, then finishes normally (response spy)', async () => {
    const f = httpFixture();
    const req = new EventEmitter() as Request;
    req.user = { id: 'user-a' } as NonNullable<Request['user']>;
    Object.assign(req, { body: { currentPassword: 'correct-password' }, headers: {}, socket: {} });
    const res = new EventEmitter() as Response;
    const write = vi.fn().mockReturnValueOnce(false).mockReturnValue(true);
    Object.assign(res, {
      status: vi.fn(() => res),
      setHeader: vi.fn(),
      removeHeader: vi.fn(),
      write,
      end: vi.fn(),
      destroy: vi.fn(),
      destroyed: false
    });
    const done = f.controller.exportUserArchive(req, res, vi.fn());
    await vi.waitFor(() => expect(write).toHaveBeenCalledOnce());
    expect(f.sql.query.mock.calls.filter(([sql]) => sql.startsWith('DECLARE'))).toHaveLength(1);
    res.emit('drain');
    await done;
    expect(res.end).toHaveBeenCalledOnce();
    expect(res.destroy).not.toHaveBeenCalled();
    expect(res.listenerCount('close')).toBe(0);
  });

  it('a mid-stream DB failure destroys the response without footer, audit success or error payload', async () => {
    const f = httpFixture(undefined, 'CLOSE');
    const req = new EventEmitter() as Request;
    req.user = { id: 'user-a' } as NonNullable<Request['user']>;
    Object.assign(req, { body: { currentPassword: 'correct-password' }, headers: {}, socket: {} });
    const res = new EventEmitter() as Response,
      chunks: string[] = [];
    Object.assign(res, {
      status: () => res,
      setHeader: vi.fn(),
      write: (line: string) => {
        chunks.push(line);
        Object.assign(res, { headersSent: true });
        return true;
      },
      end: vi.fn(),
      destroy: vi.fn(),
      destroyed: false
    });
    const next = vi.fn();
    await f.controller.exportUserArchive(req, res, next);
    expect(res.destroy).toHaveBeenCalledOnce();
    expect(res.end).not.toHaveBeenCalled();
    expect(next).not.toHaveBeenCalled();
    expect(chunks.join('')).not.toMatch(/"type":"complete"|private database|"error"/);
    expect(f.audit.log).not.toHaveBeenCalled();
  });
});
