/**
 * tests/unit/otp-service.test.ts
 *
 * Validates Section 8.5 & B-10: OTP generation, HMAC verification, cooldown,
 * and atomic 5-attempt limit under concurrent verification requests.
 */

import { describe, it, expect, beforeAll, beforeEach, vi } from 'vitest';
import type { Redis } from 'ioredis';
import { RedisOtpStore } from '../../src/core/security/otp-service.js';

class InMemoryRedis {
  private readonly store = new Map<string, { value: string; expiresAt: number | null }>();
  private scriptQueue: Promise<void> = Promise.resolve();

  public async mget(...keys: string[]): Promise<(string | null)[]> {
    return Promise.all(keys.map((key) => this.get(key)));
  }

  // The production atomic Lua is separately exercised against real Redis.
  // This fake serializes script calls to retain the existing fast unit suite.
  public eval(script: string, count: number, ...values: Array<string | number>): Promise<number> {
    const keys = values.slice(0, count).map(String);
    const args = values.slice(count).map(String);
    const run = this.scriptQueue.then(async () => {
      const [code, attempts, account, generation] = keys as [string, string, string, string];
      if (script.startsWith('-- otp-release-cooldown-v1')) {
        if ((await this.get(code)) !== args[0]) return 0;
        return this.del(code);
      }
      if (script.startsWith('-- otp-issue-v1')) {
        if (args[2] && (await this.get(generation)) !== args[2]) return 0;
        await this.set(code, args[0]!, 'EX', 900);
        await this.del(attempts);
        await this.set(account, args[1]!, 'EX', 900); // third issuance key is the generation
        return 1;
      }
      if (!script.startsWith('-- otp-verify-v1')) throw new Error('Unknown test script');
      const current = await this.get(code);
      if (!current || current !== args[0] || ((await this.get(generation)) ?? '') !== args[1])
        return 0;
      const accountCount = await this.incr(account);
      if (accountCount === 1 || (await this.ttl(account)) < 0)
        await this.expire(account, Number(args[3]));
      if (accountCount > Number(args[2])) {
        await this.del(code, attempts, generation);
        return 0;
      }
      const countForCode = await this.incr(attempts);
      if (countForCode === 1 || (await this.ttl(attempts)) < 0) {
        const ttl = await this.ttl(code);
        await this.expire(attempts, ttl > 0 ? ttl : 900);
      }
      if (countForCode > 5) {
        await this.del(code, attempts, generation);
        return 0;
      }
      if (args[4] === '1') {
        await this.del(code, attempts, generation);
        return 1;
      }
      if (countForCode >= 5) await this.del(code, attempts, generation);
      return 0;
    });
    this.scriptQueue = run.then(
      () => undefined,
      () => undefined
    );
    return run;
  }

  private purgeIfExpired(key: string): void {
    const entry = this.store.get(key);
    if (entry && entry.expiresAt !== null && Date.now() >= entry.expiresAt) {
      this.store.delete(key);
    }
  }

  public async get(key: string): Promise<string | null> {
    this.purgeIfExpired(key);
    return this.store.get(key)?.value ?? null;
  }

  public async set(
    key: string,
    value: string,
    mode?: string,
    ttlSeconds?: number,
    nx?: string
  ): Promise<'OK' | null> {
    this.purgeIfExpired(key);
    if (nx === 'NX' && this.store.has(key)) {
      return null;
    }
    const expiresAt = mode === 'EX' && ttlSeconds ? Date.now() + ttlSeconds * 1000 : null;
    this.store.set(key, { value, expiresAt });
    return 'OK';
  }

  public async del(...keys: string[]): Promise<number> {
    let removed = 0;
    for (const key of keys) {
      this.purgeIfExpired(key);
      if (this.store.delete(key)) {
        removed += 1;
      }
    }
    return removed;
  }

  public async incr(key: string): Promise<number> {
    this.purgeIfExpired(key);
    const existing = this.store.get(key);
    const current = existing ? Number.parseInt(existing.value, 10) || 0 : 0;
    const next = current + 1;
    this.store.set(key, {
      value: String(next),
      expiresAt: existing?.expiresAt ?? null
    });
    return next;
  }

  public async ttl(key: string): Promise<number> {
    this.purgeIfExpired(key);
    const entry = this.store.get(key);
    if (!entry) return -2;
    if (entry.expiresAt === null) return -1;
    return Math.max(1, Math.ceil((entry.expiresAt - Date.now()) / 1000));
  }

  public async expire(key: string, seconds: number): Promise<number> {
    this.purgeIfExpired(key);
    const entry = this.store.get(key);
    if (!entry) return 0;
    entry.expiresAt = Date.now() + seconds * 1000;
    return 1;
  }

  public async exists(...keys: string[]): Promise<number> {
    let count = 0;
    for (const key of keys) {
      this.purgeIfExpired(key);
      if (this.store.has(key)) {
        count += 1;
      }
    }
    return count;
  }
}

describe('RedisOtpStore', () => {
  let redis: Redis;
  let otpStore: RedisOtpStore;
  const testUserId = '33333333-3333-4333-8333-333333333333';

  beforeAll(async () => {
    redis = new InMemoryRedis() as unknown as Redis;
    otpStore = new RedisOtpStore(redis);
  });

  beforeEach(async () => {
    await redis.del(
      `pwreset:${testUserId}`,
      `pwreset-cd:${testUserId}`,
      `pwreset-generation:${testUserId}`,
      `pwreset-attempts:${testUserId}`,
      `pwreset-acct-attempts:${testUserId}`
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

  it('fails on wrong code and enforces 5 attempts maximum, destroying the code on the 5th failure', async () => {
    await otpStore.generateAndStoreCode(testUserId);

    // Attempts 1 to 5 with wrong code
    for (let i = 1; i <= 5; i++) {
      const result = await otpStore.verifyAndConsumeCode(testUserId, '000000');
      expect(result).toBe(false);
    }

    // Key in Redis should already be destroyed on the 5th failed attempt
    expect(await redis.exists(`pwreset:${testUserId}`)).toBe(0);
    expect(await redis.exists(`pwreset-attempts:${testUserId}`)).toBe(0);

    // 6th attempt should also return false
    const sixth = await otpStore.verifyAndConsumeCode(testUserId, '000000');
    expect(sixth).toBe(false);
  });

  it('rejects an expired code without consuming a live replacement', async () => {
    vi.useFakeTimers();
    try {
      const expired = await otpStore.generateAndStoreCode(testUserId);
      vi.advanceTimersByTime(901_000);
      expect(await otpStore.verifyAndConsumeCode(testUserId, expired)).toBe(false);
    } finally {
      vi.useRealTimers();
    }
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
  });

  it('allows at most one winner when concurrent requests submit the valid code', async () => {
    const code = await otpStore.generateAndStoreCode(testUserId);

    const concurrentValid = Array.from({ length: 5 }, () =>
      otpStore.verifyAndConsumeCode(testUserId, code)
    );
    const results = await Promise.all(concurrentValid);
    const winners = results.filter((r) => r === true);
    expect(winners).toHaveLength(1);
    expect(await redis.exists(`pwreset:${testUserId}`)).toBe(0);
  });

  it('allows exactly 5 attempts per code, then rejects the correct code', async () => {
    const code = await otpStore.generateAndStoreCode(testUserId);

    for (let i = 1; i <= 5; i++) {
      expect(await otpStore.verifyAndConsumeCode(testUserId, '000000')).toBe(false);
    }

    // 6th attempt is refused even with the correct code.
    expect(await otpStore.verifyAndConsumeCode(testUserId, code)).toBe(false);
  });

  it('does not reset the per-account budget when a new code is issued (AUD-03)', async () => {
    const code = await otpStore.generateAndStoreCode(testUserId);
    const wrong = (Number(code) + 1) % 1_000_000;
    const wrongStr = wrong.toString().padStart(6, '0');

    // Burn the per-code budget on the first code.
    for (let i = 0; i < 5; i += 1) {
      expect(await otpStore.verifyAndConsumeCode(testUserId, wrongStr)).toBe(false);
    }
    expect(await redis.get(`pwreset-acct-attempts:${testUserId}`)).toBe('5');

    // Issuing a new code resets the per-code counter but MUST NOT reset the
    // cross-code per-account budget (AUD-03).
    await otpStore.generateAndStoreCode(testUserId);
    expect(await redis.get(`pwreset-acct-attempts:${testUserId}`)).toBe('5');
  });

  it('bounds total verification attempts across code rotation (AUD-03)', async () => {
    // The per-code counter resets on each new code, so without the per-account
    // budget an attacker rotating reset codes could guess indefinitely. Burn
    // the per-code budget across 4 rotations (20 attempts), then confirm the
    // 21st attempt is refused even with a freshly issued code.
    for (let rotation = 0; rotation < 4; rotation += 1) {
      const code = await otpStore.generateAndStoreCode(testUserId);
      const wrong = (Number(code) + 1) % 1_000_000;
      const wrongStr = wrong.toString().padStart(6, '0');
      for (let i = 0; i < 5; i += 1) {
        expect(await otpStore.verifyAndConsumeCode(testUserId, wrongStr)).toBe(false);
      }
      expect(await redis.exists(`pwreset:${testUserId}`)).toBe(0);
    }

    // Account budget is now exhausted; a fresh code is immediately invalidated.
    await otpStore.generateAndStoreCode(testUserId);
    expect(await otpStore.verifyAndConsumeCode(testUserId, '000000')).toBe(false);
    expect(await redis.exists(`pwreset:${testUserId}`)).toBe(0);
    expect(await redis.get(`pwreset-acct-attempts:${testUserId}`)).toBe('21');
  });

  it('counts a correct guess toward the per-account budget', async () => {
    const code = await otpStore.generateAndStoreCode(testUserId);
    expect(await otpStore.verifyAndConsumeCode(testUserId, code)).toBe(true);
    // The successful verification consumed one unit of the account budget.
    expect(await redis.get(`pwreset-acct-attempts:${testUserId}`)).toBe('1');
  });
});
