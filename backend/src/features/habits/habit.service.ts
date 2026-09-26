/**
 * Habit business logic.
 *
 * The rules worth stating:
 *
 *   1. A log cannot be dated in the future. A habit is completed by doing it,
 *      and tomorrow has not happened, so accepting it would let a client
 *      manufacture a streak the calendar does not support.
 *   2. Marking a day is idempotent. The database has a unique index on
 *      (habit_id, log_date) and the write is an upsert, so a double tap updates
 *      one row rather than failing or double-counting.
 *   3. Archiving is not deleting. An archived habit keeps its history, which is
 *      the whole point of having tracked it.
 */
import { AppError, ErrorCode } from '@/core/errors';
import { buildPage, type Page, type PageRequest } from '@/core/utils/pagination';

import * as repository from './habit.repository';
import { toHabitLogResponse, toHabitResponse } from './habit.mapper';
import type {
  CreateHabitInput,
  HabitLogResponse,
  HabitResponse,
  UpdateHabitInput,
} from './habit.types';

/** A year of history in one request is enough for any calendar view. */
const MAX_LOG_ROWS = 400;

/** Today, as the server's calendar date (UTC). */
export function serverToday(): string {
  return new Date().toISOString().slice(0, 10);
}

/**
 * The latest date a log may carry.
 *
 * The server's clock is UTC; a client's calendar is not. At 01:00 in UTC+14 the
 * user's today is the server's tomorrow, and refusing that would make the app
 * unusable east of the date line for part of every day. One day of tolerance
 * covers every real timezone and nothing more, so a client still cannot
 * manufacture a streak by logging a week ahead.
 *
 * Computed from the SERVER clock, never from a client-supplied date. An earlier
 * version compared the log date against a bound the same request could set,
 * which meant the check could never fail.
 */
export function maxLoggableDate(): string {
  const tomorrow = new Date();
  tomorrow.setUTCDate(tomorrow.getUTCDate() + 1);
  return tomorrow.toISOString().slice(0, 10);
}

export class HabitService {
  /**
   * Rejects a date the calendar has not reached anywhere on earth.
   *
   * Compared as strings, which is safe because both are `YYYY-MM-DD`: that
   * format sorts identically as text and as a date, so no parsing is involved
   * and no timezone can shift the comparison.
   */
  private assertNotFuture(date: string): void {
    if (date > maxLoggableDate()) {
      throw AppError.validation([{ field: 'date', message: 'date cannot be in the future' }]);
    }
  }

  public async create(
    userId: string,
    input: CreateHabitInput,
    asOf: string,
  ): Promise<HabitResponse> {
    const habit = await repository.insertHabit(userId, input, asOf);
    return toHabitResponse(habit);
  }

  public async getById(userId: string, habitId: string, asOf: string): Promise<HabitResponse> {
    const habit = await repository.findHabitById(userId, habitId, asOf);
    if (!habit) {
      throw AppError.notFound('Habit', { requestedId: habitId, requestedBy: userId });
    }
    return toHabitResponse(habit);
  }

  public async list(
    userId: string,
    page: PageRequest,
    archived: boolean,
    asOf: string,
  ): Promise<Page<HabitResponse>> {
    const rows = await repository.listHabits(userId, page.limit, page.cursor, archived, asOf);
    const paged = buildPage(rows, page.limit);

    return {
      items: paged.items.map(toHabitResponse),
      nextCursor: paged.nextCursor,
      hasMore: paged.hasMore,
    };
  }

  public async update(
    userId: string,
    habitId: string,
    input: UpdateHabitInput,
    asOf: string,
  ): Promise<HabitResponse> {
    const updated = await repository.updateHabit(userId, habitId, input, asOf);
    if (!updated) {
      throw AppError.notFound('Habit', { requestedId: habitId, requestedBy: userId });
    }
    return toHabitResponse(updated);
  }

  public async remove(userId: string, habitId: string): Promise<void> {
    // Logs go with it: ON DELETE CASCADE on habit_logs.habit_id. Unlike a
    // project's tasks, a log has no meaning without its habit, so keeping the
    // rows would leave orphans nothing can display.
    const deleted = await repository.deleteHabit(userId, habitId);
    if (!deleted) {
      throw AppError.notFound('Habit', { requestedId: habitId, requestedBy: userId });
    }
  }

  /**
   * Marks a day complete or incomplete (FR-10).
   *
   * Returns the whole habit rather than the log, because the numbers a client
   * re-renders after this — both streaks, the total, whether the current period
   * is done — all change as a result. Returning the log alone would force an
   * immediate second request for the thing the user actually sees.
   */
  public async log(
    userId: string,
    habitId: string,
    input: { date?: string | undefined; completed?: boolean | undefined },
    asOf: string,
  ): Promise<HabitResponse> {
    const date = input.date ?? asOf;
    this.assertNotFuture(date);

    const written = await repository.upsertHabitLog(userId, habitId, {
      date,
      completed: input.completed ?? true,
    });

    if (!written) {
      // The INSERT ... SELECT found no habit for this caller. Same answer as a
      // habit that never existed (decision DD-009).
      throw AppError.notFound('Habit', { requestedId: habitId, requestedBy: userId });
    }

    return this.getById(userId, habitId, asOf);
  }

  /**
   * Removes a day's entry entirely.
   *
   * Distinct from logging it as not completed: "I did not do it" and "I never
   * said" are different states, and only the second should disappear from the
   * history.
   */
  public async removeLog(
    userId: string,
    habitId: string,
    date: string,
    asOf: string,
  ): Promise<HabitResponse> {
    const deleted = await repository.deleteHabitLog(userId, habitId, date);

    if (!deleted) {
      // Distinguish "no such log" from "no such habit" only after confirming
      // ownership, so the answer never reveals another user's habit exists.
      const habit = await repository.findHabitById(userId, habitId, asOf);
      if (!habit) {
        throw AppError.notFound('Habit', { requestedId: habitId, requestedBy: userId });
      }
      throw new AppError(ErrorCode.NOT_FOUND, {
        message: 'No entry exists for that date.',
        metadata: { habitId, date },
      });
    }

    return this.getById(userId, habitId, asOf);
  }

  public async listLogs(
    userId: string,
    habitId: string,
    range: { from?: string | undefined; to?: string | undefined },
    asOf: string,
  ): Promise<readonly HabitLogResponse[]> {
    const habit = await repository.findHabitById(userId, habitId, asOf);
    if (!habit) {
      throw AppError.notFound('Habit', { requestedId: habitId, requestedBy: userId });
    }

    const logs = await repository.listHabitLogs(
      userId,
      habitId,
      range.from,
      range.to,
      MAX_LOG_ROWS,
    );
    return logs.map(toHabitLogResponse);
  }
}
