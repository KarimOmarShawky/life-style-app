/** Expense, subscription and budget request schemas (spec section 13). */
import { z } from 'zod';

import {
  isoDateSchema,
  nullableText,
  paginationQuerySchema,
  trimmedString,
} from '@/core/validation/common';
import { BILLING_CYCLES } from './money.types';

/**
 * A monetary amount, accepted as a string or a number and carried as a string.
 *
 * WHY A STRING IS ACCEPTED AT ALL. A JSON number is parsed into a double, so a
 * client that wants to be exact has no way to say so unless the API lets it send
 * digits. `"0.10"` survives; `0.10` is already an approximation by the time any
 * code here sees it.
 *
 * WHY MORE THAN TWO DECIMAL PLACES IS REFUSED RATHER THAN ROUNDED. Rounding
 * silently is how a client that computed a total in floating point ends up
 * storing a number it never intended and cannot reconcile. `0.1 + 0.2` reaches
 * this schema as `0.30000000000000004` and is told, in the error message, to
 * send a string instead. A 422 is recoverable; a wrong number in a ledger is not.
 *
 * The bounds match NUMERIC(14,2): at most twelve digits before the point.
 */
const AMOUNT_PATTERN = /^\d{1,12}(\.\d{1,2})?$/;

export const moneyAmountSchema = z
  .union([z.string(), z.number()], {
    errorMap: () => ({ message: 'amount must be a number or a decimal string' }),
  })
  .transform((value) => (typeof value === 'number' ? String(value) : value.trim()))
  .pipe(
    z
      .string()
      .regex(
        AMOUNT_PATTERN,
        'amount must be a positive decimal with at most 2 places, e.g. "19.99". ' +
          'Send it as a string to avoid floating-point rounding.',
      ),
  )
  // Only digits and a point can reach here, so one non-zero digit anywhere is
  // the whole of "greater than zero". No conversion to a number is needed, which
  // is the point: this schema never puts an amount into a double.
  .refine((value) => /[1-9]/.test(value), 'amount must be greater than zero');

/**
 * An ISO 4217 currency code.
 *
 * Uppercased before checking, so `egp` is accepted and stored as `EGP`. Codes
 * are not validated against a list of real currencies: the column is CHAR(3) and
 * the user's own choice of code is not something this API needs an opinion on.
 * What matters is that the same code is spelled the same way every time, because
 * every total in this feature groups by it.
 */
export const currencySchema = z
  .string()
  .trim()
  .toUpperCase()
  .pipe(z.string().regex(/^[A-Z]{3}$/, 'currency must be a three-letter code, e.g. EGP or USD'));

/** `YYYY-MM`. A budget is scoped to a month, so a day would be noise. */
export const monthSchema = z
  .string()
  .trim()
  .regex(/^\d{4}-(0[1-9]|1[0-2])$/, 'month must be in YYYY-MM form, e.g. 2026-09');

const categorySchema = trimmedString(60, 'category');

// --- Expenses ---------------------------------------------------------------

export const createExpenseSchema = z
  .object({
    amount: moneyAmountSchema,
    currency: currencySchema.optional(),
    category: categorySchema,
    spentOn: isoDateSchema.optional(),
    note: nullableText(1000, 'note'),
  })
  .strict();

export const updateExpenseSchema = z
  .object({
    amount: moneyAmountSchema.optional(),
    currency: currencySchema.optional(),
    category: categorySchema.optional(),
    spentOn: isoDateSchema.optional(),
    note: nullableText(1000, 'note'),
  })
  .strict()
  .refine((value) => Object.keys(value).length > 0, {
    message: 'provide at least one field to update',
  });

export const listExpensesQuerySchema = paginationQuerySchema
  .extend({
    category: categorySchema.optional(),
    currency: currencySchema.optional(),
    from: isoDateSchema.optional(),
    to: isoDateSchema.optional(),
  })
  .strict()
  .refine((value) => value.from === undefined || value.to === undefined || value.from <= value.to, {
    message: 'from must not be after to',
    path: ['from'],
  });

/**
 * Report range.
 *
 * Bounded to a year by the service rather than left open. An authenticated
 * client asking for a decade of aggregates repeatedly is a cheap way to make the
 * database do expensive work, and no screen in this application shows more than
 * a year at a time.
 */
export const expenseSummaryQuerySchema = z
  .object({
    from: isoDateSchema.optional(),
    to: isoDateSchema.optional(),
  })
  .strict()
  .refine((value) => value.from === undefined || value.to === undefined || value.from <= value.to, {
    message: 'from must not be after to',
    path: ['from'],
  });

// --- Subscriptions ----------------------------------------------------------

const billingCycleSchema = z.enum(BILLING_CYCLES, {
  errorMap: () => ({ message: `billingCycle must be one of: ${BILLING_CYCLES.join(', ')}` }),
});

export const createSubscriptionSchema = z
  .object({
    name: trimmedString(120, 'name'),
    amount: moneyAmountSchema,
    currency: currencySchema.optional(),
    renewalDate: isoDateSchema,
    billingCycle: billingCycleSchema.optional(),
    isActive: z.boolean().optional(),
  })
  .strict();

export const updateSubscriptionSchema = z
  .object({
    name: trimmedString(120, 'name').optional(),
    amount: moneyAmountSchema.optional(),
    currency: currencySchema.optional(),
    renewalDate: isoDateSchema.optional(),
    billingCycle: billingCycleSchema.optional(),
    isActive: z.boolean().optional(),
  })
  .strict()
  .refine((value) => Object.keys(value).length > 0, {
    message: 'provide at least one field to update',
  });

export const listSubscriptionsQuerySchema = paginationQuerySchema
  .extend({
    active: z
      .enum(['true', 'false'])
      .optional()
      .transform((value) => (value === undefined ? undefined : value === 'true')),
  })
  .strict();

export const upcomingRenewalsQuerySchema = z
  .object({
    days: z.coerce
      .number()
      .int('days must be a whole number')
      .min(1, 'days must be at least 1')
      .max(365, 'days must be at most 365')
      .default(30),
  })
  .strict();

// --- Budgets ----------------------------------------------------------------

export const createBudgetSchema = z
  .object({
    category: categorySchema,
    monthlyLimit: moneyAmountSchema,
    currency: currencySchema.optional(),
    month: monthSchema,
  })
  .strict();

export const updateBudgetSchema = z
  .object({
    category: categorySchema.optional(),
    monthlyLimit: moneyAmountSchema.optional(),
    currency: currencySchema.optional(),
    month: monthSchema.optional(),
  })
  .strict()
  .refine((value) => Object.keys(value).length > 0, {
    message: 'provide at least one field to update',
  });

export const listBudgetsQuerySchema = paginationQuerySchema
  .extend({ month: monthSchema.optional() })
  .strict();

export type CreateExpenseBody = z.infer<typeof createExpenseSchema>;
export type UpdateExpenseBody = z.infer<typeof updateExpenseSchema>;
export type ListExpensesQuery = z.infer<typeof listExpensesQuerySchema>;
export type ExpenseSummaryQuery = z.infer<typeof expenseSummaryQuerySchema>;
export type CreateSubscriptionBody = z.infer<typeof createSubscriptionSchema>;
export type UpdateSubscriptionBody = z.infer<typeof updateSubscriptionSchema>;
export type ListSubscriptionsQuery = z.infer<typeof listSubscriptionsQuerySchema>;
export type UpcomingRenewalsQuery = z.infer<typeof upcomingRenewalsQuerySchema>;
export type CreateBudgetBody = z.infer<typeof createBudgetSchema>;
export type UpdateBudgetBody = z.infer<typeof updateBudgetSchema>;
export type ListBudgetsQuery = z.infer<typeof listBudgetsQuerySchema>;
