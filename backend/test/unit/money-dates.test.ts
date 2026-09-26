/**
 * Calendar arithmetic for the money feature.
 *
 * These are the functions that decide which month a report covers and which
 * expenses a budget measures. An off-by-one here does not throw; it quietly
 * leaves the last day of the month out of every total.
 */
import { describe, expect, it } from 'vitest';

import {
  inclusiveDayCount,
  monthBounds,
  monthToFirstDay,
  serverToday,
} from '@/features/money/money.dates';
import { toBudgetMonth } from '@/features/money/money.mapper';

describe('monthToFirstDay', () => {
  it('widens a month to the day the column is constrained to', () => {
    expect(monthToFirstDay('2026-09')).toBe('2026-09-01');
  });

  it('round-trips with the mapper that narrows it again', () => {
    expect(toBudgetMonth(monthToFirstDay('2026-02'))).toBe('2026-02');
  });
});

describe('monthBounds', () => {
  it('covers a 31-day month to its last day', () => {
    expect(monthBounds('2026-01-15')).toEqual({ from: '2026-01-01', to: '2026-01-31' });
  });

  it('covers a 30-day month to its last day', () => {
    expect(monthBounds('2026-09-24')).toEqual({ from: '2026-09-01', to: '2026-09-30' });
  });

  it('gets February right in a common year', () => {
    expect(monthBounds('2026-02-10').to).toBe('2026-02-28');
  });

  it('gets February right in a leap year', () => {
    expect(monthBounds('2024-02-10').to).toBe('2024-02-29');
  });

  it('gets February right in a century that is not a leap year', () => {
    // 1900 is divisible by 4 but not a leap year. A naive rule gets this wrong.
    expect(monthBounds('1900-02-10').to).toBe('1900-02-28');
    expect(monthBounds('2000-02-10').to).toBe('2000-02-29');
  });

  it('is unchanged by the day within the month', () => {
    expect(monthBounds('2026-12-01')).toEqual(monthBounds('2026-12-31'));
  });

  it('pads a single-digit last day, which cannot happen but would sort wrongly', () => {
    expect(monthBounds('2026-03-05').to).toBe('2026-03-31');
  });
});

describe('inclusiveDayCount', () => {
  it('counts a single day as one', () => {
    expect(inclusiveDayCount('2026-09-24', '2026-09-24')).toBe(1);
  });

  it('counts both ends', () => {
    expect(inclusiveDayCount('2026-09-01', '2026-09-30')).toBe(30);
  });

  it('counts a common year as 365 days', () => {
    expect(inclusiveDayCount('2026-01-01', '2026-12-31')).toBe(365);
  });

  it('counts a leap year as 366, which is why the cap is 366 and not 365', () => {
    expect(inclusiveDayCount('2024-01-01', '2024-12-31')).toBe(366);
  });

  it('is not disturbed by a daylight-saving transition', () => {
    // Computed in UTC on purpose. A local-time subtraction across a spring
    // transition gives 30.958 days, which rounds down and loses a day.
    expect(inclusiveDayCount('2026-03-01', '2026-03-31')).toBe(31);
    expect(inclusiveDayCount('2026-10-01', '2026-10-31')).toBe(31);
  });
});

describe('serverToday', () => {
  it('returns a bare calendar date', () => {
    expect(serverToday()).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it('agrees with the UTC date, not the local one', () => {
    expect(serverToday()).toBe(new Date().toISOString().slice(0, 10));
  });
});
