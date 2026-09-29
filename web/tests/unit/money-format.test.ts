import { describe, expect, it } from 'vitest';
import Decimal from 'decimal.js';
import {
  currencyExponent,
  formatDecimal,
  formatMoney,
  isPositiveDecimalString,
  parseDecimalString,
  percentOf,
  subtractMoney,
  sumMoney
} from '@/lib/money/format';

describe('currencyExponent map (mirrors money.dto.ts)', () => {
  it('knows zero-decimal and three-decimal currencies', () => {
    expect(currencyExponent('JPY')).toBe(0);
    expect(currencyExponent('KRW')).toBe(0);
    expect(currencyExponent('BHD')).toBe(3);
    expect(currencyExponent('KWD')).toBe(3);
    expect(currencyExponent('USD')).toBe(2);
    expect(currencyExponent('EUR')).toBe(2);
    expect(currencyExponent('zzz')).toBe(2); // unknown defaults to 2
  });
});

describe('formatMoney — decimal strings only, no floats', () => {
  it('formats USD with grouping and 2 decimals', () => {
    expect(formatMoney('1234.5', 'USD')).toBe('$1,234.50');
  });

  it('formats JPY with 0 decimals and no fake fraction', () => {
    expect(formatMoney('1234', 'JPY')).toBe('¥1,234');
  });

  it('formats KWD with 3 decimals', () => {
    expect(formatMoney('12.3', 'KWD')).toBe('KWD 12.300');
  });

  it('never introduces floating point noise', () => {
    expect(formatMoney('0.1', 'USD')).toBe('$0.10');
    expect(formatMoney('1.005', 'USD')).toBe('$1.01'); // half-up via Decimal, not IEEE754
    expect(formatMoney('123456789012345678.99', 'USD')).toBe('$123,456,789,012,345,678.99');
  });

  it('keeps negatives signed', () => {
    expect(formatMoney('-42.1', 'USD')).toBe('-$42.10');
  });
});

describe('decimal string helpers', () => {
  it('parses valid decimals and rejects garbage', () => {
    expect(parseDecimalString('12.50')?.toFixed(2)).toBe('12.50');
    expect(parseDecimalString('abc')).toBeNull();
    expect(parseDecimalString('1e5')).toBeNull();
  });

  it('validates positive decimal strings', () => {
    expect(isPositiveDecimalString('0.01')).toBe(true);
    expect(isPositiveDecimalString('0')).toBe(false);
    expect(isPositiveDecimalString('-1')).toBe(false);
    expect(isPositiveDecimalString('1.2.3')).toBe(false);
  });

  it('sums exactly beyond float precision', () => {
    const total = sumMoney(['0.1', '0.2', '1.005']);
    expect(total).toBe(new Decimal('1.305').toString());
    expect(total).toBe('1.305');
  });

  it('subtracts exactly', () => {
    expect(subtractMoney('1.00', '0.333')).toBe('0.667');
  });

  it('formats plain decimals with grouping', () => {
    expect(formatDecimal('1234567.89')).toBe('1,234,567.89');
    expect(formatDecimal('-42')).toBe('-42');
  });

  it('computes percent shares without floats where exact', () => {
    expect(percentOf('25', '100')).toBe(25);
    expect(percentOf('1', '3')).toBeCloseTo(33.333, 2);
    expect(percentOf('1', '0')).toBeNull();
  });
});
