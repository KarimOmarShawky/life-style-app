import '../infrastructure-safety.js';
import { randomUUID } from 'node:crypto';
import { afterAll, afterEach, beforeEach, describe, expect, it } from 'vitest';
import { getPgPool, closePgPool } from '../../src/infrastructure/database/postgres/pool.js';
import { getKyselyDb } from '../../src/infrastructure/database/postgres/kysely.js';
import { PgMoneyRepository } from '../../src/features/money/money.repository.pg.js';
import { MoneyService } from '../../src/features/money/money.service.js';
import { addDaysToDateString, getUserTodayDate } from '../../src/core/time/date-utils.js';

const pool = getPgPool();
const repository = new PgMoneyRepository(getKyselyDb());
const service = new MoneyService(repository, { cancelPendingFor: async () => undefined } as never);
const today = getUserTodayDate('UTC');
let userId: string;

// Values ending in four padded digits model NUMERIC storage in these pre-existing
// tests; record the original meaningful scale instead of inventing legacy data.
function fixtureScale(amount: string): number {
  const fraction = amount.split('.')[1] ?? '';
  return fraction.length === 4 ? fraction.replace(/0+$/, '').length : fraction.length;
}

async function transaction(amount: string) {
  const result = await pool.query<{ id: string }>(
    `INSERT INTO transactions (user_id,kind,amount,currency,occurred_on,amount_scale)
     VALUES ($1,'expense',$2,'USD',$3,$4) RETURNING id`,
    [userId, amount, today, fixtureScale(amount)]
  );
  return result.rows[0]!.id;
}

async function subscription(amount: string, currency: string) {
  const result = await pool.query<{ id: string }>(
    `INSERT INTO subscriptions (user_id,name,amount,currency,billing_unit,anchor_date,next_billing_date,amount_scale)
     VALUES ($1,'Test',$2,$3,'month',$4,$4,$5) RETURNING id`,
    [userId, amount, currency, today, fixtureScale(amount)]
  );
  return result.rows[0]!.id;
}

async function row(table: 'transactions' | 'subscriptions' | 'budgets', id: string) {
  return (
    await pool.query(`SELECT row_to_json(t)::text AS snapshot FROM ${table} t WHERE id = $1`, [id])
  ).rows[0].snapshot as string;
}

async function waitForBlockedTransactions(blockerPid: number, expected: number): Promise<void> {
  const deadline = Date.now() + 5_000;
  while (Date.now() < deadline) {
    const result = await pool.query<{ count: number }>(
      `WITH RECURSIVE blocked(pid) AS (
         SELECT $1::int
         UNION
         SELECT a.pid FROM pg_stat_activity a JOIN blocked b ON b.pid = ANY(pg_blocking_pids(a.pid))
       ) SELECT (count(*) - 1)::int AS count FROM blocked`,
      [blockerPid]
    );
    if (result.rows[0]!.count >= expected) return;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error(`Expected ${expected} payment transactions to block on subscription lock`);
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
        { transactionAudit: audit, subscriptionAudit: audit },
        1
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
        { transactionAudit: audit, subscriptionAudit: audit },
        1
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
  it('payment repository rejects a future occurrence date without inserting', async () => {
    const id = await subscription('10', 'USD');
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
        { amount: '10', occurredOn: addDaysToDateString(today, 5), idempotencyKey: randomUUID() },
        today,
        { transactionAudit: audit, subscriptionAudit: audit },
        1
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

  it('payment repository fails closed without the validation date or observed version', async () => {
    const id = await subscription('10', 'USD');
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
        { amount: '10', idempotencyKey: randomUUID() },
        undefined as never,
        { transactionAudit: audit, subscriptionAudit: audit },
        1
      )
    ).rejects.toMatchObject({ httpStatus: 400 });
    await expect(
      repository.paySubscription(
        userId,
        id,
        { amount: '10', idempotencyKey: randomUUID() },
        today,
        { transactionAudit: audit, subscriptionAudit: audit },
        undefined as never
      )
    ).rejects.toMatchObject({ httpStatus: 409 });
    expect(await row('subscriptions', id)).toBe(before);
    expect(
      (
        await pool.query('SELECT count(*)::int AS n FROM transactions WHERE subscription_id = $1', [
          id
        ])
      ).rows[0].n
    ).toBe(0);
  });

  it('rejects a stale payment when the subscription changes while its row is locked', async () => {
    const id = await subscription('10.00', 'USD');
    await pool.query(
      `UPDATE subscriptions SET anchor_date = '2020-01-31', next_billing_date = '2020-01-31' WHERE id = $1`,
      [id]
    );
    const client = await pool.connect();
    let pending: Promise<unknown> | undefined;
    try {
      await client.query('BEGIN');
      const pid = (await client.query<{ pid: number }>('SELECT pg_backend_pid() AS pid')).rows[0]!
        .pid;
      await client.query(
        `UPDATE subscriptions SET amount = '13.25', anchor_date = '2020-02-15',
         next_billing_date = '2020-02-15', version = version + 1 WHERE id = $1`,
        [id]
      );
      const settled = Promise.allSettled([
        service.paySubscription(userId, id, { idempotencyKey: randomUUID() }, {}, 'UTC')
      ]);
      pending = settled;
      await waitForBlockedTransactions(pid, 1);
      await client.query('COMMIT');
      const [result] = await settled;
      expect(result).toMatchObject({ status: 'rejected', reason: { httpStatus: 409 } });
      const current = await pool.query(
        `SELECT amount::text, next_billing_date, version FROM subscriptions WHERE id = $1`,
        [id]
      );
      expect(current.rows[0]).toEqual({
        amount: '13.2500',
        next_billing_date: '2020-02-15',
        version: 2
      });
      expect(
        (
          await pool.query(
            'SELECT count(*)::int AS n FROM transactions WHERE subscription_id = $1',
            [id]
          )
        ).rows[0].n
      ).toBe(0);
    } finally {
      await client.query('ROLLBACK');
      await pending;
      client.release();
    }
  });

  it('does not charge two billing cycles for two concurrent requests based on the same version', async () => {
    const id = await subscription('10.00', 'USD');
    await pool.query(
      `UPDATE subscriptions SET anchor_date = '2020-01-31', next_billing_date = '2020-01-31' WHERE id = $1`,
      [id]
    );
    const client = await pool.connect();
    let pending: Promise<unknown> | undefined;
    try {
      await client.query('BEGIN');
      const pid = (await client.query<{ pid: number }>('SELECT pg_backend_pid() AS pid')).rows[0]!
        .pid;
      await client.query('SELECT id FROM subscriptions WHERE id = $1 FOR UPDATE', [id]);
      const settled = Promise.allSettled([
        service.paySubscription(userId, id, { idempotencyKey: randomUUID() }, {}, 'UTC'),
        service.paySubscription(userId, id, { idempotencyKey: randomUUID() }, {}, 'UTC')
      ]);
      pending = settled;
      await waitForBlockedTransactions(pid, 2);
      await client.query('COMMIT');
      const results = await settled;
      expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
      expect(results.filter((r) => r.status === 'rejected')).toHaveLength(1);
      expect(results.find((r) => r.status === 'rejected')).toMatchObject({
        reason: { httpStatus: 409 }
      });
      const tx = await pool.query(
        'SELECT billing_date, occurred_on, amount::text FROM transactions WHERE subscription_id = $1',
        [id]
      );
      expect(tx.rows).toEqual([
        { billing_date: '2020-01-31', occurred_on: '2020-01-31', amount: '10.0000' }
      ]);
      expect(
        (await pool.query('SELECT next_billing_date FROM subscriptions WHERE id = $1', [id]))
          .rows[0]
      ).toEqual({ next_billing_date: '2020-02-29' });
    } finally {
      await client.query('ROLLBACK');
      await pending;
      client.release();
    }
  });
});
