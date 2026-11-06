import '../infrastructure-safety.js';
/**
 * tests/integration/analytics-flow.test.ts
 *
 * GET /api/v1/analytics must aggregate the caller's real rows only.
 * Seeds one completed task, one habit check-in, one finished focus
 * session, one numeric goal and one subscription, then asserts the
 * reported numbers — including null (not fabricated) rates where a
 * denominator does not exist.
 */

import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import request from 'supertest';
import { createApp } from '../../src/app.js';
import { getPgPool, closePgPool } from '../../src/infrastructure/database/postgres/pool.js';
import { closeRedisClient, getRedisClient } from '../../src/infrastructure/redis/redis-client.js';
import { getContainer } from '../../src/container.js';

describe('Analytics Integration Tests (real data)', () => {
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

  afterAll(async () => {
    await closeRedisClient(redis);
    await closePgPool();
  });

  it('aggregates real tasks, habits, focus, goals and subscriptions', async () => {
    const register = await request(app).post('/api/v1/auth/register').send({
      email: 'analytics@example.com',
      password: 'ValidUserPassword123!',
      displayName: 'Analytics User',
      timezone: 'UTC',
      defaultCurrency: 'USD'
    });
    expect(register.status).toBe(201);
    const token = register.body.data.tokens.accessToken as string;
    const userRow = await pool.query('SELECT id FROM users WHERE email = $1', [
      'analytics@example.com'
    ]);
    const userId = userRow.rows[0].id as string;
    const today = new Date().toISOString().slice(0, 10);

    // One task created and completed today, one still pending.
    await pool.query(
      `INSERT INTO tasks (user_id, title, status, completed_at)
       VALUES ($1, 'Done task', 'done', now()), ($1, 'Pending task', 'todo', NULL)`,
      [userId]
    );
    // One daily habit with a done check-in today.
    const habit = await pool.query(
      `INSERT INTO habits (user_id, name, start_date) VALUES ($1, 'Stretch', CURRENT_DATE) RETURNING id`,
      [userId]
    );
    await pool.query(
      `INSERT INTO recurrences (user_id, habit_id, freq, start_date) VALUES ($1, $2, 'daily', CURRENT_DATE)`,
      [userId, habit.rows[0].id]
    );
    await pool.query(
      `INSERT INTO habit_checkins (user_id, habit_id, checkin_date, status) VALUES ($1, $2, CURRENT_DATE, 'done')`,
      [userId, habit.rows[0].id]
    );
    // One finished 25-minute focus session.
    await pool.query(
      `INSERT INTO timer_sessions (user_id, started_at, ended_at, mode, end_reason)
       VALUES ($1, now() - interval '25 minutes', now(), 'stopwatch', 'stopped')`,
      [userId]
    );
    // One active numeric goal at 50%.
    await pool.query(
      `INSERT INTO goals (user_id, title, progress_type, target_value, current_value)
       VALUES ($1, 'Run distance', 'numeric', 100, 50)`,
      [userId]
    );
    // One active subscription (retained feature; not financial history).
    const soon = new Date(Date.now() + 2 * 86_400_000).toISOString().slice(0, 10);
    const subscription = await request(app)
      .post('/api/v1/money/subscriptions')
      .set('Authorization', `Bearer ${token}`)
      .send({
        name: 'Gym membership',
        amount: '49.99',
        currency: 'USD',
        billingUnit: 'month',
        anchorDate: soon
      });
    expect(subscription.status).toBe(201);

    const res = await request(app)
      .get('/api/v1/analytics')
      .query({ days: 7 })
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    const analytics = res.body.data.analytics;
    expect(analytics.rangeDays).toBe(7);
    expect(analytics.to).toBe(today);
    expect(analytics.tasks).toMatchObject({
      completedInRange: 1,
      createdInRange: 2,
      pendingNow: 1,
      completionRatePercent: 50
    });
    expect(analytics.habits).toMatchObject({
      activeHabits: 1,
      checkinsDoneInRange: 1,
      consistencyPercent: expect.any(Number)
    });
    expect(analytics.focus.sessionsInRange).toBe(1);
    expect(analytics.focus.totalMinutes).toBeGreaterThan(24);
    expect(analytics.focus.totalMinutes).toBeLessThan(26);
    expect(analytics.goals).toMatchObject({
      active: 1,
      averageNumericProgressPercent: 50
    });
    expect(analytics.subscriptions).toMatchObject({ active: 1, dueNext7Days: 1 });
    expect(analytics.series).toHaveLength(7);
    const todayPoint = analytics.series[analytics.series.length - 1];
    expect(todayPoint.tasksCompleted).toBe(1);
    expect(todayPoint.habitCheckins).toBe(1);
  });

  it('returns null rates and zero counts for a new account, never demo numbers', async () => {
    const register = await request(app).post('/api/v1/auth/register').send({
      email: 'empty@example.com',
      password: 'ValidUserPassword123!',
      displayName: 'Empty User',
      timezone: 'UTC',
      defaultCurrency: 'USD'
    });
    expect(register.status).toBe(201);
    const token = register.body.data.tokens.accessToken as string;

    const res = await request(app)
      .get('/api/v1/analytics')
      .query({ days: 30 })
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    const analytics = res.body.data.analytics;
    expect(analytics.tasks.completedInRange).toBe(0);
    expect(analytics.tasks.completionRatePercent).toBeNull();
    expect(analytics.habits.consistencyPercent).toBeNull();
    expect(analytics.goals.averageNumericProgressPercent).toBeNull();
    expect(analytics.focus.totalMinutes).toBe(0);
  });

  it('rejects unsupported ranges and requires authentication', async () => {
    const register = await request(app).post('/api/v1/auth/register').send({
      email: 'ranges@example.com',
      password: 'ValidUserPassword123!',
      displayName: 'Range User',
      timezone: 'UTC',
      defaultCurrency: 'USD'
    });
    const token = register.body.data.tokens.accessToken as string;

    const bad = await request(app)
      .get('/api/v1/analytics')
      .query({ days: 14 })
      .set('Authorization', `Bearer ${token}`);
    expect(bad.status).toBe(400);

    const anonymous = await request(app).get('/api/v1/analytics').query({ days: 7 });
    expect(anonymous.status).toBe(401);

    const longRange = await request(app)
      .get('/api/v1/analytics')
      .query({ days: 90 })
      .set('Authorization', `Bearer ${token}`);
    expect(longRange.status).toBe(200);
    // Consistency is honestly unavailable for long ranges.
    expect(longRange.body.data.analytics.habits.consistencyPercent).toBeNull();
    expect(longRange.body.data.analytics.series).toHaveLength(13);
  });
});
