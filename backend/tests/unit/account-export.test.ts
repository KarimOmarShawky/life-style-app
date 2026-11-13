import { describe, it, expect, vi } from 'vitest';
import type pg from 'pg';
import { PgUsersRepository } from '../../src/features/users/users.repository.pg.js';

function fixture(
  missing = false,
  overflow = '',
  productEvents: { schema?: boolean; rows?: Array<Record<string, unknown>> } = {},
  notificationPreferences: Array<Record<string, unknown>> = [],
  aiReports: { schema?: boolean; rows?: Array<Record<string, unknown>> } = {},
  aiSettings: { schema?: boolean; rows?: Array<Record<string, unknown>> } = {},
  aiMemories: { schema?: boolean; rows?: Array<Record<string, unknown>> } = {}
) {
  const schemaApplied = productEvents.schema ?? true;
  const query = vi.fn(async (sql: string, _params: unknown[]) => {
    if (sql.includes('FROM ai_memory_items')) {
      if (!(aiMemories.schema ?? true))
        throw Object.assign(new Error('relation does not exist'), { code: '42P01' });
      return { rows: aiMemories.rows ?? [] };
    }
    if (sql.includes('FROM ai_user_settings')) {
      if (!(aiSettings.schema ?? true))
        throw Object.assign(new Error('relation does not exist'), { code: '42P01' });
      return { rows: aiSettings.rows ?? [] };
    }
    if (sql.includes('FROM ai_content_reports')) {
      if (!(aiReports.schema ?? true))
        throw Object.assign(new Error('relation does not exist'), { code: '42P01' });
      return { rows: aiReports.rows ?? [] };
    }
    if (sql.includes('FROM notification_preferences')) {
      if (!schemaApplied)
        throw Object.assign(new Error('relation does not exist'), { code: '42P01' });
      return { rows: notificationPreferences };
    }
    if (sql.includes('product_events_enabled, onboarding_completed_at FROM users')) {
      if (!schemaApplied)
        throw Object.assign(new Error('column does not exist'), { code: '42703' });
      return {
        rows: [
          {
            product_events_enabled: true,
            onboarding_completed_at: new Date('2026-01-02T00:00:00Z')
          }
        ]
      };
    }
    if (sql.includes('FROM product_events')) {
      if (!schemaApplied)
        throw Object.assign(new Error('relation does not exist'), { code: '42P01' });
      return { rows: productEvents.rows ?? [] };
    }
    return fixtureRows(sql, missing, overflow);
  });
  return { repo: new PgUsersRepository({ query } as unknown as pg.Pool), query };
}

function fixtureRows(sql: string, missing: boolean, overflow: string) {
  return {
    rows:
      sql.includes('FROM users') && !missing
        ? [
            {
              id: 'user-1',
              email: 'unit@example.test',
              display_name: 'Unit',
              timezone: 'UTC',
              locale: 'en',
              week_start: 1,
              default_currency: 'USD',
              status: 'active',
              created_at: new Date('2026-01-01T00:00:00Z')
            }
          ]
        : overflow && sql.includes(`FROM ${overflow} `)
          ? Array.from({ length: 1001 }, () => ({}))
          : []
  };
}

describe('Legacy account metadata export (SQL harness, not a live database)', () => {
  it('handles a user deleted between authentication and export without secondary queries', async () => {
    const { repo, query } = fixture(true);
    await expect(repo.getUserExportData('deleted-user')).rejects.toMatchObject({
      httpStatus: 404,
      code: 'NOT_FOUND'
    });
    expect(query).toHaveBeenCalledOnce();
  });

  it('selects only metadata columns and scopes every query to the authenticated identity', async () => {
    const { repo, query } = fixture();
    const result = await repo.getUserExportData('user-1');
    expect(result).toMatchObject({
      profile: { id: 'user-1', email: 'unit@example.test', createdAt: '2026-01-01T00:00:00.000Z' },
      sessions: [],
      categories: [],
      pushDevices: []
    });
    expect(Object.keys(result).sort()).toEqual(
      [
        'exportedAt',
        'profile',
        'sessions',
        'categories',
        'pushDevices',
        'productEvents',
        'notificationPreferences',
        'aiContentReports',
        'aiSettings',
        'aiMemories'
      ].sort()
    );
    expect(result.profile).toMatchObject({
      productEventsEnabled: true,
      onboardingCompletedAt: '2026-01-02T00:00:00.000Z'
    });
    expect(result.productEvents).toEqual([]);
    expect(result.notificationPreferences).toBeNull();
    expect(result.aiContentReports).toEqual([]);
    expect(result.aiSettings).toBeNull();
    expect(result.aiMemories).toEqual([]);
    expect(query).toHaveBeenCalledTimes(9);
    expect(query.mock.calls.map(([sql]) => sql).join(' \n')).not.toContain('FROM categories');
    for (const [sql, params] of query.mock.calls) {
      expect(params).toEqual(['user-1']);
      expect(sql).toMatch(/WHERE (?:user_id|id) = \$1/);
      expect(sql).not.toMatch(/SELECT\s+\*|password|token_hash|push_token/i);
    }
    expect(result.profile).not.toHaveProperty('password_hash');
  });
  it('exports content-free product events with only name, times, platform and version', async () => {
    const { repo, query } = fixture(false, '', {
      rows: [
        {
          event_name: 'task_completed',
          occurred_at: new Date('2026-03-01T10:00:00Z'),
          occurred_on: '2026-03-01',
          platform: 'android',
          app_version: '1.4.0'
        }
      ]
    });
    const result = await repo.getUserExportData('user-1');
    expect(result.productEvents).toEqual([
      {
        event: 'task_completed',
        occurredAt: '2026-03-01T10:00:00.000Z',
        occurredOn: '2026-03-01',
        platform: 'android',
        appVersion: '1.4.0'
      }
    ]);
    const eventsSql = query.mock.calls
      .map(([sql]) => sql)
      .find((sql) => sql.includes('FROM product_events'));
    expect(eventsSql).toContain('WHERE user_id = $1');
    expect(eventsSql).toContain('LIMIT 5001');
    expect(eventsSql).not.toMatch(/SELECT\s+\*|user_id,|\bid\b,/);
  });

  it('rejects more than 5000 product events with 413 instead of truncating', async () => {
    const { repo } = fixture(false, '', {
      rows: Array.from({ length: 5001 }, () => ({
        event_name: 'app_opened',
        occurred_at: new Date('2026-03-01T10:00:00Z'),
        occurred_on: '2026-03-01',
        platform: 'ios',
        app_version: null
      }))
    });
    await expect(repo.getUserExportData('user-1')).rejects.toMatchObject({
      httpStatus: 413,
      code: 'PAYLOAD_TOO_LARGE'
    });
  });

  it('still exports when the product-events schema has not been applied yet', async () => {
    const { repo } = fixture(false, '', { schema: false });
    const result = await repo.getUserExportData('user-1');
    expect(result.productEvents).toEqual([]);
    expect(result.profile).not.toHaveProperty('productEventsEnabled');
    expect(result.profile).not.toHaveProperty('onboardingCompletedAt');
    expect(result.notificationPreferences).toBeNull();
  });

  it('exports saved notification settings (G2) as the API shows them, without the account id', async () => {
    const { repo, query } = fixture(false, '', {}, [
      {
        notifications_enabled: true,
        quiet_start_minute: 22 * 60,
        quiet_end_minute: 7 * 60,
        daily_cap: 5,
        digest_enabled: false,
        critical_breaks_quiet: true,
        updated_at: new Date('2026-11-11T08:00:00Z')
      }
    ]);
    const result = await repo.getUserExportData('user-1');
    expect(result.notificationPreferences).toEqual({
      notificationsEnabled: true,
      quietHours: { start: '22:00', end: '07:00' },
      dailyLimit: 5,
      digestEnabled: false,
      criticalBreaksQuiet: true,
      updatedAt: '2026-11-11T08:00:00.000Z'
    });
    const sql = query.mock.calls
      .map(([text]) => text)
      .find((text) => text.includes('FROM notification_preferences'));
    expect(sql).toMatch(/WHERE user_id = \$1$/);
    expect(sql).not.toMatch(/SELECT\s+\*/);
  });

  it('exports AI content reports (AI-P) without the account id, oldest first', async () => {
    const { repo, query } = fixture(false, '', {}, [], {
      rows: [
        {
          surface: 'assistant',
          category: 'offensive',
          reply_text: 'the reply',
          note: null,
          locale: 'ar',
          created_at: new Date('2026-11-11T10:00:00Z')
        }
      ]
    });
    const result = await repo.getUserExportData('user-1');
    expect(result.aiContentReports).toEqual([
      {
        surface: 'assistant',
        category: 'offensive',
        replyText: 'the reply',
        note: null,
        locale: 'ar',
        createdAt: '2026-11-11T10:00:00.000Z'
      }
    ]);
    const sql = query.mock.calls
      .map(([text]) => text)
      .find((text) => text.includes('FROM ai_content_reports'))!;
    expect(sql).toContain('WHERE user_id = $1');
    expect(sql).toContain('ORDER BY created_at, id LIMIT 3001');
    expect(sql).not.toMatch(/SELECT\s+\*/);
  });

  it('exports AI settings and the AI consent (AI-2) without the account id', async () => {
    const { repo, query } = fixture(
      false,
      '',
      {},
      [],
      {},
      {
        rows: [
          {
            egress_consent_version: 1,
            egress_consent_at: new Date('2026-11-12T09:00:00Z'),
            memory_enabled: false,
            explicit_memory_enabled: false,
            learning_enabled: false,
            quick_actions_enabled: false,
            language_mode: 'app_locale',
            updated_at: new Date('2026-11-12T09:05:00Z')
          }
        ]
      }
    );
    const result = await repo.getUserExportData('user-1');
    expect(result.aiSettings).toEqual({
      egressConsentVersion: 1,
      egressConsentAt: '2026-11-12T09:00:00.000Z',
      memoryEnabled: false,
      explicitMemoryEnabled: false,
      learningEnabled: false,
      quickActionsEnabled: false,
      languageMode: 'app_locale',
      updatedAt: '2026-11-12T09:05:00.000Z'
    });
    const sql = query.mock.calls
      .map(([text]) => text)
      .find((text) => text.includes('FROM ai_user_settings'))!;
    expect(sql).toMatch(/WHERE user_id = \$1$/);
    expect(sql).not.toMatch(/SELECT\s+\*/);
    expect(sql).not.toContain('user_id,');
  });

  it('exports saved AI memories with every status and only their own fields', async () => {
    const { query, repo } = fixture(
      false,
      '',
      {},
      [],
      {},
      {},
      {
        rows: [
          {
            kind: 'preference',
            content: 'Keep answers short',
            source: 'explicit',
            status: 'active',
            created_at: new Date('2026-11-12T10:00:00Z'),
            updated_at: new Date('2026-11-12T10:05:00Z'),
            expires_at: null
          }
        ]
      }
    );
    const result = await repo.getUserExportData('user-1');
    expect(result.aiMemories).toEqual([
      {
        kind: 'preference',
        content: 'Keep answers short',
        source: 'explicit',
        status: 'active',
        createdAt: '2026-11-12T10:00:00.000Z',
        updatedAt: '2026-11-12T10:05:00.000Z',
        expiresAt: null
      }
    ]);
    const sql = query.mock.calls
      .map(([text]) => text)
      .find((text) => text.includes('FROM ai_memory_items'))!;
    expect(sql).toMatch(/WHERE user_id = \$1/);
    expect(sql).not.toMatch(/SELECT\s+\*|confidence|\bid,/);
  });

  it('still exports when the AI-memory schema has not been applied yet', async () => {
    const { repo } = fixture(false, '', {}, [], {}, {}, { schema: false });
    const result = await repo.getUserExportData('user-1');
    expect(result.aiMemories).toEqual([]);
  });

  it('rejects an oversized AI-memory export rather than truncating it', async () => {
    const { repo } = fixture(
      false,
      '',
      {},
      [],
      {},
      {},
      {
        rows: Array.from({ length: 1001 }, () => ({
          kind: 'fact',
          content: 'x',
          source: 'explicit',
          status: 'active',
          created_at: new Date('2026-11-12T10:00:00Z'),
          updated_at: new Date('2026-11-12T10:00:00Z'),
          expires_at: null
        }))
      }
    );
    await expect(repo.getUserExportData('user-1')).rejects.toMatchObject({ httpStatus: 413 });
  });

  it('still exports when the AI-settings schema has not been applied yet', async () => {
    const { repo } = fixture(false, '', {}, [], {}, { schema: false });
    const result = await repo.getUserExportData('user-1');
    expect(result.aiSettings).toBeNull();
  });

  it('still exports when the AI-reports schema has not been applied yet', async () => {
    const { repo } = fixture(false, '', {}, [], { schema: false });
    const result = await repo.getUserExportData('user-1');
    expect(result.aiContentReports).toEqual([]);
  });

  it('rejects an oversized AI-report export rather than truncating it', async () => {
    const { repo } = fixture(false, '', {}, [], {
      rows: Array.from({ length: 3001 }, () => ({
        surface: 'assistant',
        category: 'spam',
        reply_text: null,
        note: null,
        locale: 'en',
        created_at: new Date('2026-11-11T10:00:00Z')
      }))
    });
    await expect(repo.getUserExportData('user-1')).rejects.toMatchObject({
      httpStatus: 413,
      code: 'PAYLOAD_TOO_LARGE'
    });
  });

  for (const table of ['auth_sessions', 'push_devices']) {
    it(`rejects oversized ${table} metadata rather than returning silent partial success`, async () => {
      const { repo, query } = fixture(false, table);
      await expect(repo.getUserExportData('user-1')).rejects.toMatchObject({
        httpStatus: 413,
        code: 'PAYLOAD_TOO_LARGE'
      });
      for (const [sql] of query.mock.calls.slice(1)) expect(sql).toContain('LIMIT 1001');
    });
  }
});
