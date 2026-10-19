import { describe, it, expect } from 'vitest';
import { Money } from '../../src/core/money/money.js';

describe('Money arithmetic basics', () => {
  it('constructs from string and exposes zero', () => {
    expect(Money.fromString('12.3456').toDecimalString()).toBe('12.3456');
    expect(Money.zero().toDecimalString()).toBe('0.0000');
    expect(Money.zero().isZero()).toBe(true);
  });

  it('adds, subtracts and multiplies exactly', () => {
    const a = Money.fromString('10.0050');
    const b = Money.fromString('0.0001');
    expect(a.add(b).toDecimalString()).toBe('10.0051');
    expect(a.subtract(b).toDecimalString()).toBe('10.0049');
    expect(a.multiply('2').toDecimalString()).toBe('20.0100');
    expect(a.multiply(3).toDecimalString()).toBe('30.0150');
  });

  it('reports sign correctly', () => {
    expect(Money.fromString('-1.0000').isNegative()).toBe(true);
    expect(Money.fromString('-1.0000').isPositive()).toBe(false);
    expect(Money.fromString('1.0000').isPositive()).toBe(true);
    expect(Money.zero().isPositive()).toBe(false);
    expect(Money.zero().isNegative()).toBe(false);
  });

  it('renders a custom number of decimal places and copies its decimal', () => {
    expect(Money.fromString('1.5').toDecimalString(2)).toBe('1.50');
    const decimal = Money.fromString('3.1415').toDecimal();
    expect(decimal.toFixed(4)).toBe('3.1415');
  });
});
