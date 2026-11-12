import '../infrastructure-safety.js';
/**
 * tests/integration/ai-settings-flow.test.ts
 *
 * AI-2 against migrated PostgreSQL: AI settings and the durable AI consent
 * (defaults, partial updates, consent version, isolation between accounts,
 * export, erasure, behaviour before the owner-run SQL). No production data.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import request from 'supertest';
import { createApp } from '../../src/app.js';
import { getPgPool } from '../../src/infrastructure/database/postgres/pool.js';
import { getRedisClient } from '../../src/infrastructure/redis/redis-client.js';
import { getContainer } from '../../src/container.js';
import { PgUsersRepository } from '../../src/features/users/users.repository.pg.js';
import { AiSettingsService } from '../../src/features/ai-settings/ai-settings.service.js';
import { PgAiSettingsRepository } from '../../src/features/ai-settings/ai-settings.repository.pg.js';

const PASSWORD = 'ValidUserPassword123!';

describe('AI settings and consent (AI-2) on PostgreSQL', () => {
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

  async function register(email: string) {
    const res = await request(app).post('/api/v1/auth/register').send({
      email,
      password: PASSWORD,
      displayName: 'Settings User',
      timezone: 'Africa/Cairo',
      defaultCurrency: 'USD'
    });
    expect(res.status).toBe(201);
    return res.body.data as { user: { id: string }; tokens: { accessToken: string } };
  }

  const read = (token: string, target = app) =>
    request(target).get('/api/v1/ai/settings').set('Authorization', `Bearer ${token}`);
  const patch = (token: string, body: object, target = app) =>
    request(target).patch('/api/v1/ai/settings').set('Authorization', `Bearer ${token}`).send(body);

  it('shows the defaults, records the consent and keeps fields that were not sent', async () => {
    const { user, tokens } = await register('settings@example.com');
    const first = await read(tokens.accessToken);
    expect(first.status).toBe(200);
    expect(first.body.data).toEqual({
      settings: {
        egressConsentVersion: null,
        egressConsentAt: null,
        memoryEnabled: false,
        explicitMemoryEnabled: false,
        learningEnabled: false,
        quickActionsEnabled: false,
        languageMode: 'auto'
      },
      currentConsentVersion: 1,
      available: true
    });

    const consent = await patch(tokens.accessToken, { egressConsentVersion: 1 });
    expect(consent.status).toBe(200);
    expect(consent.body.data.settings.egressConsentVersion).toBe(1);
    expect(consent.body.data.settings.egressConsentAt).toEqual(expect.any(String));

    const mode = await patch(tokens.accessToken, { languageMode: 'app_locale' });
    expect(mode.status).toBe(200);
    // The earlier consent is kept: only the sent field changed.
    expect(mode.body.data.settings).toMatchObject({
      egressConsentVersion: 1,
      languageMode: 'app_locale'
    });

    const withdrawn = await patch(tokens.accessToken, { egressConsentVersion: null });
    expect(withdrawn.body.data.settings).toMatchObject({
      egressConsentVersion: null,
      egressConsentAt: null,
      languageMode: 'app_locale'
    });
    const rows = (await pool.query('SELECT user_id, language_mode FROM ai_user_settings')).rows;
    expect(rows).toEqual([{ user_id: user.id, language_mode: 'app_locale' }]);
  });

  it('refuses a stale consent version and an invalid body without writing', async () => {
    const { tokens } = await register('stale@example.com');
    const stale = await patch(tokens.accessToken, { egressConsentVersion: 2 });
    expect(stale.status).toBe(409);
    expect(stale.body.error?.code ?? stale.body.code).toBe('AI_CONSENT_VERSION_MISMATCH');
    const invalid = await patch(tokens.accessToken, { languageMode: 'auto', userId: 'x' });
    expect(invalid.status).toBe(400);
    expect((await pool.query('SELECT count(*)::int AS n FROM ai_user_settings')).rows[0].n).toBe(0);
  });

  it('keeps every account to its own row', async () => {
    const a = await register('a-settings@example.com');
    const b = await register('b-settings@example.com');
    expect((await patch(a.tokens.accessToken, { egressConsentVersion: 1 })).status).toBe(200);
    const other = await read(b.tokens.accessToken);
    expect(other.body.data.settings.egressConsentVersion).toBeNull();
    const consent = new AiSettingsService(new PgAiSettingsRepository(pool));
    expect(await consent.hasCurrentConsent(a.user.id)).toBe(true);
    expect(await consent.hasCurrentConsent(b.user.id)).toBe(false);
  });

  it('is in the account export and is erased with the account', async () => {
    const { user, tokens } = await register('export-settings@example.com');
    expect((await patch(tokens.accessToken, { egressConsentVersion: 1 })).status).toBe(200);
    const exported = await request(app)
      .post('/api/v1/users/me/export')
      .set('Authorization', `Bearer ${tokens.accessToken}`)
      .send({ currentPassword: PASSWORD });
    expect(exported.status).toBe(200);
    expect(exported.body.aiSettings).toMatchObject({
      egressConsentVersion: 1,
      languageMode: 'auto',
      updatedAt: expect.any(String)
    });

    const users = new PgUsersRepository(pool);
    await users.scheduleDeletion(user.id, new Date(Date.now() - 1000));
    expect(await users.purgeAccount(user.id)).toBe(true);
    expect(
      (
        await pool.query('SELECT count(*)::int AS n FROM ai_user_settings WHERE user_id = $1', [
          user.id
        ])
      ).rows[0].n
    ).toBe(0);
  });

  /**
   * Runs one request against an app whose AI-settings repository cannot see
   * the table, as on a database without the owner SQL. Each call gets its own
   * transaction: after the expected 42P01 the transaction is aborted, so two
   * requests must never share one.
   */
  async function withoutTable<T>(run: (target: ReturnType<typeof createApp>) => Promise<T>) {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      // With only pg_catalog on the search path, PostgreSQL itself answers
      // 42P01 (relation does not exist).
      await client.query('SET LOCAL search_path = pg_catalog');
      return await run(
        createApp({
          aiSettingsService: new AiSettingsService(new PgAiSettingsRepository(client))
        })
      );
    } finally {
      await client.query('ROLLBACK');
      client.release();
    }
  }

  it('before the owner SQL: reading shows the defaults, saving answers 503', async () => {
    const { tokens } = await register('before-settings-sql@example.com');
    const shown = await withoutTable((target) => read(tokens.accessToken, target));
    expect(shown.status).toBe(200);
    expect(shown.body.data.available).toBe(false);
    expect(shown.body.data.settings.egressConsentVersion).toBeNull();
    const saved = await withoutTable((target) =>
      patch(tokens.accessToken, { memoryEnabled: true }, target)
    );
    expect(saved.status).toBe(503);
    expect(saved.body.error?.code ?? saved.body.code).toBe('AI_SETTINGS_UNAVAILABLE');
  });
});
