/**
 * Money form schemas — mirror backend `money.validation.ts`.
 * Amounts are validated as decimal STRINGS (never JS floats).
 */

import { z } from 'zod';
import {
  currencySchema,
  dateStringSchema,
  decimalStringSchema,
  uuidSchema
} from '@/lib/validation/common';

export const categoryFormSchema = z.object({
  kind: z.enum(['expense', 'income']),
  name: z.string().trim().min(1, 'Name is required').max(60, 'Max 60 characters'),
  color: z
    .union([
      z.string().regex(/^#([A-Fa-f0-9]{6}|[A-Fa-f0-9]{3})$/, 'Use a hex color'),
      z.literal('')
    ])
    .nullable()
    .optional(),
  icon: z.string().trim().max(40, 'Max 40 characters').nullable().optional()
});
export type CategoryFormValues = z.infer<typeof categoryFormSchema>;
export const categoryFormDefaults: CategoryFormValues = {
  kind: 'expense',
  name: '',
  color: '',
  icon: ''
};

export const transactionFormSchema = z
  .object({
    kind: z.enum(['expense', 'income']),
    amount: decimalStringSchema,
    currency: currencySchema,
    occurredOn: dateStringSchema,
    categoryId: z
      .union([uuidSchema, z.literal('')])
      .nullable()
      .optional(),
    description: z.string().trim().max(500, 'Max 500 characters').nullable().optional(),
    merchant: z.string().trim().max(150, 'Max 150 characters').nullable().optional()
  })
  .refine(
    (data) => {
      // Fractional digits must not exceed the currency's exponent (default 2).
      const [, fraction = ''] = data.amount.split('.');
      const zeroDecimal = new Set([
        'BIF',
        'CLP',
        'DJF',
        'GNF',
        'ISK',
        'JPY',
        'KMF',
        'KRW',
        'PYG',
        'RWF',
        'UGX',
        'UYI',
        'VND',
        'VUV',
        'XAF',
        'XOF',
        'XPF'
      ]);
      const threeDecimal = new Set(['BHD', 'IQD', 'JOD', 'KWD', 'LYD', 'OMR', 'TND']);
      const max = zeroDecimal.has(data.currency) ? 0 : threeDecimal.has(data.currency) ? 3 : 2;
      return fraction.length <= max;
    },
    { path: ['amount'], message: 'Too many decimal places for this currency' }
  );
export type TransactionFormValues = z.infer<typeof transactionFormSchema>;
export const transactionFormDefaults: TransactionFormValues = {
  kind: 'expense',
  amount: '',
  currency: 'USD',
  occurredOn: '',
  categoryId: '',
  description: '',
  merchant: ''
};

export const subscriptionFormSchema = z
  .object({
    name: z.string().trim().min(1, 'Name is required').max(120, 'Max 120 characters'),
    amount: decimalStringSchema,
    currency: currencySchema,
    billingUnit: z.enum(['week', 'month', 'year']),
    billingInterval: z.string().regex(/^[1-9]$|^[1][0-2]$/, 'Interval must be 1–12'),
    anchorDate: dateStringSchema,
    nextBillingDate: z
      .union([dateStringSchema, z.literal('')])
      .nullable()
      .optional(),
    categoryId: z
      .union([uuidSchema, z.literal('')])
      .nullable()
      .optional(),
    reminderDaysBefore: z
      .union([z.string().regex(/^\d{1,2}$/, '0–30 days'), z.literal('')])
      .nullable()
      .optional(),
    notes: z.string().trim().max(1000, 'Max 1000 characters').nullable().optional()
  })
  .refine((data) => !data.nextBillingDate || data.nextBillingDate >= data.anchorDate, {
    path: ['nextBillingDate'],
    message: 'Next billing date must be on or after the anchor date'
  });
export type SubscriptionFormValues = z.infer<typeof subscriptionFormSchema>;
export const subscriptionFormDefaults: SubscriptionFormValues = {
  name: '',
  amount: '',
  currency: 'USD',
  billingUnit: 'month',
  billingInterval: '1',
  anchorDate: '',
  nextBillingDate: '',
  categoryId: '',
  reminderDaysBefore: '',
  notes: ''
};

export const budgetFormSchema = z.object({
  categoryId: z
    .union([uuidSchema, z.literal('')])
    .nullable()
    .optional(),
  amountLimit: decimalStringSchema,
  currency: currencySchema
});
export type BudgetFormValues = z.infer<typeof budgetFormSchema>;
export const budgetFormDefaults: BudgetFormValues = {
  categoryId: '',
  amountLimit: '',
  currency: 'USD'
};

const emptyToNull = (value: string | null | undefined): string | null =>
  value && value.trim().length > 0 ? value.trim() : null;

export function toTransactionBody(values: TransactionFormValues): {
  kind: 'expense' | 'income';
  amount: string;
  currency: string;
  occurredOn: string;
  categoryId: string | null;
  description: string | null;
  merchant: string | null;
} {
  return {
    kind: values.kind,
    amount: values.amount.trim(),
    currency: values.currency,
    occurredOn: values.occurredOn,
    categoryId: emptyToNull(values.categoryId),
    description: emptyToNull(values.description),
    merchant: emptyToNull(values.merchant)
  };
}

export function toSubscriptionBody(values: SubscriptionFormValues): {
  name: string;
  amount: string;
  currency: string;
  billingUnit: 'week' | 'month' | 'year';
  billingInterval: number;
  anchorDate: string;
  /** Backend schema is `.optional()` (not nullable) — omit instead of null. */
  nextBillingDate?: string;
  categoryId: string | null;
  reminderDaysBefore: number | null;
  notes: string | null;
} {
  const interval = Number.parseInt(values.billingInterval, 10);
  const reminder =
    values.reminderDaysBefore && /^\d+$/.test(values.reminderDaysBefore)
      ? Number.parseInt(values.reminderDaysBefore, 10)
      : null;
  const body: ReturnType<typeof toSubscriptionBody> = {
    name: values.name.trim(),
    amount: values.amount.trim(),
    currency: values.currency,
    billingUnit: values.billingUnit,
    billingInterval: interval >= 1 && interval <= 12 ? interval : 1,
    anchorDate: values.anchorDate,
    categoryId: emptyToNull(values.categoryId),
    reminderDaysBefore: reminder !== null && reminder <= 30 ? reminder : null,
    notes: emptyToNull(values.notes)
  };
  const next = emptyToNull(values.nextBillingDate);
  if (next !== null) body.nextBillingDate = next;
  return body;
}
