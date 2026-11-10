import '../infrastructure-safety.js';
/**
 * tests/integration/product-events-flow.test.ts
 *
 * Feature guide G5 (content-free product events) and G1 (account-scoped
 * onboarding flag) against migrated PostgreSQL: recording, per-local-day
 * dedupe, validation, opt-out erasure, export and deletion coverage, rate
 * limit, kill switch and the Activation / D1 / D7 / D30 funnel on synthetic
 * data. No production data is used or reported here.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import request from 'supertest';
import { createApp } from '../../src/app.js';
import { getPgPool } from '../../src/infrastructure/database/postgres/pool.js';
import { getRedisClient } from '../../src/infrastructure/redis/redis-client.js';
import { getContainer } from '../../src/container.js';
import { SystemClock } from '../../src/core/time/clock.js';
import { getUserTodayDate } from '../../src/core/time/date-utils.js';
import { PgUsersRepository } from '../../src/features/users/users.repository.pg.js';
import { ProductEventsService } from '../../src/features/product-events/product-events.service.js';
import { PgProductEventsRepository } from '../../src/features/product-events/product-events.repository.pg.js';
import { PRODUCT_EVENTS_USER_LIMIT } from '../../src/features/product-events/product-events.routes.js';
import { computeProductFunnel } from '../../src/features/product-events/product-events.metrics.js';

const PASSWORD = 'ValidUserPassword123!';

describe('Product events (G5) and onboarding flag (G1) on PostgreSQL', () => {
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

  async function register(email: string, timezone = 'UTC') {
    const res = await request(app).post('/api/v1/auth/register').send({
      email,
      password: PASSWORD,
      displayName: 'Events User',
      timezone,
      defaultCurrency: 'USD'
    });
    expect(res.status).toBe(201);
    return res.body.data as {
      user: { id: string; onboardingCompletedAt?: string | null; productEventsEnabled?: boolean };
      tokens: { accessToken: string };
    };
  }

  const post = (token: string, body: object, target = app) =>
    request(target)
      .post('/api/v1/product-events')
      .set('Authorization', `Bearer ${token}`)
      .send(body);

  const patchMe = (token: string, body: object) =>
    request(app).patch('/api/v1/users/me').set('Authorization', `Bearer ${token}`).send(body);

  const storedEvents = async (userId: string) =>
    (
      await pool.query(
        `SELECT event_name, occurred_on, platform, app_version
         FROM product_events WHERE user_id = $1 ORDER BY event_name`,
        [userId]
      )
    ).rows;

  it('new accounts start with onboarding pending and events enabled; completion is idempotent', async () => {
    const { user, tokens } = await register('onboarding@example.com');
    expect(user.onboardingCompletedAt).toBeNull();
    expect(user.productEventsEnabled).toBe(true);

    const first = await patchMe(tokens.accessToken, { onboardingCompleted: true });
    expect(first.status).toBe(200);
    const completedAt = first.body.data.user.onboardingCompletedAt as string;
    expect(new Date(completedAt).toISOString()).toBe(completedAt);

    const again = await patchMe(tokens.accessToken, { onboardingCompleted: true });
    expect(again.body.data.user.onboardingCompletedAt).toBe(completedAt);
    expect((await patchMe(tokens.accessToken, { onboardingCompleted: false })).status).toBe(400);

    const me = await request(app)
      .get('/api/v1/users/me')
      .set('Authorization', `Bearer ${tokens.accessToken}`);
    expect(me.body.data.user.onboardingCompletedAt).toBe(completedAt);
  });

  it('records only name, server time, local day, platform and version, once per local day', async () => {
    const timezone = 'Pacific/Kiritimati'; // UTC+14: the local day differs from UTC for 14 hours a day
    const { user, tokens } = await register('events@example.com', timezone);
    const dayBefore = getUserTodayDate(timezone);

    const first = await post(tokens.accessToken, {
      event: 'app_opened',
      platform: 'android',
      appVersion: '1.2.3'
    });
    expect(first.status).toBe(202);
    expect(first.body.data).toEqual({ recorded: true });
    const duplicate = await post(tokens.accessToken, { event: 'app_opened', platform: 'ios' });
    expect(duplicate.status).toBe(202);
    expect(duplicate.body.data).toEqual({ recorded: false });
    expect(
      (await post(tokens.accessToken, { event: 'task_completed', platform: 'android' })).body.data
    ).toEqual({
      recorded: true
    });
    const dayAfter = getUserTodayDate(timezone);

    const rows = await storedEvents(user.id);
    expect(rows.map((r) => [r.event_name, r.platform, r.app_version])).toEqual([
      ['app_opened', 'android', '1.2.3'],
      ['task_completed', 'android', null]
    ]);
    for (const row of rows) expect([dayBefore, dayAfter]).toContain(row.occurred_on);

    const columns = (
      await pool.query(
        `SELECT column_name FROM information_schema.columns
         WHERE table_schema = 'public' AND table_name = 'product_events' ORDER BY ordinal_position`
      )
    ).rows.map((r) => r.column_name);
    // Adding any column (for example a title or device id) must be a reviewed decision.
    expect(columns).toEqual([
      'id',
      'user_id',
      'event_name',
      'occurred_at',
      'occurred_on',
      'platform',
      'app_version',
      'created_at'
    ]);
  });

  it('rejects content, unknown names and unauthenticated calls without storing anything', async () => {
    const { user, tokens } = await register('reject@example.com');
    expect(
      (
        await post(tokens.accessToken, {
          event: 'task_completed',
          platform: 'android',
          title: 'Buy milk'
        })
      ).status
    ).toBe(400);
    expect(
      (await post(tokens.accessToken, { event: 'screen_viewed', platform: 'android' })).status
    ).toBe(400);
    expect(
      (
        await post(tokens.accessToken, {
          event: 'app_opened',
          platform: 'android',
          occurredAt: '2020-01-01T00:00:00Z'
        })
      ).status
    ).toBe(400);
    expect(
      (
        await request(app)
          .post('/api/v1/product-events')
          .send({ event: 'app_opened', platform: 'android' })
      ).status
    ).toBe(401);
    expect(await storedEvents(user.id)).toEqual([]);
  });

  it('opting out erases recorded events and stops recording; opting back in resumes', async () => {
    const { user, tokens } = await register('optout@example.com');
    await post(tokens.accessToken, { event: 'app_opened', platform: 'android' });
    expect(await storedEvents(user.id)).toHaveLength(1);

    const off = await patchMe(tokens.accessToken, { productEventsEnabled: false });
    expect(off.status).toBe(200);
    expect(off.body.data.user.productEventsEnabled).toBe(false);
    expect(await storedEvents(user.id)).toEqual([]);
    expect(
      (await post(tokens.accessToken, { event: 'task_completed', platform: 'android' })).body.data
    ).toEqual({
      recorded: false
    });
    expect(await storedEvents(user.id)).toEqual([]);

    await patchMe(tokens.accessToken, { productEventsEnabled: true });
    expect(
      (await post(tokens.accessToken, { event: 'task_completed', platform: 'android' })).body.data
    ).toEqual({
      recorded: true
    });
  });

  it('includes events and settings in the account export and erases them with the account', async () => {
    const { user, tokens } = await register('export@example.com');
    await post(tokens.accessToken, {
      event: 'habit_checked_in',
      platform: 'ios',
      appVersion: '2.0.0'
    });

    const exported = await request(app)
      .post('/api/v1/users/me/export')
      .set('Authorization', `Bearer ${tokens.accessToken}`)
      .send({ currentPassword: PASSWORD });
    expect(exported.status).toBe(200);
    expect(exported.body.profile).toMatchObject({
      productEventsEnabled: true,
      onboardingCompletedAt: null
    });
    expect(exported.body.productEvents).toHaveLength(1);
    expect(Object.keys(exported.body.productEvents[0]).sort()).toEqual(
      ['appVersion', 'event', 'occurredAt', 'occurredOn', 'platform'].sort()
    );
    expect(exported.body.productEvents[0]).toMatchObject({
      event: 'habit_checked_in',
      platform: 'ios',
      appVersion: '2.0.0'
    });

    const users = new PgUsersRepository(pool);
    await users.scheduleDeletion(user.id, new Date(Date.now() - 1000));
    expect(await users.purgeAccount(user.id)).toBe(true);
    expect(
      (
        await pool.query('SELECT count(*)::int AS n FROM product_events WHERE user_id = $1', [
          user.id
        ])
      ).rows[0].n
    ).toBe(0);
  });

  it('limits each account to the documented request rate', async () => {
    const { tokens } = await register('ratelimit@example.com');
    for (let i = 0; i < PRODUCT_EVENTS_USER_LIMIT; i += 1) {
      expect(
        (await post(tokens.accessToken, { event: 'app_opened', platform: 'android' })).status
      ).toBe(202);
    }
    const limited = await post(tokens.accessToken, { event: 'app_opened', platform: 'android' });
    expect(limited.status).toBe(429);
  });

  it('kill switch off: the endpoint still answers 202 but stores nothing', async () => {
    const { user, tokens } = await register('killswitch@example.com');
    const switchedOff = createApp({
      productEventsService: new ProductEventsService(
        new PgProductEventsRepository(pool),
        new SystemClock(),
        false
      )
    });
    const res = await post(
      tokens.accessToken,
      { event: 'app_opened', platform: 'android' },
      switchedOff
    );
    expect(res.status).toBe(202);
    expect(res.body.data).toEqual({ recorded: false });
    expect(await storedEvents(user.id)).toEqual([]);
  });

  it('computes Activation, time to first win and D1/D7/D30 on synthetic data', async () => {
    const insertUser = async (email: string, createdAt: string, timezone: string, enabled = true) =>
      (
        await pool.query<{ id: string }>(
          `INSERT INTO users (email, password_hash, display_name, default_currency, timezone, created_at, product_events_enabled)
           VALUES ($1, 'synthetic', 'Synthetic', 'USD', $2, $3, $4) RETURNING id`,
          [email, timezone, createdAt, enabled]
        )
      ).rows[0]!.id;
    const event = (userId: string, name: string, at: string, localDay: string) =>
      pool.query(
        `INSERT INTO product_events (user_id, event_name, occurred_at, occurred_on, platform)
         VALUES ($1, $2, $3, $4, 'android')`,
        [userId, name, at, localDay]
      );

    // Cohort: accounts created in January 2001 (far from any other test data).
    const a = await insertUser('a@synthetic.test', '2001-01-10T10:00:00Z', 'UTC');
    await event(a, 'onboarding_started', '2001-01-10T10:01:00Z', '2001-01-10');
    await event(a, 'onboarding_completed', '2001-01-10T10:02:00Z', '2001-01-10');
    await event(a, 'task_completed', '2001-01-10T10:10:00Z', '2001-01-10'); // activated, 600 s
    await event(a, 'habit_checked_in', '2001-01-11T09:00:00Z', '2001-01-11'); // D1
    await event(a, 'task_completed', '2001-01-17T09:00:00Z', '2001-01-17'); // D7

    // 21:00 in Tokyo: local day 0 is 2001-01-10, local day 1 starts at 15:00 UTC.
    const b = await insertUser('b@synthetic.test', '2001-01-10T12:00:00Z', 'Asia/Tokyo');
    await event(b, 'onboarding_started', '2001-01-10T12:01:00Z', '2001-01-10');
    await event(b, 'onboarding_skipped', '2001-01-10T12:02:00Z', '2001-01-10');
    await event(b, 'task_completed', '2001-01-10T13:00:00Z', '2001-01-10'); // 60 min: not activated
    await event(b, 'habit_checked_in', '2001-01-11T01:00:00Z', '2001-01-11'); // 10:00 JST: D1

    const optedOut = await insertUser('c@synthetic.test', '2001-01-10T08:00:00Z', 'UTC', false);
    await event(optedOut, 'task_completed', '2001-01-10T08:05:00Z', '2001-01-10');
    await insertUser('d@synthetic.test', '2001-01-12T08:00:00Z', 'UTC'); // never acted
    const outside = await insertUser('e@synthetic.test', '2001-02-05T08:00:00Z', 'UTC');
    await event(outside, 'task_completed', '2001-02-05T08:05:00Z', '2001-02-05');

    const funnel = await computeProductFunnel(pool, {
      cohortFrom: new Date('2001-01-01T00:00:00Z'),
      cohortTo: new Date('2001-02-01T00:00:00Z'),
      asOf: new Date('2001-01-20T12:00:00Z')
    });
    expect(funnel).toEqual({
      cohortUsers: 3,
      activatedUsers: 1,
      activationRate: 1 / 3,
      medianSecondsToFirstWin: 2100,
      d1: { eligible: 3, retained: 2, rate: 2 / 3 },
      d7: { eligible: 3, retained: 1, rate: 1 / 3 },
      d30: { eligible: 0, retained: 0, rate: null },
      onboarding: { started: 2, completed: 1, skipped: 1 }
    });

    // Day N only counts once it has fully ended in the user's time zone.
    const early = await computeProductFunnel(pool, {
      cohortFrom: new Date('2001-01-01T00:00:00Z'),
      cohortTo: new Date('2001-02-01T00:00:00Z'),
      asOf: new Date('2001-01-11T20:00:00Z') // Tokyo is already on 01-12; UTC is still on 01-11
    });
    expect(early.d1).toEqual({ eligible: 1, retained: 1, rate: 1 });
  });
});
