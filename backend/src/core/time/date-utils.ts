/**
 * src/core/time/date-utils.ts
 *
 * Implements Section 7.2: Timezone-aware date calculations and pure date manipulations.
 */

export function getUserTodayDate(timezone = 'UTC', date: Date = new Date()): string {
  try {
    const formatter = new Intl.DateTimeFormat('en-CA', {
      timeZone: timezone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit'
    });
    return formatter.format(date);
  } catch {
    return date.toISOString().slice(0, 10);
  }
}

export function addDaysToDateString(dateStr: string, days: number): string {
  const parts = dateStr.split('-').map(Number);
  const y = parts[0] ?? 2026;
  const m = parts[1] ?? 1;
  const d = parts[2] ?? 1;
  const dt = new Date(Date.UTC(y, m - 1, d));
  dt.setUTCDate(dt.getUTCDate() + days);
  return dt.toISOString().slice(0, 10);
}

export function compareDateStrings(a: string, b: string): number {
  return a.localeCompare(b);
}

export function getDayBoundsUtc(
  dateStr: string,
  timeZone = 'UTC'
): { startOfDayUtc: Date; endOfDayUtc: Date } {
  try {
    const parts = dateStr.split('-').map(Number);
    const year = parts[0] ?? 2026;
    const month = parts[1] ?? 1;
    const day = parts[2] ?? 1;

    const baseUtc = new Date(Date.UTC(year, month - 1, day, 12, 0, 0));

    const formatter = new Intl.DateTimeFormat('en-US', {
      timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: false
    });

    const formattedParts = formatter.formatToParts(baseUtc);
    const map: Record<string, string> = {};
    for (const p of formattedParts) {
      map[p.type] = p.value;
    }

    const targetYear = Number(map.year ?? year);
    const targetMonth = Number(map.month ?? month);
    const targetDay = Number(map.day ?? day);
    const rawHour = Number(map.hour ?? 12);
    const targetHour = rawHour === 24 ? 0 : rawHour;
    const targetMinute = Number(map.minute ?? 0);

    const targetTimeAsUtc = Date.UTC(
      targetYear,
      targetMonth - 1,
      targetDay,
      targetHour,
      targetMinute
    );
    const offsetMs = targetTimeAsUtc - baseUtc.getTime();

    const startOfDayUtc = new Date(Date.UTC(year, month - 1, day, 0, 0, 0) - offsetMs);
    const endOfDayUtc = new Date(Date.UTC(year, month - 1, day, 23, 59, 59, 999) - offsetMs);

    return { startOfDayUtc, endOfDayUtc };
  } catch {
    const parts = dateStr.split('-').map(Number);
    const year = parts[0] ?? 2026;
    const month = parts[1] ?? 1;
    const day = parts[2] ?? 1;
    return {
      startOfDayUtc: new Date(Date.UTC(year, month - 1, day, 0, 0, 0)),
      endOfDayUtc: new Date(Date.UTC(year, month - 1, day, 23, 59, 59, 999))
    };
  }
}

/**
 * Formats a PostgreSQL DATE value (returned by node-postgres as a local-midnight
 * Date) or a date string as YYYY-MM-DD.
 */
export function formatDateOnly(val: Date | string | null | undefined): string | null {
  if (!val) return null;
  if (val instanceof Date) {
    const y = val.getFullYear();
    const m = String(val.getMonth() + 1).padStart(2, '0');
    const d = String(val.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
  }
  return String(val).slice(0, 10);
}

/**
 * Converts a civil date and local wall-clock time in an IANA timezone into a
 * UTC instant. Used when relative reminders are anchored to a task's local
 * due date/time (specification §9.2 and §14.13).
 */
export function zonedDateTimeToUtc(dateStr: string, timeStr = '00:00', timeZone = 'UTC'): Date {
  const parts = dateStr.split('-').map(Number);
  const clock = timeStr.split(':').map(Number);
  const year = parts[0] ?? 1970;
  const month = parts[1] ?? 1;
  const day = parts[2] ?? 1;
  const hour = clock[0] ?? 0;
  const minute = clock[1] ?? 0;
  const wallClockAsUtc = Date.UTC(year, month - 1, day, hour, minute, 0);
  const guess = new Date(wallClockAsUtc);

  try {
    const formatter = new Intl.DateTimeFormat('en-US', {
      timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: false
    });
    const map: Record<string, string> = {};
    for (const part of formatter.formatToParts(guess)) {
      map[part.type] = part.value;
    }
    const observedHour = Number(map.hour ?? hour);
    const observedAsUtc = Date.UTC(
      Number(map.year ?? year),
      Number(map.month ?? month) - 1,
      Number(map.day ?? day),
      observedHour === 24 ? 0 : observedHour,
      Number(map.minute ?? minute),
      Number(map.second ?? 0)
    );
    const offsetMs = observedAsUtc - guess.getTime();
    return new Date(wallClockAsUtc - offsetMs);
  } catch {
    return guess;
  }
}
