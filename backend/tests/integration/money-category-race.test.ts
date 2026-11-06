import '../infrastructure-safety.js';
import { beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { randomUUID } from 'node:crypto';
import { createApp } from '../../src/app.js';
import { getPgPool } from '../../src/infrastructure/database/postgres/pool.js';
import { getRedisClient } from '../../src/infrastructure/redis/redis-client.js';
import { getContainer } from '../../src/container.js';

const app = createApp();
const pool = getPgPool();
const redis = getRedisClient();

describe('money creation versus concurrent category archive', () => {
  beforeEach(async () => {
    await pool.query('DELETE FROM users');
    await redis.flushdb();
    const limiter = getContainer().rateLimiter;
    if ('clear' in limiter && typeof limiter.clear === 'function') limiter.clear();
  });

  it('rejects assigning an archived legacy category to a subscription', async () => {
    const registered = await request(app).post('/api/v1/auth/register').send({
      email: 'category-archived@example.test',
      password: 'ValidUserPassword123!',
      displayName: 'Category archived',
      timezone: 'UTC',
      defaultCurrency: 'USD'
    });
    expect(registered.status).toBe(201);
    const auth = `Bearer ${registered.body.data.tokens.accessToken}`;
    const subscription = await request(app)
      .post('/api/v1/money/subscriptions')
      .set('Authorization', auth)
      .send({
        name: 'Test',
        amount: '10.00',
        currency: 'USD',
        billingUnit: 'month',
        anchorDate: '2099-01-01'
      });
    expect(subscription.status).toBe(201);
    const category = await pool.query<{ id: string }>(
      `INSERT INTO categories(user_id,kind,name,archived_at) VALUES($1,'expense','Archived',now()) RETURNING id`,
      [registered.body.data.user.id]
    );
    const id = subscription.body.data.subscription.id as string;
    const response = await request(app)
      .patch(`/api/v1/money/subscriptions/${id}`)
      .set('Authorization', auth)
      .send({ categoryId: category.rows[0]!.id });
    expect(response.status).toBe(400);
    expect(
      (await pool.query('SELECT category_id FROM subscriptions WHERE id=$1', [id])).rows[0]
        .category_id
    ).toBeNull();
  });

  it('rejects creating a subscription after the legacy category is archived while the request waits', async () => {
    const table = 'subscriptions';
    const payload = {
      name: 'Test',
      amount: '10.00',
      currency: 'USD',
      billingUnit: 'month',
      anchorDate: '2020-01-01',
      nextBillingDate: '2020-01-01'
    };
    const email = `${randomUUID()}@example.test`;
    const registered = await request(app).post('/api/v1/auth/register').send({
      email,
      password: 'ValidUserPassword123!',
      displayName: 'Category race',
      timezone: 'UTC',
      defaultCurrency: 'USD'
    });
    expect(registered.status).toBe(201);
    const auth = `Bearer ${registered.body.data.tokens.accessToken}`;
    const category = await pool.query<{ id: string }>(
      `INSERT INTO categories(user_id,kind,name) VALUES($1,'expense','Category race') RETURNING id`,
      [registered.body.data.user.id]
    );
    const id = category.rows[0]!.id;
    const client = await pool.connect();
    let pending: Promise<unknown> | undefined;
    try {
      await client.query('BEGIN');
      const pid = (await client.query<{ pid: number }>('SELECT pg_backend_pid() AS pid')).rows[0]!
        .pid;
      await client.query('SELECT id FROM categories WHERE id = $1 FOR UPDATE', [id]);
      await client.query(
        'UPDATE categories SET archived_at = now(), version = version + 1 WHERE id = $1',
        [id]
      );
      const response = request(app)
        .post(`/api/v1/money/${table}`)
        .set('Authorization', auth)
        .set('Idempotency-Key', randomUUID())
        .send({ ...payload, categoryId: id })
        .then((value) => value);
      pending = response.catch(() => undefined);
      const deadline = Date.now() + 5_000;
      let blocked = false;
      while (Date.now() < deadline && !blocked) {
        blocked = (
          await pool.query<{ blocked: boolean }>(
            'SELECT EXISTS (SELECT 1 FROM pg_stat_activity WHERE $1 = ANY(pg_blocking_pids(pid))) AS blocked',
            [pid]
          )
        ).rows[0]!.blocked;
        if (!blocked) await new Promise((resolve) => setTimeout(resolve, 20));
      }
      expect(blocked).toBe(true);
      await client.query('COMMIT');
      const result = await response;
      expect(result.status, JSON.stringify(result.body)).toBe(400);
      expect(result.body.error.code).toBe('VALIDATION_ERROR');
      expect(
        (await pool.query(`SELECT count(*)::int AS n FROM ${table} WHERE category_id = $1`, [id]))
          .rows[0].n
      ).toBe(0);
    } finally {
      await client.query('ROLLBACK');
      await pending;
      client.release();
    }
  });
});
