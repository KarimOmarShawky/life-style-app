/**
 * src/features/analytics/analytics.types.ts
 *
 * Real, range-based analytics aggregated from the user's own tasks, habit
 * check-ins, focus timer sessions, goals and (retained) subscriptions.
 * A metric that cannot be computed honestly is `null` (unavailable),
 * never a fabricated zero — the mobile client renders null as "No data".
 */

export const ANALYTICS_RANGES = [7, 30, 90, 365] as const;
export type AnalyticsRangeDays = (typeof ANALYTICS_RANGES)[number];

export interface AnalyticsSeriesPoint {
  /** YYYY-MM-DD bucket start (a day, or the first day of a 7-day bucket). */
  date: string;
  tasksCompleted: number;
  habitCheckins: number;
  focusMinutes: number;
}

export interface AnalyticsSummary {
  rangeDays: number;
  from: string;
  to: string;
  timezone: string;
  tasks: {
    completedInRange: number;
    createdInRange: number;
    pendingNow: number;
    overdueNow: number;
    /** completed / created in range; null when nothing was created. */
    completionRatePercent: number | null;
  };
  habits: {
    activeHabits: number;
    checkinsDoneInRange: number;
    /**
     * done / due across scheduled days. Only computed for ranges up to
     * 31 days (per-day recurrence evaluation); null for longer ranges.
     */
    consistencyPercent: number | null;
  };
  focus: {
    sessionsInRange: number;
    totalMinutes: number;
  };
  goals: {
    active: number;
    achievedTotal: number;
    achievedInRange: number;
    /** Mean capped progress of active numeric goals; null when none. */
    averageNumericProgressPercent: number | null;
  };
  subscriptions: {
    active: number;
    dueNext7Days: number;
  };
  series: AnalyticsSeriesPoint[];
}
