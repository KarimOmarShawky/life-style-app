import '../infrastructure-safety.js';
/**
 * tests/integration/ai-reports-flow.test.ts
 *
 * AI-P against migrated PostgreSQL: reporting AI output (store, validation,
 * rate limit, export, erasure, retention, behaviour before the owner-run SQL).
 * No production data is used.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import request from 'supertest';
import { createApp } from '../../src/app.js';
import { getPgPool } from '../../src/infrastructure/database/postgres/pool.js';
import { getRedisClient } from '../../src/infrastructure/redis/redis-client.js';
import { getContainer } from '../../src/container.js';
import { SystemClock } from '../../src/core/time/clock.js';
import { PgUsersRepository } from '../../src/features/users/users.repository.pg.js';
import { AiReportsService } from '../../src/features/ai-reports/ai-reports.service.js';
import { PgAiReportsRepository } from '../../src/features/ai-reports/ai-reports.repository.pg.js';
import { AI_REPORTS_HOURLY_LIMIT } from '../../src/features/ai-reports/ai-reports.routes.js';

const PASSWORD = 'ValidUserPassword123!';

const report = {
  surface: 'assistant',
  category: 'offensive',
  replyText: 'A reply the user found offensive',
  note: 'Please check this',
  locale: 'ar'
};

describe('AI content reports (AI-P) on PostgreSQL', () => {
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
      displayName: 'Report User',
      timezone: 'Africa/Cairo',
      defaultCurrency: 'USD'
    });
    expect(res.status).toBe(201);
    return res.body.data as { user: { id: string }; tokens: { accessToken: string } };
  }

  const post = (token: string, body: object, target = app) =>
    request(target).post('/api/v1/ai/reports').set('Authorization', `Bearer ${token}`).send(body);

  it('stores a report for the authenticated account only, even while AI is off', async () => {
    const { user, tokens } = await register('report@example.com');
    const res = await post(tokens.accessToken, report);
    expect(res.status).toBe(201);
    expect(res.body.data).toEqual({ reported: true });
    expect(res.headers['cache-control']).toBe('no-store');

    const rows = (
      await pool.query(
        'SELECT user_id, surface, category, reply_text, note, locale FROM ai_content_reports'
      )
    ).rows;
    expect(rows).toEqual([
      {
        user_id: user.id,
        surface: 'assistant',
        category: 'offensive',
        reply_text: report.replyText,
        note: report.note,
        locale: 'ar'
      }
    ]);

    if (!getContainer().aiService.isEnabled()) {
      const chat = await request(app)
        .post('/api/v1/ai/chat')
        .set('Authorization', `Bearer ${tokens.accessToken}`)
        .send({ messages: [{ role: 'user', text: 'hi' }] });
      expect(chat.status).toBe(503);
    }
  });

  it('stores a report without the reply when the user left it out', async () => {
    const { tokens } = await register('no-text@example.com');
    const res = await post(tokens.accessToken, {
      surface: 'weekly_coaching',
      category: 'inaccurate',
      locale: 'de'
    });
    expect(res.status).toBe(201);
    const row = (await pool.query('SELECT reply_text, note FROM ai_content_reports')).rows[0];
    expect(row).toEqual({ reply_text: null, note: null });
  });

  it('rejects invalid bodies and unauthenticated calls without storing anything', async () => {
    const { tokens } = await register('invalid-report@example.com');
    for (const body of [
      { ...report, userId: '00000000-0000-0000-0000-000000000000' },
      { ...report, surface: 'notes' },
      { ...report, replyText: 'x'.repeat(4001) },
      { ...report, note: '   ' },
      { surface: 'assistant', category: 'spam' }
    ]) {
      const res = await post(tokens.accessToken, body);
      expect(res.status, JSON.stringify(body)).toBe(400);
    }
    expect((await request(app).post('/api/v1/ai/reports').send(report)).status).toBe(401);
    expect((await pool.query('SELECT count(*)::int AS n FROM ai_content_reports')).rows[0].n).toBe(
      0
    );
  });

  it('is in the account export and is erased with the account', async () => {
    const { user, tokens } = await register('export-report@example.com');
    expect((await post(tokens.accessToken, report)).status).toBe(201);
    const exported = await request(app)
      .post('/api/v1/users/me/export')
      .set('Authorization', `Bearer ${tokens.accessToken}`)
      .send({ currentPassword: PASSWORD });
    expect(exported.status).toBe(200);
    expect(exported.body.aiContentReports).toEqual([
      {
        surface: 'assistant',
        category: 'offensive',
        replyText: report.replyText,
        note: report.note,
        locale: 'ar',
        createdAt: expect.any(String)
      }
    ]);

    const users = new PgUsersRepository(pool);
    await users.scheduleDeletion(user.id, new Date(Date.now() - 1000));
    expect(await users.purgeAccount(user.id)).toBe(true);
    expect(
      (
        await pool.query('SELECT count(*)::int AS n FROM ai_content_reports WHERE user_id = $1', [
          user.id
        ])
      ).rows[0].n
    ).toBe(0);
  });

  it('limits each account to the documented hourly rate', async () => {
    const { tokens } = await register('report-rate@example.com');
    for (let i = 0; i < AI_REPORTS_HOURLY_LIMIT; i += 1) {
      expect((await post(tokens.accessToken, report)).status).toBe(201);
    }
    expect((await post(tokens.accessToken, report)).status).toBe(429);
  });

  it('deletes reports older than the retention window and keeps recent ones', async () => {
    const { user } = await register('retention@example.com');
    await pool.query(
      `INSERT INTO ai_content_reports (user_id, surface, category, locale, created_at)
       VALUES ($1, 'assistant', 'spam', 'en', now() - interval '91 days'),
              ($1, 'assistant', 'spam', 'en', now() - interval '1 day')`,
      [user.id]
    );
    const service = new AiReportsService(new PgAiReportsRepository(pool), new SystemClock());
    expect(await service.purgeExpired()).toBe(1);
    expect((await pool.query('SELECT count(*)::int AS n FROM ai_content_reports')).rows[0].n).toBe(
      1
    );
  });

  it('before the owner SQL: reporting answers 503 AI_REPORTS_UNAVAILABLE', async () => {
    const { tokens } = await register('before-report-sql@example.com');
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      // The test role does not own the table, so hide it instead: with only
      // pg_catalog on the search path, PostgreSQL itself answers 42P01
      // (relation does not exist), as on a database without the SQL.
      await client.query('SET LOCAL search_path = pg_catalog');
      const withoutTable = createApp({
        aiReportsService: new AiReportsService(new PgAiReportsRepository(client), new SystemClock())
      });
      const res = await post(tokens.accessToken, report, withoutTable);
      expect(res.status).toBe(503);
      expect(res.body.error?.code ?? res.body.code).toBe('AI_REPORTS_UNAVAILABLE');
    } finally {
      await client.query('ROLLBACK');
      client.release();
    }
  });
});
