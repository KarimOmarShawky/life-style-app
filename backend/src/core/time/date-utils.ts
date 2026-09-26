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
