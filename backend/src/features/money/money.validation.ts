import { currencySchema } from '../../core/security/profile-validation.js';
/**
 * src/features/money/money.validation.ts
 *
 * Implements Section 14.11 & AC-MON-01..07: Money Zod Validation Schemas.
 */

import { z } from 'zod';
import { Decimal } from 'decimal.js';
import { getCurrencyExponent } from './money.dto.js';
import { calendarDaySchema } from '../../core/validation/date-only.js';

/**
 * Validates that an amount is a decimal string > 0 with scale <= currency exponent.
 * Rejects JSON numbers completely per Section 7.2 & AC-MON-01.
 */
function validateMonetaryString(val: unknown, currency?: string): boolean {
  if (typeof val !== 'string') {
    return false;
  }
  const trimmed = val.trim();
  if (!/^\d+(\.\d+)?$/.test(trimmed)) {
    return false;
  }
  try {
    const dec = new Decimal(trimmed);
    if (dec.lessThanOrEqualTo(0)) {
      return false;
    }
    const parts = trimmed.split('.');
    const scale = parts.length > 1 && parts[1] ? parts[1].length : 0;
    const maxScale = currency ? getCurrencyExponent(currency) : 4;
    return scale <= maxScale;
  } catch {
    return false;
  }
}

export const monetaryAmountSchema = z
  .custom<string>(
    (val) => typeof val === 'string' && /^\d+(\.\d+)?$/.test(val.trim()),
    'Amount must be a decimal string'
  )
  .refine(
    (val) => {
      try {
        const dec = new Decimal(val);
        return dec.greaterThan(0);
      } catch {
        return false;
      }
    },
    { message: 'Amount must be greater than 0' }
  );

export const currencyCodeSchema = currencySchema;

/**
 * Date-only values are semantic calendar days, not just `YYYY-MM-DD`-shaped
 * strings (V-09): `2026-02-30` is rejected here, not deep inside a query.
 */
export const dateStringSchema = calendarDaySchema;

export const createCategorySchema = z
  .object({
    kind: z.enum(['expense', 'income']),
    name: z
      .string()
      .trim()
      .min(1, 'Category name cannot be empty')
      .max(60, 'Category name cannot exceed 60 characters'),
    icon: z.string().trim().max(40, 'Icon cannot exceed 40 characters').nullable().optional(),
    color: z
      .string()
      .trim()
      .regex(/^#([A-Fa-f0-9]{6}|[A-Fa-f0-9]{3})$/, 'Color must be a valid hex color string')
      .nullable()
      .optional()
  })
  .strict();

export const updateCategorySchema = z
  .object({
    name: z
      .string()
      .trim()
      .min(1, 'Category name cannot be empty')
      .max(60, 'Category name cannot exceed 60 characters')
      .optional(),
    icon: z.string().trim().max(40, 'Icon cannot exceed 40 characters').nullable().optional(),
    color: z
      .string()
      .trim()
      .regex(/^#([A-Fa-f0-9]{6}|[A-Fa-f0-9]{3})$/, 'Color must be a valid hex color string')
      .nullable()
      .optional(),
    archived: z.boolean().optional(),
    version: z.number().int().positive().optional()
  })
  .strict();

export const listCategoriesQuerySchema = z
  .object({
    kind: z.enum(['expense', 'income']).optional(),
    includeArchived: z
      .enum(['true', 'false'])
      .transform((v) => v === 'true')
      .optional()
  })
  .strict();

export const createTransactionSchema = z
  .object({
    kind: z.enum(['expense', 'income']),
    amount: monetaryAmountSchema,
    currency: currencyCodeSchema,
    occurredOn: dateStringSchema,
    categoryId: z.guid('Invalid categoryId format').nullable().optional(),
    description: z
      .string()
      .trim()
      .max(500, 'Description cannot exceed 500 characters')
      .nullable()
      .optional(),
    merchant: z
      .string()
      .trim()
      .max(150, 'Merchant cannot exceed 150 characters')
      .nullable()
      .optional(),
    subscriptionId: z.guid('Invalid subscriptionId format').nullable().optional(),
    billingDate: dateStringSchema.nullable().optional()
  })
  .strict()
  .superRefine((data, ctx) => {
    if (!validateMonetaryString(data.amount, data.currency)) {
      ctx.addIssue({
        code: 'custom',
        message: `Amount scale exceeds maximum allowed for currency ${data.currency} (${getCurrencyExponent(data.currency)} decimals)`,
        path: ['amount']
      });
    }
  })
  .refine(
    (data) => {
      if (data.subscriptionId) {
        return typeof data.billingDate === 'string' && data.kind === 'expense';
      }
      return true;
    },
    {
      message: 'Subscription-linked transactions must be of kind "expense" and require billingDate',
      path: ['subscriptionId']
    }
  );

export const updateTransactionSchema = z
  .object({
    kind: z.enum(['expense', 'income']).optional(),
    amount: monetaryAmountSchema.optional(),
    currency: currencyCodeSchema.optional(),
    occurredOn: dateStringSchema.optional(),
    categoryId: z.guid('Invalid categoryId format').nullable().optional(),
    description: z
      .string()
      .trim()
      .max(500, 'Description cannot exceed 500 characters')
      .nullable()
      .optional(),
    merchant: z
      .string()
      .trim()
      .max(150, 'Merchant cannot exceed 150 characters')
      .nullable()
      .optional(),
    version: z.number().int().positive().optional()
  })
  .strict()
  .superRefine((data, ctx) => {
    if (
      data.amount !== undefined &&
      data.currency !== undefined &&
      !validateMonetaryString(data.amount, data.currency)
    ) {
      ctx.addIssue({
        code: 'custom',
        message: `Amount scale exceeds maximum allowed for currency ${data.currency}`,
        path: ['amount']
      });
    }
  });

export const listTransactionsQuerySchema = z
  .object({
    kind: z.enum(['expense', 'income']).optional(),
    categoryId: z.guid('Invalid categoryId format').optional(),
    from: dateStringSchema.optional(),
    to: dateStringSchema.optional(),
    currency: currencyCodeSchema.optional(),
    minAmount: monetaryAmountSchema.optional(),
    maxAmount: monetaryAmountSchema.optional(),
    sort: z.enum(['occurredOn', 'amount']).optional(),
    limit: z.coerce.number().int().min(1).max(100).default(25).optional(),
    cursor: z.string().optional()
  })
  .strict();

export const createSubscriptionSchema = z
  .object({
    name: z
      .string()
      .trim()
      .min(1, 'Name cannot be empty')
      .max(120, 'Name cannot exceed 120 characters'),
    amount: monetaryAmountSchema,
    currency: currencyCodeSchema,
    billingUnit: z.enum(['week', 'month', 'year']),
    billingInterval: z.number().int().min(1).max(12).default(1).optional(),
    anchorDate: dateStringSchema,
    nextBillingDate: dateStringSchema.optional(),
    categoryId: z.guid('Invalid categoryId format').nullable().optional(),
    reminderDaysBefore: z.number().int().min(0).max(30).nullable().optional(),
    notes: z.string().trim().max(1000, 'Notes cannot exceed 1000 characters').nullable().optional()
  })
  .strict()
  .superRefine((data, ctx) => {
    if (!validateMonetaryString(data.amount, data.currency)) {
      ctx.addIssue({
        code: 'custom',
        message: `Amount scale exceeds maximum allowed for currency ${data.currency} (${getCurrencyExponent(data.currency)} decimals)`,
        path: ['amount']
      });
    }
  });

export const updateSubscriptionSchema = z
  .object({
    name: z.string().trim().min(1).max(120).optional(),
    amount: monetaryAmountSchema.optional(),
    currency: currencyCodeSchema.optional(),
    billingUnit: z.enum(['week', 'month', 'year']).optional(),
    billingInterval: z.number().int().min(1).max(12).optional(),
    anchorDate: dateStringSchema.optional(),
    nextBillingDate: dateStringSchema.optional(),
    status: z.enum(['active', 'paused', 'cancelled']).optional(),
    cancelledOn: dateStringSchema.nullable().optional(),
    categoryId: z.guid('Invalid categoryId format').nullable().optional(),
    reminderDaysBefore: z.number().int().min(0).max(30).nullable().optional(),
    notes: z.string().trim().max(1000).nullable().optional(),
    version: z.number().int().positive().optional()
  })
  .strict()
  .superRefine((data, ctx) => {
    if (
      data.amount !== undefined &&
      data.currency !== undefined &&
      !validateMonetaryString(data.amount, data.currency)
    ) {
      ctx.addIssue({
        code: 'custom',
        message: `Amount scale exceeds maximum allowed for currency ${data.currency}`,
        path: ['amount']
      });
    }
  });

export const listSubscriptionsQuerySchema = z
  .object({
    status: z.enum(['active', 'paused', 'cancelled']).optional(),
    limit: z.coerce.number().int().min(1).max(100).default(25).optional(),
    cursor: z.string().optional()
  })
  .strict();

export const paySubscriptionSchema = z
  .object({
    amount: monetaryAmountSchema.optional(),
    occurredOn: dateStringSchema.optional()
  })
  .strict();

export const createBudgetSchema = z
  .object({
    categoryId: z.guid('Invalid categoryId format').nullable().optional(),
    amountLimit: monetaryAmountSchema,
    currency: currencyCodeSchema,
    period: z.enum(['monthly']).optional().default('monthly')
  })
  .strict()
  .superRefine((data, ctx) => {
    if (!validateMonetaryString(data.amountLimit, data.currency)) {
      ctx.addIssue({
        code: 'custom',
        message: `Amount limit scale exceeds maximum allowed for currency ${data.currency} (${getCurrencyExponent(data.currency)} decimals)`,
        path: ['amountLimit']
      });
    }
  });

export const updateBudgetSchema = z
  .object({
    amountLimit: monetaryAmountSchema.optional(),
    version: z.number().int().positive().optional()
  })
  .strict();

export const reportSummaryQuerySchema = z
  .object({
    from: dateStringSchema,
    to: dateStringSchema,
    currency: currencyCodeSchema.optional(),
    groupBy: z.enum(['none', 'day', 'week', 'month']).default('none').optional()
  })
  .strict()
  .refine((data) => data.to >= data.from, {
    message: 'to date must be greater than or equal to from date',
    path: ['to']
  })
  .refine(
    (data) => {
      const fromTime = Date.parse(`${data.from}T00:00:00Z`);
      const toTime = Date.parse(`${data.to}T00:00:00Z`);
      const diffDays = Math.round((toTime - fromTime) / (24 * 60 * 60 * 1000));
      return diffDays <= 366;
    },
    { message: 'Report date span cannot exceed 366 days', path: ['to'] }
  );

export const categoryIdParamSchema = z
  .object({
    id: z.guid('Invalid category ID format')
  })
  .strict();

export const transactionIdParamSchema = z
  .object({
    id: z.guid('Invalid transaction ID format')
  })
  .strict();

export const subscriptionIdParamSchema = z
  .object({
    id: z.guid('Invalid subscription ID format')
  })
  .strict();

export const budgetIdParamSchema = z
  .object({
    id: z.guid('Invalid budget ID format')
  })
  .strict();
