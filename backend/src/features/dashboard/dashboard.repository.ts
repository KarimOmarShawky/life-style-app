/**
 * The home summary, as ONE statement.
 *
 * WHY ONE QUERY AND NOT SEVEN. The database is hosted in another region, so a
 * round trip costs far more than the work at either end. Seven queries run in
 * sequence would be seven latencies; seven run in parallel would be one latency
 * but seven pooled connections out of a default ten, so two concurrent dashboard
 * requests would starve the pool for everything else. One statement is one round
 * trip on one connection, and PostgreSQL is better at assembling this than
 * JavaScript is.
 *
 * It is long, but every CTE answers exactly one question and none of them
 * depends on another, so it reads as a list rather than as a chain. The habit
 * statistics query in `habit.repository` is built the same way.
 *
 * WHY THE JSON IS BUILT IN SQL. The alternative is seven result sets to stitch
 * together in the service. `jsonb_build_object` names every published field
 * explicitly, which is the same discipline a mapper applies, and the keys are
 * written in the shape the client receives so there is one spelling of each
 * field rather than two.
 *
 * Ownership is in every single predicate (DD-008). There is no join here that
 * reaches a row without a `user_id = $1` next to it.
 */
import { budgetExpenseMatch } from '@/features/money/budget.match';
import { PERIOD_INDEX } from '@/features/habits/habit.period';
import { entityTitleExpression } from '@/features/schedule/schedule.entities';
import { query } from '@/infrastructure/database/postgres/pool';

import type {
  DashboardEvent,
  DashboardHabit,
  DashboardReminder,
  DashboardSpending,
  DashboardTask,
} from './dashboard.types';

/**
 * How much of each list the summary carries.
 *
 * Interpolated rather than bound, because they are integers written here and
 * never anything a client sends. The counts beside each list are what tell the
 * user how much was left out.
 */
const TASK_LIMIT = 10;
const HABIT_LIMIT = 10;
const EVENT_LIMIT = 10;
const REMINDER_LIMIT = 5;

/**
 * A timestamp in the exact shape the rest of the API emits.
 *
 * PostgreSQL renders a `timestamptz` inside JSON as `2026-09-24T09:00:00+00:00`,
 * while `Date.toISOString()` — which every mapper in this application uses —
 * produces `2026-09-24T09:00:00.000Z`. Both are valid ISO 8601 and a client
 * parsing them gets the same instant, but a client comparing strings, or a test
 * asserting on one, would see two formats for one field. Formatting here keeps
 * the difference from ever reaching the contract.
 */
function isoInstant(expression: string): string {
  return `to_char(${expression} AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')`;
}

const REMINDER_ENTITY_TITLE = entityTitleExpression({
  alias: 'r',
  typeColumn: 'entity_type',
  idColumn: 'entity_id',
  types: ['task', 'habit', 'subscription', 'event'],
});

export interface DashboardRow {
  overdue: number;
  due_today: number;
  completed_today: number;
  open_tasks: DashboardTask[];
  habits_tracked: number;
  habits_completed: number;
  pending_habits: DashboardHabit[];
  events_today: number;
  event_items: DashboardEvent[];
  reminders_due: number;
  reminder_items: DashboardReminder[];
  spending: DashboardSpending[];
  budgets_over_limit: number;
  goals_active: number;
  goals_due_soon: number;
}

/*
 * $1 user
 * $2 today, as a calendar date        (habit periods, expense dates, goal dates)
 * $3 start of today, as an instant    (task, event and completion timestamps)
 * $4 start of tomorrow, as an instant (exclusive upper bound)
 * $5 first of this month
 * $6 first of next month
 * $7 the horizon for "a goal due soon"
 *
 * Dates and instants are separate parameters on purpose. `due_date` is a
 * TIMESTAMPTZ and `spent_on` is a DATE; comparing one against the other would
 * make PostgreSQL cast a date to an instant using the SESSION's timezone, so the
 * same query would answer differently depending on how the connection was
 * configured. Both bounds are computed once, in UTC, by the service.
 */
const DASHBOARD_QUERY = `
WITH task_counts AS (
  SELECT
    count(*) FILTER (
      WHERE t.status <> 'done' AND t.due_date IS NOT NULL AND t.due_date < $3::timestamptz
    )::int AS overdue,
    count(*) FILTER (
      WHERE t.status <> 'done'
        AND t.due_date >= $3::timestamptz AND t.due_date < $4::timestamptz
    )::int AS due_today,
    count(*) FILTER (
      WHERE t.status = 'done'
        AND t.completed_at >= $3::timestamptz AND t.completed_at < $4::timestamptz
    )::int AS completed_today
    FROM tasks t
   WHERE t.user_id = $1
),

-- Overdue and due-today together, soonest first: one list of "what is on you
-- now" rather than two the client has to merge.
open_tasks AS (
  SELECT jsonb_agg(
           jsonb_build_object(
             'id', x.id, 'title', x.title, 'priority', x.priority,
             'status', x.status, 'dueDate', ${isoInstant('x.due_date')},
             'isOverdue', x.is_overdue
           ) ORDER BY x.due_date ASC, x.id ASC
         ) AS items
    FROM (
      SELECT t.id, t.title, t.priority, t.status, t.due_date,
             (t.due_date < $3::timestamptz) AS is_overdue
        FROM tasks t
       WHERE t.user_id = $1
         AND t.status <> 'done'
         AND t.due_date IS NOT NULL
         AND t.due_date < $4::timestamptz
       ORDER BY t.due_date ASC, t.id ASC
       LIMIT ${TASK_LIMIT}
    ) x
),

-- "Done" means done for the period the habit is CURRENTLY in, which for a
-- weekly habit is anywhere this week. The rule is imported, not restated.
habit_rows AS (
  SELECT h.id, h.title, h.frequency, h.created_at,
         EXISTS (
           SELECT 1
             FROM habit_logs hl
            WHERE hl.habit_id = h.id
              -- Redundant against the schema, which gives every log the same
              -- owner as its habit, and kept anyway so the claim above holds
              -- literally: no join here reaches a row without an owner
              -- predicate beside it.
              AND hl.user_id = h.user_id
              AND hl.completed
              AND ${PERIOD_INDEX('hl.log_date', 'h.frequency')}
                = ${PERIOD_INDEX('$2::date', 'h.frequency')}
         ) AS is_done
    FROM habits h
   WHERE h.user_id = $1 AND NOT h.is_archived
),
habit_counts AS (
  SELECT count(*)::int AS tracked,
         count(*) FILTER (WHERE is_done)::int AS completed
    FROM habit_rows
),
pending_habits AS (
  SELECT jsonb_agg(
           jsonb_build_object('id', x.id, 'title', x.title, 'frequency', x.frequency)
           ORDER BY x.created_at ASC, x.id ASC
         ) AS items
    FROM (
      SELECT id, title, frequency, created_at
        FROM habit_rows
       WHERE NOT is_done
       ORDER BY created_at ASC, id ASC
       LIMIT ${HABIT_LIMIT}
    ) x
),

-- OVERLAP, not containment: an event already running when the day began is on
-- today's agenda. This is the same test the calendar window uses.
todays_events AS (
  SELECT e.id, e.title, e.start_time, e.end_time, e.all_day
    FROM events e
   WHERE e.user_id = $1
     AND e.end_time >= $3::timestamptz
     AND e.start_time < $4::timestamptz
),
event_counts AS (SELECT count(*)::int AS total FROM todays_events),
event_items AS (
  SELECT jsonb_agg(
           jsonb_build_object(
             'id', x.id, 'title', x.title,
             'startTime', ${isoInstant('x.start_time')},
             'endTime', ${isoInstant('x.end_time')},
             'allDay', x.all_day
           ) ORDER BY x.start_time ASC, x.id ASC
         ) AS items
    FROM (
      SELECT * FROM todays_events ORDER BY start_time ASC, id ASC LIMIT ${EVENT_LIMIT}
    ) x
),

-- Must agree with GET /reminders/due exactly, down to the orphan filter and the
-- use of now() rather than the start of the day. A dashboard badge that does not
-- match the list it links to is worse than no badge.
due_reminders AS (
  SELECT d.id, d.entity_type, d.entity_id, d.entity_title, d.remind_at
    FROM (
      SELECT r.id, r.entity_type, r.entity_id, r.remind_at,
             ${REMINDER_ENTITY_TITLE} AS entity_title
        FROM reminders r
       WHERE r.user_id = $1
         AND r.status = 'pending'
         AND r.remind_at <= now()
    ) d
   WHERE d.entity_title IS NOT NULL
),
reminder_counts AS (SELECT count(*)::int AS total FROM due_reminders),
reminder_items AS (
  SELECT jsonb_agg(
           jsonb_build_object(
             'id', x.id, 'entityType', x.entity_type, 'entityId', x.entity_id,
             'entityTitle', x.entity_title, 'remindAt', ${isoInstant('x.remind_at')}
           ) ORDER BY x.remind_at ASC, x.id ASC
         ) AS items
    FROM (
      SELECT * FROM due_reminders ORDER BY remind_at ASC, id ASC LIMIT ${REMINDER_LIMIT}
    ) x
),

-- Scanned over this month only, and grouped by currency, because 100 USD plus
-- 100 EGP is not 200. Amounts leave as strings (DD-021).
spending AS (
  SELECT jsonb_agg(
           jsonb_build_object('currency', s.currency, 'today', s.today, 'month', s.month)
           ORDER BY s.currency ASC
         ) AS items
    FROM (
      SELECT e.currency,
             round(coalesce(sum(e.amount) FILTER (WHERE e.spent_on = $2::date), 0), 2)::text
               AS today,
             round(sum(e.amount), 2)::text AS month
        FROM expenses e
       WHERE e.user_id = $1
         AND e.spent_on >= $5::date
         AND e.spent_on < $6::date
       GROUP BY e.currency
    ) s
),

-- The match is imported from the money slice, so "over budget" here and "over
-- budget" on the budgets screen cannot come to mean two different things.
budget_counts AS (
  SELECT count(*)::int AS over_limit
    FROM budgets b
   WHERE b.user_id = $1
     AND b.month = $5::date
     AND (
       SELECT coalesce(sum(e.amount), 0) FROM expenses e WHERE ${budgetExpenseMatch('b')}
     ) > b.monthly_limit
),

goal_counts AS (
  SELECT count(*) FILTER (WHERE g.status = 'active')::int AS active,
         count(*) FILTER (
           WHERE g.status = 'active'
             AND g.target_date IS NOT NULL
             AND g.target_date >= $2::date
             AND g.target_date <= $7::date
         )::int AS due_soon
    FROM goals g
   WHERE g.user_id = $1
)

SELECT tc.overdue, tc.due_today, tc.completed_today,
       coalesce(ot.items, '[]'::jsonb) AS open_tasks,
       hc.tracked AS habits_tracked,
       hc.completed AS habits_completed,
       coalesce(ph.items, '[]'::jsonb) AS pending_habits,
       ec.total AS events_today,
       coalesce(ei.items, '[]'::jsonb) AS event_items,
       rc.total AS reminders_due,
       coalesce(ri.items, '[]'::jsonb) AS reminder_items,
       coalesce(sp.items, '[]'::jsonb) AS spending,
       bc.over_limit AS budgets_over_limit,
       gc.active AS goals_active,
       gc.due_soon AS goals_due_soon
  FROM task_counts tc,
       open_tasks ot,
       habit_counts hc,
       pending_habits ph,
       event_counts ec,
       event_items ei,
       reminder_counts rc,
       reminder_items ri,
       spending sp,
       budget_counts bc,
       goal_counts gc`;

export interface DashboardWindow {
  readonly day: string;
  readonly dayStart: string;
  readonly dayEnd: string;
  readonly monthStart: string;
  readonly monthEnd: string;
  readonly goalHorizon: string;
}

export async function loadDashboard(
  userId: string,
  window: DashboardWindow,
): Promise<DashboardRow> {
  const result = await query<DashboardRow>(DASHBOARD_QUERY, [
    userId,
    window.day,
    window.dayStart,
    window.dayEnd,
    window.monthStart,
    window.monthEnd,
    window.goalHorizon,
  ]);

  const row = result.rows[0];
  if (!row) {
    // Every CTE is an aggregate over a user-scoped predicate, so each returns
    // exactly one row even when the user has no data at all, and the cross join
    // of eleven single-row relations is one row. No row means the query stopped
    // being what this function claims it is.
    throw new Error('Dashboard query produced no row');
  }
  return row;
}
