/**
 * src/features/days/days.validation.ts
 *
 * Zod schemas for the Days (Daily Plan) endpoints.
 *
 * The canonical day route was the first place that rejected impossible days;
 * it now shares the same semantic calendar-day rule as every other feature
 * (V-09) instead of keeping a second, divergent implementation.
 */

import { z } from 'zod';
import { calendarDaySchemaFor } from '../../core/validation/date-only.js';

export const dayParamSchema = z.object({
  date: calendarDaySchemaFor('date')
    .refine((date) => date >= '1900-01-01' && date <= '9999-12-31', 'date is out of range')
    .describe("Day to plan, in the user's timezone (YYYY-MM-DD)")
});
