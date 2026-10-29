/**
 * src/features/money/money.invariants.ts
 *
 * One place that validates the *effective* state of a money record (V-08).
 *
 * Create-time validation was strict: amount scale against the currency
 * exponent, `occurredOn` at most one day in the future, and kind/category
 * compatibility. The alternate paths were not:
 *
 *  - `PATCH /money/transactions/:id` only checked scale when `amount` *and*
 *    `currency` arrived together, and only checked the category when a new
 *    `categoryId` was supplied, so a kind-only change could leave an
 *    incompatible category behind.
 *  - `POST /money/subscriptions/:id/pay` had no currency-scale check and no
 *    future-date rule at all.
 *
 * Every mutating money path now merges the stored row with the request and
 * validates the resulting record here, so partial updates, payments and
 * replays can never admit a state that create would have rejected.
 */

import { Decimal } from 'decimal.js';
import { AppError } from '../../core/errors/app-error.js';
import { addDaysToDateString } from '../../core/time/date-utils.js';
import { isValidCalendarDate } from '../../core/validation/date-only.js';
import { getCurrencyExponent } from './money.dto.js';
import type { TransactionKind } from './money.types.js';

/** Outcome of checking a decimal amount string against a currency exponent. */
export interface AmountCheck {
  ok: boolean;
  reason?: 'format' | 'non_positive' | 'scale';
  maxScale?: number;
}

export function checkAmountForCurrency(
  amount: unknown,
  currency: string
): AmountCheck {
  if (typeof amount !== 'string') return { ok: false, reason: 'format' };
  const trimmed = amount.trim();
  if (!/^\d+(\.\d+)?$/.test(trimmed)) return { ok: false, reason: 'format' };
  let dec: Decimal;
  try {
    dec = new Decimal(trimmed);
  } catch {
    return { ok: false, reason: 'format' };
  }
  if (!dec.greaterThan(0)) return { ok: false, reason: 'non_positive' };

  const fraction = trimmed.split('.')[1] ?? '';
  const maxScale = getCurrencyExponent(currency);
  if (fraction.length > maxScale) return { ok: false, reason: 'scale', maxScale };
  return { ok: true, maxScale };
}

/** True when `date` is no later than `userToday + 1 day`. */
export function isWithinFutureAllowance(date: string, userToday: string): boolean {
  return date <= addDaysToDateString(userToday, 1);
}

export interface EffectiveCategory {
  id: string;
  kind: TransactionKind;
  archivedAt: Date | null;
}

export interface EffectiveTransactionState {
  kind: TransactionKind;
  amount: string;
  currency: string;
  occurredOn: string;
  category?: EffectiveCategory | null;
}

const FUTURE_MESSAGE = 'occurredOn cannot be more than 1 day in the future';

/**
 * Validates a complete transaction record (stored values merged with the
 * request) and throws a field-scoped validation error on the first violation.
 */
export function assertTransactionInvariants(
  state: EffectiveTransactionState,
  userToday: string
): void {
  if (!isValidCalendarDate(state.occurredOn)) {
    throw AppError.validation([
      { field: 'occurredOn', message: 'occurredOn must be a real calendar date (YYYY-MM-DD)' }
    ]);
  }
  if (!isWithinFutureAllowance(state.occurredOn, userToday)) {
    throw AppError.validation([{ field: 'occurredOn', message: FUTURE_MESSAGE }]);
  }

  const amount = checkAmountForCurrency(state.amount, state.currency);
  if (!amount.ok) {
    throw AppError.validation([
      {
        field: 'amount',
        message:
          amount.reason === 'scale'
            ? `Amount scale exceeds maximum allowed for currency ${state.currency} (${amount.maxScale} decimals)`
            : 'Amount must be a positive decimal string'
      }
    ]);
  }

  const category = state.category;
  if (!category) return;
  if (category.kind !== state.kind) {
    throw AppError.validation([
      {
        field: 'categoryId',
        message: `Category kind "${category.kind}" does not match transaction kind "${state.kind}"`
      }
    ]);
  }
  if (category.archivedAt !== null) {
    throw AppError.validation([{ field: 'categoryId', message: 'Category is archived' }]);
  }
}

/**
 * Subscription payment invariants: the effective amount (request override or
 * the stored subscription amount) must respect the subscription currency, and
 * the effective payment date must obey the same future-date boundary as a
 * manual transaction.
 */
export function assertSubscriptionPaymentInvariants(
  state: { amount: string; currency: string; occurredOn: string },
  userToday: string
): void {
  if (!isValidCalendarDate(state.occurredOn)) {
    throw AppError.validation([
      { field: 'occurredOn', message: 'occurredOn must be a real calendar date (YYYY-MM-DD)' }
    ]);
  }
  if (!isWithinFutureAllowance(state.occurredOn, userToday)) {
    throw AppError.validation([{ field: 'occurredOn', message: FUTURE_MESSAGE }]);
  }
  const amount = checkAmountForCurrency(state.amount, state.currency);
  if (!amount.ok) {
    throw AppError.validation([
      {
        field: 'amount',
        message:
          amount.reason === 'scale'
            ? `Amount scale exceeds maximum allowed for currency ${state.currency} (${amount.maxScale} decimals)`
            : 'Amount must be a positive decimal string'
      }
    ]);
  }
}
