/**
 * src/core/security/otp-service.ts
 *
 * Implements Section 8.5 & ADR-024: Password reset OTP generation, HMAC storage, and verification.
 * Stores HMAC-SHA256 codes in Redis with 15-minute TTL, 5-attempt limit, and 60-second cooldown.
 */

import { randomInt, createHmac, timingSafeEqual } from 'node:crypto';
import type { Redis } from 'ioredis';
import { getEnv } from '../../config/env.js';

export interface OtpStore {
  generateAndStoreCode(userId: string): Promise<string>;
  verifyAndConsumeCode(userId: string, code: string): Promise<boolean>;
  checkCooldown(userId: string): Promise<boolean>;
}

export class RedisOtpStore implements OtpStore {
  private readonly hmacSecret: string;

  constructor(private readonly redis: Redis) {
    this.hmacSecret = getEnv().OTP_HMAC_SECRET;
  }

  public async checkCooldown(userId: string): Promise<boolean> {
    const cooldownKey = `pwreset-cd:${userId}`;
    const result = await this.redis.set(cooldownKey, '1', 'EX', 60, 'NX');
    return result === 'OK'; // true if set (cooldown started), false if key already existed
  }

  public async generateAndStoreCode(userId: string): Promise<string> {
    const rawNumber = randomInt(0, 1_000_000);
    const code = rawNumber.toString().padStart(6, '0');

    const codeHmac = createHmac('sha256', this.hmacSecret)
      .update(`${userId}:${code}`)
      .digest('hex');

    const redisKey = `pwreset:${userId}`;
    // Store the HMAC with 15 minutes TTL (900 seconds). Attempt accounting
    // lives in its own counter key so it can be incremented atomically.
    await this.redis.set(redisKey, codeHmac, 'EX', 900);
    await this.redis.del(this.attemptsKey(userId));

    return code;
  }

  public async verifyAndConsumeCode(userId: string, code: string): Promise<boolean> {
    const redisKey = `pwreset:${userId}`;
    const attemptsKey = this.attemptsKey(userId);
    const storedHmac = await this.redis.get(redisKey);

    if (!storedHmac) {
      return false;
    }

    // Count the attempt atomically BEFORE comparing. Every concurrent guess is
    // accounted for by a single Redis INCR, so the 5-guess cap cannot be
    // exceeded by parallel requests (a read-modify-write on the code payload
    // silently undercounted them).
    const attempts = await this.redis.incr(attemptsKey);
    if (attempts === 1) {
      // Tie the counter's lifetime to the code's remaining TTL so both expire
      // together. A legacy JSON payload has no usable TTL path here; fall back
      // to the full window.
      const ttl = await this.redis.ttl(redisKey);
      await this.redis.expire(attemptsKey, ttl > 0 ? ttl : 900);
    }

    if (attempts > 5) {
      // Exceeded 5 attempts: delete code
      await this.redis.del(redisKey, attemptsKey);
      return false;
    }

    const expectedHmac = createHmac('sha256', this.hmacSecret)
      .update(`${userId}:${code}`)
      .digest('hex');

    const bufA = Buffer.from(storedHmac, 'hex');
    const bufB = Buffer.from(expectedHmac, 'hex');

    if (bufA.length !== bufB.length || !timingSafeEqual(bufA, bufB)) {
      if (attempts >= 5) {
        await this.redis.del(redisKey, attemptsKey);
      }
      return false;
    }

    // Single-use guarantee: deleting the code key must return 1. Exactly one
    // of any concurrent correct guesses wins; the rest see 0 and fail.
    const delCount = await this.redis.del(redisKey);
    await this.redis.del(attemptsKey);
    return delCount === 1;
  }

  private attemptsKey(userId: string): string {
    return `pwreset-attempts:${userId}`;
  }
}
