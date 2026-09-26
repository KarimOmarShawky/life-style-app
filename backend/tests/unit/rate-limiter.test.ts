/**
 * tests/unit/rate-limiter.test.ts
 *
 * Verifies Section 16.3 & ADR-016: Rate limiter mechanics.
 */

import { describe, it, expect } from 'vitest';
import { MemoryRateLimiter } from '../../src/core/middleware/rate-limiter.js';

describe('Rate Limiter Mechanics (Spec §16.3)', () => {
  it('allows requests within limit and tracks remaining quota', async () => {
    const limiter = new MemoryRateLimiter();
    const key = 'test-ip-1';

    const res1 = await limiter.consume(key, 3, 60);
    expect(res1.allowed).toBe(true);
    expect(res1.remaining).toBe(2);

    const res2 = await limiter.consume(key, 3, 60);
    expect(res2.allowed).toBe(true);
    expect(res2.remaining).toBe(1);

    const res3 = await limiter.consume(key, 3, 60);
    expect(res3.allowed).toBe(true);
    expect(res3.remaining).toBe(0);

    const res4 = await limiter.consume(key, 3, 60);
    expect(res4.allowed).toBe(false);
    expect(res4.remaining).toBe(0);
  });
});
