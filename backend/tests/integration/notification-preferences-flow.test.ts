import '../infrastructure-safety.js';
/**
 * tests/integration/notification-preferences-flow.test.ts
 *
 * Feature guide G2 (ADR-046) against migrated PostgreSQL: the settings
 * endpoint (defaults, save, validation, ownership, rate limit, export,
 * erasure, behaviour before the owner-run SQL) and the worker's policy-gated
 * push path with the real reminder store. No production data is used.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import request from 'supertest';
import { createApp } from '../../src/app.js';
import { getPgPool } from '../../src/infrastructure/database/postgres/pool.js';
import { getKyselyDb } from '../../src/infrastructure/database/postgres/kysely.js';
import { getRedisClient } from '../../src/infrastructure/redis/redis-client.js';
import { getContainer } from '../../src/container.js';
import { PgUsersRepository } from '../../src/features/users/users.repository.pg.js';
import { NotificationPreferencesService } from '../../src/features/notifications/notification-preferences.service.js';
import { PgNotificationPreferencesRepository } from '../../src/features/notifications/notification-preferences.repository.pg.js';
import { NOTIFICATION_PREFERENCES_USER_LIMIT } from '../../src/features/notifications/notification-preferences.routes.js';
import { processReminderDispatch } from '../../src/jobs/job-processors.js';
import { PgReminderDispatchStore } from '../../src/jobs/job-stores.pg.js';
import type { EmailSender } from '../../src/infrastructure/external/email-sender.js';

const PASSWORD = 'ValidUserPassword123!';

const settings = {
  notificationsEnabled: true,
  quietHours: { start: '22:00', end: '07:00' },
  dailyLimit: 5,
  digestEnabled: false,
  criticalBreaksQuiet: true
};

describe('Notification preferences (G2) on PostgreSQL', () => {
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

  async function register(email: string, timezone = 'Africa/Cairo') {
    const res = await request(app).post('/api/v1/auth/register').send({
      email,
      password: PASSWORD,
      displayName: 'Settings User',
      timezone,
      defaultCurrency: 'USD'
    });
    expect(res.status).toBe(201);
    return res.body.data as { user: { id: string }; tokens: { accessToken: string } };
  }

  const get = (token: string, target = app) =>
    request(target).get('/api/v1/notification-preferences').set('Authorization', `Bearer ${token}`);
  const put = (token: string, body: object, target = app) =>
    request(target)
      .put('/api/v1/notification-preferences')
      .set('Authorization', `Bearer ${token}`)
      .send(body);

  it('shows the defaults in the account time zone until settings are saved', async () => {
    const { tokens } = await register('defaults@example.com');
    const res = await get(tokens.accessToken);
    expect(res.status).toBe(200);
    expect(res.body.data).toEqual({
      notificationsEnabled: true,
      quietHours: null,
      dailyLimit: null,
      digestEnabled: false,
      criticalBreaksQuiet: false,
      timeZone: 'Africa/Cairo',
      available: true
    });
  });

  it('saves the full settings, returns them and stores minutes only for this account', async () => {
    const owner = await register('owner@example.com');
    const other = await register('other@example.com');

    const saved = await put(owner.tokens.accessToken, settings);
    expect(saved.status).toBe(200);
    expect(saved.body.data).toEqual({ ...settings, timeZone: 'Africa/Cairo', available: true });
    expect((await get(owner.tokens.accessToken)).body.data).toMatchObject(settings);

    const rows = (
      await pool.query(
        'SELECT user_id, quiet_start_minute, quiet_end_minute, daily_cap FROM notification_preferences'
      )
    ).rows;
    expect(rows).toEqual([
      { user_id: owner.user.id, quiet_start_minute: 1320, quiet_end_minute: 420, daily_cap: 5 }
    ]);
    // Another account never sees or changes these settings.
    expect((await get(other.tokens.accessToken)).body.data.quietHours).toBeNull();

    const cleared = await put(owner.tokens.accessToken, {
      ...settings,
      quietHours: null,
      dailyLimit: null
    });
    expect(cleared.body.data).toMatchObject({ quietHours: null, dailyLimit: null });
  });

  it('rejects invalid bodies and unauthenticated calls without storing anything', async () => {
    const { tokens } = await register('invalid@example.com');
    for (const body of [
      { ...settings, title: 'Doctor' },
      { ...settings, quietHours: { start: '22:00', end: '22:00' } },
      { ...settings, dailyLimit: 51 },
      { notificationsEnabled: false }
    ]) {
      const res = await put(tokens.accessToken, body);
      expect(res.status, JSON.stringify(body)).toBe(400);
    }
    expect((await request(app).put('/api/v1/notification-preferences').send(settings)).status).toBe(
      401
    );
    expect(
      (await pool.query('SELECT count(*)::int AS n FROM notification_preferences')).rows[0].n
    ).toBe(0);
  });

  it('is in the account export and is erased with the account', async () => {
    const { user, tokens } = await register('export-settings@example.com');
    await put(tokens.accessToken, settings);
    const exported = await request(app)
      .post('/api/v1/users/me/export')
      .set('Authorization', `Bearer ${tokens.accessToken}`)
      .send({ currentPassword: PASSWORD });
    expect(exported.status).toBe(200);
    expect(exported.body.notificationPreferences).toMatchObject(settings);
    expect(Object.keys(exported.body.notificationPreferences).sort()).toEqual(
      [...Object.keys(settings), 'updatedAt'].sort()
    );

    const users = new PgUsersRepository(pool);
    await users.scheduleDeletion(user.id, new Date(Date.now() - 1000));
    expect(await users.purgeAccount(user.id)).toBe(true);
    expect(
      (
        await pool.query(
          'SELECT count(*)::int AS n FROM notification_preferences WHERE user_id = $1',
          [user.id]
        )
      ).rows[0].n
    ).toBe(0);
  });

  it('limits each account to the documented request rate', async () => {
    const { tokens } = await register('settings-rate@example.com');
    for (let i = 0; i < NOTIFICATION_PREFERENCES_USER_LIMIT; i += 1) {
      expect((await get(tokens.accessToken)).status).toBe(200);
    }
    expect((await get(tokens.accessToken)).status).toBe(429);
  });

  it('before the owner SQL: reading shows the defaults, saving answers 503', async () => {
    const { tokens } = await register('before-sql@example.com');
    for (const action of ['read', 'save'] as const) {
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        // The test role does not own the table, so hide it instead: with
        // only pg_catalog on the search path, PostgreSQL itself answers
        // 42P01 (relation does not exist), as on a database without the SQL.
        await client.query('SET LOCAL search_path = pg_catalog');
        const withoutTable = createApp({
          notificationPreferencesService: new NotificationPreferencesService(
            new PgNotificationPreferencesRepository(client)
          )
        });
        if (action === 'read') {
          const res = await get(tokens.accessToken, withoutTable);
          expect(res.status).toBe(200);
          expect(res.body.data).toMatchObject({ quietHours: null, available: false });
        } else {
          const res = await put(tokens.accessToken, settings, withoutTable);
          expect(res.status).toBe(503);
          expect(res.body.error?.code ?? res.body.code).toBe(
            'NOTIFICATION_PREFERENCES_UNAVAILABLE'
          );
        }
      } finally {
        await client.query('ROLLBACK');
        client.release();
      }
    }
  });
});

describe('Policy-gated push dispatch (G2) with the PostgreSQL reminder store', () => {
  const pool = getPgPool();
  const store = new PgReminderDispatchStore(getKyselyDb());
  const emails = { findEmails: async () => new Map<string, string>() };
  const emailSender: EmailSender = {
    sendPasswordResetEmail: async () => undefined,
    sendReminderEmail: async () => undefined
  };
  let userId: string;

  beforeEach(async () => {
    await pool.query('DELETE FROM users');
    userId = crypto.randomUUID();
    await pool.query(
      `INSERT INTO users (id, email, password_hash, display_name, timezone, default_currency, created_at, updated_at)
       VALUES ($1, $2, 'x', 'Push Policy', 'Africa/Cairo', 'USD', now(), now())`,
      [userId, `push-${userId.slice(0, 8)}@example.com`]
    );
  });

  async function pushReminder(remindAt: string, status = 'pending', sentAt: string | null = null) {
    const taskId = crypto.randomUUID();
    await pool.query(
      `INSERT INTO tasks (id, user_id, title, due_date, priority, created_at, updated_at)
       VALUES ($1, $2, 'T', DATE '2026-11-30', 0, now(), now())`,
      [taskId, userId]
    );
    const id = crypto.randomUUID();
    await pool.query(
      `INSERT INTO reminders (id, user_id, task_id, source, remind_at, channel, status,
         next_attempt_at, sent_at, attempt_count, created_at, updated_at)
       VALUES ($1, $2, $3, 'user', $4, 'push', $5, CASE WHEN $5 = 'pending' THEN $4::timestamptz END,
         $6, 0, now(), now())`,
      [id, userId, taskId, remindAt, status, sentAt]
    );
    return id;
  }

  async function savePreferences(values: Record<string, unknown>) {
    await pool.query(
      `INSERT INTO notification_preferences (user_id, notifications_enabled, quiet_start_minute,
         quiet_end_minute, daily_cap) VALUES ($1, $2, $3, $4, $5)`,
      [
        userId,
        values.notificationsEnabled ?? true,
        values.quietStart ?? null,
        values.quietEnd ?? null,
        values.dailyCap ?? null
      ]
    );
  }

  const row = async (id: string) =>
    (
      await pool.query(
        'SELECT status, next_attempt_at, attempt_count, last_error_code FROM reminders WHERE id = $1',
        [id]
      )
    ).rows[0];

  function run(now: string) {
    const push = { isAvailable: () => true, send: vi.fn(async () => undefined) };
    return {
      push,
      result: processReminderDispatch(
        { now: () => new Date(now) },
        store,
        emails,
        emailSender,
        push,
        store
      )
    };
  }

  it('loads saved settings and the account time zone, and defaults for others', async () => {
    await savePreferences({ dailyCap: 3 });
    const loaded = await store.loadPushSettings([userId, crypto.randomUUID()]);
    expect(loaded.get(userId)).toEqual({
      timeZone: 'Africa/Cairo',
      preferences: expect.objectContaining({ dailyCap: 3, notificationsEnabled: true })
    });
    expect(loaded.size).toBe(1);
  });

  it('defers a push due in quiet hours to their end and gives the attempt back', async () => {
    // 08:00Z is 10:00 in Cairo; quiet hours 09:00-12:00 end at 10:00Z.
    await savePreferences({ quietStart: 9 * 60, quietEnd: 12 * 60 });
    const id = await pushReminder('2026-11-30T08:00:00Z');
    const { push, result } = run('2026-11-30T08:00:01Z');
    expect(await result).toMatchObject({ deferred: 1, sent: 0 });
    expect(push.send).not.toHaveBeenCalled();
    expect(await row(id)).toMatchObject({
      status: 'pending',
      next_attempt_at: new Date('2026-11-30T10:00:00Z'),
      attempt_count: 0
    });
  });

  it('cancels the push when the account turned notifications off', async () => {
    await savePreferences({ notificationsEnabled: false });
    const id = await pushReminder('2026-11-30T08:00:00Z');
    const { push, result } = run('2026-11-30T08:00:01Z');
    expect(await result).toMatchObject({ suppressed: 1, sent: 0 });
    expect(push.send).not.toHaveBeenCalled();
    expect(await row(id)).toMatchObject({
      status: 'cancelled',
      last_error_code: 'SUPPRESSED_BY_PREFERENCES'
    });
  });

  it('at the daily limit, one summary push covers the rest of the local day', async () => {
    await savePreferences({ dailyCap: 1 });
    await pushReminder('2026-11-30T07:00:00Z', 'sent', '2026-11-30T07:00:05Z');
    const due = await pushReminder('2026-11-30T08:00:00Z');
    const later = await pushReminder('2026-11-30T12:00:00Z');
    const evening = await pushReminder('2026-11-30T19:00:00Z');
    const nextDay = await pushReminder('2026-11-30T23:00:00Z'); // 01:00 on 1 Dec in Cairo
    const { push, result } = run('2026-11-30T08:00:01Z');
    expect(await result).toMatchObject({ summarized: 1, sent: 1 });
    expect(push.send).toHaveBeenCalledTimes(1);
    expect(push.send).toHaveBeenCalledWith(userId, 'Reminders', 'You have 3 reminders waiting');
    for (const id of [due, later, evening]) expect((await row(id)).status).toBe('sent');
    expect((await row(nextDay)).status).toBe('pending');
  });
});
