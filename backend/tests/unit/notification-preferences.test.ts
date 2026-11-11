/**
 * tests/unit/notification-preferences.test.ts
 *
 * Feature guide G2 (ADR-046): the settings endpoint's validation, service and
 * repository, graceful degradation before the owner-run SQL, the owner SQL /
 * migration identity, schema snapshots, account deletion and the archive
 * exclusion.
 */

import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import type pg from 'pg';
import { notificationPreferencesSchema } from '../../src/features/notifications/notification-preferences.validation.js';
import {
  NotificationPreferencesService,
  preferencesFromBody,
  toPreferencesView
} from '../../src/features/notifications/notification-preferences.service.js';
import {
  PgNotificationPreferencesRepository,
  resetNotificationPreferencesWarningForTests,
  type NotificationPreferencesStore
} from '../../src/features/notifications/notification-preferences.repository.pg.js';
import { DEFAULT_NOTIFICATION_PREFERENCES } from '../../src/features/notifications/notification-policy.js';
import {
  OPTIONAL_USER_OWNED_TABLES,
  USER_OWNED_TABLES_IN_DELETE_ORDER
} from '../../src/features/users/users.repository.pg.js';
import { ACCOUNT_ARCHIVE_OWNED_EXCLUSIONS } from '../../src/features/users/account-archive.sources.js';
import { NOTIFICATION_PREFERENCES_USER_LIMIT } from '../../src/features/notifications/notification-preferences.routes.js';

const repoFile = (relative: string) =>
  readFileSync(new URL(`../../../${relative}`, import.meta.url), 'utf8');
const migrationSource = repoFile(
  'backend/src/infrastructure/database/postgres/migrations/1792760000000_notification_preferences.cjs'
);

const validBody = {
  notificationsEnabled: true,
  quietHours: { start: '22:00', end: '07:00' },
  dailyLimit: 5,
  digestEnabled: false,
  criticalBreaksQuiet: false
};

describe('PUT /notification-preferences body validation', () => {
  it('accepts the complete settings object, with quiet hours and the limit optional as null', () => {
    expect(notificationPreferencesSchema.parse(validBody)).toEqual(validBody);
    expect(
      notificationPreferencesSchema.parse({ ...validBody, quietHours: null, dailyLimit: null })
    ).toMatchObject({ quietHours: null, dailyLimit: null });
  });

  it('rejects unknown keys, partial bodies and malformed values', () => {
    const bad: unknown[] = [
      { ...validBody, title: 'Doctor' },
      { ...validBody, quietHours: { start: '22:00', end: '07:00', zone: 'UTC' } },
      { notificationsEnabled: true },
      { ...validBody, quietHours: { start: '24:00', end: '07:00' } },
      { ...validBody, quietHours: { start: '7:00', end: '22:00' } },
      { ...validBody, quietHours: { start: '22:00', end: '22:00' } },
      { ...validBody, dailyLimit: 0 },
      { ...validBody, dailyLimit: 51 },
      { ...validBody, dailyLimit: 2.5 },
      { ...validBody, notificationsEnabled: 'yes' }
    ];
    for (const body of bad) {
      expect(notificationPreferencesSchema.safeParse(body).success, JSON.stringify(body)).toBe(
        false
      );
    }
  });

  it('has a per-user rate limit', () => {
    expect(NOTIFICATION_PREFERENCES_USER_LIMIT).toBe(30);
  });
});

describe('notification preferences service', () => {
  function store(overrides: Partial<NotificationPreferencesStore> = {}) {
    return {
      find: vi.fn(async () => ({ available: true as const, preferences: null })),
      save: vi.fn(async () => ({ available: true as const, saved: true })),
      ...overrides
    };
  }

  it('returns the defaults with the account time zone when nothing was saved', async () => {
    const service = new NotificationPreferencesService(store());
    expect(await service.get('user-1', 'Africa/Cairo')).toEqual({
      notificationsEnabled: true,
      quietHours: null,
      dailyLimit: null,
      digestEnabled: false,
      criticalBreaksQuiet: false,
      timeZone: 'Africa/Cairo',
      available: true
    });
  });

  it('returns the defaults with available=false before the owner SQL is applied', async () => {
    const service = new NotificationPreferencesService(
      store({ find: vi.fn(async () => ({ available: false as const })) })
    );
    expect(await service.get('user-1', 'UTC')).toMatchObject({
      quietHours: null,
      available: false
    });
  });

  it('saves the full settings and returns them as stored', async () => {
    const save = vi.fn(async () => ({ available: true as const, saved: true }));
    const service = new NotificationPreferencesService(store({ save }));
    const view = await service.replace('user-1', 'Africa/Cairo', validBody);
    expect(save).toHaveBeenCalledWith('user-1', {
      notificationsEnabled: true,
      quietStartMinute: 1320,
      quietEndMinute: 420,
      dailyCap: 5,
      digestEnabled: false,
      criticalBreaksQuiet: false
    });
    expect(view).toEqual({ ...validBody, timeZone: 'Africa/Cairo', available: true });
  });

  it('answers 503 NOTIFICATION_PREFERENCES_UNAVAILABLE before the owner SQL is applied', async () => {
    const service = new NotificationPreferencesService(
      store({ save: vi.fn(async () => ({ available: false as const })) })
    );
    await expect(service.replace('user-1', 'UTC', validBody)).rejects.toMatchObject({
      httpStatus: 503,
      code: 'NOTIFICATION_PREFERENCES_UNAVAILABLE'
    });
  });

  it('answers 404 when no active account matched', async () => {
    const service = new NotificationPreferencesService(
      store({ save: vi.fn(async () => ({ available: true as const, saved: false })) })
    );
    await expect(service.replace('user-1', 'UTC', validBody)).rejects.toMatchObject({
      httpStatus: 404
    });
  });

  it('round-trips between the API shape and the stored shape', () => {
    const stored = preferencesFromBody(validBody);
    expect(toPreferencesView(stored, 'UTC', true)).toEqual({
      ...validBody,
      timeZone: 'UTC',
      available: true
    });
    expect(toPreferencesView(DEFAULT_NOTIFICATION_PREFERENCES, 'UTC', true).quietHours).toBeNull();
  });
});

describe('notification preferences repository (SQL harness)', () => {
  it('reads one row by account and maps it', async () => {
    const query = vi.fn(async () => ({
      rows: [
        {
          notifications_enabled: false,
          quiet_start_minute: 60,
          quiet_end_minute: 120,
          daily_cap: null,
          digest_enabled: true,
          critical_breaks_quiet: false
        }
      ]
    }));
    const repo = new PgNotificationPreferencesRepository({ query } as unknown as pg.Pool);
    expect(await repo.find('user-1')).toEqual({
      available: true,
      preferences: {
        notificationsEnabled: false,
        quietStartMinute: 60,
        quietEndMinute: 120,
        dailyCap: null,
        digestEnabled: true,
        criticalBreaksQuiet: false
      }
    });
    const [sql, params] = query.mock.calls[0] as unknown as [string, unknown[]];
    expect(sql).toMatch(/FROM notification_preferences WHERE user_id = \$1$/);
    expect(sql).not.toMatch(/SELECT\s+\*/);
    expect(params).toEqual(['user-1']);
  });

  it('upserts only for an active account in one statement', async () => {
    const query = vi.fn(async () => ({ rowCount: 1, rows: [{ user_id: 'user-1' }] }));
    const repo = new PgNotificationPreferencesRepository({ query } as unknown as pg.Pool);
    expect(await repo.save('user-1', preferencesFromBody(validBody))).toEqual({
      available: true,
      saved: true
    });
    const [sql, params] = query.mock.calls[0] as unknown as [string, unknown[]];
    expect(sql).toContain("WHERE u.id = $1 AND u.status = 'active'");
    expect(sql).toContain('ON CONFLICT (user_id) DO UPDATE SET');
    expect(params).toEqual(['user-1', true, 1320, 420, 5, false, false]);
  });

  it('reports available=false (not an error) while the table is missing', async () => {
    resetNotificationPreferencesWarningForTests();
    const missing = vi.fn(async () => {
      throw Object.assign(new Error('relation does not exist'), { code: '42P01' });
    });
    const repo = new PgNotificationPreferencesRepository({ query: missing } as unknown as pg.Pool);
    expect(await repo.find('user-1')).toEqual({ available: false });
    expect(await repo.save('user-1', DEFAULT_NOTIFICATION_PREFERENCES)).toEqual({
      available: false
    });
  });

  it('still fails on other database errors', async () => {
    const broken = new PgNotificationPreferencesRepository({
      query: vi.fn(async () => {
        throw Object.assign(new Error('connection reset'), { code: '08006' });
      })
    } as unknown as pg.Pool);
    await expect(broken.find('user-1')).rejects.toThrow('connection reset');
  });
});

describe('owner-run production SQL (G2)', () => {
  it('is byte-identical to the forward-only migration body and runs in one transaction', () => {
    const migrationBody = /pgm\.sql\(`\n([\s\S]*?)\n\s*`\);/.exec(migrationSource)![1]!;
    const ownerSql = repoFile('docs/notifications/sql/notification-preferences.sql');
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
    expect(migrationSource).toContain('daily_cap BETWEEN 1 AND 50');
    expect(migrationSource).toContain('quiet_start_minute BETWEEN 0 AND 1439');
    expect(migrationSource).toContain('quiet_start_minute <> quiet_end_minute');
    expect(notificationPreferencesSchema.safeParse({ ...validBody, dailyLimit: 50 }).success).toBe(
      true
    );
  });

  it('keeps both schema snapshots in step with the migration', () => {
    for (const snapshot of [
      'schema.sql',
      'backend/src/infrastructure/database/postgres/schema-sql.ts'
    ]) {
      const text = repoFile(snapshot).replace(/\\n/g, '\n').replace(/\\"/g, '"');
      expect(text, snapshot).toContain('CREATE TABLE notification_preferences (');
      expect(text, snapshot).toContain(
        'user_id UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,'
      );
      expect(text, snapshot).toContain(
        'GRANT SELECT, INSERT, UPDATE, DELETE ON notification_preferences TO lifestyle_app;'
      );
    }
  });

  it('is erased with the account, optional until applied, and excluded from the v1 archive', () => {
    expect(USER_OWNED_TABLES_IN_DELETE_ORDER).toContain('notification_preferences');
    expect(OPTIONAL_USER_OWNED_TABLES.has('notification_preferences')).toBe(true);
    expect(ACCOUNT_ARCHIVE_OWNED_EXCLUSIONS).toContain('notification_preferences');
  });

  it('grants the runtime role CRUD in both runtime-grant drafts', () => {
    for (const draft of [
      'docs/remediation/drafts/neon-runtime-role-and-marker.sql',
      'docs/remediation/drafts/1792900000000_runtime_grants_rehearsal.cjs'
    ]) {
      expect(repoFile(draft), draft).toContain(
        'GRANT SELECT, INSERT, UPDATE, DELETE ON public.notification_preferences TO lifestyle_app;'
      );
    }
  });
});
