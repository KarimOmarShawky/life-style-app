/**
 * src/features/ai-reports/ai-reports.validation.ts
 *
 * Strict request schema for POST /api/v1/ai/reports. Unknown keys (user ids,
 * conversation history, timestamps) are rejected rather than silently
 * dropped. Optional texts are trimmed; blank ones are rejected.
 */

import { z } from 'zod';
import { AI_REPORT_CATEGORIES, AI_REPORT_LIMITS, AI_REPORT_SURFACES } from './ai-reports.types.js';

export const createAiReportSchema = z
  .object({
    surface: z.enum(AI_REPORT_SURFACES),
    category: z.enum(AI_REPORT_CATEGORIES),
    replyText: z.string().trim().min(1).max(AI_REPORT_LIMITS.replyTextMaxChars).optional(),
    note: z.string().trim().min(1).max(AI_REPORT_LIMITS.noteMaxChars).optional(),
    locale: z
      .string()
      .max(AI_REPORT_LIMITS.localeMaxChars)
      .regex(/^[A-Za-z]{2,3}(?:[-_][A-Za-z0-9]{2,8})?$/, {
        message: 'locale must look like "ar", "en" or "en-US"'
      })
  })
  .strict();

export type CreateAiReportBody = z.infer<typeof createAiReportSchema>;
