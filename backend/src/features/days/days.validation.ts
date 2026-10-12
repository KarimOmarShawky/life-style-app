/**
 * src/features/days/days.validation.ts
 *
 * Zod schemas for the Days (Daily Plan) endpoints.
 */

import { z } from 'zod';

export const dayParamSchema = z.object({
  date: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, 'date must be YYYY-MM-DD')
    .describe("Day to plan, in the user's timezone (YYYY-MM-DD)")
});
