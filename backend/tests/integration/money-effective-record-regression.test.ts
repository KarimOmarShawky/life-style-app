import '../infrastructure-safety.js';
import { randomUUID } from 'node:crypto';
import { afterAll, afterEach, beforeEach, describe, expect, it } from 'vitest';
import { getPgPool, closePgPool } from '../../src/infrastructure/database/postgres/pool.js';
import { getKyselyDb } from '../../src/infrastructure/database/postgres/kysely.js';
import { PgMoneyRepository } from '../../src/features/money/money.repository.pg.js';
import { MoneyService } from '../../src/features/money/money.service.js';
import { getUserTodayDate } from '../../src/core/time/date-utils.js';

const pool = getPgPool();
const repository = new PgMoneyRepository(getKyselyDb());
const service = new MoneyService(repository, { cancelPendingFor: async () => undefined } as never);
const today = getUserTodayDate('UTC');
let userId: string;

async function transaction(amount: string) {
  const result = await pool.query<{ id: string }>(
    `INSERT INTO transactions (user_id,kind,amount,currency,occurred_on)
     VALUES ($1,'expense',$2,'USD',$3) RETURNING id`,
    [userId, amount, today]
  );
  return result.rows[0]!.id;
}

async function subscription(amount: string, currency: string) {
  const result = await pool.query<{ id: string }>(
    `INSERT INTO subscriptions (user_id,name,amount,currency,billing_unit,anchor_date,next_billing_date)
     VALUES ($1,'Test',$2,$3,'month',$4,$4) RETURNING id`,
    [userId, amount, currency, today]
  );
  return result.rows[0]!.id;
}

async function row(table: 'transactions' | 'subscriptions' | 'budgets', id: string) {
  return (
    await pool.query(`SELECT row_to_json(t)::text AS snapshot FROM ${table} t WHERE id = $1`, [id])
  ).rows[0].snapshot as string;
}

describe('Money effective records on PostgreSQL', () => {
  beforeEach(async () => {
    const result = await pool.query<{ id: string }>(
      `INSERT INTO users (email,password_hash,display_name,default_currency) VALUES ($1,'hash','Money fixture','USD') RETURNING id`,
      [`${randomUUID()}@example.test`]
    );
    userId = result.rows[0]!.id;
  });
  afterEach(async () => {
    await pool.query('DELETE FROM users WHERE id = $1', [userId]);
  });
  afterAll(closePgPool);

  it('fails closed when a caller omits the validation date', async () => {
    const id = await transaction('10.5500');
    const before = await row('transactions', id);
    const audit = {
      actorType: 'user',
      actorUserId: userId,
      eventType: 'transaction.updated',
      outcome: 'success'
    } as const;
    await expect(
      repository.updateTransaction(
        userId,
        id,
        { currency: 'JPY' },
        audit,
        undefined,
        undefined as never
      )
    ).rejects.toThrow();
    expect(await row('transactions', id)).toBe(before);
  });

  it('rejects a locked-row currency change that would preserve fractional JPY', async () => {
    const id = await transaction('10.5500');
    const before = await row('transactions', id);
    await expect(
      repository.updateTransaction(
        userId,
        id,
        { currency: 'JPY' },
        {
          actorType: 'user',
          actorUserId: userId,
          eventType: 'transaction.updated',
          outcome: 'success',
          entityType: 'transaction'
        },
        undefined,
        today
      )
    ).rejects.toMatchObject({ httpStatus: 400 });
    expect(await row('transactions', id)).toBe(before);
  });

  it('rejects changing a stored USD 10.00 transaction to JPY without an amount', async () => {
    const id = await transaction('10.00');
    const before = await row('transactions', id);
    await expect(
      service.updateTransaction(userId, id, { currency: 'JPY' }, {}, 'UTC')
    ).rejects.toMatchObject({ httpStatus: 400 });
    expect(await row('transactions', id)).toBe(before);
  });

  it('preserves valid stored amounts when changing to a currency with equal or wider precision', async () => {
    for (const currency of ['EUR', 'KWD']) {
      const id = await transaction('10.5500');
      await service.updateTransaction(userId, id, { currency }, {}, 'UTC');
      const actual = (
        await pool.query('SELECT amount::text, currency FROM transactions WHERE id = $1', [id])
      ).rows[0];
      expect(actual).toEqual({ amount: '10.5500', currency });
    }
  });

  it('preserves the supplied transaction amount instead of rounding it under lock', async () => {
    const id = await transaction('10.5500');
    const updated = await service.updateTransaction(userId, id, { amount: '11' }, {}, 'UTC');
    expect(updated.amount).toBe('11.00');
    const value = await pool.query('SELECT amount::text FROM transactions WHERE id = $1', [id]);
    expect(value.rows[0].amount).toBe('11.0000');
  });

  it('does not pay an invalid stored JPY amount or insert a transaction', async () => {
    const id = await subscription('10.5000', 'JPY');
    const before = await row('subscriptions', id);
    await expect(
      service.paySubscription(userId, id, { idempotencyKey: randomUUID() }, {}, 'UTC')
    ).rejects.toMatchObject({ httpStatus: 400 });
    expect(await row('subscriptions', id)).toBe(before);
    expect(
      (
        await pool.query('SELECT count(*)::int AS n FROM transactions WHERE subscription_id = $1', [
          id
        ])
      ).rows[0].n
    ).toBe(0);
  });

  it('rejects KWD overrides beyond three decimals and inserts the exact valid amount', async () => {
    const id = await subscription('1.234', 'KWD');
    await expect(
      service.paySubscription(
        userId,
        id,
        { amount: '1.2345', idempotencyKey: randomUUID() },
        {},
        'UTC'
      )
    ).rejects.toMatchObject({ httpStatus: 400 });
    expect(
      (
        await pool.query('SELECT count(*)::int AS n FROM transactions WHERE subscription_id = $1', [
          id
        ])
      ).rows[0].n
    ).toBe(0);
    await service.paySubscription(
      userId,
      id,
      { amount: '1.234', idempotencyKey: randomUUID() },
      {},
      'UTC'
    );
    expect(
      (
        await pool.query(
          'SELECT amount::text AS amount FROM transactions WHERE subscription_id = $1',
          [id]
        )
      ).rows[0].amount
    ).toBe('1.2340');
  });

  it('rejects payment when the effective subscription category is archived', async () => {
    const id = await subscription('10', 'JPY');
    const category = await pool.query<{ id: string }>(
      `INSERT INTO categories (user_id,kind,name,archived_at) VALUES ($1,'expense','Archived pay',now()) RETURNING id`,
      [userId]
    );
    await pool.query('UPDATE subscriptions SET category_id = $1 WHERE id = $2', [
      category.rows[0]!.id,
      id
    ]);
    const before = await row('subscriptions', id);
    await expect(
      service.paySubscription(userId, id, { idempotencyKey: randomUUID() }, {}, 'UTC')
    ).rejects.toMatchObject({ httpStatus: 400 });
    expect(await row('subscriptions', id)).toBe(before);
    expect(
      (
        await pool.query('SELECT count(*)::int AS n FROM transactions WHERE subscription_id = $1', [
          id
        ])
      ).rows[0].n
    ).toBe(0);
  });

  it('rejects excess precision supplied to the payment repository, even trailing zeros', async () => {
    const id = await subscription('10', 'JPY');
    const audit = {
      actorType: 'user',
      actorUserId: userId,
      eventType: 'transaction.created',
      outcome: 'success'
    } as const;
    await expect(
      repository.paySubscription(
        userId,
        id,
        { amount: '10.00', idempotencyKey: randomUUID() },
        today,
        { transactionAudit: audit, subscriptionAudit: audit }
      )
    ).rejects.toMatchObject({ httpStatus: 400 });
    expect(
      (
        await pool.query('SELECT count(*)::int AS n FROM transactions WHERE subscription_id = $1', [
          id
        ])
      ).rows[0].n
    ).toBe(0);
  });

  it('revalidates a subscription update against its locked row', async () => {
    const id = await subscription('10', 'JPY');
    const before = await row('subscriptions', id);
    await expect(
      repository.updateSubscription(userId, id, { amount: '10.55' })
    ).rejects.toMatchObject({ httpStatus: 400 });
    expect(await row('subscriptions', id)).toBe(before);
  });

  it('revalidates payment against the locked subscription currency', async () => {
    const id = await subscription('10', 'JPY');
    const before = await row('subscriptions', id);
    const audit = {
      actorType: 'user',
      actorUserId: userId,
      eventType: 'transaction.created',
      outcome: 'success'
    } as const;
    await expect(
      repository.paySubscription(
        userId,
        id,
        { amount: '10.55', idempotencyKey: randomUUID() },
        today,
        { transactionAudit: audit, subscriptionAudit: audit }
      )
    ).rejects.toMatchObject({ httpStatus: 400 });
    expect(await row('subscriptions', id)).toBe(before);
    expect(
      (
        await pool.query('SELECT count(*)::int AS n FROM transactions WHERE subscription_id = $1', [
          id
        ])
      ).rows[0].n
    ).toBe(0);
  });

  it('revalidates budget updates against their locked currency', async () => {
    const result = await pool.query<{ id: string }>(
      `INSERT INTO budgets (user_id,amount_limit,currency) VALUES ($1,'100','JPY') RETURNING id`,
      [userId]
    );
    const id = result.rows[0]!.id;
    const before = await row('budgets', id);
    await expect(
      repository.updateBudget(userId, id, { amountLimit: '10.55' })
    ).rejects.toMatchObject({ httpStatus: 400 });
    expect(await row('budgets', id)).toBe(before);
  });

  it('rejects amount-only update incompatible with subscription currency', async () => {
    const id = await subscription('10', 'JPY');
    const before = await row('subscriptions', id);
    await expect(
      service.updateSubscription(userId, id, { amount: '10.55' }, 'UTC')
    ).rejects.toMatchObject({ httpStatus: 400 });
    expect(await row('subscriptions', id)).toBe(before);
  });

  it('rejects reassignment to an archived subscription category', async () => {
    const id = await subscription('10', 'JPY');
    const category = await pool.query<{ id: string }>(
      `INSERT INTO categories (user_id,kind,name,archived_at) VALUES ($1,'expense','Archived',now()) RETURNING id`,
      [userId]
    );
    const before = await row('subscriptions', id);
    await expect(
      service.updateSubscription(userId, id, { categoryId: category.rows[0]!.id }, 'UTC')
    ).rejects.toMatchObject({ httpStatus: 400 });
    expect(await row('subscriptions', id)).toBe(before);
  });

  it('rejects an amount-only budget update incompatible with its currency', async () => {
    const result = await pool.query<{ id: string }>(
      `INSERT INTO budgets (user_id,amount_limit,currency) VALUES ($1,'100','JPY') RETURNING id`,
      [userId]
    );
    const id = result.rows[0]!.id;
    const before = await row('budgets', id);
    await expect(
      service.updateBudget(userId, id, { amountLimit: '10.55' }, 'UTC')
    ).rejects.toMatchObject({ httpStatus: 400 });
    expect(await row('budgets', id)).toBe(before);
  });
});
