/** Project request schemas (spec section 13). */
import { z } from 'zod';

import { nullableText, trimmedString } from '@/core/validation/common';

export const createProjectSchema = z
  .object({
    name: trimmedString(120, 'name'),
    description: nullableText(2000, 'description'),
  })
  .strict();

/**
 * Update schema.
 *
 * Every field is optional, but at least one must be present: an empty PATCH is
 * almost always a client bug, and answering it with 200 hides that.
 */
export const updateProjectSchema = z
  .object({
    name: trimmedString(120, 'name').optional(),
    description: nullableText(2000, 'description'),
  })
  .strict()
  .refine((value) => Object.keys(value).length > 0, {
    message: 'provide at least one field to update',
  });

export type CreateProjectBody = z.infer<typeof createProjectSchema>;
export type UpdateProjectBody = z.infer<typeof updateProjectSchema>;
