/**
 * src/features/dashboard/dashboard.types.ts
 *
 * Implements Section 14 (P1-05): Dashboard overview aggregation built from
 * read-only Reader interfaces.
 */

export interface DashboardOverview {
  date: string;
  timezone: string;
  tasks: {
    dueToday: number;
    doneToday: number;
    overdue: number;
  };
  habits: {
    dueToday: number;
    completedToday: number;
  };
  eventsToday: number;
  subscriptionsDueNext7Days: {
    count: number;
    totalMinorByCurrency: Record<string, number>;
  };
  activeSubscriptions: number;
  activeTimer: { id: string; taskId: string | null; startedAt: string } | null;
}
