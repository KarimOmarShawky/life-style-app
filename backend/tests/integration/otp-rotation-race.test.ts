import '../infrastructure-safety.js';
import { beforeEach, describe, expect, it } from 'vitest';
import type { Redis } from 'ioredis';
import { RedisOtpStore } from '../../src/core/security/otp-service.js';
import { getRedisClient } from '../../src/infrastructure/redis/redis-client.js';

describe('OTP rotation and verification on real Redis', () => {
  const redis = getRedisClient();
  const userId = '33333333-3333-4333-8333-333333333333';
  beforeEach(async () => {
    await redis.flushdb();
  });

  function suspendedSnapshot(): { client: Redis; captured: Promise<void>; release: () => void } {
    let capture!: () => void;
    let release!: () => void;
    const captured = new Promise<void>((resolve) => {
      capture = resolve;
    });
    const waiting = new Promise<void>((resolve) => {
      release = resolve;
    });
    let suspended = false;
    const client = new Proxy(redis, {
      get(target, property) {
        const original = Reflect.get(target, property, target);
        if ((property === 'get' || property === 'mget') && !suspended) {
          return async (...args: string[]) => {
            const result = await original.apply(target, args);
            suspended = true;
            capture();
            await waiting;
            return result;
          };
        }
        return typeof original === 'function' ? original.bind(target) : original;
      }
    });
    return { client, captured, release };
  }

  it.each(['correct', 'wrong'] as const)(
    'does not let a stale %s verification consume or damage a newer code',
    async (mode) => {
      const issuingStore = new RedisOtpStore(redis);
      const oldCode = await issuingStore.generateAndStoreCode(userId);
      const blocked = suspendedSnapshot();
      const verifyingStore = new RedisOtpStore(blocked.client);
      const wrong = (Number(oldCode) + 1) % 1_000_000;
      const oldGuess = mode === 'correct' ? oldCode : wrong.toString().padStart(6, '0');
      const inFlight = verifyingStore.verifyAndConsumeCode(userId, oldGuess);
      await blocked.captured;
      let newCode = await issuingStore.generateAndStoreCode(userId);
      while (newCode === oldCode || newCode === oldGuess)
        newCode = await issuingStore.generateAndStoreCode(userId);
      if (mode === 'wrong') await redis.set(`pwreset-attempts:${userId}`, '4', 'EX', 900);
      blocked.release();
      expect(await inFlight).toBe(false);
      expect(await issuingStore.verifyAndConsumeCode(userId, newCode)).toBe(true);
      expect(await issuingStore.verifyAndConsumeCode(userId, newCode)).toBe(false);
    }
  );

  it('fences a stale verifier even when the replacement has the same digits and HMAC', async () => {
    const store = new RedisOtpStore(redis);
    const code = await store.generateAndStoreCode(userId);
    const blocked = suspendedSnapshot();
    const verifying = new RedisOtpStore(blocked.client).verifyAndConsumeCode(userId, code);
    await blocked.captured;
    const hash = await redis.get(`pwreset:${userId}`);
    expect(hash).not.toBeNull();
    await redis
      .multi()
      .set(`pwreset:${userId}`, hash!, 'EX', 900)
      .del(`pwreset-attempts:${userId}`)
      .set(`pwreset-generation:${userId}`, 'replacement-generation', 'EX', 900)
      .exec();
    blocked.release();
    expect(await verifying).toBe(false);
    expect(await store.verifyAndConsumeCode(userId, code)).toBe(true);
  });

  it('atomically enforces five guesses, TTLs and single-use on real Redis', async () => {
    const store = new RedisOtpStore(redis);
    const code = await store.generateAndStoreCode(userId);
    const wrong = ((Number(code) + 1) % 1_000_000).toString().padStart(6, '0');
    for (let i = 0; i < 4; i++) expect(await store.verifyAndConsumeCode(userId, wrong)).toBe(false);
    expect(await redis.get(`pwreset-attempts:${userId}`)).toBe('4');
    expect(await redis.ttl(`pwreset-attempts:${userId}`)).toBeGreaterThan(0);
    expect(await redis.ttl(`pwreset-acct-attempts:${userId}`)).toBeGreaterThan(0);
    expect(await store.verifyAndConsumeCode(userId, code)).toBe(true);
    expect(await redis.get(`pwreset-acct-attempts:${userId}`)).toBe('5');
    expect(
      await redis.exists(
        `pwreset:${userId}`,
        `pwreset-attempts:${userId}`,
        `pwreset-generation:${userId}`
      )
    ).toBe(0);
    expect(await store.verifyAndConsumeCode(userId, code)).toBe(false);

    const nextCode = await store.generateAndStoreCode(userId);
    const wrongAgain = ((Number(nextCode) + 1) % 1_000_000).toString().padStart(6, '0');
    const results = await Promise.all(
      Array.from({ length: 12 }, () => store.verifyAndConsumeCode(userId, wrongAgain))
    );
    expect(results.every((result) => result === false)).toBe(true);
    expect(
      await redis.exists(
        `pwreset:${userId}`,
        `pwreset-attempts:${userId}`,
        `pwreset-generation:${userId}`
      )
    ).toBe(0);
    expect(await redis.get(`pwreset-acct-attempts:${userId}`)).toBe('10');
  });

  it('retains the cross-code account limit and accepts a legacy HMAC without a generation tag', async () => {
    const store = new RedisOtpStore(redis);
    const legacy = await store.generateAndStoreCode(userId);
    await redis.del(`pwreset-generation:${userId}`);
    expect(await store.verifyAndConsumeCode(userId, legacy)).toBe(true);
    for (let rotation = 0; rotation < 4; rotation++) {
      const code = await store.generateAndStoreCode(userId);
      const wrong = ((Number(code) + 1) % 1_000_000).toString().padStart(6, '0');
      for (let i = 0; i < 5; i++)
        expect(await store.verifyAndConsumeCode(userId, wrong)).toBe(false);
    }
    expect(await redis.get(`pwreset-acct-attempts:${userId}`)).toBe('21');
    const fresh = await store.generateAndStoreCode(userId);
    expect(await store.verifyAndConsumeCode(userId, fresh)).toBe(false);
    expect(await redis.exists(`pwreset:${userId}`)).toBe(0);
  });

  it('allows exactly one concurrent correct verifier and leaves no live token or counter', async () => {
    const store = new RedisOtpStore(redis);
    const code = await store.generateAndStoreCode(userId);
    const results = await Promise.all(
      Array.from({ length: 12 }, () => store.verifyAndConsumeCode(userId, code))
    );
    expect(results.filter(Boolean)).toHaveLength(1);
    expect(
      await redis.exists(
        `pwreset:${userId}`,
        `pwreset-attempts:${userId}`,
        `pwreset-generation:${userId}`
      )
    ).toBe(0);
    expect(await redis.get(`pwreset-acct-attempts:${userId}`)).toBe('1');
  });
});
