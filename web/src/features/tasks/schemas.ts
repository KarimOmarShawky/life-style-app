/**
 * Task form schema — mirrors backend `createTaskSchema` / `updateTaskSchema`.
 * Cross-field rules enforced by the backend are mirrored here for fast
 * feedback: `dueTime` requires `dueDate`; `isFocus` requires `plannedDate`.
 */

import { z } from 'zod';
import { DATE_ONLY_PATTERN, TIME_PATTERN, uuidSchema } from '@/lib/validation/common';

export const taskStatusSchema = z.enum(['todo', 'in_progress', 'done', 'cancelled']);
export const taskPrioritySchema = z.enum(['none', 'low', 'medium', 'high']);

export const taskFormSchema = z
  .object({
    title: z
      .string()
      .trim()
      .min(1, 'Title is required')
      .max(300, 'Title must not exceed 300 characters'),
    description: z
      .string()
      .max(10000, 'Description must not exceed 10,000 characters')
      .nullable()
      .optional(),
    status: taskStatusSchema,
    priority: taskPrioritySchema,
    dueDate: z
      .union([z.string().regex(DATE_ONLY_PATTERN, 'Enter a valid date'), z.literal('')])
      .nullable()
      .optional(),
    dueTime: z
      .union([z.string().regex(TIME_PATTERN, 'Enter a valid time (HH:mm)'), z.literal('')])
      .nullable()
      .optional(),
    plannedDate: z
      .union([z.string().regex(DATE_ONLY_PATTERN, 'Enter a valid date'), z.literal('')])
      .nullable()
      .optional(),
    isFocus: z.boolean(),
    estimateMinutes: z
      .union([z.string().regex(/^\d{1,4}$/, 'Enter minutes'), z.literal('')])
      .nullable()
      .optional(),
    projectId: z
      .union([uuidSchema, z.literal('')])
      .nullable()
      .optional()
  })
  .refine((data) => !data.dueTime || Boolean(data.dueDate), {
    path: ['dueTime'],
    message: 'A due time needs a due date'
  })
  .refine((data) => !data.isFocus || Boolean(data.plannedDate), {
    path: ['isFocus'],
    message: 'Focus tasks need a planned date'
  });

export type TaskFormValues = z.infer<typeof taskFormSchema>;

export const taskFormDefaults: TaskFormValues = {
  title: '',
  description: '',
  status: 'todo',
  priority: 'none',
  dueDate: '',
  dueTime: '',
  plannedDate: '',
  isFocus: false,
  estimateMinutes: '',
  projectId: ''
};

/** Map form values to the strict backend create/update body (drop empties). */
export function toTaskBody(values: TaskFormValues): {
  title: string;
  description: string | null;
  status: TaskFormValues['status'];
  priority: TaskFormValues['priority'];
  dueDate: string | null;
  dueTime: string | null;
  plannedDate: string | null;
  isFocus: boolean;
  estimateMinutes: number | null;
  projectId: string | null;
} {
  const emptyToNull = (value: string | null | undefined): string | null =>
    value && value.trim().length > 0 ? value.trim() : null;
  const estimate =
    values.estimateMinutes && /^\d+$/.test(values.estimateMinutes)
      ? Number.parseInt(values.estimateMinutes, 10)
      : null;
  return {
    title: values.title.trim(),
    description: values.description ? values.description : null,
    status: values.status,
    priority: values.priority,
    dueDate: emptyToNull(values.dueDate),
    dueTime: emptyToNull(values.dueTime),
    plannedDate: emptyToNull(values.plannedDate),
    isFocus: values.isFocus,
    estimateMinutes: estimate !== null && estimate >= 1 && estimate <= 1440 ? estimate : null,
    projectId: emptyToNull(values.projectId)
  };
}
