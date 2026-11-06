import '../infrastructure-safety.js';
import { randomBytes } from 'node:crypto';
import { inspect } from 'node:util';
import { Redis } from 'ioredis';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { walletPhoneLookup } from '../../src/features/wallet-auth/wallet-phone-security.js';
import { WalletPhoneOtpStore } from '../../src/features/wallet-auth/wallet-phone-otp-store.js';
import {
  WalletPhoneOtpDelivery,
  type WalletOtpDeliveryRequest
} from '../../src/features/wallet-auth/wallet-phone-otp-delivery.js';

// Synthetic numbers, codes and mocked provider; no external SMS or account.
describe('unwired wallet OTP provider orchestration on isolated Redis', () => {
  const redis = new Redis(process.env.REDIS_URL!);
  const lookupSecret = randomBytes(32);
  const otpSecret = randomBytes(32);
  const phone = '+201012345678';
  const prefix = `wallet:phone:otp:{${walletPhoneLookup(lookupSecret, phone).toString('hex')}}:`;
  const store = new WalletPhoneOtpStore(redis, lookupSecret, otpSecret);

  async function clear() {
    const keys = await redis.keys(`${prefix}*`);
    if (keys.length) await redis.del(...keys);
  }
  beforeEach(clear);
  afterAll(async () => {
    await clear();
    await redis.quit();
  });

  it('delivers only through the injected provider and returns no phone or code', async () => {
    let delivered: WalletOtpDeliveryRequest | undefined;
    const delivery = new WalletPhoneOtpDelivery(store, {
      send: async (request) => {
        delivered = request;
      }
    });
    const result = await delivery.request(phone);
    expect(result.accepted).toBe(true);
    if (!result.accepted || !delivered) throw new Error('missing synthetic challenge');
    expect(delivered.phone).toBe(phone);
    expect(delivered.code).toMatch(/^[0-9]{6}$/);
    for (const representation of [
      JSON.stringify(delivery),
      inspect(delivery),
      JSON.stringify(delivered),
      inspect(delivered),
      JSON.stringify(result)
    ]) {
      expect(representation).not.toContain(phone);
      expect(representation).not.toContain(delivered.code);
    }
    expect(await store.verify(phone, result.challengeId, delivered.code)).toBe(true);
    expect(await store.verify(phone, result.challengeId, delivered.code)).toBe(false);
  });

  it('calls the provider at most once when simultaneous requests compete for one issuance', async () => {
    let sends = 0;
    const delivery = new WalletPhoneOtpDelivery(store, {
      send: async () => {
        sends++;
      }
    });
    const results = await Promise.all(Array.from({ length: 20 }, () => delivery.request(phone)));
    expect(results.filter((r) => r.accepted)).toHaveLength(1);
    expect(results.filter((r) => !r.accepted)).toHaveLength(19);
    expect(sends).toBe(1);
    expect(await redis.get(`${prefix}issued`)).toBe('1');
  });

  it('masks a provider failure and invalidates only that challenge without refunding budgets', async () => {
    let code = '';
    const delivery = new WalletPhoneOtpDelivery(store, {
      send: async (request) => {
        code = request.code;
        throw new Error(`provider included ${request.phone} and ${request.code}`);
      }
    });
    let failure: unknown;
    try {
      await delivery.request(phone);
    } catch (error) {
      failure = error;
    }
    expect(failure).toBeInstanceOf(Error);
    expect((failure as Error).message).toBe('Wallet verification unavailable');
    expect(inspect(failure)).not.toContain(phone);
    expect(inspect(failure)).not.toContain(code);
    expect(await redis.get(`${prefix}current`)).toBeNull();
    expect(await redis.get(`${prefix}issued`)).toBe('1');
    expect(await redis.exists(`${prefix}cooldown`)).toBe(1);
    expect(await delivery.request(phone)).toEqual({ accepted: false });
  });

  it.each(['late failure', 'late acceptance'] as const)(
    'a %s cannot invalidate or expose a replacement challenge',
    async (mode) => {
      let entered!: () => void;
      let release!: () => void;
      const started = new Promise<void>((resolve) => {
        entered = resolve;
      });
      const gate = new Promise<void>((resolve) => {
        release = resolve;
      });
      const first = new WalletPhoneOtpDelivery(store, {
        send: async () => {
          entered();
          await gate;
          if (mode === 'late failure') throw new Error('synthetic provider failure');
        }
      });
      const pending = first.request(phone);
      const rejected = expect(pending).rejects.toThrow('Wallet verification unavailable');
      await started;
      let replacementCode = '';
      try {
        await redis.del(`${prefix}cooldown`); // model expiry of the real 60-second cooldown
        const second = new WalletPhoneOtpDelivery(store, {
          send: async (request) => {
            replacementCode = request.code;
          }
        });
        const replacement = await second.request(phone);
        expect(replacement.accepted).toBe(true);
        if (!replacement.accepted) throw new Error('expected replacement');
        release();
        await rejected;
        expect(await store.verify(phone, replacement.challengeId, replacementCode)).toBe(true);
      } finally {
        release();
      }
    }
  );

  it('does not report acceptance if the challenge expires or has too little lifetime left', async () => {
    let deliveredCode = '';
    const delivery = new WalletPhoneOtpDelivery(store, {
      send: async (request) => {
        deliveredCode = request.code;
        await redis.pexpire(`${prefix}current`, 30000);
      }
    });
    await expect(delivery.request(phone)).rejects.toThrow('Wallet verification unavailable');
    expect(deliveredCode).toMatch(/^[0-9]{6}$/);
    expect(await redis.get(`${prefix}current`)).toBeNull();
    expect(await redis.get(`${prefix}issued`)).toBe('1');
  });

  it('invalidates on status check failure when Redis cleanup still works', async () => {
    let code = '';
    const fault = new Proxy(redis, {
      get(target, property) {
        if (property === 'eval')
          return (...args: unknown[]) => {
            if (typeof args[0] === 'string' && args[0].includes('wallet-phone-otp-current-v1')) {
              return Promise.reject(new Error('synthetic status failure'));
            }
            return Reflect.apply(target.eval, target, args);
          };
        const value = Reflect.get(target, property, target);
        return typeof value === 'function' ? value.bind(target) : value;
      }
    });
    const delivery = new WalletPhoneOtpDelivery(
      new WalletPhoneOtpStore(fault, lookupSecret, otpSecret),
      {
        send: async (request) => {
          code = request.code;
        }
      }
    );
    await expect(delivery.request(phone)).rejects.toThrow('Wallet verification unavailable');
    expect(code).toMatch(/^[0-9]{6}$/);
    expect(await redis.get(`${prefix}current`)).toBeNull();
  });

  it('does not pretend invalidation succeeded if Redis fails during provider cleanup', async () => {
    let code = '';
    const fault = new Proxy(redis, {
      get(target, property) {
        if (property === 'eval')
          return (...args: unknown[]) => {
            if (typeof args[0] === 'string' && args[0].includes('wallet-phone-otp-invalidate-v1')) {
              return Promise.reject(new Error('synthetic cleanup failure'));
            }
            return Reflect.apply(target.eval, target, args);
          };
        const value = Reflect.get(target, property, target);
        return typeof value === 'function' ? value.bind(target) : value;
      }
    });
    const delivery = new WalletPhoneOtpDelivery(
      new WalletPhoneOtpStore(fault, lookupSecret, otpSecret),
      {
        send: async (request) => {
          code = request.code;
          throw new Error('delivery uncertain');
        }
      }
    );
    await expect(delivery.request(phone)).rejects.toThrow('Wallet verification unavailable');
    const snapshot = await redis.get(`${prefix}current`);
    expect(snapshot).not.toBeNull();
    const id = snapshot!.split(':')[0]!;
    // Demonstrates the remaining risk: an uncertain, previously delivered
    // challenge may remain usable when the cache cannot invalidate it.
    expect(await store.verify(phone, id, code)).toBe(true);
  });

  it('masks cache issuance errors and never calls the provider', async () => {
    let sends = 0;
    const unavailable = new Proxy(redis, {
      get(target, property) {
        if (property === 'eval')
          return async () => {
            throw new Error(`synthetic secret ${phone}`);
          };
        const value = Reflect.get(target, property, target);
        return typeof value === 'function' ? value.bind(target) : value;
      }
    });
    const delivery = new WalletPhoneOtpDelivery(
      new WalletPhoneOtpStore(unavailable, lookupSecret, otpSecret),
      {
        send: async () => {
          sends++;
        }
      }
    );
    let failure: unknown;
    try {
      await delivery.request(phone);
    } catch (error) {
      failure = error;
    }
    expect((failure as Error).message).toBe('Wallet verification unavailable');
    expect(inspect(failure)).not.toContain(phone);
    expect(sends).toBe(0);
  });

  it('rejects invalid phone or missing provider without attempting delivery', async () => {
    let sends = 0;
    expect(() => new WalletPhoneOtpDelivery(store, undefined as never)).toThrow(
      'Wallet OTP provider required'
    );
    const delivery = new WalletPhoneOtpDelivery(store, {
      send: async () => {
        sends++;
      }
    });
    await expect(delivery.request('invalid sensitive phone')).rejects.toThrow(
      'Wallet verification unavailable'
    );
    expect(sends).toBe(0);
  });
});
