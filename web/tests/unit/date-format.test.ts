import { describe, expect, it } from 'vitest';
import {
  addDays,
  formatDateOnly,
  formatTimeOfDay,
  formatTimestamp,
  getUserToday,
  isDateOnly,
  isTimeOnly,
  timestampToZonedParts,
  zonedDateTimeToUtc
} from '@/lib/date/format';

describe('date-only values (calendar dates, never UTC-shifted)', () => {
  it('detects date-only strings', () => {
    expect(isDateOnly('2026-09-28')).toBe(true);
    expect(isDateOnly('2026-09-28T00:00:00.000Z')).toBe(false);
    expect(isTimeOnly('09:30')).toBe(true);
    expect(isTimeOnly('24:00')).toBe(false);
  });

  it('renders a date-only value in the UTC anchor (never shifted by machine zone)', () => {
    // vitest runs with TZ=America/New_York; UTC-anchored formatting keeps
    // calendar dates on the same day.
    expect(formatDateOnly('2026-01-01')).toBe('Thu, Jan 1, 2026');
    expect(formatDateOnly('2026-12-31')).toBe('Thu, Dec 31, 2026');
  });

  it('adds days across a DST boundary without drift', () => {
    // US DST spring-forward 2026-03-08.
    expect(addDays('2026-03-07', 1)).toBe('2026-03-08');
    expect(addDays('2026-03-08', 1)).toBe('2026-03-09');
    expect(addDays('2026-03-09', -2)).toBe('2026-03-07');
  });
});

describe('absolute timestamps in the stored timezone', () => {
  const iso = '2026-07-04T16:00:00.000Z';

  it('renders in the explicit zone, not the machine zone', () => {
    const ny = formatTimestamp(iso, 'America/New_York');
    const tokyo = formatTimestamp(iso, 'Asia/Tokyo');
    // 16:00 UTC = 12:00 EDT / 01:00 JST (next day)
    expect(ny).toContain('12:00');
    expect(tokyo).toContain('01:00');
    expect(ny).not.toBe(tokyo);
  });

  it('falls back to UTC only when no zone is stored', () => {
    expect(formatTimestamp(iso, undefined)).toContain('04:00 PM'); // 16:00 UTC
  });

  it('renders time-of-day in the explicit zone', () => {
    expect(formatTimeOfDay(iso, 'America/New_York')).toBe('12:00 PM');
    expect(formatTimeOfDay(iso, 'Pacific/Auckland')).toBe('04:00 AM');
  });

  it("respects the user's zone for 'today'", () => {
    const now = new Date('2026-07-05T01:00:00.000Z'); // still 2026-07-04 in New York
    expect(getUserToday('America/New_York', now)).toBe('2026-07-04');
    expect(getUserToday('Asia/Tokyo', now)).toBe('2026-07-05');
    expect(getUserToday(undefined, now)).toBe('2026-07-05'); // UTC fallback
  });
});

describe('zoned local time → UTC instant', () => {
  it('converts local wall time with DST awareness', () => {
    // 09:30 New York on 2026-01-15 (EST, UTC-5) → 14:30Z
    expect(zonedDateTimeToUtc('2026-01-15', '09:30', 'America/New_York')).toBe(
      '2026-01-15T14:30:00.000Z'
    );
    // 09:30 New York on 2026-07-15 (EDT, UTC-4) → 13:30Z
    expect(zonedDateTimeToUtc('2026-07-15', '09:30', 'America/New_York')).toBe(
      '2026-07-15T13:30:00.000Z'
    );
  });

  it('rejects impossible local times (spring-forward gap)', () => {
    // 02:30 on 2026-03-08 does not exist in New York.
    expect(zonedDateTimeToUtc('2026-03-08', '02:30', 'America/New_York')).toBeNull();
  });
});

describe('ambiguous local times (fall-back) resolve to an existing instant', () => {
  it('picks a real instant for repeated wall-clock times', () => {
    // 01:30 occurs twice on 2026-11-01 in New York; either instant is valid.
    const result = zonedDateTimeToUtc('2026-11-01', '01:30', 'America/New_York');
    expect(result).not.toBeNull();
    const roundTrip = timestampToZonedParts(result as string, 'America/New_York');
    expect(`${roundTrip.date} ${roundTrip.time}`).toBe('2026-11-01 01:30');
  });
});
