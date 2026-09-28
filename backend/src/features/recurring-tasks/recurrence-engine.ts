/**
 * src/features/recurring-tasks/recurrence-engine.ts
 *
 * Implements Section 1.4.5 & 6.4: Recurrence Calculation Engine.
 * Pure deterministic date math for generating schedule instances.
 */

export interface RecurrenceRule {
  freq: 'daily' | 'weekly' | 'monthly' | 'yearly';
  interval: number;
  byWeekday?: number[] | null | undefined; // 1 (Mon) .. 7 (Sun)
  byMonthDay?: number | null | undefined; // 1 .. 31 or -1
  byMonth?: number | null | undefined; // 1 .. 12
  startDate: string; // YYYY-MM-DD
  endDate?: string | null | undefined; // YYYY-MM-DD
  occurrenceLimit?: number | null | undefined;
}

function parseDateOnly(dateStr: string): Date {
  const parts = dateStr.split('-').map(Number);
  const y = parts[0] ?? 2026;
  const m = parts[1] ?? 1;
  const d = parts[2] ?? 1;
  return new Date(Date.UTC(y, m - 1, d));
}

function formatDateOnly(dt: Date): string {
  return dt.toISOString().slice(0, 10);
}

function getIsoWeekday(dt: Date): number {
  const day = dt.getUTCDay();
  return day === 0 ? 7 : day;
}

function getLastDayOfMonth(year: number, month1Based: number): number {
  return new Date(Date.UTC(year, month1Based, 0)).getUTCDate();
}

/**
 * Computes all occurrence dates for a recurrence rule within the given window [windowStart, windowEnd].
 * Both windowStart and windowEnd are YYYY-MM-DD strings.
 */
export function computeOccurrences(
  rule: RecurrenceRule,
  windowStart: string,
  windowEnd: string
): string[] {
  const occurrences: string[] = [];
  const startDt = parseDateOnly(rule.startDate);
  const winStartDt = parseDateOnly(windowStart);
  const winEndDt = parseDateOnly(windowEnd);

  const endDt = rule.endDate ? parseDateOnly(rule.endDate) : null;
  const limit = rule.occurrenceLimit ?? Infinity;
  const interval = Math.max(1, rule.interval || 1);

  if (startDt > winEndDt && (!endDt || startDt <= endDt)) {
    return [];
  }

  let totalOccurrencesCount = 0;

  switch (rule.freq) {
    case 'daily': {
      let current = new Date(startDt.getTime());
      while (current <= winEndDt) {
        if (endDt && current > endDt) break;
        if (totalOccurrencesCount >= limit) break;

        const dateStr = formatDateOnly(current);
        if (current >= winStartDt) {
          occurrences.push(dateStr);
        }

        totalOccurrencesCount++;
        current = new Date(current.getTime() + interval * 24 * 60 * 60 * 1000);
      }
      break;
    }

    case 'weekly': {
      const weekdays =
        rule.byWeekday && rule.byWeekday.length > 0
          ? [...rule.byWeekday].sort((a, b) => a - b)
          : [getIsoWeekday(startDt)];

      // Find Monday of the startDt week
      const startIsoDay = getIsoWeekday(startDt);
      const startWeekMonday = new Date(startDt.getTime() - (startIsoDay - 1) * 24 * 60 * 60 * 1000);

      let currentWeekMonday = new Date(startWeekMonday.getTime());

      while (currentWeekMonday <= winEndDt) {
        if (endDt && currentWeekMonday > endDt) break;
        if (totalOccurrencesCount >= limit) break;

        for (const targetDay of weekdays) {
          const occDate = new Date(
            currentWeekMonday.getTime() + (targetDay - 1) * 24 * 60 * 60 * 1000
          );
          if (occDate < startDt) continue;
          if (endDt && occDate > endDt) break;
          if (totalOccurrencesCount >= limit) break;

          totalOccurrencesCount++;
          if (occDate >= winStartDt && occDate <= winEndDt) {
            occurrences.push(formatDateOnly(occDate));
          }
        }

        currentWeekMonday = new Date(
          currentWeekMonday.getTime() + interval * 7 * 24 * 60 * 60 * 1000
        );
      }
      break;
    }

    case 'monthly': {
      let year = startDt.getUTCFullYear();
      let month = startDt.getUTCMonth(); // 0-indexed

      while (true) {
        if (totalOccurrencesCount >= limit) break;

        const lastDay = getLastDayOfMonth(year, month + 1);
        let dayToUse: number;
        if (rule.byMonthDay === -1) {
          dayToUse = lastDay;
        } else if (rule.byMonthDay && rule.byMonthDay > 0) {
          dayToUse = Math.min(rule.byMonthDay, lastDay);
        } else {
          dayToUse = Math.min(startDt.getUTCDate(), lastDay);
        }

        const occDate = new Date(Date.UTC(year, month, dayToUse));
        if (occDate > winEndDt) break;
        if (endDt && occDate > endDt) break;

        if (occDate >= startDt) {
          totalOccurrencesCount++;
          if (occDate >= winStartDt && occDate <= winEndDt) {
            occurrences.push(formatDateOnly(occDate));
          }
        }

        // Advance by interval months
        month += interval;
        while (month >= 12) {
          year++;
          month -= 12;
        }
      }
      break;
    }

    case 'yearly': {
      let year = startDt.getUTCFullYear();
      const month = rule.byMonth ? rule.byMonth - 1 : startDt.getUTCMonth();

      while (true) {
        if (totalOccurrencesCount >= limit) break;

        const lastDay = getLastDayOfMonth(year, month + 1);
        let dayToUse: number;
        if (rule.byMonthDay === -1) {
          dayToUse = lastDay;
        } else if (rule.byMonthDay && rule.byMonthDay > 0) {
          dayToUse = Math.min(rule.byMonthDay, lastDay);
        } else {
          dayToUse = Math.min(startDt.getUTCDate(), lastDay);
        }

        const occDate = new Date(Date.UTC(year, month, dayToUse));
        if (occDate > winEndDt) break;
        if (endDt && occDate > endDt) break;

        if (occDate >= startDt) {
          totalOccurrencesCount++;
          if (occDate >= winStartDt && occDate <= winEndDt) {
            occurrences.push(formatDateOnly(occDate));
          }
        }

        year += interval;
      }
      break;
    }
  }

  return [...new Set(occurrences)].sort();
}
