/**
 * src/features/timer-sessions/timer-sessions.service.ts
 *
 * Implements Section 1.4.12 & 14.7: Timer Sessions Service.
 */

import { AppError } from '../../core/errors/app-error.js';
import type { Clock } from '../../core/time/clock.js';
import type { TimerSessionsRepository } from './timer-sessions.repository.js';
import type { TasksRepository } from '../tasks/tasks.repository.js';
import type {
  CreateTimerSessionInput,
  ListTimerSessionsQuery
} from './timer-sessions.validation.js';
import type { TimerSessionDto, TimerEndReason } from './timer-sessions.types.js';
import { toTimerSessionDto } from './timer-sessions.dto.js';

export class TimerSessionsService {
  constructor(
    private readonly timerSessionsRepository: TimerSessionsRepository,
    private readonly tasksRepository: TasksRepository,
    private readonly clock: Clock
  ) {}

  async startTimer(userId: string, input: CreateTimerSessionInput): Promise<TimerSessionDto> {
    const task = await this.tasksRepository.findActiveById(userId, input.taskId);
    if (!task) {
      throw AppError.notFound('Task not found');
    }

    const now = this.clock.now();
    const twelveHoursAgo = new Date(now.getTime() - 12 * 60 * 60 * 1000);

    // FR-TMR-05: Auto-close running timers exceeding 12 hours
    await this.timerSessionsRepository.autoCloseOlderThan(userId, twelveHoursAgo);

    // AC-TMR-01: Max 1 running timer per user
    const existingRunning = await this.timerSessionsRepository.findActiveSession(userId);
    if (existingRunning) {
      throw AppError.conflict('TIMER_ALREADY_RUNNING', 'A timer session is already running');
    }

    const session = await this.timerSessionsRepository.create({
      userId,
      taskId: input.taskId,
      startedAt: now,
      mode: input.mode,
      plannedSeconds: input.plannedSeconds ?? null
    });

    return toTimerSessionDto(session, now);
  }

  async stopTimer(userId: string, id: string): Promise<TimerSessionDto> {
    const session = await this.timerSessionsRepository.findById(userId, id);
    if (!session) {
      throw AppError.notFound('Timer session not found');
    }

    if (session.ended_at !== null) {
      throw AppError.conflict('TIMER_NOT_RUNNING', 'Timer session is not running');
    }

    const now = this.clock.now();
    const startedAt = new Date(session.started_at).getTime();
    const elapsedSeconds = Math.max(0, Math.floor((now.getTime() - startedAt) / 1000));

    let endReason: TimerEndReason = 'stopped';
    if (
      session.mode === 'countdown' &&
      session.planned_seconds !== null &&
      elapsedSeconds >= session.planned_seconds
    ) {
      endReason = 'completed';
    }

    const stopped = await this.timerSessionsRepository.stop(userId, id, now, endReason);
    if (!stopped) {
      throw AppError.conflict('TIMER_NOT_RUNNING', 'Timer session is not running');
    }

    return toTimerSessionDto(stopped, now);
  }

  async getActiveTimer(userId: string): Promise<TimerSessionDto | null> {
    const now = this.clock.now();
    const twelveHoursAgo = new Date(now.getTime() - 12 * 60 * 60 * 1000);
    await this.timerSessionsRepository.autoCloseOlderThan(userId, twelveHoursAgo);

    const active = await this.timerSessionsRepository.findActiveSession(userId);
    if (!active) {
      return null;
    }

    return toTimerSessionDto(active, now);
  }

  async listTimerSessions(
    userId: string,
    query: ListTimerSessionsQuery
  ): Promise<{ data: TimerSessionDto[]; meta: { nextCursor: string | null } }> {
    const { sessions, nextCursor } = await this.timerSessionsRepository.list(userId, {
      taskId: query.taskId,
      from: query.from,
      to: query.to,
      limit: query.limit,
      cursor: query.cursor
    });

    const now = this.clock.now();
    return {
      data: sessions.map((s) => toTimerSessionDto(s, now)),
      meta: { nextCursor }
    };
  }

  async deleteTimerSession(userId: string, id: string): Promise<void> {
    const deleted = await this.timerSessionsRepository.delete(userId, id);
    if (!deleted) {
      throw AppError.notFound('Timer session not found');
    }
  }
}
