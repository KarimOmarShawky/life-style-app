/**
 * Reminder business logic.
 *
 * DELIVERY IS PULL, NOT PUSH — and that is a design decision, not a shortcut
 * (DD-025). There is no scheduler process here. The client asks what is due and
 * is told. A background job that walked the table and pushed notifications would
 * need a worker, a lock so two instances do not double-send, a retry policy, and
 * a story for what happens to everything it missed while it was down. Pulling
 * has none of those states: a phone that was off for a day asks once and gets
 * the whole backlog, in order, and a reminder is delivered exactly when someone
 * is actually there to see it.
 *
 * It is the same reasoning the subscription feature uses for renewal dates: work
 * out the answer when it is asked for, rather than maintaining it in the
 * background and hoping nothing missed a beat.
 *
 * The one thing pull cannot do is wake the phone up. When push notifications
 * arrive, they become a second delivery path on top of this table — the `status`
 * and `attempts` columns are already shaped for it — and not a replacement for
 * it, because a push that is never tapped must still show up in the app.
 */
import { AppError, ErrorCode } from '@/core/errors';
import { buildPageWith, type Page, type PageRequest } from '@/core/utils/pagination';

import * as repository from './reminder.repository';
import { entityBelongsToUser } from './schedule.references';
import { toReminderResponse } from './schedule.mapper';
import type {
  CreateReminderInput,
  ReminderFilters,
  ReminderResponse,
  UpdateReminderInput,
} from './schedule.types';

/** PostgreSQL unique-violation SQLSTATE. */
const UNIQUE_VIOLATION = '23505';

function isUniqueViolation(error: unknown): boolean {
  return error instanceof Error && 'code' in error && error.code === UNIQUE_VIOLATION;
}

/**
 * The partial unique index on `(entity_type, entity_id, remind_at)` for pending
 * rows is what stops the same thing being announced twice at the same moment.
 * It is enforced in the database rather than by a check-then-insert, which
 * races (spec section 32), so every write path that can collide translates it.
 */
const DUPLICATE_MESSAGE = 'A reminder for that item at that time already exists.';

function asDuplicate(error: unknown): AppError {
  return new AppError(ErrorCode.ALREADY_EXISTS, {
    message: DUPLICATE_MESSAGE,
    cause: error,
  });
}

export class ReminderService {
  public async create(userId: string, input: CreateReminderInput): Promise<ReminderResponse> {
    // The foreign key the database cannot declare. Identical message for a row
    // that does not exist and one belonging to someone else: telling them apart
    // would turn this endpoint into a way to enumerate other users' ids.
    const usable = await entityBelongsToUser(userId, input.entityType, input.entityId);
    if (!usable) {
      throw AppError.validation([
        {
          field: 'entityId',
          message: `entityId does not refer to one of your ${input.entityType}s`,
        },
      ]);
    }

    try {
      const reminder = await repository.insertReminder(userId, input);
      return toReminderResponse(reminder);
    } catch (error) {
      if (isUniqueViolation(error)) {
        throw asDuplicate(error);
      }
      throw error;
    }
  }

  public async getById(userId: string, reminderId: string): Promise<ReminderResponse> {
    const reminder = await repository.findReminderById(userId, reminderId);
    if (!reminder) {
      throw AppError.notFound('Reminder', { requestedId: reminderId, requestedBy: userId });
    }
    return toReminderResponse(reminder);
  }

  public async list(
    userId: string,
    page: PageRequest,
    filters: ReminderFilters,
  ): Promise<Page<ReminderResponse>> {
    const rows = await repository.listReminders(userId, page.limit, page.cursor, filters);

    const paged = buildPageWith(rows, page.limit, (row) => ({
      createdAt: row.remindAt.toISOString(),
      id: row.id,
    }));

    return {
      items: paged.items.map(toReminderResponse),
      nextCursor: paged.nextCursor,
      hasMore: paged.hasMore,
    };
  }

  /**
   * Everything that has come due and not yet been dealt with.
   *
   * Not paginated on purpose: see `dueRemindersQuerySchema`. Reminders whose
   * entity has been deleted are filtered out in the query, so this never returns
   * a notification that opens onto nothing.
   */
  public async due(userId: string, limit: number): Promise<ReminderResponse[]> {
    const rows = await repository.dueReminders(userId, limit);
    return rows.map(toReminderResponse);
  }

  public async update(
    userId: string,
    reminderId: string,
    input: UpdateReminderInput,
  ): Promise<ReminderResponse> {
    try {
      const updated = await repository.updateReminder(userId, reminderId, input);
      if (!updated) {
        throw AppError.notFound('Reminder', { requestedId: reminderId, requestedBy: userId });
      }
      return toReminderResponse(updated);
    } catch (error) {
      // Rescheduling onto an instant another pending reminder for the same item
      // already occupies.
      if (isUniqueViolation(error)) {
        throw asDuplicate(error);
      }
      throw error;
    }
  }

  /**
   * Marks a reminder as delivered.
   *
   * Idempotent for a reminder that is already sent, and a conflict for one that
   * has been dismissed. The repository's update matches nothing in the dismissed
   * case, which is indistinguishable from "no such row" without a second look —
   * so a second look is taken, on the error path only, to tell a 404 from a 409.
   */
  public async acknowledge(userId: string, reminderId: string): Promise<ReminderResponse> {
    const acknowledged = await repository.acknowledgeReminder(userId, reminderId);
    if (acknowledged) {
      return toReminderResponse(acknowledged);
    }

    const existing = await repository.findReminderById(userId, reminderId);
    if (!existing) {
      throw AppError.notFound('Reminder', { requestedId: reminderId, requestedBy: userId });
    }

    throw AppError.conflict('A dismissed reminder cannot be acknowledged.', {
      requestedId: reminderId,
      status: existing.status,
    });
  }

  public async dismiss(userId: string, reminderId: string): Promise<ReminderResponse> {
    const dismissed = await repository.dismissReminder(userId, reminderId);
    if (!dismissed) {
      throw AppError.notFound('Reminder', { requestedId: reminderId, requestedBy: userId });
    }
    return toReminderResponse(dismissed);
  }

  /**
   * Pushes a reminder back into the queue, measured from now.
   *
   * Allowed from any state, including dismissed: bringing something back is a
   * deliberate act with an unambiguous meaning, and refusing it would leave the
   * user with no way to undo a mis-tap except by recreating the reminder.
   */
  public async snooze(
    userId: string,
    reminderId: string,
    minutes: number,
  ): Promise<ReminderResponse> {
    try {
      const snoozed = await repository.snoozeReminder(userId, reminderId, minutes);
      if (!snoozed) {
        throw AppError.notFound('Reminder', { requestedId: reminderId, requestedBy: userId });
      }
      return toReminderResponse(snoozed);
    } catch (error) {
      if (isUniqueViolation(error)) {
        throw asDuplicate(error);
      }
      throw error;
    }
  }

  public async remove(userId: string, reminderId: string): Promise<void> {
    const deleted = await repository.deleteReminder(userId, reminderId);
    if (!deleted) {
      throw AppError.notFound('Reminder', { requestedId: reminderId, requestedBy: userId });
    }
  }
}
