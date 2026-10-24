/**
 * src/features/reminders/reminders.validation.ts
 *
 * Implements Section 16.4 & FR-REM-01..06: Zod schemas for the Unified
 * Reminders API (task / habit / event / subscription parents).
 */

import { z } from 'zod';

export const reminderParentKindSchema = z.enum(['task', 'habit', 'event', 'subscription']);

const uuidSchema = z.guid('id must be a valid UUID');

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
      .string({ error: 'remindAt is required' })
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

const instantSchema = z
  .string()
  .datetime({ offset: true, message: 'remindAt must be a valid ISO 8601 datetime' });
const offsetSchema = z
  .number()
  .int('offsetMinutes must be an integer')
  .min(0, 'offsetMinutes must be between 0 and 43200')
  .max(43200, 'offsetMinutes must be between 0 and 43200');

/** POST /reminders: the specification's canonical top-level create contract. */
export const createUserReminderSchema = z
  .object({
    entityType: z.enum(['task', 'event']),
    entityId: uuidSchema,
    remindAt: instantSchema.optional(),
    offsetMinutes: offsetSchema.optional(),
    channel: z.enum(['push', 'in_app']).default('in_app')
  })
  .strict()
  .superRefine((data, ctx) => {
    if ((data.remindAt === undefined) === (data.offsetMinutes === undefined)) {
      ctx.addIssue({
        code: 'custom',
        message: 'Provide exactly one of remindAt or offsetMinutes',
        path: ['remindAt']
      });
    }
  });

/** PATCH /reminders/{id}: only a pending user-authored row may be edited. */
export const updateUserReminderSchema = z
  .object({
    remindAt: instantSchema.optional(),
    offsetMinutes: offsetSchema.optional(),
    channel: z.enum(['push', 'in_app']).optional()
  })
  .strict()
  .superRefine((data, ctx) => {
    if (
      data.remindAt === undefined &&
      data.offsetMinutes === undefined &&
      data.channel === undefined
    ) {
      ctx.addIssue({
        code: 'custom',
        message: 'At least one editable field is required',
        path: []
      });
    }
    if (data.remindAt !== undefined && data.offsetMinutes !== undefined) {
      ctx.addIssue({
        code: 'custom',
        message: 'Provide only one of remindAt or offsetMinutes',
        path: ['remindAt']
      });
    }
  });

export const reminderIdParamSchema = z.object({
  id: uuidSchema
});

export type CreateUserReminderBody = z.infer<typeof createUserReminderSchema>;
export type UpdateUserReminderBody = z.infer<typeof updateUserReminderSchema>;
