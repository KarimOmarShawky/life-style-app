/**
 * tests/unit/money-invariants.test.ts
 *
 * V-08: money update and subscription-payment paths must preserve the same
 * effective-state invariants as create — currency scale, the one-day future
 * boundary, and kind/category compatibility. Previously:
 *  - a partial update checked scale only when `amount` and `currency` arrived
 *    together, so a currency-only or amount-only change could store an
 *    impossible scale;
 *  - a kind-only change never re-checked the stored category;
 *  - `POST /subscriptions/:id/pay` had no scale or future-date rule at all.
 */

import { describe, it, expect, vi } from 'vitest';
import {
  assertSubscriptionPaymentInvariants,
  assertTransactionInvariants,
  checkAmountForCurrency,
  isWithinFutureAllowance
} from '../../src/features/money/money.invariants.js';
import { MoneyService } from '../../src/features/money/money.service.js';
import { AppError } from '../../src/core/errors/app-error.js';
import { getUserTodayDate } from '../../src/core/time/date-utils.js';
import type {
  CategoryEntity,
  SubscriptionEntity,
  TransactionEntity
} from '../../src/features/money/money.types.js';

const USER = '11111111-1111-4111-8111-111111111111';
const TX = '22222222-2222-4222-8222-222222222222';
const SUB = '33333333-3333-4333-8333-333333333333';
const CAT = '44444444-4444-4444-8444-444444444444';
const TODAY = getUserTodayDate('UTC');
const context = { requestId: 'test-request' } as never;

function transaction(overrides: Partial<TransactionEntity> = {}): TransactionEntity {
  return {
    id: TX,
    userId: USER,
    kind: 'expense',
    amount: '10.00',
    currency: 'USD',
    occurredOn: TODAY,
    categoryId: null,
    description: null,
    merchant: null,
    subscriptionId: null,
    billingDate: null,
    source: 'manual',
    idempotencyKey: null,
    idempotencyFingerprint: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    deletedAt: null,
    version: 1,
    ...overrides
  };
}

function category(overrides: Partial<CategoryEntity> = {}): CategoryEntity {
  return {
    id: CAT,
    userId: USER,
    kind: 'expense',
    name: 'Food',
    icon: null,
    color: null,
    archivedAt: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    version: 1,
    ...overrides
  };
}

function subscription(overrides: Partial<SubscriptionEntity> = {}): SubscriptionEntity {
  return {
    id: SUB,
    userId: USER,
    name: 'Streaming',
    amount: '10.00',
    currency: 'USD',
    billingUnit: 'month',
    billingInterval: 1,
    anchorDate: TODAY,
    nextBillingDate: TODAY,
    status: 'active',
    cancelledOn: null,
    categoryId: null,
    reminderDaysBefore: null,
    notes: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    deletedAt: null,
    version: 1,
    ...overrides
  };
}

function serviceWith(overrides: Record<string, unknown>) {
  const repository = {
    findTransactionById: vi.fn(async () => transaction()),
    findCategoryById: vi.fn(async () => null),
    updateTransaction: vi.fn(async () => transaction()),
    findSubscriptionById: vi.fn(async () => subscription()),
    paySubscription: vi.fn(async () => ({
      transaction: transaction(),
      subscription: subscription()
    })),
    ...overrides
  };
  const service = new MoneyService(repository as never, { cancelPendingFor: vi.fn() } as never);
  return { repository, service };
}

async function expectValidation(promise: Promise<unknown>, field: string) {
  await expect(promise).rejects.toBeInstanceOf(AppError);
  try {
    await promise;
  } catch (err) {
    const error = err as AppError & { details?: { field: string }[] };
    expect(error.code).toBe('VALIDATION_ERROR');
    expect(error.details?.map((detail) => detail.field)).toContain(field);
  }
}

describe('Money effective-state invariants (V-08)', () => {
  it('checks the amount scale against the currency exponent', () => {
    expect(checkAmountForCurrency('10.50', 'USD')).toEqual({ ok: true, maxScale: 2 });
    expect(checkAmountForCurrency('100', 'JPY')).toEqual({ ok: true, maxScale: 0 });
    expect(checkAmountForCurrency('1.234', 'KWD')).toEqual({ ok: true, maxScale: 3 });
    expect(checkAmountForCurrency('10.005', 'USD')).toEqual({
      ok: false,
      reason: 'scale',
      maxScale: 2
    });
    expect(checkAmountForCurrency('10.5', 'JPY')).toMatchObject({ ok: false, reason: 'scale' });
    expect(checkAmountForCurrency('1.2345', 'KWD')).toMatchObject({ ok: false, reason: 'scale' });
    expect(checkAmountForCurrency('0', 'USD')).toMatchObject({ ok: false, reason: 'non_positive' });
    expect(checkAmountForCurrency('-1.00', 'USD')).toMatchObject({ ok: false, reason: 'format' });
    expect(checkAmountForCurrency(10.5, 'USD')).toMatchObject({ ok: false, reason: 'format' });
  });

  it('allows today and tomorrow but not later', () => {
    expect(isWithinFutureAllowance(TODAY, TODAY)).toBe(true);
    const tomorrow = new Date(`${TODAY}T00:00:00Z`);
    tomorrow.setUTCDate(tomorrow.getUTCDate() + 1);
    const dayAfter = new Date(`${TODAY}T00:00:00Z`);
    dayAfter.setUTCDate(dayAfter.getUTCDate() + 2);
    expect(isWithinFutureAllowance(tomorrow.toISOString().slice(0, 10), TODAY)).toBe(true);
    expect(isWithinFutureAllowance(dayAfter.toISOString().slice(0, 10), TODAY)).toBe(false);
  });

  it('rejects impossible dates, future dates, bad scale, and mismatched categories', () => {
    const base = { kind: 'expense' as const, amount: '10.00', currency: 'USD', occurredOn: TODAY };
    expect(() => assertTransactionInvariants(base, TODAY)).not.toThrow();
    expect(() =>
      assertTransactionInvariants({ ...base, occurredOn: '2026-02-30' }, TODAY)
    ).toThrow(AppError);
    expect(() =>
      assertTransactionInvariants({ ...base, occurredOn: '2999-01-01' }, TODAY)
    ).toThrow(AppError);
    expect(() =>
      assertTransactionInvariants({ ...base, amount: '10.005' }, TODAY)
    ).toThrow(AppError);
    expect(() =>
      assertTransactionInvariants({ ...base, category: category({ kind: 'income' }) }, TODAY)
    ).toThrow(AppError);
    expect(() =>
      assertTransactionInvariants(
        { ...base, category: category({ archivedAt: new Date() }) },
        TODAY
      )
    ).toThrow(AppError);
    expect(() =>
      assertSubscriptionPaymentInvariants(
        { amount: '1.234', currency: 'KWD', occurredOn: TODAY },
        TODAY
      )
    ).not.toThrow();
    expect(() =>
      assertSubscriptionPaymentInvariants(
        { amount: '1.2345', currency: 'KWD', occurredOn: TODAY },
        TODAY
      )
    ).toThrow(AppError);
  });

  it('update: an amount-only change is validated against the stored currency', async () => {
    const { repository, service } = serviceWith({
      findTransactionById: vi.fn(async () => transaction({ amount: '1000', currency: 'JPY' }))
    });

    await expectValidation(
      service.updateTransaction(USER, TX, { amount: '10.5' }, context, 'UTC'),
      'amount'
    );
    expect(repository.updateTransaction).not.toHaveBeenCalled();

    // A compatible amount still updates.
    await service.updateTransaction(USER, TX, { amount: '1001' }, context, 'UTC');
    expect(repository.updateTransaction).toHaveBeenCalledTimes(1);
  });

  it('update: a currency-only change re-validates the stored amount', async () => {
    const { repository, service } = serviceWith({
      findTransactionById: vi.fn(async () => transaction({ amount: '10.50', currency: 'USD' }))
    });

    await expectValidation(
      service.updateTransaction(USER, TX, { currency: 'JPY' }, context, 'UTC'),
      'amount'
    );
    expect(repository.updateTransaction).not.toHaveBeenCalled();
  });

  it('update: a kind-only change cannot keep an incompatible stored category', async () => {
    const { repository, service } = serviceWith({
      findTransactionById: vi.fn(async () => transaction({ kind: 'expense', categoryId: CAT })),
      findCategoryById: vi.fn(async () => category({ kind: 'expense' }))
    });

    await expectValidation(
      service.updateTransaction(USER, TX, { kind: 'income' }, context, 'UTC'),
      'categoryId'
    );
    expect(repository.updateTransaction).not.toHaveBeenCalled();
  });

  it('update: a future occurredOn behind the one-day boundary is refused', async () => {
    const later = new Date(`${TODAY}T00:00:00Z`);
    later.setUTCDate(later.getUTCDate() + 5);
    const { service } = serviceWith({});
    await expectValidation(
      service.updateTransaction(
        USER,
        TX,
        { occurredOn: later.toISOString().slice(0, 10) },
        context,
        'UTC'
      ),
      'occurredOn'
    );
  });

  it('payment: enforces the subscription currency scale and the payment date', async () => {
    const { repository, service } = serviceWith({
      findSubscriptionById: vi.fn(async () => subscription({ amount: '1.234', currency: 'KWD' }))
    });

    await expectValidation(service.paySubscription(USER, SUB, { amount: '1.2345' }, context, 'UTC'), 'amount');
    expect(repository.paySubscription).not.toHaveBeenCalled();

    const future = new Date(`${TODAY}T00:00:00Z`);
    future.setUTCDate(future.getUTCDate() + 9);
    await expectValidation(
      service.paySubscription(
        USER,
        SUB,
        { occurredOn: future.toISOString().slice(0, 10) },
        context,
        'UTC'
      ),
      'occurredOn'
    );
    expect(repository.paySubscription).not.toHaveBeenCalled();

    await service.paySubscription(USER, SUB, { amount: '1.234' }, context, 'UTC');
    expect(repository.paySubscription).toHaveBeenCalledTimes(1);
  });
});
