import '../infrastructure-safety.js';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { createApp } from '../../src/app.js';
import { getPgPool } from '../../src/infrastructure/database/postgres/pool.js';
import { getRedisClient } from '../../src/infrastructure/redis/redis-client.js';

describe('wallet owner precondition with real authentication and persistence', () => {
  const pool = getPgPool();
  const redis = getRedisClient();
  beforeEach(async () => {
    await pool.query('DELETE FROM users');
    await redis.flushdb();
  });

  it('prevents a different account from analyzing or saving a marked wallet item', async () => {
    const analyze = vi.fn(async () => ({
      status: 'unrecognized' as const,
      transaction: null,
      confidence: null
    }));
    const app = createApp({ smsAnalyzer: { analyze } });
    async function register(email: string) {
      const result = await request(app).post('/api/v1/auth/register').send({
        email,
        password: 'ValidUserPassword123!',
        displayName: 'Test User',
        timezone: 'UTC',
        defaultCurrency: 'EGP'
      });
      expect(result.status).toBe(201);
      return result.body.data as { user: { id: string }; tokens: { accessToken: string } };
    }
    const first = await register('owner-a@example.com');
    const second = await register('owner-b@example.com');
    const issued = await request(app)
      .post('/api/v1/ingest/token')
      .set('Authorization', `Bearer ${second.tokens.accessToken}`);
    expect(issued.status).toBe(201);
    expect(issued.body.data.ownerId).toBe(second.user.id);
    const ingestToken = issued.body.data.token as string;
    const candidate = { text: 'paid 250 EGP', receivedAt: '2026-10-08' };
    for (const credential of [second.tokens.accessToken, ingestToken]) {
      const denied = await request(app)
        .post('/api/v1/ingest/sms/analyze')
        .set('Authorization', `Bearer ${credential}`)
        .set('X-Wallet-Owner', first.user.id)
        .send(candidate);
      expect(denied.status).toBe(428);
      expect(denied.body.error.code).toBe('WALLET_OWNER_MISMATCH');
      expect(denied.headers['cache-control']).toContain('no-store');
    }
    expect(analyze).not.toHaveBeenCalled();
    const body = {
      kind: 'expense',
      amount: '150.00',
      currency: 'EGP',
      occurredOn: new Date().toISOString().slice(0, 10)
    };
    for (const [path, credential] of [
      ['/api/v1/ingest/transactions', ingestToken],
      ['/api/v1/money/transactions', second.tokens.accessToken]
    ]) {
      const denied = await request(app)
        .post(path!)
        .set('Authorization', `Bearer ${credential}`)
        .set('Idempotency-Key', randomUUID())
        .set('X-Wallet-Owner', first.user.id)
        .send(body);
      expect(denied.status).toBe(428);
      expect(denied.body.error.code).toBe('WALLET_OWNER_MISMATCH');
    }
    expect(Number((await pool.query('SELECT count(*) AS n FROM transactions')).rows[0].n)).toBe(0);
    // These new wallet-only routes reject a missing owner as well as a different
    // one, before invoking the provider or transaction controller.
    for (const [path, credential, payload] of [
      ['/api/v1/ingest/wallet/sms/analyze', ingestToken, candidate],
      ['/api/v1/ingest/wallet/sms/analyze', second.tokens.accessToken, candidate],
      ['/api/v1/ingest/wallet/transactions', ingestToken, body],
      ['/api/v1/money/wallet/transactions', second.tokens.accessToken, body]
    ] as const) {
      const unauthenticated = await request(app).post(path).send(payload);
      expect(unauthenticated.status).toBe(401);
      const missing = await request(app)
        .post(path)
        .set('Authorization', `Bearer ${credential}`)
        .set('Idempotency-Key', randomUUID())
        .send(payload);
      expect(missing.status).toBe(428);
      expect(missing.body.error.code).toBe('WALLET_OWNER_MISMATCH');
      expect(missing.headers['cache-control']).toContain('no-store');
      const wrongOwner = await request(app)
        .post(path)
        .set('Authorization', `Bearer ${credential}`)
        .set('Idempotency-Key', randomUUID())
        .set('X-Wallet-Owner', first.user.id)
        .send(payload);
      expect(wrongOwner.status).toBe(428);
    }
    expect(analyze).not.toHaveBeenCalled();
    expect(Number((await pool.query('SELECT count(*) AS n FROM transactions')).rows[0].n)).toBe(0);
    for (const credential of [ingestToken, second.tokens.accessToken]) {
      const analyzed = await request(app)
        .post('/api/v1/ingest/wallet/sms/analyze')
        .set('Authorization', `Bearer ${credential}`)
        .set('X-Wallet-Owner', second.user.id)
        .send(candidate);
      expect(analyzed.status).toBe(200);
    }
    expect(analyze).toHaveBeenCalledTimes(2);
    analyze.mockClear();
    for (const [path, credential] of [
      ['/api/v1/ingest/wallet/transactions', ingestToken],
      ['/api/v1/money/wallet/transactions', second.tokens.accessToken]
    ]) {
      const saved = await request(app)
        .post(path!)
        .set('Authorization', `Bearer ${credential}`)
        .set('Idempotency-Key', randomUUID())
        .set('X-Wallet-Owner', second.user.id)
        .send(body);
      expect(saved.status).toBe(201);
    }
    expect(Number((await pool.query('SELECT count(*) AS n FROM transactions')).rows[0].n)).toBe(2);
    const ok = await request(app)
      .post('/api/v1/ingest/sms/analyze')
      .set('Authorization', `Bearer ${ingestToken}`)
      .set('X-Wallet-Owner', second.user.id)
      .send(candidate);
    expect(ok.status).toBe(200);
    expect(analyze).toHaveBeenCalledTimes(1);
    const saved = await request(app)
      .post('/api/v1/ingest/transactions')
      .set('Authorization', `Bearer ${ingestToken}`)
      .set('Idempotency-Key', randomUUID())
      .set('X-Wallet-Owner', second.user.id)
      .send(body);
    expect(saved.status).toBe(201);
    const legacy = await request(app)
      .post('/api/v1/ingest/sms/analyze')
      .set('Authorization', `Bearer ${second.tokens.accessToken}`)
      .send(candidate);
    expect(legacy.status).toBe(200);
  });
});
