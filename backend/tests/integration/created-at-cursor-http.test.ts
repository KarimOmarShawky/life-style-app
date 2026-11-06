import '../infrastructure-safety.js';
import { beforeEach, describe, expect, it } from 'vitest';
import express from 'express';
import request from 'supertest';
import { createApp } from '../../src/app.js';
import { getPgPool } from '../../src/infrastructure/database/postgres/pool.js';
import { getRedisClient } from '../../src/infrastructure/redis/redis-client.js';
import { getContainer } from '../../src/container.js';
import { globalErrorHandler } from '../../src/core/middleware/error-handler.js';

describe('created-at pagination over HTTP and PostgreSQL', () => {
  const app = createApp();
  const pool = getPgPool();
  beforeEach(async () => {
    await pool.query('DELETE FROM users');
    await getRedisClient().flushdb();
    const limiter = getContainer().rateLimiter;
    if ('clear' in limiter && typeof limiter.clear === 'function') limiter.clear();
  });
  async function register(email: string) {
    const res = await request(app).post('/api/v1/auth/register').send({
      email,
      password: 'ValidUserPassword123!',
      displayName: 'Cursor User',
      timezone: 'UTC',
      defaultCurrency: 'USD'
    });
    expect(res.status).toBe(201);
    return res.body.data.tokens.accessToken as string;
  }
  const cases = [
    {
      path: '/api/v1/habits',
      table: 'habits',
      key: 'habit',
      data: {
        name: 'Test habit',
        startDate: '2026-01-01',
        recurrence: { freq: 'daily', interval: 1 }
      }
    },
    { path: '/api/v1/projects', table: 'projects', key: 'project', data: { name: 'Test project' } },
    {
      path: '/api/v1/recurring-tasks',
      table: 'recurring_tasks',
      key: 'recurringTask',
      data: {
        title: 'Test recurring',
        recurrence: { freq: 'daily', interval: 1, startDate: '2026-01-01' }
      }
    }
  ];
  it.each(cases)(
    'traverses every $table row once at microsecond and tied boundaries',
    async ({ path, table, key, data }) => {
      const token = await register('cursor@example.com');
      const otherToken = await register('foreign@example.com');
      const ids: string[] = [];
      for (let i = 0; i < 4; i++) {
        const res = await request(app)
          .post(path)
          .set('Authorization', `Bearer ${token}`)
          .send(data);
        expect(res.status).toBe(201);
        ids.push(res.body.data[key].id);
      }
      const foreign = await request(app)
        .post(path)
        .set('Authorization', `Bearer ${otherToken}`)
        .send(data);
      expect(foreign.status).toBe(201);
      // Table names come from the fixed cases above, not user input.
      await pool.query(
        `UPDATE ${table} SET created_at = CASE id
      WHEN $1::uuid THEN '2026-01-01 12:00:00.123456+00'::timestamptz
      WHEN $2::uuid THEN '2026-01-01 12:00:00.123455+00'::timestamptz
      WHEN $3::uuid THEN '2026-01-01 12:00:00.123455+00'::timestamptz
      WHEN $4::uuid THEN '2026-01-01 12:00:00.123000+00'::timestamptz
      ELSE '2026-01-01 12:00:00.123457+00'::timestamptz END
      WHERE id = ANY($5::uuid[])`,
        [ids[0], ids[1], ids[2], ids[3], [...ids, foreign.body.data[key].id]]
      );
      const seen: string[] = [];
      let cursor: string | null = null;
      for (let i = 0; i < 6; i++) {
        const query: Record<string, string> = { limit: '1' };
        if (cursor !== null) query.cursor = cursor;
        const page = await request(app)
          .get(path)
          .set('Authorization', `Bearer ${token}`)
          .query(query);
        expect(page.status).toBe(200);
        seen.push(...page.body.data.map((item: { id: string }) => item.id));
        cursor = page.body.meta.nextCursor;
        if (cursor === null) break;
      }
      expect(cursor).toBeNull();
      expect(seen).toEqual([ids[0], ...[ids[1], ids[2]].sort().reverse(), ids[3]]);
    }
  );
  it.each(cases)('rejects malformed $table cursors with a safe 400', async ({ path }) => {
    const token = await register('cursor@example.com');
    const legacyCursor = Buffer.from(
      JSON.stringify({
        id: 'd9b73678-75f1-432a-bc91-231362095cb7',
        createdAt: '2026-01-01T00:00:00.123Z'
      })
    ).toString('base64');
    const legacyPage = await request(app)
      .get(path)
      .set('Authorization', `Bearer ${token}`)
      .query({ limit: 1, cursor: legacyCursor });
    expect(legacyPage.status).toBe(200);
    for (const cursor of [
      'not-json!',
      Buffer.from(
        JSON.stringify({ id: 'not-a-uuid', createdAt: '2026-01-01T00:00:00.000Z' })
      ).toString('base64'),
      Buffer.from(
        JSON.stringify({ id: 'd9b73678-75f1-432a-bc91-231362095cb7', createdAt: 'bad' })
      ).toString('base64')
    ]) {
      const res = await request(app)
        .get(path)
        .set('Authorization', `Bearer ${token}`)
        .query({ limit: 1, cursor });
      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('VALIDATION_ERROR');
      expect(res.body.error.details).toEqual(
        expect.arrayContaining([expect.objectContaining({ field: 'cursor' })])
      );
    }
  });
  it('maps a real PostgreSQL 22P02 to a safe response', async () => {
    const endpoint = express();
    endpoint.get('/', async (_req, _res, next) => {
      try {
        await pool.query('SELECT $1::uuid', ['sensitive-non-uuid']);
      } catch (error) {
        next(error);
      }
    });
    endpoint.use(globalErrorHandler);
    const res = await request(endpoint).get('/');
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
    expect(JSON.stringify(res.body)).not.toContain('sensitive-non-uuid');
    expect(JSON.stringify(res.body)).not.toContain('SELECT');
  });
});
