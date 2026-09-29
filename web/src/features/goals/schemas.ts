/**
 * Goal form schema — mirrors backend `createGoalSchema` / `updateGoalSchema`.
 * Milestone goals must not carry targetValue/currentValue/unit (server rule
 * mirrored client-side; the server remains authoritative).
 */

import { z } from 'zod';

const DECIMAL_PATTERN = /^\d+(\.\d{1,4})?$/;
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

export const goalFormSchema = z
  .object({
    title: z
      .string()
      .trim()
      .min(1, 'Title is required')
      .max(200, 'Title must not exceed 200 characters'),
    description: z.string().max(5000, 'Description is too long').nullable().optional(),
    progressType: z.enum(['numeric', 'milestones']),
    targetValue: z
      .union([
        z.string().regex(DECIMAL_PATTERN, 'Enter a number with up to 4 decimals'),
        z.literal('')
      ])
      .nullable()
      .optional(),
    currentValue: z
      .union([
        z.string().regex(DECIMAL_PATTERN, 'Enter a number with up to 4 decimals'),
        z.literal('')
      ])
      .nullable()
      .optional(),
    unit: z.string().max(30, 'Unit must not exceed 30 characters').nullable().optional(),
    startDate: z
      .union([z.string().regex(DATE_PATTERN, 'Enter a valid date'), z.literal('')])
      .nullable()
      .optional(),
    targetDate: z
      .union([z.string().regex(DATE_PATTERN, 'Enter a valid date'), z.literal('')])
      .nullable()
      .optional()
  })
  .refine(
    (data) =>
      data.progressType !== 'numeric' ||
      (data.targetValue !== '' && Number(data.targetValue ?? 0) > 0),
    { path: ['targetValue'], message: 'Numeric goals need a target greater than 0' }
  )
  .refine(
    (data) =>
      data.progressType !== 'milestones' || (!data.targetValue && !data.currentValue && !data.unit),
    {
      path: ['progressType'],
      message: 'Milestone goals do not use numeric target/current/unit values'
    }
  )
  .refine((data) => !data.startDate || !data.targetDate || data.startDate <= data.targetDate, {
    path: ['targetDate'],
    message: 'Target date must be on or after the start date'
  });

export type GoalFormValues = z.infer<typeof goalFormSchema>;

export const goalFormDefaults: GoalFormValues = {
  title: '',
  description: '',
  progressType: 'numeric',
  targetValue: '',
  currentValue: '',
  unit: '',
  startDate: '',
  targetDate: ''
};

const emptyToNull = (value: string | null | undefined): string | null =>
  value && value.trim().length > 0 ? value.trim() : null;

export function toGoalBody(values: GoalFormValues): {
  title: string;
  description: string | null;
  progressType: 'numeric' | 'milestones';
  targetValue: string | null;
  currentValue: string | null;
  unit: string | null;
  startDate: string | null;
  targetDate: string | null;
} {
  const numeric = values.progressType === 'numeric';
  return {
    title: values.title.trim(),
    description: values.description ? values.description : null,
    progressType: values.progressType,
    targetValue: numeric ? emptyToNull(values.targetValue) : null,
    currentValue: numeric ? (emptyToNull(values.currentValue) ?? (numeric ? '0' : null)) : null,
    unit: numeric ? emptyToNull(values.unit) : null,
    startDate: emptyToNull(values.startDate),
    targetDate: emptyToNull(values.targetDate)
  };
}
