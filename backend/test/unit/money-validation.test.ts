/**
 * Money validation schemas.
 *
 * The amount schema is the one worth testing in isolation. It is the boundary
 * that decides whether a number reaching this API keeps its value, and the
 * interesting cases are all about what it REFUSES rather than what it accepts:
 * a rounded amount is indistinguishable from a correct one once stored.
 */
import { describe, expect, it } from 'vitest';

import {
  createBudgetSchema,
  createExpenseSchema,
  createSubscriptionSchema,
  currencySchema,
  monthSchema,
  moneyAmountSchema,
  updateExpenseSchema,
  upcomingRenewalsQuerySchema,
} from '@/features/money/money.validation';

describe('moneyAmountSchema', () => {
  it('accepts a decimal string and leaves it exactly as written', () => {
    expect(moneyAmountSchema.parse('0.10')).toBe('0.10');
    expect(moneyAmountSchema.parse('1234.56')).toBe('1234.56');
  });

  it('accepts a whole number with no decimal point', () => {
    expect(moneyAmountSchema.parse('42')).toBe('42');
  });

  it('accepts a JSON number that survives the trip intact', () => {
    expect(moneyAmountSchema.parse(19.99)).toBe('19.99');
    expect(moneyAmountSchema.parse(5)).toBe('5');
  });

  it('rejects a third decimal place rather than rounding it away', () => {
    expect(moneyAmountSchema.safeParse('1.005').success).toBe(false);
  });

  it('rejects the result of floating-point addition', () => {
    // 0.1 + 0.2 is 0.30000000000000004. Accepting it would mean silently
    // storing a value the client did not intend and cannot reconcile later.
    expect(moneyAmountSchema.safeParse(0.1 + 0.2).success).toBe(false);
  });

  it('tells the caller to send a string, which is the way out', () => {
    const result = moneyAmountSchema.safeParse(0.1 + 0.2);
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0]?.message).toContain('string');
    }
  });

  it('rejects zero, in every spelling', () => {
    for (const value of ['0', '0.0', '0.00', '00.00', 0]) {
      expect(moneyAmountSchema.safeParse(value).success).toBe(false);
    }
  });

  it('rejects a negative amount', () => {
    // The column has CHECK (amount > 0); refusing here means the constraint is
    // never the thing that reports the error.
    expect(moneyAmountSchema.safeParse('-1.00').success).toBe(false);
    expect(moneyAmountSchema.safeParse(-1).success).toBe(false);
  });

  it('rejects more digits than NUMERIC(14,2) can hold', () => {
    expect(moneyAmountSchema.safeParse('999999999999.99').success).toBe(true);
    expect(moneyAmountSchema.safeParse('9999999999999.99').success).toBe(false);
  });

  it('rejects a number large enough to stringify in exponent form', () => {
    expect(moneyAmountSchema.safeParse(1e21).success).toBe(false);
  });

  it('rejects things that are not amounts at all', () => {
    for (const value of ['', ' ', 'abc', '1,000.00', '$5', '1.2.3', null, true, {}, []]) {
      expect(moneyAmountSchema.safeParse(value).success).toBe(false);
    }
  });

  it('rejects a non-finite number', () => {
    expect(moneyAmountSchema.safeParse(Number.NaN).success).toBe(false);
    expect(moneyAmountSchema.safeParse(Number.POSITIVE_INFINITY).success).toBe(false);
  });

  it('trims surrounding whitespace', () => {
    expect(moneyAmountSchema.parse(' 12.50 ')).toBe('12.50');
  });
});

describe('currencySchema', () => {
  it('uppercases a lowercase code', () => {
    expect(currencySchema.parse('egp')).toBe('EGP');
    expect(currencySchema.parse(' usd ')).toBe('USD');
  });

  it('rejects anything that is not three letters', () => {
    for (const value of ['EG', 'EGPX', 'DOLLARS', 'E1P', '123', '']) {
      expect(currencySchema.safeParse(value).success).toBe(false);
    }
  });
});

describe('monthSchema', () => {
  it('accepts a real month', () => {
    expect(monthSchema.parse('2026-09')).toBe('2026-09');
    expect(monthSchema.parse('2026-01')).toBe('2026-01');
    expect(monthSchema.parse('2026-12')).toBe('2026-12');
  });

  it('rejects a month number that does not exist', () => {
    expect(monthSchema.safeParse('2026-00').success).toBe(false);
    expect(monthSchema.safeParse('2026-13').success).toBe(false);
  });

  it('rejects a full date, which would carry a day the column forbids', () => {
    expect(monthSchema.safeParse('2026-09-15').success).toBe(false);
  });
});

describe('createExpenseSchema', () => {
  it('requires an amount and a category', () => {
    expect(createExpenseSchema.safeParse({ amount: '5.00' }).success).toBe(false);
    expect(createExpenseSchema.safeParse({ category: 'food' }).success).toBe(false);
  });

  it('rejects an unknown key rather than dropping it', () => {
    const result = createExpenseSchema.safeParse({
      amount: '5.00',
      category: 'food',
      userId: 'someone-else',
    });
    expect(result.success).toBe(false);
  });

  it('rejects a blank category', () => {
    expect(createExpenseSchema.safeParse({ amount: '5.00', category: '   ' }).success).toBe(false);
  });

  it('trims a category so it cannot fail the database CHECK', () => {
    const result = createExpenseSchema.parse({ amount: '5.00', category: '  food  ' });
    expect(result.category).toBe('food');
  });

  it('rejects a category longer than the column', () => {
    const result = createExpenseSchema.safeParse({ amount: '5.00', category: 'x'.repeat(61) });
    expect(result.success).toBe(false);
  });

  it('accepts a null note, which clears it', () => {
    expect(createExpenseSchema.parse({ amount: '5.00', category: 'f', note: null }).note).toBeNull();
  });
});

describe('updateExpenseSchema', () => {
  it('rejects an empty body', () => {
    expect(updateExpenseSchema.safeParse({}).success).toBe(false);
  });

  it('accepts a single field', () => {
    expect(updateExpenseSchema.safeParse({ amount: '1.00' }).success).toBe(true);
  });
});

describe('createSubscriptionSchema', () => {
  it('requires a renewal date', () => {
    expect(createSubscriptionSchema.safeParse({ name: 'x', amount: '1.00' }).success).toBe(false);
  });

  it('accepts only the two billing cycles the column allows', () => {
    const base = { name: 'x', amount: '1.00', renewalDate: '2026-09-24' };
    expect(createSubscriptionSchema.safeParse({ ...base, billingCycle: 'monthly' }).success).toBe(
      true,
    );
    expect(createSubscriptionSchema.safeParse({ ...base, billingCycle: 'yearly' }).success).toBe(
      true,
    );
    expect(createSubscriptionSchema.safeParse({ ...base, billingCycle: 'weekly' }).success).toBe(
      false,
    );
  });
});

describe('createBudgetSchema', () => {
  it('requires a month', () => {
    expect(createBudgetSchema.safeParse({ category: 'f', monthlyLimit: '1.00' }).success).toBe(
      false,
    );
  });
});

describe('upcomingRenewalsQuerySchema', () => {
  it('defaults to thirty days', () => {
    expect(upcomingRenewalsQuerySchema.parse({}).days).toBe(30);
  });

  it('coerces the query string, which is always text', () => {
    expect(upcomingRenewalsQuerySchema.parse({ days: '7' }).days).toBe(7);
  });

  it('bounds the window rather than clamping it silently', () => {
    expect(upcomingRenewalsQuerySchema.safeParse({ days: '0' }).success).toBe(false);
    expect(upcomingRenewalsQuerySchema.safeParse({ days: '366' }).success).toBe(false);
  });
});
