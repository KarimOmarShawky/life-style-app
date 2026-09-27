/**
 * src/features/habits/streaks-engine.ts
 *
 * Implements Section 1.4.6, FR-HAB-05, FR-HAB-06 & AC-HAB-02:
 * Pure deterministic Streak & Progress Calculation Engine.
 */

export interface HabitScheduleRule {
  freq: 'daily' | 'weekly';
  interval?: number | undefined;
  byWeekday?: number[] | null | undefined; // 1 (Mon) .. 7 (Sun)
  startDate: string; // YYYY-MM-DD
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

/**
 * Returns all calendar dates on which the habit is scheduled,
 * strictly between startDate and userToday (inclusive).
 */
export function getScheduledDates(rule: HabitScheduleRule, userToday: string): string[] {
  if (rule.startDate > userToday) {
    return [];
  }

  const startDt = parseDateOnly(rule.startDate);
  const todayDt = parseDateOnly(userToday);
  const interval = Math.max(1, rule.interval ?? 1);
  const scheduled: string[] = [];

  if (rule.freq === 'daily') {
    let current = new Date(startDt.getTime());
    while (current <= todayDt) {
      scheduled.push(formatDateOnly(current));
      current = new Date(current.getTime() + interval * 24 * 60 * 60 * 1000);
    }
  } else if (rule.freq === 'weekly') {
    const weekdays =
      rule.byWeekday && rule.byWeekday.length > 0
        ? [...rule.byWeekday].sort((a, b) => a - b)
        : [getIsoWeekday(startDt)];

    const startIsoDay = getIsoWeekday(startDt);
    const startWeekMonday = new Date(startDt.getTime() - (startIsoDay - 1) * 24 * 60 * 60 * 1000);

    let currentWeekMonday = new Date(startWeekMonday.getTime());

    while (currentWeekMonday <= todayDt) {
      for (const targetDay of weekdays) {
        const occDate = new Date(
          currentWeekMonday.getTime() + (targetDay - 1) * 24 * 60 * 60 * 1000
        );
        if (occDate >= startDt && occDate <= todayDt) {
          scheduled.push(formatDateOnly(occDate));
        }
      }
      currentWeekMonday = new Date(
        currentWeekMonday.getTime() + interval * 7 * 24 * 60 * 60 * 1000
      );
    }
  }

  return [...new Set(scheduled)].sort();
}

/**
 * Determines whether a given date is a scheduled date for the habit.
 */
export function isScheduledDate(rule: HabitScheduleRule, dateStr: string): boolean {
  if (dateStr < rule.startDate) return false;

  const dt = parseDateOnly(dateStr);
  const startDt = parseDateOnly(rule.startDate);
  const interval = Math.max(1, rule.interval ?? 1);

  if (rule.freq === 'daily') {
    const diffDays = Math.round((dt.getTime() - startDt.getTime()) / (24 * 60 * 60 * 1000));
    return diffDays >= 0 && diffDays % interval === 0;
  }

  if (rule.freq === 'weekly') {
    const weekdays =
      rule.byWeekday && rule.byWeekday.length > 0 ? rule.byWeekday : [getIsoWeekday(startDt)];

    const isoDay = getIsoWeekday(dt);
    if (!weekdays.includes(isoDay)) return false;

    if (interval === 1) return true;

    // Check week interval step
    const startIsoDay = getIsoWeekday(startDt);
    const startWeekMonday = new Date(startDt.getTime() - (startIsoDay - 1) * 24 * 60 * 60 * 1000);
    const dateWeekMonday = new Date(dt.getTime() - (isoDay - 1) * 24 * 60 * 60 * 1000);
    const diffWeeks = Math.round(
      (dateWeekMonday.getTime() - startWeekMonday.getTime()) / (7 * 24 * 60 * 60 * 1000)
    );
    return diffWeeks >= 0 && diffWeeks % interval === 0;
  }

  return false;
}

export interface StreaksResult {
  currentStreak: number;
  longestStreak: number;
}

/**
 * Pure function computing currentStreak and longestStreak per FR-HAB-05 & AC-HAB-02.
 *
 * Rules:
 * - Current streak: number of consecutive scheduled dates, counting back from the latest scheduled date <= today, that are done.
 * - Skipped dates: neutral (neither extends nor breaks streak).
 * - Missed dates (past scheduled date with no check-in): breaks the streak.
 * - Today's scheduled date: if pending (no checkin), does NOT break streak.
 * - Longest streak: max consecutive done scheduled dates over the habit's whole history.
 */
export function computeStreaks(
  scheduledDates: string[],
  checkinsMap: Map<string, 'done' | 'skipped'>,
  userToday: string
): StreaksResult {
  if (scheduledDates.length === 0) {
    return { currentStreak: 0, longestStreak: 0 };
  }

  // 1. Compute Longest Streak (Chronological traversal)
  let longestStreak = 0;
  let runningStreak = 0;

  for (const date of scheduledDates) {
    const checkin = checkinsMap.get(date);

    if (checkin === 'done') {
      runningStreak++;
      if (runningStreak > longestStreak) {
        longestStreak = runningStreak;
      }
    } else if (checkin === 'skipped') {
      // Neutral: maintains running streak without incrementing
    } else {
      // Missing checkin
      if (date === userToday) {
        // Today pending does not break streak
      } else {
        // Past missing date breaks streak
        runningStreak = 0;
      }
    }
  }

  // 2. Compute Current Streak (Reverse chronological traversal from latest scheduled date <= today)
  let currentStreak = 0;

  for (let i = scheduledDates.length - 1; i >= 0; i--) {
    const date = scheduledDates[i]!;
    const checkin = checkinsMap.get(date);

    if (date === userToday && !checkin) {
      // Today is pending: does not break streak, inspect previous scheduled dates
      continue;
    }

    if (checkin === 'done') {
      currentStreak++;
    } else if (checkin === 'skipped') {
      // Neutral: continue counting back
      continue;
    } else {
      // Missed past scheduled date: streak is broken
      break;
    }
  }

  return {
    currentStreak,
    longestStreak
  };
}

export interface DailyHabitStatus {
  habitId: string;
  isScheduledToday: boolean;
  checkinStatus?: 'done' | 'skipped' | null | undefined;
}

export interface TodayProgressResult {
  totalScheduled: number;
  done: number;
  skipped: number;
  percent: number; // 0..100
}

/**
 * FR-HAB-06: Habit progress today = done ÷ (scheduled today − skipped today).
 */
export function computeTodayProgress(habits: DailyHabitStatus[]): TodayProgressResult {
  let totalScheduled = 0;
  let done = 0;
  let skipped = 0;

  for (const h of habits) {
    if (h.isScheduledToday) {
      totalScheduled++;
      if (h.checkinStatus === 'done') {
        done++;
      } else if (h.checkinStatus === 'skipped') {
        skipped++;
      }
    }
  }

  const denominator = totalScheduled - skipped;
  let percent = 0;
  if (denominator > 0) {
    percent = Math.round((done / denominator) * 100);
  } else if (totalScheduled > 0 && done === 0 && skipped === totalScheduled) {
    // If all scheduled habits are skipped, 100% of non-skipped target is satisfied
    percent = 100;
  }

  return {
    totalScheduled,
    done,
    skipped,
    percent
  };
}
