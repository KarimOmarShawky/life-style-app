/**
 * src/core/validation/date-only.ts
 *
 * One shared, semantic calendar-day validator (V-09).
 *
 * The API stores date-only values as `YYYY-MM-DD` strings. Shape-only regex
 * checks accept impossible days such as `2026-02-30` or `2026-13-01`, which
 * then reach date arithmetic and PostgreSQL and surface as feature-specific
 * 500s instead of a uniform validation error. The canonical `/day/{date}`
 * endpoint already validated the real calendar day; this module generalises
 * the same rule so create, update, query and payment paths behave alike.
 *
 * The check is timezone-independent: it validates the calendar day itself in
 * UTC and requires an exact round-trip of the formatted value, so `2024-02-29`
 * is accepted, `2023-02-29` is rejected, and no local-time shift can move a
 * day across a month or year boundary.
 */

import { z } from 'zod';

const DATE_ONLY_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;

/** True when `value` is an exact `YYYY-MM-DD` string naming a real calendar day. */
export function isValidCalendarDate(value: unknown): value is string {
  if (typeof value !== 'string') return false;
  const match = DATE_ONLY_PATTERN.exec(value);
  if (!match) return false;

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (month < 1 || month > 12 || day < 1 || day > 31) return false;

  // Date.UTC() maps years 0..99 to 1900..1999, so build the date explicitly.
  const date = new Date(0);
  date.setUTCFullYear(year, month - 1, day);
  date.setUTCHours(0, 0, 0, 0);

  // Round-trip: a rolled-over day (e.g. 2026-02-30 -> 2026-03-02) does not match.
  return (
    date.getUTCFullYear() === year &&
    date.getUTCMonth() === month - 1 &&
    date.getUTCDate() === day
  );
}

/** Uniform message, so every feature reports an impossible day the same way. */
export const INVALID_DATE_ONLY_MESSAGE = 'Date must be a real calendar date (YYYY-MM-DD)';

/** Shared schema for a required date-only value. */
export const calendarDaySchema = z
  .string()
  .trim()
  .refine(isValidCalendarDate, { message: INVALID_DATE_ONLY_MESSAGE });

/**
 * Same rule, with the field name in the message so client errors stay
 * actionable. Returns a fresh schema per call, so callers never share a
 * modified instance.
 */
export function calendarDaySchemaFor(field: string) {
  return z
    .string()
    .trim()
    .refine(isValidCalendarDate, {
      message: `${field} must be a real calendar date (YYYY-MM-DD)`
    });
}

/** Returns true when `from` <= `to`; both must already be valid calendar days. */
export function isOrderedDateRange(from: string, to: string): boolean {
  return from <= to;
}
