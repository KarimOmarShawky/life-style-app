/**
 * Date & time utilities.
 *
 * Rules enforced:
 * - Date-only values (YYYY-MM-DD) are calendar dates. They are never parsed
 *   as UTC timestamps or shifted across time zones: formatting always anchors
 *   to UTC so the printed day is exactly the stored day.
 * - Absolute timestamps are formatted in the user's *stored* time zone
 *   (profile.timezone) via Intl.DateTimeFormat with an explicit `timeZone` —
 *   never the machine's local zone.
 * - Business-date logic ("today") is computed for the user's stored zone.
 */

const DATE_ONLY_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

const DAY_MS = 24 * 60 * 60 * 1000;

function isValidDateParts(year: number, month: number, day: number): boolean {
  const dt = new Date(Date.UTC(year, month - 1, day));
  return dt.getUTCFullYear() === year && dt.getUTCMonth() === month - 1 && dt.getUTCDate() === day;
}

function dateOnlyToUtcDate(value: string): Date | null {
  const match = DATE_ONLY_RE.exec(value);
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (!isValidDateParts(year, month, day)) return null;
  return new Date(Date.UTC(year, month - 1, day));
}

/** `true` for a well-formed YYYY-MM-DD calendar date. */
export function isDateOnly(value: string): boolean {
  return dateOnlyToUtcDate(value) !== null;
}

/**
 * Format a date-only value for display. Anchored to UTC so the calendar day
 * never shifts regardless of the machine's local time zone.
 */
export function formatDateOnly(value: string, locale = 'en'): string {
  const date = dateOnlyToUtcDate(value);
  if (!date) return value;
  return new Intl.DateTimeFormat(locale, {
    timeZone: 'UTC',
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    year: 'numeric'
  }).format(date);
}

/** Compact date-only formatting (e.g. `Sep 28`). */
export function formatDateOnlyShort(value: string, locale = 'en'): string {
  const date = dateOnlyToUtcDate(value);
  if (!date) return value;
  return new Intl.DateTimeFormat(locale, {
    timeZone: 'UTC',
    month: 'short',
    day: 'numeric'
  }).format(date);
}

/** Weekday name of a date-only value (UTC-anchored). */
export function formatWeekday(value: string, locale = 'en'): string {
  const date = dateOnlyToUtcDate(value);
  if (!date) return '';
  return new Intl.DateTimeFormat(locale, { timeZone: 'UTC', weekday: 'short' }).format(date);
}

/** ISO week ordinal (1..7) for a date-only value (UTC-anchored). */
export function isoWeekday(value: string): number | null {
  const date = dateOnlyToUtcDate(value);
  if (!date) return null;
  return date.getUTCDay() === 0 ? 7 : date.getUTCDay();
}

/**
 * Format an absolute timestamp in an explicit time zone (the user's stored
 * zone). Falls back to UTC when no zone is provided.
 */
export function formatTimestamp(
  isoTimestamp: string,
  timeZone: string | undefined,
  locale = 'en'
): string {
  const date = new Date(isoTimestamp);
  if (Number.isNaN(date.getTime())) return isoTimestamp;
  return new Intl.DateTimeFormat(locale, {
    timeZone: timeZone || 'UTC',
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit'
  }).format(date);
}

/** Time-only portion (HH:mm) of a timestamp in an explicit zone. */
export function formatTimeOfDay(
  isoTimestamp: string,
  timeZone: string | undefined,
  locale = 'en'
): string {
  const date = new Date(isoTimestamp);
  if (Number.isNaN(date.getTime())) return '';
  return new Intl.DateTimeFormat(locale, {
    timeZone: timeZone || 'UTC',
    hour: '2-digit',
    minute: '2-digit'
  }).format(date);
}

/** Validate an HH:mm time string. */
export function isTimeOnly(value: string): boolean {
  return /^([01]\d|2[0-3]):[0-5]\d$/.test(value);
}

/**
 * The user's "today" as a calendar date in their stored time zone.
 */
export function getUserToday(timeZone: string | undefined, now: Date = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: timeZone || 'UTC',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).format(now);
}

/** Add (or subtract) whole days to a date-only value — pure calendar math. */
export function addDays(value: string, days: number): string {
  const date = dateOnlyToUtcDate(value);
  if (!date) return value;
  const next = new Date(date.getTime() + days * DAY_MS);
  const year = String(next.getUTCFullYear()).padStart(4, '0');
  const month = String(next.getUTCMonth() + 1).padStart(2, '0');
  const day = String(next.getUTCDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

/** Today's calendar date anchored at UTC — used for `<input type="date">` defaults in tests. */
export function utcToday(now: Date = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'UTC',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).format(now);
}

/** Offset (ms) of `timeZone` from UTC at a given instant. */
function timeZoneOffsetMs(utcMs: number, timeZone: string): number {
  const dtf = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hour12: false,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit'
  });
  const parts = dtf.formatToParts(new Date(utcMs));
  const get = (type: Intl.DateTimeFormatPartTypes): number =>
    Number(parts.find((part) => part.type === type)?.value ?? '0');
  const hour = get('hour') % 24;
  const asUtc = Date.UTC(
    get('year'),
    get('month') - 1,
    get('day'),
    hour,
    get('minute'),
    get('second')
  );
  return asUtc - utcMs;
}

/**
 * Convert a wall-clock date+time expressed in `timeZone` to a UTC ISO
 * instant (the format the calendar API expects). Two-pass offset resolution
 * handles DST boundaries.
 */
export function zonedDateTimeToUtc(date: string, time: string, timeZone: string): string | null {
  if (!isDateOnly(date) || !isTimeOnly(time)) return null;
  const zone = timeZone || 'UTC';
  const naiveMs = Date.parse(`${date} ${time}:00`.replace(' ', 'T') + '.000Z');
  if (Number.isNaN(naiveMs)) return null;
  let offset = timeZoneOffsetMs(naiveMs, zone);
  let utcMs = naiveMs - offset;
  offset = timeZoneOffsetMs(utcMs, zone);
  utcMs = naiveMs - offset;
  // Round-trip check: if the computed instant does not render back to the
  // requested wall-clock time, the local time does not exist in this zone
  // (DST spring-forward gap) — reject instead of silently shifting it.
  const roundTrip = timestampToZonedParts(new Date(utcMs).toISOString(), zone);
  if (roundTrip.date !== date || roundTrip.time !== time) return null;
  return new Date(utcMs).toISOString();
}

/** Split an absolute timestamp into calendar date + HH:mm in a stored zone. */
export function timestampToZonedParts(
  isoTimestamp: string,
  timeZone: string | undefined
): { date: string; time: string } {
  const zone = timeZone || 'UTC';
  const date = new Date(isoTimestamp);
  if (Number.isNaN(date.getTime())) return { date: '', time: '' };
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: zone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false
  }).formatToParts(date);
  const get = (type: Intl.DateTimeFormatPartTypes): string =>
    parts.find((part) => part.type === type)?.value ?? '';
  const hour = get('hour') === '24' ? '00' : get('hour');
  return {
    date: `${get('year')}-${get('month')}-${get('day')}`,
    time: `${hour}:${get('minute')}`
  };
}

/** Human label for a duration in seconds (e.g. `1:05:09` / `5:09`). */
export function formatDuration(totalSeconds: number): string {
  const seconds = Math.max(0, Math.floor(totalSeconds));
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const rest = seconds % 60;
  const mm = String(minutes).padStart(2, '0');
  const ss = String(rest).padStart(2, '0');
  return hours > 0 ? `${hours}:${mm}:${ss}` : `${minutes}:${ss}`;
}
