import { describe, expect, it } from 'vitest';
import {
  createSubscriptionSchema,
  updateSubscriptionSchema
} from '../../src/features/money/money.validation.js';

const base = { name: 'Cloud Hosting', billingUnit: 'month', anchorDate: '2026-01-01' };

describe('subscription validation', () => {
  it('accepts exact decimal strings at the currency scale', () => {
    for (const [amount, currency] of [
      ['12.50', 'USD'],
      ['1500', 'JPY'],
      ['1.250', 'KWD']
    ]) {
      expect(createSubscriptionSchema.parse({ ...base, amount, currency }).amount).toBe(amount);
    }
  });
  it('rejects excess scale, non-string amounts, zero and negative values', () => {
    for (const [amount, currency] of [
      ['12.505', 'USD'],
      ['1500.5', 'JPY'],
      [12.5, 'USD'],
      ['0.00', 'USD'],
      ['-10.00', 'USD']
    ]) {
      expect(createSubscriptionSchema.safeParse({ ...base, amount, currency }).success).toBe(false);
    }
  });
  it('validates subscriptions and disallows unexpected fields', () => {
    const sub = createSubscriptionSchema.parse({
      ...base,
      amount: '29.99',
      currency: 'USD',
      billingInterval: 1
    });
    expect(sub.name).toBe('Cloud Hosting');
    expect(sub.billingInterval).toBe(1);
    expect(updateSubscriptionSchema.safeParse({ amount: '1.2345', currency: 'KWD' }).success).toBe(
      false
    );
    expect(
      createSubscriptionSchema.safeParse({ ...base, amount: '1.00', currency: 'USD', extra: true })
        .success
    ).toBe(false);
  });
});
