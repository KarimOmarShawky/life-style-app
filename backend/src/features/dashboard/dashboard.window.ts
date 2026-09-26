/**
 * The bounds the summary is computed over.
 *
 * Pure, and takes `now` as an argument rather than reading the clock, so the
 * rollovers that are easy to get wrong — the last day of a month, the last day
 * of a year, a leap day — can be tested directly instead of by waiting for one.
 *
 * EVERYTHING HERE IS UTC. `Date.UTC` and the `getUTC*` accessors are used
 * throughout, never the local-time equivalents. A summary computed in the
 * server's local zone would answer differently on a laptop in Cairo and a
 * container in Frankfurt, which is the failure this avoids — at the cost, stated
 * plainly in DD-024 and DD-027, that a user's "today" is the UTC today until the
 * schema carries a timezone for them.
 */

/** How far ahead a goal counts as due soon. */
export const GOAL_HORIZON_DAYS = 30;

const MS_PER_DAY = 86_400_000;

export interface DashboardWindow {
  /** The UTC day being summarised, as YYYY-MM-DD. */
  readonly day: string;
  /** That day's midnight, as an instant. */
  readonly dayStart: string;
  /** The NEXT day's midnight: an exclusive upper bound, so no instant is counted twice. */
  readonly dayEnd: string;
  readonly monthStart: string;
  /** The first of the following month, again exclusive. */
  readonly monthEnd: string;
  readonly goalHorizon: string;
}

function toCalendarDate(value: Date): string {
  const year = String(value.getUTCFullYear()).padStart(4, '0');
  const month = String(value.getUTCMonth() + 1).padStart(2, '0');
  const day = String(value.getUTCDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

export function dashboardWindow(now: Date): DashboardWindow {
  const year = now.getUTCFullYear();
  const month = now.getUTCMonth();
  const date = now.getUTCDate();

  const dayStartMs = Date.UTC(year, month, date);

  // Adding whole days in milliseconds is exact in UTC, which has no daylight
  // saving to make a day 23 or 25 hours long. The same arithmetic in local time
  // silently produces the wrong bound twice a year.
  const dayEndMs = dayStartMs + MS_PER_DAY;

  // Month 12 rolls into January of the next year on its own; there is no
  // special case to forget.
  const monthEnd = new Date(Date.UTC(year, month + 1, 1));

  return {
    day: toCalendarDate(new Date(dayStartMs)),
    dayStart: new Date(dayStartMs).toISOString(),
    dayEnd: new Date(dayEndMs).toISOString(),
    monthStart: toCalendarDate(new Date(Date.UTC(year, month, 1))),
    monthEnd: toCalendarDate(monthEnd),
    goalHorizon: toCalendarDate(new Date(dayStartMs + GOAL_HORIZON_DAYS * MS_PER_DAY)),
  };
}
