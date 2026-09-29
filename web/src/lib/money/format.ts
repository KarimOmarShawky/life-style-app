/**
 * Monetary utilities.
 *
 * Rules enforced:
 * - Money crosses the API as decimal strings only. Amounts are NEVER
 *   converted to JavaScript `Number` and never use floating-point math.
 * - All arithmetic uses decimal.js; display uses a tested decimal-string
 *   formatter.
 * - Business rules (subscription cycles, budget computations, streaks) stay
 *   server-side; these helpers only format and aggregate presentation values.
 */

import Decimal from 'decimal.js';

/** Same exponent table as the backend (`money.dto.ts`) for display purposes. */
const CURRENCY_EXPONENTS: Record<string, number> = {
  BIF: 0,
  CLP: 0,
  DJF: 0,
  GNF: 0,
  ISK: 0,
  JPY: 0,
  KMF: 0,
  KRW: 0,
  PYG: 0,
  RWF: 0,
  UGX: 0,
  UYI: 0,
  VND: 0,
  VUV: 0,
  XAF: 0,
  XOF: 0,
  XPF: 0,
  BHD: 3,
  IQD: 3,
  JOD: 3,
  KWD: 3,
  LYD: 3,
  OMR: 3,
  TND: 3
};

const CURRENCY_SYMBOLS: Record<string, string> = {
  USD: '$',
  EUR: '€',
  GBP: '£',
  JPY: '¥',
  CNY: '¥',
  INR: '₹',
  EGP: 'E£',
  AED: 'AED ',
  SAR: 'SAR '
};

export function currencyExponent(currency: string): number {
  const code = currency.toUpperCase();
  return CURRENCY_EXPONENTS[code] ?? 2;
}

/** Parse a decimal string; returns null when the input is not a valid decimal string. */
export function parseDecimalString(value: string): Decimal | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (!/^-?\d+(\.\d+)?$/.test(trimmed)) return null;
  try {
    return new Decimal(trimmed);
  } catch {
    return null;
  }
}

/** Insert thousands separators into an integer digit string (locale `en`). */
function groupInteger(digits: string): string {
  return digits.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}

/**
 * Format a decimal money string for display.
 *
 * Deterministic decimal-string formatting — no `Number` conversion:
 * `formatMoney('1234567.891', 'USD')` → `$1,234,567.89`.
 * Negative amounts render with a leading minus sign.
 */
export function formatMoney(amount: string, currency: string): string {
  const dec = parseDecimalString(amount);
  if (dec === null) return amount;
  const exponent = currencyExponent(currency);
  const fixed = dec.toFixed(exponent); // string math, no floats
  const negative = fixed.startsWith('-');
  const unsigned = negative ? fixed.slice(1) : fixed;
  const [intPart = '0', fracPart] = unsigned.split('.');
  const symbol = CURRENCY_SYMBOLS[currency.toUpperCase()] ?? `${currency.toUpperCase()} `;
  const fraction = fracPart ? `.${fracPart}` : exponent > 0 ? `.${'0'.repeat(exponent)}` : '';
  return `${negative ? '-' : ''}${symbol}${groupInteger(intPart)}${fraction}`;
}

/** Format a decimal string without a currency symbol (e.g. goal values). */
export function formatDecimal(value: string, maxFractionDigits?: number): string {
  const dec = parseDecimalString(value);
  if (dec === null) return value;
  const fixed = maxFractionDigits === undefined ? dec.toString() : dec.toFixed(maxFractionDigits);
  const negative = fixed.startsWith('-');
  const unsigned = negative ? fixed.slice(1) : fixed;
  const [intPart = '0', fracPart] = unsigned.split('.');
  const grouped = groupInteger(intPart);
  return `${negative ? '-' : ''}${grouped}${fracPart ? `.${fracPart}` : ''}`;
}

/** Sum decimal money strings exactly; returns a normalized decimal string. */
export function sumMoney(values: readonly string[]): string {
  let total = new Decimal(0);
  for (const value of values) {
    const dec = parseDecimalString(value);
    if (dec !== null) total = total.plus(dec);
  }
  return total.toFixed();
}

/** Subtract two decimal strings exactly (`a - b`). */
export function subtractMoney(a: string, b: string): string {
  const left = parseDecimalString(a) ?? new Decimal(0);
  const right = parseDecimalString(b) ?? new Decimal(0);
  return left.minus(right).toFixed();
}

/** Multiply a decimal string by a (non-money) number for display percentages. */
export function percentOf(part: string, whole: string): number | null {
  const p = parseDecimalString(part);
  const w = parseDecimalString(whole);
  if (p === null || w === null || w.isZero()) return null;
  return p.dividedBy(w).times(100).toNumber();
}

/** Format a server-provided percentage number (not a money value). */
export function formatPercent(value: number, fractionDigits = 1): string {
  if (!Number.isFinite(value)) return '—';
  return `${value.toFixed(fractionDigits)}%`;
}

/** True when the string is a valid positive decimal money amount. */
export function isPositiveDecimalString(value: string): boolean {
  const dec = parseDecimalString(value);
  return dec !== null && dec.greaterThan(0);
}
