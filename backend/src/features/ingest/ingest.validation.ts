/**
 * src/features/ingest/ingest.validation.ts
 *
 * Zod schemas for the SMS fallback analyze request. The body carries sanitized
 * SMS metadata only; it is validated strictly before anything else runs.
 */

import { z } from 'zod';
import { isValidCalendarDate } from '../../core/validation/date-only.js';

/** Validate the entire timestamp, not just its date-shaped prefix. */
export function isValidSmsReceivedAt(value: string): boolean {
  const match =
    /^(\d{4}-\d{2}-\d{2})(?:T(\d{2}):(\d{2})(?::(\d{2})(?:\.\d+)?)?(?:Z|[+-](\d{2}):(\d{2}))?)?$/.exec(
      value
    );
  if (!match || !isValidCalendarDate(match[1])) return false;
  return (
    (match[2] === undefined || Number(match[2]) <= 23) &&
    (match[3] === undefined || Number(match[3]) <= 59) &&
    (match[4] === undefined || Number(match[4]) <= 59) &&
    (match[5] === undefined || Number(match[5]) <= 23) &&
    (match[6] === undefined || Number(match[6]) <= 59)
  );
}

export const analyzeSmsRequestSchema = z
  .object({
    // Sanitized on the phone and re-sanitized on the server before any model call.
    text: z
      .string({ error: 'text is required' })
      .trim()
      .min(1, 'text cannot be empty')
      .max(2000, 'text cannot exceed 2000 characters'),
    sender: z.string().trim().max(120, 'sender cannot exceed 120 characters').optional(),
    // Date (YYYY-MM-DD) or ISO timestamp of when the SMS arrived on the phone.
    receivedAt: z
      .string({ error: 'receivedAt is required' })
      .trim()
      .refine(isValidSmsReceivedAt, 'receivedAt must be a real date or ISO-8601 timestamp')
  })
  .strict();

export type AnalyzeSmsRequest = z.infer<typeof analyzeSmsRequestSchema>;
