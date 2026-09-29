/**
 * Calendar event form schema — mirrors backend `createEventSchema`.
 * Wall-clock date + time are composed in the user's stored timezone and
 * converted to UTC instants before submission.
 */

import { z } from 'zod';
import { DATE_ONLY_PATTERN, TIME_PATTERN } from '@/lib/validation/common';

export const eventFormSchema = z
  .object({
    title: z
      .string()
      .trim()
      .min(1, 'Title is required')
      .max(200, 'Title must not exceed 200 characters'),
    description: z.string().max(5000, 'Description is too long').nullable().optional(),
    location: z.string().max(300, 'Location is too long').nullable().optional(),
    startDate: z.string().regex(DATE_ONLY_PATTERN, 'Enter a valid date'),
    startTime: z.string().regex(TIME_PATTERN, 'Enter a valid time'),
    endDate: z.string().regex(DATE_ONLY_PATTERN, 'Enter a valid date'),
    endTime: z.string().regex(TIME_PATTERN, 'Enter a valid time'),
    allDay: z.boolean()
  })
  .refine(
    (data) =>
      data.allDay ||
      Date.parse(`${data.endDate}T${data.endTime}:00Z`) >=
        Date.parse(`${data.startDate}T${data.startTime}:00Z`),
    { path: ['endTime'], message: 'End must be at or after the start' }
  );

export type EventFormValues = z.infer<typeof eventFormSchema>;

export const eventFormDefaults: EventFormValues = {
  title: '',
  description: '',
  location: '',
  startDate: '',
  startTime: '09:00',
  endDate: '',
  endTime: '10:00',
  allDay: false
};
