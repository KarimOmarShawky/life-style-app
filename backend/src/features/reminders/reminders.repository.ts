/**
 * src/features/reminders/reminders.repository.ts
 *
 * Implements Section 4.3: Repository interface for the Unified Reminders
 * domain. Ownership is enforced at the database level by composite foreign
 * keys (parent_id, user_id) — this feature never queries other features'
 * tables.
 */

import type {
  ReminderEntity,
  CreateReminderRepoInput,
  ListRemindersFilter
} from './reminders.types.js';
import type { ReminderCancellationPort } from './reminder-cancellation.port.js';

export interface RemindersRepository extends ReminderCancellationPort {
  create(input: CreateReminderRepoInput): Promise<ReminderEntity>;
  list(userId: string, filter: ListRemindersFilter): Promise<ReminderEntity[]>;
  find(userId: string, reminderId: string): Promise<ReminderEntity | null>;
  delete(userId: string, reminderId: string): Promise<boolean>;
}
