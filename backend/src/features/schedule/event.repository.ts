/**
 * Calendar event persistence.
 *
 * THREE THINGS IN THE SQL ARE LOAD-BEARING.
 *
 * 1. ALL-DAY IS NORMALIZED IN THE DATABASE, NOT LEFT AS A HINT. `all_day` would
 *    be decorative if the times stayed as sent: an event flagged all-day but
 *    stored 09:00-10:00 is not on the calendar's Tuesday row, it is in Tuesday's
 *    9am slot. Flagged rows are therefore snapped to the whole UTC day, in the
 *    same statement that sets the flag, so the two can never disagree.
 *
 * 2. THE WINDOW QUERY TESTS OVERLAP, NOT START. A conference running Monday to
 *    Friday must appear when the client asks for Wednesday, and it does not if
 *    the filter reads `start_time BETWEEN from AND to`. The test is
 *    `end_time >= from AND start_time <= to`, which is the only one that
 *    includes an event already in progress when the window opens.
 *
 * 3. THE LINKED TITLE COMES BACK IN THE SAME STATEMENT. See schedule.references:
 *    one query per page, and a null title is how a deleted target is reported.
 *
 * Ownership is in the WHERE clause of every statement (DD-008).
 */
import type { Cursor } from '@/core/utils/pagination';
import { query, withTransaction } from '@/infrastructure/database/postgres/pool';

import { entityTitleExpression } from './schedule.entities';
import type {
  CreateEventInput,
  EventFilters,
  EventLinkType,
  EventWithLink,
  UpdateEventInput,
} from './schedule.types';

interface EventRow {
  id: string;
  user_id: string;
  title: string;
  description: string | null;
  start_time: Date;
  end_time: Date;
  all_day: boolean;
  linked_type: EventLinkType | null;
  linked_id: string | null;
  linked_title: string | null;
  created_at: Date;
  updated_at: Date;
}

function toEventRecord(row: EventRow): EventWithLink {
  return {
    id: row.id,
    userId: row.user_id,
    title: row.title,
    description: row.description,
    startTime: row.start_time,
    endTime: row.end_time,
    allDay: row.all_day,
    linkedType: row.linked_type,
    linkedId: row.linked_id,
    linkedTitle: row.linked_title,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

const COLUMNS = `e.id, e.user_id, e.title, e.description, e.start_time, e.end_time, e.all_day,
                 e.linked_type, e.linked_id, e.created_at, e.updated_at`;
const RETURNED = `id, user_id, title, description, start_time, end_time, all_day,
                  linked_type, linked_id, created_at, updated_at`;

/** Resolves `linked_type` + `linked_id` to a title, or null if the target is gone. */
const LINKED_TITLE = entityTitleExpression({
  alias: 'e',
  typeColumn: 'linked_type',
  idColumn: 'linked_id',
  types: ['task', 'habit'],
});

/**
 * Midnight of the UTC day an instant falls in.
 *
 * `AT TIME ZONE 'UTC'` twice is not redundant: the first converts the
 * `timestamptz` to a UTC wall clock so `date_trunc` cuts the day at the right
 * place, and the second reads the result back as an instant. Truncating the
 * `timestamptz` directly would cut at midnight in the SERVER's timezone, which
 * would make the same event all-day on different days on different machines.
 */
function dayFloor(expression: string): string {
  return `(date_trunc('day', (${expression}) AT TIME ZONE 'UTC') AT TIME ZONE 'UTC')`;
}

/**
 * The last representable instant of that UTC day, 23:59:59.999.
 *
 * A millisecond short of the next midnight rather than the next midnight itself,
 * so a whole-day event does not overlap the following day's window. Milliseconds
 * rather than microseconds because JavaScript's Date cannot hold more, and a
 * value the client cannot round-trip would come back changed.
 */
function dayCeil(expression: string): string {
  return `(${dayFloor(expression)} + INTERVAL '1 day' - INTERVAL '1 millisecond')`;
}

export async function insertEvent(userId: string, input: CreateEventInput): Promise<EventWithLink> {
  const allDay = '(coalesce($6::boolean, false))';

  const result = await query<EventRow>(
    `WITH inserted AS (
       INSERT INTO events (user_id, title, description, start_time, end_time, all_day,
                           linked_type, linked_id)
       VALUES (
         $1, $2, $3,
         CASE WHEN ${allDay} THEN ${dayFloor('$4::timestamptz')} ELSE $4::timestamptz END,
         CASE WHEN ${allDay} THEN ${dayCeil('$5::timestamptz')} ELSE $5::timestamptz END,
         ${allDay},
         $7::text, $8::uuid
       )
       RETURNING ${RETURNED}
     )
     SELECT e.*, ${LINKED_TITLE} AS linked_title FROM inserted e`,
    [
      userId,
      input.title,
      input.description ?? null,
      input.startTime,
      input.endTime,
      input.allDay ?? null,
      input.linkedType ?? null,
      input.linkedId ?? null,
    ],
  );

  const row = result.rows[0];
  if (!row) {
    throw new Error('INSERT ... RETURNING produced no row');
  }
  return toEventRecord(row);
}

export async function findEventById(
  userId: string,
  eventId: string,
): Promise<EventWithLink | undefined> {
  const result = await query<EventRow>(
    `SELECT ${COLUMNS}, ${LINKED_TITLE} AS linked_title
       FROM events e
      WHERE e.id = $1 AND e.user_id = $2`,
    [eventId, userId],
  );

  const row = result.rows[0];
  return row ? toEventRecord(row) : undefined;
}

/**
 * A page of events, EARLIEST FIRST.
 *
 * Ascending, unlike every other list in this API, because a calendar is read
 * forwards: the next thing you have to do is the one you want at the top. The
 * keyset comparison flips with it, `>` rather than `<`, and the cursor carries
 * `start_time` because that is what the scan is ordered by.
 */
export async function listEvents(
  userId: string,
  limit: number,
  cursor: Cursor | undefined,
  filters: EventFilters,
): Promise<EventWithLink[]> {
  const shared = [userId, filters.from ?? null, filters.to ?? null, filters.linkedType ?? null];

  // An event OVERLAPS the window when it has not finished before the window
  // opens and has not started after it closes. Anything narrower drops
  // multi-day events from the middle of their own run.
  const predicates = `
    WHERE e.user_id = $1
      AND ($2::timestamptz IS NULL OR e.end_time   >= $2::timestamptz)
      AND ($3::timestamptz IS NULL OR e.start_time <= $3::timestamptz)
      AND ($4::text IS NULL OR e.linked_type = $4::text)`;

  if (cursor) {
    const result = await query<EventRow>(
      `SELECT ${COLUMNS}, ${LINKED_TITLE} AS linked_title
         FROM events e
         ${predicates}
          AND (e.start_time, e.id) > ($5::timestamptz, $6::uuid)
        ORDER BY e.start_time ASC, e.id ASC
        LIMIT $7`,
      [...shared, cursor.createdAt, cursor.id, limit + 1],
    );
    return result.rows.map(toEventRecord);
  }

  const result = await query<EventRow>(
    `SELECT ${COLUMNS}, ${LINKED_TITLE} AS linked_title
       FROM events e
       ${predicates}
      ORDER BY e.start_time ASC, e.id ASC
      LIMIT $5`,
    [...shared, limit + 1],
  );
  return result.rows.map(toEventRecord);
}

export async function updateEvent(
  userId: string,
  eventId: string,
  input: UpdateEventInput,
): Promise<EventWithLink | undefined> {
  // The value each column WOULD take from the request alone, before the all-day
  // rule is applied. Written once and substituted three times, so the flag and
  // the times it governs are always computed from the same inputs.
  const effectiveAllDay = '(CASE WHEN $11::boolean THEN $12::boolean ELSE e.all_day END)';
  const effectiveStart = '(CASE WHEN $7::boolean THEN $8::timestamptz ELSE e.start_time END)';
  const effectiveEnd = '(CASE WHEN $9::boolean THEN $10::timestamptz ELSE e.end_time END)';

  const result = await query<EventRow>(
    `WITH updated AS (
       UPDATE events e
          SET title       = CASE WHEN $3::boolean THEN $4::text ELSE e.title END,
              description = CASE WHEN $5::boolean THEN $6::text ELSE e.description END,
              all_day     = ${effectiveAllDay},
              start_time  = CASE WHEN ${effectiveAllDay}
                                 THEN ${dayFloor(effectiveStart)} ELSE ${effectiveStart} END,
              end_time    = CASE WHEN ${effectiveAllDay}
                                 THEN ${dayCeil(effectiveEnd)} ELSE ${effectiveEnd} END,
              linked_type = CASE WHEN $13::boolean THEN $14::text ELSE e.linked_type END,
              linked_id   = CASE WHEN $13::boolean THEN $15::uuid ELSE e.linked_id END
        WHERE e.id = $1 AND e.user_id = $2
        RETURNING ${RETURNED}
     )
     SELECT e.*, ${LINKED_TITLE} AS linked_title FROM updated e`,
    [
      eventId,
      userId,
      input.title !== undefined,
      input.title ?? null,
      input.description !== undefined,
      input.description ?? null,
      input.startTime !== undefined,
      input.startTime ?? null,
      input.endTime !== undefined,
      input.endTime ?? null,
      input.allDay !== undefined,
      input.allDay ?? null,
      // The link is one value in two columns: both are replaced together, or
      // neither is. Letting a client set a type without an id would produce
      // exactly the half-reference the CHECK constraint exists to forbid.
      input.linkedType !== undefined,
      input.linkedType ?? null,
      input.linkedId ?? null,
    ],
  );

  const row = result.rows[0];
  return row ? toEventRecord(row) : undefined;
}

/**
 * Deletes an event and the reminders that pointed at it.
 *
 * This is `ON DELETE CASCADE`, written out. The reminders table cannot declare
 * that foreign key because its target table varies per row, so the cleanup is
 * done here — in one transaction, because an event deleted without its reminders
 * leaves notifications that fire for something the user can no longer open.
 *
 * Both statements are scoped to the owner. The reminder delete is not implied by
 * the event delete having matched: without its own `user_id` predicate it would
 * be a way to delete another user's reminders by guessing an id.
 */
export async function deleteEvent(userId: string, eventId: string): Promise<boolean> {
  return withTransaction(async (client) => {
    const removed = await client.query(`DELETE FROM events WHERE id = $1 AND user_id = $2`, [
      eventId,
      userId,
    ]);

    if ((removed.rowCount ?? 0) === 0) {
      return false;
    }

    await client.query(
      `DELETE FROM reminders
        WHERE user_id = $1 AND entity_type = 'event' AND entity_id = $2`,
      [userId, eventId],
    );

    return true;
  });
}
