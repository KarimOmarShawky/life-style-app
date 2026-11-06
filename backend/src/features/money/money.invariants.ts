import { Decimal } from 'decimal.js';
import { AppError } from '../../core/errors/app-error.js';
import { getCurrencyExponent } from './money.dto.js';
import type { TransactionKind } from './money.types.js';

/** Outcome of checking a decimal amount string against a currency exponent. */
export interface AmountCheck {
  ok: boolean;
  reason?: 'format' | 'non_positive' | 'scale';
  maxScale?: number;
}

export function checkAmountForCurrency(amount: unknown, currency: string): AmountCheck {
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

/** Number of fractional digits in a validated amount supplied by the user. */
export function moneyInputScale(amount: string): number {
  return (amount.trim().split('.')[1] ?? '').length;
}

/** Recover recorded textual scale exactly, or require a fresh amount for legacy rows. */
export function effectiveMoneyAmount(
  supplied: string | undefined,
  stored: string,
  scale: number | null,
  field = 'amount'
): string {
  if (supplied !== undefined) return supplied;
  if (scale === null || scale === undefined) {
    throw AppError.validation([{ field, message: 'Re-enter the amount for this older record' }]);
  }
  const decimal = new Decimal(stored);
  if (!Number.isInteger(scale) || scale < 0 || scale > 4 || decimal.decimalPlaces() > scale) {
    throw AppError.validation([{ field, message: 'Stored amount scale is inconsistent' }]);
  }
  // decimalPlaces() proves no nonzero digits are discarded: toFixed formats only.
  return decimal.toFixed(scale);
}

/** Strictly validate the effective unrounded request or reconstructed stored text. */
export function assertMoneyAmount(amount: string, currency: string, field = 'amount'): void {
  const check = checkAmountForCurrency(amount, currency);
  if (!check.ok) {
    throw AppError.validation([
      {
        field,
        message:
          check.reason === 'scale'
            ? `Amount scale exceeds maximum allowed for currency ${currency} (${check.maxScale} decimals)`
            : 'Amount must be a positive decimal string'
      }
    ]);
  }
}

export function assertMoneyCategory(
  category: EffectiveCategory | null,
  kind: TransactionKind
): void {
  if (!category) return;
  if (category.kind !== kind) {
    throw AppError.validation([
      {
        field: 'categoryId',
        message: `Category kind "${category.kind}" does not match transaction kind "${kind}"`
      }
    ]);
  }
  if (category.archivedAt !== null) {
    throw AppError.validation([{ field: 'categoryId', message: 'Category is archived' }]);
  }
}

export interface EffectiveCategory {
  id: string;
  kind: TransactionKind;
  archivedAt: Date | null;
}
