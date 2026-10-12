/**
 * src/features/reminders/reminders.validation.ts
 *
 * Implements Section 16.4 & FR-REM-01..06: Zod schemas for the Unified
 * Reminders API (task / habit / event / subscription parents).
 */

import { z } from 'zod';

export const reminderParentKindSchema = z.enum(['task', 'habit', 'event', 'subscription']);

const uuidSchema = z.string().uuid('id must be a valid UUID');

export const parentParamsSchema = z.object({
  id: uuidSchema
});

export const reminderParamsSchema = z.object({
  id: uuidSchema,
  reminderId: uuidSchema
});

export const createReminderSchema = z
  .object({
    remindAt: z
      .string({ required_error: 'remindAt is required' })
      .datetime({ offset: true, message: 'remindAt must be a valid ISO 8601 datetime' }),
    channel: z.enum(['push', 'in_app', 'email']).optional(),
    offsetMinutes: z
      .number()
      .int('offsetMinutes must be an integer')
      .min(0, 'offsetMinutes must be between 0 and 43200')
      .max(43200, 'offsetMinutes must be between 0 and 43200')
      .optional(),
    dedupeKey: z.string().trim().min(1).max(200).optional()
  })
  .strict();

export const listRemindersQuerySchema = z.object({
  status: z.enum(['pending', 'processing', 'sent', 'failed', 'cancelled']).optional(),
  from: z
    .string()
    .datetime({ offset: true, message: 'from must be a valid ISO 8601 datetime' })
    .optional(),
  to: z
    .string()
    .datetime({ offset: true, message: 'to must be a valid ISO 8601 datetime' })
    .optional(),
  entityType: reminderParentKindSchema.optional()
});

export type CreateReminderBody = z.infer<typeof createReminderSchema>;
export type ListRemindersQuery = z.infer<typeof listRemindersQuerySchema>;
