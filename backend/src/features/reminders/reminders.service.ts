/**
 * src/features/reminders/reminders.service.ts
 *
 * Implements Section 14.13 & FR-REM-01..06: Unified Reminders business logic.
 * Reminders attach to exactly one parent (task, habit, event, or subscription).
 * Parent ownership is enforced by the database composite foreign keys; this
 * service never reads other features' tables (Section 4.2 isolation rules).
 */

import type { RemindersRepository } from './reminders.repository.js';
import type { ReminderEntity, ReminderParentKind, ReminderChannel } from './reminders.types.js';
import type { CreateReminderBody, ListRemindersQuery } from './reminders.validation.js';
import { AppError } from '../../core/errors/app-error.js';

export class RemindersService {
  constructor(private readonly remindersRepository: RemindersRepository) {}

  public async addReminder(
    userId: string,
    parentKind: ReminderParentKind,
    parentId: string,
    input: CreateReminderBody
  ): Promise<ReminderEntity> {
    return this.remindersRepository.create({
      userId,
      parentKind,
      parentId,
      source: 'user',
      remindAt: new Date(input.remindAt),
      offsetMinutes: input.offsetMinutes ?? null,
      channel: (input.channel ?? 'in_app') as ReminderChannel,
      dedupeKey: input.dedupeKey ?? null
    });
  }

  public async listForParent(
    userId: string,
    parentKind: ReminderParentKind,
    parentId: string
  ): Promise<ReminderEntity[]> {
    return this.remindersRepository.list(userId, {
      parentKind,
      parentId,
      limit: 100
    });
  }

  public async listAll(userId: string, query: ListRemindersQuery): Promise<ReminderEntity[]> {
    return this.remindersRepository.list(userId, {
      parentKind: query.entityType,
      status: query.status,
      from: query.from ? new Date(query.from) : undefined,
      to: query.to ? new Date(query.to) : undefined,
      limit: 100
    });
  }

  public async deleteReminder(
    userId: string,
    parentKind: ReminderParentKind,
    parentId: string,
    reminderId: string
  ): Promise<void> {
    const existing = await this.remindersRepository.find(userId, reminderId);
    if (!existing || existing.entityType !== parentKind || existing.entityId !== parentId) {
      // Scoped to the parent path: never delete another entity's reminder.
      throw AppError.notFound('Reminder not found');
    }
    await this.remindersRepository.delete(userId, reminderId);
  }
}
