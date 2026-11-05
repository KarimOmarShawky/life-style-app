import '../infrastructure-safety.js';
import { beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { createApp } from '../../src/app.js';
import { getPgPool } from '../../src/infrastructure/database/postgres/pool.js';
import { getRedisClient } from '../../src/infrastructure/redis/redis-client.js';
import { getContainer } from '../../src/container.js';

describe('completed task local calendar-day filtering', () => {
  const app = createApp();
  const pool = getPgPool();
  beforeEach(async () => {
    await pool.query('DELETE FROM users');
    await getRedisClient().flushdb();
    const limiter = getContainer().rateLimiter;
    if ('clear' in limiter && typeof limiter.clear === 'function') limiter.clear();
  });
  const cases = [
    ['UTC', '2026-03-08', '2026-03-08 00:00:00+00', '2026-03-09 00:00:00+00'],
    ['America/New_York', '2026-03-08', '2026-03-08 05:00:00+00', '2026-03-09 04:00:00+00'],
    ['America/New_York', '2026-11-01', '2026-11-01 04:00:00+00', '2026-11-02 05:00:00+00'],
    ['America/Havana', '2026-11-01', '2026-11-01 04:00:00+00', '2026-11-02 05:00:00+00'],
    ['Africa/Cairo', '2026-04-24', '2026-04-23 22:00:00+00', '2026-04-24 21:00:00+00'],
    ['+05:45', '2026-03-08', '2026-03-07 18:15:00+00', '2026-03-08 18:15:00+00'],
    ['-03:30', '2026-03-08', '2026-03-08 03:30:00+00', '2026-03-09 03:30:00+00'],
    ['+02', '2026-03-08', '2026-03-07 22:00:00+00', '2026-03-08 22:00:00+00'],
    ['-0330', '2026-03-08', '2026-03-08 03:30:00+00', '2026-03-09 03:30:00+00']
  ];
  it.each(cases)(
    'filters %s on %s, including microsecond edges',
    async (timezone, day, start, end) => {
      const registered = await request(app).post('/api/v1/auth/register').send({
        email: 'taskdate@example.com',
        password: 'ValidUserPassword123!',
        displayName: 'Task User',
        timezone,
        defaultCurrency: 'USD'
      });
      expect(registered.status).toBe(201);
      const { user, tokens } = registered.body.data;
      const other = await request(app).post('/api/v1/auth/register').send({
        email: 'otherdate@example.com',
        password: 'ValidUserPassword123!',
        displayName: 'Other User',
        timezone: 'UTC',
        defaultCurrency: 'USD'
      });
      expect(other.status).toBe(201);
      await pool.query(
        `INSERT INTO tasks (user_id, title, status, completed_at) VALUES
      ($1, 'before', 'done', $3::timestamptz - interval '1 microsecond'),
      ($1, 'start', 'done', $3::timestamptz),
      ($1, 'last', 'done', $4::timestamptz - interval '1 microsecond'),
      ($1, 'after', 'done', $4::timestamptz),
      ($1, 'open', 'todo', NULL),
      ($2, 'other tenant', 'done', $3::timestamptz)`,
        [user.id, other.body.data.user.id, start, end]
      );
      async function titles(query: Record<string, string>) {
        const res = await request(app)
          .get('/api/v1/tasks')
          .set('Authorization', `Bearer ${tokens.accessToken}`)
          .query(query);
        expect(res.status).toBe(200);
        return res.body.data.map((task: { title: string }) => task.title).sort();
      }
      expect(await titles({ completedFrom: day, completedTo: day })).toEqual(['last', 'start']);
      expect(await titles({ completedFrom: day })).toEqual(['after', 'last', 'start']);
      expect(await titles({ completedTo: day })).toEqual(['before', 'last', 'start']);
      expect(await titles({})).toEqual(['after', 'before', 'last', 'open', 'start']);
      const invalid = await request(app)
        .get('/api/v1/tasks')
        .set('Authorization', `Bearer ${tokens.accessToken}`)
        .query({ completedTo: '2026-02-30' });
      expect(invalid.status).toBe(400);
    }
  );

  it('returns no completions for a skipped civil day and fails closed on an invalid legacy zone', async () => {
    const registration = await request(app).post('/api/v1/auth/register').send({
      email: 'apia@example.com',
      password: 'ValidUserPassword123!',
      displayName: 'Task User',
      timezone: 'Pacific/Apia',
      defaultCurrency: 'USD'
    });
    expect(registration.status).toBe(201);
    const { user, tokens } = registration.body.data;
    await pool.query(
      `INSERT INTO tasks (user_id, title, status, completed_at) VALUES
      ($1, 'before', 'done', '2011-12-30 09:59:59.999999+00'),
      ($1, 'after', 'done', '2011-12-30 10:00:00+00')`,
      [user.id]
    );
    const query = { completedFrom: '2011-12-30', completedTo: '2011-12-30' };
    const list = () =>
      request(app)
        .get('/api/v1/tasks')
        .set('Authorization', `Bearer ${tokens.accessToken}`)
        .query(query);
    const skipped = await list();
    expect(skipped.status).toBe(200);
    expect(skipped.body.data).toEqual([]);
    await pool.query("UPDATE users SET timezone = 'Invalid/LegacyZone' WHERE id = $1", [user.id]);
    expect((await list()).status).toBe(500);
  });
});
