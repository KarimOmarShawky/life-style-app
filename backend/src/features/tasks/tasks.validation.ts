/**
 * src/features/tasks/tasks.validation.ts
 *
 * Implements Section 14.4: Tasks Zod Validation Schemas.
 */

import { z } from 'zod';
import { calendarDaySchemaFor } from '../../core/validation/date-only.js';


const TIME_REGEX = /^([01]\d|2[0-3]):[0-5]\d$/;

export const taskStatusSchema = z.enum(['todo', 'in_progress', 'done', 'cancelled']);
export const taskPrioritySchema = z.enum(['none', 'low', 'medium', 'high']);

export const createTaskSchema = z
  .object({
    title: z
      .string()
      .trim()
      .min(1, { message: 'Title cannot be blank' })
      .max(300, { message: 'Title must not exceed 300 characters' }),
    description: z
      .string()
      .max(10000, { message: 'Description must not exceed 10000 characters' })
      .optional()
      .nullable(),
    status: taskStatusSchema.default('todo'),
    priority: taskPrioritySchema.default('none'),
    dueDate: calendarDaySchemaFor('dueDate').optional().nullable(),
    dueTime: z
      .string()
      .regex(TIME_REGEX, { message: 'dueTime must be in HH:mm format' })
      .optional()
      .nullable(),
    plannedDate: calendarDaySchemaFor('plannedDate').optional().nullable(),
    isFocus: z.boolean().default(false),
    estimateMinutes: z.number().int().min(1).max(1440).optional().nullable(),
    projectId: z.guid({ message: 'projectId must be a valid UUID' }).optional().nullable()
  })
  .strict()
  .refine((data) => !data.dueTime || Boolean(data.dueDate), {
    path: ['dueTime'],
    message: 'dueTime requires dueDate to be set'
  })
  .refine((data) => !data.isFocus || Boolean(data.plannedDate), {
    path: ['isFocus'],
    message: 'isFocus requires plannedDate to be set'
  });

export type CreateTaskInput = z.infer<typeof createTaskSchema>;

export const updateTaskSchema = z
  .object({
    title: z
      .string()
      .trim()
      .min(1, { message: 'Title cannot be blank' })
      .max(300, { message: 'Title must not exceed 300 characters' })
      .optional(),
    description: z
      .string()
      .max(10000, { message: 'Description must not exceed 10000 characters' })
      .optional()
      .nullable(),
    status: taskStatusSchema.optional(),
    priority: taskPrioritySchema.optional(),
    dueDate: calendarDaySchemaFor('dueDate').optional().nullable(),
    dueTime: z
      .string()
      .regex(TIME_REGEX, { message: 'dueTime must be in HH:mm format' })
      .optional()
      .nullable(),
    plannedDate: calendarDaySchemaFor('plannedDate').optional().nullable(),
    isFocus: z.boolean().optional(),
    estimateMinutes: z.number().int().min(1).max(1440).optional().nullable(),
    projectId: z.guid({ message: 'projectId must be a valid UUID' }).optional().nullable(),
    version: z.number().int().min(1).optional()
  })
  .strict();

export type UpdateTaskInput = z.infer<typeof updateTaskSchema>;

export const listTasksQuerySchema = z
  .object({
    status: z.string().optional(),
    priority: z.string().optional(),
    projectId: z.string().optional(),
    dueFrom: calendarDaySchemaFor('dueFrom').optional(),
    dueTo: calendarDaySchemaFor('dueTo').optional(),
    plannedDate: calendarDaySchemaFor('plannedDate').optional(),
    overdue: z
      .string()
      .transform((val) => val === 'true')
      .optional(),
    isFocus: z
      .string()
      .transform((val) => val === 'true')
      .optional(),
    completedFrom: z.string().optional(),
    completedTo: z.string().optional(),
    sort: z.enum(['dueDate', 'priority', 'createdAt', 'updatedAt']).optional(),
    order: z.enum(['asc', 'desc']).default('asc'),
    limit: z
      .string()
      .transform((val) => parseInt(val, 10))
      .pipe(z.number().min(1).max(100))
      .default(25),
    cursor: z.string().optional()
  })
  .strict();

export type ListTasksQuery = z.infer<typeof listTasksQuerySchema>;

export const taskIdParamSchema = z
  .object({
    id: z.guid({ message: 'Task ID must be a valid UUID' })
  })
  .strict();
