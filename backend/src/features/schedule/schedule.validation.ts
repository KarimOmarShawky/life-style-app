/** Event and reminder request schemas (spec section 13). */
import { z } from 'zod';

import {
  isoDateTimeSchema,
  nullableText,
  paginationQuerySchema,
  trimmedString,
  uuidSchema,
} from '@/core/validation/common';

import { EVENT_LINK_TYPES, REMINDER_ENTITY_TYPES, REMINDER_STATUSES } from './schedule.types';

/**
 * Two ISO instants in order.
 *
 * Compared as parsed instants, never as strings. `2026-09-24T09:00:00Z` and
 * `2026-09-24T12:00:00+03:00` are the same moment, and a lexical comparison
 * calls the second one later. The strings have already been validated as real
 * date-times by the time this runs, so `Date.parse` cannot return NaN here.
 */
function inOrder(earlier: string, later: string): boolean {
  return Date.parse(earlier) <= Date.parse(later);
}

const eventLinkTypeSchema = z.enum(EVENT_LINK_TYPES, {
  errorMap: () => ({ message: `linkedType must be one of: ${EVENT_LINK_TYPES.join(', ')}` }),
});

/**
 * A polymorphic reference is one value spelled across two fields.
 *
 * Both must be supplied together, and both must be null together. The database
 * says the same thing in `events_link_is_complete`; saying it here too is what
 * turns "a type with no id" from a 422 with no field name into one that points
 * at the field the client got wrong.
 */
function linkIsComplete(value: { linkedType?: unknown; linkedId?: unknown }): boolean {
  const typeGiven = value.linkedType !== undefined;
  const idGiven = value.linkedId !== undefined;

  if (typeGiven !== idGiven) {
    return false;
  }
  if (!typeGiven) {
    return true;
  }
  return (value.linkedType === null) === (value.linkedId === null);
}

const LINK_MESSAGE =
  'linkedType and linkedId must be supplied together, and cleared together with null';

// --- Events -----------------------------------------------------------------

export const createEventSchema = z
  .object({
    title: trimmedString(200, 'title'),
    description: nullableText(2000, 'description'),
    startTime: isoDateTimeSchema,
    endTime: isoDateTimeSchema,
    /**
     * A display flag with teeth: the server snaps a flagged event to the whole
     * UTC day, so the times and the flag can never disagree. See DD-024 for why
     * UTC and not the user's own timezone.
     */
    allDay: z.boolean().optional(),
    linkedType: eventLinkTypeSchema.nullable().optional(),
    linkedId: uuidSchema.nullable().optional(),
  })
  .strict()
  .refine((value) => inOrder(value.startTime, value.endTime), {
    message: 'endTime must not be before startTime',
    path: ['endTime'],
  })
  .refine(linkIsComplete, { message: LINK_MESSAGE, path: ['linkedId'] });

export const updateEventSchema = z
  .object({
    title: trimmedString(200, 'title').optional(),
    description: nullableText(2000, 'description'),
    startTime: isoDateTimeSchema.optional(),
    endTime: isoDateTimeSchema.optional(),
    allDay: z.boolean().optional(),
    linkedType: eventLinkTypeSchema.nullable().optional(),
    linkedId: uuidSchema.nullable().optional(),
  })
  .strict()
  .refine((value) => Object.keys(value).length > 0, {
    message: 'provide at least one field to update',
  })
  // Only checkable when the request carries both ends. A patch that moves one
  // end past the stored other end is caught by the database CHECK, which the
  // service translates into the same message (see event.service).
  .refine(
    (value) =>
      value.startTime === undefined ||
      value.endTime === undefined ||
      inOrder(value.startTime, value.endTime),
    { message: 'endTime must not be before startTime', path: ['endTime'] },
  )
  .refine(linkIsComplete, { message: LINK_MESSAGE, path: ['linkedId'] });

export const listEventsQuerySchema = paginationQuerySchema
  .extend({
    from: isoDateTimeSchema.optional(),
    to: isoDateTimeSchema.optional(),
    linkedType: eventLinkTypeSchema.optional(),
  })
  .strict()
  .refine(
    (value) => value.from === undefined || value.to === undefined || inOrder(value.from, value.to),
    { message: 'from must not be after to', path: ['from'] },
  );

// --- Reminders --------------------------------------------------------------

const reminderEntityTypeSchema = z.enum(REMINDER_ENTITY_TYPES, {
  errorMap: () => ({ message: `entityType must be one of: ${REMINDER_ENTITY_TYPES.join(', ')}` }),
});

export const createReminderSchema = z
  .object({
    entityType: reminderEntityTypeSchema,
    entityId: uuidSchema,
    remindAt: isoDateTimeSchema,
    /**
     * Free text such as "15 minutes before". Stored, never interpreted: the
     * instant in `remindAt` is the truth, and parsing this into an offset would
     * create a second source of it that could disagree.
     */
    offsetDescription: nullableText(100, 'offsetDescription'),
  })
  .strict();

export const updateReminderSchema = z
  .object({
    remindAt: isoDateTimeSchema.optional(),
    offsetDescription: nullableText(100, 'offsetDescription'),
  })
  .strict()
  .refine((value) => Object.keys(value).length > 0, {
    message: 'provide at least one field to update',
  });

export const listRemindersQuerySchema = paginationQuerySchema
  .extend({
    status: z
      .enum(REMINDER_STATUSES, {
        errorMap: () => ({ message: `status must be one of: ${REMINDER_STATUSES.join(', ')}` }),
      })
      .optional(),
    entityType: reminderEntityTypeSchema.optional(),
    entityId: uuidSchema.optional(),
  })
  .strict();

/**
 * The delivery queue is read whole, not paged.
 *
 * A cursor would be wrong here: the set changes as the client acknowledges what
 * it was given, so page two of a scan started a moment ago describes a queue
 * that no longer exists. A capped single response is the honest shape — take
 * what is due, deal with it, ask again.
 */
export const dueRemindersQuerySchema = z
  .object({
    limit: z.coerce
      .number()
      .int('limit must be a whole number')
      .min(1, 'limit must be at least 1')
      .max(100, 'limit must be at most 100')
      .default(50),
  })
  .strict();

/** Snooze window: one minute to one week. */
export const snoozeReminderSchema = z
  .object({
    minutes: z.coerce
      .number()
      .int('minutes must be a whole number')
      .min(1, 'minutes must be at least 1')
      .max(10080, 'minutes must be at most 10080 (one week)')
      .default(10),
  })
  .strict();

export type CreateEventBody = z.infer<typeof createEventSchema>;
export type UpdateEventBody = z.infer<typeof updateEventSchema>;
export type ListEventsQuery = z.infer<typeof listEventsQuerySchema>;
export type CreateReminderBody = z.infer<typeof createReminderSchema>;
export type UpdateReminderBody = z.infer<typeof updateReminderSchema>;
export type ListRemindersQuery = z.infer<typeof listRemindersQuerySchema>;
export type DueRemindersQuery = z.infer<typeof dueRemindersQuerySchema>;
export type SnoozeReminderBody = z.infer<typeof snoozeReminderSchema>;
