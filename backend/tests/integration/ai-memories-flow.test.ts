import '../infrastructure-safety.js';
/**
 * tests/integration/ai-memories-flow.test.ts
 *
 * AI-3 against migrated PostgreSQL: explicit memory (the two switches, the
 * lifecycle, the 100-item limit under concurrent saves, isolation between
 * accounts, what the assistant receives, export, erasure and behaviour before
 * the owner-run SQL). No production data and no AI provider call.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import request from 'supertest';
import type pg from 'pg';
import { createApp } from '../../src/app.js';
import { getPgPool } from '../../src/infrastructure/database/postgres/pool.js';
import { getRedisClient } from '../../src/infrastructure/redis/redis-client.js';
import { getContainer } from '../../src/container.js';
import { PgUsersRepository } from '../../src/features/users/users.repository.pg.js';
import { AiMemoriesService } from '../../src/features/ai-memories/ai-memories.service.js';
import { PgAiMemoriesRepository } from '../../src/features/ai-memories/ai-memories.repository.pg.js';

const PASSWORD = 'ValidUserPassword123!';
const MEMORY_ON = { memoryEnabled: true, explicitMemoryEnabled: true };
const UNKNOWN_ID = '00000000-0000-4000-8000-000000000000';

describe('Explicit AI memory (AI-3) on PostgreSQL', () => {
  const app = createApp();
  const pool = getPgPool();
  const redis = getRedisClient();

  beforeEach(async () => {
    await pool.query('DELETE FROM users');
    await redis.flushdb();
    const container = getContainer();
    if ('clear' in container.rateLimiter && typeof container.rateLimiter.clear === 'function') {
      container.rateLimiter.clear();
    }
  });

  async function register(email: string) {
    const res = await request(app).post('/api/v1/auth/register').send({
      email,
      password: PASSWORD,
      displayName: 'Memory User',
      timezone: 'Africa/Cairo',
      defaultCurrency: 'USD'
    });
    expect(res.status).toBe(201);
    return res.body.data as { user: { id: string }; tokens: { accessToken: string } };
  }

  const bearer = (token: string) => `Bearer ${token}`;
  const list = (token: string, query = '', target = app) =>
    request(target).get(`/api/v1/ai/memories${query}`).set('Authorization', bearer(token));
  const create = (token: string, body: object, target = app) =>
    request(target).post('/api/v1/ai/memories').set('Authorization', bearer(token)).send(body);
  const edit = (token: string, id: string, body: object, target = app) =>
    request(target)
      .patch(`/api/v1/ai/memories/${id}`)
      .set('Authorization', bearer(token))
      .send(body);
  const remove = (token: string, id: string) =>
    request(app).delete(`/api/v1/ai/memories/${id}`).set('Authorization', bearer(token));
  const removeAll = (token: string, target = app) =>
    request(target).delete('/api/v1/ai/memories').set('Authorization', bearer(token));
  const settings = (token: string, body: object) =>
    request(app).patch('/api/v1/ai/settings').set('Authorization', bearer(token)).send(body);
  const errorCode = (res: request.Response) => res.body.error?.code ?? res.body.code;
  const activeCount = async (userId: string) =>
    (
      await pool.query(
        `SELECT count(*)::int AS n FROM ai_memory_items WHERE user_id = $1 AND status = 'active'`,
        [userId]
      )
    ).rows[0].n as number;

  it('saves only with both switches on; lists, edits and deletes at any time', async () => {
    const { tokens } = await register('memory@example.com');
    const token = tokens.accessToken;
    const off = await create(token, { kind: 'fact', content: 'I work nights' });
    expect(off.status).toBe(403);
    expect(errorCode(off)).toBe('AI_MEMORY_DISABLED');
    expect((await settings(token, { memoryEnabled: true })).status).toBe(200);
    expect((await create(token, { kind: 'fact', content: 'I work nights' })).status).toBe(403);
    expect((await settings(token, { explicitMemoryEnabled: true })).status).toBe(200);

    const saved = await create(token, { kind: 'preference', content: '  Keep answers short  ' });
    expect(saved.status).toBe(201);
    expect(saved.body.data).toMatchObject({
      kind: 'preference',
      content: 'Keep answers short',
      source: 'explicit',
      status: 'active'
    });
    const id = saved.body.data.id as string;

    const listed = await list(token);
    expect(listed.status).toBe(200);
    expect(listed.headers['cache-control']).toBe('no-store');
    expect(listed.body.data).toMatchObject({
      available: true,
      truncated: false,
      items: [{ id, content: 'Keep answers short' }]
    });

    const edited = await edit(token, id, { kind: 'fact', content: 'Very short answers' });
    expect(edited.status).toBe(200);
    expect(edited.body.data).toMatchObject({ id, kind: 'fact', content: 'Very short answers' });

    // With both switches off the memory can still be seen, corrected and deleted.
    expect(
      (await settings(token, { memoryEnabled: false, explicitMemoryEnabled: false })).status
    ).toBe(200);
    expect((await list(token)).body.data.items).toHaveLength(1);
    expect((await edit(token, id, { content: 'Short' })).status).toBe(200);
    expect((await remove(token, id)).status).toBe(204);
    expect((await remove(token, id)).status).toBe(404);
    expect((await list(token)).body.data.items).toEqual([]);
  });

  it('keeps every account to its own memories', async () => {
    const a = await register('a-memory@example.com');
    const b = await register('b-memory@example.com');
    for (const account of [a, b]) {
      expect((await settings(account.tokens.accessToken, MEMORY_ON)).status).toBe(200);
    }
    const saved = await create(a.tokens.accessToken, { kind: 'fact', content: 'Mine only' });
    expect(saved.status).toBe(201);
    const id = saved.body.data.id as string;

    expect((await list(b.tokens.accessToken)).body.data.items).toEqual([]);
    expect((await edit(b.tokens.accessToken, id, { content: 'Changed' })).status).toBe(404);
    expect((await remove(b.tokens.accessToken, id)).status).toBe(404);
    expect((await removeAll(b.tokens.accessToken)).body.data).toEqual({ deleted: 0 });
    expect((await list(a.tokens.accessToken)).body.data.items).toMatchObject([
      { id, content: 'Mine only' }
    ]);
    expect((await edit(a.tokens.accessToken, 'not-a-uuid', { content: 'x' })).status).toBe(400);
  });

  it('stops at 100 active memories, also for saves at the same moment', async () => {
    const { user, tokens } = await register('limit-memory@example.com');
    expect((await settings(tokens.accessToken, MEMORY_ON)).status).toBe(200);
    await pool.query(
      `INSERT INTO ai_memory_items (user_id, kind, content, source, status)
       SELECT $1, 'fact', 'note ' || n, 'explicit', 'active' FROM generate_series(1, 98) AS n`,
      [user.id]
    );
    const results = await Promise.all(
      [1, 2, 3].map((n) => create(tokens.accessToken, { kind: 'fact', content: `parallel ${n}` }))
    );
    expect(results.map((res) => res.status).sort()).toEqual([201, 201, 409]);
    expect(errorCode(results.find((res) => res.status === 409)!)).toBe('AI_MEMORY_LIMIT');
    expect(await activeCount(user.id)).toBe(100);

    const listed = await list(tokens.accessToken);
    expect(listed.body.data.items).toHaveLength(100);
    expect(listed.body.data.truncated).toBe(false);
    expect((await removeAll(tokens.accessToken)).body.data).toEqual({ deleted: 100 });
    expect(await activeCount(user.id)).toBe(0);

    // More rows than one list returns (only possible outside the API): flagged.
    await pool.query(
      `INSERT INTO ai_memory_items (user_id, kind, content, source, status)
       SELECT $1, 'fact', 'note ' || n, 'explicit', 'active' FROM generate_series(1, 101) AS n`,
      [user.id]
    );
    const more = await list(tokens.accessToken);
    expect(more.body.data.items).toHaveLength(100);
    expect(more.body.data.truncated).toBe(true);
  });

  it('gives the assistant only active memories, most recently changed first', async () => {
    const { user, tokens } = await register('context-memory@example.com');
    expect((await settings(tokens.accessToken, MEMORY_ON)).status).toBe(200);
    const first = await create(tokens.accessToken, { kind: 'fact', content: 'Older note' });
    expect(
      (await create(tokens.accessToken, { kind: 'preference', content: 'Newer note' })).status
    ).toBe(201);
    expect(
      (await edit(tokens.accessToken, first.body.data.id, { content: 'Older note, edited' })).status
    ).toBe(200);
    // A learned item waiting for review (AI-5) is never used.
    await pool.query(
      `INSERT INTO ai_memory_items (user_id, kind, content, source, status)
       VALUES ($1, 'fact', 'Pending learned note', 'learned', 'pending')`,
      [user.id]
    );
    const memories = new AiMemoriesService(new PgAiMemoriesRepository(pool));
    expect(await memories.forContext(user.id)).toEqual([
      { kind: 'fact', content: 'Older note, edited' },
      { kind: 'preference', content: 'Newer note' }
    ]);
    const pending = await list(tokens.accessToken, '?status=pending');
    expect(pending.body.data.items).toMatchObject([
      { content: 'Pending learned note', source: 'learned', status: 'pending' }
    ]);
    expect((await list(tokens.accessToken, '?status=dismissed')).status).toBe(400);
  });

  it('is in the account export and is erased with the account', async () => {
    const { user, tokens } = await register('export-memory@example.com');
    expect((await settings(tokens.accessToken, MEMORY_ON)).status).toBe(200);
    expect(
      (await create(tokens.accessToken, { kind: 'fact', content: 'Exported note' })).status
    ).toBe(201);
    const exported = await request(app)
      .post('/api/v1/users/me/export')
      .set('Authorization', bearer(tokens.accessToken))
      .send({ currentPassword: PASSWORD });
    expect(exported.status).toBe(200);
    expect(exported.body.aiMemories).toMatchObject([
      {
        kind: 'fact',
        content: 'Exported note',
        source: 'explicit',
        status: 'active',
        expiresAt: null
      }
    ]);

    const users = new PgUsersRepository(pool);
    await users.scheduleDeletion(user.id, new Date(Date.now() - 1000));
    expect(await users.purgeAccount(user.id)).toBe(true);
    expect(
      (
        await pool.query('SELECT count(*)::int AS n FROM ai_memory_items WHERE user_id = $1', [
          user.id
        ])
      ).rows[0].n
    ).toBe(0);
  });

  /**
   * Runs one request against an app whose memory repository cannot see the
   * table, as on a database without the owner SQL. Each call gets its own
   * transaction: after the expected 42P01 the transaction is aborted, so two
   * requests must never share one. Saving uses its own transaction and is
   * covered by the unit tests instead.
   */
  async function withoutTable<T>(run: (target: ReturnType<typeof createApp>) => Promise<T>) {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      // With only pg_catalog on the search path, PostgreSQL itself answers
      // 42P01 (relation does not exist).
      await client.query('SET LOCAL search_path = pg_catalog');
      const repo = new PgAiMemoriesRepository(
        client as unknown as Pick<pg.Pool, 'query' | 'connect'>
      );
      return await run(createApp({ aiMemoriesService: new AiMemoriesService(repo) }));
    } finally {
      await client.query('ROLLBACK');
      client.release();
    }
  }

  it('before the owner SQL: the list is empty and unavailable, changes answer 503', async () => {
    const { tokens } = await register('before-memory-sql@example.com');
    const shown = await withoutTable((target) => list(tokens.accessToken, '', target));
    expect(shown.status).toBe(200);
    expect(shown.body.data).toEqual({ items: [], truncated: false, available: false });
    const changed = await withoutTable((target) =>
      edit(tokens.accessToken, UNKNOWN_ID, { content: 'x' }, target)
    );
    expect(changed.status).toBe(503);
    expect(errorCode(changed)).toBe('AI_MEMORY_UNAVAILABLE');
    const cleared = await withoutTable((target) => removeAll(tokens.accessToken, target));
    expect(cleared.status).toBe(503);
  });
});
