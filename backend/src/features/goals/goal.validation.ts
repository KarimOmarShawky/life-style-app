/** Goal and milestone request schemas (spec section 13). */
import { z } from 'zod';

import {
  isoDateSchema,
  nullableText,
  paginationQuerySchema,
  trimmedString,
  uuidSchema,
} from '@/core/validation/common';
import { GOAL_STATUSES } from './goal.types';

const statusSchema = z.enum(GOAL_STATUSES, {
  errorMap: () => ({ message: `status must be one of: ${GOAL_STATUSES.join(', ')}` }),
});

/** A target date may be cleared with null, so absent and null differ. */
const targetDateSchema = isoDateSchema.nullable().optional();

export const createGoalSchema = z
  .object({
    title: trimmedString(200, 'title'),
    description: nullableText(2000, 'description'),
    targetDate: targetDateSchema,
    status: statusSchema.optional(),
  })
  .strict();

export const updateGoalSchema = z
  .object({
    title: trimmedString(200, 'title').optional(),
    description: nullableText(2000, 'description'),
    targetDate: targetDateSchema,
    status: statusSchema.optional(),
  })
  .strict()
  .refine((value) => Object.keys(value).length > 0, {
    message: 'provide at least one field to update',
  });

export const listGoalsQuerySchema = paginationQuerySchema
  .extend({ status: statusSchema.optional() })
  .strict();

/** Position orders the checklist. Bounded so it cannot be used to store data. */
const positionSchema = z.coerce
  .number()
  .int('position must be a whole number')
  .min(0, 'position must not be negative')
  .max(10_000, 'position must be at most 10000');

export const createMilestoneSchema = z
  .object({
    title: trimmedString(200, 'title'),
    taskId: uuidSchema.nullable().optional(),
    position: positionSchema.optional(),
  })
  .strict();

/**
 * Milestone update.
 *
 * `isDone` and `taskId` may both appear, but a milestone backed by a task takes
 * its completion from that task, so the service refuses `isDone` in that case
 * rather than silently storing a flag nothing reads.
 */
export const updateMilestoneSchema = z
  .object({
    title: trimmedString(200, 'title').optional(),
    taskId: uuidSchema.nullable().optional(),
    position: positionSchema.optional(),
    isDone: z.boolean().optional(),
  })
  .strict()
  .refine((value) => Object.keys(value).length > 0, {
    message: 'provide at least one field to update',
  });

export const milestoneParamsSchema = z.object({ id: uuidSchema, milestoneId: uuidSchema }).strict();

export type CreateGoalBody = z.infer<typeof createGoalSchema>;
export type UpdateGoalBody = z.infer<typeof updateGoalSchema>;
export type ListGoalsQuery = z.infer<typeof listGoalsQuerySchema>;
export type CreateMilestoneBody = z.infer<typeof createMilestoneSchema>;
export type UpdateMilestoneBody = z.infer<typeof updateMilestoneSchema>;
