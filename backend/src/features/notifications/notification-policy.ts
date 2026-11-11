/**
 * src/features/notifications/notification-policy.ts
 *
 * Feature guide G2 (ADR-046): one policy for device-scheduled (local) and push
 * notifications. Every notification gets exactly one outcome: allow, delay
 * (moved out of quiet hours), digest (joins that local day's single summary
 * notification) or drop.
 *
 * The Dart implementation (mobile-app/mobile/lib/data/notification_policy.dart)
 * must give the same answers. Both are tested against the shared cases in
 * mobile-app/mobile/test/fixtures/notification_policy_cases.json.
 *
 * Owner decisions (2026-11-11): quiet hours and the daily limit are off until
 * the user turns them on; critical notifications break quiet hours only when
 * the user allows it.
 *
 * Pure module: no I/O, no logging, and it never sees notification text.
 */

/** Critical: an alarm the user chose. Normal: task and calendar reminders. Low: nudges. */
export type NotificationTier = 'critical' | 'normal' | 'low';

export interface NotificationPreferences {
  /** Master switch. When off, every policy-managed notification is dropped. */
  notificationsEnabled: boolean;
  /** Start of quiet hours (inclusive), local minutes after midnight, or null when off. */
  quietStartMinute: number | null;
  /** End of quiet hours (exclusive), local minutes after midnight, or null when off. */
  quietEndMinute: number | null;
  /** Non-critical notifications per local day before the rest join the summary. */
  dailyCap: number | null;
  /** Low-priority notifications join the day's summary instead of arriving one by one. */
  digestEnabled: boolean;
  /** Critical notifications may arrive during quiet hours. */
  criticalBreaksQuiet: boolean;
}

export const DEFAULT_NOTIFICATION_PREFERENCES: Readonly<NotificationPreferences> = Object.freeze({
  notificationsEnabled: true,
  quietStartMinute: null,
  quietEndMinute: null,
  dailyCap: null,
  digestEnabled: false,
  criticalBreaksQuiet: false
});

/** Quiet hours suggested when the user turns them on (22:00-07:00). */
export const SUGGESTED_QUIET_START_MINUTE = 22 * 60;
export const SUGGESTED_QUIET_END_MINUTE = 7 * 60;

export type NotificationDecision =
  | { action: 'allow'; at: Date }
  | { action: 'delay'; at: Date }
  | { action: 'digest'; localDate: string }
  | { action: 'drop' };

export interface NotificationPolicyInput {
  tier: NotificationTier;
  /** Intended delivery instant. */
  at: Date;
  /** IANA time zone of the account (users.timezone). Unknown zones fall back to UTC. */
  timeZone: string;
  preferences: NotificationPreferences;
  /**
   * Non-critical notifications already allowed (or delayed) for a local day
   * (YYYY-MM-DD). The day's summary notification is not counted.
   */
  deliveredOn: (localDate: string) => number;
}

interface QuietWindow {
  start: number;
  end: number;
}

interface WallClock {
  year: number;
  month: number;
  day: number;
  minuteOfDay: number;
  second: number;
}

const DAY_MS = 86_400_000;
const MINUTES_PER_DAY = 24 * 60;

export function decideNotification(input: NotificationPolicyInput): NotificationDecision {
  const prefs = input.preferences;
  if (!prefs.notificationsEnabled) return { action: 'drop' };

  const zone = resolveTimeZone(input.timeZone);
  const quiet = quietWindowOf(prefs);
  const quietEnd =
    quiet !== null && isInQuietHours(input.at, zone, quiet)
      ? quietEndAfter(input.at, zone, quiet)
      : null;

  if (input.tier === 'critical') {
    if (quietEnd !== null && !prefs.criticalBreaksQuiet) {
      return { action: 'delay', at: quietEnd };
    }
    return { action: 'allow', at: input.at };
  }

  if (input.tier === 'low' && prefs.digestEnabled) {
    return { action: 'digest', localDate: localDateOf(input.at, zone) };
  }

  const deliverAt = quietEnd ?? input.at;
  const day = localDateOf(deliverAt, zone);
  if (prefs.dailyCap !== null && input.deliveredOn(day) >= prefs.dailyCap) {
    return { action: 'digest', localDate: day };
  }
  return quietEnd !== null ? { action: 'delay', at: quietEnd } : { action: 'allow', at: input.at };
}

/**
 * When a local day's summary notification should arrive: at its first item's
 * time, moved out of quiet hours. The summary is never limited.
 */
export function summaryDeliveryAt(
  firstItemAt: Date,
  timeZone: string,
  preferences: NotificationPreferences
): Date {
  const zone = resolveTimeZone(timeZone);
  const quiet = quietWindowOf(preferences);
  if (quiet === null || !isInQuietHours(firstItemAt, zone, quiet)) return firstItemAt;
  return quietEndAfter(firstItemAt, zone, quiet);
}

/** Parses "HH:MM" (24-hour, two digits each) into minutes after midnight. */
export function parseClockMinute(value: string): number | null {
  const match = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(value);
  if (!match) return null;
  return Number(match[1]) * 60 + Number(match[2]);
}

/** Formats minutes after midnight as "HH:MM". */
export function formatClockMinute(minute: number): string {
  const safe = ((Math.trunc(minute) % MINUTES_PER_DAY) + MINUTES_PER_DAY) % MINUTES_PER_DAY;
  const hours = String(Math.floor(safe / 60)).padStart(2, '0');
  const minutes = String(safe % 60).padStart(2, '0');
  return `${hours}:${minutes}`;
}

/** First instant of a local date and first instant of the next one, in the account time zone. */
export function localDayBounds(localDate: string, timeZone: string): { start: Date; end: Date } {
  const zone = resolveTimeZone(timeZone);
  const [year = 1970, month = 1, day = 1] = localDate.split('-').map(Number);
  const next = new Date(Date.UTC(year, month - 1, day + 1));
  const start =
    instantsForWallClock(year, month, day, 0, zone)[0] ?? Date.UTC(year, month - 1, day);
  const end =
    instantsForWallClock(
      next.getUTCFullYear(),
      next.getUTCMonth() + 1,
      next.getUTCDate(),
      0,
      zone
    )[0] ?? next.getTime();
  return { start: new Date(start), end: new Date(end) };
}

/** Local calendar date (YYYY-MM-DD) of an instant in the account time zone. */
export function localDateOf(at: Date, timeZone: string): string {
  const wall = wallClockOf(at.getTime(), resolveTimeZone(timeZone));
  const month = String(wall.month).padStart(2, '0');
  const day = String(wall.day).padStart(2, '0');
  return `${String(wall.year).padStart(4, '0')}-${month}-${day}`;
}

function quietWindowOf(prefs: NotificationPreferences): QuietWindow | null {
  const start = prefs.quietStartMinute;
  const end = prefs.quietEndMinute;
  if (start === null || end === null || start === end) return null;
  return { start, end };
}

function isInQuietHours(at: Date, zone: string, quiet: QuietWindow): boolean {
  const minute = wallClockOf(at.getTime(), zone).minuteOfDay;
  if (quiet.start < quiet.end) return minute >= quiet.start && minute < quiet.end;
  return minute >= quiet.start || minute < quiet.end;
}

/**
 * The first instant after `at` whose local wall clock reads the quiet end.
 * A quiet end inside a daylight-saving gap moves forward by the gap length;
 * a repeated hour yields both instants, and the first one after `at` wins.
 */
function quietEndAfter(at: Date, zone: string, quiet: QuietWindow): Date {
  const from = wallClockOf(at.getTime(), zone);
  for (let days = 0; days <= 2; days += 1) {
    const date = new Date(Date.UTC(from.year, from.month - 1, from.day + days));
    const candidates = instantsForWallClock(
      date.getUTCFullYear(),
      date.getUTCMonth() + 1,
      date.getUTCDate(),
      quiet.end,
      zone
    );
    const next = candidates.find((candidate) => candidate > at.getTime());
    if (next !== undefined) return new Date(next);
  }
  return at;
}

/** Instants (ascending) whose wall clock in `zone` reads the given local date and minute. */
function instantsForWallClock(
  year: number,
  month: number,
  day: number,
  minuteOfDay: number,
  zone: string
): number[] {
  const wall = Date.UTC(year, month - 1, day, 0, minuteOfDay);
  const offsetBefore = offsetAt(wall - DAY_MS, zone);
  const offsetAfter = offsetAt(wall + DAY_MS, zone);
  const valid = [...new Set([wall - offsetBefore, wall - offsetAfter])]
    .filter((candidate) => candidate + offsetAt(candidate, zone) === wall)
    .sort((a, b) => a - b);
  if (valid.length > 0) return valid;
  // Spring-forward gap: keep the earlier offset, which moves the time forward by the gap.
  return [wall - offsetBefore];
}

/** UTC offset of `zone` at an instant, in milliseconds (positive east of Greenwich). */
function offsetAt(instantMs: number, zone: string): number {
  const wall = wallClockOf(instantMs, zone);
  const wallAsUtc = Date.UTC(wall.year, wall.month - 1, wall.day, 0, wall.minuteOfDay, wall.second);
  return wallAsUtc - Math.floor(instantMs / 1000) * 1000;
}

const formatters = new Map<string, Intl.DateTimeFormat>();

function formatterFor(zone: string): Intl.DateTimeFormat {
  let formatter = formatters.get(zone);
  if (!formatter) {
    formatter = new Intl.DateTimeFormat('en-US', {
      timeZone: zone,
      hourCycle: 'h23',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit'
    });
    formatters.set(zone, formatter);
  }
  return formatter;
}

function resolveTimeZone(zone: string): string {
  try {
    formatterFor(zone);
    return zone;
  } catch {
    return 'UTC';
  }
}

function wallClockOf(instantMs: number, zone: string): WallClock {
  const parts = formatterFor(zone).formatToParts(new Date(instantMs));
  const read = (type: Intl.DateTimeFormatPartTypes): number =>
    Number(parts.find((part) => part.type === type)?.value ?? 0);
  // Some runtimes print midnight as hour 24 even with h23.
  const hour = read('hour') % 24;
  return {
    year: read('year'),
    month: read('month'),
    day: read('day'),
    minuteOfDay: hour * 60 + read('minute'),
    second: read('second')
  };
}
