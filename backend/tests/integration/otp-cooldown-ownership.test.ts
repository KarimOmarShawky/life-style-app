import '../infrastructure-safety.js';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { RedisOtpStore } from '../../src/core/security/otp-service.js';
import { PasswordResetProcessor } from '../../src/features/auth/password-reset.processor.js';
import { ResetRequestDispatcher } from '../../src/core/security/reset-request-dispatcher.js';
import { PgPasswordResetRequestStore } from '../../src/features/auth/password-reset-request.repository.pg.js';
import { getKyselyDb } from '../../src/infrastructure/database/postgres/kysely.js';
import { getPgPool } from '../../src/infrastructure/database/postgres/pool.js';
import { getRedisClient } from '../../src/infrastructure/redis/redis-client.js';

describe('owned reset cooldown on real Redis', () => {
  const redis = getRedisClient();
  const userId = '33333333-3333-4333-8333-333333333333';
  beforeEach(async () => redis.flushdb());

  it('uses expiring exclusive owners and never lets an old owner release or overwrite a newer code', async () => {
    const store = new RedisOtpStore(redis);
    const a = await store.acquireCooldown(userId);
    expect(a).toMatch(/^[a-f0-9]{32}$/);
    expect(await redis.ttl(`pwreset-cd:${userId}`)).toBeGreaterThan(0);
    expect(await store.acquireCooldown(userId)).toBeNull();
    // Explicitly expire A's lease without sleeping; B now owns the key.
    await redis.del(`pwreset-cd:${userId}`);
    const b = await store.acquireCooldown(userId);
    expect(b).not.toBe(a);
    expect(await store.releaseCooldown(userId, a!)).toBe(false);
    const code = await store.generateAndStoreCode(userId, b!);
    await expect(store.generateAndStoreCode(userId, a!)).rejects.toThrow();
    expect(await redis.get(`pwreset-cd:${userId}`)).toBe(b);
    expect(await store.verifyAndConsumeCode(userId, code)).toBe(true);
    expect(await store.releaseCooldown(userId, b!)).toBe(true);
    expect(await redis.exists(`pwreset-cd:${userId}`)).toBe(0);
  });

  it('prevents a stalled issuer from replacing the code sent by a newer cooldown owner', async () => {
    let entered!: () => void;
    let unblock!: () => void;
    const reachedIssue = new Promise<void>((resolve) => {
      entered = resolve;
    });
    const wait = new Promise<void>((resolve) => {
      unblock = resolve;
    });
    const client = new Proxy(redis, {
      get(target, property) {
        const original = Reflect.get(target, property, target);
        if (property === 'eval')
          return async (...args: unknown[]) => {
            if (String(args[0]).startsWith('-- otp-issue-v1')) {
              entered();
              await wait;
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
    const repo = {
      findUserByEmail: vi.fn(async () => ({
        id: userId,
        email: 'user@example.com',
        status: 'active'
      }))
    };
    const audit = { log: vi.fn(async () => {}) };
    const slow = new PasswordResetProcessor(repo, new RedisOtpStore(client), sender, audit);
    const newer = new PasswordResetProcessor(repo, new RedisOtpStore(redis), sender, audit);
    const oldAttempt = slow.process('user@example.com', { recordId: 'old', attempt: 1 });
    await reachedIssue;
    await redis.del(`pwreset-cd:${userId}`); // deterministic expiry
    await newer.process('user@example.com', { recordId: 'new', attempt: 1 });
    const newCode = sender.sendPasswordResetEmail.mock.calls[0]![1];
    unblock();
    await expect(oldAttempt).rejects.toThrow('PASSWORD_RESET_COOLDOWN_OWNERSHIP_LOST');
    expect(sender.sendPasswordResetEmail).toHaveBeenCalledTimes(1);
    expect(await new RedisOtpStore(redis).verifyAndConsumeCode(userId, newCode)).toBe(true);
    expect(await redis.ttl(`pwreset-cd:${userId}`)).toBeGreaterThan(0);
  });

  it('retains cooldown and issued code when SMTP may have accepted the message', async () => {
    let delivered = '';
    const sender = {
      sendPasswordResetEmail: vi.fn(async (_to: string, code: string) => {
        delivered = code;
        throw new Error('ambiguous timeout');
      }),
      sendReminderEmail: vi.fn(async () => {})
    };
    const repo = {
      findUserByEmail: vi.fn(async () => ({
        id: userId,
        email: 'user@example.com',
        status: 'active'
      }))
    };
    const processor = new PasswordResetProcessor(repo, new RedisOtpStore(redis), sender, {
      log: vi.fn(async () => {})
    });
    await expect(
      processor.process('user@example.com', { recordId: 'first', attempt: 1 })
    ).rejects.toThrow('PASSWORD_RESET_DELIVERY_FAILED');
    expect(await redis.ttl(`pwreset-cd:${userId}`)).toBeGreaterThan(0);
    await expect(
      processor.process('user@example.com', { recordId: 'second', attempt: 1 })
    ).rejects.toMatchObject({ code: 'PASSWORD_RESET_SUPPRESSED' });
    expect(sender.sendPasswordResetEmail).toHaveBeenCalledTimes(1);
    expect(await new RedisOtpStore(redis).verifyAndConsumeCode(userId, delivered)).toBe(true);
  });

  it('retries a pre-SMTP issuance failure through the real durable store without waiting out cooldown', async () => {
    const email = 'cooldown-owned-durable@example.com';
    const pool = getPgPool();
    await pool.query('DELETE FROM password_reset_requests WHERE email = $1', [email]);
    let failOnce = true;
    const client = new Proxy(redis, {
      get(target, property) {
        const original = Reflect.get(target, property, target);
        if (property === 'eval')
          return async (...args: unknown[]) => {
            const result = await original.apply(target, args);
            if (failOnce && String(args[0]).startsWith('-- otp-issue-v1')) {
              failOnce = false;
              throw new Error('lost Redis response');
            }
            return result;
          };
        return typeof original === 'function' ? original.bind(target) : original;
      }
    });
    const sender = {
      sendPasswordResetEmail: vi.fn(async (_to: string, _code: string) => {}),
      sendReminderEmail: vi.fn(async () => {})
    };
    const repo = { findUserByEmail: vi.fn(async () => ({ id: userId, email, status: 'active' })) };
    const processor = new PasswordResetProcessor(repo, new RedisOtpStore(client), sender, {
      log: vi.fn(async () => {})
    });
    const store = new PgPasswordResetRequestStore(getKyselyDb());
    let now = Date.now();
    const dispatcher = new ResetRequestDispatcher(
      ({ email: address, meta }) => processor.process(address, meta),
      { store, retryBackoffMs: 30_000, now: () => now }
    );
    try {
      expect(await dispatcher.admit({ email })).toBe(true);
      await dispatcher.waitForIdle();
      let row = (
        await pool.query(
          'SELECT status, attempts, last_error_code, next_attempt_at FROM password_reset_requests WHERE email = $1',
          [email]
        )
      ).rows[0];
      expect(row).toMatchObject({
        status: 'failed',
        attempts: 1,
        last_error_code: 'DELIVERY_FAILED'
      });
      expect(sender.sendPasswordResetEmail).not.toHaveBeenCalled();
      expect(await redis.exists(`pwreset-cd:${userId}`)).toBe(0);
      now = row.next_attempt_at.getTime();
      expect(await dispatcher.drainDue()).toBe(1);
      await dispatcher.waitForIdle();
      row = (
        await pool.query(
          'SELECT status, attempts, last_error_code FROM password_reset_requests WHERE email = $1',
          [email]
        )
      ).rows[0];
      expect(row).toMatchObject({ status: 'sent', attempts: 2, last_error_code: null });
      expect(sender.sendPasswordResetEmail).toHaveBeenCalledTimes(1);
      expect(
        await new RedisOtpStore(redis).verifyAndConsumeCode(
          userId,
          sender.sendPasswordResetEmail.mock.calls[0]![1]
        )
      ).toBe(true);
    } finally {
      await dispatcher.shutdown();
      await pool.query('DELETE FROM password_reset_requests WHERE email = $1', [email]);
    }
  });

  it('releases after an ambiguous Redis issue failure before SMTP, permitting a new request', async () => {
    let injected = false;
    const client = new Proxy(redis, {
      get(target, property) {
        const original = Reflect.get(target, property, target);
        if (property === 'eval')
          return async (...args: unknown[]) => {
            const result = await original.apply(target, args);
            if (!injected && String(args[0]).startsWith('-- otp-issue-v1')) {
              injected = true;
              throw new Error('lost Redis response');
            }
            return result;
          };
        return typeof original === 'function' ? original.bind(target) : original;
      }
    });
    const sender = {
      sendPasswordResetEmail: vi.fn(async (_to: string, _code: string) => {}),
      sendReminderEmail: vi.fn(async () => {})
    };
    const repo = {
      findUserByEmail: vi.fn(async () => ({
        id: userId,
        email: 'user@example.com',
        status: 'active'
      }))
    };
    const audit = { log: vi.fn(async () => {}) };
    const failed = new PasswordResetProcessor(repo, new RedisOtpStore(client), sender, audit);
    await expect(
      failed.process('user@example.com', { recordId: 'first', attempt: 1 })
    ).rejects.toThrow('lost Redis response');
    expect(sender.sendPasswordResetEmail).not.toHaveBeenCalled();
    expect(await redis.exists(`pwreset-cd:${userId}`)).toBe(0);
    const healthy = new PasswordResetProcessor(repo, new RedisOtpStore(redis), sender, audit);
    await healthy.process('user@example.com', { recordId: 'second', attempt: 1 });
    expect(sender.sendPasswordResetEmail).toHaveBeenCalledTimes(1);
    const code = sender.sendPasswordResetEmail.mock.calls[0]![1];
    expect(await new RedisOtpStore(redis).verifyAndConsumeCode(userId, code)).toBe(true);
  });
});
