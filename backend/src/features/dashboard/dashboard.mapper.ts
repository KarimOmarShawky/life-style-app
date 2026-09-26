/**
 * One database row to the home summary.
 *
 * The lists arrive already in their published shape: `jsonb_build_object` in the
 * query names each field in the spelling the client receives, so there is one
 * definition of each of them rather than a SQL one and a TypeScript one that can
 * disagree. What is left here is the nesting, and the pairing of every list with
 * the count that says how much it left out.
 */
import type { DashboardRow } from './dashboard.repository';
import type { DashboardResponse } from './dashboard.types';

export function toDashboardResponse(day: string, row: DashboardRow): DashboardResponse {
  return {
    date: day,
    tasks: {
      overdue: row.overdue,
      dueToday: row.due_today,
      completedToday: row.completed_today,
      items: row.open_tasks,
    },
    habits: {
      tracked: row.habits_tracked,
      completed: row.habits_completed,
      items: row.pending_habits,
    },
    events: {
      today: row.events_today,
      items: row.event_items,
    },
    reminders: {
      due: row.reminders_due,
      items: row.reminder_items,
    },
    money: {
      spending: row.spending,
      budgetsOverLimit: row.budgets_over_limit,
    },
    goals: {
      active: row.goals_active,
      dueSoon: row.goals_due_soon,
    },
  };
}
