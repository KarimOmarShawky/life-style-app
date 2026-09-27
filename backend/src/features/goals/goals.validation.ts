/**
 * src/features/goals/goals.validation.ts
 *
 * Implements Section 14.9 & AC-GOAL-01: Goals & Milestones Zod Validation Schemas.
 */

import { z } from 'zod';

const decimalRegex = /^\d+(\.\d{1,4})?$/;
const dateRegex = /^\d{4}-\d{2}-\d{2}$/;

export const createGoalSchema = z
  .object({
    title: z
      .string({ required_error: 'Title is required' })
      .trim()
      .min(1, 'Title must be at least 1 character long')
      .max(200, 'Title cannot exceed 200 characters'),
    description: z
      .string()
      .max(5000, 'Description cannot exceed 5000 characters')
      .nullable()
      .optional(),
    progressType: z.enum(['milestones', 'numeric'], {
      required_error: 'progressType is required'
    }),
    targetValue: z
      .string()
      .regex(
        decimalRegex,
        'targetValue must be a positive decimal string with up to 4 decimal places'
      )
      .nullable()
      .optional(),
    currentValue: z
      .string()
      .regex(
        decimalRegex,
        'currentValue must be a non-negative decimal string with up to 4 decimal places'
      )
      .nullable()
      .optional(),
    unit: z.string().trim().max(30, 'Unit cannot exceed 30 characters').nullable().optional(),
    startDate: z
      .string()
      .regex(dateRegex, 'startDate must be formatted as YYYY-MM-DD')
      .nullable()
      .optional(),
    targetDate: z
      .string()
      .regex(dateRegex, 'targetDate must be formatted as YYYY-MM-DD')
      .nullable()
      .optional()
  })
  .refine(
    (data) => {
      if (data.progressType === 'numeric') {
        return Boolean(data.targetValue && Number(data.targetValue) > 0);
      }
      return true;
    },
    {
      message: 'Numeric goals require targetValue to be greater than 0',
      path: ['targetValue']
    }
  )
  .refine(
    (data) => {
      if (data.progressType === 'milestones') {
        return !data.targetValue && !data.currentValue && !data.unit;
      }
      return true;
    },
    {
      message: 'Milestone goals must not specify targetValue, currentValue, or unit',
      path: ['progressType']
    }
  )
  .refine(
    (data) => {
      if (data.startDate && data.targetDate) {
        return data.startDate <= data.targetDate;
      }
      return true;
    },
    {
      message: 'targetDate must be greater than or equal to startDate',
      path: ['targetDate']
    }
  );

export const updateGoalSchema = z
  .object({
    title: z
      .string()
      .trim()
      .min(1, 'Title must be at least 1 character long')
      .max(200, 'Title cannot exceed 200 characters')
      .optional(),
    description: z
      .string()
      .max(5000, 'Description cannot exceed 5000 characters')
      .nullable()
      .optional(),
    status: z.enum(['active', 'paused', 'achieved', 'abandoned']).optional(),
    targetValue: z
      .string()
      .regex(
        decimalRegex,
        'targetValue must be a positive decimal string with up to 4 decimal places'
      )
      .nullable()
      .optional(),
    currentValue: z
      .string()
      .regex(
        decimalRegex,
        'currentValue must be a non-negative decimal string with up to 4 decimal places'
      )
      .nullable()
      .optional(),
    unit: z.string().trim().max(30, 'Unit cannot exceed 30 characters').nullable().optional(),
    startDate: z
      .string()
      .regex(dateRegex, 'startDate must be formatted as YYYY-MM-DD')
      .nullable()
      .optional(),
    targetDate: z
      .string()
      .regex(dateRegex, 'targetDate must be formatted as YYYY-MM-DD')
      .nullable()
      .optional(),
    version: z.number().int().positive().optional()
  })
  .refine(
    (data) => {
      if (data.startDate && data.targetDate) {
        return data.startDate <= data.targetDate;
      }
      return true;
    },
    {
      message: 'targetDate must be greater than or equal to startDate',
      path: ['targetDate']
    }
  );

export const listGoalsQuerySchema = z.object({
  status: z.enum(['active', 'paused', 'achieved', 'abandoned']).optional(),
  progressType: z.enum(['milestones', 'numeric']).optional(),
  includeDeleted: z
    .enum(['true', 'false'])
    .transform((v) => v === 'true')
    .optional()
});

export const goalIdParamSchema = z.object({
  id: z.string().uuid('Invalid goal ID format')
});

export const createMilestoneSchema = z.object({
  title: z
    .string({ required_error: 'Title is required' })
    .trim()
    .min(1, 'Title must be at least 1 character long')
    .max(200, 'Title cannot exceed 200 characters'),
  dueDate: z
    .string()
    .regex(dateRegex, 'dueDate must be formatted as YYYY-MM-DD')
    .nullable()
    .optional(),
  sortOrder: z.number().int().optional()
});

export const updateMilestoneSchema = z.object({
  title: z
    .string()
    .trim()
    .min(1, 'Title must be at least 1 character long')
    .max(200, 'Title cannot exceed 200 characters')
    .optional(),
  dueDate: z
    .string()
    .regex(dateRegex, 'dueDate must be formatted as YYYY-MM-DD')
    .nullable()
    .optional(),
  completed: z.boolean().optional(),
  sortOrder: z.number().int().optional(),
  version: z.number().int().positive().optional()
});

export const goalMilestoneParamSchema = z.object({
  id: z.string().uuid('Invalid goal ID format'),
  milestoneId: z.string().uuid('Invalid milestone ID format')
});
