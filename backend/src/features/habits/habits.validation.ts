/**
 * src/features/habits/habits.validation.ts
 *
 * Implements Section 14.8: Habits Zod Validation Schemas.
 */

import { z } from 'zod';
import { calendarDaySchemaFor } from '../../core/validation/date-only.js';

const TIME_REGEX = /^([01]\d|2[0-3]):[0-5]\d$/;
const COLOR_REGEX = /^#[0-9A-Fa-f]{6}$/;

export const habitStatusSchema = z.enum(['active', 'paused', 'archived']);
export const habitCheckinStatusSchema = z.enum(['done', 'skipped']);

export const habitRecurrenceSchema = z
  .object({
    freq: z.enum(['daily', 'weekly']),
    interval: z.number().int().min(1).default(1),
    byWeekday: z.array(z.number().int().min(1).max(7)).optional().nullable()
  })
  .strict()
  .refine(
    (data) => {
      if (data.freq === 'weekly') {
        return Array.isArray(data.byWeekday) && data.byWeekday.length > 0;
      }
      return true;
    },
    {
      path: ['byWeekday'],
      message: 'byWeekday is required for weekly recurrence'
    }
  );

export const createHabitSchema = z
  .object({
    name: z
      .string()
      .trim()
      .min(1, { message: 'Habit name cannot be blank' })
      .max(120, { message: 'Habit name must not exceed 120 characters' }),
    description: z
      .string()
      .max(5000, { message: 'Description must not exceed 5000 characters' })
      .optional()
      .nullable(),
    startDate: calendarDaySchemaFor('startDate'),
    reminderTime: z
      .string()
      .regex(TIME_REGEX, { message: 'reminderTime must be in HH:mm format' })
      .optional()
      .nullable(),
    color: z
      .string()
      .regex(COLOR_REGEX, { message: 'color must be a valid hex code (#RRGGBB)' })
      .optional()
      .nullable(),
    goalId: z.guid({ message: 'goalId must be a valid UUID' }).optional().nullable(),
    recurrence: habitRecurrenceSchema
  })
  .strict();

export type CreateHabitInput = z.infer<typeof createHabitSchema>;

export const updateHabitSchema = z
  .object({
    name: z
      .string()
      .trim()
      .min(1, { message: 'Habit name cannot be blank' })
      .max(120, { message: 'Habit name must not exceed 120 characters' })
      .optional(),
    description: z
      .string()
      .max(5000, { message: 'Description must not exceed 5000 characters' })
      .optional()
      .nullable(),
    status: habitStatusSchema.optional(),
    reminderTime: z
      .string()
      .regex(TIME_REGEX, { message: 'reminderTime must be in HH:mm format' })
      .optional()
      .nullable(),
    color: z
      .string()
      .regex(COLOR_REGEX, { message: 'color must be a valid hex code (#RRGGBB)' })
      .optional()
      .nullable(),
    goalId: z.guid({ message: 'goalId must be a valid UUID' }).optional().nullable(),
    recurrence: habitRecurrenceSchema.optional(),
    version: z.number().int().min(1).optional()
  })
  .strict();

export type UpdateHabitInput = z.infer<typeof updateHabitSchema>;

export const putCheckinSchema = z
  .object({
    status: habitCheckinStatusSchema,
    note: z
      .string()
      .max(500, { message: 'Note must not exceed 500 characters' })
      .optional()
      .nullable()
  })
  .strict();

export type PutCheckinInput = z.infer<typeof putCheckinSchema>;

export const getCheckinsQuerySchema = z
  .object({
    from: calendarDaySchemaFor('from'),
    to: calendarDaySchemaFor('to')
  })
  .strict()
  .refine(
    (data) => {
      const fromDt = new Date(data.from).getTime();
      const toDt = new Date(data.to).getTime();
      const diffDays = Math.round((toDt - fromDt) / (24 * 60 * 60 * 1000));
      return toDt >= fromDt && diffDays <= 366;
    },
    {
      path: ['to'],
      message: 'Date range must be between 0 and 366 days and to >= from'
    }
  );

export type GetCheckinsQuery = z.infer<typeof getCheckinsQuerySchema>;

export const listHabitsQuerySchema = z
  .object({
    status: habitStatusSchema.optional(),
    limit: z
      .string()
      .transform((val) => parseInt(val, 10))
      .pipe(z.number().min(1).max(100))
      .default(25),
    cursor: z.string().optional()
  })
  .strict();

export type ListHabitsQuery = z.infer<typeof listHabitsQuerySchema>;

export const habitIdParamSchema = z
  .object({
    id: z.guid({ message: 'Habit ID must be a valid UUID' })
  })
  .strict();

export const checkinDateParamSchema = z
  .object({
    id: z.guid({ message: 'Habit ID must be a valid UUID' }),
    date: calendarDaySchemaFor('Date')
  })
  .strict();
