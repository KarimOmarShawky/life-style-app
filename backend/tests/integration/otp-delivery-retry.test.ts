import '../infrastructure-safety.js';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { PasswordResetProcessor } from '../../src/features/auth/password-reset.processor.js';
import { RedisOtpStore } from '../../src/core/security/otp-service.js';
import { ResetRequestDispatcher } from '../../src/core/security/reset-request-dispatcher.js';
import { PgPasswordResetRequestStore } from '../../src/features/auth/password-reset-request.repository.pg.js';
import { getKyselyDb } from '../../src/infrastructure/database/postgres/kysely.js';
import { getPgPool } from '../../src/infrastructure/database/postgres/pool.js';
import { getRedisClient } from '../../src/infrastructure/redis/redis-client.js';

const userId = '33333333-3333-4333-8333-333333333333';
const email = 'retry@example.com';
const firstId = '11111111-1111-4111-8111-111111111111';
const secondId = '22222222-2222-4222-8222-222222222222';
const repo = { findUserByEmail: vi.fn(async () => ({ id: userId, email, status: 'active' })) };
const audit = { log: vi.fn(async () => {}) };

describe('durable reset delivery retries with real Redis', () => {
  const redis = getRedisClient();
  beforeEach(async () => {
    await redis.flushdb();
  });
  const expireCooldown = () => redis.del(`pwreset-cd:${userId}`);

  it('reuses the exact delivered code and generation, without extending TTL or resetting guesses', async () => {
    const store = new RedisOtpStore(redis);
    const codes: string[] = [];
    const sender = {
      sendPasswordResetEmail: vi.fn(async (_to: string, code: string) => {
        codes.push(code);
        if (codes.length === 1) throw new Error('SMTP acceptance unclear');
      }),
      sendReminderEmail: vi.fn(async () => {})
    };
    const processor = new PasswordResetProcessor(repo, store, sender, audit);
    await expect(processor.process(email, { recordId: firstId, attempt: 1 })).rejects.toThrow(
      'PASSWORD_RESET_DELIVERY_FAILED'
    );
    await expect(processor.process(email, { recordId: firstId, attempt: 2 })).rejects.toMatchObject(
      { code: 'PASSWORD_RESET_THROTTLED' }
    );
    expect(sender.sendPasswordResetEmail).toHaveBeenCalledTimes(1);
    const firstGeneration = await redis.get(`pwreset-generation:${userId}`);
    const firstHmac = await redis.get(`pwreset:${userId}`);
    const stored = await redis.mget(...(await redis.keys(`pwreset*:${userId}`)));
    expect(stored).not.toContain(codes[0]);
    const wrong = ((Number(codes[0]!) + 1) % 1_000_000).toString().padStart(6, '0');
    expect(await store.verifyAndConsumeCode(userId, wrong)).toBe(false);
    const ttl = await redis.pttl(`pwreset:${userId}`);
    await expireCooldown();
    await processor.process(email, { recordId: firstId, attempt: 2 });
    expect(sender.sendPasswordResetEmail).toHaveBeenCalledTimes(2);
    expect(codes[1]).toBe(codes[0]);
    expect(await redis.get(`pwreset:${userId}`)).toBe(firstHmac);
    expect(await redis.get(`pwreset-generation:${userId}`)).toBe(firstGeneration);
    expect(await redis.get(`pwreset-attempts:${userId}`)).toBe('1');
    expect(await redis.pttl(`pwreset:${userId}`)).toBeLessThanOrEqual(ttl);
    expect(await store.verifyAndConsumeCode(userId, codes[0]!)).toBe(true);
  });

  it('does not let an older retry invalidate a newer request code', async () => {
    const store = new RedisOtpStore(redis);
    const codes: string[] = [];
    const sender = {
      sendPasswordResetEmail: vi.fn(async (_to: string, code: string) => {
        codes.push(code);
        if (codes.length === 1) throw new Error('SMTP acceptance unclear');
      }),
      sendReminderEmail: vi.fn(async () => {})
    };
    const processor = new PasswordResetProcessor(repo, store, sender, audit);
    await expect(processor.process(email, { recordId: firstId, attempt: 1 })).rejects.toThrow();
    await expireCooldown();
    await processor.process(email, { recordId: secondId, attempt: 1 });
    const newGeneration = await redis.get(`pwreset-generation:${userId}`);
    await expireCooldown();
    await expect(processor.process(email, { recordId: firstId, attempt: 2 })).rejects.toMatchObject(
      { code: 'PASSWORD_RESET_SUPPRESSED' }
    );
    expect(codes).toHaveLength(2);
    expect(await redis.get(`pwreset-generation:${userId}`)).toBe(newGeneration);
    expect(await store.verifyAndConsumeCode(userId, codes[1]!)).toBe(true);
  });

  it('allows a confirmed pre-issuance failure to retry without storing the raw code', async () => {
    let fail = true;
    const client = new Proxy(redis, {
      get(target, property) {
        const original = Reflect.get(target, property, target);
        if (property === 'eval')
          return async (...args: unknown[]) => {
            if (fail && String(args[0]).startsWith('-- otp-issue-v1')) {
              fail = false;
              throw new Error('before Redis write');
            }
            return original.apply(target, args);
          };
        return typeof original === 'function' ? original.bind(target) : original;
      }
    });
    const sender = {
      sendPasswordResetEmail: vi.fn(async (_to: string, _code: string) => {}),
      sendReminderEmail: vi.fn(async () => {})
    };
    const processor = new PasswordResetProcessor(repo, new RedisOtpStore(client), sender, audit);
    await expect(processor.process(email, { recordId: firstId, attempt: 1 })).rejects.toThrow(
      'before Redis write'
    );
    expect(await redis.exists(`pwreset-cd:${userId}`)).toBe(0);
    expect(sender.sendPasswordResetEmail).not.toHaveBeenCalled();
    await processor.process(email, { recordId: firstId, attempt: 2 });
    expect(sender.sendPasswordResetEmail).toHaveBeenCalledTimes(1);
    expect(
      await new RedisOtpStore(redis).verifyAndConsumeCode(
        userId,
        sender.sendPasswordResetEmail.mock.calls[0]![1]
      )
    ).toBe(true);
  });

  it('does not create pre-issuance proof over an existing live code', async () => {
    const store = new RedisOtpStore(redis);
    const token = (await store.acquireCooldown(userId))!;
    const existingCode = (await store.prepareDurableCode(userId, firstId, token, false))!;
    await expireCooldown();
    const client = new Proxy(redis, {
      get(target, property) {
        const original = Reflect.get(target, property, target);
        if (property === 'eval')
          return async (...args: unknown[]) => {
            if (String(args[0]).startsWith('-- otp-issue-v1'))
              throw new Error('before Redis write');
            return original.apply(target, args);
          };
        return typeof original === 'function' ? original.bind(target) : original;
      }
    });
    const sender = {
      sendPasswordResetEmail: vi.fn(async (_to: string, _code: string) => {}),
      sendReminderEmail: vi.fn(async () => {})
    };
    await expect(
      new PasswordResetProcessor(repo, new RedisOtpStore(client), sender, audit).process(email, {
        recordId: secondId,
        attempt: 1
      })
    ).rejects.toThrow();
    expect(await redis.exists(`pwreset-preissue:${userId}`)).toBe(0);
    await expect(
      new PasswordResetProcessor(repo, store, sender, audit).process(email, {
        recordId: secondId,
        attempt: 2
      })
    ).rejects.toMatchObject({ code: 'PASSWORD_RESET_SUPPRESSED' });
    expect(sender.sendPasswordResetEmail).not.toHaveBeenCalled();
    expect(await store.verifyAndConsumeCode(userId, existingCode)).toBe(true);
  });

  it('does not let a pre-issuance retry supersede a later valid code', async () => {
    let fail = true;
    const client = new Proxy(redis, {
      get(target, property) {
        const original = Reflect.get(target, property, target);
        if (property === 'eval')
          return async (...args: unknown[]) => {
            if (fail && String(args[0]).startsWith('-- otp-issue-v1')) {
              fail = false;
              throw new Error('before Redis write');
            }
            return original.apply(target, args);
          };
        return typeof original === 'function' ? original.bind(target) : original;
      }
    });
    const store = new RedisOtpStore(redis);
    const sender = {
      sendPasswordResetEmail: vi.fn(async (_to: string, _code: string) => {}),
      sendReminderEmail: vi.fn(async () => {})
    };
    const early = new PasswordResetProcessor(repo, new RedisOtpStore(client), sender, audit);
    const later = new PasswordResetProcessor(repo, store, sender, audit);
    await expect(early.process(email, { recordId: firstId, attempt: 1 })).rejects.toThrow();
    await later.process(email, { recordId: secondId, attempt: 1 });
    const code = sender.sendPasswordResetEmail.mock.calls[0]![1];
    const generation = await redis.get(`pwreset-generation:${userId}`);
    await expireCooldown();
    await expect(early.process(email, { recordId: firstId, attempt: 2 })).rejects.toMatchObject({
      code: 'PASSWORD_RESET_SUPPRESSED'
    });
    expect(sender.sendPasswordResetEmail).toHaveBeenCalledTimes(1);
    expect(await redis.get(`pwreset-generation:${userId}`)).toBe(generation);
    expect(await store.verifyAndConsumeCode(userId, code)).toBe(true);
  });

  it('cannot revive an expired generation, even after a transient Redis error on the retry', async () => {
    const store = new RedisOtpStore(redis);
    const sender = {
      sendPasswordResetEmail: vi.fn(async (_to: string, _code: string) => {
        throw new Error('ambiguous delivery');
      }),
      sendReminderEmail: vi.fn(async () => {})
    };
    const processor = new PasswordResetProcessor(repo, store, sender, audit);
    await expect(processor.process(email, { recordId: firstId, attempt: 1 })).rejects.toThrow();
    await redis.del(
      `pwreset-cd:${userId}`,
      `pwreset:${userId}`,
      `pwreset-generation:${userId}`,
      `pwreset-request:${userId}`
    );
    const client = new Proxy(redis, {
      get(target, property) {
        const original = Reflect.get(target, property, target);
        if (property === 'eval')
          return async (...args: unknown[]) => {
            if (String(args[0]).startsWith('-- otp-issue-v1'))
              throw new Error('retry Redis unavailable');
            return original.apply(target, args);
          };
        return typeof original === 'function' ? original.bind(target) : original;
      }
    });
    await expect(
      new PasswordResetProcessor(repo, new RedisOtpStore(client), sender, audit).process(email, {
        recordId: firstId,
        attempt: 2
      })
    ).rejects.toThrow('retry Redis unavailable');
    expect(await redis.exists(`pwreset-preissue:${userId}`)).toBe(0);
    await expect(processor.process(email, { recordId: firstId, attempt: 3 })).rejects.toMatchObject(
      { code: 'PASSWORD_RESET_SUPPRESSED' }
    );
    expect(sender.sendPasswordResetEmail).toHaveBeenCalledTimes(1);
    expect(await redis.exists(`pwreset:${userId}`)).toBe(0);
  });

  it('preserves the code through a durable PostgreSQL retry after uncertain SMTP acceptance', async () => {
    const pool = getPgPool();
    await pool.query('DELETE FROM password_reset_requests WHERE email = $1', [email]);
    const store = new RedisOtpStore(redis);
    const codes: string[] = [];
    const sender = {
      sendPasswordResetEmail: vi.fn(async (_to: string, code: string) => {
        codes.push(code);
        if (codes.length === 1) throw new Error('uncertain SMTP');
      }),
      sendReminderEmail: vi.fn(async () => {})
    };
    const processor = new PasswordResetProcessor(repo, store, sender, audit);
    let now = Date.now();
    const dispatcher = new ResetRequestDispatcher(
      ({ email: address, meta }) => processor.process(address, meta),
      {
        store: new PgPasswordResetRequestStore(getKyselyDb()),
        retryBackoffMs: 30_000,
        now: () => now
      }
    );
    try {
      expect(await dispatcher.admit({ email })).toBe(true);
      await dispatcher.waitForIdle();
      let row = (
        await pool.query(
          'SELECT status, attempts, last_error_code, next_attempt_at FROM password_reset_requests WHERE email=$1',
          [email]
        )
      ).rows[0];
      expect(row).toMatchObject({
        status: 'failed',
        attempts: 1,
        last_error_code: 'DELIVERY_FAILED'
      });
      const generation = await redis.get(`pwreset-generation:${userId}`);
      await expireCooldown();
      now = row.next_attempt_at.getTime();
      expect(await dispatcher.drainDue()).toBe(1);
      await dispatcher.waitForIdle();
      row = (
        await pool.query(
          'SELECT status, attempts, last_error_code FROM password_reset_requests WHERE email=$1',
          [email]
        )
      ).rows[0];
      expect(row).toMatchObject({ status: 'sent', attempts: 2, last_error_code: null });
      expect(codes).toHaveLength(2);
      expect(codes[1]).toBe(codes[0]);
      expect(await redis.get(`pwreset-generation:${userId}`)).toBe(generation);
      expect(await store.verifyAndConsumeCode(userId, codes[0]!)).toBe(true);
    } finally {
      await dispatcher.shutdown();
      await pool.query('DELETE FROM password_reset_requests WHERE email=$1', [email]);
    }
  });

  it('does not revive a code invalidated by the per-code guess limit', async () => {
    const store = new RedisOtpStore(redis);
    const sender = {
      sendPasswordResetEmail: vi.fn(async (_to: string, _code: string) => {
        throw new Error('ambiguous');
      }),
      sendReminderEmail: vi.fn(async () => {})
    };
    const processor = new PasswordResetProcessor(repo, store, sender, audit);
    await expect(processor.process(email, { recordId: firstId, attempt: 1 })).rejects.toThrow();
    const code = sender.sendPasswordResetEmail.mock.calls[0]![1];
    const wrong = ((Number(code) + 1) % 1_000_000).toString().padStart(6, '0');
    for (let i = 0; i < 5; i++) expect(await store.verifyAndConsumeCode(userId, wrong)).toBe(false);
    await expireCooldown();
    await expect(processor.process(email, { recordId: firstId, attempt: 2 })).rejects.toMatchObject(
      { code: 'PASSWORD_RESET_SUPPRESSED' }
    );
    expect(sender.sendPasswordResetEmail).toHaveBeenCalledTimes(1);
    expect(await store.verifyAndConsumeCode(userId, code)).toBe(false);
  });

  it('fails closed when the pre-issuance proof is lost', async () => {
    let fail = true;
    const client = new Proxy(redis, {
      get(target, property) {
        const original = Reflect.get(target, property, target);
        if (property === 'eval')
          return async (...args: unknown[]) => {
            if (fail && String(args[0]).startsWith('-- otp-issue-v1')) {
              fail = false;
              throw new Error('before Redis write');
            }
            return original.apply(target, args);
          };
        return typeof original === 'function' ? original.bind(target) : original;
      }
    });
    const sender = {
      sendPasswordResetEmail: vi.fn(async (_to: string, _code: string) => {}),
      sendReminderEmail: vi.fn(async () => {})
    };
    const processor = new PasswordResetProcessor(repo, new RedisOtpStore(client), sender, audit);
    await expect(processor.process(email, { recordId: firstId, attempt: 1 })).rejects.toThrow();
    expect(await redis.exists(`pwreset-preissue:${userId}`)).toBe(1);
    await redis.del(`pwreset-preissue:${userId}`);
    await expect(processor.process(email, { recordId: firstId, attempt: 2 })).rejects.toMatchObject(
      { code: 'PASSWORD_RESET_SUPPRESSED' }
    );
    expect(sender.sendPasswordResetEmail).not.toHaveBeenCalled();
    expect(await redis.exists(`pwreset:${userId}`)).toBe(0);
  });

  it('does not resurrect a consumed code or send again', async () => {
    const store = new RedisOtpStore(redis);
    let delivered = '';
    const sender = {
      sendPasswordResetEmail: vi.fn(async (_to: string, code: string) => {
        delivered = code;
        throw new Error('SMTP acceptance unclear');
      }),
      sendReminderEmail: vi.fn(async () => {})
    };
    const processor = new PasswordResetProcessor(repo, store, sender, audit);
    await expect(processor.process(email, { recordId: firstId, attempt: 1 })).rejects.toThrow();
    expect(await store.verifyAndConsumeCode(userId, delivered)).toBe(true);
    await expireCooldown();
    await expect(processor.process(email, { recordId: firstId, attempt: 2 })).rejects.toMatchObject(
      { code: 'PASSWORD_RESET_SUPPRESSED' }
    );
    expect(sender.sendPasswordResetEmail).toHaveBeenCalledTimes(1);
    expect(await store.verifyAndConsumeCode(userId, delivered)).toBe(false);
  });
});
