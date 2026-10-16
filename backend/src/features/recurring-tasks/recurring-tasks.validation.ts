/**
 * src/features/recurring-tasks/recurring-tasks.validation.ts
 *
 * Implements Section 14.6: Recurring Tasks Zod Validation Schemas.
 */

import { z } from 'zod';
import { taskPrioritySchema } from '../tasks/tasks.validation.js';

const DATE_REGEX = /^\d{4}-\d{2}-\d{2}$/;
const TIME_REGEX = /^([01]\d|2[0-3]):[0-5]\d$/;

export const recurringTaskStatusSchema = z.enum(['active', 'paused', 'ended']);
export const recurrenceFreqSchema = z.enum(['daily', 'weekly', 'monthly', 'yearly']);

export const recurrenceDefinitionSchema = z
  .object({
    freq: recurrenceFreqSchema,
    interval: z.number().int().min(1).max(365).default(1),
    byWeekday: z.array(z.number().int().min(1).max(7)).min(1).max(7).optional().nullable(),
    byMonthDay: z
      .number()
      .int()
      .refine((v) => v === -1 || (v >= 1 && v <= 31), {
        message: 'byMonthDay must be 1..31 or -1'
      })
      .optional()
      .nullable(),
    byMonth: z.number().int().min(1).max(12).optional().nullable(),
    startDate: z.string().regex(DATE_REGEX, { message: 'startDate must be in YYYY-MM-DD format' }),
    endDate: z
      .string()
      .regex(DATE_REGEX, { message: 'endDate must be in YYYY-MM-DD format' })
      .optional()
      .nullable(),
    occurrenceLimit: z.number().int().min(1).optional().nullable()
  })
  .strict()
  .refine(
    (data) => {
      if (data.endDate && data.startDate) {
        return data.endDate >= data.startDate;
      }
      return true;
    },
    {
      path: ['endDate'],
      message: 'endDate must be on or after startDate'
    }
  )
  .refine((data) => !(data.endDate != null && data.occurrenceLimit != null), {
    path: ['occurrenceLimit'],
    message: 'endDate and occurrenceLimit are mutually exclusive'
  })
  .refine(
    (data) => {
      if (data.freq === 'daily') {
        return data.byWeekday == null && data.byMonthDay == null && data.byMonth == null;
      }
      if (data.freq === 'weekly') {
        return (
          Array.isArray(data.byWeekday) &&
          data.byWeekday.length > 0 &&
          data.byMonthDay == null &&
          data.byMonth == null
        );
      }
      if (data.freq === 'monthly') {
        return data.byMonthDay != null && data.byWeekday == null && data.byMonth == null;
      }
      if (data.freq === 'yearly') {
        return data.byMonth != null && data.byMonthDay != null && data.byWeekday == null;
      }
      return true;
    },
    {
      path: ['freq'],
      message:
        'Recurrence fields must match frequency (daily: none; weekly: byWeekday; monthly: byMonthDay; yearly: byMonth + byMonthDay)'
    }
  );

export const createRecurringTaskSchema = z
  .object({
    title: z
      .string()
      .trim()
      .min(1, { message: 'Title cannot be blank' })
      .max(300, { message: 'Title must not exceed 300 characters' }),
    description: z
      .string()
      .max(10000, { message: 'Description must not exceed 10000 characters' })
      .optional()
      .nullable(),
    projectId: z.string().uuid({ message: 'projectId must be a valid UUID' }).optional().nullable(),
    priority: taskPrioritySchema.default('none'),
    estimateMinutes: z.number().int().min(1).max(1440).optional().nullable(),
    dueTime: z
      .string()
      .regex(TIME_REGEX, { message: 'dueTime must be in HH:mm format' })
      .optional()
      .nullable(),
    reminderOffsetMinutes: z.number().int().min(0).max(43200).optional().nullable(),
    status: recurringTaskStatusSchema.default('active'),
    recurrence: recurrenceDefinitionSchema
  })
  .strict();

export type CreateRecurringTaskInput = z.infer<typeof createRecurringTaskSchema>;

export const updateRecurringTaskSchema = z
  .object({
    title: z
      .string()
      .trim()
      .min(1, { message: 'Title cannot be blank' })
      .max(300, { message: 'Title must not exceed 300 characters' })
      .optional(),
    description: z
      .string()
      .max(10000, { message: 'Description must not exceed 10000 characters' })
      .optional()
      .nullable(),
    projectId: z.string().uuid({ message: 'projectId must be a valid UUID' }).optional().nullable(),
    priority: taskPrioritySchema.optional(),
    estimateMinutes: z.number().int().min(1).max(1440).optional().nullable(),
    dueTime: z
      .string()
      .regex(TIME_REGEX, { message: 'dueTime must be in HH:mm format' })
      .optional()
      .nullable(),
    reminderOffsetMinutes: z.number().int().min(0).max(43200).optional().nullable(),
    status: recurringTaskStatusSchema.optional(),
    recurrence: recurrenceDefinitionSchema.optional(),
    version: z.number().int().min(1).optional()
  })
  .strict();

export type UpdateRecurringTaskInput = z.infer<typeof updateRecurringTaskSchema>;

export const listRecurringTasksQuerySchema = z
  .object({
    status: recurringTaskStatusSchema.optional(),
    limit: z
      .string()
      .transform((val) => parseInt(val, 10))
      .pipe(z.number().min(1).max(100))
      .default('25'),
    cursor: z.string().optional()
  })
  .strict();

export type ListRecurringTasksQuery = z.infer<typeof listRecurringTasksQuerySchema>;

export const recurringTaskIdParamSchema = z
  .object({
    id: z.string().uuid({ message: 'Recurring task ID must be a valid UUID' })
  })
  .strict();
