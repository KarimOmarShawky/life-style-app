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

  it('registers without creating retired money categories', async () => {
    const registered = await request(app).post('/api/v1/auth/register').send({
      email: 'no-money-categories@example.test',
      password: 'ValidUserPassword123!',
      displayName: 'Test',
      timezone: 'UTC',
      defaultCurrency: 'USD'
    });
    expect(registered.status).toBe(201);
    const categories = await pool.query<{ count: number }>(
      'SELECT count(*)::int AS count FROM categories WHERE user_id = $1',
      [registered.body.data.user.id]
    );
    expect(categories.rows[0]?.count).toBe(0);
  });

  it('revokes only the authenticated session’s old ingest token', async () => {
    async function register(email: string) {
      const response = await request(app).post('/api/v1/auth/register').send({
        email,
        password: 'ValidUserPassword123!',
        displayName: 'Test',
        timezone: 'UTC',
        defaultCurrency: 'USD'
      });
      expect(response.status).toBe(201);
      return response.body.data;
    }
    const first = await register('revoke-first@example.test');
    const second = await register('revoke-second@example.test');
    const sessions = await pool.query<{ id: string; user_id: string }>(
      'SELECT id, user_id FROM auth_sessions WHERE user_id = ANY($1::uuid[])',
      [[first.user.id, second.user.id]]
    );
    for (const [index, session] of sessions.rows.entries()) {
      await pool.query(
        'INSERT INTO ingest_tokens (session_id, user_id, token_hash) VALUES ($1, $2, $3)',
        [session.id, session.user_id, Buffer.alloc(32, index + 1)]
      );
    }
    expect(sessions.rowCount).toBe(2);
    const auth = `Bearer ${first.tokens.accessToken}`;
    expect(
      (await request(app).delete('/api/v1/ingest/token').set('Authorization', auth)).status
    ).toBe(204);
    expect(
      (await request(app).delete('/api/v1/ingest/token').set('Authorization', auth)).status
    ).toBe(204);
    const tokens = await pool.query<{ user_id: string; revoked_at: Date | null }>(
      'SELECT user_id, revoked_at FROM ingest_tokens WHERE user_id = ANY($1::uuid[])',
      [[first.user.id, second.user.id]]
    );
    expect(tokens.rows.find((row) => row.user_id === first.user.id)?.revoked_at).not.toBeNull();
    expect(tokens.rows.find((row) => row.user_id === second.user.id)?.revoked_at).toBeNull();
    expect((await request(app).delete('/api/v1/ingest/token')).status).toBe(401);
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
    const subscription = created.body.data.subscription;
    const id = subscription.id;
    const fetched = await request(app)
      .get(`/api/v1/money/subscriptions/${id}`)
      .set('Authorization', auth);
    expect(fetched.status).toBe(200);
    const updated = await request(app)
      .patch(`/api/v1/money/subscriptions/${id}`)
      .set('Authorization', auth)
      .send({ name: 'Updated example', version: subscription.version });
    expect(updated.status).toBe(200);
    expect(updated.body.data.subscription.name).toBe('Updated example');
    const payment = await request(app)
      .post(`/api/v1/money/subscriptions/${id}/pay`)
      .set('Authorization', auth)
      .send({});
    expect(payment.status).toBe(410);
    const revoked = await request(app).delete('/api/v1/ingest/token').set('Authorization', auth);
    expect(revoked.status).toBe(204);
    const deleted = await request(app)
      .delete(`/api/v1/money/subscriptions/${id}`)
      .set('Authorization', auth);
    expect(deleted.status).toBe(204);
    const saved = await pool.query('SELECT id FROM transactions WHERE id = $1', [transactionId]);
    expect(saved.rowCount).toBe(1);
  });
});
