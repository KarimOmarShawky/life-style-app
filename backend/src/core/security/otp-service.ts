/**
 * src/core/security/otp-service.ts
 *
 * Implements Section 8.5 & ADR-024: Password reset OTP generation, HMAC storage, and verification.
 * Stores HMAC-SHA256 codes in Redis with 15-minute TTL, 5-attempt limit, 60-second cooldown,
 * and a cross-code per-account attempt budget (AUD-03).
 */

import { randomBytes, randomInt, createHmac, timingSafeEqual } from 'node:crypto';
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

// Issuance and the per-code counter reset are one Redis operation. The random
// generation tag distinguishes rotations even when the same six digits recur.
const ISSUE_SCRIPT = `-- otp-issue-v1
redis.call('SET', KEYS[1], ARGV[1], 'EX', 900)
redis.call('DEL', KEYS[2])
redis.call('SET', KEYS[3], ARGV[2], 'EX', 900)
return 1
`;

// Bind the verified snapshot, attempt budgets, TTLs and consume/delete to one
// atomic operation. A stale request must never mutate a replacement code.
const VERIFY_SCRIPT = `-- otp-verify-v1
local current = redis.call('GET', KEYS[1])
local generation = redis.call('GET', KEYS[4]) or ''
if not current or current ~= ARGV[1] or generation ~= ARGV[2] then return 0 end
local accountAttempts = redis.call('INCR', KEYS[3])
if accountAttempts == 1 or redis.call('TTL', KEYS[3]) < 0 then
  redis.call('EXPIRE', KEYS[3], tonumber(ARGV[4]))
end
if accountAttempts > tonumber(ARGV[3]) then
  redis.call('DEL', KEYS[1], KEYS[2], KEYS[4])
  return 0
end
local attempts = redis.call('INCR', KEYS[2])
if attempts == 1 or redis.call('PTTL', KEYS[2]) < 0 then
  local ttl = redis.call('PTTL', KEYS[1])
  redis.call('PEXPIRE', KEYS[2], ttl > 0 and ttl or 900000)
end
if attempts > 5 then
  redis.call('DEL', KEYS[1], KEYS[2], KEYS[4])
  return 0
end
if ARGV[5] == '1' then
  redis.call('DEL', KEYS[1], KEYS[2], KEYS[4])
  return 1
end
if attempts >= 5 then redis.call('DEL', KEYS[1], KEYS[2], KEYS[4]) end
return 0
`;

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
    await this.redis.eval(
      ISSUE_SCRIPT,
      3,
      redisKey,
      this.attemptsKey(userId),
      this.generationKey(userId),
      codeHmac,
      randomBytes(16).toString('hex')
    );
    return code;
  }

  public async verifyAndConsumeCode(userId: string, code: string): Promise<boolean> {
    const redisKey = `pwreset:${userId}`;
    // Both values are read together. Legacy codes without a generation tag
    // remain usable; all newly generated codes carry a unique tag.
    const [storedHmac, generation] = await this.redis.mget(redisKey, this.generationKey(userId));
    if (!storedHmac) return false;

    const expectedHmac = createHmac('sha256', this.hmacSecret)
      .update(`${userId}:${code}`)
      .digest('hex');
    const bufA = Buffer.from(storedHmac, 'hex');
    const bufB = Buffer.from(expectedHmac, 'hex');
    const matches = bufA.length === bufB.length && timingSafeEqual(bufA, bufB);

    const result = await this.redis.eval(
      VERIFY_SCRIPT,
      4,
      redisKey,
      this.attemptsKey(userId),
      this.accountAttemptsKey(userId),
      this.generationKey(userId),
      storedHmac,
      generation ?? '',
      this.maxAccountAttempts,
      this.accountAttemptWindowSeconds,
      matches ? '1' : '0'
    );
    return result === 1;
  }

  private attemptsKey(userId: string): string {
    return `pwreset-attempts:${userId}`;
  }

  private accountAttemptsKey(userId: string): string {
    return `pwreset-acct-attempts:${userId}`;
  }

  private generationKey(userId: string): string {
    return `pwreset-generation:${userId}`;
  }
}
