/**
 * tests/unit/ai-memories.test.ts
 *
 * Hybrid AI slice AI-3 (explicit memory, D4):
 *  - strict request schemas (kinds, 500 characters, no control characters)
 *  - saving needs both memory switches; 100 active items at most; listing,
 *    editing and deleting always work; another account's id is a 404
 *  - every SQL statement is scoped by user_id; saving is one transaction that
 *    locks the settings row; until the owner SQL ran the API degrades (503 or
 *    an empty list with available: false)
 *  - what the assistant may receive is capped
 *  - the owner SQL, schema snapshots, account lifecycle and grant drafts stay
 *    in step with the migration
 */
import { readFileSync } from 'node:fs';
import express, { type RequestHandler } from 'express';
import request from 'supertest';
import type pg from 'pg';
import { describe, expect, it, vi } from 'vitest';
import { MemoryRateLimiter } from '../../src/core/middleware/rate-limiter.js';
import { globalErrorHandler } from '../../src/core/middleware/error-handler.js';
import { successEnvelopeMiddleware } from '../../src/core/middleware/success-envelope.js';
import { AiService } from '../../src/features/ai/ai.service.js';
import { createAiRouter } from '../../src/features/ai/ai.routes.js';
import type { AiMemoriesRepository } from '../../src/features/ai-memories/ai-memories.repository.js';
import { PgAiMemoriesRepository } from '../../src/features/ai-memories/ai-memories.repository.pg.js';
import {
  AI_MEMORIES_USER_LIMIT,
  createAiMemoriesRouter
} from '../../src/features/ai-memories/ai-memories.routes.js';
import { AiMemoriesService } from '../../src/features/ai-memories/ai-memories.service.js';
import {
  AI_MEMORY_CONTEXT_CAPS,
  AI_MEMORY_LIMITS,
  type AiMemoryItem
} from '../../src/features/ai-memories/ai-memories.types.js';
import {
  createAiMemorySchema,
  listAiMemoriesQuerySchema,
  updateAiMemorySchema
} from '../../src/features/ai-memories/ai-memories.validation.js';
import { ACCOUNT_ARCHIVE_OWNED_EXCLUSIONS } from '../../src/features/users/account-archive.sources.js';
import {
  OPTIONAL_USER_OWNED_TABLES,
  USER_OWNED_TABLES_IN_DELETE_ORDER
} from '../../src/features/users/users.repository.pg.js';

const repoFile = (relative: string) =>
  readFileSync(new URL(`../../../${relative}`, import.meta.url), 'utf8');
const migrationSource = repoFile(
  'backend/src/infrastructure/database/postgres/migrations/1792800000000_ai_memory_items.cjs'
);

const ID = '6f1c1d2e-3b4a-4c5d-8e9f-0a1b2c3d4e5f';

const item: AiMemoryItem = {
  id: ID,
  kind: 'preference',
  content: 'Keep answers short',
  source: 'explicit',
  status: 'active',
  createdAt: '2026-11-12T10:00:00.000Z',
  updatedAt: '2026-11-12T10:00:00.000Z'
};

function fakeRepo(overrides?: Partial<AiMemoriesRepository>): AiMemoriesRepository {
  return {
    list: vi.fn(async () => ({ available: true as const, items: [item], truncated: false })),
    createExplicit: vi.fn(async () => ({
      available: true as const,
      outcome: 'created' as const,
      item
    })),
    update: vi.fn(async () => ({ available: true as const, item })),
    remove: vi.fn(async () => ({ available: true as const, deleted: 1 })),
    removeAll: vi.fn(async () => ({ available: true as const, deleted: 3 })),
    listForContext: vi.fn(async () => ({
      available: true as const,
      items: [{ kind: 'preference' as const, content: 'Keep answers short' }]
    })),
    ...overrides
  };
}

const missingTable = () => Object.assign(new Error('relation does not exist'), { code: '42P01' });

const row = {
  id: ID,
  kind: 'preference',
  content: 'Keep answers short',
  source: 'explicit',
  status: 'active',
  created_at: new Date('2026-11-12T10:00:00Z'),
  updated_at: new Date('2026-11-12T10:00:00Z')
};

describe('AI memory request schemas', () => {
  it('accepts both kinds, trims the text and allows line breaks', () => {
    expect(createAiMemorySchema.parse({ kind: 'fact', content: '  I work nights  ' })).toEqual({
      kind: 'fact',
      content: 'I work nights'
    });
    expect(
      createAiMemorySchema.safeParse({ kind: 'preference', content: 'Line one\nLine two\tok' })
        .success
    ).toBe(true);
    expect(createAiMemorySchema.safeParse({ kind: 'fact', content: 'x'.repeat(500) }).success).toBe(
      true
    );
    for (const body of [{ kind: 'fact' }, { content: 'Short' }, { kind: 'fact', content: 'New' }]) {
      expect(updateAiMemorySchema.safeParse(body).success, JSON.stringify(body)).toBe(true);
    }
  });

  it('rejects unknown keys, other kinds, blank, long and control-character texts', () => {
    for (const body of [
      {},
      { kind: 'fact' },
      { content: 'No kind' },
      { kind: 'secret', content: 'x' },
      { kind: 'fact', content: '   ' },
      { kind: 'fact', content: 'x'.repeat(501) },
      { kind: 'fact', content: 'bell\u0007' },
      { kind: 'fact', content: 'x', source: 'learned' },
      { kind: 'fact', content: 'x', status: 'active' },
      { kind: 'fact', content: 'x', userId: 'someone-else' },
      { kind: 'fact', content: 42 }
    ]) {
      expect(createAiMemorySchema.safeParse(body).success, JSON.stringify(body)).toBe(false);
    }
    for (const body of [{}, { status: 'dismissed' }, { content: '' }, { kind: 'fact', id: ID }]) {
      expect(updateAiMemorySchema.safeParse(body).success, JSON.stringify(body)).toBe(false);
    }
    expect(listAiMemoriesQuerySchema.safeParse({ status: 'pending' }).success).toBe(true);
    for (const query of [{ status: 'dismissed' }, { status: ['active'] }, { userId: 'x' }]) {
      expect(listAiMemoriesQuerySchema.safeParse(query).success, JSON.stringify(query)).toBe(false);
    }
  });
});

describe('AiMemoriesService', () => {
  it('lists active items by default and shows an empty, unavailable list before the owner SQL', async () => {
    const repo = fakeRepo();
    await expect(new AiMemoriesService(repo).list('user-1')).resolves.toEqual({
      items: [item],
      truncated: false,
      available: true
    });
    expect(repo.list).toHaveBeenCalledWith('user-1', 'active', AI_MEMORY_LIMITS.listMax);
    const missing = fakeRepo({ list: vi.fn(async () => ({ available: false as const })) });
    await expect(new AiMemoriesService(missing).list('user-1', 'pending')).resolves.toEqual({
      items: [],
      truncated: false,
      available: false
    });
  });

  it('saves with the active-item limit and maps the refusals', async () => {
    const repo = fakeRepo();
    await expect(
      new AiMemoriesService(repo).create('user-1', { kind: 'fact', content: 'x' })
    ).resolves.toEqual(item);
    expect(repo.createExplicit).toHaveBeenCalledWith(
      'user-1',
      { kind: 'fact', content: 'x' },
      AI_MEMORY_LIMITS.maxActive
    );
    for (const [result, status, code] of [
      [{ available: false as const }, 503, 'AI_MEMORY_UNAVAILABLE'],
      [{ available: true as const, outcome: 'disabled' as const }, 403, 'AI_MEMORY_DISABLED'],
      [{ available: true as const, outcome: 'limit' as const }, 409, 'AI_MEMORY_LIMIT']
    ] as const) {
      const service = new AiMemoriesService(
        fakeRepo({ createExplicit: vi.fn(async () => result) })
      );
      await expect(service.create('user-1', { kind: 'fact', content: 'x' })).rejects.toMatchObject({
        httpStatus: status,
        code
      });
    }
  });

  it('answers 404 for a missing or foreign item and 503 before the owner SQL', async () => {
    const none = new AiMemoriesService(
      fakeRepo({
        update: vi.fn(async () => ({ available: true as const, item: null })),
        remove: vi.fn(async () => ({ available: true as const, deleted: 0 }))
      })
    );
    await expect(none.update('user-1', ID, { content: 'x' })).rejects.toMatchObject({
      httpStatus: 404
    });
    await expect(none.remove('user-1', ID)).rejects.toMatchObject({ httpStatus: 404 });
    const missing = new AiMemoriesService(
      fakeRepo({
        update: vi.fn(async () => ({ available: false as const })),
        remove: vi.fn(async () => ({ available: false as const })),
        removeAll: vi.fn(async () => ({ available: false as const }))
      })
    );
    for (const call of [
      () => missing.update('user-1', ID, { content: 'x' }),
      () => missing.remove('user-1', ID),
      () => missing.removeAll('user-1')
    ]) {
      await expect(call()).rejects.toMatchObject({
        httpStatus: 503,
        code: 'AI_MEMORY_UNAVAILABLE'
      });
    }
    await expect(new AiMemoriesService(fakeRepo()).removeAll('user-1')).resolves.toEqual({
      deleted: 3
    });
  });

  it('gives the assistant at most the capped items and characters, newest first', async () => {
    const items = Array.from({ length: AI_MEMORY_CONTEXT_CAPS.items }, (_, i) => ({
      kind: 'fact' as const,
      content: `${i}`.padEnd(400, '.')
    }));
    const repo = fakeRepo({
      listForContext: vi.fn(async () => ({ available: true as const, items }))
    });
    const picked = await new AiMemoriesService(repo).forContext('user-1');
    expect(repo.listForContext).toHaveBeenCalledWith('user-1', AI_MEMORY_CONTEXT_CAPS.items);
    // 15 x 400 = 6,000 characters fit; the 16th would not.
    expect(picked).toHaveLength(15);
    expect(picked[0]!.content.startsWith('0')).toBe(true);
    expect(picked.reduce((sum, m) => sum + m.content.length, 0)).toBeLessThanOrEqual(
      AI_MEMORY_CONTEXT_CAPS.chars
    );
  });

  it('never fails the assistant turn: no table or a read error gives no memories', async () => {
    const missing = fakeRepo({
      listForContext: vi.fn(async () => ({ available: false as const }))
    });
    await expect(new AiMemoriesService(missing).forContext('user-1')).resolves.toEqual([]);
    const broken = fakeRepo({
      listForContext: vi.fn(async () => {
        throw new Error('connection reset');
      })
    });
    await expect(new AiMemoriesService(broken).forContext('user-1')).resolves.toEqual([]);
  });
});

/** A pool whose transaction client answers each statement from `answer`. */
function transactionPool(answer: (sql: string) => unknown) {
  const statements: Array<{ sql: string; params: unknown[] | undefined }> = [];
  const client = {
    query: vi.fn(async (sql: string, params?: unknown[]) => {
      statements.push({ sql, params });
      return answer(sql);
    }),
    release: vi.fn((_discard?: boolean) => undefined)
  };
  const pool = {
    query: vi.fn(async (_sql: string, _params: unknown[]) => ({ rows: [], rowCount: 0 })),
    connect: vi.fn(async () => client)
  };
  return { pool, client, statements };
}

describe('PgAiMemoriesRepository', () => {
  const enabled = { rows: [{ memory_enabled: true, explicit_memory_enabled: true }] };

  it('saves in one transaction that locks the settings row before counting', async () => {
    const { pool, client, statements } = transactionPool((sql) => {
      if (sql.includes('FROM ai_user_settings')) return enabled;
      if (sql.includes('count(*)')) return { rows: [{ n: 99 }] };
      if (sql.includes('INSERT INTO ai_memory_items')) return { rows: [row] };
      return { rows: [] };
    });
    const repo = new PgAiMemoriesRepository(pool as unknown as pg.Pool);
    await expect(
      repo.createExplicit('user-1', { kind: 'preference', content: 'Keep answers short' }, 100)
    ).resolves.toEqual({ available: true, outcome: 'created', item });
    expect(statements.map((s) => s.sql.trim().split(/\s+/)[0])).toEqual([
      'BEGIN',
      'SELECT',
      'SELECT',
      'INSERT',
      'COMMIT'
    ]);
    expect(statements[1]!.sql).toContain('FOR UPDATE OF s');
    expect(statements[1]!.sql).toContain("u.status = 'active'");
    for (const statement of statements.slice(1, 4)) {
      expect(statement.params?.[0]).toBe('user-1');
    }
    expect(statements[3]!.sql).toContain("'explicit', 'active'");
    expect(client.release).toHaveBeenCalledWith(false);
  });

  it.each([
    ['memory is off', { rows: [{ memory_enabled: false, explicit_memory_enabled: true }] }],
    ['saving is off', { rows: [{ memory_enabled: true, explicit_memory_enabled: false }] }],
    ['no settings were saved', { rows: [] }]
  ])('refuses without inserting when %s', async (_label, settings) => {
    const { pool, statements } = transactionPool((sql) =>
      sql.includes('FROM ai_user_settings') ? settings : { rows: [] }
    );
    const repo = new PgAiMemoriesRepository(pool as unknown as pg.Pool);
    await expect(
      repo.createExplicit('user-1', { kind: 'fact', content: 'x' }, 100)
    ).resolves.toEqual({ available: true, outcome: 'disabled' });
    expect(statements.map((s) => s.sql)).toContain('ROLLBACK');
    expect(statements.some((s) => s.sql.includes('INSERT'))).toBe(false);
  });

  it('refuses at the active-item limit', async () => {
    const { pool, statements } = transactionPool((sql) => {
      if (sql.includes('FROM ai_user_settings')) return enabled;
      if (sql.includes('count(*)')) return { rows: [{ n: 100 }] };
      return { rows: [] };
    });
    const repo = new PgAiMemoriesRepository(pool as unknown as pg.Pool);
    await expect(
      repo.createExplicit('user-1', { kind: 'fact', content: 'x' }, 100)
    ).resolves.toEqual({ available: true, outcome: 'limit' });
    expect(statements.at(-1)!.sql).toBe('ROLLBACK');
  });

  it('rolls back and reports unavailable without the table; other errors are thrown', async () => {
    const missing = transactionPool((sql) => {
      if (sql.includes('FROM ai_user_settings')) return enabled;
      if (sql.includes('count(*)')) throw missingTable();
      return { rows: [] };
    });
    await expect(
      new PgAiMemoriesRepository(missing.pool as unknown as pg.Pool).createExplicit(
        'user-1',
        { kind: 'fact', content: 'x' },
        100
      )
    ).resolves.toEqual({ available: false });
    expect(missing.statements.at(-1)!.sql).toBe('ROLLBACK');

    const broken = transactionPool((sql) => {
      if (sql === 'ROLLBACK') throw new Error('connection lost');
      if (sql.includes('FROM ai_user_settings')) throw new Error('connection reset');
      return { rows: [] };
    });
    await expect(
      new PgAiMemoriesRepository(broken.pool as unknown as pg.Pool).createExplicit(
        'user-1',
        { kind: 'fact', content: 'x' },
        100
      )
    ).rejects.toThrow('connection reset');
    // A failed ROLLBACK leaves an uncertain connection: it is discarded.
    expect(broken.client.release).toHaveBeenCalledWith(true);
  });

  it('scopes every other statement by the account and reads newest first', async () => {
    const query = vi.fn(async (sql: string, _params: unknown[]) => {
      if (sql.startsWith('SELECT kind, content')) {
        return { rows: [{ kind: 'fact', content: 'Night shifts' }], rowCount: 1 };
      }
      if (sql.includes('RETURNING') || sql.startsWith('SELECT')) {
        return { rows: [row, row], rowCount: 2 };
      }
      return { rows: [], rowCount: 2 };
    });
    const repo = new PgAiMemoriesRepository({ query, connect: vi.fn() } as unknown as pg.Pool);
    await expect(repo.list('user-1', 'active', 1)).resolves.toEqual({
      available: true,
      items: [item],
      truncated: true
    });
    await repo.update('user-1', ID, { content: 'Short' });
    await expect(repo.remove('user-1', ID)).resolves.toEqual({ available: true, deleted: 2 });
    await expect(repo.removeAll('user-1')).resolves.toEqual({ available: true, deleted: 2 });
    await expect(repo.listForContext('user-1', 30)).resolves.toEqual({
      available: true,
      items: [{ kind: 'fact', content: 'Night shifts' }]
    });
    const [listCall, updateCall, removeCall, removeAllCall, contextCall] = query.mock.calls;
    expect(listCall![0]).toMatch(/WHERE user_id = \$1 AND status = \$2/);
    expect(listCall![0]).toContain('ORDER BY created_at DESC, id DESC');
    expect(listCall![1]).toEqual(['user-1', 'active', 2]);
    expect(updateCall![0]).toMatch(/WHERE id = \$1 AND user_id = \$2 AND status <> 'dismissed'/);
    expect(updateCall![1]).toEqual([ID, 'user-1', null, 'Short']);
    expect(removeCall![0]).toBe('DELETE FROM ai_memory_items WHERE id = $1 AND user_id = $2');
    expect(removeAllCall![0]).toBe('DELETE FROM ai_memory_items WHERE user_id = $1');
    expect(contextCall![0]).toContain("status = 'active'");
    expect(contextCall![0]).toContain('expires_at IS NULL OR expires_at > now()');
    expect(contextCall![0]).toContain('ORDER BY updated_at DESC, id DESC');
    expect(contextCall![1]).toEqual(['user-1', 30]);
    for (const [sql] of query.mock.calls) {
      expect(sql).not.toMatch(/SELECT\s+\*/);
    }
  });

  it('reports unavailable for every read and change before the owner SQL', async () => {
    const repo = new PgAiMemoriesRepository({
      query: vi.fn(async () => {
        throw missingTable();
      }),
      connect: vi.fn()
    } as unknown as pg.Pool);
    await expect(repo.list('user-1', 'active', 100)).resolves.toEqual({ available: false });
    await expect(repo.update('user-1', ID, { kind: 'fact' })).resolves.toEqual({
      available: false
    });
    await expect(repo.remove('user-1', ID)).resolves.toEqual({ available: false });
    await expect(repo.removeAll('user-1')).resolves.toEqual({ available: false });
    await expect(repo.listForContext('user-1', 30)).resolves.toEqual({ available: false });
  });
});

function buildTestApp(memories: AiMemoriesService, ai: AiService) {
  const app = express();
  app.use(express.json());
  const authenticate: RequestHandler = (req, _res, next) => {
    const id = req.header('x-test-user');
    if (id) {
      req.user = {
        id,
        email: 'user@example.com',
        status: 'active',
        timezone: 'Africa/Cairo',
        locale: 'ar',
        weekStart: 0,
        defaultCurrency: 'EGP',
        pushShowTitles: true
      };
    }
    next();
  };
  const rateLimiter = new MemoryRateLimiter();
  // Same order as app.ts: memories first, then the AI router with its kill switch.
  app.use(
    '/api/v1/ai/memories',
    successEnvelopeMiddleware,
    createAiMemoriesRouter({ service: memories, authenticate, rateLimiter })
  );
  app.use(
    '/api/v1/ai',
    successEnvelopeMiddleware,
    createAiRouter({ service: ai, authenticate, rateLimiter, minuteLimit: 1, dailyLimit: 1 })
  );
  app.use(globalErrorHandler);
  return app;
}

describe('AI memory HTTP surface', () => {
  const disabledAi = new AiService(null, false);
  const URL_ROOT = '/api/v1/ai/memories';

  it('requires authentication', async () => {
    const app = buildTestApp(new AiMemoriesService(fakeRepo()), disabledAi);
    expect((await request(app).get(URL_ROOT)).status).toBe(401);
    expect((await request(app).post(URL_ROOT).send({ kind: 'fact', content: 'x' })).status).toBe(
      401
    );
    expect((await request(app).delete(`${URL_ROOT}/${ID}`)).status).toBe(401);
  });

  it('works while the AI kill switch is off, with the expected status codes', async () => {
    const repo = fakeRepo();
    const app = buildTestApp(new AiMemoriesService(repo), disabledAi);
    const as = (req: request.Test) => req.set('x-test-user', 'user-1');

    const listed = await as(request(app).get(`${URL_ROOT}?status=pending`));
    expect(listed.status).toBe(200);
    expect(listed.headers['cache-control']).toBe('no-store');
    expect(listed.body.data).toEqual({ items: [item], truncated: false, available: true });
    expect(repo.list).toHaveBeenCalledWith('user-1', 'pending', AI_MEMORY_LIMITS.listMax);

    const saved = await as(request(app).post(URL_ROOT)).send({
      kind: 'preference',
      content: ' Hi '
    });
    expect(saved.status).toBe(201);
    expect(repo.createExplicit).toHaveBeenCalledWith(
      'user-1',
      { kind: 'preference', content: 'Hi' },
      AI_MEMORY_LIMITS.maxActive
    );

    const edited = await as(request(app).patch(`${URL_ROOT}/${ID}`)).send({ content: 'New' });
    expect(edited.status).toBe(200);
    expect(repo.update).toHaveBeenCalledWith('user-1', ID, { content: 'New' });

    const removed = await as(request(app).delete(`${URL_ROOT}/${ID}`));
    expect(removed.status).toBe(204);
    expect(repo.remove).toHaveBeenCalledWith('user-1', ID);

    const cleared = await as(request(app).delete(URL_ROOT));
    expect(cleared.status).toBe(200);
    expect(cleared.body.data).toEqual({ deleted: 3 });
  });

  it('answers 400 for bad ids, bodies and queries without touching the repository', async () => {
    const repo = fakeRepo();
    const app = buildTestApp(new AiMemoriesService(repo), disabledAi);
    const as = (req: request.Test) => req.set('x-test-user', 'user-1');
    expect(
      (await as(request(app).patch(`${URL_ROOT}/not-a-uuid`)).send({ content: 'x' })).status
    ).toBe(400);
    expect((await as(request(app).delete(`${URL_ROOT}/1`))).status).toBe(400);
    expect((await as(request(app).post(URL_ROOT)).send({ kind: 'fact' })).status).toBe(400);
    expect(
      (await as(request(app).post(URL_ROOT)).send({ kind: 'fact', content: 'x', status: 'active' }))
        .status
    ).toBe(400);
    expect((await as(request(app).get(`${URL_ROOT}?status=dismissed`))).status).toBe(400);
    expect(repo.list).not.toHaveBeenCalled();
    expect(repo.createExplicit).not.toHaveBeenCalled();
    expect(repo.update).not.toHaveBeenCalled();
    expect(repo.remove).not.toHaveBeenCalled();
  });

  it('passes the refusals on with their codes', async () => {
    const as = (req: request.Test) => req.set('x-test-user', 'user-1');
    const disabled = buildTestApp(
      new AiMemoriesService(
        fakeRepo({
          createExplicit: vi.fn(async () => ({
            available: true as const,
            outcome: 'disabled' as const
          }))
        })
      ),
      disabledAi
    );
    const refused = await as(request(disabled).post(URL_ROOT)).send({ kind: 'fact', content: 'x' });
    expect(refused.status).toBe(403);
    expect(refused.body.error.code).toBe('AI_MEMORY_DISABLED');
    const missing = buildTestApp(
      new AiMemoriesService(
        fakeRepo({ remove: vi.fn(async () => ({ available: true as const, deleted: 0 })) })
      ),
      disabledAi
    );
    expect((await as(request(missing).delete(`${URL_ROOT}/${ID}`))).status).toBe(404);
  });

  it('limits each account to 30 requests a minute', async () => {
    const app = buildTestApp(new AiMemoriesService(fakeRepo()), disabledAi);
    for (let i = 0; i < AI_MEMORIES_USER_LIMIT; i++) {
      expect((await request(app).get(URL_ROOT).set('x-test-user', 'user-1')).status).toBe(200);
    }
    expect((await request(app).get(URL_ROOT).set('x-test-user', 'user-1')).status).toBe(429);
    expect((await request(app).get(URL_ROOT).set('x-test-user', 'user-2')).status).toBe(200);
  });
});

describe('owner-run production SQL (AI-3)', () => {
  it('is byte-identical to the forward-only migration body and runs in one transaction', () => {
    const migrationBody = /pgm\.sql\(`\n([\s\S]*?)\n\s*`\);/.exec(migrationSource)![1]!;
    const ownerSql = repoFile('docs/ai/sql/ai-memory-items.sql');
    const ownerBody = /-- BEGIN MIGRATION BODY\n([\s\S]*?)\n-- END MIGRATION BODY/.exec(
      ownerSql
    )![1]!;
    expect(ownerBody).toBe(migrationBody);
    expect(ownerSql).toMatch(/\nBEGIN;\n-- BEGIN MIGRATION BODY/);
    expect(ownerSql.trimEnd().endsWith('-- END MIGRATION BODY\nCOMMIT;')).toBe(true);
    expect(ownerSql).toContain('must NOT be run there');
    expect(ownerSql).toContain('docs/ai/sql/ai-user-settings.sql');
    expect(migrationSource).toMatch(/exports\.down = \(\) => \{\n\s*throw new Error/);
  });

  it('keeps the database limits identical to the API', () => {
    expect(migrationSource).toContain(
      `char_length(content) BETWEEN 1 AND ${AI_MEMORY_LIMITS.contentMaxChars}`
    );
    expect(migrationSource).toContain("kind IN ('preference', 'fact')");
    expect(migrationSource).toContain("source IN ('explicit', 'learned')");
    expect(migrationSource).toContain("status IN ('pending', 'active', 'dismissed')");
    expect(migrationSource).toContain("CHECK (source = 'learned' OR status <> 'pending')");
    expect(migrationSource).toContain('ON ai_memory_items (user_id, status)');
    // Memory text only: no provider, prompt or reply column.
    const body = /pgm\.sql\(`\n([\s\S]*?)\n\s*`\);/.exec(migrationSource)![1]!;
    expect(body).not.toMatch(/provider|prompt|reply/i);
  });

  it('keeps both schema snapshots in step with the migration', () => {
    for (const snapshot of [
      'schema.sql',
      'backend/src/infrastructure/database/postgres/schema-sql.ts'
    ]) {
      const text = repoFile(snapshot).replace(/\\n/g, '\n').replace(/\\"/g, '"');
      expect(text, snapshot).toContain('CREATE TABLE ai_memory_items (');
      expect(text, snapshot).toContain(
        'user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,'
      );
      expect(text, snapshot).toContain(
        'GRANT SELECT, INSERT, UPDATE, DELETE ON ai_memory_items TO lifestyle_app;'
      );
    }
  });

  it('is erased with the account, optional until applied, and excluded from the v1 archive', () => {
    expect(USER_OWNED_TABLES_IN_DELETE_ORDER).toContain('ai_memory_items');
    expect(OPTIONAL_USER_OWNED_TABLES.has('ai_memory_items')).toBe(true);
    expect(ACCOUNT_ARCHIVE_OWNED_EXCLUSIONS).toContain('ai_memory_items');
  });

  it('grants the runtime role CRUD in both runtime-grant drafts', () => {
    for (const draft of [
      'docs/remediation/drafts/neon-runtime-role-and-marker.sql',
      'docs/remediation/drafts/1792900000000_runtime_grants_rehearsal.cjs'
    ]) {
      expect(repoFile(draft), draft).toContain(
        'GRANT SELECT, INSERT, UPDATE, DELETE ON public.ai_memory_items TO lifestyle_app;'
      );
    }
  });
});
