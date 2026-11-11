/**
 * src/features/product-events/product-events.metrics.ts
 *
 * Aggregate Activation / D1 / D7 / D30 funnel over content-free product
 * events (feature guide G5). Owner-approved definitions, also documented in
 * docs/analytics/product-events.md:
 *
 *   - Cohort: accounts created in [cohortFrom, cohortTo) that have not opted
 *     out (opting out deletes their events, so they leave every denominator).
 *   - Meaningful action: `task_completed` or `habit_checked_in`.
 *   - Activation: a meaningful action within the first session, approximated
 *     as the first 30 minutes after account creation (server time).
 *   - Day-N retention (N = 1, 7, 30): a meaningful action on local calendar
 *     day day0 + N, where day0 is the account's creation day in the user's
 *     time zone. Only accounts whose day N has fully ended at `asOf` (in their
 *     time zone) are eligible, so immature cohorts never deflate a rate.
 *
 * The query returns counts only: no user ids, emails or event rows leave the
 * database. The owner can paste the same SQL into the Neon editor from
 * docs/analytics/sql/product-funnel.sql (a unit test keeps both identical).
 */

import type pg from 'pg';

export const ACTIVATION_WINDOW_MINUTES = 30;

const PARAMS_PLACEHOLDER = '/*PARAMS*/';

/** Funnel SQL with a placeholder for the parameter row. */
export const PRODUCT_FUNNEL_SQL_TEMPLATE = `WITH params AS (
  ${PARAMS_PLACEHOLDER}
),
cohort AS (
  SELECT u.id, u.created_at, COALESCE(tz.name, 'UTC') AS tz
  FROM users u
  CROSS JOIN params p
  LEFT JOIN pg_timezone_names tz ON tz.name = u.timezone
  WHERE u.created_at >= p.cohort_from
    AND u.created_at < p.cohort_to
    AND u.product_events_enabled
),
dated AS (
  SELECT c.id, c.created_at,
         (c.created_at AT TIME ZONE c.tz)::date AS day0,
         (p.as_of AT TIME ZONE c.tz)::date AS today
  FROM cohort c
  CROSS JOIN params p
),
per_user AS (
  SELECT d.day0, d.today,
    EXISTS (
      SELECT 1 FROM product_events e
      WHERE e.user_id = d.id
        AND e.event_name IN ('task_completed', 'habit_checked_in')
        AND e.occurred_at >= d.created_at
        AND e.occurred_at < d.created_at + interval '${ACTIVATION_WINDOW_MINUTES} minutes'
    ) AS activated,
    (
      SELECT min(e.occurred_at) FROM product_events e
      WHERE e.user_id = d.id
        AND e.event_name IN ('task_completed', 'habit_checked_in')
        AND e.occurred_at >= d.created_at
    ) - d.created_at AS to_first_win,
    EXISTS (
      SELECT 1 FROM product_events e
      WHERE e.user_id = d.id
        AND e.event_name IN ('task_completed', 'habit_checked_in')
        AND e.occurred_on = d.day0 + 1
    ) AS d1,
    EXISTS (
      SELECT 1 FROM product_events e
      WHERE e.user_id = d.id
        AND e.event_name IN ('task_completed', 'habit_checked_in')
        AND e.occurred_on = d.day0 + 7
    ) AS d7,
    EXISTS (
      SELECT 1 FROM product_events e
      WHERE e.user_id = d.id
        AND e.event_name IN ('task_completed', 'habit_checked_in')
        AND e.occurred_on = d.day0 + 30
    ) AS d30,
    EXISTS (
      SELECT 1 FROM product_events e WHERE e.user_id = d.id AND e.event_name = 'onboarding_started'
    ) AS onboarding_started,
    EXISTS (
      SELECT 1 FROM product_events e WHERE e.user_id = d.id AND e.event_name = 'onboarding_completed'
    ) AS onboarding_completed,
    EXISTS (
      SELECT 1 FROM product_events e WHERE e.user_id = d.id AND e.event_name = 'onboarding_skipped'
    ) AS onboarding_skipped
  FROM dated d
)
SELECT
  count(*)::int AS cohort_users,
  count(*) FILTER (WHERE activated)::int AS activated_users,
  count(*) FILTER (WHERE today > day0 + 1)::int AS d1_eligible,
  count(*) FILTER (WHERE today > day0 + 1 AND d1)::int AS d1_retained,
  count(*) FILTER (WHERE today > day0 + 7)::int AS d7_eligible,
  count(*) FILTER (WHERE today > day0 + 7 AND d7)::int AS d7_retained,
  count(*) FILTER (WHERE today > day0 + 30)::int AS d30_eligible,
  count(*) FILTER (WHERE today > day0 + 30 AND d30)::int AS d30_retained,
  count(*) FILTER (WHERE onboarding_started)::int AS onboarding_started,
  count(*) FILTER (WHERE onboarding_completed)::int AS onboarding_completed,
  count(*) FILTER (WHERE onboarding_skipped)::int AS onboarding_skipped,
  percentile_cont(0.5) WITHIN GROUP (ORDER BY extract(epoch FROM to_first_win))
    FILTER (WHERE to_first_win IS NOT NULL) AS median_seconds_to_first_win
FROM per_user;
`;

export const PRODUCT_FUNNEL_SQL = PRODUCT_FUNNEL_SQL_TEMPLATE.replace(
  PARAMS_PLACEHOLDER,
  'SELECT $1::timestamptz AS cohort_from, $2::timestamptz AS cohort_to, $3::timestamptz AS as_of'
);

/** Renders the template with literal timestamps for the Neon SQL editor. */
export function renderFunnelSqlWithLiterals(
  cohortFrom: string,
  cohortTo: string,
  asOf: string
): string {
  return PRODUCT_FUNNEL_SQL_TEMPLATE.replace(
    PARAMS_PLACEHOLDER,
    `SELECT timestamptz '${cohortFrom}' AS cohort_from, timestamptz '${cohortTo}' AS cohort_to, timestamptz '${asOf}' AS as_of`
  );
}

/**
 * Example window rendered into docs/analytics/sql/product-funnel.sql. The
 * owner replaces the three literals before running it in the Neon editor.
 */
export const FUNNEL_DOC_EXAMPLE_WINDOW = {
  cohortFrom: '2026-12-01 00:00:00+00',
  cohortTo: '2027-01-01 00:00:00+00',
  asOf: '2027-02-15 00:00:00+00'
} as const;

export interface RetentionPoint {
  eligible: number;
  retained: number;
  rate: number | null;
}

export interface ProductFunnel {
  cohortUsers: number;
  activatedUsers: number;
  activationRate: number | null;
  medianSecondsToFirstWin: number | null;
  d1: RetentionPoint;
  d7: RetentionPoint;
  d30: RetentionPoint;
  onboarding: { started: number; completed: number; skipped: number };
}

interface FunnelRow {
  cohort_users: number;
  activated_users: number;
  d1_eligible: number;
  d1_retained: number;
  d7_eligible: number;
  d7_retained: number;
  d30_eligible: number;
  d30_retained: number;
  onboarding_started: number;
  onboarding_completed: number;
  onboarding_skipped: number;
  median_seconds_to_first_win: number | string | null;
}

const rate = (numerator: number, denominator: number): number | null =>
  denominator === 0 ? null : numerator / denominator;

export async function computeProductFunnel(
  db: Pick<pg.Pool, 'query'>,
  window: { cohortFrom: Date; cohortTo: Date; asOf: Date }
): Promise<ProductFunnel> {
  const res = await db.query<FunnelRow>(PRODUCT_FUNNEL_SQL, [
    window.cohortFrom,
    window.cohortTo,
    window.asOf
  ]);
  const row = res.rows[0]!;
  const point = (eligible: number, retained: number): RetentionPoint => ({
    eligible,
    retained,
    rate: rate(retained, eligible)
  });
  return {
    cohortUsers: row.cohort_users,
    activatedUsers: row.activated_users,
    activationRate: rate(row.activated_users, row.cohort_users),
    medianSecondsToFirstWin:
      row.median_seconds_to_first_win === null ? null : Number(row.median_seconds_to_first_win),
    d1: point(row.d1_eligible, row.d1_retained),
    d7: point(row.d7_eligible, row.d7_retained),
    d30: point(row.d30_eligible, row.d30_retained),
    onboarding: {
      started: row.onboarding_started,
      completed: row.onboarding_completed,
      skipped: row.onboarding_skipped
    }
  };
}
