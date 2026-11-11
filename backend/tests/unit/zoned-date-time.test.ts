/**
 * tests/unit/zoned-date-time.test.ts
 *
 * G2-F1: `zonedDateTimeToUtc` must use the offset in force at the resulting
 * instant, not at the wall clock read as UTC. Expected values are worked out
 * from the 2026 rules:
 * - Africa/Cairo: 00:00 on Fri 24 Apr does not exist (clocks jump to 01:00);
 *   23:00-23:59 on Thu 29 Oct happens twice (24:00 EEST goes back to 23:00 EET).
 * - Europe/Berlin: 02:00-02:59 on Sun 29 Mar does not exist; 02:00-02:59 on
 *   Sun 25 Oct happens twice.
 * - America/New_York: 02:00-02:59 on Sun 8 Mar does not exist; 01:00-01:59 on
 *   Sun 1 Nov happens twice.
 * Rules shared with the notification policy (ADR-046): a time in a gap moves
 * forward by the gap, a repeated time resolves to its first occurrence.
 */

import { describe, expect, it } from 'vitest';
import { zonedDateTimeToUtc } from '../../src/core/time/date-utils.js';
import { localDayBounds } from '../../src/features/notifications/notification-policy.js';

const CASES: Array<{ zone: string; date: string; time: string; utc: string; note: string }> = [
  // Cairo
  {
    zone: 'Africa/Cairo',
    date: '2026-04-23',
    time: '23:30',
    utc: '2026-04-23T21:30:00.000Z',
    note: 'eve of the gap (EET)'
  },
  {
    zone: 'Africa/Cairo',
    date: '2026-04-24',
    time: '00:00',
    utc: '2026-04-23T22:00:00.000Z',
    note: 'midnight that does not exist -> 01:00 EEST'
  },
  {
    zone: 'Africa/Cairo',
    date: '2026-04-24',
    time: '00:30',
    utc: '2026-04-23T22:30:00.000Z',
    note: 'inside the gap -> 01:30 EEST'
  },
  {
    zone: 'Africa/Cairo',
    date: '2026-04-24',
    time: '01:30',
    utc: '2026-04-23T22:30:00.000Z',
    note: 'after the gap (EEST)'
  },
  {
    zone: 'Africa/Cairo',
    date: '2026-10-29',
    time: '22:30',
    utc: '2026-10-29T19:30:00.000Z',
    note: 'eve of fall back (EEST)'
  },
  {
    zone: 'Africa/Cairo',
    date: '2026-10-29',
    time: '23:30',
    utc: '2026-10-29T20:30:00.000Z',
    note: 'repeated hour -> first occurrence (EEST)'
  },
  {
    zone: 'Africa/Cairo',
    date: '2026-10-30',
    time: '00:00',
    utc: '2026-10-29T22:00:00.000Z',
    note: 'midnight after fall back (EET)'
  },
  {
    zone: 'Africa/Cairo',
    date: '2026-11-11',
    time: '09:00',
    utc: '2026-11-11T07:00:00.000Z',
    note: 'ordinary winter day'
  },
  {
    zone: 'Africa/Cairo',
    date: '2026-07-15',
    time: '09:00',
    utc: '2026-07-15T06:00:00.000Z',
    note: 'ordinary summer day'
  },
  // Berlin
  {
    zone: 'Europe/Berlin',
    date: '2026-03-29',
    time: '00:00',
    utc: '2026-03-28T23:00:00.000Z',
    note: 'midnight before the gap (CET)'
  },
  {
    zone: 'Europe/Berlin',
    date: '2026-03-29',
    time: '01:30',
    utc: '2026-03-29T00:30:00.000Z',
    note: 'just before the gap (CET)'
  },
  {
    zone: 'Europe/Berlin',
    date: '2026-03-29',
    time: '02:30',
    utc: '2026-03-29T01:30:00.000Z',
    note: 'inside the gap -> 03:30 CEST'
  },
  {
    zone: 'Europe/Berlin',
    date: '2026-03-29',
    time: '03:30',
    utc: '2026-03-29T01:30:00.000Z',
    note: 'after the gap (CEST)'
  },
  {
    zone: 'Europe/Berlin',
    date: '2026-10-25',
    time: '01:30',
    utc: '2026-10-24T23:30:00.000Z',
    note: 'before the repeated hour (CEST)'
  },
  {
    zone: 'Europe/Berlin',
    date: '2026-10-25',
    time: '02:30',
    utc: '2026-10-25T00:30:00.000Z',
    note: 'repeated hour -> first occurrence (CEST)'
  },
  {
    zone: 'Europe/Berlin',
    date: '2026-10-25',
    time: '03:30',
    utc: '2026-10-25T02:30:00.000Z',
    note: 'after fall back (CET)'
  },
  // New York
  {
    zone: 'America/New_York',
    date: '2026-03-07',
    time: '22:30',
    utc: '2026-03-08T03:30:00.000Z',
    note: 'eve of the gap (EST)'
  },
  {
    zone: 'America/New_York',
    date: '2026-03-08',
    time: '01:30',
    utc: '2026-03-08T06:30:00.000Z',
    note: 'just before the gap (EST)'
  },
  {
    zone: 'America/New_York',
    date: '2026-03-08',
    time: '02:30',
    utc: '2026-03-08T07:30:00.000Z',
    note: 'inside the gap -> 03:30 EDT'
  },
  {
    zone: 'America/New_York',
    date: '2026-03-08',
    time: '03:30',
    utc: '2026-03-08T07:30:00.000Z',
    note: 'after the gap (EDT)'
  },
  {
    zone: 'America/New_York',
    date: '2026-11-01',
    time: '00:00',
    utc: '2026-11-01T04:00:00.000Z',
    note: 'midnight before fall back (EDT)'
  },
  {
    zone: 'America/New_York',
    date: '2026-11-01',
    time: '01:30',
    utc: '2026-11-01T05:30:00.000Z',
    note: 'repeated hour -> first occurrence (EDT)'
  },
  {
    zone: 'America/New_York',
    date: '2026-11-01',
    time: '02:30',
    utc: '2026-11-01T07:30:00.000Z',
    note: 'after fall back (EST)'
  }
];

/** Local days around each 2026 transition, per zone. */
const TRANSITION_DAYS: Array<{ zone: string; dates: string[] }> = [
  { zone: 'Africa/Cairo', dates: ['2026-04-23', '2026-04-24', '2026-10-29', '2026-10-30'] },
  { zone: 'Europe/Berlin', dates: ['2026-03-28', '2026-03-29', '2026-10-25', '2026-10-26'] },
  { zone: 'America/New_York', dates: ['2026-03-07', '2026-03-08', '2026-11-01', '2026-11-02'] }
];

function wallClock(at: Date, zone: string): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: zone,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit'
  }).formatToParts(at);
  const read = (type: Intl.DateTimeFormatPartTypes): string =>
    parts.find((part) => part.type === type)?.value ?? '';
  const hour = String(Number(read('hour')) % 24).padStart(2, '0');
  return `${read('year')}-${read('month')}-${read('day')} ${hour}:${read('minute')}`;
}

describe('zonedDateTimeToUtc (G2-F1)', () => {
  it.each(CASES)('$zone $date $time -> $utc ($note)', ({ zone, date, time, utc }) => {
    expect(zonedDateTimeToUtc(date, time, zone).toISOString()).toBe(utc);
  });

  it('round-trips every half hour on transition days; only gap times move, by one hour', () => {
    const moved: string[] = [];
    for (const { zone, dates } of TRANSITION_DAYS) {
      for (const date of dates) {
        for (let minute = 0; minute < 24 * 60; minute += 30) {
          const hh = String(Math.floor(minute / 60)).padStart(2, '0');
          const mm = String(minute % 60).padStart(2, '0');
          const observed = wallClock(zonedDateTimeToUtc(date, `${hh}:${mm}`, zone), zone);
          if (observed === `${date} ${hh}:${mm}`) continue;
          const oneHourLater = new Date(Date.parse(`${date}T${hh}:${mm}:00Z`) + 3_600_000)
            .toISOString()
            .slice(0, 16)
            .replace('T', ' ');
          expect(observed).toBe(oneHourLater);
          moved.push(`${zone} ${date} ${hh}:${mm}`);
        }
      }
    }
    expect(moved).toEqual([
      'Africa/Cairo 2026-04-24 00:00',
      'Africa/Cairo 2026-04-24 00:30',
      'Europe/Berlin 2026-03-29 02:00',
      'Europe/Berlin 2026-03-29 02:30',
      'America/New_York 2026-03-08 02:00',
      'America/New_York 2026-03-08 02:30'
    ]);
  });

  it('agrees with the notification policy on local midnights', () => {
    for (const { zone, dates } of TRANSITION_DAYS) {
      for (const date of dates) {
        expect(zonedDateTimeToUtc(date, '00:00', zone).toISOString()).toBe(
          localDayBounds(date, zone).start.toISOString()
        );
      }
    }
  });

  it('keeps the existing contract for defaults, seconds, unknown zones and malformed input', () => {
    expect(zonedDateTimeToUtc('2026-11-11').toISOString()).toBe('2026-11-11T00:00:00.000Z');
    expect(zonedDateTimeToUtc('2026-11-11', '09:00:00', 'Africa/Cairo').toISOString()).toBe(
      '2026-11-11T07:00:00.000Z'
    );
    expect(zonedDateTimeToUtc('2026-11-11', '09:00', 'Mars/Olympus_Mons').toISOString()).toBe(
      '2026-11-11T09:00:00.000Z'
    );
    expect(Number.isNaN(zonedDateTimeToUtc('not-a-date', '09:00', 'Africa/Cairo').getTime())).toBe(
      true
    );
  });
});
