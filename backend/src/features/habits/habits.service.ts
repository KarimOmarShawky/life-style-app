/**
 * src/features/habits/habits.service.ts
 *
 * Implements Section 1.4.6 & 14.8: Habits Service.
 */

import { AppError } from '../../core/errors/app-error.js';
import type { Clock } from '../../core/time/clock.js';
import { getUserTodayDate } from '../../core/time/date-utils.js';
import type { DatabaseSchema } from '../../infrastructure/database/postgres/kysely.js';
import type { Kysely } from 'kysely';
import type { HabitsRepository } from './habits.repository.js';
import type {
  CreateHabitInput,
  UpdateHabitInput,
  PutCheckinInput,
  GetCheckinsQuery,
  ListHabitsQuery
} from './habits.validation.js';
import type { HabitDto, HabitCheckinDto, HabitRow } from './habits.types.js';
import type { RecurrenceRow } from '../recurring-tasks/recurring-tasks.types.js';
import { toHabitDto, toHabitCheckinDto } from './habits.dto.js';
import {
  getScheduledDates,
  isScheduledDate,
  computeStreaks,
  computeTodayProgress,
  type DailyHabitStatus,
  type TodayProgressResult
} from './streaks-engine.js';

export class HabitsService {
  constructor(
    private readonly habitsRepository: HabitsRepository,
    private readonly db: Kysely<DatabaseSchema>,
    private readonly clock: Clock
  ) {}

  private async verifyGoalOwnership(userId: string, goalId: string): Promise<void> {
    const goal = await this.db
      .selectFrom('goals')
      .select(['id'])
      .where('id', '=', goalId)
      .where('user_id', '=', userId)
      .where('deleted_at', 'is', null)
      .executeTakeFirst();

    if (!goal) {
      throw AppError.notFound('Goal not found');
    }
  }

  private calculateHabitStreaks(
    habitRow: HabitRow,
    recurrenceRow: RecurrenceRow,
    checkins: Array<{ checkin_date: Date | string; status: 'done' | 'skipped' }>,
    userToday: string
  ): { currentStreak: number; longestStreak: number } {
    const startDateStr =
      habitRow.start_date instanceof Date
        ? habitRow.start_date.toISOString().slice(0, 10)
        : String(habitRow.start_date).slice(0, 10);

    const scheduleRule = {
      freq: recurrenceRow.freq as 'daily' | 'weekly',
      interval: recurrenceRow.interval,
      byWeekday: recurrenceRow.by_weekday,
      startDate: startDateStr
    };

    const scheduledDates = getScheduledDates(scheduleRule, userToday);

    const checkinsMap = new Map<string, 'done' | 'skipped'>();
    for (const c of checkins) {
      const dStr =
        c.checkin_date instanceof Date
          ? c.checkin_date.toISOString().slice(0, 10)
          : String(c.checkin_date).slice(0, 10);
      checkinsMap.set(dStr, c.status);
    }

    return computeStreaks(scheduledDates, checkinsMap, userToday);
  }

  async createHabit(
    userId: string,
    input: CreateHabitInput,
    _userTimezone = 'UTC'
  ): Promise<HabitDto> {
    if (input.goalId) {
      await this.verifyGoalOwnership(userId, input.goalId);
    }

    const { habit, recurrence } = await this.habitsRepository.createWithRecurrence({
      userId,
      name: input.name,
      description: input.description,
      startDate: input.startDate,
      reminderTime: input.reminderTime,
      color: input.color,
      goalId: input.goalId,
      recurrence: {
        freq: input.recurrence.freq,
        interval: input.recurrence.interval ?? 1,
        byWeekday: input.recurrence.byWeekday
      }
    });

    return toHabitDto(habit, recurrence, 0, 0);
  }

  async getHabit(userId: string, id: string, userTimezone = 'UTC'): Promise<HabitDto> {
    const result = await this.habitsRepository.findActiveById(userId, id);
    if (!result) {
      throw AppError.notFound('Habit not found');
    }

    const userToday = getUserTodayDate(userTimezone, this.clock.now());
    const checkins = await this.habitsRepository.getCheckinsForHabit(userId, id);

    const { currentStreak, longestStreak } = this.calculateHabitStreaks(
      result.habit,
      result.recurrence,
      checkins,
      userToday
    );

    return toHabitDto(result.habit, result.recurrence, currentStreak, longestStreak);
  }

  async updateHabit(
    userId: string,
    id: string,
    input: UpdateHabitInput,
    userTimezone = 'UTC'
  ): Promise<HabitDto> {
    const existing = await this.habitsRepository.findActiveById(userId, id);
    if (!existing) {
      throw AppError.notFound('Habit not found');
    }

    if (input.goalId) {
      await this.verifyGoalOwnership(userId, input.goalId);
    }

    const updated = await this.habitsRepository.update(
      userId,
      id,
      {
        name: input.name,
        description: input.description,
        status: input.status,
        reminderTime: input.reminderTime,
        color: input.color,
        goalId: input.goalId,
        recurrence: input.recurrence
          ? {
              freq: input.recurrence.freq,
              interval: input.recurrence.interval,
              byWeekday: input.recurrence.byWeekday
            }
          : undefined
      },
      input.version
    );

    if (!updated) {
      throw AppError.conflict('VERSION_CONFLICT', 'Conflict: Habit was modified concurrently');
    }

    const userToday = getUserTodayDate(userTimezone, this.clock.now());
    const checkins = await this.habitsRepository.getCheckinsForHabit(userId, id);

    const { currentStreak, longestStreak } = this.calculateHabitStreaks(
      updated.habit,
      updated.recurrence,
      checkins,
      userToday
    );

    return toHabitDto(updated.habit, updated.recurrence, currentStreak, longestStreak);
  }

  async deleteHabit(userId: string, id: string): Promise<void> {
    const deleted = await this.habitsRepository.softDelete(userId, id);
    if (!deleted) {
      throw AppError.notFound('Habit not found');
    }
  }

  async restoreHabit(userId: string, id: string, userTimezone = 'UTC'): Promise<HabitDto> {
    const restored = await this.habitsRepository.restore(userId, id, 30);
    if (!restored) {
      throw AppError.notFound('Habit not found or restore window expired');
    }

    const recurrence = await this.db
      .selectFrom('recurrences')
      .selectAll()
      .where('habit_id', '=', id)
      .where('user_id', '=', userId)
      .executeTakeFirstOrThrow();

    const userToday = getUserTodayDate(userTimezone, this.clock.now());
    const checkins = await this.habitsRepository.getCheckinsForHabit(userId, id);

    const { currentStreak, longestStreak } = this.calculateHabitStreaks(
      restored,
      recurrence as unknown as RecurrenceRow,
      checkins,
      userToday
    );

    return toHabitDto(
      restored,
      recurrence as unknown as RecurrenceRow,
      currentStreak,
      longestStreak
    );
  }

  async listHabits(
    userId: string,
    query: ListHabitsQuery,
    userTimezone = 'UTC'
  ): Promise<{ data: HabitDto[]; meta: { nextCursor: string | null } }> {
    const { items, nextCursor } = await this.habitsRepository.list(
      userId,
      query.status,
      query.limit,
      query.cursor
    );

    const habitIds = items.map((i) => i.habit.id);
    const allCheckins = await this.habitsRepository.getAllCheckinsForHabits(userId, habitIds);

    const checkinsByHabit = new Map<
      string,
      Array<{ checkin_date: Date | string; status: 'done' | 'skipped' }>
    >();
    for (const c of allCheckins) {
      const arr = checkinsByHabit.get(c.habit_id) ?? [];
      arr.push(c);
      checkinsByHabit.set(c.habit_id, arr);
    }

    const userToday = getUserTodayDate(userTimezone, this.clock.now());

    const data = items.map(({ habit, recurrence }) => {
      const checkins = checkinsByHabit.get(habit.id) ?? [];
      const { currentStreak, longestStreak } = this.calculateHabitStreaks(
        habit,
        recurrence,
        checkins,
        userToday
      );
      return toHabitDto(habit, recurrence, currentStreak, longestStreak);
    });

    return {
      data,
      meta: { nextCursor }
    };
  }

  async recordCheckin(
    userId: string,
    habitId: string,
    date: string,
    input: PutCheckinInput,
    userTimezone = 'UTC'
  ): Promise<{ checkin: HabitCheckinDto; currentStreak: number }> {
    const habitData = await this.habitsRepository.findActiveById(userId, habitId);
    if (!habitData) {
      throw AppError.notFound('Habit not found');
    }

    const { habit, recurrence } = habitData;
    const userToday = getUserTodayDate(userTimezone, this.clock.now());

    // AC-HAB-01 & AC-HAB-03: Future dates rejected with 400
    if (date > userToday) {
      throw AppError.validation([
        {
          field: 'date',
          message: 'Check-in date cannot be in the future'
        }
      ]);
    }

    const startDateStr =
      habit.start_date instanceof Date
        ? habit.start_date.toISOString().slice(0, 10)
        : String(habit.start_date).slice(0, 10);

    // Date before habit start_date rejected with 400
    if (date < startDateStr) {
      throw AppError.validation([
        {
          field: 'date',
          message: 'Check-in date cannot be before habit start date'
        }
      ]);
    }

    // Unscheduled dates rejected with 400
    const scheduleRule = {
      freq: recurrence.freq as 'daily' | 'weekly',
      interval: recurrence.interval,
      byWeekday: recurrence.by_weekday,
      startDate: startDateStr
    };

    if (!isScheduledDate(scheduleRule, date)) {
      throw AppError.validation([
        {
          field: 'date',
          message: 'Date is not a scheduled occurrence for this habit'
        }
      ]);
    }

    // Upsert check-in
    const checkin = await this.habitsRepository.upsertCheckin(
      userId,
      habitId,
      date,
      input.status,
      input.note
    );

    // Compute updated current streak
    const checkins = await this.habitsRepository.getCheckinsForHabit(userId, habitId);
    const { currentStreak } = this.calculateHabitStreaks(habit, recurrence, checkins, userToday);

    return {
      checkin: toHabitCheckinDto(checkin),
      currentStreak
    };
  }

  async deleteCheckin(userId: string, habitId: string, date: string): Promise<void> {
    const habit = await this.habitsRepository.findActiveById(userId, habitId);
    if (!habit) {
      throw AppError.notFound('Habit not found');
    }

    const deleted = await this.habitsRepository.deleteCheckin(userId, habitId, date);
    if (!deleted) {
      throw AppError.notFound('Check-in not found');
    }
  }

  async getCheckins(
    userId: string,
    habitId: string,
    query: GetCheckinsQuery
  ): Promise<HabitCheckinDto[]> {
    const habit = await this.habitsRepository.findActiveById(userId, habitId);
    if (!habit) {
      throw AppError.notFound('Habit not found');
    }

    const checkins = await this.habitsRepository.getCheckinsForHabit(
      userId,
      habitId,
      query.from,
      query.to
    );

    return checkins.map(toHabitCheckinDto);
  }

  async getTodayProgress(userId: string, userTimezone = 'UTC'): Promise<TodayProgressResult> {
    const userToday = getUserTodayDate(userTimezone, this.clock.now());

    // Fetch active habits
    const { items } = await this.habitsRepository.list(userId, 'active', 100);
    const habitIds = items.map((i) => i.habit.id);

    // Fetch checkins for today
    const checkins = await this.habitsRepository.getAllCheckinsForHabits(userId, habitIds);
    const todayCheckinsMap = new Map<string, 'done' | 'skipped'>();
    for (const c of checkins) {
      const dStr =
        c.checkin_date instanceof Date
          ? c.checkin_date.toISOString().slice(0, 10)
          : String(c.checkin_date).slice(0, 10);
      if (dStr === userToday) {
        todayCheckinsMap.set(c.habit_id, c.status);
      }
    }

    const statuses: DailyHabitStatus[] = items.map(({ habit, recurrence }) => {
      const startDateStr =
        habit.start_date instanceof Date
          ? habit.start_date.toISOString().slice(0, 10)
          : String(habit.start_date).slice(0, 10);

      const scheduleRule = {
        freq: recurrence.freq as 'daily' | 'weekly',
        interval: recurrence.interval,
        byWeekday: recurrence.by_weekday,
        startDate: startDateStr
      };

      const scheduledToday = isScheduledDate(scheduleRule, userToday);
      const checkinStatus = todayCheckinsMap.get(habit.id) ?? null;

      return {
        habitId: habit.id,
        isScheduledToday: scheduledToday,
        checkinStatus
      };
    });

    return computeTodayProgress(statuses);
  }
}
