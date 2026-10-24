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
import type {
  CreateReminderBody,
  CreateUserReminderBody,
  ListRemindersQuery,
  UpdateUserReminderBody
} from './reminders.validation.js';
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

  /** Canonical POST /reminders: owned active parent, MVP channels, sane time. */
  public async createUserReminder(
    userId: string,
    input: CreateUserReminderBody,
    timeZone = 'UTC'
  ): Promise<ReminderEntity> {
    const parentKind: ReminderParentKind = input.entityType;
    let remindAt: Date;
    let offsetMinutes: number | null = null;

    if (input.remindAt !== undefined) {
      remindAt = new Date(input.remindAt);
    } else if (input.offsetMinutes !== undefined) {
      const anchor = await this.remindersRepository.getParentAnchor(
        userId,
        parentKind,
        input.entityId,
        timeZone
      );
      if (!anchor) {
        throw AppError.validation(
          [
            {
              field: 'entityId',
              message: 'Owned, active parent with a due or start time is required'
            }
          ],
          'Parent has no usable reminder anchor'
        );
      }
      offsetMinutes = input.offsetMinutes;
      remindAt = new Date(anchor.getTime() - offsetMinutes * 60_000);
    } else {
      // Unreachable for schema-validated input; retain a fail-closed service rule.
      throw AppError.validation(
        [{ field: 'remindAt', message: 'remindAt or offsetMinutes is required' }],
        'Provide exactly one of remindAt or offsetMinutes'
      );
    }

    if (remindAt.getTime() < Date.now() - 60_000) {
      throw AppError.validation(
        [
          {
            field: input.offsetMinutes === undefined ? 'remindAt' : 'offsetMinutes',
            message: 'Choose a future reminder time'
          }
        ],
        'Reminder time cannot be more than one minute in the past'
      );
    }

    try {
      return await this.remindersRepository.create({
        userId,
        parentKind,
        parentId: input.entityId,
        source: 'user',
        remindAt,
        offsetMinutes,
        channel: input.channel,
        dedupeKey: null
      });
    } catch (error) {
      if (error instanceof AppError && error.code === 'NOT_FOUND') {
        throw AppError.validation(
          [{ field: 'entityId', message: 'An owned, non-deleted task or event is required' }],
          'Parent entity was not found'
        );
      }
      throw error;
    }
  }

  /** Canonical PATCH /reminders/{id}: only pending user-authored rows. */
  public async updateUserReminder(
    userId: string,
    reminderId: string,
    input: UpdateUserReminderBody,
    timeZone = 'UTC'
  ): Promise<ReminderEntity> {
    const existing = await this.remindersRepository.find(userId, reminderId);
    if (!existing) {
      throw AppError.notFound('Reminder not found');
    }
    if (existing.source !== 'user' || existing.status !== 'pending') {
      throw AppError.conflict('REMINDER_NOT_EDITABLE', 'Only pending user reminders can be edited');
    }

    let remindAt: Date | undefined;
    let offsetMinutes: number | null | undefined;
    if (input.remindAt !== undefined) {
      remindAt = new Date(input.remindAt);
      offsetMinutes = null;
    } else if (input.offsetMinutes !== undefined) {
      const anchor = await this.remindersRepository.getParentAnchor(
        userId,
        existing.entityType,
        existing.entityId,
        timeZone
      );
      if (!anchor) {
        throw AppError.validation(
          [
            {
              field: 'offsetMinutes',
              message: 'A relative reminder requires an active parent anchor'
            }
          ],
          'Parent has no usable reminder anchor'
        );
      }
      offsetMinutes = input.offsetMinutes;
      remindAt = new Date(anchor.getTime() - offsetMinutes * 60_000);
    }

    if (remindAt && remindAt.getTime() < Date.now() - 60_000) {
      throw AppError.validation(
        [
          {
            field: input.remindAt ? 'remindAt' : 'offsetMinutes',
            message: 'Choose a future reminder time'
          }
        ],
        'Reminder time cannot be more than one minute in the past'
      );
    }

    const updated = await this.remindersRepository.update(userId, reminderId, {
      remindAt,
      offsetMinutes,
      channel: input.channel
    });
    if (!updated) {
      throw AppError.conflict('REMINDER_NOT_EDITABLE', 'Only pending user reminders can be edited');
    }
    return updated;
  }

  /** Canonical DELETE /reminders/{id}: only user-authored rows. */
  public async deleteUserReminder(userId: string, reminderId: string): Promise<void> {
    const existing = await this.remindersRepository.find(userId, reminderId);
    if (!existing) {
      throw AppError.notFound('Reminder not found');
    }
    if (existing.source !== 'user') {
      throw AppError.conflict(
        'REMINDER_NOT_EDITABLE',
        'System-generated reminders cannot be deleted'
      );
    }
    if (!(await this.remindersRepository.delete(userId, reminderId))) {
      throw AppError.notFound('Reminder not found');
    }
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
