/**
 * Task business logic.
 *
 * Two rules carry most of the weight here:
 *
 *   1. A task may only be filed under a project the SAME user owns. The check is
 *      a single query that tests existence and ownership together, so a caller
 *      cannot discover another user's project ids by probing.
 *   2. Timer state transitions are decided by the database, not by reading state
 *      and then writing. Start and stop are both conditional statements whose
 *      row count reports what happened, which is what makes a double tap safe.
 */
import { AppError, ErrorCode } from '@/core/errors';
import { createLogger } from '@/core/logger';
import { buildPage, type Page, type PageRequest } from '@/core/utils/pagination';

import * as repository from './task.repository';
import { toTaskResponse, toTimerSessionResponse } from './task.mapper';
import type {
  CreateTaskInput,
  TaskFilters,
  TaskResponse,
  TimerSessionResponse,
  UpdateTaskInput,
} from './task.types';

const log = createLogger('task.service');

/** Cap on how many sessions the history endpoint returns in one call. */
const TIMER_HISTORY_LIMIT = 100;

export class TaskService {
  /**
   * Validates a project reference.
   *
   * Throws 422 rather than 404 because from the caller's perspective they
   * supplied a bad value in the body, and 422 points at the field. The message
   * is identical whether the project is missing or belongs to someone else, so
   * this cannot be used to probe for valid ids.
   */
  private async assertProjectUsable(
    userId: string,
    projectId: string | null | undefined,
  ): Promise<void> {
    if (projectId === undefined || projectId === null) {
      return;
    }

    const usable = await repository.projectBelongsToUser(userId, projectId);
    if (!usable) {
      throw AppError.validation(
        [{ field: 'projectId', message: 'projectId does not refer to one of your projects' }],
        'The request contains invalid data.',
      );
    }
  }

  public async create(userId: string, input: CreateTaskInput): Promise<TaskResponse> {
    await this.assertProjectUsable(userId, input.projectId);

    const task = await repository.insertTask(userId, input);
    return toTaskResponse(task);
  }

  public async getById(userId: string, taskId: string): Promise<TaskResponse> {
    const task = await repository.findTaskById(userId, taskId);
    if (!task) {
      // Same response whether it never existed or belongs to another user
      // (decision DD-009).
      throw AppError.notFound('Task', { requestedId: taskId, requestedBy: userId });
    }
    return toTaskResponse(task);
  }

  public async list(
    userId: string,
    page: PageRequest,
    filters: TaskFilters,
  ): Promise<Page<TaskResponse>> {
    const rows = await repository.listTasks(userId, page.limit, page.cursor, filters);
    const paged = buildPage(rows, page.limit);

    // One `now` for the whole page, so two tasks with the same due date cannot
    // disagree about whether they are overdue.
    const now = new Date();

    return {
      items: paged.items.map((row) => toTaskResponse(row, now)),
      nextCursor: paged.nextCursor,
      hasMore: paged.hasMore,
    };
  }

  public async update(
    userId: string,
    taskId: string,
    input: UpdateTaskInput,
  ): Promise<TaskResponse> {
    await this.assertProjectUsable(userId, input.projectId);

    // Turning recurrence off must clear the rule, otherwise the database's
    // `tasks_recurrence_rule_present` constraint rejects the write. Validation
    // already rejects supplying a rule alongside isRecurring:false; this covers
    // turning it off without mentioning the rule at all.
    const normalized: UpdateTaskInput =
      input.isRecurring === false && input.recurrenceRule === undefined
        ? { ...input, recurrenceRule: null }
        : input;

    const updated = await repository.updateTask(userId, taskId, normalized);
    if (!updated) {
      throw AppError.notFound('Task', { requestedId: taskId, requestedBy: userId });
    }

    return toTaskResponse(updated);
  }

  public async remove(userId: string, taskId: string): Promise<void> {
    const deleted = await repository.deleteTask(userId, taskId);
    if (!deleted) {
      throw AppError.notFound('Task', { requestedId: taskId, requestedBy: userId });
    }
  }

  /**
   * Starts the timer (FR-7).
   *
   * Requires `hasTimer` to be enabled, which is what the flag means: timing is
   * opt-in per task rather than implicit on every task.
   */
  public async startTimer(userId: string, taskId: string): Promise<TaskResponse> {
    const task = await repository.findTaskById(userId, taskId);
    if (!task) {
      throw AppError.notFound('Task', { requestedId: taskId, requestedBy: userId });
    }

    if (!task.hasTimer) {
      throw new AppError(ErrorCode.CONFLICT, {
        message: 'Enable the timer on this task before starting it.',
        metadata: { taskId },
      });
    }

    if (task.runningSessionId !== null) {
      throw new AppError(ErrorCode.CONFLICT, {
        message: 'A timer is already running for this task.',
        metadata: { taskId, sessionId: task.runningSessionId },
      });
    }

    try {
      const session = await repository.startTimerSession(userId, taskId);
      if (!session) {
        throw AppError.notFound('Task', { requestedId: taskId });
      }
    } catch (error) {
      // The partial unique index is the real guard. Two simultaneous Start
      // requests both pass the check above; only one can insert.
      if (error instanceof Error && 'code' in error && error.code === '23505') {
        throw new AppError(ErrorCode.CONFLICT, {
          message: 'A timer is already running for this task.',
          metadata: { taskId, detectedBy: 'unique index' },
        });
      }
      throw error;
    }

    const updated = await repository.findTaskById(userId, taskId);
    if (!updated) {
      throw AppError.notFound('Task', { requestedId: taskId });
    }

    log.info({ taskId }, 'Timer started');
    return toTaskResponse(updated);
  }

  /** Stops the running timer. A second stop is a conflict, not a silent success. */
  public async stopTimer(userId: string, taskId: string): Promise<TaskResponse> {
    const stopped = await repository.stopTimerSession(userId, taskId);

    if (!stopped) {
      // Either the task is not the caller's, or no timer is running. Distinguish
      // them only after confirming ownership, so the answer never reveals that
      // someone else's task exists.
      const task = await repository.findTaskById(userId, taskId);
      if (!task) {
        throw AppError.notFound('Task', { requestedId: taskId, requestedBy: userId });
      }
      throw new AppError(ErrorCode.CONFLICT, {
        message: 'No timer is running for this task.',
        metadata: { taskId },
      });
    }

    const updated = await repository.findTaskById(userId, taskId);
    if (!updated) {
      throw AppError.notFound('Task', { requestedId: taskId });
    }

    log.info({ taskId, sessionId: stopped.id }, 'Timer stopped');
    return toTaskResponse(updated);
  }

  /** Session history for one task (FR-8). */
  public async listTimerSessions(
    userId: string,
    taskId: string,
  ): Promise<readonly TimerSessionResponse[]> {
    const task = await repository.findTaskById(userId, taskId);
    if (!task) {
      throw AppError.notFound('Task', { requestedId: taskId, requestedBy: userId });
    }

    const sessions = await repository.listTimerSessions(userId, taskId, TIMER_HISTORY_LIMIT);
    return sessions.map(toTimerSessionResponse);
  }
}
