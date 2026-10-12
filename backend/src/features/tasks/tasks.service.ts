/**
 * src/features/tasks/tasks.service.ts
 *
 * Implements Section 1.4.3 & 14.4: Tasks Service.
 */

import { AppError } from '../../core/errors/app-error.js';
import type { Clock } from '../../core/time/clock.js';
import { getUserTodayDate } from '../../core/time/date-utils.js';
import type { TasksRepository } from './tasks.repository.js';
import type { ProjectsRepository } from '../projects/projects.repository.js';
import type { RemindersRepository } from '../reminders/reminders.repository.js';
import type { CreateTaskInput, UpdateTaskInput, ListTasksQuery } from './tasks.validation.js';
import type { TaskDto, TaskStatus, TaskPriority, ListTasksFilter } from './tasks.types.js';
import { toTaskDto, priorityToNumber, formatDateOnly } from './tasks.dto.js';

export class TasksService {
  constructor(
    private readonly tasksRepository: TasksRepository,
    private readonly projectsRepository: ProjectsRepository,
    private readonly clock: Clock,
    private readonly remindersRepository: RemindersRepository
  ) {}

  private async verifyProjectOwnership(userId: string, projectId: string): Promise<void> {
    const project = await this.projectsRepository.findActiveById(userId, projectId);
    if (!project) {
      throw AppError.notFound('Project not found');
    }
  }

  async createTask(userId: string, input: CreateTaskInput): Promise<TaskDto> {
    if (input.projectId) {
      await this.verifyProjectOwnership(userId, input.projectId);
    }

    // AC-TASK-02: Focus task unpinning
    if (input.isFocus && input.plannedDate) {
      await this.tasksRepository.unfocusAllForDate(userId, input.plannedDate);
    }

    // AC-TASK-01: Completion lifecycle
    const isDone = input.status === 'done';
    const completedAt = isDone ? this.clock.now() : null;

    const task = await this.tasksRepository.create({
      userId,
      title: input.title,
      description: input.description,
      status: input.status,
      priority: priorityToNumber(input.priority),
      dueDate: input.dueDate,
      dueTime: input.dueTime,
      plannedDate: input.plannedDate,
      isFocus: input.isFocus ?? false,
      estimateMinutes: input.estimateMinutes,
      projectId: input.projectId,
      completedAt
    });

    return toTaskDto(task, 0);
  }

  async getTask(userId: string, id: string): Promise<TaskDto> {
    const task = await this.tasksRepository.findActiveById(userId, id);
    if (!task) {
      throw AppError.notFound('Task not found');
    }

    const trackedSeconds = await this.tasksRepository.getTrackedSecondsForTask(userId, id);
    return toTaskDto(task, trackedSeconds);
  }

  async updateTask(userId: string, id: string, input: UpdateTaskInput): Promise<TaskDto> {
    const existing = await this.tasksRepository.findActiveById(userId, id);
    if (!existing) {
      throw AppError.notFound('Task not found');
    }

    if (input.projectId !== undefined && input.projectId !== null) {
      await this.verifyProjectOwnership(userId, input.projectId);
    }

    // Validate dueTime requires dueDate
    const existingDueDateStr = formatDateOnly(existing.due_date);
    const effectiveDueDate = input.dueDate !== undefined ? input.dueDate : existingDueDateStr;
    const effectiveDueTime = input.dueTime !== undefined ? input.dueTime : existing.due_time;
    if (effectiveDueTime && !effectiveDueDate) {
      throw AppError.validation([
        {
          field: 'dueTime',
          message: 'dueTime requires dueDate to be set'
        }
      ]);
    }

    // Validate isFocus requires plannedDate & unpin existing if newly focused
    const existingPlannedDateStr = formatDateOnly(existing.planned_date);
    const effectivePlannedDate =
      input.plannedDate !== undefined ? input.plannedDate : existingPlannedDateStr;
    const effectiveIsFocus = input.isFocus !== undefined ? input.isFocus : existing.is_focus;

    if (effectiveIsFocus && !effectivePlannedDate) {
      throw AppError.validation([
        {
          field: 'isFocus',
          message: 'isFocus requires plannedDate to be set'
        }
      ]);
    }

    if (input.isFocus && effectivePlannedDate) {
      await this.tasksRepository.unfocusAllForDate(userId, effectivePlannedDate, id);
    }

    // AC-TASK-01: Completion lifecycle transitions
    let completedAt: Date | null | undefined = undefined;
    if (input.status !== undefined) {
      if (input.status === 'done' && existing.status !== 'done') {
        completedAt = this.clock.now();
      } else if (input.status !== 'done' && existing.status === 'done') {
        completedAt = null;
      }
    }

    // AC-REC-02 / FR-REC-05: Mark recurring task instance as customized upon manual edit
    let isCustomized: boolean | undefined = undefined;
    if (existing.recurring_task_id !== null) {
      isCustomized = true;
    }

    const updated = await this.tasksRepository.update(
      userId,
      id,
      {
        title: input.title,
        description: input.description,
        status: input.status,
        priority: input.priority !== undefined ? priorityToNumber(input.priority) : undefined,
        dueDate: input.dueDate,
        dueTime: input.dueTime,
        plannedDate: input.plannedDate,
        isFocus: input.isFocus,
        estimateMinutes: input.estimateMinutes,
        projectId: input.projectId,
        isCustomized,
        completedAt
      },
      input.version
    );

    if (!updated) {
      throw AppError.conflict('VERSION_CONFLICT', 'Conflict: Task was modified concurrently');
    }

    const trackedSeconds = await this.tasksRepository.getTrackedSecondsForTask(userId, id);
    return toTaskDto(updated, trackedSeconds);
  }

  async deleteTask(userId: string, id: string): Promise<void> {
    const deleted = await this.tasksRepository.softDelete(userId, id);
    if (!deleted) {
      throw AppError.notFound('Task not found');
    }
    // Reminders of a soft-deleted task must never fire (FR-REM lifecycle).
    await this.remindersRepository.cancelPendingFor('task', id);
  }

  async restoreTask(userId: string, id: string): Promise<TaskDto> {
    const restored = await this.tasksRepository.restore(userId, id, 30);
    if (!restored) {
      throw AppError.notFound('Task not found or restore window expired');
    }

    const trackedSeconds = await this.tasksRepository.getTrackedSecondsForTask(userId, id);
    return toTaskDto(restored, trackedSeconds);
  }

  async listTasks(
    userId: string,
    query: ListTasksQuery,
    userTimezone = 'UTC'
  ): Promise<{ data: TaskDto[]; meta: { nextCursor: string | null } }> {
    const userToday = getUserTodayDate(userTimezone, this.clock.now());

    let statusList: TaskStatus[] | undefined;
    if (query.status) {
      statusList = query.status.split(',').map((s) => s.trim()) as TaskStatus[];
    }

    let priorityList: number[] | undefined;
    if (query.priority) {
      priorityList = query.priority.split(',').map((p) => {
        const trimmed = p.trim();
        if (/^\d+$/.test(trimmed)) {
          return parseInt(trimmed, 10);
        }
        return priorityToNumber(trimmed as TaskPriority);
      });
    }

    const filter: ListTasksFilter = {
      status: statusList,
      priority: priorityList,
      projectId: query.projectId,
      dueFrom: query.dueFrom,
      dueTo: query.dueTo,
      plannedDate: query.plannedDate,
      overdue: query.overdue,
      isFocus: query.isFocus,
      completedFrom: query.completedFrom,
      completedTo: query.completedTo,
      sort: query.sort,
      order: query.order,
      limit: query.limit,
      cursor: query.cursor
    };

    const { tasks, nextCursor } = await this.tasksRepository.list(userId, filter, userToday);

    return {
      data: tasks.map((t) => toTaskDto(t)),
      meta: { nextCursor }
    };
  }
}
