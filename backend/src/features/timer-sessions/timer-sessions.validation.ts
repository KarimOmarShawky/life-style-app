/**
 * src/features/timer-sessions/timer-sessions.validation.ts
 *
 * Implements Section 14.7 & AC-TMR-02: Timer Sessions Zod Validation Schemas.
 */

import { z } from 'zod';

export const timerModeSchema = z.enum(['stopwatch', 'countdown']);

export const createTimerSessionSchema = z
  .object({
    taskId: z.string().uuid({ message: 'taskId must be a valid UUID' }),
    mode: timerModeSchema.default('stopwatch'),
    plannedSeconds: z
      .number()
      .int()
      .min(60, { message: 'plannedSeconds must be at least 60 seconds (1 minute)' })
      .max(43200, { message: 'plannedSeconds must not exceed 43200 seconds (12 hours)' })
      .optional()
      .nullable()
  })
  .strict()
  .refine(
    (data) => {
      if (data.mode === 'countdown') {
        return typeof data.plannedSeconds === 'number' && data.plannedSeconds >= 60;
      }
      return true;
    },
    {
      path: ['plannedSeconds'],
      message: 'plannedSeconds is required for countdown mode'
    }
  );

export type CreateTimerSessionInput = z.infer<typeof createTimerSessionSchema>;

export const listTimerSessionsQuerySchema = z
  .object({
    taskId: z.string().uuid().optional(),
    from: z.string().datetime().optional(),
    to: z.string().datetime().optional(),
    limit: z
      .string()
      .transform((val) => parseInt(val, 10))
      .pipe(z.number().min(1).max(100))
      .default('25'),
    cursor: z.string().optional()
  })
  .strict();

export type ListTimerSessionsQuery = z.infer<typeof listTimerSessionsQuerySchema>;

export const timerSessionIdParamSchema = z
  .object({
    id: z.string().uuid({ message: 'Timer session ID must be a valid UUID' })
  })
  .strict();
