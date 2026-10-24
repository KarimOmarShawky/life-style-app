/**
 * src/features/projects/projects.validation.ts
 *
 * Implements Section 14.5: Projects Zod Validation Schemas.
 */

import { z } from 'zod';

const COLOR_REGEX = /^#[0-9A-Fa-f]{6}$/;
const DATE_REGEX = /^\d{4}-\d{2}-\d{2}$/;

export const projectStatusSchema = z.enum(['active', 'on_hold', 'completed', 'archived']);

export const createProjectSchema = z
  .object({
    name: z
      .string()
      .trim()
      .min(1, { message: 'Project name cannot be blank' })
      .max(120, { message: 'Project name must not exceed 120 characters' }),
    description: z
      .string()
      .max(5000, { message: 'Description must not exceed 5000 characters' })
      .optional()
      .nullable(),
    status: projectStatusSchema.default('active'),
    color: z
      .string()
      .regex(COLOR_REGEX, { message: 'Color must be a valid hex code (#RRGGBB)' })
      .optional()
      .nullable(),
    goalId: z.guid({ message: 'goalId must be a valid UUID' }).optional().nullable(),
    dueDate: z
      .string()
      .regex(DATE_REGEX, { message: 'dueDate must be in YYYY-MM-DD format' })
      .optional()
      .nullable()
  })
  .strict();

export type CreateProjectInput = z.infer<typeof createProjectSchema>;

export const updateProjectSchema = z
  .object({
    name: z
      .string()
      .trim()
      .min(1, { message: 'Project name cannot be blank' })
      .max(120, { message: 'Project name must not exceed 120 characters' })
      .optional(),
    description: z
      .string()
      .max(5000, { message: 'Description must not exceed 5000 characters' })
      .optional()
      .nullable(),
    status: projectStatusSchema.optional(),
    color: z
      .string()
      .regex(COLOR_REGEX, { message: 'Color must be a valid hex code (#RRGGBB)' })
      .optional()
      .nullable(),
    goalId: z.guid({ message: 'goalId must be a valid UUID' }).optional().nullable(),
    dueDate: z
      .string()
      .regex(DATE_REGEX, { message: 'dueDate must be in YYYY-MM-DD format' })
      .optional()
      .nullable(),
    version: z.number().int().min(1).optional()
  })
  .strict();

export type UpdateProjectInput = z.infer<typeof updateProjectSchema>;

export const listProjectsQuerySchema = z
  .object({
    status: z.string().optional(),
    limit: z
      .string()
      .transform((val) => parseInt(val, 10))
      .pipe(z.number().min(1).max(100))
      .default(25),
    cursor: z.string().optional()
  })
  .strict();

export type ListProjectsQuery = z.infer<typeof listProjectsQuerySchema>;

export const deleteProjectQuerySchema = z
  .object({
    cascade: z
      .string()
      .optional()
      .transform((val) => val === 'true')
  })
  .strict();

export const projectIdParamSchema = z
  .object({
    id: z.guid({ message: 'Project ID must be a valid UUID' })
  })
  .strict();
