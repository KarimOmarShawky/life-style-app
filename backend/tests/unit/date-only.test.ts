/**
 * tests/unit/date-only.test.ts
 *
 * Validates AUD-08 (year 0000 is not a real calendar date) and AUD-06 (DATE
 * values are formatted with local calendar-day getters, not a UTC toISOString
 * round-trip that shifts the day with the process timezone).
 */

import { describe, it, expect } from 'vitest';
import { isValidCalendarDate } from '../../src/core/validation/date-only.js';
import { formatDateOnly } from '../../src/core/time/date-utils.js';
import { cursorValueFor } from '../../src/features/tasks/tasks.cursor.js';

function localCalendarDay(date: Date): string {
  const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: tz,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).format(date);
}

describe('date-only validation (AUD-08)', () => {
  it('rejects year 0000', () => {
    expect(isValidCalendarDate('0000-01-01')).toBe(false);
    expect(isValidCalendarDate('0000-12-31')).toBe(false);
  });

  it('accepts the valid boundary years 0001 and 9999', () => {
    expect(isValidCalendarDate('0001-01-01')).toBe(true);
    expect(isValidCalendarDate('9999-12-31')).toBe(true);
  });

  it('still rejects impossible days', () => {
    expect(isValidCalendarDate('2026-02-30')).toBe(false);
    expect(isValidCalendarDate('2023-02-29')).toBe(false);
    expect(isValidCalendarDate('2024-02-29')).toBe(true);
  });
});

describe('date-only formatting uses the local calendar day (AUD-06)', () => {
  it('formats a Date with local getters, matching the local calendar day', () => {
    // A DATE column is returned by node-pg as a local-midnight Date. The
    // calendar day must not shift with the process timezone, so the result must
    // equal the local calendar day rather than the UTC toISOString day.
    const date = new Date(Date.UTC(2026, 9, 31, 0, 0, 0));
    expect(formatDateOnly(date)).toBe(localCalendarDay(date));
  });

  it('the dueDate cursor value matches the local calendar day', () => {
    const date = new Date(Date.UTC(2026, 9, 31, 0, 0, 0));
    expect(cursorValueFor({ due_date: date }, 'dueDate')).toBe(formatDateOnly(date));
  });

  it('formatDateOnly never returns a shifted day for a local-midnight Date', () => {
    // new Date(y, m, d) is local midnight; the calendar day must round-trip.
    const date = new Date(2026, 0, 1);
    expect(formatDateOnly(date)).toBe('2026-01-01');
  });
});
