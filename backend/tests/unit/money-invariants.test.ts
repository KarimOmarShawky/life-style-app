import { describe, expect, it } from 'vitest';
import { checkAmountForCurrency } from '../../src/features/money/money.invariants.js';

describe('subscription amount scale', () => {
  it('checks the amount scale against the currency exponent', () => {
    expect(checkAmountForCurrency('10.50', 'USD')).toEqual({ ok: true, maxScale: 2 });
    expect(checkAmountForCurrency('100', 'JPY')).toEqual({ ok: true, maxScale: 0 });
    expect(checkAmountForCurrency('1.234', 'KWD')).toEqual({ ok: true, maxScale: 3 });
    expect(checkAmountForCurrency('10.005', 'USD')).toEqual({
      ok: false,
      reason: 'scale',
      maxScale: 2
    });
    expect(checkAmountForCurrency('10.5', 'JPY')).toMatchObject({ ok: false, reason: 'scale' });
    expect(checkAmountForCurrency('1.2345', 'KWD')).toMatchObject({ ok: false, reason: 'scale' });
    expect(checkAmountForCurrency('0', 'USD')).toMatchObject({ ok: false, reason: 'non_positive' });
    expect(checkAmountForCurrency('-1.00', 'USD')).toMatchObject({ ok: false, reason: 'format' });
    expect(checkAmountForCurrency(10.5, 'USD')).toMatchObject({ ok: false, reason: 'format' });
  });
});
