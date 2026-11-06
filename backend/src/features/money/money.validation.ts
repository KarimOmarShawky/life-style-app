import { currencySchema } from '../../core/security/profile-validation.js';
/**
 * src/features/money/money.validation.ts
 *
 * Validation for retained subscription requests.
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

export const subscriptionIdParamSchema = z
  .object({
    id: z.guid('Invalid subscription ID format')
  })
  .strict();
