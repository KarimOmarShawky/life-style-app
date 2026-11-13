/**
 * tests/unit/ai-reports.test.ts
 *
 * In-app reports of AI output (AI-P, Google Play AI-Generated Content policy):
 *  - the request schema is strict, trims texts and mirrors the DB limits;
 *  - the service answers 503 AI_REPORTS_UNAVAILABLE until the owner SQL ran;
 *  - reporting works while the AI kill switch is off, with its own limits;
 *  - the owner SQL, schema snapshots, account lifecycle and grant drafts stay
 *    in step with the forward-only migration.
 */

import { readFileSync } from 'node:fs';
import express, { type RequestHandler } from 'express';
import request from 'supertest';
import type pg from 'pg';
import { describe, expect, it, vi } from 'vitest';
import { MemoryRateLimiter } from '../../src/core/middleware/rate-limiter.js';
import { globalErrorHandler } from '../../src/core/middleware/error-handler.js';
import { successEnvelopeMiddleware } from '../../src/core/middleware/success-envelope.js';
import { FakeClock } from '../../src/core/time/clock.js';
import { AiService } from '../../src/features/ai/ai.service.js';
import { createAiRouter } from '../../src/features/ai/ai.routes.js';
import { createAiReportSchema } from '../../src/features/ai-reports/ai-reports.validation.js';
import {
  AI_REPORT_RETENTION_DAYS,
  AiReportsService
} from '../../src/features/ai-reports/ai-reports.service.js';
import type { AiReportsRepository } from '../../src/features/ai-reports/ai-reports.repository.js';
import {
  PgAiReportsRepository,
  resetAiReportsWarningForTests
} from '../../src/features/ai-reports/ai-reports.repository.pg.js';
import {
  AI_REPORTS_DAILY_LIMIT,
  AI_REPORTS_HOURLY_LIMIT,
  createAiReportsRouter
} from '../../src/features/ai-reports/ai-reports.routes.js';
import {
  OPTIONAL_USER_OWNED_TABLES,
  USER_OWNED_TABLES_IN_DELETE_ORDER
} from '../../src/features/users/users.repository.pg.js';
import { ACCOUNT_ARCHIVE_OWNED_EXCLUSIONS } from '../../src/features/users/account-archive.sources.js';

const repoFile = (relative: string) =>
  readFileSync(new URL(`../../../${relative}`, import.meta.url), 'utf8');
const migrationSource = repoFile(
  'backend/src/infrastructure/database/postgres/migrations/1792780000000_ai_content_reports.cjs'
);

const validBody = {
  surface: 'assistant',
  category: 'offensive',
  replyText: 'The reply the user saw',
  note: 'This was rude',
  locale: 'ar'
};

function fakeRepo(overrides?: Partial<AiReportsRepository>): AiReportsRepository {
  return {
    create: vi.fn(async () => ({ available: true, created: true })),
    purgeOlderThan: vi.fn(async () => 0),
    ...overrides
  };
}

describe('AI report request schema', () => {
  it('accepts a minimal report and a full one', () => {
    expect(
      createAiReportSchema.safeParse({
        surface: 'weekly_coaching',
        category: 'other',
        locale: 'en'
      }).success
    ).toBe(true);
    expect(createAiReportSchema.safeParse(validBody).success).toBe(true);
    expect(createAiReportSchema.safeParse({ ...validBody, locale: 'en-US' }).success).toBe(true);
  });

  it('trims the optional texts and rejects blank ones', () => {
    const parsed = createAiReportSchema.parse({ ...validBody, replyText: '  text  ', note: ' n ' });
    expect(parsed.replyText).toBe('text');
    expect(parsed.note).toBe('n');
    expect(createAiReportSchema.safeParse({ ...validBody, replyText: '   ' }).success).toBe(false);
    expect(createAiReportSchema.safeParse({ ...validBody, note: '' }).success).toBe(false);
  });

  it('rejects unknown fields, unknown values and over-long texts', () => {
    for (const body of [
      { ...validBody, userId: 'someone-else' },
      { ...validBody, history: [] },
      { ...validBody, surface: 'notes' },
      { ...validBody, category: 'boring' },
      { ...validBody, replyText: 'x'.repeat(4001) },
      { ...validBody, note: 'x'.repeat(501) },
      { ...validBody, locale: 'arabic language' },
      { ...validBody, locale: 'a' },
      { surface: 'assistant', category: 'spam' }
    ]) {
      expect(createAiReportSchema.safeParse(body).success, JSON.stringify(body)).toBe(false);
    }
    expect(
      createAiReportSchema.safeParse({ ...validBody, replyText: 'x'.repeat(4000) }).success
    ).toBe(true);
  });
});

describe('AiReportsService', () => {
  it('stores the report for the authenticated user, with absent texts as null', async () => {
    const repo = fakeRepo();
    const service = new AiReportsService(repo, new FakeClock());
    await expect(
      service.create('user-1', { surface: 'assistant', category: 'harmful', locale: 'de' })
    ).resolves.toEqual({ reported: true });
    expect(repo.create).toHaveBeenCalledWith({
      userId: 'user-1',
      surface: 'assistant',
      category: 'harmful',
      replyText: null,
      note: null,
      locale: 'de'
    });
  });

  it('answers 503 AI_REPORTS_UNAVAILABLE before the owner SQL is applied', async () => {
    const service = new AiReportsService(
      fakeRepo({ create: vi.fn(async () => ({ available: false, created: false })) }),
      new FakeClock()
    );
    await expect(
      service.create('user-1', createAiReportSchema.parse(validBody))
    ).rejects.toMatchObject({ httpStatus: 503, code: 'AI_REPORTS_UNAVAILABLE' });
  });

  it('answers 404 when the account is missing or not active', async () => {
    const service = new AiReportsService(
      fakeRepo({ create: vi.fn(async () => ({ available: true, created: false })) }),
      new FakeClock()
    );
    await expect(
      service.create('gone', createAiReportSchema.parse(validBody))
    ).rejects.toMatchObject({
      httpStatus: 404
    });
  });

  it('purges reports older than the 90-day retention window', async () => {
    const repo = fakeRepo({ purgeOlderThan: vi.fn(async () => 3) });
    const clock = new FakeClock(new Date('2026-11-11T12:00:00.000Z'));
    const service = new AiReportsService(repo, clock);
    expect(AI_REPORT_RETENTION_DAYS).toBe(90);
    await expect(service.purgeExpired()).resolves.toBe(3);
    expect(repo.purgeOlderThan).toHaveBeenCalledWith(new Date('2026-08-13T12:00:00.000Z'));
  });
});

describe('PgAiReportsRepository (SQL harness, not a live database)', () => {
  it('inserts only for an active account, scoped to the authenticated id', async () => {
    const query = vi.fn(async () => ({ rowCount: 1, rows: [{ id: 'r1' }] }));
    const repo = new PgAiReportsRepository({ query } as unknown as pg.Pool);
    await expect(
      repo.create({
        userId: 'user-1',
        surface: 'analytics_insight',
        category: 'inaccurate',
        replyText: null,
        note: 'wrong numbers',
        locale: 'fr'
      })
    ).resolves.toEqual({ available: true, created: true });
    const [sql, params] = query.mock.calls[0] as unknown as [string, unknown[]];
    expect(sql).toContain('INSERT INTO ai_content_reports');
    expect(sql).toContain("WHERE u.id = $1 AND u.status = 'active'");
    expect(params).toEqual([
      'user-1',
      'analytics_insight',
      'inaccurate',
      null,
      'wrong numbers',
      'fr'
    ]);
  });

  it('reports a missing account as not created', async () => {
    const query = vi.fn(async () => ({ rowCount: 0, rows: [] }));
    const repo = new PgAiReportsRepository({ query } as unknown as pg.Pool);
    await expect(
      repo.create({
        userId: 'gone',
        surface: 'assistant',
        category: 'spam',
        replyText: null,
        note: null,
        locale: 'en'
      })
    ).resolves.toEqual({ available: true, created: false });
  });

  it('degrades to unavailable while the table is absent, and rethrows other errors', async () => {
    resetAiReportsWarningForTests();
    const missing = vi.fn(async () => {
      throw Object.assign(new Error('relation "ai_content_reports" does not exist'), {
        code: '42P01'
      });
    });
    const absent = new PgAiReportsRepository({ query: missing } as unknown as pg.Pool);
    const report = {
      userId: 'user-1',
      surface: 'assistant' as const,
      category: 'other' as const,
      replyText: null,
      note: null,
      locale: 'en'
    };
    await expect(absent.create(report)).resolves.toEqual({ available: false, created: false });
    await expect(absent.purgeOlderThan(new Date())).resolves.toBe(0);

    const broken = new PgAiReportsRepository({
      query: vi.fn(async () => {
        throw new Error('connection reset');
      })
    } as unknown as pg.Pool);
    await expect(broken.create(report)).rejects.toThrow('connection reset');
    await expect(broken.purgeOlderThan(new Date())).rejects.toThrow('connection reset');
  });
});

function buildTestApp(reports: AiReportsService, ai: AiService) {
  const app = express();
  app.use(express.json());
  const authenticate: RequestHandler = (req, _res, next) => {
    const id = req.header('x-test-user');
    if (id) {
      req.user = {
        id,
        email: 'user@example.com',
        status: 'active',
        timezone: 'Africa/Cairo',
        locale: 'ar',
        weekStart: 0,
        defaultCurrency: 'EGP',
        pushShowTitles: true
      };
    }
    next();
  };
  const rateLimiter = new MemoryRateLimiter();
  // Same order as app.ts: reports first, then the AI router with its kill switch.
  app.use(
    '/api/v1/ai/reports',
    successEnvelopeMiddleware,
    createAiReportsRouter({ service: reports, authenticate, rateLimiter })
  );
  app.use(
    '/api/v1/ai',
    successEnvelopeMiddleware,
    createAiRouter({ service: ai, authenticate, rateLimiter, minuteLimit: 100, dailyLimit: 100 })
  );
  app.use(globalErrorHandler);
  return app;
}

describe('AI report HTTP surface', () => {
  const disabledAi = new AiService(null, false);

  it('stores a report while the AI kill switch is off, without caching', async () => {
    const repo = fakeRepo();
    const app = buildTestApp(new AiReportsService(repo, new FakeClock()), disabledAi);
    const res = await request(app)
      .post('/api/v1/ai/reports')
      .set('x-test-user', 'user-1')
      .send(validBody);
    expect(res.status).toBe(201);
    expect(res.body).toEqual({ success: true, data: { reported: true } });
    expect(res.headers['cache-control']).toBe('no-store');
    expect(repo.create).toHaveBeenCalledOnce();

    const chat = await request(app)
      .post('/api/v1/ai/chat')
      .set('x-test-user', 'user-1')
      .send({ messages: [{ role: 'user', text: 'hi' }] });
    expect(chat.status).toBe(503);
    expect(chat.body.error.code).toBe('AI_DISABLED');
  });

  it('rejects unauthenticated and invalid requests', async () => {
    const repo = fakeRepo();
    const app = buildTestApp(new AiReportsService(repo, new FakeClock()), disabledAi);
    const anonymous = await request(app).post('/api/v1/ai/reports').send(validBody);
    expect(anonymous.status).toBe(401);
    const invalid = await request(app)
      .post('/api/v1/ai/reports')
      .set('x-test-user', 'user-1')
      .send({ ...validBody, conversation: ['private'] });
    expect(invalid.status).toBe(400);
    expect(invalid.body.error.code).toBe('VALIDATION_ERROR');
    expect(repo.create).not.toHaveBeenCalled();
  });

  it('answers 503 AI_REPORTS_UNAVAILABLE until the owner SQL ran', async () => {
    const repo = fakeRepo({ create: vi.fn(async () => ({ available: false, created: false })) });
    const app = buildTestApp(new AiReportsService(repo, new FakeClock()), disabledAi);
    const res = await request(app)
      .post('/api/v1/ai/reports')
      .set('x-test-user', 'user-1')
      .send(validBody);
    expect(res.status).toBe(503);
    expect(res.body.error.code).toBe('AI_REPORTS_UNAVAILABLE');
  });

  it('limits each user to 10 reports per hour', async () => {
    expect(AI_REPORTS_HOURLY_LIMIT).toBe(10);
    expect(AI_REPORTS_DAILY_LIMIT).toBe(30);
    const app = buildTestApp(new AiReportsService(fakeRepo(), new FakeClock()), disabledAi);
    for (let i = 0; i < AI_REPORTS_HOURLY_LIMIT; i += 1) {
      const ok = await request(app)
        .post('/api/v1/ai/reports')
        .set('x-test-user', 'user-1')
        .send(validBody);
      expect(ok.status).toBe(201);
    }
    const limited = await request(app)
      .post('/api/v1/ai/reports')
      .set('x-test-user', 'user-1')
      .send(validBody);
    expect(limited.status).toBe(429);
    const otherUser = await request(app)
      .post('/api/v1/ai/reports')
      .set('x-test-user', 'user-2')
      .send(validBody);
    expect(otherUser.status).toBe(201);
  });
});

describe('owner-run production SQL (AI-P)', () => {
  it('is byte-identical to the forward-only migration body and runs in one transaction', () => {
    const migrationBody = /pgm\.sql\(`\n([\s\S]*?)\n\s*`\);/.exec(migrationSource)![1]!;
    const ownerSql = repoFile('docs/ai/sql/ai-content-reports.sql');
    const ownerBody = /-- BEGIN MIGRATION BODY\n([\s\S]*?)\n-- END MIGRATION BODY/.exec(
      ownerSql
    )![1]!;
    expect(ownerBody).toBe(migrationBody);
    expect(ownerSql).toMatch(/\nBEGIN;\n-- BEGIN MIGRATION BODY/);
    expect(ownerSql.trimEnd().endsWith('-- END MIGRATION BODY\nCOMMIT;')).toBe(true);
    expect(ownerSql).toContain('must NOT be run there');
    expect(migrationSource).toMatch(/exports\.down = \(\) => \{\n\s*throw new Error/);
  });

  it('keeps the database limits identical to the API validation', () => {
    expect(migrationSource).toContain(
      "surface IN ('assistant', 'weekly_coaching', 'analytics_insight')"
    );
    expect(migrationSource).toContain(
      "category IN ('offensive', 'harmful', 'inaccurate', 'spam', 'other')"
    );
    expect(migrationSource).toContain('char_length(reply_text) BETWEEN 1 AND 4000');
    expect(migrationSource).toContain('char_length(note) BETWEEN 1 AND 500');
    expect(migrationSource).toContain('locale VARCHAR(16) NOT NULL');
  });

  it('keeps both schema snapshots in step with the migration', () => {
    for (const snapshot of [
      'schema.sql',
      'backend/src/infrastructure/database/postgres/schema-sql.ts'
    ]) {
      const text = repoFile(snapshot).replace(/\\n/g, '\n').replace(/\\"/g, '"');
      expect(text, snapshot).toContain('CREATE TABLE ai_content_reports (');
      expect(text, snapshot).toContain(
        'user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,'
      );
      expect(text, snapshot).toContain(
        'GRANT SELECT, INSERT, DELETE ON ai_content_reports TO lifestyle_app;'
      );
    }
  });

  it('is erased with the account, optional until applied, and excluded from the v1 archive', () => {
    expect(USER_OWNED_TABLES_IN_DELETE_ORDER).toContain('ai_content_reports');
    expect(OPTIONAL_USER_OWNED_TABLES.has('ai_content_reports')).toBe(true);
    expect(ACCOUNT_ARCHIVE_OWNED_EXCLUSIONS).toContain('ai_content_reports');
  });

  it('grants the runtime role append-only access in both runtime-grant drafts', () => {
    for (const draft of [
      'docs/remediation/drafts/neon-runtime-role-and-marker.sql',
      'docs/remediation/drafts/1792900000000_runtime_grants_rehearsal.cjs'
    ]) {
      const text = repoFile(draft);
      expect(text, draft).toContain(
        'GRANT SELECT, INSERT, DELETE ON public.ai_content_reports TO lifestyle_app;'
      );
      expect(text, draft).not.toContain('UPDATE, DELETE ON public.ai_content_reports');
    }
  });
});
