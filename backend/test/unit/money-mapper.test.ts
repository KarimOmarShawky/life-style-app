/**
 * Money mappers.
 *
 * The thing being asserted throughout is that amounts pass through UNCHANGED and
 * still typed as strings. A mapper that helpfully converted them to numbers
 * would break nothing visibly: the values would look right in every small test
 * and drift only once real sums got large or repetitive.
 */
import { describe, expect, it } from 'vitest';

import {
  toBudgetMonth,
  toBudgetResponse,
  toExpenseResponse,
  toSubscriptionResponse,
} from '@/features/money/money.mapper';
import type {
  BudgetWithSpending,
  ExpenseRecord,
  SubscriptionWithSchedule,
} from '@/features/money/money.types';

const CREATED = new Date('2026-09-20T10:00:00.000Z');
const UPDATED = new Date('2026-09-21T11:30:00.000Z');

const expense: ExpenseRecord = {
  id: 'e1',
  userId: 'u1',
  amount: '1234.50',
  currency: 'EGP',
  category: 'food',
  spentOn: '2026-09-20',
  note: null,
  createdAt: CREATED,
  updatedAt: UPDATED,
};

describe('toExpenseResponse', () => {
  it('keeps the amount a string', () => {
    const response = toExpenseResponse(expense);
    expect(typeof response.amount).toBe('string');
    expect(response.amount).toBe('1234.50');
  });

  it('keeps a trailing zero that a number would discard', () => {
    // 1234.50 as a JavaScript number serializes as 1234.5. Two decimal places
    // are part of how money reads, and the string preserves them.
    expect(toExpenseResponse({ ...expense, amount: '10.00' }).amount).toBe('10.00');
  });

  it('does not publish the owner', () => {
    expect(Object.keys(toExpenseResponse(expense))).not.toContain('userId');
  });

  it('publishes exactly the fields the API documents', () => {
    expect(Object.keys(toExpenseResponse(expense)).sort()).toEqual([
      'amount',
      'category',
      'createdAt',
      'currency',
      'id',
      'note',
      'spentOn',
      'updatedAt',
    ]);
  });

  it('serializes timestamps as ISO instants and the spend date as a bare date', () => {
    const response = toExpenseResponse(expense);
    expect(response.createdAt).toBe('2026-09-20T10:00:00.000Z');
    expect(response.spentOn).toBe('2026-09-20');
  });
});

const subscription: SubscriptionWithSchedule = {
  id: 's1',
  userId: 'u1',
  name: 'Streaming',
  amount: '120.00',
  currency: 'EGP',
  renewalDate: '2020-01-15',
  billingCycle: 'monthly',
  isActive: true,
  createdAt: CREATED,
  updatedAt: UPDATED,
  nextRenewalDate: '2026-10-15',
  daysUntilRenewal: 21,
};

describe('toSubscriptionResponse', () => {
  it('publishes the stored anchor as well as the derived next date', () => {
    const response = toSubscriptionResponse(subscription);
    expect(response.renewalDate).toBe('2020-01-15');
    expect(response.nextRenewalDate).toBe('2026-10-15');
  });

  it('carries a null schedule through for a cancelled subscription', () => {
    const response = toSubscriptionResponse({
      ...subscription,
      isActive: false,
      nextRenewalDate: null,
      daysUntilRenewal: null,
    });
    expect(response.nextRenewalDate).toBeNull();
    expect(response.daysUntilRenewal).toBeNull();
  });

  it('does not publish the owner', () => {
    expect(Object.keys(toSubscriptionResponse(subscription))).not.toContain('userId');
  });
});

const budget: BudgetWithSpending = {
  id: 'b1',
  userId: 'u1',
  category: 'Food',
  monthlyLimit: '1000.00',
  currency: 'EGP',
  month: '2026-09-01',
  createdAt: CREATED,
  updatedAt: UPDATED,
  spent: '499.99',
  remaining: '500.01',
  percentUsed: 49,
  isOverBudget: false,
  expenseCount: 2,
};

describe('toBudgetResponse', () => {
  it('narrows the stored first-of-month back to the form it was created with', () => {
    expect(toBudgetResponse(budget).month).toBe('2026-09');
  });

  it('passes spending figures through as strings', () => {
    const response = toBudgetResponse(budget);
    expect(response.spent).toBe('499.99');
    expect(response.remaining).toBe('500.01');
  });

  it('carries a negative remaining rather than clamping it at zero', () => {
    const response = toBudgetResponse({
      ...budget,
      spent: '1100.00',
      remaining: '-100.00',
      percentUsed: 110,
      isOverBudget: true,
    });
    expect(response.remaining).toBe('-100.00');
    expect(response.percentUsed).toBe(110);
    expect(response.isOverBudget).toBe(true);
  });

  it('keeps the category spelled the way the user wrote it', () => {
    expect(toBudgetResponse(budget).category).toBe('Food');
  });

  it('does not publish the owner', () => {
    expect(Object.keys(toBudgetResponse(budget))).not.toContain('userId');
  });
});

describe('toBudgetMonth', () => {
  it('drops the day', () => {
    expect(toBudgetMonth('2026-09-01')).toBe('2026-09');
  });
});
