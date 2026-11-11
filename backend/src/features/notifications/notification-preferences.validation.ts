/**
 * src/features/notifications/notification-preferences.validation.ts
 *
 * Feature guide G2 (ADR-046). Strict body for PUT /notification-preferences:
 * the complete settings object and nothing else. Unknown keys are rejected.
 */

import { z } from 'zod';

export const NOTIFICATION_DAILY_LIMIT_MAX = 50;

const clockTime = z
  .string()
  .regex(/^([01]\d|2[0-3]):[0-5]\d$/, { message: 'Use a 24-hour HH:MM time' });

export const notificationPreferencesSchema = z
  .object({
    notificationsEnabled: z.boolean(),
    quietHours: z
      .object({ start: clockTime, end: clockTime })
      .strict()
      .refine((quiet) => quiet.start !== quiet.end, {
        message: 'Quiet hours need different start and end times',
        path: ['end']
      })
      .nullable(),
    dailyLimit: z.number().int().min(1).max(NOTIFICATION_DAILY_LIMIT_MAX).nullable(),
    digestEnabled: z.boolean(),
    criticalBreaksQuiet: z.boolean()
  })
  .strict();

export type NotificationPreferencesBody = z.infer<typeof notificationPreferencesSchema>;
