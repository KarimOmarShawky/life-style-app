/**
 * tests/unit/analytics.test.ts
 *
 * Pure aggregation helpers for GET /api/v1/analytics. The endpoint must
 * never fabricate numbers: unavailable rates are null, and series buckets
 * only sum real per-day counts supplied by the service.
 */

import { describe, it, expect } from 'vitest';
import { buildSeries, ratePercent } from '../../src/features/analytics/analytics.service.js';

describe('analytics ratePercent', () => {
  it('returns null instead of a fabricated rate when denominator is zero', () => {
    expect(ratePercent(0, 0)).toBeNull();
    expect(ratePercent(5, 0)).toBeNull();
  });

  it('rounds to two decimals', () => {
    expect(ratePercent(1, 3)).toBe(33.33);
    expect(ratePercent(3, 3)).toBe(100);
    expect(ratePercent(0, 5)).toBe(0);
  });
});

describe('analytics buildSeries', () => {
  it('emits one point per day for short ranges, filling missing days with real zeros', () => {
    const daily = new Map([
      ['2026-11-04', { tasksCompleted: 2, habitCheckins: 1, focusMinutes: 25 }]
    ]);
    const series = buildSeries('2026-11-03', 3, daily);
    expect(series).toEqual([
      { date: '2026-11-03', tasksCompleted: 0, habitCheckins: 0, focusMinutes: 0 },
      { date: '2026-11-04', tasksCompleted: 2, habitCheckins: 1, focusMinutes: 25 },
      { date: '2026-11-05', tasksCompleted: 0, habitCheckins: 0, focusMinutes: 0 }
    ]);
  });

  it('buckets long ranges into 7-day points without inventing data', () => {
    const daily = new Map([
      ['2026-11-01', { tasksCompleted: 1, habitCheckins: 0, focusMinutes: 10 }],
      ['2026-11-07', { tasksCompleted: 2, habitCheckins: 3, focusMinutes: 5 }],
      ['2026-11-08', { tasksCompleted: 4, habitCheckins: 0, focusMinutes: 0 }]
    ]);
    const series = buildSeries('2026-11-01', 90, daily);
    expect(series).toHaveLength(13);
    expect(series[0]).toEqual({
      date: '2026-11-01',
      tasksCompleted: 3,
      habitCheckins: 3,
      focusMinutes: 15
    });
    expect(series[1]).toEqual({
      date: '2026-11-08',
      tasksCompleted: 4,
      habitCheckins: 0,
      focusMinutes: 0
    });
  });
});
