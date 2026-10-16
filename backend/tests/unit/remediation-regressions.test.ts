import { AuthService } from '../../src/features/auth/auth.service.js';
import { validateEnv } from '../../src/config/env.js';
import { logger } from '../../src/core/logger/logger.js';
import { createApp } from '../../src/app.js';
import type { RemindersService } from '../../src/features/reminders/reminders.service.js';
import { describe, it, expect, vi } from 'vitest';
import express from 'express';
import request from 'supertest';
import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { Kysely, PostgresDialect } from 'kysely';
import type { DatabaseSchema } from '../../src/infrastructure/database/postgres/kysely.js';
import { createDashboardRouter } from '../../src/features/dashboard/dashboard.routes.js';
import { DashboardService } from '../../src/features/dashboard/dashboard.service.js';
import { MemoryRateLimiter } from '../../src/core/middleware/rate-limiter.js';
import { AppError } from '../../src/core/errors/app-error.js';
import { globalErrorHandler } from '../../src/core/middleware/error-handler.js';
import { toMinor } from '../../src/features/money/money.reader.js';
import { dayParamSchema } from '../../src/features/days/days.validation.js';
import { literalContainsPattern } from '../../src/core/pagination/search-pattern.js';
import { assertTestTargets } from '../test-safety.js';
import { currencySchema, timezoneSchema } from '../../src/core/security/profile-validation.js';
import { passwordSchema } from '../../src/features/auth/auth.validation.js';
import {
  createTransactionSchema,
  createCategorySchema,
  updateCategorySchema,
  validateMonetaryString
} from '../../src/features/money/money.validation.js';
import { SmtpEmailSender } from '../../src/infrastructure/external/email-sender.js';
import {
  PgTimerMaintenanceStore,
  PgPurgeStore,
  PgReminderDispatchStore
} from '../../src/jobs/job-stores.pg.js';
import type { Transporter } from 'nodemailer';
import {
  normalizeAuditRequestId,
  PgAuditLogger
} from '../../src/infrastructure/database/postgres/audit-logger.js';
import { PgUsersRepository } from '../../src/features/users/users.repository.pg.js';
import { TimerSessionsService } from '../../src/features/timer-sessions/timer-sessions.service.js';
import { recurrenceDefinitionSchema } from '../../src/features/recurring-tasks/recurring-tasks.validation.js';
import {
  createNoteSchema,
  updateNoteSchema,
  linkNoteSchema
} from '../../src/features/notes/notes.validation.js';
import {
  createGoalSchema,
  updateGoalSchema
} from '../../src/features/goals/goals.validation.js';
import { createReminderSchema } from '../../src/features/reminders/reminders.validation.js';
import { searchQuerySchema } from '../../src/features/search/search.validation.js';

const source = (path: string) => readFileSync(new URL(`../../../${path}`, import.meta.url), 'utf8');

function sqlHarness(fail = false) {
  const query = vi.fn(async (_sql: string, _args: unknown[]) => {
    if (fail) throw new Error('permission denied');
    return { rows: [], rowCount: 0, command: 'UPDATE' };
  });
  const db = new Kysely<DatabaseSchema>({
    dialect: new PostgresDialect({
      pool: { connect: async () => ({ query, release: vi.fn() }), end: vi.fn() } as never
    })
  });
  return { db, query };
}

describe('R-01 real dashboard router / mobile contract', () => {
  function app(authenticated: boolean, failing = false) {
    const service = {
      getOverview: vi.fn(async () => {
        if (failing) throw new Error('DB private error');
        return { date: '2026-10-15', tasks: { dueToday: 0 } };
      })
    };
    const api = express();
    api.use(
      '/api/v1/dashboard',
      createDashboardRouter({
        service: service as unknown as DashboardService,
        rateLimiter: new MemoryRateLimiter(),
        authenticate: (req, _res, next) => {
          if (!authenticated)
            return next(AppError.unauthenticated('Authentication required', 'UNAUTHENTICATED'));
          req.user = {
            id: 'user-a',
            timezone: 'UTC',
            email: 'test@example.com',
            status: 'active',
            locale: 'en',
            weekStart: 1,
            defaultCurrency: 'USD',
            pushShowTitles: false
          };
          next();
        }
      })
    );
    api.use(globalErrorHandler);
    return { api, service };
  }
  it('serves the actual client route and preserves the overview response key and user scope', async () => {
    const client = source('mobile-app/mobile/lib/features/more/data/daily_plan_models.dart');
    const path = /_api.get\('(dashboard[^']*)'\)/.exec(client)?.[1];
    expect(path).toBe('dashboard/overview');
    expect(source('docs/api/openapi.yaml')).toContain('/dashboard/overview:');
    const { api, service } = app(true);
    const response = await request(api).get(`/api/v1/${path}`);
    expect(response.status).toBe(200);
    expect(response.body.overview.tasks.dueToday).toBe(0);
    expect(service.getOverview).toHaveBeenCalledWith('user-a', 'UTC');
    expect((await request(api).get('/api/v1/dashboard')).status).toBe(404);
  });
  it('rejects unauthenticated requests and does not call the service', async () => {
    const { api, service } = app(false);
    expect((await request(api).get('/api/v1/dashboard/overview')).status).toBe(401);
    expect(service.getOverview).not.toHaveBeenCalled();
  });
  it('returns a failure, not a successful empty overview, when composition fails', async () => {
    const { api } = app(true, true);
    const response = await request(api).get('/api/v1/dashboard/overview');
    expect(response.status).toBe(500);
    expect(JSON.stringify(response.body)).not.toContain('DB private error');
  });
});

describe('R-02 / R-03 / R-09 reset delivery boundary', () => {
  it('has no reset queue producer, payload type or environment-dependent sender', () => {
    expect(existsSync(new URL('../../src/jobs/email-queue.ts', import.meta.url))).toBe(false);
    const container = source('backend/src/container.ts');
    expect(container).not.toContain('QueuedEmailSender');
    expect(container).toContain('overrides?.emailSender ?? new SmtpEmailSender()');
    expect(source('backend/src/worker.ts')).not.toContain('PasswordResetEmailJob');
  });
  it('sends a reset message only through the injected SMTP transport', async () => {
    const sendMail = vi.fn(async () => ({ accepted: ['test@example.com'], rejected: [] }));
    await new SmtpEmailSender({ sendMail } as unknown as Transporter).sendPasswordResetEmail(
      'test@example.com',
      '123456'
    );
    expect(sendMail).toHaveBeenCalledOnce();
    expect(sendMail.mock.calls[0]).toBeDefined();
  });
  it.each(['reject', 'timeout', 'network'])(
    'rejects and sanitizes %s failures so reminder retry can fire',
    async (failure) => {
      const transport = {
        sendMail: vi.fn(async () => {
          if (failure === 'reject') return { accepted: [], rejected: ['private@example.com'] };
          throw new Error(`provider ${failure}: secret 123456 private@example.com`);
        })
      } as unknown as Transporter;
      const sender = new SmtpEmailSender(transport);
      await expect(sender.sendPasswordResetEmail('test@example.com', '123456')).rejects.toThrow(
        /^EMAIL_DELIVERY_FAILED$/
      );
      await expect(
        sender.sendReminderEmail('test@example.com', 'Reminder', 'body')
      ).rejects.toThrow(/^EMAIL_DELIVERY_FAILED$/);
    }
  );
});

describe('R-07 currency minor strings', () => {
  it.each([
    ['1.005', 'USD', '101'],
    ['500', 'JPY', '500'],
    ['12.345', 'KWD', '12345'],
    ['0.0005', 'KWD', '1'],
    ['-1.005', 'USD', '-101'],
    ['999999999999999.9999', 'KWD', '1000000000000000000']
  ])('rounds %s %s half-up exactly', (amount, currency, expected) => {
    expect(toMinor(amount, currency)).toBe(expected);
  });
});

describe('R-13 / R-14 / B-17 / B-26 / B-29 validation', () => {
  it.each(['2026-02-29', '2026-13-45', '0000-01-01', '2026-04-31'])(
    'rejects impossible/out-of-range day %s',
    (date) => {
      expect(dayParamSchema.safeParse({ date }).success).toBe(false);
    }
  );
  it('accepts leap days and treats search wildcards literally', () => {
    expect(dayParamSchema.parse({ date: '2028-02-29' }).date).toBe('2028-02-29');
    expect(literalContainsPattern('50%_\\')).toBe('%50\\%\\_\\\\%');
  });
  it('refuses dev endpoints even when destructive tests are acknowledged', () => {
    expect(() => assertTestTargets({})).toThrow();
    expect(() =>
      assertTestTargets({
        ALLOW_DESTRUCTIVE_TESTS: 'isolated-resources-only',
        DATABASE_URL: 'postgresql://test:test@localhost/lifestyle_dev',
        REDIS_URL: 'redis://localhost/0'
      })
    ).toThrow();
    expect(() =>
      assertTestTargets({
        ALLOW_DESTRUCTIVE_TESTS: 'isolated-resources-only',
        DATABASE_URL: 'postgresql://test:test@localhost/lifestyle_test',
        REDIS_URL: 'redis://localhost/15'
      })
    ).not.toThrow();
  });
  it('rejects invalid timezone/currency, blank passwords, and extra transaction keys', () => {
    expect(timezoneSchema.safeParse('Not/AZone').success).toBe(false);
    expect(currencySchema.safeParse('ZZZ').success).toBe(false);
    expect(currencySchema.parse('KWD')).toBe('KWD');
    expect(passwordSchema.safeParse('          ').success).toBe(false);
    expect(
      createTransactionSchema.safeParse({
        kind: 'expense',
        amount: '1.00',
        currency: 'USD',
        occurredOn: '2026-10-15',
        injected: true
      }).success
    ).toBe(false);
  });
});

describe('R-06 / R-12 / R-17 SQL generation (not a real database)', () => {
  it('caps timer closure at started_at + 12 hours, not worker execution time', async () => {
    const { db, query } = sqlHarness();
    await new PgTimerMaintenanceStore(db).autoCloseStale(new Date());
    expect(query.mock.calls[0]?.[0]).toContain("started_at + interval '12 hours'");
    await db.destroy();
  });
  it('propagates purge errors rather than hiding a failed retention pass', async () => {
    const { db } = sqlHarness(true);
    await expect(new PgPurgeStore(db).purgeSoftDeleted(new Date())).rejects.toThrow(
      'permission denied'
    );
    await db.destroy();
  });
  it('recovers stale processing leases and fences stale attempt writeback', async () => {
    const { db, query } = sqlHarness();
    const store = new PgReminderDispatchStore(db);
    await store.claimDue(new Date(), 10);
    expect(query.mock.calls[0]?.[0]).toContain("last_error_code = 'LEASE_EXPIRED'");
    expect(query.mock.calls[1]?.[0]).toContain("status = 'processing' AND processing_started_at");
    await store.markSent('id', new Date(), 2);
    expect(query.mock.calls[2]?.[0]).toContain('"attempt_count" =');
    expect(query.mock.calls[2]?.[1]).toContain(2);
    await db.destroy();
  });
});

describe('B-28 session TTL configuration', () => {
  it('uses configured absolute and sliding expiry in registration', async () => {
    const now = Date.now();
    validateEnv({ ...process.env, SESSION_ABSOLUTE_TTL_DAYS: '5', REFRESH_TOKEN_TTL_DAYS: '2' });
    const repo = {
      createUser: vi.fn(async () => ({ id: 'user', created_at: new Date(now) })),
      createDefaultCategories: vi.fn(),
      createSession: vi.fn(async () => ({ id: 'session' })),
      createRefreshToken: vi.fn()
    };
    const client = { query: vi.fn(), release: vi.fn() };
    const service = new AuthService(
      repo as never,
      { connect: async () => client } as never,
      { hash: async () => 'hash' } as never,
      {
        signAccessToken: async () => ({ token: 'token', expiresAt: new Date(now + 900000) })
      } as never,
      {} as never,
      {} as never,
      { log: vi.fn() } as never
    );
    await service.register({
      email: 'test@example.com',
      password: 'ValidPassword123!',
      displayName: 'Test',
      timezone: 'UTC',
      defaultCurrency: 'USD',
      locale: 'en'
    });
    const sessionArgs = repo.createSession.mock.calls as unknown as [[{ absoluteExpiresAt: Date }]];
    const tokenArgs = repo.createRefreshToken.mock.calls as unknown as [[{ expiresAt: Date }]];
    expect(sessionArgs[0][0].absoluteExpiresAt.getTime() - now).toBeGreaterThanOrEqual(
      5 * 86400000
    );
    expect(sessionArgs[0][0].absoluteExpiresAt.getTime() - now).toBeLessThan(5 * 86400000 + 2000);
    expect(tokenArgs[0][0].expiresAt.getTime() - now).toBeGreaterThanOrEqual(2 * 86400000);
    expect(tokenArgs[0][0].expiresAt.getTime() - now).toBeLessThan(2 * 86400000 + 2000);
    validateEnv(process.env);
  });
});

describe('Reset request failure observability without account disclosure', () => {
  it('records sanitized delivery failure while keeping generic request acceptance', async () => {
    const audit = { log: vi.fn() };
    const log = vi.spyOn(logger, 'error').mockImplementation(() => undefined);
    try {
      const service = new AuthService(
        {
          findUserByEmail: async () => ({ id: 'u', email: 'private@example.com', status: 'active' })
        } as never,
        {} as never,
        {} as never,
        {} as never,
        { checkCooldown: async () => true, generateAndStoreCode: async () => '123456' } as never,
        {
          sendPasswordResetEmail: async () => {
            throw new Error('123456 private@example.com');
          }
        } as never,
        audit as never
      );
      await expect(service.forgotPassword('private@example.com')).resolves.toBeUndefined();
      await service.waitForResetRequests();
      expect(audit.log).toHaveBeenCalledWith(expect.objectContaining({ outcome: 'failure' }));
      expect(JSON.stringify(log.mock.calls)).not.toContain('123456');
      expect(JSON.stringify(log.mock.calls)).not.toContain('private@example.com');
    } finally {
      log.mockRestore();
    }
  });
});

describe('R-20 real application reminder mount ordering', () => {
  it('authenticates a parent reminder request only once', async () => {
    const authenticate = vi.fn((req, _res, next) => {
      req.user = { id: 'user', timezone: 'UTC' };
      next();
    });
    const app = createApp({
      authenticate,
      remindersService: { listForParent: async () => [] } as unknown as RemindersService
    });
    const response = await request(app).get(
      '/api/v1/tasks/00000000-0000-4000-8000-000000000001/reminders'
    );
    expect(response.status).toBe(200);
    expect(authenticate).toHaveBeenCalledOnce();
  });
});

it('every infrastructure suite has an import-time safety guard even without runner configuration', () => {
  for (const folder of ['integration', 'security']) {
    const directory = new URL(`../${folder}/`, import.meta.url);
    for (const path of readdirSync(directory).filter((path) => path.endsWith('.test.ts'))) {
      expect(
        readFileSync(new URL(path, directory), 'utf8').startsWith(
          "import '../infrastructure-safety.js';"
        )
      ).toBe(true);
    }
  }
});

describe('Production Readiness Audit Regressions (DEF-01..DEF-09)', () => {
  it('DEF-01 / SEC-01: normalizes non-UUID request IDs before audit_logs insertion and preserves clientRequestId in metadata', async () => {
    const validUuid = '550e8400-e29b-41d4-a716-446655440000';
    expect(normalizeAuditRequestId(validUuid, { a: 1 })).toEqual({
      uuidRequestId: validUuid,
      metadata: { a: 1 }
    });

    const nonUuid = 'custom-trace-id-not-uuid';
    expect(normalizeAuditRequestId(nonUuid, { ip: '127.0.0.1' })).toEqual({
      uuidRequestId: null,
      metadata: { ip: '127.0.0.1', clientRequestId: nonUuid }
    });

    const querySpy = vi.fn().mockResolvedValue({ rowCount: 1, rows: [] });
    const auditLogger = new PgAuditLogger({ query: querySpy } as never);
    await auditLogger.log({
      actorType: 'user',
      actorUserId: validUuid,
      action: 'auth.login',
      outcome: 'failure',
      requestId: nonUuid,
      metadata: { reason: 'bad_password' }
    });

    expect(querySpy).toHaveBeenCalledTimes(1);
    const params = querySpy.mock.calls[0]?.[1] as unknown[];
    expect(params[7]).toBeNull();
    expect(JSON.parse(String(params[10]))).toEqual({
      reason: 'bad_password',
      clientRequestId: nonUuid
    });
  });

  it('DEF-02 / SEC-02: prevents cross-account push token hijacking in PgUsersRepository.upsertPushDevice', async () => {
    const querySpy = vi.fn().mockResolvedValue({ rowCount: 0, rows: [] });
    const repo = new PgUsersRepository({ query: querySpy } as never);

    await expect(
      repo.upsertPushDevice(
        '22222222-2222-4222-8222-222222222222',
        '33333333-3333-4333-8333-333333333333',
        { platform: 'android', pushToken: 'token-owned-by-another-active-user' }
      )
    ).rejects.toMatchObject({
      httpStatus: 409,
      code: 'CONFLICT'
    });
  });

  it('DEF-04 / SEC-04: enforces 6-digit hex category colors and currency exponent validation', () => {
    expect(
      createCategorySchema.safeParse({ name: 'Food', kind: 'expense', color: '#abc' }).success
    ).toBe(false);
    expect(
      createCategorySchema.safeParse({ name: 'Food', kind: 'expense', color: '#AABBCC' }).success
    ).toBe(true);
    expect(updateCategorySchema.safeParse({ color: '#123', version: 1 }).success).toBe(false);
    expect(validateMonetaryString('100.50', 'JPY')).toBe(false);
    expect(validateMonetaryString('100', 'JPY')).toBe(true);
    expect(validateMonetaryString('10.123', 'KWD')).toBe(true);
    expect(validateMonetaryString('10.123', 'EGP')).toBe(false);
  });

  it('DEF-05: rejects cancelDeletion with 409 CONFLICT when account is not pending_deletion', async () => {
    const querySpy = vi.fn().mockResolvedValue({ rowCount: 0, rows: [] });
    const repo = new PgUsersRepository({ query: querySpy } as never);

    await expect(
      repo.cancelDeletion('11111111-1111-4111-8111-111111111111')
    ).rejects.toMatchObject({
      httpStatus: 409,
      code: 'CONFLICT'
    });
  });

  it('DEF-07: clamps ended_at to started_at + 1ms when stopping a timer within the same millisecond', async () => {
    const now = new Date('2026-10-16T15:00:00.100Z');
    const stopSpy = vi.fn().mockImplementation(async (_u, id, endedAt, endReason) => ({
      id,
      user_id: '11111111-1111-4111-8111-111111111111',
      task_id: null,
      mode: 'stopwatch',
      planned_seconds: null,
      started_at: now,
      ended_at: endedAt,
      end_reason: endReason,
      created_at: now,
      updated_at: endedAt
    }));
    const repo = {
      findById: vi.fn().mockResolvedValue({
        id: '22222222-2222-4222-8222-222222222222',
        user_id: '11111111-1111-4111-8111-111111111111',
        task_id: null,
        mode: 'stopwatch',
        planned_seconds: null,
        started_at: now,
        ended_at: null,
        end_reason: null,
        created_at: now,
        updated_at: now
      }),
      stop: stopSpy
    };

    const service = new TimerSessionsService(repo as never, {} as never, { now: () => now });
    const dto = await service.stopTimer(
      '11111111-1111-4111-8111-111111111111',
      '22222222-2222-4222-8222-222222222222'
    );
    expect(stopSpy).toHaveBeenCalledTimes(1);
    const passedEndedAt = stopSpy.mock.calls[0]?.[2] as Date;
    expect(passedEndedAt.getTime()).toBe(now.getTime() + 1);
    expect(dto.durationSeconds).toBe(0);
  });

  it('DEF-08: enforces strict request schemas and recurrence DB check invariants', () => {
    expect(createNoteSchema.safeParse({ title: 'T', body: 'B', unknownField: 1 }).success).toBe(
      false
    );
    expect(updateNoteSchema.safeParse({ title: 'T', version: 1, extra: true }).success).toBe(false);
    expect(
      linkNoteSchema.safeParse({
        entityType: 'task',
        entityId: '550e8400-e29b-41d4-a716-446655440000',
        extra: 1
      }).success
    ).toBe(false);
    expect(createGoalSchema.safeParse({ title: 'G', extra: 1 }).success).toBe(false);
    expect(updateGoalSchema.safeParse({ title: 'G', version: 1, extra: 1 }).success).toBe(false);
    expect(
      createReminderSchema.safeParse({ remindAt: '2026-10-16T12:00:00Z', extra: 1 }).success
    ).toBe(false);
    expect(searchQuerySchema.safeParse({ q: 'hello', extra: 1 }).success).toBe(false);

    expect(
      recurrenceDefinitionSchema.safeParse({
        freq: 'daily',
        interval: 366,
        startDate: '2026-10-16'
      }).success
    ).toBe(false);

    expect(
      recurrenceDefinitionSchema.safeParse({
        freq: 'monthly',
        interval: 1,
        startDate: '2026-10-16'
      }).success
    ).toBe(false);
  });
});
