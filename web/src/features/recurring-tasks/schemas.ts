/**
 * Recurring task form schema — mirrors backend `createRecurringTaskSchema`
 * (strict; recurrence definition required).
 */

import { z } from 'zod';
import { DATE_ONLY_PATTERN, TIME_PATTERN, uuidSchema } from '@/lib/validation/common';

export const recurrenceSchema = z
  .object({
    freq: z.enum(['daily', 'weekly', 'monthly', 'yearly']),
    interval: z.string().regex(/^\d{1,3}$/, 'Enter an interval of 1 or more'),
    byWeekday: z.array(z.number().int().min(1).max(7)),
    startDate: z.string().regex(DATE_ONLY_PATTERN, 'Enter a valid start date'),
    endDate: z
      .union([z.string().regex(DATE_ONLY_PATTERN, 'Enter a valid end date'), z.literal('')])
      .nullable()
      .optional(),
    occurrenceLimit: z
      .union([z.string().regex(/^\d{1,4}$/, 'Enter a number'), z.literal('')])
      .nullable()
      .optional()
  })
  .refine((data) => data.freq !== 'weekly' || data.byWeekday.length > 0, {
    path: ['byWeekday'],
    message: 'Pick at least one weekday for weekly recurrence'
  })
  .refine((data) => !data.endDate || data.endDate >= data.startDate, {
    path: ['endDate'],
    message: 'End date must be on or after the start date'
  });

export const recurringFormSchema = z.object({
  title: z
    .string()
    .trim()
    .min(1, 'Title is required')
    .max(300, 'Title must not exceed 300 characters'),
  description: z.string().max(10000, 'Description is too long').nullable().optional(),
  projectId: z
    .union([uuidSchema, z.literal('')])
    .nullable()
    .optional(),
  priority: z.enum(['none', 'low', 'medium', 'high']),
  estimateMinutes: z
    .union([z.string().regex(/^\d{1,4}$/, 'Enter minutes'), z.literal('')])
    .nullable()
    .optional(),
  dueTime: z
    .union([z.string().regex(TIME_PATTERN, 'Enter a valid time (HH:mm)'), z.literal('')])
    .nullable()
    .optional(),
  reminderOffsetMinutes: z
    .union([z.string().regex(/^\d{1,5}$/, 'Enter minutes'), z.literal('')])
    .nullable()
    .optional(),
  status: z.enum(['active', 'paused', 'ended']),
  recurrence: recurrenceSchema
});

export type RecurringFormValues = z.infer<typeof recurringFormSchema>;

export const recurringFormDefaults: RecurringFormValues = {
  title: '',
  description: '',
  projectId: '',
  priority: 'none',
  estimateMinutes: '',
  dueTime: '',
  reminderOffsetMinutes: '',
  status: 'active',
  recurrence: {
    freq: 'daily',
    interval: '1',
    byWeekday: [],
    startDate: '',
    endDate: '',
    occurrenceLimit: ''
  }
};

const emptyToNull = (value: string | null | undefined): string | null =>
  value && value.trim().length > 0 ? value.trim() : null;

function toIntOrNull(value: string | null | undefined): number | null {
  return value && /^\d+$/.test(value) ? Number.parseInt(value, 10) : null;
}

export function toRecurringBody(values: RecurringFormValues): {
  title: string;
  description: string | null;
  projectId: string | null;
  priority: RecurringFormValues['priority'];
  estimateMinutes: number | null;
  dueTime: string | null;
  reminderOffsetMinutes: number | null;
  status: RecurringFormValues['status'];
  recurrence: {
    freq: 'daily' | 'weekly' | 'monthly' | 'yearly';
    interval: number;
    byWeekday: number[] | null;
    startDate: string;
    endDate: string | null;
    occurrenceLimit: number | null;
  };
} {
  const interval = Number.parseInt(values.recurrence.interval, 10) || 1;
  const estimate = toIntOrNull(values.estimateMinutes);
  const reminder = toIntOrNull(values.reminderOffsetMinutes);
  return {
    title: values.title.trim(),
    description: values.description ? values.description : null,
    projectId: emptyToNull(values.projectId),
    priority: values.priority,
    estimateMinutes: estimate !== null && estimate >= 1 && estimate <= 1440 ? estimate : null,
    dueTime: emptyToNull(values.dueTime),
    reminderOffsetMinutes:
      reminder !== null && reminder >= 0 && reminder <= 43200 ? reminder : null,
    status: values.status,
    recurrence: {
      freq: values.recurrence.freq,
      interval: interval >= 1 ? interval : 1,
      byWeekday:
        values.recurrence.freq === 'weekly' && values.recurrence.byWeekday.length > 0
          ? [...values.recurrence.byWeekday].sort((a, b) => a - b)
          : null,
      startDate: values.recurrence.startDate,
      endDate: emptyToNull(values.recurrence.endDate),
      occurrenceLimit: toIntOrNull(values.recurrence.occurrenceLimit)
    }
  };
}
