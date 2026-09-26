/** Habit request schemas (spec section 13). */
import { z } from 'zod';

import {
  isoDateSchema,
  paginationQuerySchema,
  trimmedString,
  uuidSchema,
} from '@/core/validation/common';
import { HABIT_FREQUENCIES } from './habit.types';

const frequencySchema = z.enum(HABIT_FREQUENCIES, {
  errorMap: () => ({ message: `frequency must be one of: ${HABIT_FREQUENCIES.join(', ')}` }),
});

export const createHabitSchema = z
  .object({
    title: trimmedString(200, 'title'),
    frequency: frequencySchema.optional(),
  })
  .strict();

export const updateHabitSchema = z
  .object({
    title: trimmedString(200, 'title').optional(),
    frequency: frequencySchema.optional(),
    isArchived: z.boolean().optional(),
  })
  .strict()
  .refine((value) => Object.keys(value).length > 0, {
    message: 'provide at least one field to update',
  });

/**
 * `asOf` decides which period counts as "current" when streaks are computed.
 *
 * TIMEZONES. The server stores dates, not instants, and its own idea of today is
 * UTC. For a user two hours ahead, a habit completed at 01:00 local belongs to a
 * day the server has not reached. Until a timezone is stored on the user, the
 * client passes its own local date here and gets streaks that agree with the
 * calendar the user is looking at. It is display-only: a forged value changes
 * nothing but which day the caller's own numbers are measured against.
 */
const asOfSchema = isoDateSchema.optional();

export const listHabitsQuerySchema = paginationQuerySchema
  .extend({
    archived: z
      .enum(['true', 'false'])
      .optional()
      .transform((value) => value === 'true'),
    asOf: asOfSchema,
  })
  .strict();

export const habitDetailQuerySchema = z.object({ asOf: asOfSchema }).strict();

/**
 * Marking a day.
 *
 * `date` defaults to today and may not be in the future: a habit cannot be
 * completed before the day arrives, and allowing it would let a client
 * manufacture a streak that the calendar does not support.
 */
export const logHabitSchema = z
  .object({
    date: isoDateSchema.optional(),
    completed: z.boolean().optional(),
  })
  .strict();

export const habitLogsQuerySchema = z
  .object({
    from: isoDateSchema.optional(),
    to: isoDateSchema.optional(),
  })
  .strict()
  .refine((value) => value.from === undefined || value.to === undefined || value.from <= value.to, {
    message: 'from must not be after to',
    path: ['from'],
  });

export const habitLogParamsSchema = z.object({ id: uuidSchema, date: isoDateSchema }).strict();

export type CreateHabitBody = z.infer<typeof createHabitSchema>;
export type UpdateHabitBody = z.infer<typeof updateHabitSchema>;
export type ListHabitsQuery = z.infer<typeof listHabitsQuerySchema>;
export type LogHabitBody = z.infer<typeof logHabitSchema>;
export type HabitLogsQuery = z.infer<typeof habitLogsQuerySchema>;
