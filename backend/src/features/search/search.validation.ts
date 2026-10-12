/**
 * src/features/search/search.validation.ts
 *
 * Zod schemas for the Global Search endpoint.
 */

import { z } from 'zod';

export const searchQuerySchema = z.object({
  q: z.string().trim().min(1, 'q must not be empty').max(120, 'q must be at most 120 characters'),
  limit: z.coerce.number().int().min(1).max(50).default(10)
});

export type SearchQuery = z.infer<typeof searchQuerySchema>;
