/**
 * src/core/money/money.ts
 *
 * Implements Section 7.2, Section 11 & ADR-009: Exact Monetary Arithmetic.
 * Completely forbids JavaScript IEEE 754 floating point arithmetic for money.
 * Encapsulates decimal.js with fixed 4-decimal precision conforming to PostgreSQL numeric(19,4).
 */

import { Decimal } from 'decimal.js';
import { AppError } from '../errors/app-error.js';

// Configure Decimal precision and rounding
Decimal.set({ precision: 28, rounding: Decimal.ROUND_HALF_UP });

export class Money {
  private readonly value: Decimal;

  constructor(amount: string | Decimal) {
    if (typeof amount === 'string') {
      const trimmed = amount.trim();
      if (!/^-?\d+(\.\d{1,4})?$/.test(trimmed)) {
        throw AppError.validation([
          {
            field: 'amount',
            code: 'INVALID_MONETARY_FORMAT',
            message: 'Monetary amount must be a decimal string with at most 4 decimal places'
          }
        ]);
      }
      this.value = new Decimal(trimmed);
    } else {
      this.value = amount;
    }
  }

  public static fromString(amount: string): Money {
    return new Money(amount);
  }

  public static zero(): Money {
    return new Money(new Decimal(0));
  }

  public add(other: Money): Money {
    return new Money(this.value.plus(other.value));
  }

  public subtract(other: Money): Money {
    return new Money(this.value.minus(other.value));
  }

  public multiply(factor: number | string): Money {
    return new Money(this.value.times(new Decimal(factor)));
  }

  public isNegative(): boolean {
    return this.value.isNegative();
  }

  public isZero(): boolean {
    return this.value.isZero();
  }

  public isPositive(): boolean {
    return this.value.isPositive() && !this.value.isZero();
  }

  /**
   * Returns exact string formatted to specified decimal places (default 4 per numeric(19,4)).
   */
  public toDecimalString(decimalPlaces = 4): string {
    return this.value.toFixed(decimalPlaces);
  }

  public toDecimal(): Decimal {
    return new Decimal(this.value);
  }
}
