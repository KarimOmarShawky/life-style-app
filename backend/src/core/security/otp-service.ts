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
    // Store JSON with 15 minutes TTL (900 seconds)
    const payload = JSON.stringify({ codeHmac, attempts: 0 });
    await this.redis.set(redisKey, payload, 'EX', 900);

    return code;
  }

  public async verifyAndConsumeCode(userId: string, code: string): Promise<boolean> {
    const redisKey = `pwreset:${userId}`;
    const data = await this.redis.get(redisKey);

    if (!data) {
      return false;
    }

    let parsed: { codeHmac: string; attempts: number };
    try {
      parsed = JSON.parse(data);
    } catch {
      await this.redis.del(redisKey);
      return false;
    }

    // Increment attempts atomically
    parsed.attempts += 1;
    if (parsed.attempts > 5) {
      // Exceeded 5 attempts: delete code
      await this.redis.del(redisKey);
      return false;
    }

    // Update attempts with remaining TTL
    const ttl = await this.redis.ttl(redisKey);
    if (ttl > 0) {
      await this.redis.set(redisKey, JSON.stringify(parsed), 'EX', ttl);
    }

    const expectedHmac = createHmac('sha256', this.hmacSecret)
      .update(`${userId}:${code}`)
      .digest('hex');

    const bufA = Buffer.from(parsed.codeHmac, 'hex');
    const bufB = Buffer.from(expectedHmac, 'hex');

    if (bufA.length !== bufB.length || !timingSafeEqual(bufA, bufB)) {
      return false;
    }

    // Single-use guarantee: atomic delete must return 1
    const delCount = await this.redis.del(redisKey);
    return delCount === 1;
  }
}
