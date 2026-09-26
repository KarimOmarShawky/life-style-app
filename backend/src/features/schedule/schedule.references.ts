/**
 * The foreign key PostgreSQL cannot declare.
 *
 * Events and reminders both point at a row whose TABLE is decided by a column,
 * and no `REFERENCES` clause can express that. Rather than give up on referential
 * integrity, the three things a foreign key actually does are done explicitly,
 * and every table name involved comes from `ENTITY_SOURCES` in
 * `schedule.entities` so the write check and the read resolution cannot drift
 * apart:
 *
 *   EXISTENCE + OWNERSHIP  `entityBelongsToUser` is a single query that answers
 *                          both. It is false for a row that does not exist and
 *                          false for one belonging to somebody else, and the
 *                          caller reports the same message either way, so it
 *                          cannot be used to probe for valid ids.
 *
 *   RESOLUTION             `entityTitleExpression`, in `schedule.entities`,
 *                          builds the SQL that fetches the target's title in the
 *                          SAME statement as the row that points at it. One query
 *                          per page, not one per row: a 100-row page would
 *                          otherwise cost 100 extra round trips to a database in
 *                          another region. It lives in a module that imports
 *                          nothing, so the owner-scoping of every branch can be
 *                          asserted with no database.
 *
 *   ORPHAN DETECTION       every title column is NOT NULL, so a null title from
 *                          that expression means one thing only: the target is
 *                          gone. That is what makes "is this reference still
 *                          good?" answerable without a second query.
 *
 * WHAT IS STILL MISSING, honestly: ON DELETE CASCADE. Deleting an event deletes
 * its reminders because both live in this slice. Deleting a TASK leaves its
 * reminders behind, because reaching into the tasks slice to clean up is exactly
 * the coupling vertical slices exist to prevent. Those orphans are invisible to
 * the user — they are filtered out of everything that matters and reported as a
 * dangling reference everywhere else — but they do occupy rows. A shared
 * "entity deleted" event, or a sweep, is the real fix (DD-026).
 */
import { query } from '@/infrastructure/database/postgres/pool';

import { ENTITY_SOURCES } from './schedule.entities';
import type { ReminderEntityType } from './schedule.types';

/**
 * Does this row exist AND belong to this user?
 *
 * One query, two answers. Checking existence first and ownership second would
 * make the pair of round trips observable, and would tempt a future caller into
 * reporting the two cases differently.
 */
export async function entityBelongsToUser(
  userId: string,
  entityType: ReminderEntityType,
  entityId: string,
): Promise<boolean> {
  const source = ENTITY_SOURCES[entityType];

  const result = await query<{ exists: boolean }>(
    `SELECT true AS exists FROM ${source.table} WHERE id = $1 AND user_id = $2`,
    [entityId, userId],
  );

  return result.rowCount === 1;
}
