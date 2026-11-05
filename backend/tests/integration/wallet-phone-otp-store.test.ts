import '../infrastructure-safety.js';
import { randomBytes } from 'node:crypto';
import { inspect } from 'node:util';
import { Redis } from 'ioredis';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { walletPhoneLookup } from '../../src/features/wallet-auth/wallet-phone-security.js';
import { WalletPhoneOtpStore } from '../../src/features/wallet-auth/wallet-phone-otp-store.js';

// Synthetic phone/code data, on an isolated Redis database; no SMS delivery.
describe('wallet phone OTP primitives on Redis', () => {
  const redis = new Redis(process.env.REDIS_URL!);
  const lookupSecret = randomBytes(32);
  const otpSecret = randomBytes(32);
  const phone = '+201012345678';
  const tag = walletPhoneLookup(lookupSecret, phone).toString('hex');
  const prefix = `wallet:phone:otp:{${tag}}:`;
  const store = new WalletPhoneOtpStore(redis, lookupSecret, otpSecret);

  beforeEach(async () => {
    const keys = await redis.keys(`${prefix}*`);
    if (keys.length) await redis.del(...keys);
  });
  afterAll(async () => {
    const keys = await redis.keys(`${prefix}*`);
    if (keys.length) await redis.del(...keys);
    await redis.quit();
  });

  it('stores only a challenge identifier and keyed digest and consumes a valid code once', async () => {
    const challenge = await store.issue(phone);
    expect(challenge).not.toBeNull();
    expect(JSON.stringify(challenge)).not.toContain(challenge!.code);
    expect(inspect(challenge)).not.toContain(challenge!.code);
    const value = await redis.get(`${prefix}current`);
    expect(value).toMatch(/^[0-9a-f-]{36}:[0-9a-f]{64}$/);
    expect(value!.includes(phone)).toBe(false);
    expect(await redis.ttl(`${prefix}current`)).toBeGreaterThan(0);
    expect(await store.verify(phone, challenge!.id, challenge!.code)).toBe(true);
    expect(await store.verify(phone, challenge!.id, challenge!.code)).toBe(false);
  });

  it('allows exactly one concurrent issuance and redacts the store keys', async () => {
    const results = await Promise.all(Array.from({ length: 20 }, () => store.issue(phone)));
    expect(results.filter((item) => item !== null)).toHaveLength(1);
    expect(await redis.get(`${prefix}issued`)).toBe('1');
    expect(inspect(store)).not.toContain(lookupSecret.toString('hex'));
    expect(inspect(store)).not.toContain(otpSecret.toString('hex'));
    expect(JSON.stringify(store)).toContain('[redacted]');
    expect(() => new WalletPhoneOtpStore(redis, lookupSecret, lookupSecret)).toThrow();
    expect(() => new WalletPhoneOtpStore(redis, Buffer.alloc(31), otpSecret)).toThrow();
  });

  it('allows exactly one concurrent consumer', async () => {
    const challenge = (await store.issue(phone))!;
    const results = await Promise.all(
      Array.from({ length: 20 }, () => store.verify(phone, challenge.id, challenge.code))
    );
    expect(results.filter(Boolean)).toHaveLength(1);
  });

  it('enforces a five-attempt per-challenge bound and rejects expired challenges', async () => {
    const challenge = (await store.issue(phone))!;
    const wrong = ((Number(challenge.code) + 1) % 1_000_000).toString().padStart(6, '0');
    for (let i = 0; i < 5; i++) {
      expect(await store.verify(phone, challenge.id, wrong)).toBe(false);
    }
    expect(await store.verify(phone, challenge.id, challenge.code)).toBe(false);
    await redis.del(`${prefix}cooldown`);
    const another = (await store.issue(phone))!;
    await redis.del(`${prefix}current`); // Model expiry without wall-clock sleeps.
    expect(await store.verify(phone, another.id, another.code)).toBe(false);
  });

  it('enforces per-phone issuance and cross-code verification budgets', async () => {
    for (let i = 0; i < 5; i++) {
      const challenge = (await store.issue(phone))!;
      const wrong = ((Number(challenge.code) + 1) % 1_000_000).toString().padStart(6, '0');
      for (let attempt = 0; attempt < 4; attempt++) {
        expect(await store.verify(phone, challenge.id, wrong)).toBe(false);
      }
      await redis.del(`${prefix}cooldown`); // Model cooldown expiry.
    }
    expect(await store.issue(phone)).toBeNull();
    // Model a new issuance window, while the cross-code verification window remains.
    await redis.del(`${prefix}issued`);
    const next = (await store.issue(phone))!;
    expect(await store.verify(phone, next.id, next.code)).toBe(false);
  });

  it.each(['correct', 'wrong'] as const)(
    'does not let an in-flight stale %s verification consume or damage a replacement code',
    async (mode) => {
      const old = (await store.issue(phone))!;
      let capture!: () => void;
      let release!: () => void;
      const captured = new Promise<void>((resolve) => {
        capture = resolve;
      });
      const waiting = new Promise<void>((resolve) => {
        release = resolve;
      });
      let paused = false;
      const proxy = new Proxy(redis, {
        get(target, property) {
          const original = Reflect.get(target, property, target);
          if (property === 'get' && !paused) {
            return async (...args: string[]) => {
              const result = await original.apply(target, args);
              paused = true;
              capture();
              await waiting;
              return result;
            };
          }
          return typeof original === 'function' ? original.bind(target) : original;
        }
      });
      const verifying = new WalletPhoneOtpStore(proxy, lookupSecret, otpSecret);
      const guess =
        mode === 'correct'
          ? old.code
          : ((Number(old.code) + 1) % 1_000_000).toString().padStart(6, '0');
      const stale = verifying.verify(phone, old.id, guess);
      await captured;
      await redis.del(`${prefix}cooldown`);
      const replacement = (await store.issue(phone))!;
      release();
      expect(await stale).toBe(false);
      expect(await store.verify(phone, replacement.id, replacement.code)).toBe(true);
    }
  );

  it('does not turn a Redis failure into successful verification', async () => {
    const challenge = (await store.issue(phone))!;
    const failed = new Proxy(redis, {
      get(target, property) {
        if (property === 'get' || property === 'eval') {
          return async () => {
            throw new Error('synthetic Redis outage');
          };
        }
        const original = Reflect.get(target, property, target);
        return typeof original === 'function' ? original.bind(target) : original;
      }
    });
    const unavailable = new WalletPhoneOtpStore(failed, lookupSecret, otpSecret);
    await expect(unavailable.issue(phone)).rejects.toThrow('synthetic Redis outage');
    await expect(unavailable.verify(phone, challenge.id, challenge.code)).rejects.toThrow(
      'synthetic Redis outage'
    );
  });
});
