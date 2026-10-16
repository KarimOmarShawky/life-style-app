/**
 * src/features/days/days.validation.ts
 *
 * Zod schemas for the Days (Daily Plan) endpoints.
 */

import { z } from 'zod';

export const dayParamSchema = z.object({
  date: z
    .string()
    .date('date must be a valid calendar date (YYYY-MM-DD)')
    .refine((date) => date >= '1900-01-01' && date <= '9999-12-31', 'date is out of range')
    .describe("Day to plan, in the user's timezone (YYYY-MM-DD)")
}).strict();
