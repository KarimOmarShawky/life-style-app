/**
 * tests/unit/clock-money-pagination.test.ts
 *
 * Verifies Section 7: Time, Money, and Pagination core utilities.
 */

import { describe, it, expect } from 'vitest';
import { SystemClock, FakeClock } from '../../src/core/time/clock.js';
import { Money } from '../../src/core/money/money.js';
import { encodeCursor, decodeCursor } from '../../src/core/pagination/cursor.js';
import { AppError } from '../../src/core/errors/app-error.js';

describe('Time and Clock Architecture (Spec §7.1, ADR-010)', () => {
  it('SystemClock returns valid current Date', () => {
    const clock = new SystemClock();
    const now = clock.now();
    expect(now).toBeInstanceOf(Date);
    expect(Math.abs(now.getTime() - Date.now())).toBeLessThan(1000);
  });

  it('FakeClock advances deterministically', () => {
    const clock = new FakeClock(new Date('2026-09-24T10:00:00.000Z'));
    expect(clock.now().toISOString()).toBe('2026-09-24T10:00:00.000Z');

    clock.advanceMinutes(30);
    expect(clock.now().toISOString()).toBe('2026-09-24T10:30:00.000Z');

    clock.advanceHours(2);
    expect(clock.now().toISOString()).toBe('2026-09-24T12:30:00.000Z');

    clock.advanceDays(1);
    expect(clock.now().toISOString()).toBe('2026-09-25T12:30:00.000Z');
  });
});

describe('Monetary Precision Architecture (Spec §7.2, §11, ADR-009)', () => {
  it('performs exact decimal arithmetic avoiding IEEE 754 precision errors', () => {
    // In float: 0.1 + 0.2 = 0.30000000000000004
    const m1 = new Money('0.1000');
    const m2 = new Money('0.2000');
    const sum = m1.add(m2);

    expect(sum.toDecimalString(4)).toBe('0.3000');
  });

  it('formats to PostgreSQL numeric(19,4) 4 decimal places', () => {
    const m = new Money('125.5');
    expect(m.toDecimalString(4)).toBe('125.5000');
  });

  it('rejects values with more than 4 decimal places with validation error', () => {
    expect(() => new Money('10.12345')).toThrow(AppError);
  });

  it('rejects invalid monetary strings', () => {
    expect(() => new Money('invalid-money')).toThrow(AppError);
  });
});

describe('Pagination Cursor Encoding and Decoding (Spec §7.4, ADR-027)', () => {
  it('encodes and decodes pagination cursor correctly', () => {
    const payload = {
      id: 'd9b73678-75f1-432a-bc91-231362095cb7',
      timestamp: '2026-09-24T15:30:00.000Z'
    };

    const encoded = encodeCursor(payload);
    expect(typeof encoded).toBe('string');
    expect(encoded).not.toContain('{');

    const decoded = decodeCursor(encoded);
    expect(decoded.id).toBe(payload.id);
    expect(decoded.timestamp).toBe(payload.timestamp);
  });

  it('throws validation error when decoding a corrupted or malformed cursor', () => {
    expect(() => decodeCursor('not-valid-base64-json')).toThrow(AppError);
  });
});
