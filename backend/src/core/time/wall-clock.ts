/**
 * src/core/time/wall-clock.ts
 *
 * Wall-clock arithmetic in IANA time zones with the platform Intl API (no date
 * library). Shared by the notification policy (ADR-046) and
 * `zonedDateTimeToUtc` (G2-F1) so both resolve daylight-saving changes the same
 * way:
 * - a local time inside a spring-forward gap moves forward by the gap length;
 * - a local time that occurs twice (fall back) has two instants, earliest first.
 * Callers pass zones through `resolveTimeZone`, which maps unknown zones to UTC.
 */

export interface WallClock {
  year: number;
  month: number;
  day: number;
  minuteOfDay: number;
  second: number;
}

const DAY_MS = 86_400_000;

/** Instants (ascending) whose wall clock in `zone` reads the given local date and minute. */
export function instantsForWallClock(
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
export function offsetAt(instantMs: number, zone: string): number {
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

export function resolveTimeZone(zone: string): string {
  try {
    formatterFor(zone);
    return zone;
  } catch {
    return 'UTC';
  }
}

export function wallClockOf(instantMs: number, zone: string): WallClock {
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
