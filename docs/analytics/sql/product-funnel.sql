-- Activation / D1 / D7 / D30 funnel over content-free product events (G5).
--
-- Read-only and aggregate: returns one row of counts, no user ids or emails.
-- Generated from backend/src/features/product-events/product-events.metrics.ts;
-- backend/tests/unit/product-events.test.ts fails if this copy drifts.
--
-- To run (owner, Neon SQL editor, after docs/analytics/sql/product-events-and-onboarding.sql):
--   1. Replace the three timestamps on the "SELECT timestamptz" line:
--      cohort_from / cohort_to = accounts created in [from, to);
--      as_of = the moment the numbers are computed for (normally now()).
--   2. Run. Rates are retained / eligible; an eligible count of 0 means the
--      cohort is too young for that day and the rate is not defined yet.
-- Definitions: docs/analytics/product-events.md.

WITH params AS (
  SELECT timestamptz '2026-12-01 00:00:00+00' AS cohort_from, timestamptz '2027-01-01 00:00:00+00' AS cohort_to, timestamptz '2027-02-15 00:00:00+00' AS as_of
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
        AND e.occurred_at < d.created_at + interval '30 minutes'
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
