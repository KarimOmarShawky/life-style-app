import '../infrastructure-safety.js';
/**
 * tests/integration/query-surface.test.ts
 *
 * Implements Section 14 (P1-05): Daily Plan, Dashboard overview, and Global
 * Search composed through read-only Reader interfaces.
 */

import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import request from 'supertest';
import { createApp } from '../../src/app.js';
import { getPgPool, closePgPool } from '../../src/infrastructure/database/postgres/pool.js';
import { closeRedisClient, getRedisClient } from '../../src/infrastructure/redis/redis-client.js';
import { getContainer } from '../../src/container.js';

describe('Query Surface Integration Tests (P1-05)', () => {
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

  async function registerUser() {
    const res = await request(app).post('/api/v1/auth/register').send({
      email: 'query@example.com',
      password: 'ValidUserPassword123!',
      displayName: 'Query User',
      timezone: 'UTC',
      defaultCurrency: 'USD'
    });
    expect(res.status).toBe(201);
    return res.body;
  }

  async function seed(accessToken: string, taskDueDate = '2026-12-01') {
    const task = await request(app)
      .post('/api/v1/tasks')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ title: 'Searchable quarterly report', dueDate: taskDueDate, dueTime: '09:00' });
    expect(task.status).toBe(201);

    const habit = await request(app)
      .post('/api/v1/habits')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({
        name: 'Morning stretch',
        startDate: '2026-10-01',
        reminderTime: '08:00',
        recurrence: { freq: 'daily' }
      });
    expect(habit.status).toBe(201);

    // Due within the dashboard's 7-day window regardless of the real date.
    const soon = new Date(Date.now() + 2 * 86_400_000).toISOString().slice(0, 10);
    const subscription = await request(app)
      .post('/api/v1/money/subscriptions')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({
        name: 'Gym membership',
        amount: '49.99',
        currency: 'USD',
        billingUnit: 'month',
        anchorDate: soon
      });
    expect(subscription.status).toBe(201);

    return {
      task: task.body.task,
      habit: habit.body.habit,
      subscription: subscription.body.subscription
    };
  }

  it('GET /days/today composes tasks, habits, and active timer from readers', async () => {
    const auth = await registerUser();
    await seed(auth.tokens.accessToken);

    const res = await request(app)
      .get('/api/v1/days/today')
      .set('Authorization', `Bearer ${auth.tokens.accessToken}`);
    expect(res.status).toBe(200);
    expect(res.body.day).toMatchObject({ timezone: 'UTC' });
    expect(typeof res.body.day.date).toBe('string');
    expect(Array.isArray(res.body.day.tasks)).toBe(true);
    expect(Array.isArray(res.body.day.habits)).toBe(true);
    expect(res.body.day.activeTimer).toBeNull();
    // The seeded habit is daily and due every day.
    expect(res.body.day.habits.some((h: { name: string }) => h.name === 'Morning stretch')).toBe(
      true
    );
  });

  it('GET /days/{date} returns the plan for that date and rejects bad dates', async () => {
    const auth = await registerUser();
    await seed(auth.tokens.accessToken, '2026-11-30');

    const ok = await request(app)
      .get('/api/v1/days/2026-11-30')
      .set('Authorization', `Bearer ${auth.tokens.accessToken}`);
    expect(ok.status).toBe(200);
    expect(ok.body.day.date).toBe('2026-11-30');
    // Task due 2026-11-30 appears on that date's plan.
    expect(
      ok.body.day.tasks.some((t: { title: string }) => t.title === 'Searchable quarterly report')
    ).toBe(true);
    expect(Array.isArray(ok.body.day.subscriptionsDue)).toBe(true);

    const bad = await request(app)
      .get('/api/v1/days/30-11-2026')
      .set('Authorization', `Bearer ${auth.tokens.accessToken}`);
    expect(bad.status).toBe(400);
  });

  it('GET /dashboard/overview aggregates the day', async () => {
    const auth = await registerUser();
    await seed(auth.tokens.accessToken);

    const res = await request(app)
      .get('/api/v1/dashboard/overview')
      .set('Authorization', `Bearer ${auth.tokens.accessToken}`);
    expect(res.status).toBe(200);
    expect(res.body.overview).toMatchObject({
      timezone: 'UTC',
      habits: { dueToday: 1, completedToday: 0 },
      activeSubscriptions: 1
    });
    expect(res.body.overview.subscriptionsDueNext7Days.totalMinorByCurrency.USD).toBe('4999');
  });

  it('GET /search finds items across features and enforces q', async () => {
    const auth = await registerUser();
    await seed(auth.tokens.accessToken);

    const res = await request(app)
      .get('/api/v1/search')
      .query({ q: 'quarterly' })
      .set('Authorization', `Bearer ${auth.tokens.accessToken}`);
    expect(res.status).toBe(200);
    expect(res.body.tasks.some((t: { title: string }) => t.title.includes('quarterly'))).toBe(true);

    const habitSearch = await request(app)
      .get('/api/v1/search')
      .query({ q: 'stretch' })
      .set('Authorization', `Bearer ${auth.tokens.accessToken}`);
    expect(habitSearch.status).toBe(200);
    expect(habitSearch.body.habits).toHaveLength(1);

    const missing = await request(app)
      .get('/api/v1/search')
      .set('Authorization', `Bearer ${auth.tokens.accessToken}`);
    expect(missing.status).toBe(400);
  });

  it('query endpoints require authentication', async () => {
    for (const path of ['/api/v1/days/today', '/api/v1/dashboard/overview', '/api/v1/search?q=x']) {
      const res = await request(app).get(path);
      expect(res.status).toBe(401);
    }
  });
});
