/**
 * tests/unit/product-events.test.ts
 *
 * Feature guide G5 (content-free product events) and G1 (account-scoped
 * onboarding flag): validation, service, repository SQL and graceful
 * degradation, owner-SQL/migration identity and the documented funnel SQL.
 */

import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import type pg from 'pg';
import { FakeClock } from '../../src/core/time/clock.js';
import { recordProductEventSchema } from '../../src/features/product-events/product-events.validation.js';
import {
  PRODUCT_EVENT_NAMES,
  PRODUCT_EVENT_PLATFORMS
} from '../../src/features/product-events/product-events.types.js';
import {
  PRODUCT_EVENT_RETENTION_DAYS,
  ProductEventsService
} from '../../src/features/product-events/product-events.service.js';
import type { ProductEventsRepository } from '../../src/features/product-events/product-events.repository.js';
import { PgProductEventsRepository } from '../../src/features/product-events/product-events.repository.pg.js';
import {
  FUNNEL_DOC_EXAMPLE_WINDOW,
  renderFunnelSqlWithLiterals
} from '../../src/features/product-events/product-events.metrics.js';
import { updateProfileSchema } from '../../src/features/users/users.validation.js';
import { toUserDto } from '../../src/features/auth/auth.dto.js';
import type { UserRow } from '../../src/features/auth/auth.types.js';
import { PgUsersRepository } from '../../src/features/users/users.repository.pg.js';

const repoFile = (relative: string) =>
  readFileSync(new URL(`../../../${relative}`, import.meta.url), 'utf8');
const migrationSource = repoFile(
  'backend/src/infrastructure/database/postgres/migrations/1792750000000_product_events_and_onboarding.cjs'
);

describe('POST /product-events body validation (content-free by construction)', () => {
  it('accepts only an event name, a platform and an optional app version', () => {
    expect(recordProductEventSchema.parse({ event: 'app_opened', platform: 'android' })).toEqual({
      event: 'app_opened',
      platform: 'android'
    });
    expect(
      recordProductEventSchema.parse({
        event: 'task_completed',
        platform: 'ios',
        appVersion: '1.4.0+12'
      })
    ).toEqual({ event: 'task_completed', platform: 'ios', appVersion: '1.4.0+12' });
  });

  it.each([
    ['a task title', { title: 'Buy milk' }],
    ['an entity id', { taskId: '11111111-1111-4111-8111-111111111111' }],
    ['a client timestamp', { occurredAt: '2026-01-01T00:00:00Z' }],
    ['free-form properties', { properties: { screen: 'today' } }],
    ['a device identifier', { deviceId: 'abc' }]
  ])('rejects %s (unknown keys are never silently dropped)', (_label, extra) => {
    const result = recordProductEventSchema.safeParse({
      event: 'app_opened',
      platform: 'android',
      ...extra
    });
    expect(result.success).toBe(false);
  });

  it('rejects names, platforms and versions outside the closed lists', () => {
    for (const body of [
      { event: 'screen_viewed', platform: 'android' },
      { event: 'app_opened', platform: 'web' },
      { event: 'app_opened', platform: 'android', appVersion: '' },
      { event: 'app_opened', platform: 'android', appVersion: 'x'.repeat(33) },
      { event: 'app_opened', platform: 'android', appVersion: '1.0 (my phone)' },
      { platform: 'android' }
    ]) {
      expect(recordProductEventSchema.safeParse(body).success).toBe(false);
    }
  });

  it('keeps the closed lists identical to the migration CHECK constraints', () => {
    const list = (column: string) =>
      [
        ...new RegExp(`${column} TEXT NOT NULL CHECK \\(${column} IN \\(([^)]*)\\)\\)`)
          .exec(migrationSource)![1]!
          .matchAll(/'([a-z_]+)'/g)
      ].map((m) => m[1]);
    expect(list('event_name')).toEqual([...PRODUCT_EVENT_NAMES]);
    expect(list('platform')).toEqual([...PRODUCT_EVENT_PLATFORMS]);
  });
});

function fakeRepo(recorded = true): ProductEventsRepository & {
  record: ReturnType<typeof vi.fn>;
  purgeOlderThan: ReturnType<typeof vi.fn>;
} {
  return { record: vi.fn(async () => recorded), purgeOlderThan: vi.fn(async () => 3) };
}

describe('ProductEventsService', () => {
  it('stamps server time and the user-local calendar day (never client time)', async () => {
    const repo = fakeRepo();
    const clock = new FakeClock(new Date('2026-03-01T23:30:00Z'));
    const service = new ProductEventsService(repo, clock, true);
    await expect(
      service.record('user-1', 'Asia/Tokyo', { event: 'habit_checked_in', platform: 'android' })
    ).resolves.toEqual({ recorded: true });
    expect(repo.record).toHaveBeenCalledWith({
      userId: 'user-1',
      event: 'habit_checked_in',
      platform: 'android',
      appVersion: null,
      occurredAt: new Date('2026-03-01T23:30:00Z'),
      occurredOn: '2026-03-02'
    });
    await service.record('user-1', 'America/Los_Angeles', {
      event: 'app_opened',
      platform: 'ios',
      appVersion: '2.0.0'
    });
    expect(repo.record.mock.calls[1]![0]).toMatchObject({
      occurredOn: '2026-03-01',
      appVersion: '2.0.0'
    });
    await service.record('user-1', 'Not/AZone', { event: 'app_opened', platform: 'ios' });
    expect(repo.record.mock.calls[2]![0]).toMatchObject({ occurredOn: '2026-03-01' });
  });

  it('kill switch off: answers recorded=false without touching the database', async () => {
    const repo = fakeRepo();
    const service = new ProductEventsService(repo, new FakeClock(new Date()), false);
    await expect(
      service.record('user-1', 'UTC', { event: 'app_opened', platform: 'android' })
    ).resolves.toEqual({
      recorded: false
    });
    expect(repo.record).not.toHaveBeenCalled();
  });

  it('retention deletes events older than the documented window, even when recording is off', async () => {
    const repo = fakeRepo();
    const now = new Date('2026-11-10T03:50:00Z');
    const service = new ProductEventsService(repo, new FakeClock(now), false);
    await expect(service.purgeExpired()).resolves.toBe(3);
    expect(PRODUCT_EVENT_RETENTION_DAYS).toBe(400);
    expect(repo.purgeOlderThan).toHaveBeenCalledWith(new Date(now.getTime() - 400 * 86_400_000));
  });
});

describe('PgProductEventsRepository', () => {
  const event = {
    userId: 'user-1',
    event: 'task_completed' as const,
    platform: 'android' as const,
    appVersion: '1.0.0',
    occurredAt: new Date('2026-03-01T10:00:00Z'),
    occurredOn: '2026-03-01'
  };

  it('inserts only for an active, opted-in account and dedupes per local day', async () => {
    const query = vi.fn(async () => ({ rowCount: 1, rows: [{ id: 'e1' }] }));
    const repo = new PgProductEventsRepository({ query } as unknown as pg.Pool);
    await expect(repo.record(event)).resolves.toBe(true);
    const [sql, params] = query.mock.calls[0] as unknown as [string, unknown[]];
    const flat = sql.replace(/\s+/g, ' ');
    expect(flat).toContain(
      "FROM users u WHERE u.id = $1 AND u.product_events_enabled AND u.status = 'active'"
    );
    expect(flat).toContain('ON CONFLICT (user_id, event_name, occurred_on) DO NOTHING');
    expect(params).toEqual([
      'user-1',
      'task_completed',
      event.occurredAt,
      '2026-03-01',
      'android',
      '1.0.0'
    ]);

    query.mockResolvedValueOnce({ rowCount: 0, rows: [] });
    await expect(repo.record(event)).resolves.toBe(false);
  });

  it('degrades to recorded=false before the owner applies the DDL, but rethrows real failures', async () => {
    const missing = Object.assign(new Error('relation "product_events" does not exist'), {
      code: '42P01'
    });
    const query = vi.fn(async () => {
      throw missing;
    });
    const repo = new PgProductEventsRepository({ query } as unknown as pg.Pool);
    await expect(repo.record(event)).resolves.toBe(false);
    await expect(repo.purgeOlderThan(new Date())).resolves.toBe(0);

    const broken = new PgProductEventsRepository({
      query: vi.fn(async () => {
        throw Object.assign(new Error('connection reset'), { code: '08006' });
      })
    } as unknown as pg.Pool);
    await expect(broken.record(event)).rejects.toThrow('connection reset');
  });
});

describe('owner-run production SQL', () => {
  it('is byte-identical to the forward-only migration body and runs in one transaction', () => {
    const migrationBody = /pgm\.sql\(`\n([\s\S]*?)\n\s*`\);/.exec(migrationSource)![1]!;
    const ownerSql = repoFile('docs/analytics/sql/product-events-and-onboarding.sql');
    const ownerBody = /-- BEGIN MIGRATION BODY\n([\s\S]*?)\n-- END MIGRATION BODY/.exec(
      ownerSql
    )![1]!;
    expect(ownerBody).toBe(migrationBody);
    expect(ownerSql).toMatch(/\nBEGIN;\n-- BEGIN MIGRATION BODY/);
    expect(ownerSql.trimEnd().endsWith('-- END MIGRATION BODY\nCOMMIT;')).toBe(true);
    expect(ownerSql).toContain('must NOT be run there');
    expect(migrationSource).toMatch(/exports\.down = \(\) => \{\n\s*throw new Error/);
  });

  it('keeps both schema snapshots in step with the migration', () => {
    for (const snapshot of [
      'schema.sql',
      'backend/src/infrastructure/database/postgres/schema-sql.ts'
    ]) {
      const text = repoFile(snapshot).replace(/\\n/g, '\n').replace(/\\"/g, '"');
      expect(text, snapshot).toContain('CREATE TABLE product_events (');
      expect(text, snapshot).toContain(
        'CONSTRAINT product_events_one_per_local_day UNIQUE (user_id, event_name, occurred_on)'
      );
      expect(text, snapshot).toContain('product_events_enabled BOOLEAN NOT NULL DEFAULT true,');
      expect(text, snapshot).toContain('onboarding_completed_at TIMESTAMPTZ,');
      expect(text, snapshot).toContain(
        'GRANT SELECT, INSERT, DELETE ON product_events TO lifestyle_app;'
      );
    }
  });

  it('documents the funnel SQL exactly as the code computes it', () => {
    const doc = repoFile('docs/analytics/sql/product-funnel.sql');
    const body = doc.slice(doc.indexOf('WITH params AS ('));
    const { cohortFrom, cohortTo, asOf } = FUNNEL_DOC_EXAMPLE_WINDOW;
    expect(body).toBe(renderFunnelSqlWithLiterals(cohortFrom, cohortTo, asOf));
    expect(body).not.toMatch(/\bemail\b|display_name|password|\btitle\b/);
  });
});

describe('profile settings for G5 opt-out and G1 onboarding', () => {
  it('accepts productEventsEnabled and onboardingCompleted=true only', () => {
    expect(updateProfileSchema.parse({ productEventsEnabled: false })).toEqual({
      productEventsEnabled: false
    });
    expect(updateProfileSchema.parse({ onboardingCompleted: true })).toEqual({
      onboardingCompleted: true
    });
    expect(updateProfileSchema.safeParse({ onboardingCompleted: false }).success).toBe(false);
    expect(updateProfileSchema.safeParse({ productEventsEnabled: 'no' }).success).toBe(false);
    expect(updateProfileSchema.safeParse({ onboardingCompletedAt: '2026-01-01' }).success).toBe(
      false
    );
  });

  const baseRow: UserRow = {
    id: 'user-1',
    email: 'u@example.test',
    password_hash: 'hash',
    display_name: 'U',
    timezone: 'UTC',
    locale: 'en',
    week_start: 1,
    default_currency: 'USD',
    status: 'active',
    email_verified_at: null,
    password_changed_at: new Date('2026-01-01T00:00:00Z'),
    last_login_at: null,
    deletion_scheduled_for: null,
    push_show_titles: false,
    created_at: new Date('2026-01-01T00:00:00Z'),
    updated_at: new Date('2026-01-01T00:00:00Z')
  };

  it('omits the capability fields when the database lacks the columns', () => {
    const dto = toUserDto(baseRow);
    expect(dto).not.toHaveProperty('productEventsEnabled');
    expect(dto).not.toHaveProperty('onboardingCompletedAt');
  });

  it('exposes the opt-out flag and onboarding state when the columns exist', () => {
    expect(
      toUserDto({ ...baseRow, product_events_enabled: true, onboarding_completed_at: null })
    ).toMatchObject({
      productEventsEnabled: true,
      onboardingCompletedAt: null
    });
    expect(
      toUserDto({
        ...baseRow,
        product_events_enabled: false,
        onboarding_completed_at: new Date('2026-02-03T04:05:06Z')
      })
    ).toMatchObject({
      productEventsEnabled: false,
      onboardingCompletedAt: '2026-02-03T04:05:06.000Z'
    });
  });

  function usersPool(failWith?: { code: string }) {
    const statements: Array<{ sql: string; params: unknown[] }> = [];
    const run = vi.fn(async (sql: string, params: unknown[] = []) => {
      statements.push({ sql: sql.replace(/\s+/g, ' ').trim(), params });
      if (failWith && sql.includes('UPDATE users'))
        throw Object.assign(new Error('schema'), failWith);
      return {
        rows: [{ ...baseRow, product_events_enabled: false, onboarding_completed_at: null }],
        rowCount: 1
      };
    });
    const client = { query: run, release: vi.fn() };
    return {
      pool: { query: run, connect: vi.fn(async () => client) } as unknown as pg.Pool,
      statements,
      client
    };
  }

  it('opting out deletes recorded events in the same transaction as the preference change', async () => {
    const { pool, statements, client } = usersPool();
    await new PgUsersRepository(pool).updateUserProfile('user-1', { productEventsEnabled: false });
    expect(statements.map((s) => s.sql.split(' ').slice(0, 3).join(' '))).toEqual([
      'BEGIN',
      'UPDATE users SET',
      'DELETE FROM product_events',
      'COMMIT'
    ]);
    expect(statements[1]!.sql).toContain('product_events_enabled = $2');
    expect(statements[2]).toEqual({
      sql: 'DELETE FROM product_events WHERE user_id = $1',
      params: ['user-1']
    });
    expect(client.release).toHaveBeenCalledOnce();
  });

  it('marks onboarding idempotently and keeps the first completion time', async () => {
    const { pool, statements } = usersPool();
    await new PgUsersRepository(pool).updateUserProfile('user-1', { onboardingCompleted: true });
    expect(statements).toHaveLength(1);
    expect(statements[0]!.sql).toContain(
      'onboarding_completed_at = COALESCE(onboarding_completed_at, now())'
    );
  });

  it('answers 503 (nothing changed) when the setting is not supported by the database yet', async () => {
    const { pool, statements } = usersPool({ code: '42703' });
    await expect(
      new PgUsersRepository(pool).updateUserProfile('user-1', { productEventsEnabled: false })
    ).rejects.toMatchObject({ httpStatus: 503 });
    expect(statements.map((s) => s.sql)).toContain('ROLLBACK');
    expect(statements.some((s) => s.sql.startsWith('DELETE'))).toBe(false);
  });
});
