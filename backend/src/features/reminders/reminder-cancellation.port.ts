/**
 * src/features/reminders/reminder-cancellation.port.ts
 *
 * Hexagonal port for the one reminder operation other features need when a
 * parent entity is deleted: cancelling its pending reminders. Task, habit
 * and money services depend on this interface instead of the reminders
 * repository (R-20), keeping cross-feature coupling at the domain-port
 * level. PgRemindersRepository implements it; the composition root wires
 * the implementation.
 */

import type { ReminderParentKind } from './reminders.types.js';

export interface ReminderCancellationPort {
  /** Cancels pending reminders attached to a parent entity. */
  cancelPendingFor(parentKind: ReminderParentKind, parentId: string): Promise<number>;
}
