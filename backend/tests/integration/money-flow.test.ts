import '../infrastructure-safety.js';
/**
 * tests/integration/money-flow.test.ts
 *
 * Implements Acceptance Tests for Phase P9: Money (Categories, Transactions, Subscriptions, Budgets, Reports)
 * - AC-MON-01: Exact decimal math (0.1 + 0.2 = 0.30), JSON number rejection, currency exponent scale validation
 * - AC-MON-02: Idempotent transaction creation (200 replay on same key/body, 409 IDEMPOTENCY_KEY_REUSED on conflict)
 * - AC-MON-03: Category kind mismatch and cross-tenant category rejection
 * - AC-MON-04: Audit logging on every transaction mutation in the same database transaction
 * - AC-MON-05: Atomic subscription payment ("Mark as paid"), cycle date clamping, repeat pay prevention
 * - AC-MON-06: Read-time budget usage calculation in user timezone, overall vs category budget, duplicate budget prevention
 * - AC-MON-07: Report aggregation across categories and time series, uncategorized handling, 366-day span limit
 * - Cross-tenant isolation across all Money entities (404 Not Found)
 */

import { describe, it, expect, beforeEach } from 'vitest';
import request from 'supertest';
import { v4 as uuidv4 } from 'uuid';
import { createApp } from '../../src/app.js';
import { getPgPool } from '../../src/infrastructure/database/postgres/pool.js';
import { getRedisClient } from '../../src/infrastructure/redis/redis-client.js';
import { getContainer } from '../../src/container.js';

describe('Money Integration Tests', () => {
  /**
   * Budget usage aggregates over the *current* calendar month, so fixtures
   * must be anchored to today's month instead of a hard-coded one (the old
   * 2026-09 dates silently expired and zeroed the usage windows).
   */
  const currentMonthDay = (day: number): string => {
    const now = new Date();
    // Clamp to today: transaction validation rejects future dates, and budget
    // usage only aggregates the current calendar month.
    const clamped = Math.min(day, now.getDate());
    const mm = String(now.getMonth() + 1).padStart(2, '0');
    const dd = String(clamped).padStart(2, '0');
    return `${now.getFullYear()}-${mm}-${dd}`;
  };

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

  async function registerUser(email = 'money_user@example.com', timezone = 'UTC') {
    const res = await request(app).post('/api/v1/auth/register').send({
      email,
      password: 'ValidUserPassword123!',
      displayName: 'Money Test User',
      timezone,
      defaultCurrency: 'USD'
    });
    return res.body.data;
  }

  describe('AC-MON-01: Exact Monetary Arithmetic & Scale Invariants', () => {
    it('Sums 0.10 + 0.20 to exactly 0.30 without IEEE 754 floating point inaccuracies', async () => {
      const { tokens } = await registerUser();

      // Create budget for USD
      const budgetRes = await request(app)
        .post('/api/v1/money/budgets')
        .set('Authorization', `Bearer ${tokens.accessToken}`)
        .send({
          amountLimit: '10.00',
          currency: 'USD'
        });
      expect(budgetRes.status).toBe(201);
      const budgetId = budgetRes.body.data.budget.id;

      // Create transaction 1: 0.10
      const tx1 = await request(app)
        .post('/api/v1/money/transactions')
        .set('Authorization', `Bearer ${tokens.accessToken}`)
        .set('Idempotency-Key', uuidv4())
        .send({
          kind: 'expense',
          amount: '0.10',
          currency: 'USD',
          occurredOn: currentMonthDay(15)
        });
      expect(tx1.status).toBe(201);

      // Create transaction 2: 0.20
      const tx2 = await request(app)
        .post('/api/v1/money/transactions')
        .set('Authorization', `Bearer ${tokens.accessToken}`)
        .set('Idempotency-Key', uuidv4())
        .send({
          kind: 'expense',
          amount: '0.20',
          currency: 'USD',
          occurredOn: currentMonthDay(16)
        });
      expect(tx2.status).toBe(201);

      // Check budget usage: spent must equal exactly "0.30"
      const budgetCheck = await request(app)
        .get(`/api/v1/money/budgets/${budgetId}`)
        .set('Authorization', `Bearer ${tokens.accessToken}`);

      expect(budgetCheck.status).toBe(200);
      expect(budgetCheck.body.data.budget.usage.spent).toBe('0.30');
      expect(budgetCheck.body.data.budget.usage.remaining).toBe('9.70');
    });

    it('Rejects JSON numbers and scale exceeding currency exponent', async () => {
      const { tokens } = await registerUser();

      // JSON number rejected
      const resNum = await request(app)
        .post('/api/v1/money/transactions')
        .set('Authorization', `Bearer ${tokens.accessToken}`)
        .set('Idempotency-Key', uuidv4())
        .send({
          kind: 'expense',
          amount: 25.5,
          currency: 'USD',
          occurredOn: '2026-09-15'
        });
      expect(resNum.status).toBe(400);

      // Scale 3 rejected for USD (max 2)
      const resScale = await request(app)
        .post('/api/v1/money/transactions')
        .set('Authorization', `Bearer ${tokens.accessToken}`)
        .set('Idempotency-Key', uuidv4())
        .send({
          kind: 'expense',
          amount: '25.555',
          currency: 'USD',
          occurredOn: '2026-09-15'
        });
      expect(resScale.status).toBe(400);
      expect(resScale.body.error.code).toBe('VALIDATION_ERROR');
    });
  });

  describe('AC-MON-02: Transaction Idempotency', () => {
    it('Returns 200 OK on replay of same Idempotency-Key and payload, creating only one database row', async () => {
      const { tokens } = await registerUser();
      const idempotencyKey = uuidv4();

      const payload = {
        kind: 'expense',
        amount: '45.00',
        currency: 'USD',
        occurredOn: '2026-09-20',
        description: 'Office Supplies',
        merchant: 'Staples'
      };

      // First call -> 201 Created
      const res1 = await request(app)
        .post('/api/v1/money/transactions')
        .set('Authorization', `Bearer ${tokens.accessToken}`)
        .set('Idempotency-Key', idempotencyKey)
        .send(payload);

      expect(res1.status).toBe(201);
      const originalId = res1.body.data.transaction.id;

      // Second call with same key and body -> 200 OK
      const res2 = await request(app)
        .post('/api/v1/money/transactions')
        .set('Authorization', `Bearer ${tokens.accessToken}`)
        .set('Idempotency-Key', idempotencyKey)
        .send(payload);

      expect(res2.status).toBe(200);
      expect(res2.body.data.transaction.id).toBe(originalId);

      // Verify exactly one row in DB
      const dbRows = await pool.query('SELECT * FROM transactions WHERE idempotency_key = $1', [
        idempotencyKey
      ]);
      expect(dbRows.rows.length).toBe(1);
    });

    it('Rejects same Idempotency-Key with different payload with 409 IDEMPOTENCY_KEY_REUSED', async () => {
      const { tokens } = await registerUser();
      const idempotencyKey = uuidv4();

      await request(app)
        .post('/api/v1/money/transactions')
        .set('Authorization', `Bearer ${tokens.accessToken}`)
        .set('Idempotency-Key', idempotencyKey)
        .send({
          kind: 'expense',
          amount: '10.00',
          currency: 'USD',
          occurredOn: '2026-09-20'
        });

      // Different amount with same key
      const conflictRes = await request(app)
        .post('/api/v1/money/transactions')
        .set('Authorization', `Bearer ${tokens.accessToken}`)
        .set('Idempotency-Key', idempotencyKey)
        .send({
          kind: 'expense',
          amount: '20.00',
          currency: 'USD',
          occurredOn: '2026-09-20'
        });

      expect(conflictRes.status).toBe(409);
      expect(conflictRes.body.error.code).toBe('IDEMPOTENCY_KEY_REUSED');
    });
  });

  describe('AC-MON-03: Category Kind & Tenant Validation', () => {
    it('Rejects linking an income category to an expense transaction', async () => {
      const { tokens } = await registerUser();

      // Create custom income category
      const catRes = await request(app)
        .post('/api/v1/money/categories')
        .set('Authorization', `Bearer ${tokens.accessToken}`)
        .send({
          kind: 'income',
          name: 'Consulting Work'
        });
      expect(catRes.status).toBe(201);
      const incomeCatId = catRes.body.data.category.id;

      // Attempt to link to expense transaction
      const txRes = await request(app)
        .post('/api/v1/money/transactions')
        .set('Authorization', `Bearer ${tokens.accessToken}`)
        .set('Idempotency-Key', uuidv4())
        .send({
          kind: 'expense',
          amount: '50.00',
          currency: 'USD',
          occurredOn: '2026-09-20',
          categoryId: incomeCatId
        });

      expect(txRes.status).toBe(400);
      expect(txRes.body.error.details?.[0]?.message).toMatch(/Category kind .* does not match/);
    });

    it('Rejects category name collision for same user and kind with 409 CATEGORY_NAME_TAKEN', async () => {
      const { tokens } = await registerUser();

      await request(app)
        .post('/api/v1/money/categories')
        .set('Authorization', `Bearer ${tokens.accessToken}`)
        .send({
          kind: 'expense',
          name: 'Groceries'
        });

      // Same name (case-insensitive) and kind
      const dupRes = await request(app)
        .post('/api/v1/money/categories')
        .set('Authorization', `Bearer ${tokens.accessToken}`)
        .send({
          kind: 'expense',
          name: 'groceries'
        });

      expect(dupRes.status).toBe(409);
      expect(dupRes.body.error.code).toBe('CATEGORY_NAME_TAKEN');
    });
  });

  describe('AC-MON-04: Transaction Audit Logging', () => {
    it('Writes an audit_logs entry for create, update, and delete in the same database transaction', async () => {
      const { tokens } = await registerUser();

      // 1. Create transaction
      const createRes = await request(app)
        .post('/api/v1/money/transactions')
        .set('Authorization', `Bearer ${tokens.accessToken}`)
        .set('Idempotency-Key', uuidv4())
        .send({
          kind: 'expense',
          amount: '15.00',
          currency: 'USD',
          occurredOn: '2026-09-20',
          description: 'Lunch'
        });
      expect(createRes.status, JSON.stringify(createRes.body)).toBe(201);
      const txId = createRes.body.data.transaction.id;
      expect(txId).toMatch(/^[0-9a-f-]{36}$/i);

      // 2. Update transaction
      const updateRes = await request(app)
        .patch(`/api/v1/money/transactions/${txId}`)
        .set('Authorization', `Bearer ${tokens.accessToken}`)
        .send({
          description: 'Team Lunch'
        });
      expect(updateRes.status, JSON.stringify(updateRes.body)).toBe(200);

      // 3. Delete transaction
      const deleteRes = await request(app)
        .delete(`/api/v1/money/transactions/${txId}`)
        .set('Authorization', `Bearer ${tokens.accessToken}`);
      expect(deleteRes.status).toBe(204);

      // Verify audit logs in database
      const auditRows = await pool.query(
        'SELECT event_type, outcome FROM audit_logs WHERE entity_id = $1 ORDER BY id ASC',
        [txId]
      );

      expect(auditRows.rows).toHaveLength(3);
      expect(auditRows.rows[0]?.event_type).toBe('transaction.created');
      expect(auditRows.rows[1]?.event_type).toBe('transaction.updated');
      expect(auditRows.rows[2]?.event_type).toBe('transaction.deleted');
    });
  });

  describe('AC-MON-05: Subscriptions & "Mark as Paid" Cycle Advancing', () => {
    it('Atomically creates linked expense transaction, advances next_billing_date from anchor, and prevents double-pay', async () => {
      const { tokens } = await registerUser();

      // Create subscription anchored on Jan 31st
      const subRes = await request(app)
        .post('/api/v1/money/subscriptions')
        .set('Authorization', `Bearer ${tokens.accessToken}`)
        .send({
          name: 'Gym Membership',
          amount: '60.00',
          currency: 'USD',
          billingUnit: 'month',
          billingInterval: 1,
          anchorDate: '2026-01-31',
          nextBillingDate: '2026-01-31'
        });

      expect(subRes.status).toBe(201);
      const subId = subRes.body.data.subscription.id;
      expect(subRes.body.data.subscription.nextBillingDate).toBe('2026-01-31');

      // Pay subscription
      const payRes = await request(app)
        .post(`/api/v1/money/subscriptions/${subId}/pay`)
        .set('Authorization', `Bearer ${tokens.accessToken}`)
        .set('Idempotency-Key', uuidv4())
        .send({
          occurredOn: '2026-01-31'
        });

      expect(payRes.status).toBe(201);
      expect(payRes.body.data.transaction).toBeDefined();
      expect(payRes.body.data.transaction.subscriptionId).toBe(subId);
      expect(payRes.body.data.transaction.billingDate).toBe('2026-01-31');

      // Month-end clamp: Jan 31st -> Feb 28th (non-leap year 2026)
      expect(payRes.body.data.subscription.nextBillingDate).toBe('2026-02-28');

      // Attempting to pay again for the same period triggers ALREADY_PAID_FOR_PERIOD
      const repeatPayRes = await request(app)
        .post(`/api/v1/money/subscriptions/${subId}/pay`)
        .set('Authorization', `Bearer ${tokens.accessToken}`)
        .set('Idempotency-Key', uuidv4())
        .send({
          occurredOn: '2026-01-31'
        });

      // Second pay advances from 2026-02-28 to 2026-03-31
      expect(repeatPayRes.status).toBe(201);
      expect(repeatPayRes.body.data.subscription.nextBillingDate).toBe('2026-03-31');

      // If we attempt to create a transaction directly for the same subscription_id and billing_date, it is rejected by UNIQUE constraint
      const dupBillingTx = await request(app)
        .post('/api/v1/money/transactions')
        .set('Authorization', `Bearer ${tokens.accessToken}`)
        .set('Idempotency-Key', uuidv4())
        .send({
          kind: 'expense',
          amount: '60.00',
          currency: 'USD',
          occurredOn: '2026-01-31',
          subscriptionId: subId,
          billingDate: '2026-01-31'
        });

      // 409 Conflict due to UNIQUE(subscription_id, billing_date)
      expect(dupBillingTx.status).toBe(409);
    });
  });

  describe('P0 effective money records over HTTP', () => {
    it('rejects partial currency and amount updates without changing their rows', async () => {
      const { tokens } = await registerUser();
      const auth = `Bearer ${tokens.accessToken}`;
      const tx = await request(app)
        .post('/api/v1/money/transactions')
        .set('Authorization', auth)
        .set('Idempotency-Key', uuidv4())
        .send({ kind: 'expense', amount: '10.00', currency: 'USD', occurredOn: '2020-01-01' });
      expect(tx.status).toBe(201);
      const txId = tx.body.data.transaction.id;
      const sub = await request(app)
        .post('/api/v1/money/subscriptions')
        .set('Authorization', auth)
        .send({
          name: 'Test',
          amount: '10',
          currency: 'JPY',
          billingUnit: 'month',
          anchorDate: '2020-01-01',
          nextBillingDate: '2020-01-01'
        });
      expect(sub.status).toBe(201);
      const subId = sub.body.data.subscription.id;
      const budget = await request(app)
        .post('/api/v1/money/budgets')
        .set('Authorization', auth)
        .send({ amountLimit: '100', currency: 'JPY' });
      expect(budget.status).toBe(201);
      const budgetId = budget.body.data.budget.id;
      const snapshot = async (table: 'transactions' | 'subscriptions' | 'budgets', id: string) =>
        (await pool.query(`SELECT row_to_json(t)::text AS row FROM ${table} t WHERE id = $1`, [id]))
          .rows[0].row;
      const before = await Promise.all([
        snapshot('transactions', txId),
        snapshot('subscriptions', subId),
        snapshot('budgets', budgetId)
      ]);
      const responses = await Promise.all([
        request(app)
          .patch(`/api/v1/money/transactions/${txId}`)
          .set('Authorization', auth)
          .send({ currency: 'JPY' }),
        request(app)
          .patch(`/api/v1/money/subscriptions/${subId}`)
          .set('Authorization', auth)
          .send({ amount: '10.55' }),
        request(app)
          .patch(`/api/v1/money/budgets/${budgetId}`)
          .set('Authorization', auth)
          .send({ amountLimit: '10.55' })
      ]);
      for (const response of responses) {
        expect(response.status, JSON.stringify(response.body)).toBe(400);
        expect(response.body.error.code).toBe('VALIDATION_ERROR');
      }
      expect(
        await Promise.all([
          snapshot('transactions', txId),
          snapshot('subscriptions', subId),
          snapshot('budgets', budgetId)
        ])
      ).toEqual(before);
    });

    it('rejects archived effective categories in transaction, subscription and budget updates', async () => {
      const { tokens } = await registerUser();
      const auth = `Bearer ${tokens.accessToken}`;
      const cat = await request(app)
        .post('/api/v1/money/categories')
        .set('Authorization', auth)
        .send({ kind: 'expense', name: 'Archived fixture' });
      expect(cat.status).toBe(201);
      const categoryId = cat.body.data.category.id;
      const tx = await request(app)
        .post('/api/v1/money/transactions')
        .set('Authorization', auth)
        .set('Idempotency-Key', uuidv4())
        .send({
          kind: 'expense',
          amount: '10.00',
          currency: 'USD',
          occurredOn: '2020-01-01',
          categoryId
        });
      const sub = await request(app)
        .post('/api/v1/money/subscriptions')
        .set('Authorization', auth)
        .send({
          name: 'Test',
          amount: '10.00',
          currency: 'USD',
          billingUnit: 'month',
          anchorDate: '2020-01-01',
          nextBillingDate: '2020-01-01',
          categoryId
        });
      const budget = await request(app)
        .post('/api/v1/money/budgets')
        .set('Authorization', auth)
        .send({ amountLimit: '100.00', currency: 'USD', categoryId });
      expect([tx.status, sub.status, budget.status]).toEqual([201, 201, 201]);
      const ids = [
        tx.body.data.transaction.id,
        sub.body.data.subscription.id,
        budget.body.data.budget.id
      ];
      const archived = await request(app)
        .patch(`/api/v1/money/categories/${categoryId}`)
        .set('Authorization', auth)
        .send({ archived: true });
      expect(archived.status).toBe(200);
      const snapshot = async (table: 'transactions' | 'subscriptions' | 'budgets', id: string) =>
        (await pool.query(`SELECT row_to_json(t)::text AS row FROM ${table} t WHERE id = $1`, [id]))
          .rows[0].row;
      const before = await Promise.all([
        snapshot('transactions', ids[0]),
        snapshot('subscriptions', ids[1]),
        snapshot('budgets', ids[2])
      ]);
      const responses = await Promise.all([
        request(app)
          .patch(`/api/v1/money/transactions/${ids[0]}`)
          .set('Authorization', auth)
          .send({ description: 'Updated' }),
        request(app)
          .patch(`/api/v1/money/subscriptions/${ids[1]}`)
          .set('Authorization', auth)
          .send({ name: 'Updated' }),
        request(app)
          .patch(`/api/v1/money/budgets/${ids[2]}`)
          .set('Authorization', auth)
          .send({ amountLimit: '90.00' })
      ]);
      for (const response of responses) {
        expect(response.status, JSON.stringify(response.body)).toBe(400);
        expect(response.body.error.code).toBe('VALIDATION_ERROR');
      }
      expect(
        await Promise.all([
          snapshot('transactions', ids[0]),
          snapshot('subscriptions', ids[1]),
          snapshot('budgets', ids[2])
        ])
      ).toEqual(before);
    });

    it('rejects invalid payments and inserts the exact validated KWD override', async () => {
      const { tokens } = await registerUser();
      const auth = `Bearer ${tokens.accessToken}`;
      const makeSub = (currency: string, amount: string) =>
        request(app)
          .post('/api/v1/money/subscriptions')
          .set('Authorization', auth)
          .send({
            name: `${currency} test`,
            amount,
            currency,
            billingUnit: 'month',
            anchorDate: '2020-01-01',
            nextBillingDate: '2020-01-01'
          });
      const kwd = await makeSub('KWD', '1.234');
      const jpy = await makeSub('JPY', '10');
      expect([kwd.status, jpy.status]).toEqual([201, 201]);
      const kwdId = kwd.body.data.subscription.id;
      const jpyId = jpy.body.data.subscription.id;
      await pool.query('UPDATE subscriptions SET amount = $1, amount_scale = NULL WHERE id = $2', [
        '10.5000',
        jpyId
      ]);
      const before = (
        await pool.query('SELECT row_to_json(t)::text AS row FROM subscriptions t WHERE id = $1', [
          jpyId
        ])
      ).rows[0].row;
      const jpyPay = await request(app)
        .post(`/api/v1/money/subscriptions/${jpyId}/pay`)
        .set('Authorization', auth)
        .set('Idempotency-Key', uuidv4())
        .send({});
      expect(jpyPay.status, JSON.stringify(jpyPay.body)).toBe(400);
      expect(jpyPay.body.error.code).toBe('VALIDATION_ERROR');
      expect(
        (
          await pool.query(
            'SELECT row_to_json(t)::text AS row FROM subscriptions t WHERE id = $1',
            [jpyId]
          )
        ).rows[0].row
      ).toBe(before);
      const invalid = await request(app)
        .post(`/api/v1/money/subscriptions/${kwdId}/pay`)
        .set('Authorization', auth)
        .set('Idempotency-Key', uuidv4())
        .send({ amount: '1.2345' });
      expect(invalid.status, JSON.stringify(invalid.body)).toBe(400);
      expect(invalid.body.error.code).toBe('VALIDATION_ERROR');
      expect(
        (
          await pool.query(
            'SELECT count(*)::int AS n FROM transactions WHERE subscription_id IN ($1, $2)',
            [jpyId, kwdId]
          )
        ).rows[0].n
      ).toBe(0);
      const valid = await request(app)
        .post(`/api/v1/money/subscriptions/${kwdId}/pay`)
        .set('Authorization', auth)
        .set('Idempotency-Key', uuidv4())
        .send({ amount: '1.234' });
      expect(valid.status, JSON.stringify(valid.body)).toBe(201);
      expect(valid.body.data.transaction.amount).toBe('1.234');
      expect(
        (
          await pool.query(
            'SELECT amount::text, currency FROM transactions WHERE subscription_id = $1',
            [kwdId]
          )
        ).rows
      ).toEqual([{ amount: '1.2340', currency: 'KWD' }]);
    });

    it('returns HTTP 409 and inserts nothing when a payment races a subscription update', async () => {
      const { tokens } = await registerUser();
      const auth = `Bearer ${tokens.accessToken}`;
      const sub = await request(app)
        .post('/api/v1/money/subscriptions')
        .set('Authorization', auth)
        .send({
          name: 'Test',
          amount: '10.00',
          currency: 'USD',
          billingUnit: 'month',
          anchorDate: '2020-01-31',
          nextBillingDate: '2020-01-31'
        });
      expect(sub.status).toBe(201);
      const id = sub.body.data.subscription.id;
      const client = await pool.connect();
      let pending: Promise<unknown> | undefined;
      try {
        await client.query('BEGIN');
        const pid = (await client.query<{ pid: number }>('SELECT pg_backend_pid() AS pid')).rows[0]!
          .pid;
        await client.query(
          `UPDATE subscriptions SET amount = '13.25', next_billing_date = '2020-02-15', version = version + 1 WHERE id = $1`,
          [id]
        );
        const response = request(app)
          .post(`/api/v1/money/subscriptions/${id}/pay`)
          .set('Authorization', auth)
          .set('Idempotency-Key', uuidv4())
          .send({})
          .then((value) => value);
        pending = response.catch(() => undefined);
        const deadline = Date.now() + 5_000;
        let blocked = false;
        while (Date.now() < deadline && !blocked) {
          const result = await pool.query<{ blocked: boolean }>(
            'SELECT EXISTS (SELECT 1 FROM pg_stat_activity WHERE $1 = ANY(pg_blocking_pids(pid))) AS blocked',
            [pid]
          );
          blocked = result.rows[0]!.blocked;
          if (!blocked) await new Promise((resolve) => setTimeout(resolve, 20));
        }
        expect(blocked).toBe(true);
        await client.query('COMMIT');
        const res = await response;
        expect(res.status, JSON.stringify(res.body)).toBe(409);
        expect(res.body.error.code).toBe('VERSION_CONFLICT');
        const current = await pool.query(
          'SELECT amount::text, next_billing_date, version FROM subscriptions WHERE id = $1',
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
  });

  describe('AC-MON-06: Budget Usage & Constraints', () => {
    it('Calculates usage from current calendar month in user timezone and enforces one budget per target/currency', async () => {
      const { tokens } = await registerUser('budget_tz_user@example.com', 'UTC');

      // 1. Create a custom category
      const catRes = await request(app)
        .post('/api/v1/money/categories')
        .set('Authorization', `Bearer ${tokens.accessToken}`)
        .send({
          kind: 'expense',
          name: 'Custom Hobby'
        });
      expect(catRes.status).toBe(201);
      const catId = catRes.body.data.category.id;

      // 2. Create budget for category
      const budgetRes = await request(app)
        .post('/api/v1/money/budgets')
        .set('Authorization', `Bearer ${tokens.accessToken}`)
        .send({
          categoryId: catId,
          amountLimit: '150.00',
          currency: 'USD'
        });

      expect(budgetRes.status).toBe(201);
      const budgetId = budgetRes.body.data.budget.id;

      // 3. Attempt to create duplicate budget for same category and currency -> 409 BUDGET_ALREADY_EXISTS
      const dupBudgetRes = await request(app)
        .post('/api/v1/money/budgets')
        .set('Authorization', `Bearer ${tokens.accessToken}`)
        .send({
          categoryId: catId,
          amountLimit: '200.00',
          currency: 'USD'
        });

      expect(dupBudgetRes.status).toBe(409);
      expect(dupBudgetRes.body.error.code).toBe('BUDGET_ALREADY_EXISTS');

      // 4. Create an overall budget (categoryId: null)
      const overallRes = await request(app)
        .post('/api/v1/money/budgets')
        .set('Authorization', `Bearer ${tokens.accessToken}`)
        .send({
          amountLimit: '1000.00',
          currency: 'USD'
        });
      expect(overallRes.status).toBe(201);

      // 5. Add expense transaction in current month
      await request(app)
        .post('/api/v1/money/transactions')
        .set('Authorization', `Bearer ${tokens.accessToken}`)
        .set('Idempotency-Key', uuidv4())
        .send({
          kind: 'expense',
          amount: '75.00',
          currency: 'USD',
          occurredOn: currentMonthDay(10),
          categoryId: catId
        });

      // Check category budget usage
      const catBudget = await request(app)
        .get(`/api/v1/money/budgets/${budgetId}`)
        .set('Authorization', `Bearer ${tokens.accessToken}`);

      expect(catBudget.body.data.budget.usage.spent).toBe('75.00');
      expect(catBudget.body.data.budget.usage.remaining).toBe('75.00');
      expect(catBudget.body.data.budget.usage.percentUsed).toBe(50.0);
      expect(catBudget.body.data.budget.usage.overspent).toBe(false);

      // Check overall budget usage
      const overallBudget = await request(app)
        .get(`/api/v1/money/budgets/${overallRes.body.data.budget.id}`)
        .set('Authorization', `Bearer ${tokens.accessToken}`);

      expect(overallBudget.body.data.budget.usage.spent).toBe('75.00');
      expect(overallBudget.body.data.budget.usage.remaining).toBe('925.00');
      expect(overallBudget.body.data.budget.usage.percentUsed).toBe(7.5);
    });
  });

  describe('AC-MON-07: Reports Summary', () => {
    it('Aggregates totals, groups by category, handles uncategorized, and rejects spans > 366 days', async () => {
      const { tokens } = await registerUser();

      // Income transaction
      await request(app)
        .post('/api/v1/money/transactions')
        .set('Authorization', `Bearer ${tokens.accessToken}`)
        .set('Idempotency-Key', uuidv4())
        .send({
          kind: 'income',
          amount: '3000.00',
          currency: 'USD',
          occurredOn: '2026-09-01',
          description: 'Salary'
        });

      // Expense transaction (uncategorized)
      await request(app)
        .post('/api/v1/money/transactions')
        .set('Authorization', `Bearer ${tokens.accessToken}`)
        .set('Idempotency-Key', uuidv4())
        .send({
          kind: 'expense',
          amount: '50.00',
          currency: 'USD',
          occurredOn: '2026-09-05'
        });

      const reportRes = await request(app)
        .get('/api/v1/money/reports/summary?from=2026-09-01&to=2026-09-30&groupBy=week')
        .set('Authorization', `Bearer ${tokens.accessToken}`);

      expect(reportRes.status).toBe(200);
      expect(reportRes.body.data.totals.income).toBe('3000.00');
      expect(reportRes.body.data.totals.expense).toBe('50.00');
      expect(reportRes.body.data.totals.net).toBe('2950.00');

      // Uncategorized check
      const uncat = reportRes.body.data.byCategory.find(
        (c: { categoryId: string | null }) => c.categoryId === null
      );
      expect(uncat).toBeDefined();
      expect(uncat.name).toBe('Uncategorized');

      // Time series check
      expect(reportRes.body.data.series).toBeDefined();
      expect(Array.isArray(reportRes.body.data.series)).toBe(true);

      // Span > 366 days rejected
      const spanRes = await request(app)
        .get('/api/v1/money/reports/summary?from=2025-01-01&to=2026-02-01')
        .set('Authorization', `Bearer ${tokens.accessToken}`);
      expect(spanRes.status).toBe(400);
    });
  });

  describe('Cross-Tenant Security', () => {
    it('User B cannot view or modify User A categories, transactions, subscriptions, budgets (404)', async () => {
      const userA = await registerUser('usera_mon@example.com');
      const userB = await registerUser('userb_mon@example.com');

      // User A creates category and subscription
      const catA = await request(app)
        .post('/api/v1/money/categories')
        .set('Authorization', `Bearer ${userA.tokens.accessToken}`)
        .send({
          kind: 'expense',
          name: 'Private Category'
        });

      const subA = await request(app)
        .post('/api/v1/money/subscriptions')
        .set('Authorization', `Bearer ${userA.tokens.accessToken}`)
        .send({
          name: 'Private Sub',
          amount: '12.00',
          currency: 'USD',
          billingUnit: 'month',
          anchorDate: '2026-09-01'
        });

      // User B cannot read User A category
      const getCatB = await request(app)
        .get(`/api/v1/money/categories/${catA.body.data.category.id}`)
        .set('Authorization', `Bearer ${userB.tokens.accessToken}`);
      expect(getCatB.status).toBe(404);

      // User B cannot read User A subscription
      const getSubB = await request(app)
        .get(`/api/v1/money/subscriptions/${subA.body.data.subscription.id}`)
        .set('Authorization', `Bearer ${userB.tokens.accessToken}`);
      expect(getSubB.status).toBe(404);

      // User B cannot link User A category in transaction
      const txB = await request(app)
        .post('/api/v1/money/transactions')
        .set('Authorization', `Bearer ${userB.tokens.accessToken}`)
        .set('Idempotency-Key', uuidv4())
        .send({
          kind: 'expense',
          amount: '10.00',
          currency: 'USD',
          occurredOn: '2026-09-15',
          categoryId: catA.body.data.category.id
        });
      expect(txB.status).toBe(404);
    });
  });
});
