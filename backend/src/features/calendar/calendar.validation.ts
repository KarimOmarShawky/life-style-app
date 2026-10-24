/**
 * src/features/calendar/calendar.validation.ts
 *
 * Implements Section 14.14–14.15 & AC-CAL-01: Calendar Events & Reminders Zod Validation Schemas.
 */

import { z } from 'zod';

export const createReminderSchema = z
  .object({
    channel: z.enum(['push', 'in_app', 'email']).default('push'),
    offsetMinutes: z.number().int().min(0).max(43200).nullable().optional(),
    remindAt: z.string().datetime().optional()
  })
  .strict();

export const createEventSchema = z
  .object({
    title: z
      .string({ error: 'Title is required' })
      .trim()
      .min(1, 'Title must be at least 1 character long')
      .max(200, 'Title cannot exceed 200 characters'),
    description: z
      .string()
      .max(5000, 'Description cannot exceed 5000 characters')
      .nullable()
      .optional(),
    location: z.string().max(300, 'Location cannot exceed 300 characters').nullable().optional(),
    startAt: z.string({ error: 'startAt is required' }).datetime({
      message: 'startAt must be a valid ISO 8601 datetime'
    }),
    endAt: z.string({ error: 'endAt is required' }).datetime({
      message: 'endAt must be a valid ISO 8601 datetime'
    }),
    allDay: z.boolean().optional().default(false),
    timezone: z.string({ error: 'timezone is required' }).trim().min(1).max(64),
    reminders: z.array(createReminderSchema).optional()
  })
  .strict()
  .refine((data) => new Date(data.endAt) >= new Date(data.startAt), {
    message: 'endAt must be greater than or equal to startAt',
    path: ['endAt']
  });

export const updateEventSchema = z
  .object({
    title: z
      .string()
      .trim()
      .min(1, 'Title must be at least 1 character long')
      .max(200, 'Title cannot exceed 200 characters')
      .optional(),
    description: z
      .string()
      .max(5000, 'Description cannot exceed 5000 characters')
      .nullable()
      .optional(),
    location: z.string().max(300, 'Location cannot exceed 300 characters').nullable().optional(),
    startAt: z
      .string()
      .datetime({ message: 'startAt must be a valid ISO 8601 datetime' })
      .optional(),
    endAt: z.string().datetime({ message: 'endAt must be a valid ISO 8601 datetime' }).optional(),
    allDay: z.boolean().optional(),
    timezone: z.string().trim().min(1).max(64).optional(),
    version: z.number().int().positive().optional()
  })
  .strict()
  .refine(
    (data) => {
      if (data.startAt && data.endAt) {
        return new Date(data.endAt) >= new Date(data.startAt);
      }
      return true;
    },
    {
      message: 'endAt must be greater than or equal to startAt',
      path: ['endAt']
    }
  );

export const listEventsQuerySchema = z
  .object({
    from: z.string().datetime().optional(),
    to: z.string().datetime().optional(),
    includeDeleted: z
      .enum(['true', 'false'])
      .transform((v) => v === 'true')
      .optional()
  })
  .strict();

export const conflictQuerySchema = z
  .object({
    startAt: z.string({ error: 'startAt is required' }).datetime({
      message: 'startAt must be a valid ISO 8601 datetime'
    }),
    endAt: z.string({ error: 'endAt is required' }).datetime({
      message: 'endAt must be a valid ISO 8601 datetime'
    }),
    excludeEventId: z.guid('Invalid excludeEventId format').optional()
  })
  .strict()
  .refine((data) => new Date(data.endAt) >= new Date(data.startAt), {
    message: 'endAt must be greater than or equal to startAt',
    path: ['endAt']
  });

export const agendaQuerySchema = z
  .object({
    date: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/, 'Date must be formatted as YYYY-MM-DD')
      .optional()
  })
  .strict();

export const eventIdParamSchema = z
  .object({
    id: z.guid('Invalid event ID format')
  })
  .strict();

export const eventReminderParamSchema = z
  .object({
    id: z.guid('Invalid event ID format'),
    reminderId: z.guid('Invalid reminder ID format')
  })
  .strict();
