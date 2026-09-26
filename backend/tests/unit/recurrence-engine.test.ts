/**
 * tests/unit/recurrence-engine.test.ts
 *
 * Implements Section 1.4.5: Recurrence engine unit tests.
 */

import { describe, it, expect } from 'vitest';
import { computeOccurrences } from '../../src/features/recurring-tasks/recurrence-engine.js';

describe('RecurrenceEngine', () => {
  it('generates daily occurrences within the 7-day window', () => {
    const dates = computeOccurrences(
      {
        freq: 'daily',
        interval: 1,
        startDate: '2026-09-27'
      },
      '2026-09-27',
      '2026-10-04'
    );

    expect(dates).toEqual([
      '2026-09-27',
      '2026-09-28',
      '2026-09-29',
      '2026-09-30',
      '2026-10-01',
      '2026-10-02',
      '2026-10-03',
      '2026-10-04'
    ]);
  });

  it('respects daily interval > 1', () => {
    const dates = computeOccurrences(
      {
        freq: 'daily',
        interval: 2,
        startDate: '2026-09-27'
      },
      '2026-09-27',
      '2026-10-04'
    );

    expect(dates).toEqual(['2026-09-27', '2026-09-29', '2026-10-01', '2026-10-03']);
  });

  it('generates weekly occurrences on specified weekdays', () => {
    // 2026-09-28 is Monday (1), 2026-09-30 is Wednesday (3), 2026-10-02 is Friday (5)
    const dates = computeOccurrences(
      {
        freq: 'weekly',
        interval: 1,
        byWeekday: [1, 3, 5],
        startDate: '2026-09-28'
      },
      '2026-09-27',
      '2026-10-04'
    );

    expect(dates).toEqual(['2026-09-28', '2026-09-30', '2026-10-02']);
  });

  it('handles monthly recurrence with last day of month (-1)', () => {
    const dates = computeOccurrences(
      {
        freq: 'monthly',
        interval: 1,
        byMonthDay: -1,
        startDate: '2026-01-01'
      },
      '2026-01-01',
      '2026-04-01'
    );

    expect(dates).toEqual(['2026-01-31', '2026-02-28', '2026-03-31']);
  });

  it('respects occurrenceLimit', () => {
    const dates = computeOccurrences(
      {
        freq: 'daily',
        interval: 1,
        occurrenceLimit: 3,
        startDate: '2026-09-27'
      },
      '2026-09-27',
      '2026-10-04'
    );

    expect(dates).toEqual(['2026-09-27', '2026-09-28', '2026-09-29']);
  });

  it('respects endDate', () => {
    const dates = computeOccurrences(
      {
        freq: 'daily',
        interval: 1,
        startDate: '2026-09-27',
        endDate: '2026-09-29'
      },
      '2026-09-27',
      '2026-10-04'
    );

    expect(dates).toEqual(['2026-09-27', '2026-09-28', '2026-09-29']);
  });
});
