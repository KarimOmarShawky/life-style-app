/**
 * src/core/security/otp-service.ts
 *
 * Implements Section 8.5 & ADR-024: Password reset OTP generation, HMAC storage, and verification.
 * Stores HMAC-SHA256 codes in Redis with 15-minute TTL, 5-attempt limit, 60-second cooldown,
 * and a cross-code per-account attempt budget (AUD-03).
 */

import { randomInt, createHmac, timingSafeEqual } from 'node:crypto';
import type { Redis } from 'ioredis';
import { getEnv } from '../../config/env.js';

/**
 * Cross-code per-account verification budget (AUD-03). The per-code 5-attempt
 * counter is reset whenever a new code is issued, so without a budget that
 * survives code rotation an attacker burning codes from rotating IPs could
 * guess indefinitely. Each verification attempt (correct or not) consumes this
 * account budget, which is deliberately NOT reset on a new code.
 */
const MAX_ACCOUNT_ATTEMPTS = 20;
const ACCOUNT_ATTEMPT_WINDOW_SECONDS = 3600;

export interface OtpStore {
  generateAndStoreCode(userId: string): Promise<string>;
  verifyAndConsumeCode(userId: string, code: string): Promise<boolean>;
  checkCooldown(userId: string): Promise<boolean>;
}

export class RedisOtpStore implements OtpStore {
  private readonly hmacSecret: string;
  private readonly maxAccountAttempts: number = MAX_ACCOUNT_ATTEMPTS;
  private readonly accountAttemptWindowSeconds: number = ACCOUNT_ATTEMPT_WINDOW_SECONDS;

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

    // Cross-code per-account budget (AUD-03): consume it before the per-code
    // counter. Each verification attempt (correct or not) counts toward a
    // one-hour account budget that is NOT reset when a new code is issued, so
    // rotating reset codes cannot mint a fresh guess budget. When the budget is
    // exhausted the code is invalidated so the caller must request a new one.
    if (!(await this.consumeAccountAttempt(userId))) {
      await this.redis.del(redisKey);
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

  private accountAttemptsKey(userId: string): string {
    return `pwreset-acct-attempts:${userId}`;
  }

  /**
   * Atomically consumes one unit of the per-account verification budget and
   * reports whether the caller may proceed. The counter's TTL is set on the
   * first increment so it expires with the window; the budget is intentionally
   * never reset when a new code is issued (AUD-03).
   */
  private async consumeAccountAttempt(userId: string): Promise<boolean> {
    const key = this.accountAttemptsKey(userId);
    const count = await this.redis.incr(key);
    if (count === 1) {
      await this.redis.expire(key, this.accountAttemptWindowSeconds);
    }
    return count <= this.maxAccountAttempts;
  }
}
