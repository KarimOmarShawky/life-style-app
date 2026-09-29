/**
 * Habit form schema — mirrors backend `createHabitSchema` / `updateHabitSchema`
 * (runtime: field `name`, recurrence `{freq daily|weekly, interval, byWeekday}`).
 */

import { z } from 'zod';
import {
  DATE_ONLY_PATTERN,
  HEX_COLOR_PATTERN,
  TIME_PATTERN,
  uuidSchema
} from '@/lib/validation/common';

export const habitFormSchema = z
  .object({
    name: z
      .string()
      .trim()
      .min(1, 'Habit name is required')
      .max(120, 'Habit name must not exceed 120 characters'),
    description: z.string().max(5000, 'Description is too long').nullable().optional(),
    startDate: z.string().regex(DATE_ONLY_PATTERN, 'Enter a valid start date'),
    reminderTime: z
      .union([z.string().regex(TIME_PATTERN, 'Enter a valid time (HH:mm)'), z.literal('')])
      .nullable()
      .optional(),
    color: z
      .union([z.string().regex(HEX_COLOR_PATTERN, 'Use a hex color like #315C4C'), z.literal('')])
      .nullable()
      .optional(),
    goalId: z
      .union([uuidSchema, z.literal('')])
      .nullable()
      .optional(),
    freq: z.enum(['daily', 'weekly']),
    interval: z.string().regex(/^\d{1,3}$/, 'Enter 1 or more'),
    byWeekday: z.array(z.number().int().min(1).max(7))
  })
  .refine((data) => data.freq !== 'weekly' || data.byWeekday.length > 0, {
    path: ['byWeekday'],
    message: 'Pick at least one weekday'
  });

export type HabitFormValues = z.infer<typeof habitFormSchema>;

export const habitFormDefaults: HabitFormValues = {
  name: '',
  description: '',
  startDate: '',
  reminderTime: '',
  color: '',
  goalId: '',
  freq: 'daily',
  interval: '1',
  byWeekday: []
};

const emptyToNull = (value: string | null | undefined): string | null =>
  value && value.trim().length > 0 ? value.trim() : null;

export function toHabitBody(values: HabitFormValues): {
  name: string;
  description: string | null;
  startDate: string;
  reminderTime: string | null;
  color: string | null;
  goalId: string | null;
  recurrence: { freq: 'daily' | 'weekly'; interval: number; byWeekday: number[] | null };
} {
  const interval = Number.parseInt(values.interval, 10) || 1;
  return {
    name: values.name.trim(),
    description: values.description ? values.description : null,
    startDate: values.startDate,
    reminderTime: emptyToNull(values.reminderTime),
    color: emptyToNull(values.color),
    goalId: emptyToNull(values.goalId),
    recurrence: {
      freq: values.freq,
      interval: interval >= 1 ? interval : 1,
      byWeekday:
        values.freq === 'weekly' && values.byWeekday.length > 0
          ? [...values.byWeekday].sort((a, b) => a - b)
          : null
    }
  };
}
