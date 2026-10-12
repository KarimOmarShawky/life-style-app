/**
 * tests/unit/otp-service.test.ts
 *
 * Validates Section 8.5: OTP generation, HMAC verification, cooldown, and 5-attempt limit.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { RedisOtpStore } from '../../src/core/security/otp-service.js';
import { getRedisClient } from '../../src/infrastructure/redis/redis-client.js';

describe('RedisOtpStore', () => {
  const redis = getRedisClient();
  const otpStore = new RedisOtpStore(redis);
  const testUserId = '33333333-3333-4333-8333-333333333333';

  beforeEach(async () => {
    await redis.del(
      `pwreset:${testUserId}`,
      `pwreset-cd:${testUserId}`,
      `pwreset-attempts:${testUserId}`
    );
  });

  it('generates a 6-digit zero-padded OTP and stores it', async () => {
    const code = await otpStore.generateAndStoreCode(testUserId);
    expect(code).toMatch(/^\d{6}$/);

    const stored = await redis.get(`pwreset:${testUserId}`);
    expect(stored).not.toBeNull();
    // The stored value is the raw HMAC-SHA256 hex digest; the attempt counter
    // lives in its own key so it can be incremented atomically.
    expect(stored!).toMatch(/^[0-9a-f]{64}$/);
    expect(await redis.exists(`pwreset-attempts:${testUserId}`)).toBe(0);
    expect(await redis.ttl(`pwreset:${testUserId}`)).toBeGreaterThan(0);
  });

  it('verifies valid code and consumes it (single-use)', async () => {
    const code = await otpStore.generateAndStoreCode(testUserId);

    // First attempt with valid code should succeed
    const valid = await otpStore.verifyAndConsumeCode(testUserId, code);
    expect(valid).toBe(true);

    // Second attempt should fail because code is consumed
    const consumed = await otpStore.verifyAndConsumeCode(testUserId, code);
    expect(consumed).toBe(false);
  });

  it('fails on wrong code and enforces 5 attempts maximum', async () => {
    await otpStore.generateAndStoreCode(testUserId);

    // Attempts 1 to 5 with wrong code
    for (let i = 1; i <= 5; i++) {
      const result = await otpStore.verifyAndConsumeCode(testUserId, '000000');
      expect(result).toBe(false);
    }

    // 6th attempt should result in deleted code and return false
    const sixth = await otpStore.verifyAndConsumeCode(testUserId, '000000');
    expect(sixth).toBe(false);

    // Key in Redis should now be gone
    const keyExists = await redis.exists(`pwreset:${testUserId}`);
    expect(keyExists).toBe(0);
  });

  it('enforces 60-second cooldown on consecutive requests', async () => {
    const first = await otpStore.checkCooldown(testUserId);
    expect(first).toBe(true);

    // Second immediate check within 60s should return false
    const second = await otpStore.checkCooldown(testUserId);
    expect(second).toBe(false);
  });

  it('counts concurrent guesses atomically and never exceeds the 5-attempt cap', async () => {
    await otpStore.generateAndStoreCode(testUserId);

    // Fire 12 parallel wrong guesses. With a read-modify-write counter these
    // undercount each other and the code survives with attempts far below 5;
    // with the atomic INCR the cap is enforced and the code is destroyed.
    const guesses = Array.from({ length: 12 }, () =>
      otpStore.verifyAndConsumeCode(testUserId, '000000')
    );
    const results = await Promise.all(guesses);
    expect(results.every((r) => r === false)).toBe(true);

    expect(await redis.exists(`pwreset:${testUserId}`)).toBe(0);
    expect(await redis.exists(`pwreset-attempts:${testUserId}`)).toBe(0);

    // A correct guess afterwards must fail too: the code is gone.
    // (A fresh code would be needed; this one was burned by the guesses above.)
  });

  it('allows exactly 5 attempts per code, then rejects the correct code', async () => {
    const code = await otpStore.generateAndStoreCode(testUserId);

    for (let i = 1; i <= 5; i++) {
      expect(await otpStore.verifyAndConsumeCode(testUserId, '000000')).toBe(false);
    }

    // 6th attempt is refused even with the correct code.
    expect(await otpStore.verifyAndConsumeCode(testUserId, code)).toBe(false);
  });
});
