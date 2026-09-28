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
    await redis.del(`pwreset:${testUserId}`, `pwreset-cd:${testUserId}`);
  });

  it('generates a 6-digit zero-padded OTP and stores it', async () => {
    const code = await otpStore.generateAndStoreCode(testUserId);
    expect(code).toMatch(/^\d{6}$/);

    const stored = await redis.get(`pwreset:${testUserId}`);
    expect(stored).not.toBeNull();
    const parsed = JSON.parse(stored!);
    expect(parsed.codeHmac).toBeDefined();
    expect(parsed.attempts).toBe(0);
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
});
