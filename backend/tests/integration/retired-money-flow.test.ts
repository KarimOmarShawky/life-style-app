import '../infrastructure-safety.js';
import { beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { createApp } from '../../src/app.js';
import { getContainer } from '../../src/container.js';
import { getPgPool } from '../../src/infrastructure/database/postgres/pool.js';
import { getRedisClient } from '../../src/infrastructure/redis/redis-client.js';

describe('retired money and SMS on the production HTTP app', () => {
  const app = createApp();
  const pool = getPgPool();
  const redis = getRedisClient();

  beforeEach(async () => {
    await pool.query('DELETE FROM users');
    await redis.flushdb();
    const limiter = getContainer().rateLimiter;
    if ('clear' in limiter && typeof limiter.clear === 'function') limiter.clear();
  });

  it('preserves old rows, blocks old routes, and keeps subscriptions accessible', async () => {
    const registered = await request(app).post('/api/v1/auth/register').send({
      email: 'retired-money@example.test',
      password: 'ValidUserPassword123!',
      displayName: 'Test',
      timezone: 'UTC',
      defaultCurrency: 'USD'
    });
    expect(registered.status).toBe(201);
    const { user, tokens } = registered.body.data;
    const auth = `Bearer ${tokens.accessToken}`;
    const old = await pool.query<{ id: string }>(
      `INSERT INTO transactions (user_id, kind, amount, currency, occurred_on)
       VALUES ($1, 'expense', '10', 'USD', '2026-01-01') RETURNING id`,
      [user.id]
    );
    const transactionId = old.rows[0]!.id;
    for (const path of [
      '/api/v1/money/transactions',
      '/api/v1/money/budgets',
      '/api/v1/ingest/token',
      '/api/v1/ingest/transactions',
      '/api/v1/ingest/sms/analyze',
      '/api/v1/ingest/wallet/sms/analyze'
    ]) {
      const response = await request(app).post(path).set('Authorization', auth).send({});
      expect(response.status, path).toBe(410);
      expect(response.body.error.code).toBe('FEATURE_RETIRED');
    }
    const created = await request(app)
      .post('/api/v1/money/subscriptions')
      .set('Authorization', auth)
      .send({
        name: 'Example',
        amount: '10.00',
        currency: 'USD',
        billingUnit: 'month',
        anchorDate: '2099-01-31'
      });
    expect(created.status).toBe(201);
    const listed = await request(app).get('/api/v1/money/subscriptions').set('Authorization', auth);
    expect(listed.status).toBe(200);
    expect(listed.body.data.subscriptions).toHaveLength(1);
    const saved = await pool.query('SELECT id FROM transactions WHERE id = $1', [transactionId]);
    expect(saved.rowCount).toBe(1);
  });
});
