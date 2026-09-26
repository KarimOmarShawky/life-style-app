/**
 * Task request schemas (spec section 13).
 *
 * The cross-field rules here mirror database CHECK constraints exactly. Both
 * layers exist on purpose: validation produces a helpful 422 naming the field,
 * while the constraint guarantees the rule even if a future code path forgets
 * to validate. Duplication between them is the point, not an oversight.
 */
import { z } from 'zod';

import {
  isoDateTimeSchema,
  nullableText,
  trimmedString,
  uuidSchema,
} from '@/core/validation/common';
import { TASK_PRIORITIES, TASK_STATUSES } from './task.types';

const prioritySchema = z.enum(TASK_PRIORITIES);
const statusSchema = z.enum(TASK_STATUSES);

/**
 * Mirrors the `tasks_recurrence_rule_present` constraint: a recurring task must
 * carry a rule, and a non-recurring one must not.
 */
function assertRecurrenceCoherent(
  value: { isRecurring?: boolean | undefined; recurrenceRule?: string | null | undefined },
  ctx: z.RefinementCtx,
): void {
  if (
    value.isRecurring === true &&
    (value.recurrenceRule === undefined || value.recurrenceRule === null)
  ) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['recurrenceRule'],
      message: 'recurrenceRule is required when isRecurring is true',
    });
  }

  if (value.isRecurring === false && typeof value.recurrenceRule === 'string') {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['recurrenceRule'],
      message: 'recurrenceRule must be omitted or null when isRecurring is false',
    });
  }
}

export const createTaskSchema = z
  .object({
    title: trimmedString(200, 'title'),
    description: nullableText(5000, 'description'),
    projectId: uuidSchema.nullable().optional(),
    dueDate: isoDateTimeSchema.nullable().optional(),
    priority: prioritySchema.default('medium'),
    status: statusSchema.default('todo'),
    isRecurring: z.boolean().default(false),
    recurrenceRule: nullableText(200, 'recurrenceRule'),
    hasTimer: z.boolean().default(false),
  })
  .strict()
  .superRefine(assertRecurrenceCoherent);

export const updateTaskSchema = z
  .object({
    title: trimmedString(200, 'title').optional(),
    description: nullableText(5000, 'description'),
    projectId: uuidSchema.nullable().optional(),
    dueDate: isoDateTimeSchema.nullable().optional(),
    priority: prioritySchema.optional(),
    status: statusSchema.optional(),
    isRecurring: z.boolean().optional(),
    recurrenceRule: nullableText(200, 'recurrenceRule'),
    hasTimer: z.boolean().optional(),
  })
  .strict()
  .refine((value) => Object.keys(value).length > 0, {
    message: 'provide at least one field to update',
  })
  .superRefine(assertRecurrenceCoherent);

/**
 * List filters.
 *
 * `overdue` arrives as the string "true" from a query string, so it is coerced
 * explicitly rather than relying on JavaScript truthiness, under which the
 * string "false" is also true.
 */
export const listTasksQuerySchema = z
  .object({
    limit: z.coerce.number().int().min(1).max(100).default(20),
    cursor: z.string().min(1).max(500).optional(),
    status: z.enum(TASK_STATUSES).optional(),
    priority: z.enum(TASK_PRIORITIES).optional(),
    projectId: uuidSchema.optional(),
    dueBefore: isoDateTimeSchema.optional(),
    overdue: z
      .enum(['true', 'false'])
      .transform((value) => value === 'true')
      .optional(),
    search: z.string().trim().min(1).max(100).optional(),
  })
  .strict();

export type CreateTaskBody = z.infer<typeof createTaskSchema>;
export type UpdateTaskBody = z.infer<typeof updateTaskSchema>;
export type ListTasksQuery = z.infer<typeof listTasksQuerySchema>;
