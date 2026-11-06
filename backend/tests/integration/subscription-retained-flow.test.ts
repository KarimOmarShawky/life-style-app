import '../infrastructure-safety.js';
import { beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { createApp } from '../../src/app.js';
import { getContainer } from '../../src/container.js';
import { getPgPool } from '../../src/infrastructure/database/postgres/pool.js';
import { getKyselyDb } from '../../src/infrastructure/database/postgres/kysely.js';
import { PgSubscriptionRepository } from '../../src/features/money/subscription.repository.pg.js';
import { getRedisClient } from '../../src/infrastructure/redis/redis-client.js';
import { addDaysToDateString, getUserTodayDate } from '../../src/core/time/date-utils.js';

describe('retained subscription behavior on the production app', () => {
  const app = createApp();
  const pool = getPgPool();
  const redis = getRedisClient();

  beforeEach(async () => {
    await pool.query('DELETE FROM users');
    await redis.flushdb();
    const limiter = getContainer().rateLimiter;
    if ('clear' in limiter && typeof limiter.clear === 'function') limiter.clear();
  });

  async function register(email: string) {
    const response = await request(app).post('/api/v1/auth/register').send({
      email,
      password: 'ValidUserPassword123!',
      displayName: 'Subscription user',
      timezone: 'UTC',
      defaultCurrency: 'USD'
    });
    expect(response.status).toBe(201);
    return response.body.data;
  }

  async function create(accessToken: string) {
    const response = await request(app)
      .post('/api/v1/money/subscriptions')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({
        name: 'Monthly',
        amount: '10.55',
        currency: 'USD',
        billingUnit: 'month',
        anchorDate: '2099-01-31',
        nextBillingDate: '2099-01-31',
        reminderDaysBefore: 2
      });
    expect(response.status).toBe(201);
    return response.body.data.subscription;
  }

  it('keeps precise amounts, rejects incompatible currency and serializes versioned edits', async () => {
    const account = await register('retained-precision@example.test');
    const auth = `Bearer ${account.tokens.accessToken}`;
    const subscription = await create(account.tokens.accessToken);
    expect(subscription.nextBillingDate).toBe('2099-01-31');
    expect(subscription.amount).toBe('10.55');

    const invalid = await request(app)
      .patch(`/api/v1/money/subscriptions/${subscription.id}`)
      .set('Authorization', auth)
      .send({ currency: 'JPY', version: subscription.version });
    expect(invalid.status).toBe(400);
    const before = await pool.query(
      'SELECT amount::text,currency,version FROM subscriptions WHERE id=$1',
      [subscription.id]
    );
    expect(before.rows[0]).toEqual({
      amount: '10.5500',
      currency: 'USD',
      version: subscription.version
    });

    const edits = await Promise.all(
      ['First', 'Second'].map((name) =>
        request(app)
          .patch(`/api/v1/money/subscriptions/${subscription.id}`)
          .set('Authorization', auth)
          .send({ name, version: subscription.version })
      )
    );
    expect(edits.map((response) => response.status).sort()).toEqual([200, 409]);
    const after = await pool.query(
      'SELECT name,amount::text,currency,version FROM subscriptions WHERE id=$1',
      [subscription.id]
    );
    expect(['First', 'Second']).toContain(after.rows[0].name);
    expect(after.rows[0]).toMatchObject({
      amount: '10.5500',
      currency: 'USD',
      version: subscription.version + 1
    });
  });

  it('preserves original integer and decimal scale across currency changes', async () => {
    const account = await register('retained-scale@example.test');
    const auth = `Bearer ${account.tokens.accessToken}`;
    async function createAmount(amount: string) {
      const response = await request(app)
        .post('/api/v1/money/subscriptions')
        .set('Authorization', auth)
        .send({
          name: 'Scale',
          amount,
          currency: 'USD',
          billingUnit: 'month',
          anchorDate: '2099-01-01'
        });
      expect(response.status).toBe(201);
      return response.body.data.subscription.id as string;
    }
    const integerId = await createAmount('10');
    const decimalId = await createAmount('10.00');
    expect(
      (
        await request(app)
          .patch(`/api/v1/money/subscriptions/${integerId}`)
          .set('Authorization', auth)
          .send({ currency: 'JPY' })
      ).status
    ).toBe(200);
    expect(
      (
        await request(app)
          .patch(`/api/v1/money/subscriptions/${decimalId}`)
          .set('Authorization', auth)
          .send({ currency: 'JPY' })
      ).status
    ).toBe(400);
    const rows = await pool.query(
      'SELECT id,amount::text,amount_scale,currency FROM subscriptions WHERE id = ANY($1::uuid[])',
      [[integerId, decimalId]]
    );
    expect(rows.rows.find((row) => row.id === integerId)).toMatchObject({
      amount: '10.0000',
      amount_scale: 0,
      currency: 'JPY'
    });
    expect(rows.rows.find((row) => row.id === decimalId)).toMatchObject({
      amount: '10.0000',
      amount_scale: 2,
      currency: 'USD'
    });
  });

  it('requires explicit scale for a historical subscription without losing the record', async () => {
    const account = await register('retained-legacy@example.test');
    const auth = `Bearer ${account.tokens.accessToken}`;
    const result = await pool.query<{ id: string }>(
      `INSERT INTO subscriptions(user_id,name,amount,currency,billing_unit,anchor_date,next_billing_date)
       VALUES($1,'Legacy',10,'USD','month','2099-01-01','2099-02-01') RETURNING id`,
      [account.user.id]
    );
    const id = result.rows[0]!.id;
    const denied = await request(app)
      .patch(`/api/v1/money/subscriptions/${id}`)
      .set('Authorization', auth)
      .send({ name: 'New' });
    expect(denied.status).toBe(400);
    expect(
      (await pool.query('SELECT name,amount_scale FROM subscriptions WHERE id=$1', [id])).rows[0]
    ).toEqual({ name: 'Legacy', amount_scale: null });
    const confirmed = await request(app)
      .patch(`/api/v1/money/subscriptions/${id}`)
      .set('Authorization', auth)
      .send({ name: 'New', amount: '10.00' });
    expect(confirmed.status).toBe(200);
    const later = await request(app)
      .patch(`/api/v1/money/subscriptions/${id}`)
      .set('Authorization', auth)
      .send({ name: 'Again' });
    expect(later.status).toBe(200);
  });

  it('revalidates the effective amount against the locked database row', async () => {
    const account = await register('retained-lock@example.test');
    const created = await pool.query<{ id: string }>(
      `INSERT INTO subscriptions(user_id,name,amount,amount_scale,currency,billing_unit,anchor_date,next_billing_date)
       VALUES($1,'JPY',10,0,'JPY','month','2099-01-01','2099-02-01') RETURNING id`,
      [account.user.id]
    );
    const id = created.rows[0]!.id;
    const repository = new PgSubscriptionRepository(getKyselyDb());
    await expect(
      repository.updateSubscription(account.user.id, id, { amount: '10.55' })
    ).rejects.toMatchObject({ httpStatus: 400 });
    expect(
      (
        await pool.query('SELECT amount::text,currency,version FROM subscriptions WHERE id=$1', [
          id
        ])
      ).rows[0]
    ).toEqual({ amount: '10.0000', currency: 'JPY', version: 1 });
  });

  it('projects past schedules across list, detail, search, day and dashboard without changing records', async () => {
    const account = await register('retained-renewal@example.test');
    const auth = `Bearer ${account.tokens.accessToken}`;
    const today = getUserTodayDate('UTC');
    const old = addDaysToDateString(today, -7);
    const inserted = await pool.query<{ id: string }>(
      `INSERT INTO subscriptions(user_id,name,amount,amount_scale,currency,billing_unit,anchor_date,next_billing_date)
       VALUES ($1,'Renewal fixture',10,0,'USD','week',$2,$2) RETURNING id`,
      [account.user.id, old]
    );
    const id = inserted.rows[0]!.id;
    const before = (
      await pool.query(
        'SELECT next_billing_date::text,version,updated_at FROM subscriptions WHERE id=$1',
        [id]
      )
    ).rows[0];
    const detail = await request(app)
      .get(`/api/v1/money/subscriptions/${id}`)
      .set('Authorization', auth);
    expect(detail.status).toBe(200);
    expect(detail.body.data.subscription).toMatchObject({
      nextBillingDate: today,
      daysUntilNextBilling: 0
    });
    const list = await request(app).get('/api/v1/money/subscriptions').set('Authorization', auth);
    expect(list.body.data.subscriptions[0].nextBillingDate).toBe(today);
    const search = await request(app)
      .get('/api/v1/search')
      .query({ q: 'Renewal fixture' })
      .set('Authorization', auth);
    expect(search.status).toBe(200);
    expect(search.body.data.subscriptions[0]).toMatchObject({ id, nextBillingDate: today });
    const day = await request(app).get(`/api/v1/day/${today}`).set('Authorization', auth);
    expect(day.status).toBe(200);
    expect(day.body.data.day.subscriptionsDue).toEqual([
      expect.objectContaining({ id, nextBillingDate: today })
    ]);
    const next = addDaysToDateString(today, 7);
    const following = await request(app).get(`/api/v1/day/${next}`).set('Authorization', auth);
    expect(following.body.data.day.subscriptionsDue).toEqual([
      expect.objectContaining({ id, nextBillingDate: next })
    ]);
    const dashboard = await request(app).get('/api/v1/dashboard').set('Authorization', auth);
    expect(dashboard.body.data.overview.subscriptionsDueNext7Days).toMatchObject({
      count: 1,
      totalMinorByCurrency: { USD: '1000' }
    });
    expect(
      (
        await pool.query(
          'SELECT next_billing_date::text,version,updated_at FROM subscriptions WHERE id=$1',
          [id]
        )
      ).rows[0]
    ).toEqual(before);
  });

  it('paginates every subscription without duplication even when projected dates differ from cursor keys', async () => {
    const account = await register('retained-pagination@example.test');
    const auth = `Bearer ${account.tokens.accessToken}`;
    const today = getUserTodayDate('UTC');
    await pool.query(
      `INSERT INTO subscriptions(user_id,name,amount,amount_scale,currency,billing_unit,anchor_date,next_billing_date)
       SELECT $1,'Page ' || n,10,0,'USD','week',($2::date - (n * 7)),($2::date - (n * 7))
       FROM generate_series(1,31) n`,
      [account.user.id, today]
    );
    const ids = new Set<string>();
    let cursor: string | undefined;
    do {
      const response = await request(app)
        .get('/api/v1/money/subscriptions')
        .query({ limit: 8, ...(cursor ? { cursor } : {}) })
        .set('Authorization', auth);
      expect(response.status).toBe(200);
      for (const sub of response.body.data.subscriptions) {
        expect(ids.has(sub.id)).toBe(false);
        ids.add(sub.id);
        expect(sub.nextBillingDate).toBe(today);
      }
      cursor = response.body.data.meta.hasMore ? response.body.data.meta.nextCursor : undefined;
    } while (cursor);
    expect(ids.size).toBe(31);
  });

  it('isolates subscriptions by account and cancels reminders on deletion', async () => {
    const first = await register('retained-owner@example.test');
    const second = await register('retained-other@example.test');
    const subscription = await create(first.tokens.accessToken);
    const other = `Bearer ${second.tokens.accessToken}`;
    for (const response of await Promise.all([
      request(app)
        .get(`/api/v1/money/subscriptions/${subscription.id}`)
        .set('Authorization', other),
      request(app)
        .patch(`/api/v1/money/subscriptions/${subscription.id}`)
        .set('Authorization', other)
        .send({ name: 'other' }),
      request(app)
        .delete(`/api/v1/money/subscriptions/${subscription.id}`)
        .set('Authorization', other)
    ]))
      expect(response.status).toBe(404);

    const inserted = await pool.query<{ id: string }>(
      `INSERT INTO reminders(user_id,subscription_id,source,remind_at,channel,next_attempt_at)
       VALUES($1,$2,'user','2099-01-29T09:00:00Z','in_app','2099-01-29T09:00:00Z') RETURNING id`,
      [first.user.id, subscription.id]
    );
    const deleted = await request(app)
      .delete(`/api/v1/money/subscriptions/${subscription.id}`)
      .set('Authorization', `Bearer ${first.tokens.accessToken}`);
    expect(deleted.status).toBe(204);
    const reminder = await pool.query('SELECT status FROM reminders WHERE id=$1', [
      inserted.rows[0]!.id
    ]);
    expect(reminder.rows[0]?.status).toBe('cancelled');
  });
});
