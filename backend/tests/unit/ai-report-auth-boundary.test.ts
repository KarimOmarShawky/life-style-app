import express from 'express';
import request from 'supertest';
import { describe, expect, it, vi } from 'vitest';
import { createAuthenticateMiddleware } from '../../src/core/middleware/authenticate.js';
import { globalErrorHandler } from '../../src/core/middleware/error-handler.js';
import { MemoryRateLimiter } from '../../src/core/middleware/rate-limiter.js';
import { successEnvelopeMiddleware } from '../../src/core/middleware/success-envelope.js';
import { JoseTokenService } from '../../src/core/security/token-service.js';
import type { SessionValidator, ValidatedSessionResult } from '../../src/core/security/session-validator.js';
import { FakeClock } from '../../src/core/time/clock.js';
import { createAiReportsRouter } from '../../src/features/ai-reports/ai-reports.routes.js';
import { AiReportsService } from '../../src/features/ai-reports/ai-reports.service.js';
import type { AiReportsRepository } from '../../src/features/ai-reports/ai-reports.repository.js';

const a = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const b = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const sa = '11111111-1111-4111-8111-111111111111';
const sb = '22222222-2222-4222-8222-222222222222';
const body = { surface: 'assistant', category: 'other', locale: 'en', replyText: 'synthetic A text' };

function session(id: string, sid: string): ValidatedSessionResult {
  return {
    sessionId: sid, userId: id, revokedAt: null, absoluteExpiresAt: new Date('2099-01-01T00:00:00Z'),
    user: { id, email: 'synthetic@example.test', status: 'active', timezone: 'UTC', locale: 'en', weekStart: 0, defaultCurrency: 'USD', pushShowTitles: false }
  };
}

function setup() {
  const sessions = new Map([[sa, session(a, sa)], [sb, session(b, sb)]]);
  const validator: SessionValidator = {
    async validateSession(sid, sub) {
      const found = sessions.get(sid);
      return found?.userId === sub ? found : null;
    }
  };
  const create = vi.fn(async () => ({ available: true, created: true }));
  const repo: AiReportsRepository = { create, purgeOlderThan: async () => 0 };
  const tokens = new JoseTokenService();
  const app = express();
  app.use(express.json());
  app.use('/api/v1/ai/reports', successEnvelopeMiddleware, createAiReportsRouter({
    service: new AiReportsService(repo, new FakeClock()),
    authenticate: createAuthenticateMiddleware(tokens, validator),
    rateLimiter: new MemoryRateLimiter()
  }));
  app.use(globalErrorHandler);
  return { app, tokens, create, sessions };
}

describe('report boundary with real JWT verification and fake sessions', () => {
  it('attributes supplied free text to the validated bearer identity', async () => {
    const { app, tokens, create } = setup();
    const token = await tokens.signAccessToken({ sub: b, sid: sb });
    const res = await request(app).post('/api/v1/ai/reports').set('Authorization', `Bearer ${token.token}`).send(body);
    expect(res.status).toBe(201);
    expect(create).toHaveBeenCalledOnce();
    expect(create).toHaveBeenCalledWith(expect.objectContaining({ userId: b, replyText: body.replyText }));
  });

  it('rejects a mismatched subject/session pair without writing', async () => {
    const { app, tokens, create } = setup();
    const token = await tokens.signAccessToken({ sub: b, sid: sa });
    const res = await request(app).post('/api/v1/ai/reports').set('Authorization', `Bearer ${token.token}`).send(body);
    expect(res.status).toBe(401);
    expect(create).not.toHaveBeenCalled();
  });

  it('rejects a revoked session without writing', async () => {
    const { app, tokens, create, sessions } = setup();
    sessions.get(sa)!.revokedAt = new Date();
    const token = await tokens.signAccessToken({ sub: a, sid: sa });
    const res = await request(app).post('/api/v1/ai/reports').set('Authorization', `Bearer ${token.token}`).send(body);
    expect(res.status).toBe(401);
    expect(create).not.toHaveBeenCalled();
  });
});
