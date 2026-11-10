/**
 * src/features/product-events/product-events.validation.ts
 *
 * Strict request schema: only an event name from the closed list, the
 * platform and an optional app version. Unknown keys (titles, ids, free text,
 * client timestamps) are rejected rather than silently dropped.
 */

import { z } from 'zod';
import { PRODUCT_EVENT_NAMES, PRODUCT_EVENT_PLATFORMS } from './product-events.types.js';

export const recordProductEventSchema = z
  .object({
    event: z.enum(PRODUCT_EVENT_NAMES),
    platform: z.enum(PRODUCT_EVENT_PLATFORMS),
    appVersion: z
      .string()
      .regex(/^[0-9A-Za-z.+-]{1,32}$/, {
        message: 'appVersion must be 1-32 characters of letters, digits, ".", "+" or "-"'
      })
      .optional()
  })
  .strict();

export type RecordProductEventBody = z.infer<typeof recordProductEventSchema>;
