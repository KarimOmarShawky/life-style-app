/**
 * src/features/recurring-tasks/recurring-tasks.service.ts
 *
 * Implements Section 1.4.5 & 14.6: Recurring Tasks Service.
 */

import { AppError } from '../../core/errors/app-error.js';
import type { Clock } from '../../core/time/clock.js';
import { getUserTodayDate } from '../../core/time/date-utils.js';
import type { RecurringTasksRepository } from './recurring-tasks.repository.js';
import type { ProjectsRepository } from '../projects/projects.repository.js';
import type {
  CreateRecurringTaskInput,
  UpdateRecurringTaskInput,
  ListRecurringTasksQuery
} from './recurring-tasks.validation.js';
import type { RecurringTaskDto } from './recurring-tasks.types.js';
import { toRecurringTaskDto } from './recurring-tasks.dto.js';
import { priorityToNumber } from '../tasks/tasks.dto.js';

export class RecurringTasksService {
  constructor(
    private readonly recurringTasksRepository: RecurringTasksRepository,
    private readonly projectsRepository: ProjectsRepository,
    private readonly clock: Clock
  ) {}

  private async verifyProjectOwnership(userId: string, projectId: string): Promise<void> {
    const project = await this.projectsRepository.findActiveById(userId, projectId);
    if (!project) {
      throw AppError.notFound('Project not found');
    }
  }

  async createRecurringTask(
    userId: string,
    input: CreateRecurringTaskInput,
    userTimezone = 'UTC'
  ): Promise<RecurringTaskDto> {
    if (input.projectId) {
      await this.verifyProjectOwnership(userId, input.projectId);
    }

    const userToday = getUserTodayDate(userTimezone, this.clock.now());

    const result = await this.recurringTasksRepository.createWithRecurrence(
      {
        userId,
        title: input.title,
        description: input.description,
        projectId: input.projectId,
        priority: priorityToNumber(input.priority),
        estimateMinutes: input.estimateMinutes,
        dueTime: input.dueTime,
        reminderOffsetMinutes: input.reminderOffsetMinutes,
        status: input.status,
        recurrence: {
          freq: input.recurrence.freq,
          interval: input.recurrence.interval ?? 1,
          byWeekday: input.recurrence.byWeekday ?? null,
          byMonthDay: input.recurrence.byMonthDay ?? null,
          byMonth: input.recurrence.byMonth ?? null,
          startDate: input.recurrence.startDate,
          endDate: input.recurrence.endDate ?? null,
          occurrenceLimit: input.recurrence.occurrenceLimit ?? null
        }
      },
      userToday
    );

    return toRecurringTaskDto(result.recurringTask, result.recurrence);
  }

  async getRecurringTask(userId: string, id: string): Promise<RecurringTaskDto> {
    const result = await this.recurringTasksRepository.findActiveById(userId, id);
    if (!result) {
      throw AppError.notFound('Recurring task not found');
    }
    return toRecurringTaskDto(result.recurringTask, result.recurrence);
  }

  async updateRecurringTask(
    userId: string,
    id: string,
    input: UpdateRecurringTaskInput,
    userTimezone = 'UTC'
  ): Promise<RecurringTaskDto> {
    const existing = await this.recurringTasksRepository.findActiveById(userId, id);
    if (!existing) {
      throw AppError.notFound('Recurring task not found');
    }

    if (input.projectId !== undefined && input.projectId !== null) {
      await this.verifyProjectOwnership(userId, input.projectId);
    }

    const userToday = getUserTodayDate(userTimezone, this.clock.now());

    const result = await this.recurringTasksRepository.update(
      userId,
      id,
      {
        title: input.title,
        description: input.description,
        projectId: input.projectId,
        priority: input.priority !== undefined ? priorityToNumber(input.priority) : undefined,
        estimateMinutes: input.estimateMinutes,
        dueTime: input.dueTime,
        reminderOffsetMinutes: input.reminderOffsetMinutes,
        status: input.status,
        recurrence: input.recurrence
          ? {
              freq: input.recurrence.freq,
              interval: input.recurrence.interval ?? 1,
              byWeekday: input.recurrence.byWeekday ?? null,
              byMonthDay: input.recurrence.byMonthDay ?? null,
              byMonth: input.recurrence.byMonth ?? null,
              startDate: input.recurrence.startDate,
              endDate: input.recurrence.endDate ?? null,
              occurrenceLimit: input.recurrence.occurrenceLimit ?? null
            }
          : undefined
      },
      userToday,
      input.version
    );

    if (!result) {
      throw AppError.conflict(
        'VERSION_CONFLICT',
        'Conflict: Recurring task was modified concurrently'
      );
    }

    return toRecurringTaskDto(result.recurringTask, result.recurrence);
  }

  async deleteRecurringTask(userId: string, id: string): Promise<void> {
    const deleted = await this.recurringTasksRepository.softDelete(userId, id);
    if (!deleted) {
      throw AppError.notFound('Recurring task not found');
    }
  }

  async listRecurringTasks(
    userId: string,
    query: ListRecurringTasksQuery
  ): Promise<{ data: RecurringTaskDto[]; meta: { nextCursor: string | null } }> {
    const { items, nextCursor } = await this.recurringTasksRepository.list(
      userId,
      query.status,
      query.limit,
      query.cursor
    );

    return {
      data: items.map(({ recurringTask, recurrence }) =>
        toRecurringTaskDto(recurringTask, recurrence)
      ),
      meta: { nextCursor }
    };
  }
}
