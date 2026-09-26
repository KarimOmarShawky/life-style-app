/**
 * Reminder persistence.
 *
 * ONE TABLE FOR FOUR KINDS OF REMINDER (FR-23). A task reminder, a habit
 * reminder, a subscription reminder and an event reminder differ only in what
 * they point at, so they are one table with a discriminator rather than four
 * tables with four sets of queries. The delivery question — "what is due?" — has
 * a single answer as a result, which is the whole point: four tables would mean
 * four queries that can drift apart.
 *
 * THE DUE QUERY IS THE IMPORTANT ONE. It carries a condition that has no
 * counterpart in any other feature: a reminder whose entity has been deleted is
 * NOT due. There is no foreign key to cascade the delete (the target table
 * varies per row), so without that filter the user would be notified about a task
 * they threw away last week and tapping the notification would 404. The filter
 * lives in the query rather than in the service, so no future caller can forget
 * it.
 *
 * Ownership is in the WHERE clause of every statement (DD-008).
 */
import type { Cursor } from '@/core/utils/pagination';
import { query } from '@/infrastructure/database/postgres/pool';

import { entityTitleExpression } from './schedule.entities';
import {
  REMINDER_ENTITY_TYPES,
  type CreateReminderInput,
  type ReminderEntityType,
  type ReminderFilters,
  type ReminderStatus,
  type ReminderWithEntity,
  type UpdateReminderInput,
} from './schedule.types';

interface ReminderRow {
  id: string;
  user_id: string;
  entity_type: ReminderEntityType;
  entity_id: string;
  entity_title: string | null;
  remind_at: Date;
  offset_description: string | null;
  status: ReminderStatus;
  sent_at: Date | null;
  attempts: number;
  created_at: Date;
  updated_at: Date;
}

function toReminderRecord(row: ReminderRow): ReminderWithEntity {
  return {
    id: row.id,
    userId: row.user_id,
    entityType: row.entity_type,
    entityId: row.entity_id,
    entityTitle: row.entity_title,
    remindAt: row.remind_at,
    offsetDescription: row.offset_description,
    status: row.status,
    sentAt: row.sent_at,
    attempts: row.attempts,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

const COLUMNS = `r.id, r.user_id, r.entity_type, r.entity_id, r.remind_at, r.offset_description,
                 r.status, r.sent_at, r.attempts, r.created_at, r.updated_at`;
const RETURNED = `id, user_id, entity_type, entity_id, remind_at, offset_description,
                  status, sent_at, attempts, created_at, updated_at`;

const ENTITY_TITLE = entityTitleExpression({
  alias: 'r',
  typeColumn: 'entity_type',
  idColumn: 'entity_id',
  types: REMINDER_ENTITY_TYPES,
});

/**
 * Wraps a writing statement so it returns the same shape a read does.
 *
 * Every mutation here has to come back with the entity's title attached, and
 * `RETURNING` cannot reach into another table. The CTE is how one round trip
 * still does both: the write happens, and the title is resolved from its result.
 */
function withResolvedEntity(statement: string): string {
  return `WITH changed AS (${statement})
          SELECT r.*, ${ENTITY_TITLE} AS entity_title FROM changed r`;
}

export async function insertReminder(
  userId: string,
  input: CreateReminderInput,
): Promise<ReminderWithEntity> {
  const result = await query<ReminderRow>(
    withResolvedEntity(
      `INSERT INTO reminders (user_id, entity_type, entity_id, remind_at, offset_description)
       VALUES ($1, $2::text, $3::uuid, $4::timestamptz, $5::text)
       RETURNING ${RETURNED}`,
    ),
    [userId, input.entityType, input.entityId, input.remindAt, input.offsetDescription ?? null],
  );

  const row = result.rows[0];
  if (!row) {
    throw new Error('INSERT ... RETURNING produced no row');
  }
  return toReminderRecord(row);
}

export async function findReminderById(
  userId: string,
  reminderId: string,
): Promise<ReminderWithEntity | undefined> {
  const result = await query<ReminderRow>(
    `SELECT ${COLUMNS}, ${ENTITY_TITLE} AS entity_title
       FROM reminders r
      WHERE r.id = $1 AND r.user_id = $2`,
    [reminderId, userId],
  );

  const row = result.rows[0];
  return row ? toReminderRecord(row) : undefined;
}

/**
 * A page of reminders, most recently scheduled first.
 *
 * Ordered by `remind_at` descending, matching the `(user_id, remind_at DESC)`
 * index, so a history listing reads newest-first like every other list in the
 * API. The one place that wants the opposite order is the due query below, and
 * it is not paginated.
 */
export async function listReminders(
  userId: string,
  limit: number,
  cursor: Cursor | undefined,
  filters: ReminderFilters,
): Promise<ReminderWithEntity[]> {
  const shared = [
    userId,
    filters.status ?? null,
    filters.entityType ?? null,
    filters.entityId ?? null,
  ];

  const predicates = `
    WHERE r.user_id = $1
      AND ($2::text IS NULL OR r.status = $2::text)
      AND ($3::text IS NULL OR r.entity_type = $3::text)
      AND ($4::uuid IS NULL OR r.entity_id = $4::uuid)`;

  if (cursor) {
    const result = await query<ReminderRow>(
      `SELECT ${COLUMNS}, ${ENTITY_TITLE} AS entity_title
         FROM reminders r
         ${predicates}
          AND (r.remind_at, r.id) < ($5::timestamptz, $6::uuid)
        ORDER BY r.remind_at DESC, r.id DESC
        LIMIT $7`,
      [...shared, cursor.createdAt, cursor.id, limit + 1],
    );
    return result.rows.map(toReminderRecord);
  }

  const result = await query<ReminderRow>(
    `SELECT ${COLUMNS}, ${ENTITY_TITLE} AS entity_title
       FROM reminders r
       ${predicates}
      ORDER BY r.remind_at DESC, r.id DESC
      LIMIT $5`,
    [...shared, limit + 1],
  );
  return result.rows.map(toReminderRecord);
}

/**
 * Pending reminders that have come due, oldest first.
 *
 * OLDEST FIRST because this is a queue, not a list: a phone that was off for a
 * day should show what it missed in the order it was missed.
 *
 * `entity_title IS NOT NULL` is the orphan filter. Every title column on every
 * referenced table is NOT NULL, so a null here means one thing only — the row
 * this reminder points at has been deleted — and the reminder is silently
 * skipped rather than fired at something that no longer opens.
 *
 * `now()` is evaluated by PostgreSQL, not passed in. The database is the single
 * clock in the system; a timestamp computed by a client, or even by this
 * process, can disagree with the one the rows were written against.
 */
export async function dueReminders(userId: string, limit: number): Promise<ReminderWithEntity[]> {
  const result = await query<ReminderRow>(
    `SELECT * FROM (
       SELECT ${COLUMNS}, ${ENTITY_TITLE} AS entity_title
         FROM reminders r
        WHERE r.user_id = $1
          AND r.status = 'pending'
          AND r.remind_at <= now()
     ) due
      WHERE due.entity_title IS NOT NULL
      ORDER BY due.remind_at ASC, due.id ASC
      LIMIT $2`,
    [userId, limit],
  );

  return result.rows.map(toReminderRecord);
}

export async function updateReminder(
  userId: string,
  reminderId: string,
  input: UpdateReminderInput,
): Promise<ReminderWithEntity | undefined> {
  const result = await query<ReminderRow>(
    withResolvedEntity(
      `UPDATE reminders r
          SET remind_at = CASE WHEN $3::boolean THEN $4::timestamptz ELSE r.remind_at END,
              offset_description = CASE WHEN $5::boolean
                                        THEN $6::text ELSE r.offset_description END
        WHERE r.id = $1 AND r.user_id = $2
        RETURNING ${RETURNED}`,
    ),
    [
      reminderId,
      userId,
      input.remindAt !== undefined,
      input.remindAt ?? null,
      input.offsetDescription !== undefined,
      input.offsetDescription ?? null,
    ],
  );

  const row = result.rows[0];
  return row ? toReminderRecord(row) : undefined;
}

/**
 * Marks a reminder delivered.
 *
 * `coalesce(sent_at, now())` rather than `now()`, and `status IN ('pending',
 * 'sent')` rather than `= 'pending'`, so a client that shows a notification and
 * retries the acknowledgement on a flaky connection gets the same row back
 * instead of an error and a moving timestamp. Returns nothing for a dismissed
 * reminder, which the service turns into a conflict: acknowledging something the
 * user already threw away is a contradiction, not a retry.
 */
export async function acknowledgeReminder(
  userId: string,
  reminderId: string,
): Promise<ReminderWithEntity | undefined> {
  const result = await query<ReminderRow>(
    withResolvedEntity(
      `UPDATE reminders r
          SET status = 'sent', sent_at = coalesce(r.sent_at, now())
        WHERE r.id = $1 AND r.user_id = $2 AND r.status IN ('pending', 'sent')
        RETURNING ${RETURNED}`,
    ),
    [reminderId, userId],
  );

  const row = result.rows[0];
  return row ? toReminderRecord(row) : undefined;
}

/**
 * Dismisses a reminder from any state.
 *
 * Deliberately unconditional. Dismissing is the user saying "I am done with
 * this", and that is true whether it was pending, already shown, or dismissed a
 * moment ago on another device. A state guard here would turn a second tap into
 * an error for no gain.
 */
export async function dismissReminder(
  userId: string,
  reminderId: string,
): Promise<ReminderWithEntity | undefined> {
  const result = await query<ReminderRow>(
    withResolvedEntity(
      `UPDATE reminders r
          SET status = 'dismissed'
        WHERE r.id = $1 AND r.user_id = $2
        RETURNING ${RETURNED}`,
    ),
    [reminderId, userId],
  );

  const row = result.rows[0];
  return row ? toReminderRecord(row) : undefined;
}

/**
 * Pushes a reminder back into the queue.
 *
 * Measured from `now()` rather than from the original `remind_at`: "remind me in
 * ten minutes" means ten minutes from the tap, and a reminder that has been
 * sitting unread for two hours would otherwise reappear instantly.
 *
 * `sent_at` is cleared because the row is undelivered again. Keeping the old
 * timestamp would leave a reminder that is pending and claims to have been sent,
 * which is the kind of contradiction the status column exists to prevent.
 */
export async function snoozeReminder(
  userId: string,
  reminderId: string,
  minutes: number,
): Promise<ReminderWithEntity | undefined> {
  const result = await query<ReminderRow>(
    withResolvedEntity(
      `UPDATE reminders r
          SET status = 'pending',
              remind_at = now() + make_interval(mins => $3::int),
              sent_at = NULL
        WHERE r.id = $1 AND r.user_id = $2
        RETURNING ${RETURNED}`,
    ),
    [reminderId, userId, minutes],
  );

  const row = result.rows[0];
  return row ? toReminderRecord(row) : undefined;
}

export async function deleteReminder(userId: string, reminderId: string): Promise<boolean> {
  const result = await query(`DELETE FROM reminders WHERE id = $1 AND user_id = $2`, [
    reminderId,
    userId,
  ]);
  return (result.rowCount ?? 0) > 0;
}
