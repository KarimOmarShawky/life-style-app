import '../infrastructure-safety.js';
/**
 * tests/integration/ingest-flow.test.ts
 *
 * Background SMS capture with ingest tokens:
 * - Only an authenticated session can issue a token, and only one token is active per session.
 * - The ingest token creates transactions through the ingest route and nothing else.
 * - Revoking the token, or ending its session, stops it immediately.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import request from 'supertest';
import { randomUUID } from 'node:crypto';
import { createApp } from '../../src/app.js';
import { getPgPool } from '../../src/infrastructure/database/postgres/pool.js';
import { getRedisClient } from '../../src/infrastructure/redis/redis-client.js';
import { getContainer } from '../../src/container.js';

describe('Ingest token flow (background SMS capture)', () => {
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

  async function registerUser(email = 'sms-user@example.com') {
    const res = await request(app).post('/api/v1/auth/register').send({
      email,
      password: 'ValidUserPassword123!',
      displayName: 'SMS User',
      timezone: 'UTC',
      defaultCurrency: 'EGP'
    });
    expect(res.status).toBe(201);
    return res.body.data as {
      user: { id: string };
      tokens: { accessToken: string; refreshToken: string };
    };
  }

  async function issueIngestToken(accessToken: string): Promise<string> {
    const res = await request(app)
      .post('/api/v1/ingest/token')
      .set('Authorization', `Bearer ${accessToken}`);
    expect(res.status).toBe(201);
    return res.body.data.token as string;
  }

  function transactionBody() {
    return {
      kind: 'expense',
      amount: '150.00',
      currency: 'EGP',
      occurredOn: new Date().toISOString().slice(0, 10),
      description: 'تحويل / دفع عبر InstaPay',
      merchant: 'InstaPay'
    };
  }

  it('requires an access token to issue an ingest token', async () => {
    const res = await request(app).post('/api/v1/ingest/token');
    expect(res.status).toBe(401);
  });

  it('issues an lsi_ token that is stored only as a digest', async () => {
    const { tokens } = await registerUser();
    const res = await request(app)
      .post('/api/v1/ingest/token')
      .set('Authorization', `Bearer ${tokens.accessToken}`);

    expect(res.status).toBe(201);
    expect(res.headers['cache-control']).toContain('no-store');
    expect(res.body.data.token).toMatch(/^lsi_[A-Za-z0-9_-]{43}$/);

    const stored = await pool.query('SELECT token_hash FROM ingest_tokens');
    expect(stored.rows).toHaveLength(1);
    expect(Buffer.from(stored.rows[0].token_hash).toString('utf8')).not.toContain(
      res.body.data.token
    );
  });

  it('creates a transaction with the ingest token and replays the same Idempotency-Key', async () => {
    const { tokens } = await registerUser();
    const ingestToken = await issueIngestToken(tokens.accessToken);
    const idempotencyKey = randomUUID();

    const first = await request(app)
      .post('/api/v1/ingest/transactions')
      .set('Authorization', `Bearer ${ingestToken}`)
      .set('Idempotency-Key', idempotencyKey)
      .send(transactionBody());
    expect(first.status).toBe(201);
    expect(first.body.data.transaction.merchant).toBe('InstaPay');

    const replay = await request(app)
      .post('/api/v1/ingest/transactions')
      .set('Authorization', `Bearer ${ingestToken}`)
      .set('Idempotency-Key', idempotencyKey)
      .send(transactionBody());
    expect(replay.status).toBe(200);
    expect(replay.body.data.transaction.id).toBe(first.body.data.transaction.id);
  });

  it('rejects a missing Idempotency-Key on the ingest route', async () => {
    const { tokens } = await registerUser();
    const ingestToken = await issueIngestToken(tokens.accessToken);

    const res = await request(app)
      .post('/api/v1/ingest/transactions')
      .set('Authorization', `Bearer ${ingestToken}`)
      .send(transactionBody());
    expect(res.status).toBe(400);
  });

  it('does not let the ingest token call other routes', async () => {
    const { tokens } = await registerUser();
    const ingestToken = await issueIngestToken(tokens.accessToken);

    const money = await request(app)
      .post('/api/v1/money/transactions')
      .set('Authorization', `Bearer ${ingestToken}`)
      .set('Idempotency-Key', randomUUID())
      .send(transactionBody());
    expect(money.status).toBe(401);

    const tasks = await request(app)
      .get('/api/v1/tasks')
      .set('Authorization', `Bearer ${ingestToken}`);
    expect(tasks.status).toBe(401);
  });

  it('does not accept an access token on the ingest route', async () => {
    const { tokens } = await registerUser();
    const res = await request(app)
      .post('/api/v1/ingest/transactions')
      .set('Authorization', `Bearer ${tokens.accessToken}`)
      .set('Idempotency-Key', randomUUID())
      .send(transactionBody());
    expect(res.status).toBe(401);
  });

  it('keeps only the newest token for a session', async () => {
    const { tokens } = await registerUser();
    const older = await issueIngestToken(tokens.accessToken);
    const newer = await issueIngestToken(tokens.accessToken);

    const olderRes = await request(app)
      .post('/api/v1/ingest/transactions')
      .set('Authorization', `Bearer ${older}`)
      .set('Idempotency-Key', randomUUID())
      .send(transactionBody());
    expect(olderRes.status).toBe(401);

    const newerRes = await request(app)
      .post('/api/v1/ingest/transactions')
      .set('Authorization', `Bearer ${newer}`)
      .set('Idempotency-Key', randomUUID())
      .send(transactionBody());
    expect(newerRes.status).toBe(201);
  });

  it('stops working as soon as the token is revoked', async () => {
    const { tokens } = await registerUser();
    const ingestToken = await issueIngestToken(tokens.accessToken);

    const revoke = await request(app)
      .delete('/api/v1/ingest/token')
      .set('Authorization', `Bearer ${tokens.accessToken}`);
    expect(revoke.status).toBe(204);

    const res = await request(app)
      .post('/api/v1/ingest/transactions')
      .set('Authorization', `Bearer ${ingestToken}`)
      .set('Idempotency-Key', randomUUID())
      .send(transactionBody());
    expect(res.status).toBe(401);
  });

  it('stops working when its session is logged out, without an explicit revoke', async () => {
    const { tokens } = await registerUser();
    const ingestToken = await issueIngestToken(tokens.accessToken);

    const logout = await request(app)
      .post('/api/v1/auth/logout')
      .send({ refreshToken: tokens.refreshToken });
    expect(logout.status).toBe(204);

    const res = await request(app)
      .post('/api/v1/ingest/transactions')
      .set('Authorization', `Bearer ${ingestToken}`)
      .set('Idempotency-Key', randomUUID())
      .send(transactionBody());
    expect(res.status).toBe(401);
  });
});
