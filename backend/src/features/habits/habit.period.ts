/**
 * How a habit's period is numbered.
 *
 * Extracted from `habit.repository` because the dashboard asks the same question
 * — "is this habit satisfied for the period it is currently in?" — and a second
 * copy of this rule is the kind of duplication that does not fail loudly. It
 * drifts, and the symptom is a home screen that says a weekly habit is still
 * outstanding while the habits screen says it is done. One definition, imported
 * by both, cannot disagree with itself.
 *
 * This is a SQL fragment and nothing else: it runs no query and imports no
 * module, so depending on it is not the same thing as one feature reaching into
 * another's repository (see feature-architecture.md).
 */

/**
 * A Monday, used as the origin for period numbering.
 *
 * Weeks are numbered by dividing a day offset by 7, which is only exact if the
 * origin is itself a week boundary. `date_trunc('week', ...)` returns a Monday,
 * so the difference is always a whole number of weeks and the division never
 * truncates — including for dates before the origin, where truncation toward
 * zero would otherwise merge two different weeks into one index.
 */
const PERIOD_EPOCH = `DATE '2000-01-03'`;

/** Day number for daily and custom habits, week number for weekly ones. */
export const PERIOD_INDEX = (dateExpression: string, frequencyExpression: string): string => `
  CASE ${frequencyExpression}
    WHEN 'weekly' THEN (date_trunc('week', ${dateExpression})::date - ${PERIOD_EPOCH}) / 7
    ELSE (${dateExpression} - ${PERIOD_EPOCH})
  END`;
