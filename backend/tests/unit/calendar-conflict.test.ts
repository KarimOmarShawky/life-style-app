/**
 * tests/unit/calendar-conflict.test.ts
 *
 * Implements Unit Tests for Calendar conflict detection and timezone calculations.
 */

import { describe, it, expect } from 'vitest';
import { getDayBoundsUtc } from '../../src/core/time/date-utils.js';

describe('Calendar Pure Domain Logic & Conflict Detection Tests', () => {
  describe('Interval Overlap Logic', () => {
    // Helper function reproducing the interval overlap condition:
    // Two intervals [A_start, A_end] and [B_start, B_end] overlap iff (A_start < B_end && A_end > B_start)
    function intervalsOverlap(aStart: Date, aEnd: Date, bStart: Date, bEnd: Date): boolean {
      return aStart < bEnd && aEnd > bStart;
    }

    it('Detects overlapping intervals where B starts during A', () => {
      const aStart = new Date('2026-10-01T10:00:00Z');
      const aEnd = new Date('2026-10-01T11:00:00Z');

      const bStart = new Date('2026-10-01T10:30:00Z');
      const bEnd = new Date('2026-10-01T11:30:00Z');

      expect(intervalsOverlap(aStart, aEnd, bStart, bEnd)).toBe(true);
      expect(intervalsOverlap(bStart, bEnd, aStart, aEnd)).toBe(true);
    });

    it('Detects completely enclosed / nested interval', () => {
      const aStart = new Date('2026-10-01T09:00:00Z');
      const aEnd = new Date('2026-10-01T13:00:00Z');

      const bStart = new Date('2026-10-01T10:00:00Z');
      const bEnd = new Date('2026-10-01T11:00:00Z');

      expect(intervalsOverlap(aStart, aEnd, bStart, bEnd)).toBe(true);
      expect(intervalsOverlap(bStart, bEnd, aStart, aEnd)).toBe(true);
    });

    it('Returns false for adjacent (back-to-back) non-overlapping intervals', () => {
      const aStart = new Date('2026-10-01T09:00:00Z');
      const aEnd = new Date('2026-10-01T10:00:00Z');

      const bStart = new Date('2026-10-01T10:00:00Z');
      const bEnd = new Date('2026-10-01T11:00:00Z');

      expect(intervalsOverlap(aStart, aEnd, bStart, bEnd)).toBe(false);
      expect(intervalsOverlap(bStart, bEnd, aStart, aEnd)).toBe(false);
    });

    it('Returns false for completely separated intervals', () => {
      const aStart = new Date('2026-10-01T08:00:00Z');
      const aEnd = new Date('2026-10-01T09:00:00Z');

      const bStart = new Date('2026-10-01T14:00:00Z');
      const bEnd = new Date('2026-10-01T15:00:00Z');

      expect(intervalsOverlap(aStart, aEnd, bStart, bEnd)).toBe(false);
      expect(intervalsOverlap(bStart, bEnd, aStart, aEnd)).toBe(false);
    });
  });

  describe('Timezone-aware Day Bounds (getDayBoundsUtc)', () => {
    it('Computes correct UTC day bounds for UTC timezone', () => {
      const { startOfDayUtc, endOfDayUtc } = getDayBoundsUtc('2026-10-01', 'UTC');

      expect(startOfDayUtc.toISOString()).toBe('2026-10-01T00:00:00.000Z');
      expect(endOfDayUtc.toISOString()).toBe('2026-10-01T23:59:59.999Z');
    });

    it('Computes correct UTC day bounds for UTC+3 timezone (Africa/Cairo)', () => {
      const { startOfDayUtc, endOfDayUtc } = getDayBoundsUtc('2026-10-01', 'Africa/Cairo');

      // Cairo is UTC+3 in October (daylight saving time in Egypt)
      // Local midnight is 21:00 UTC previous day
      expect(startOfDayUtc.toISOString()).toBe('2026-09-30T21:00:00.000Z');
      expect(endOfDayUtc.toISOString()).toBe('2026-10-01T20:59:59.999Z');
    });

    it('Computes correct UTC day bounds for UTC-4 timezone (America/New_York)', () => {
      const { startOfDayUtc, endOfDayUtc } = getDayBoundsUtc('2026-10-01', 'America/New_York');

      // EDT is UTC-4
      // Local midnight is 04:00 UTC on the same day
      expect(startOfDayUtc.toISOString()).toBe('2026-10-01T04:00:00.000Z');
      expect(endOfDayUtc.toISOString()).toBe('2026-10-02T03:59:59.999Z');
    });

    it('Falls back safely on invalid timezone', () => {
      const { startOfDayUtc, endOfDayUtc } = getDayBoundsUtc('2026-10-01', 'Invalid/Timezone');

      expect(startOfDayUtc.toISOString()).toBe('2026-10-01T00:00:00.000Z');
      expect(endOfDayUtc.toISOString()).toBe('2026-10-01T23:59:59.999Z');
    });
  });
});
