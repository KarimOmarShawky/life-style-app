/**
 * Calendar arithmetic for the money feature.
 *
 * Every function here works on `YYYY-MM-DD` strings and computes in UTC. That is
 * deliberate: these dates are calendar days, not instants, and doing the
 * arithmetic with local-time `Date` methods makes the result depend on the
 * timezone the server happens to run in, which is how a report ends up one day
 * short after a deployment moves regions.
 *
 * WHOSE "TODAY". The server's, in UTC. A client far enough east can see a
 * renewal counted as one day further away than their own calendar says for a few
 * hours a day. Habits take a client-supplied date for this reason, because a
 * streak breaks on a day boundary and the difference is visible and upsetting.
 * A subscription renewal is not that kind of number, and accepting one here
 * would add a parameter to every money endpoint to fix an off-by-one that
 * corrects itself within hours.
 */

/** Today, as the server's UTC calendar date. */
export function serverToday(): string {
  return new Date().toISOString().slice(0, 10);
}

/** `2026-09` to `2026-09-01`, the form the `month` column is constrained to. */
export function monthToFirstDay(month: string): string {
  return `${month}-01`;
}

/** The first and last calendar days of the month containing `date`. */
export function monthBounds(date: string): { from: string; to: string } {
  const year = Number(date.slice(0, 4));
  const month = Number(date.slice(5, 7));

  // Day 0 of the next month is the last day of this one, which is how February
  // and leap years are handled without a table of month lengths.
  const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate();

  return {
    from: `${date.slice(0, 7)}-01`,
    to: `${date.slice(0, 7)}-${String(lastDay).padStart(2, '0')}`,
  };
}

/** Whole days from `from` to `to`, inclusive of both ends. */
export function inclusiveDayCount(from: string, to: string): number {
  const start = Date.parse(`${from}T00:00:00Z`);
  const end = Date.parse(`${to}T00:00:00Z`);
  return Math.round((end - start) / 86_400_000) + 1;
}
