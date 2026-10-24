import { describe, it, expect, vi } from 'vitest';
import request from 'supertest';
import { ResetRequestDispatcher } from '../../src/core/security/reset-request-dispatcher.js';
import { AuthService } from '../../src/features/auth/auth.service.js';
import { createApp } from '../../src/app.js';
import { logger, requestContextStore } from '../../src/core/logger/logger.js';

function gate() {
  let release: () => void = () => undefined;
  const promise = new Promise<void>((resolve) => {
    release = resolve;
  });
  return { promise, release };
}
const tick = () => new Promise<void>((resolve) => setImmediate(resolve));

function fixture() {
  const repo = {
    findUserByEmail: vi.fn(
      async (
        _email: string
      ): Promise<
        | {
            id: string;
            email: string;
            status: string;
          }
        | undefined
      > => ({ id: 'u', email: 'private@example.com', status: 'active' })
    )
  };
  const otp = {
    checkCooldown: vi.fn(async () => true),
    generateAndStoreCode: vi.fn(async () => '123456')
  };
  const sender = { sendPasswordResetEmail: vi.fn(async () => undefined) };
  const audit = { log: vi.fn(async () => undefined) };
  const service = new AuthService(
    repo as never,
    {} as never,
    {} as never,
    {} as never,
    otp as never,
    sender as never,
    audit as never,
    { capacity: 4, concurrency: 1 }
  );
  return { repo, otp, sender, audit, service };
}

describe('Bounded volatile reset request dispatcher', () => {
  it('admits before processing, caps queued + active work and enforces concurrency', async () => {
    const blocked = gate();
    const work = vi.fn(async () => {
      await blocked.promise;
    });
    const queue = new ResetRequestDispatcher(work, { capacity: 3, concurrency: 1 });
    expect(queue.admit({ email: 'one@example.com' })).toBe(true);
    expect(work).not.toHaveBeenCalled();
    await tick();
    expect(work).toHaveBeenCalledTimes(1);
    expect(queue.admit({ email: 'two@example.com' })).toBe(true);
    expect(queue.admit({ email: 'three@example.com' })).toBe(true);
    expect(queue.admit({ email: 'four@example.com' })).toBe(false);
    await tick();
    expect(queue.snapshot()).toEqual({ active: 1, waiting: 2, accepting: true });
    const drain = queue.waitForIdle();
    expect(queue.waitForIdle()).toBe(drain);
    queue.stopAccepting();
    expect(queue.admit({ email: 'five@example.com' })).toBe(false);
    blocked.release();
    await drain;
    expect(work).toHaveBeenCalledTimes(3);
    expect(queue.snapshot()).toEqual({ active: 0, waiting: 0, accepting: false });
  });

  it('projects and snapshots only email and bounded request metadata, never extra secret fields', async () => {
    const work = vi.fn(async () => undefined);
    const queue = new ResetRequestDispatcher(work);
    const payload = {
      email: 'private@example.com',
      code: '123456',
      password: 'not-for-queue',
      meta: {
        requestId: 'r'.repeat(200),
        ip: 'i'.repeat(100),
        userAgent: 'a'.repeat(900),
        code: '123456'
      }
    };
    queue.admit(payload);
    payload.email = 'changed@example.com';
    payload.meta.requestId = 'changed';
    await queue.waitForIdle();
    expect(work).toHaveBeenCalledWith({
      email: 'private@example.com',
      meta: {
        requestId: 'r'.repeat(128),
        ip: 'i'.repeat(64),
        userAgent: 'a'.repeat(512)
      }
    });
    expect(JSON.stringify(work.mock.calls)).not.toContain('123456');
    expect(JSON.stringify(work.mock.calls)).not.toContain('not-for-queue');
  });

  it('expires stale queued requests before lookup, reports fixed metadata and continues after failure', async () => {
    let now = 0;
    const blocked = gate();
    const work = vi.fn(async () => {
      await blocked.promise;
      throw new Error('123456 private@example.com');
    });
    const log = vi.spyOn(logger, 'error').mockImplementation(() => undefined);
    try {
      const queue = new ResetRequestDispatcher(work, {
        capacity: 2,
        concurrency: 1,
        now: () => now
      });
      queue.admit({ email: 'first@example.com' });
      await tick();
      queue.admit({ email: 'second@example.com' });
      now = 60_000;
      blocked.release();
      await queue.waitForIdle();
      expect(work).toHaveBeenCalledTimes(1);
      expect(log).toHaveBeenCalledWith(expect.any(String), { reason: 'processing' });
      expect(log).toHaveBeenCalledWith(expect.any(String), { reason: 'expired' });
      expect(JSON.stringify(log.mock.calls)).not.toMatch(/123456|private@example.com/);
      queue.admit({ email: 'third@example.com' });
      await queue.waitForIdle();
      expect(work).toHaveBeenCalledTimes(2);
    } finally {
      log.mockRestore();
    }
  });

  it('does not inherit the admitting HTTP request context across background jobs', async () => {
    const observed: unknown[] = [];
    const work = vi.fn(async () => {
      observed.push(requestContextStore.getStore());
    });
    const queue = new ResetRequestDispatcher(work);
    requestContextStore.run({ requestId: 'first-request', userId: 'first-user' }, () => {
      queue.admit({ email: 'one@example.com' });
      queue.admit({ email: 'two@example.com' });
    });
    await queue.waitForIdle();
    expect(work).toHaveBeenCalledTimes(2);
    expect(observed).toEqual([undefined, undefined]);
  });

  it('does not strand a drain if diagnostics fail', async () => {
    const log = vi.spyOn(logger, 'error').mockImplementation(() => {
      throw new Error('private provider error');
    });
    const warning = vi.spyOn(process, 'emitWarning').mockImplementation(() => undefined);
    try {
      const queue = new ResetRequestDispatcher(async () => {
        throw new Error('123456');
      });
      queue.admit({ email: 'one@example.com' });
      queue.stopAccepting();
      await queue.waitForIdle();
      expect(warning).toHaveBeenCalledWith('Password reset diagnostic reporting failed');
      expect(queue.snapshot().active).toBe(0);
    } finally {
      log.mockRestore();
      warning.mockRestore();
    }
  });

  it.each([
    { capacity: 0 },
    { capacity: 257 },
    { concurrency: 0 },
    { capacity: 1, concurrency: 2 },
    { maxQueueAgeMs: 0 }
  ])('rejects invalid resource bounds %j', (options) => {
    expect(() => new ResetRequestDispatcher(async () => undefined, options)).toThrow(
      'Invalid reset dispatcher bounds'
    );
  });
});

describe('Password reset acceptance is not delivery', () => {
  it.each(['lookup', 'cooldown', 'SMTP'])(
    'HTTP 202 does not await stalled %s and drain does',
    async (stage) => {
      const f = fixture();
      const entered = gate();
      const blocked = gate();
      if (stage === 'lookup')
        f.repo.findUserByEmail.mockImplementation(async () => {
          entered.release();
          await blocked.promise;
          return { id: 'u', email: 'private@example.com', status: 'active' };
        });
      if (stage === 'cooldown')
        f.otp.checkCooldown.mockImplementation(async () => {
          entered.release();
          await blocked.promise;
          return true;
        });
      if (stage === 'SMTP')
        f.sender.sendPasswordResetEmail.mockImplementation(async () => {
          entered.release();
          await blocked.promise;
        });
      const app = createApp({ authService: f.service });
      try {
        const res = await request(app)
          .post('/api/v1/auth/forgot-password')
          .send({ email: 'private@example.com' })
          .timeout({ deadline: 1500 });
        expect(res.status).toBe(202);
        expect(res.body).toEqual({ success: true, data: {} });
        await entered.promise;
        let drained = false;
        const drain = f.service.waitForResetRequests().then(() => {
          drained = true;
        });
        await tick();
        expect(drained).toBe(false);
        f.service.stopResetRequests();
        const rejected = await request(app)
          .post('/api/v1/auth/forgot-password')
          .send({ email: 'unknown@example.com' });
        expect(rejected.status).toBe(503);
        blocked.release();
        await drain;
        expect(f.audit.log).toHaveBeenCalledWith(
          expect.objectContaining({ outcome: 'success', requestId: res.headers['x-request-id'] })
        );
      } finally {
        blocked.release();
        await f.service.waitForResetRequests();
      }
    }
  );

  it.each(['unknown', 'disabled', 'cooldown'])(
    'accepts %s generically, without generating/sending an OTP',
    async (kind) => {
      const f = fixture();
      if (kind === 'unknown') f.repo.findUserByEmail.mockResolvedValue(undefined);
      if (kind === 'disabled')
        f.repo.findUserByEmail.mockResolvedValue({
          id: 'u',
          email: 'private@example.com',
          status: 'disabled'
        });
      if (kind === 'cooldown') f.otp.checkCooldown.mockResolvedValue(false);
      await expect(f.service.forgotPassword('private@example.com')).resolves.toBeUndefined();
      expect(f.repo.findUserByEmail).not.toHaveBeenCalled();
      await f.service.waitForResetRequests();
      expect(f.otp.generateAndStoreCode).not.toHaveBeenCalled();
      expect(f.sender.sendPasswordResetEmail).not.toHaveBeenCalled();
    }
  );

  it('rejects full admission identically before lookup, independent of submitted account', async () => {
    const f = fixture();
    const blocked = gate();
    f.repo.findUserByEmail.mockImplementation(async () => {
      await blocked.promise;
      return undefined;
    });
    try {
      for (let i = 0; i < 4; i++) await f.service.forgotPassword(`queued${i}@example.com`);
      for (const email of ['private@example.com', 'unknown@example.com']) {
        await expect(f.service.forgotPassword(email)).rejects.toMatchObject({
          httpStatus: 503,
          code: 'SERVICE_UNAVAILABLE'
        });
      }
      expect(f.repo.findUserByEmail).not.toHaveBeenCalled();
    } finally {
      blocked.release();
      await f.service.waitForResetRequests();
    }
  });
});
