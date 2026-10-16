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
    .refine((date) => date >= '2000-01-01' && date <= '2100-12-31', 'date must be between 2000-01-01 and 2100-12-31')
    .describe("Day to plan, in the user's timezone (YYYY-MM-DD)")
}).strict();
