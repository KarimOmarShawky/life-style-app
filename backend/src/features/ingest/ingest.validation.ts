/**
 * src/features/ingest/ingest.validation.ts
 *
 * Zod schemas for the SMS fallback analyze request. The body carries sanitized
 * SMS metadata only; it is validated strictly before anything else runs.
 */

import { z } from 'zod';

export const analyzeSmsRequestSchema = z.object({
  // Sanitized on the phone and re-sanitized on the server before any model call.
  text: z
    .string({ required_error: 'text is required' })
    .trim()
    .min(1, 'text cannot be empty')
    .max(2000, 'text cannot exceed 2000 characters'),
  sender: z.string().trim().max(120, 'sender cannot exceed 120 characters').optional(),
  // Date (YYYY-MM-DD) or ISO timestamp of when the SMS arrived on the phone.
  receivedAt: z
    .string({ required_error: 'receivedAt is required' })
    .trim()
    .regex(
      /^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2}(:\d{2})?(\.\d+)?(Z|[+-]\d{2}:\d{2})?)?$/,
      'receivedAt must be a YYYY-MM-DD date or ISO-8601 timestamp'
    )
});

export type AnalyzeSmsRequest = z.infer<typeof analyzeSmsRequestSchema>;
