/**
 * tests/unit/ai-settings.test.ts
 *
 * Hybrid AI slice AI-2: AI settings and the durable, versioned AI consent.
 *  - the PATCH body is strict, partial and needs at least one field;
 *  - a stale consent version answers 409 AI_CONSENT_VERSION_MISMATCH;
 *  - until the owner SQL ran, reading shows the defaults (available: false)
 *    and saving answers 503 AI_SETTINGS_UNAVAILABLE;
 *  - the settings work while the AI kill switch is off, with their own limit;
 *  - the repository changes only the sent fields, in one statement, for an
 *    active account;
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
import { AiService } from '../../src/features/ai/ai.service.js';
import { createAiRouter } from '../../src/features/ai/ai.routes.js';
import type { AiSettingsRepository } from '../../src/features/ai-settings/ai-settings.repository.js';
import { PgAiSettingsRepository } from '../../src/features/ai-settings/ai-settings.repository.pg.js';
import {
  AI_SETTINGS_USER_LIMIT,
  createAiSettingsRouter
} from '../../src/features/ai-settings/ai-settings.routes.js';
import { AiSettingsService } from '../../src/features/ai-settings/ai-settings.service.js';
import {
  AI_EGRESS_CONSENT_VERSION,
  DEFAULT_AI_SETTINGS,
  type AiSettings
} from '../../src/features/ai-settings/ai-settings.types.js';
import { patchAiSettingsSchema } from '../../src/features/ai-settings/ai-settings.validation.js';
import { ACCOUNT_ARCHIVE_OWNED_EXCLUSIONS } from '../../src/features/users/account-archive.sources.js';
import {
  OPTIONAL_USER_OWNED_TABLES,
  USER_OWNED_TABLES_IN_DELETE_ORDER
} from '../../src/features/users/users.repository.pg.js';

const repoFile = (relative: string) =>
  readFileSync(new URL(`../../../${relative}`, import.meta.url), 'utf8');
const migrationSource = repoFile(
  'backend/src/infrastructure/database/postgres/migrations/1792790000000_ai_user_settings.cjs'
);

const consented: AiSettings = {
  ...DEFAULT_AI_SETTINGS,
  egressConsentVersion: AI_EGRESS_CONSENT_VERSION,
  egressConsentAt: '2026-11-12T09:00:00.000Z'
};

function fakeRepo(overrides?: Partial<AiSettingsRepository>): AiSettingsRepository {
  return {
    find: vi.fn(async () => ({ available: true as const, settings: null })),
    update: vi.fn(async () => ({ available: true as const, settings: consented })),
    ...overrides
  };
}

const missingTable = () => Object.assign(new Error('relation does not exist'), { code: '42P01' });

describe('AI settings request schema', () => {
  it('accepts any non-empty subset of the known fields', () => {
    for (const body of [
      { egressConsentVersion: 1 },
      { egressConsentVersion: null },
      { languageMode: 'app_locale' },
      { memoryEnabled: true, learningEnabled: false },
      { explicitMemoryEnabled: true, quickActionsEnabled: true, languageMode: 'auto' }
    ]) {
      expect(patchAiSettingsSchema.safeParse(body).success, JSON.stringify(body)).toBe(true);
    }
  });

  it('rejects empty, unknown, mistyped and out-of-range bodies', () => {
    for (const body of [
      {},
      { egressConsentVersion: undefined },
      { provider: 'openai' },
      { languageMode: 'arabic' },
      { memoryEnabled: 'yes' },
      { memoryEnabled: null },
      { egressConsentVersion: 0 },
      { egressConsentVersion: 1.5 },
      { egressConsentVersion: '1' },
      { egressConsentVersion: 1001 },
      { languageMode: 'auto', userId: 'someone-else' }
    ]) {
      expect(patchAiSettingsSchema.safeParse(body).success, JSON.stringify(body)).toBe(false);
    }
  });
});

describe('AiSettingsService', () => {
  it('shows the defaults for an account without a row', async () => {
    const service = new AiSettingsService(fakeRepo());
    await expect(service.get('user-1')).resolves.toEqual({
      settings: DEFAULT_AI_SETTINGS,
      currentConsentVersion: AI_EGRESS_CONSENT_VERSION,
      available: true
    });
  });

  it('shows the defaults with available: false until the owner SQL ran', async () => {
    const service = new AiSettingsService(
      fakeRepo({ find: vi.fn(async () => ({ available: false as const })) })
    );
    await expect(service.get('user-1')).resolves.toMatchObject({
      settings: DEFAULT_AI_SETTINGS,
      available: false
    });
    expect(await service.hasCurrentConsent('user-1')).toBe(false);
  });

  it('accepts the current consent version and passes only the sent fields on', async () => {
    const repo = fakeRepo();
    const service = new AiSettingsService(repo);
    const view = await service.update('user-1', { egressConsentVersion: 1 });
    expect(view).toEqual({ settings: consented, currentConsentVersion: 1, available: true });
    expect(repo.update).toHaveBeenCalledWith('user-1', { egressConsentVersion: 1 });
  });

  it('answers 409 for a consent version the server does not show now', async () => {
    const repo = fakeRepo();
    const service = new AiSettingsService(repo, 2);
    await expect(service.update('user-1', { egressConsentVersion: 1 })).rejects.toMatchObject({
      httpStatus: 409,
      code: 'AI_CONSENT_VERSION_MISMATCH'
    });
    expect(repo.update).not.toHaveBeenCalled();
    // Withdrawing is always allowed.
    await service.update('user-1', { egressConsentVersion: null });
    expect(repo.update).toHaveBeenCalledWith('user-1', { egressConsentVersion: null });
  });

  it('answers 503 until the owner SQL ran and 404 for a missing or inactive account', async () => {
    const unavailable = new AiSettingsService(
      fakeRepo({ update: vi.fn(async () => ({ available: false as const })) })
    );
    await expect(unavailable.update('user-1', { languageMode: 'auto' })).rejects.toMatchObject({
      httpStatus: 503,
      code: 'AI_SETTINGS_UNAVAILABLE'
    });
    const gone = new AiSettingsService(
      fakeRepo({ update: vi.fn(async () => ({ available: true as const, settings: null })) })
    );
    await expect(gone.update('user-1', { languageMode: 'auto' })).rejects.toMatchObject({
      httpStatus: 404
    });
  });

  it('counts only the current version as consent', async () => {
    const repoWith = (settings: AiSettings | null) =>
      fakeRepo({ find: vi.fn(async () => ({ available: true as const, settings })) });
    expect(await new AiSettingsService(repoWith(consented)).hasCurrentConsent('u')).toBe(true);
    expect(await new AiSettingsService(repoWith(consented), 2).hasCurrentConsent('u')).toBe(false);
    expect(await new AiSettingsService(repoWith(null)).hasCurrentConsent('u')).toBe(false);
    expect(
      await new AiSettingsService(repoWith({ ...DEFAULT_AI_SETTINGS })).hasCurrentConsent('u')
    ).toBe(false);
  });
});

describe('PgAiSettingsRepository (SQL harness, not a live database)', () => {
  const row = {
    egress_consent_version: 1,
    egress_consent_at: new Date('2026-11-12T09:00:00Z'),
    memory_enabled: false,
    explicit_memory_enabled: false,
    learning_enabled: true,
    quick_actions_enabled: false,
    language_mode: 'app_locale'
  };

  it('reads only the settings columns of the authenticated account', async () => {
    const query = vi.fn(async () => ({ rows: [row] }));
    const repo = new PgAiSettingsRepository({ query } as unknown as pg.Pool);
    await expect(repo.find('user-1')).resolves.toEqual({
      available: true,
      settings: {
        egressConsentVersion: 1,
        egressConsentAt: '2026-11-12T09:00:00.000Z',
        memoryEnabled: false,
        explicitMemoryEnabled: false,
        learningEnabled: true,
        quickActionsEnabled: false,
        languageMode: 'app_locale'
      }
    });
    const [sql, params] = query.mock.calls[0] as unknown as [string, unknown[]];
    expect(sql).toMatch(/FROM ai_user_settings WHERE user_id = \$1$/);
    expect(sql).not.toMatch(/SELECT\s+\*/);
    expect(params).toEqual(['user-1']);
  });

  it('updates only the sent fields in one statement, for an active account only', async () => {
    const query = vi.fn(async (_sql: string, _params: unknown[]) => ({ rows: [row] }));
    const repo = new PgAiSettingsRepository({ query } as unknown as pg.Pool);
    await repo.update('user-1', { languageMode: 'app_locale' });
    const [sql, params] = query.mock.calls[0] as unknown as [string, unknown[]];
    expect(sql).toContain("WHERE u.id = $1 AND u.status = 'active'");
    expect(sql).toContain('ON CONFLICT (user_id) DO UPDATE SET');
    expect(sql).toContain(
      'memory_enabled = COALESCE($4::boolean, ai_user_settings.memory_enabled)'
    );
    // Not sent: consent flag false, every other field NULL (= keep).
    expect(params).toEqual(['user-1', false, null, null, null, null, null, 'app_locale']);

    await repo.update('user-1', { egressConsentVersion: null });
    expect(query.mock.calls[1]![1]).toEqual(['user-1', true, null, null, null, null, null, null]);
    await repo.update('user-1', { egressConsentVersion: 1, memoryEnabled: false });
    expect(query.mock.calls[2]![1]).toEqual(['user-1', true, 1, false, null, null, null, null]);
  });

  it('reports a missing or inactive account as settings: null', async () => {
    const repo = new PgAiSettingsRepository({
      query: vi.fn(async () => ({ rows: [] }))
    } as unknown as pg.Pool);
    await expect(repo.update('user-1', { languageMode: 'auto' })).resolves.toEqual({
      available: true,
      settings: null
    });
  });

  it('degrades to available: false while the table is missing, other errors still throw', async () => {
    const missing = new PgAiSettingsRepository({
      query: vi.fn(async () => {
        throw missingTable();
      })
    } as unknown as pg.Pool);
    await expect(missing.find('user-1')).resolves.toEqual({ available: false });
    await expect(missing.update('user-1', { languageMode: 'auto' })).resolves.toEqual({
      available: false
    });
    const broken = new PgAiSettingsRepository({
      query: vi.fn(async () => {
        throw Object.assign(new Error('connection reset'), { code: '08006' });
      })
    } as unknown as pg.Pool);
    await expect(broken.find('user-1')).rejects.toThrow('connection reset');
  });
});

function buildTestApp(settings: AiSettingsService, ai: AiService) {
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
  // Same order as app.ts: settings first, then the AI router with its kill switch.
  app.use(
    '/api/v1/ai/settings',
    successEnvelopeMiddleware,
    createAiSettingsRouter({ service: settings, authenticate, rateLimiter })
  );
  app.use(
    '/api/v1/ai',
    successEnvelopeMiddleware,
    createAiRouter({ service: ai, authenticate, rateLimiter, minuteLimit: 1, dailyLimit: 1 })
  );
  app.use(globalErrorHandler);
  return app;
}

describe('AI settings HTTP surface', () => {
  const disabledAi = new AiService(null, false);

  it('requires authentication', async () => {
    const app = buildTestApp(new AiSettingsService(fakeRepo()), disabledAi);
    expect((await request(app).get('/api/v1/ai/settings')).status).toBe(401);
    expect(
      (await request(app).patch('/api/v1/ai/settings').send({ memoryEnabled: true })).status
    ).toBe(401);
  });

  it('reads and saves while the AI kill switch is off, without using the chat quotas', async () => {
    const repo = fakeRepo();
    const app = buildTestApp(new AiSettingsService(repo), disabledAi);
    const read = await request(app).get('/api/v1/ai/settings').set('x-test-user', 'user-1');
    expect(read.status).toBe(200);
    expect(read.headers['cache-control']).toBe('no-store');
    expect(read.body.data).toEqual({
      settings: DEFAULT_AI_SETTINGS,
      currentConsentVersion: 1,
      available: true
    });
    for (let i = 0; i < 3; i++) {
      const saved = await request(app)
        .patch('/api/v1/ai/settings')
        .set('x-test-user', 'user-1')
        .send({ egressConsentVersion: 1 });
      expect(saved.status).toBe(200);
      expect(saved.body.data.settings.egressConsentVersion).toBe(1);
    }
    expect(repo.update).toHaveBeenCalledWith('user-1', { egressConsentVersion: 1 });
    // The chat endpoints still answer 503 with the kill switch off.
    const chat = await request(app)
      .post('/api/v1/ai/chat')
      .set('x-test-user', 'user-1')
      .send({ messages: [{ role: 'user', text: 'Hi' }] });
    expect(chat.status).toBe(503);
  });

  it('rejects an invalid body with 400 and a stale consent with 409', async () => {
    const app = buildTestApp(new AiSettingsService(fakeRepo(), 2), disabledAi);
    const invalid = await request(app)
      .patch('/api/v1/ai/settings')
      .set('x-test-user', 'user-1')
      .send({ languageMode: 'auto', extra: true });
    expect(invalid.status).toBe(400);
    const stale = await request(app)
      .patch('/api/v1/ai/settings')
      .set('x-test-user', 'user-1')
      .send({ egressConsentVersion: 1 });
    expect(stale.status).toBe(409);
    expect(stale.body.error.code).toBe('AI_CONSENT_VERSION_MISMATCH');
  });

  it('answers 503 AI_SETTINGS_UNAVAILABLE for saving before the owner SQL ran', async () => {
    const repo = fakeRepo({
      find: vi.fn(async () => ({ available: false as const })),
      update: vi.fn(async () => ({ available: false as const }))
    });
    const app = buildTestApp(new AiSettingsService(repo), disabledAi);
    const read = await request(app).get('/api/v1/ai/settings').set('x-test-user', 'user-1');
    expect(read.status).toBe(200);
    expect(read.body.data.available).toBe(false);
    const saved = await request(app)
      .patch('/api/v1/ai/settings')
      .set('x-test-user', 'user-1')
      .send({ memoryEnabled: true });
    expect(saved.status).toBe(503);
    expect(saved.body.error.code).toBe('AI_SETTINGS_UNAVAILABLE');
  });

  it('limits each account to 30 requests a minute', async () => {
    expect(AI_SETTINGS_USER_LIMIT).toBe(30);
    const app = buildTestApp(new AiSettingsService(fakeRepo()), disabledAi);
    for (let i = 0; i < AI_SETTINGS_USER_LIMIT; i++) {
      expect(
        (await request(app).get('/api/v1/ai/settings').set('x-test-user', 'user-1')).status
      ).toBe(200);
    }
    expect(
      (await request(app).get('/api/v1/ai/settings').set('x-test-user', 'user-1')).status
    ).toBe(429);
    expect(
      (await request(app).get('/api/v1/ai/settings').set('x-test-user', 'user-2')).status
    ).toBe(200);
  });
});

describe('owner-run production SQL (AI-2)', () => {
  it('is byte-identical to the forward-only migration body and runs in one transaction', () => {
    const migrationBody = /pgm\.sql\(`\n([\s\S]*?)\n\s*`\);/.exec(migrationSource)![1]!;
    const ownerSql = repoFile('docs/ai/sql/ai-user-settings.sql');
    const ownerBody = /-- BEGIN MIGRATION BODY\n([\s\S]*?)\n-- END MIGRATION BODY/.exec(
      ownerSql
    )![1]!;
    expect(ownerBody).toBe(migrationBody);
    expect(ownerSql).toMatch(/\nBEGIN;\n-- BEGIN MIGRATION BODY/);
    expect(ownerSql.trimEnd().endsWith('-- END MIGRATION BODY\nCOMMIT;')).toBe(true);
    expect(ownerSql).toContain('must NOT be run there');
    expect(migrationSource).toMatch(/exports\.down = \(\) => \{\n\s*throw new Error/);
  });

  it('keeps the database limits identical to the API', () => {
    expect(migrationSource).toContain("language_mode IN ('auto', 'app_locale')");
    expect(migrationSource).toContain(
      'egress_consent_version IS NULL OR egress_consent_version > 0'
    );
    expect(migrationSource).toContain(
      '(egress_consent_version IS NULL) = (egress_consent_at IS NULL)'
    );
    // Settings only: no column for provider choice (D3) or any AI text.
    const body = /pgm\.sql\(`\n([\s\S]*?)\n\s*`\);/.exec(migrationSource)![1]!;
    expect(body).not.toMatch(/provider|prompt|reply|content|memory_text/i);
  });

  it('keeps both schema snapshots in step with the migration', () => {
    for (const snapshot of [
      'schema.sql',
      'backend/src/infrastructure/database/postgres/schema-sql.ts'
    ]) {
      const text = repoFile(snapshot).replace(/\\n/g, '\n').replace(/\\"/g, '"');
      expect(text, snapshot).toContain('CREATE TABLE ai_user_settings (');
      expect(text, snapshot).toContain(
        'user_id UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,'
      );
      expect(text, snapshot).toContain(
        'GRANT SELECT, INSERT, UPDATE, DELETE ON ai_user_settings TO lifestyle_app;'
      );
    }
  });

  it('is erased with the account, optional until applied, and excluded from the v1 archive', () => {
    expect(USER_OWNED_TABLES_IN_DELETE_ORDER).toContain('ai_user_settings');
    expect(OPTIONAL_USER_OWNED_TABLES.has('ai_user_settings')).toBe(true);
    expect(ACCOUNT_ARCHIVE_OWNED_EXCLUSIONS).toContain('ai_user_settings');
  });

  it('grants the runtime role CRUD in both runtime-grant drafts', () => {
    for (const draft of [
      'docs/remediation/drafts/neon-runtime-role-and-marker.sql',
      'docs/remediation/drafts/1792900000000_runtime_grants_rehearsal.cjs'
    ]) {
      expect(repoFile(draft), draft).toContain(
        'GRANT SELECT, INSERT, UPDATE, DELETE ON public.ai_user_settings TO lifestyle_app;'
      );
    }
  });
});
