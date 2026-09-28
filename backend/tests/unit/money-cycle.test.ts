/**
 * tests/unit/money-cycle.test.ts
 *
 * Implements Section 14.11 & AC-MON-05: Unit tests for subscription cycle math.
 */

import { describe, it, expect } from 'vitest';
import {
  isLeapYear,
  daysInMonth,
  calculateCycleDate,
  calculateNextBillingDate,
  calculateInitialNextBillingDate,
  calculateMonthlyEquivalent,
  calculateDaysUntilNextBilling
} from '../../src/features/money/money.cycle.js';

describe('Subscription Cycle Math & Calculations', () => {
  describe('Leap Year & Month Days', () => {
    it('accurately detects leap years', () => {
      expect(isLeapYear(2024)).toBe(true);
      expect(isLeapYear(2028)).toBe(true);
      expect(isLeapYear(2000)).toBe(true);
      expect(isLeapYear(2026)).toBe(false);
      expect(isLeapYear(1900)).toBe(false);
      expect(isLeapYear(2100)).toBe(false);
    });

    it('returns exact days in month for leap and non-leap years', () => {
      expect(daysInMonth(2026, 2)).toBe(28);
      expect(daysInMonth(2024, 2)).toBe(29);
      expect(daysInMonth(2026, 1)).toBe(31);
      expect(daysInMonth(2026, 4)).toBe(30);
    });
  });

  describe('Cycle Date Clamping (Month Ends & Drift-Free)', () => {
    it('anchored on 31st clamps to 28th in Feb, 31st in Mar, 30th in Apr in 2026', () => {
      const anchor = '2026-01-31';

      expect(calculateCycleDate(anchor, 0, 'month', 1)).toBe('2026-01-31');
      expect(calculateCycleDate(anchor, 1, 'month', 1)).toBe('2026-02-28');
      expect(calculateCycleDate(anchor, 2, 'month', 1)).toBe('2026-03-31');
      expect(calculateCycleDate(anchor, 3, 'month', 1)).toBe('2026-04-30');
      expect(calculateCycleDate(anchor, 4, 'month', 1)).toBe('2026-05-31');
      expect(calculateCycleDate(anchor, 5, 'month', 1)).toBe('2026-06-30');
    });

    it('anchored on 31st in a leap year clamps to Feb 29th', () => {
      const anchor = '2024-01-31';
      expect(calculateCycleDate(anchor, 1, 'month', 1)).toBe('2024-02-29');
      expect(calculateCycleDate(anchor, 2, 'month', 1)).toBe('2024-03-31');
    });

    it('quarterly interval (3 months) computes from anchor', () => {
      const anchor = '2026-01-31';
      expect(calculateCycleDate(anchor, 1, 'month', 3)).toBe('2026-04-30');
      expect(calculateCycleDate(anchor, 2, 'month', 3)).toBe('2026-07-31');
    });

    it('weekly interval adds exact 7 days per interval', () => {
      const anchor = '2026-09-01';
      expect(calculateCycleDate(anchor, 1, 'week', 1)).toBe('2026-09-08');
      expect(calculateCycleDate(anchor, 2, 'week', 1)).toBe('2026-09-15');
      expect(calculateCycleDate(anchor, 1, 'week', 2)).toBe('2026-09-15');
    });

    it('yearly interval handles leap year anchor Feb 29th', () => {
      const anchor = '2024-02-29';
      expect(calculateCycleDate(anchor, 1, 'year', 1)).toBe('2025-02-28');
      expect(calculateCycleDate(anchor, 4, 'year', 1)).toBe('2028-02-29');
    });
  });

  describe('calculateNextBillingDate', () => {
    it('advances from current next_billing_date to subsequent cycle', () => {
      const anchor = '2026-01-31';
      const cur = '2026-01-31';
      expect(calculateNextBillingDate(anchor, cur, 'month', 1)).toBe('2026-02-28');
      expect(calculateNextBillingDate(anchor, '2026-02-28', 'month', 1)).toBe('2026-03-31');
      expect(calculateNextBillingDate(anchor, '2026-03-31', 'month', 1)).toBe('2026-04-30');
    });
  });

  describe('calculateInitialNextBillingDate', () => {
    it('defaults to anchorDate if anchorDate >= today', () => {
      expect(calculateInitialNextBillingDate('2026-10-01', '2026-09-28', 'month', 1)).toBe(
        '2026-10-01'
      );
      expect(calculateInitialNextBillingDate('2026-09-28', '2026-09-28', 'month', 1)).toBe(
        '2026-09-28'
      );
    });

    it('rolls forward to first cycle date >= today if anchorDate in the past', () => {
      // Anchored on 15th of month, today is Sep 28th -> next cycle is Oct 15th
      expect(calculateInitialNextBillingDate('2026-08-15', '2026-09-28', 'month', 1)).toBe(
        '2026-10-15'
      );
    });
  });

  describe('calculateMonthlyEquivalent', () => {
    it('computes monthly equivalent for month, year, and week', () => {
      // Monthly 10.00
      expect(calculateMonthlyEquivalent('10.0000', 'month', 1)).toBe('10.0000');
      // Quarterly 30.00
      expect(calculateMonthlyEquivalent('30.0000', 'month', 3)).toBe('10.0000');
      // Annual 120.00
      expect(calculateMonthlyEquivalent('120.0000', 'year', 1)).toBe('10.0000');
      // Weekly 10.00 -> (10 * 52) / 12 = 43.3333
      expect(calculateMonthlyEquivalent('10.0000', 'week', 1)).toBe('43.3333');
    });
  });

  describe('calculateDaysUntilNextBilling', () => {
    it('calculates integer day difference', () => {
      expect(calculateDaysUntilNextBilling('2026-09-30', '2026-09-28')).toBe(2);
      expect(calculateDaysUntilNextBilling('2026-09-28', '2026-09-28')).toBe(0);
      expect(calculateDaysUntilNextBilling('2026-09-25', '2026-09-28')).toBe(-3);
    });
  });
});
