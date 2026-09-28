/**
 * tests/unit/money-validation.test.ts
 *
 * Implements Section 7.2, 14.11 & AC-MON-01: Unit tests for Money validation schemas.
 */

import { describe, it, expect } from 'vitest';
import {
  createCategorySchema,
  createTransactionSchema,
  createSubscriptionSchema,
  createBudgetSchema,
  reportSummaryQuerySchema
} from '../../src/features/money/money.validation.js';

describe('Money Validation Schemas', () => {
  describe('AC-MON-01: Monetary Amount & Currency Exponents', () => {
    it('accepts valid decimal string with scale matching currency exponent', () => {
      // USD has exponent 2
      const usdTx = createTransactionSchema.parse({
        kind: 'expense',
        amount: '12.50',
        currency: 'USD',
        occurredOn: '2026-09-28'
      });
      expect(usdTx.amount).toBe('12.50');

      // JPY has exponent 0
      const jpyTx = createTransactionSchema.parse({
        kind: 'expense',
        amount: '1500',
        currency: 'JPY',
        occurredOn: '2026-09-28'
      });
      expect(jpyTx.amount).toBe('1500');

      // KWD has exponent 3
      const kwdTx = createTransactionSchema.parse({
        kind: 'expense',
        amount: '1.250',
        currency: 'KWD',
        occurredOn: '2026-09-28'
      });
      expect(kwdTx.amount).toBe('1.250');
    });

    it('rejects scale exceeding currency exponent', () => {
      // USD rejects 3 decimal places
      expect(() =>
        createTransactionSchema.parse({
          kind: 'expense',
          amount: '12.505',
          currency: 'USD',
          occurredOn: '2026-09-28'
        })
      ).toThrow(/Amount scale exceeds maximum allowed/);

      // JPY rejects decimal places
      expect(() =>
        createTransactionSchema.parse({
          kind: 'expense',
          amount: '1500.5',
          currency: 'JPY',
          occurredOn: '2026-09-28'
        })
      ).toThrow(/Amount scale exceeds maximum allowed/);
    });

    it('rejects JSON numbers for monetary amounts (must be decimal string)', () => {
      expect(() =>
        createTransactionSchema.parse({
          kind: 'expense',
          amount: 12.5,
          currency: 'USD',
          occurredOn: '2026-09-28'
        })
      ).toThrow();
    });

    it('rejects zero or negative monetary amounts', () => {
      expect(() =>
        createTransactionSchema.parse({
          kind: 'expense',
          amount: '0.00',
          currency: 'USD',
          occurredOn: '2026-09-28'
        })
      ).toThrow();

      expect(() =>
        createTransactionSchema.parse({
          kind: 'expense',
          amount: '-10.00',
          currency: 'USD',
          occurredOn: '2026-09-28'
        })
      ).toThrow();
    });
  });

  describe('Categories Validation', () => {
    it('accepts valid category parameters', () => {
      const cat = createCategorySchema.parse({
        kind: 'expense',
        name: 'Dining Out',
        icon: 'utensils',
        color: '#FF5733'
      });
      expect(cat.name).toBe('Dining Out');
      expect(cat.color).toBe('#FF5733');
    });

    it('rejects empty or overly long category names (>60 chars)', () => {
      expect(() =>
        createCategorySchema.parse({
          kind: 'expense',
          name: '   '
        })
      ).toThrow();

      expect(() =>
        createCategorySchema.parse({
          kind: 'expense',
          name: 'a'.repeat(61)
        })
      ).toThrow();
    });

    it('rejects invalid hex colors', () => {
      expect(() =>
        createCategorySchema.parse({
          kind: 'expense',
          name: 'Groceries',
          color: 'blue'
        })
      ).toThrow();
    });
  });

  describe('Subscriptions & Budgets Validation', () => {
    it('validates subscription parameters', () => {
      const sub = createSubscriptionSchema.parse({
        name: 'Cloud Hosting',
        amount: '29.99',
        currency: 'USD',
        billingUnit: 'month',
        billingInterval: 1,
        anchorDate: '2026-01-01'
      });
      expect(sub.name).toBe('Cloud Hosting');
      expect(sub.billingInterval).toBe(1);
    });

    it('validates budget parameters', () => {
      const budget = createBudgetSchema.parse({
        amountLimit: '500.00',
        currency: 'USD'
      });
      expect(budget.amountLimit).toBe('500.00');
      expect(budget.period).toBe('monthly');
    });
  });

  describe('Reports Validation', () => {
    it('validates report date span (<= 366 days)', () => {
      const valid = reportSummaryQuerySchema.parse({
        from: '2026-01-01',
        to: '2026-12-31'
      });
      expect(valid.from).toBe('2026-01-01');

      // More than 366 days
      expect(() =>
        reportSummaryQuerySchema.parse({
          from: '2025-01-01',
          to: '2026-01-15'
        })
      ).toThrow(/Report date span cannot exceed 366 days/);

      // to < from
      expect(() =>
        reportSummaryQuerySchema.parse({
          from: '2026-05-01',
          to: '2026-04-01'
        })
      ).toThrow(/to date must be greater than or equal to from date/);
    });
  });
});
