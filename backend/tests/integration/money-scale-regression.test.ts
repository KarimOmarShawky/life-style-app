import '../infrastructure-safety.js';
import { beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { randomUUID } from 'node:crypto';
// Historical components only; the real application retires these routes.
import { createLegacyMoneyTestApp as createApp } from '../support/legacy-money-test-app.js';
import { getPgPool } from '../../src/infrastructure/database/postgres/pool.js';
import { getRedisClient } from '../../src/infrastructure/redis/redis-client.js';
import { getContainer } from '../../src/container.js';

const app = createApp();
const pool = getPgPool();
const redis = getRedisClient();

async function session() {
  const email = `${randomUUID()}@example.test`;
  const result = await request(app).post('/api/v1/auth/register').send({
    email,
    password: 'ValidUserPassword123!',
    displayName: 'Scale test',
    timezone: 'UTC',
    defaultCurrency: 'USD'
  });
  expect(result.status).toBe(201);
  const id = (await pool.query<{ id: string }>('SELECT id FROM users WHERE email = $1', [email]))
    .rows[0]!.id;
  return { auth: `Bearer ${result.body.data.tokens.accessToken}`, id };
}

describe('Money original scale and unknown historical values', () => {
  beforeEach(async () => {
    await pool.query('DELETE FROM users');
    await redis.flushdb();
    const limiter = getContainer().rateLimiter;
    if ('clear' in limiter && typeof limiter.clear === 'function') limiter.clear();
  });

  it('preserves the scale of new transaction and subscription amounts during currency changes', async () => {
    const { auth } = await session();
    for (const [path, extra] of [
      ['transactions', { kind: 'expense', occurredOn: '2020-01-01' }],
      [
        'subscriptions',
        {
          name: 'Test',
          billingUnit: 'month',
          anchorDate: '2020-01-01',
          nextBillingDate: '2020-01-01'
        }
      ]
    ] as const) {
      async function create(amount: string) {
        const response = await request(app)
          .post(`/api/v1/money/${path}`)
          .set('Authorization', auth)
          .set('Idempotency-Key', randomUUID())
          .send({ ...extra, amount, currency: 'USD' });
        expect(response.status, JSON.stringify(response.body)).toBe(201);
        return response.body.data[path === 'transactions' ? 'transaction' : 'subscription']
          .id as string;
      }
      const integerId = await create('10');
      const decimalId = await create('10.00');
      const valid = await request(app)
        .patch(`/api/v1/money/${path}/${integerId}`)
        .set('Authorization', auth)
        .send({ currency: 'JPY' });
      const invalid = await request(app)
        .patch(`/api/v1/money/${path}/${decimalId}`)
        .set('Authorization', auth)
        .send({ currency: 'JPY' });
      expect(valid.status, JSON.stringify(valid.body)).toBe(200);
      expect(invalid.status, JSON.stringify(invalid.body)).toBe(400);
      const rows = await pool.query(
        `SELECT id, amount::text, amount_scale, currency FROM ${path} WHERE id IN ($1, $2)`,
        [integerId, decimalId]
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
    }
  });

  it('requires an explicit amount on edits of historical records, then allows later edits', async () => {
    const { auth, id } = await session();
    const tx = (
      await pool.query<{ id: string }>(
        `INSERT INTO transactions (user_id,kind,amount,currency,occurred_on) VALUES ($1,'expense','10','USD','2020-01-01') RETURNING id`,
        [id]
      )
    ).rows[0]!.id;
    const sub = (
      await pool.query<{ id: string }>(
        `INSERT INTO subscriptions (user_id,name,amount,currency,billing_unit,anchor_date,next_billing_date) VALUES ($1,'Legacy','10','USD','month','2020-01-01','2020-01-01') RETURNING id`,
        [id]
      )
    ).rows[0]!.id;
    const budget = (
      await pool.query<{ id: string }>(
        `INSERT INTO budgets (user_id,amount_limit,currency) VALUES ($1,'10','USD') RETURNING id`,
        [id]
      )
    ).rows[0]!.id;
    const cases = [
      {
        path: `transactions/${tx}`,
        without: { description: 'New' },
        withAmount: { description: 'New', amount: '10.00' },
        later: { description: 'Again' }
      },
      {
        path: `subscriptions/${sub}`,
        without: { name: 'New' },
        withAmount: { name: 'New', amount: '10.00' },
        later: { name: 'Again' }
      },
      { path: `budgets/${budget}`, without: {}, withAmount: { amountLimit: '10.00' }, later: {} }
    ];
    for (const item of cases) {
      const [table, recordId] = item.path.split('/');
      const before = (
        await pool.query(`SELECT row_to_json(t)::text AS value FROM ${table} t WHERE id = $1`, [
          recordId
        ])
      ).rows[0].value;
      const denied = await request(app)
        .patch(`/api/v1/money/${item.path}`)
        .set('Authorization', auth)
        .send(item.without);
      expect(denied.status, JSON.stringify(denied.body)).toBe(400);
      expect(
        (
          await pool.query(`SELECT row_to_json(t)::text AS value FROM ${table} t WHERE id = $1`, [
            recordId
          ])
        ).rows[0].value
      ).toBe(before);
      const accepted = await request(app)
        .patch(`/api/v1/money/${item.path}`)
        .set('Authorization', auth)
        .send(item.withAmount);
      expect(accepted.status, JSON.stringify(accepted.body)).toBe(200);
      const later = await request(app)
        .patch(`/api/v1/money/${item.path}`)
        .set('Authorization', auth)
        .send(item.later);
      expect(later.status, JSON.stringify(later.body)).toBe(200);
    }
  });

  it('requires an explicit amount to pay a historical subscription and never guesses its scale', async () => {
    const { auth, id } = await session();
    const sub = (
      await pool.query<{ id: string }>(
        `INSERT INTO subscriptions (user_id,name,amount,currency,billing_unit,anchor_date,next_billing_date) VALUES ($1,'Legacy','10','USD','month','2020-01-01','2020-01-01') RETURNING id`,
        [id]
      )
    ).rows[0]!.id;
    const pay = (body: object) =>
      request(app)
        .post(`/api/v1/money/subscriptions/${sub}/pay`)
        .set('Authorization', auth)
        .set('Idempotency-Key', randomUUID())
        .send(body);
    const before = (
      await pool.query('SELECT row_to_json(t)::text AS value FROM subscriptions t WHERE id = $1', [
        sub
      ])
    ).rows[0].value;
    const denied = await pay({});
    expect(denied.status, JSON.stringify(denied.body)).toBe(400);
    expect(
      (
        await pool.query(
          'SELECT row_to_json(t)::text AS value FROM subscriptions t WHERE id = $1',
          [sub]
        )
      ).rows[0].value
    ).toBe(before);
    expect(
      (
        await pool.query('SELECT count(*)::int AS n FROM transactions WHERE subscription_id = $1', [
          sub
        ])
      ).rows[0].n
    ).toBe(0);
    const paid = await pay({ amount: '10.00' });
    expect(paid.status, JSON.stringify(paid.body)).toBe(201);
    expect(
      (await pool.query('SELECT amount_scale FROM subscriptions WHERE id = $1', [sub])).rows[0]
        .amount_scale
    ).toBeNull();
    const second = await pay({});
    expect(second.status, JSON.stringify(second.body)).toBe(400);
    const confirmed = await request(app)
      .patch(`/api/v1/money/subscriptions/${sub}`)
      .set('Authorization', auth)
      .send({ amount: '10.00' });
    expect(confirmed.status, JSON.stringify(confirmed.body)).toBe(200);
    const paidAgain = await pay({});
    expect(paidAgain.status, JSON.stringify(paidAgain.body)).toBe(201);
  });
  it('the database rejects scale metadata inconsistent with the exact numeric amount', async () => {
    const { id } = await session();
    await expect(
      pool.query(
        `INSERT INTO transactions (user_id,kind,amount,amount_scale,currency,occurred_on)
       VALUES ($1,'expense','10.55',1,'USD','2020-01-01')`,
        [id]
      )
    ).rejects.toMatchObject({ code: '23514' });
    await expect(
      pool.query(
        `INSERT INTO budgets (user_id,amount_limit,amount_scale,currency)
       VALUES ($1,'10',5,'USD')`,
        [id]
      )
    ).rejects.toMatchObject({ code: '23514' });
  });
});
