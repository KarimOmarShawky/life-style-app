/**
 * Calendar dates, as distinct from instants.
 *
 * A DATE column has no time and no zone: `2026-09-24` is the same day for
 * everyone. The `pg` driver still hands it back as a JavaScript `Date`, which is
 * an instant, set to local midnight. Calling `.toISOString()` on it converts to
 * UTC and can therefore move it a day in either direction — the classic
 * off-by-one that makes a habit logged on the 1st appear on the 31st.
 *
 * Reading the local calendar fields is what avoids that. It is duplicated
 * nowhere: every feature that reads a DATE column uses this.
 */
export function formatCalendarDate(value: Date): string {
  const year = value.getFullYear();
  const month = String(value.getMonth() + 1).padStart(2, '0');
  const day = String(value.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}
