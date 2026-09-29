import { describe, expect, it } from 'vitest';
import {
  currencySchema,
  dateStringSchema,
  decimalStringSchema,
  emailSchema,
  passwordSchema,
  timeStringSchema,
  uuidSchema
} from '@/lib/validation/common';

describe('validation schemas mirror backend rules', () => {
  it('password: ≥10 chars, not a common password, ≤72 bytes (mirrors auth.validation.ts)', () => {
    expect(passwordSchema.safeParse('short1a').success).toBe(false);
    expect(passwordSchema.safeParse('alllettershere').success).toBe(true); // backend has no complexity rule
    expect(passwordSchema.safeParse('1234567890').success).toBe(false); // common list
    expect(passwordSchema.safeParse('northwind2026').success).toBe(true);
    // > 72 bytes
    expect(passwordSchema.safeParse('a1'.repeat(40)).success).toBe(false);
  });

  it('date-only format', () => {
    expect(dateStringSchema.safeParse('2026-09-28').success).toBe(true);
    expect(dateStringSchema.safeParse('2026-9-28').success).toBe(false);
    expect(dateStringSchema.safeParse('2026-09-28T00:00:00Z').success).toBe(false);
  });

  it('time format HH:mm', () => {
    expect(timeStringSchema.safeParse('09:30').success).toBe(true);
    expect(timeStringSchema.safeParse('9:30').success).toBe(false);
    expect(timeStringSchema.safeParse('24:00').success).toBe(false);
  });

  it('decimal string (no exponent notation, no signs)', () => {
    expect(decimalStringSchema.safeParse('12.34').success).toBe(true);
    expect(decimalStringSchema.safeParse('12').success).toBe(true);
    expect(decimalStringSchema.safeParse('1e5').success).toBe(false);
    expect(decimalStringSchema.safeParse('-3').success).toBe(false);
    expect(decimalStringSchema.safeParse('1.2.3').success).toBe(false);
  });

  it('currency: uppercase 3-letter ISO code', () => {
    expect(currencySchema.safeParse('USD').success).toBe(true);
    expect(currencySchema.safeParse('usd').success).toBe(false);
    expect(currencySchema.safeParse('US').success).toBe(false);
  });

  it('uuid', () => {
    expect(uuidSchema.safeParse('22222222-2222-4222-8222-222222222222').success).toBe(true);
    expect(uuidSchema.safeParse('not-a-uuid').success).toBe(false);
  });

  it('email', () => {
    expect(emailSchema.safeParse('user@example.test').success).toBe(true);
    expect(emailSchema.safeParse('nope@').success).toBe(false);
  });
});
