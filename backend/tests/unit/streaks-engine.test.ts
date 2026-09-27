/**
 * tests/unit/streaks-engine.test.ts
 *
 * Implements Acceptance Tests:
 * - AC-HAB-02: Table-driven tests for streak computation
 * - FR-HAB-05 & FR-HAB-06: Streaks & Today progress math
 */

import { describe, it, expect } from 'vitest';
import {
  computeStreaks,
  getScheduledDates,
  isScheduledDate,
  computeTodayProgress
} from '../../src/features/habits/streaks-engine.js';

describe('StreaksEngine Unit Tests (AC-HAB-02)', () => {
  it('correctly generates scheduled dates for daily habits', () => {
    const dates = getScheduledDates(
      {
        freq: 'daily',
        interval: 1,
        startDate: '2026-09-20'
      },
      '2026-09-24'
    );

    expect(dates).toEqual(['2026-09-20', '2026-09-21', '2026-09-22', '2026-09-23', '2026-09-24']);
  });

  it('correctly generates scheduled dates for weekly habits', () => {
    // 2026-09-21 is Monday (1), 2026-09-23 is Wednesday (3)
    const dates = getScheduledDates(
      {
        freq: 'weekly',
        interval: 1,
        byWeekday: [1, 3],
        startDate: '2026-09-21'
      },
      '2026-09-27'
    );

    expect(dates).toEqual(['2026-09-21', '2026-09-23']);
  });

  it('verifies isScheduledDate accurately', () => {
    const daily = { freq: 'daily' as const, interval: 2, startDate: '2026-09-20' };
    expect(isScheduledDate(daily, '2026-09-20')).toBe(true);
    expect(isScheduledDate(daily, '2026-09-21')).toBe(false);
    expect(isScheduledDate(daily, '2026-09-22')).toBe(true);
    expect(isScheduledDate(daily, '2026-09-19')).toBe(false); // before start date

    const weekly = { freq: 'weekly' as const, byWeekday: [1, 5], startDate: '2026-09-21' };
    expect(isScheduledDate(weekly, '2026-09-21')).toBe(true); // Mon
    expect(isScheduledDate(weekly, '2026-09-22')).toBe(false); // Tue
    expect(isScheduledDate(weekly, '2026-09-25')).toBe(true); // Fri
  });

  describe('Streak Calculation Rules (Table-Driven)', () => {
    const today = '2026-09-25';
    const dates = [
      '2026-09-20',
      '2026-09-21',
      '2026-09-22',
      '2026-09-23',
      '2026-09-24',
      '2026-09-25' // today
    ];

    it('Scenario 1: All done through today', () => {
      const checkins = new Map<string, 'done' | 'skipped'>([
        ['2026-09-20', 'done'],
        ['2026-09-21', 'done'],
        ['2026-09-22', 'done'],
        ['2026-09-23', 'done'],
        ['2026-09-24', 'done'],
        ['2026-09-25', 'done']
      ]);

      const res = computeStreaks(dates, checkins, today);
      expect(res.currentStreak).toBe(6);
      expect(res.longestStreak).toBe(6);
    });

    it('Scenario 2: Today pending does not break current streak', () => {
      const checkins = new Map<string, 'done' | 'skipped'>([
        ['2026-09-20', 'done'],
        ['2026-09-21', 'done'],
        ['2026-09-22', 'done'],
        ['2026-09-23', 'done'],
        ['2026-09-24', 'done']
        // 2026-09-25 is pending (no checkin)
      ]);

      const res = computeStreaks(dates, checkins, today);
      expect(res.currentStreak).toBe(5);
      expect(res.longestStreak).toBe(5);
    });

    it('Scenario 3: Skipped day is neutral (neither extends nor breaks)', () => {
      const checkins = new Map<string, 'done' | 'skipped'>([
        ['2026-09-20', 'done'],
        ['2026-09-21', 'done'],
        ['2026-09-22', 'skipped'], // neutral
        ['2026-09-23', 'done'],
        ['2026-09-24', 'done'],
        ['2026-09-25', 'done']
      ]);

      const res = computeStreaks(dates, checkins, today);
      // 5 done days + 1 skipped neutral = current streak 5
      expect(res.currentStreak).toBe(5);
      expect(res.longestStreak).toBe(5);
    });

    it('Scenario 4: Past missing day breaks the streak', () => {
      const checkins = new Map<string, 'done' | 'skipped'>([
        ['2026-09-20', 'done'],
        ['2026-09-21', 'done'],
        ['2026-09-22', 'done'],
        // 2026-09-23 is missing (missed past day)
        ['2026-09-24', 'done'],
        ['2026-09-25', 'done']
      ]);

      const res = computeStreaks(dates, checkins, today);
      // Current streak: counting back from today: 25(done), 24(done), 23(missed -> break)
      expect(res.currentStreak).toBe(2);
      // Longest streak: days 20, 21, 22 was 3
      expect(res.longestStreak).toBe(3);
    });

    it('Scenario 5: Yesterday missed and today pending resets current streak to 0', () => {
      const checkins = new Map<string, 'done' | 'skipped'>([
        ['2026-09-20', 'done'],
        ['2026-09-21', 'done'],
        ['2026-09-22', 'done']
        // 23 missed, 24 missed, 25 pending
      ]);

      const res = computeStreaks(dates, checkins, today);
      expect(res.currentStreak).toBe(0);
      expect(res.longestStreak).toBe(3);
    });

    it('Scenario 6: Start date boundary (only 1 scheduled date = today)', () => {
      const resPending = computeStreaks(['2026-09-25'], new Map(), today);
      expect(resPending.currentStreak).toBe(0);
      expect(resPending.longestStreak).toBe(0);

      const resDone = computeStreaks(['2026-09-25'], new Map([['2026-09-25', 'done']]), today);
      expect(resDone.currentStreak).toBe(1);
      expect(resDone.longestStreak).toBe(1);
    });
  });

  describe('Today Progress Calculation (FR-HAB-06)', () => {
    it('computes done / (scheduled - skipped)', () => {
      const habits = [
        { habitId: '1', isScheduledToday: true, checkinStatus: 'done' as const },
        { habitId: '2', isScheduledToday: true, checkinStatus: 'skipped' as const },
        { habitId: '3', isScheduledToday: true, checkinStatus: null }, // pending
        { habitId: '4', isScheduledToday: false } // not scheduled
      ];

      const res = computeTodayProgress(habits);
      expect(res.totalScheduled).toBe(3);
      expect(res.done).toBe(1);
      expect(res.skipped).toBe(1);
      // denominator: 3 - 1 = 2; done: 1; percent: 50%
      expect(res.percent).toBe(50);
    });

    it('handles 100% when all non-skipped are done', () => {
      const habits = [
        { habitId: '1', isScheduledToday: true, checkinStatus: 'done' as const },
        { habitId: '2', isScheduledToday: true, checkinStatus: 'skipped' as const }
      ];

      const res = computeTodayProgress(habits);
      expect(res.percent).toBe(100);
    });
  });
});
