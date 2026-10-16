/**
 * src/features/habits/habits.validation.ts
 *
 * Implements Section 14.8: Habits Zod Validation Schemas.
 */

import { z } from 'zod';

const DATE_REGEX = /^\d{4}-\d{2}-\d{2}$/;
const TIME_REGEX = /^([01]\d|2[0-3]):[0-5]\d$/;
const COLOR_REGEX = /^#[0-9A-Fa-f]{6}$/;

export const habitStatusSchema = z.enum(['active', 'paused', 'archived']);
export const habitCheckinStatusSchema = z.enum(['done', 'skipped']);

export const habitRecurrenceSchema = z
  .object({
    freq: z.enum(['daily', 'weekly']),
    interval: z.number().int().min(1).max(365).default(1),
    byWeekday: z.array(z.number().int().min(1).max(7)).min(1).max(7).optional().nullable()
  })
  .strict()
  .refine(
    (data) => {
      if (data.freq === 'weekly') {
        return Array.isArray(data.byWeekday) && data.byWeekday.length > 0;
      }
      if (data.freq === 'daily') {
        return data.byWeekday == null;
      }
      return true;
    },
    {
      path: ['byWeekday'],
      message: 'byWeekday is required for weekly recurrence and must be omitted for daily recurrence'
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
      .max(2000, { message: 'Description must not exceed 2000 characters' })
      .optional()
      .nullable(),
    startDate: z.string().regex(DATE_REGEX, { message: 'startDate must be in YYYY-MM-DD format' }),
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
    goalId: z.string().uuid({ message: 'goalId must be a valid UUID' }).optional().nullable(),
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
      .max(2000, { message: 'Description must not exceed 2000 characters' })
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
    goalId: z.string().uuid({ message: 'goalId must be a valid UUID' }).optional().nullable(),
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
    from: z.string().regex(DATE_REGEX, { message: 'from must be in YYYY-MM-DD format' }),
    to: z.string().regex(DATE_REGEX, { message: 'to must be in YYYY-MM-DD format' })
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
      .default('25'),
    cursor: z.string().optional()
  })
  .strict();

export type ListHabitsQuery = z.infer<typeof listHabitsQuerySchema>;

export const habitIdParamSchema = z
  .object({
    id: z.string().uuid({ message: 'Habit ID must be a valid UUID' })
  })
  .strict();

export const checkinDateParamSchema = z
  .object({
    id: z.string().uuid({ message: 'Habit ID must be a valid UUID' }),
    date: z.string().regex(DATE_REGEX, { message: 'Date must be in YYYY-MM-DD format' })
  })
  .strict();
