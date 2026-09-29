/**
 * Project form schema — mirrors backend `createProjectSchema` / `updateProjectSchema`.
 */

import { z } from 'zod';
import { DATE_ONLY_PATTERN, HEX_COLOR_PATTERN, uuidSchema } from '@/lib/validation/common';

export const projectStatusSchema = z.enum(['active', 'on_hold', 'completed', 'archived']);

export const projectFormSchema = z.object({
  name: z
    .string()
    .trim()
    .min(1, 'Project name is required')
    .max(120, 'Project name must not exceed 120 characters'),
  description: z.string().max(5000, 'Description is too long').nullable().optional(),
  status: projectStatusSchema,
  color: z
    .union([z.string().regex(HEX_COLOR_PATTERN, 'Use a hex color like #315C4C'), z.literal('')])
    .nullable()
    .optional(),
  goalId: z
    .union([uuidSchema, z.literal('')])
    .nullable()
    .optional(),
  dueDate: z
    .union([z.string().regex(DATE_ONLY_PATTERN, 'Enter a valid date'), z.literal('')])
    .nullable()
    .optional()
});

export type ProjectFormValues = z.infer<typeof projectFormSchema>;

export const projectFormDefaults: ProjectFormValues = {
  name: '',
  description: '',
  status: 'active',
  color: '',
  goalId: '',
  dueDate: ''
};

const emptyToNull = (value: string | null | undefined): string | null =>
  value && value.trim().length > 0 ? value.trim() : null;

export function toProjectBody(values: ProjectFormValues): {
  name: string;
  description: string | null;
  status: ProjectFormValues['status'];
  color: string | null;
  goalId: string | null;
  dueDate: string | null;
} {
  return {
    name: values.name.trim(),
    description: values.description ? values.description : null,
    status: values.status,
    color: emptyToNull(values.color),
    goalId: emptyToNull(values.goalId),
    dueDate: emptyToNull(values.dueDate)
  };
}
