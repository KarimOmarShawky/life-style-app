/**
 * tests/integration/ingest-analyze-flow.test.ts
 *
 * The SMS fallback analyze route end to end (with a stubbed analyzer, so no
 * external calls): auth accepts an ingest token or an access token, the
 * candidate text reaches the analyzer only after sanitization, and unavailable
 * upstream analysis maps to a retryable 503.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import request from 'supertest';
import { createApp } from '../../src/app.js';
import { getPgPool } from '../../src/infrastructure/database/postgres/pool.js';
import { getRedisClient } from '../../src/infrastructure/redis/redis-client.js';
import {
  SmsFallbackUnavailableError,
  type AnalyzeCandidateInput,
  type SmsAnalysisResult
} from '../../src/features/ingest/sms-fallback-analyzer.js';

function stubAnalyzer(results: {
  status: 'recognized' | 'unrecognized' | 'unavailable';
  confidence?: 'high' | 'low';
  fail?: boolean;
  capture?: AnalyzeCandidateInput[];
}) {
  return {
    analyze: vi.fn(async (input: AnalyzeCandidateInput): Promise<SmsAnalysisResult> => {
      results.capture?.push(input);
      if (results.fail) {
        throw new SmsFallbackUnavailableError();
      }
      if (results.status === 'recognized') {
        return {
          status: 'recognized',
          confidence: results.confidence ?? 'low',
          transaction: {
            kind: 'expense',
            amount: '250.00',
            currency: 'EGP',
            occurredOn: '2026-10-08',
            description: 'Transfer via wallet',
            merchant: 'InstaPay'
          }
        };
      }
      return { status: results.status, transaction: null, confidence: null };
    })
  };
}

describe('SMS fallback analyze route', () => {
  const pool = getPgPool();
  const redis = getRedisClient();

  beforeEach(async () => {
    await pool.query('DELETE FROM users');
    await redis.flushdb();
  });

  function appWith(results: Parameters<typeof stubAnalyzer>[0]) {
    return createApp({ smsAnalyzer: stubAnalyzer(results) });
  }

  async function registerUser(app: ReturnType<typeof appWith>) {
    const res = await request(app).post('/api/v1/auth/register').send({
      email: 'fallback-user@example.com',
      password: 'ValidUserPassword123!',
      displayName: 'Fallback User',
      timezone: 'UTC',
      defaultCurrency: 'EGP'
    });
    expect(res.status).toBe(201);
    return res.body as {
      tokens: { accessToken: string; refreshToken: string };
    };
  }

  async function issueIngestToken(app: ReturnType<typeof appWith>, accessToken: string) {
    const res = await request(app)
      .post('/api/v1/ingest/token')
      .set('Authorization', `Bearer ${accessToken}`);
    expect(res.status).toBe(201);
    return res.body.token as string;
  }

  it('requires authentication', async () => {
    const app = appWith({ status: 'unrecognized' });
    const res = await request(app)
      .post('/api/v1/ingest/sms/analyze')
      .send({ text: 'paid 250', receivedAt: '2026-10-08' });
    expect(res.status).toBe(401);
  });

  it('rejects a garbage bearer token', async () => {
    const app = appWith({ status: 'unrecognized' });
    const res = await request(app)
      .post('/api/v1/ingest/sms/analyze')
      .set('Authorization', 'Bearer not-a-real-token')
      .send({ text: 'paid 250', receivedAt: '2026-10-08' });
    expect(res.status).toBe(401);
  });

  it('accepts an ingest token and returns the strict recognized shape', async () => {
    const app = appWith({ status: 'recognized', confidence: 'high' });
    const { tokens } = await registerUser(app);
    const ingestToken = await issueIngestToken(app, tokens.accessToken);

    const res = await request(app)
      .post('/api/v1/ingest/sms/analyze')
      .set('Authorization', `Bearer ${ingestToken}`)
      .send({
        text: 'تم تحويل مبلغ 250.00 جنيه عبر انستاباي',
        sender: 'IPN',
        receivedAt: '2026-10-08T13:05:00Z'
      });

    expect(res.status).toBe(200);
    expect(res.headers['cache-control']).toContain('no-store');
    expect(res.body.status).toBe('recognized');
    expect(res.body.confidence).toBe('high');
    expect(res.body.transaction).toEqual({
      kind: 'expense',
      amount: '250.00',
      currency: 'EGP',
      occurredOn: '2026-10-08',
      description: 'Transfer via wallet',
      merchant: 'InstaPay'
    });
  });

  it('accepts a normal access token as well (app-open fallback)', async () => {
    const app = appWith({ status: 'recognized', confidence: 'low' });
    const { tokens } = await registerUser(app);

    const res = await request(app)
      .post('/api/v1/ingest/sms/analyze')
      .set('Authorization', `Bearer ${tokens.accessToken}`)
      .send({ text: 'paid maybe 250', receivedAt: '2026-10-08' });

    expect(res.status).toBe(200);
    expect(res.body.status).toBe('recognized');
    expect(res.body.confidence).toBe('low');
  });

  it('hands the analyzer only sanitized text and sender', async () => {
    const capture: AnalyzeCandidateInput[] = [];
    const app = appWith({ status: 'unrecognized', capture });
    const { tokens } = await registerUser(app);
    const ingestToken = await issueIngestToken(app, tokens.accessToken);

    await request(app)
      .post('/api/v1/ingest/sms/analyze')
      .set('Authorization', `Bearer ${ingestToken}`)
      .send({
        text: 'Your OTP is 918273. Paid 250 EGP. Call 01000000000. Balance 9,900.00 EGP. Ref 552311988',
        sender: '+201000000000',
        receivedAt: '2026-10-08'
      });

    expect(capture).toHaveLength(1);
    expect(capture[0].text).not.toContain('918273');
    expect(capture[0].text).not.toContain('01000000000');
    expect(capture[0].text).not.toContain('9,900.00');
    expect(capture[0].text).not.toContain('552311988');
    expect(capture[0].text).toContain('[OTP]');
    expect(capture[0].text).toContain('250 EGP');
    expect(capture[0].sender).toBe('[PHONE]');
  });

  it('passes unrecognized results through so the phone drops the candidate', async () => {
    const app = appWith({ status: 'unrecognized' });
    const { tokens } = await registerUser(app);

    const res = await request(app)
      .post('/api/v1/ingest/sms/analyze')
      .set('Authorization', `Bearer ${tokens.accessToken}`)
      .send({ text: 'random marketing text', receivedAt: '2026-10-08' });

    expect(res.status).toBe(200);
    expect(res.body.status).toBe('unrecognized');
    expect(res.body.transaction).toBeNull();
    expect(res.body.confidence).toBeNull();
  });

  it('maps upstream failure to a retryable 503 with a stable code', async () => {
    const app = appWith({ status: 'unavailable', fail: true });
    const { tokens } = await registerUser(app);

    const res = await request(app)
      .post('/api/v1/ingest/sms/analyze')
      .set('Authorization', `Bearer ${tokens.accessToken}`)
      .send({ text: 'paid 250', receivedAt: '2026-10-08' });

    expect(res.status).toBe(503);
    expect(res.body.success).toBe(false);
    expect(res.body.error.code).toBe('SMS_FALLBACK_UNAVAILABLE');
  });

  it('rejects malformed bodies with a validation error', async () => {
    const app = appWith({ status: 'unrecognized' });
    const { tokens } = await registerUser(app);

    const res = await request(app)
      .post('/api/v1/ingest/sms/analyze')
      .set('Authorization', `Bearer ${tokens.accessToken}`)
      .send({ text: 'paid 250' });

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });
});
