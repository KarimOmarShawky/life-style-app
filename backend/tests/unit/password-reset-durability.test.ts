/**
 * tests/unit/password-reset-durability.test.ts
 *
 * F-06: accepted password-reset work must have durable ownership.
 * Before this change a 202 could describe work that existed only in the API
 * process's memory, so a crash, restart, forced shutdown, queue-age expiry or
 * SMTP failure silently dropped it.
 *
 * The store here is an in-memory stand-in with the same contract as
 * PgPasswordResetRequestStore; the SQL claim semantics are exercised by the
 * integration/migration gates, not by this unit test.
 */

import { describe, it, expect, vi } from 'vitest';
import { ResetRequestDispatcher } from '../../src/core/security/reset-request-dispatcher.js';
import type {
  ResetRequestRecord,
  ResetRequestStore,
  ResetRequestEnqueueInput
} from '../../src/core/security/reset-request-store.js';

const tick = () => new Promise<void>((resolve) => setImmediate(resolve));

class MemoryResetStore implements ResetRequestStore {
  public readonly rows: ResetRequestRecord[] = [];
  public failEnqueue = false;
  private seq = 0;

  public async enqueue(input: ResetRequestEnqueueInput): Promise<ResetRequestRecord> {
    if (this.failEnqueue) throw new Error('DATABASE_UNAVAILABLE');
    this.seq += 1;
    const now = new Date();
    const record: ResetRequestRecord = {
      id: `reset-${this.seq}`,
      email: input.email,
      status: 'pending',
      attempts: 0,
      nextAttemptAt: now,
      lastErrorCode: null,
      requestId: input.meta?.requestId ?? null,
      ip: input.meta?.ip ?? null,
      userAgent: input.meta?.userAgent ?? null,
      createdAt: now,
      updatedAt: now,
      completedAt: null,
      leaseExpiresAt: null
    };
    this.rows.push(record);
    return { ...record };
  }

  private claim(rows: ResetRequestRecord[], now: Date, leaseMs: number): ResetRequestRecord[] {
    const claimed: ResetRequestRecord[] = [];
    for (const row of rows) {
      row.status = 'processing';
      row.attempts += 1;
      row.leaseExpiresAt = new Date(now.getTime() + leaseMs);
      row.updatedAt = now;
      claimed.push({ ...row });
    }
    return claimed;
  }

  public async claimById(id: string, now: Date, leaseMs: number) {
    const row = this.rows.find((r) => r.id === id && r.status === 'pending');
    return row ? (this.claim([row], now, leaseMs)[0] ?? null) : null;
  }

  public async claimDue(now: Date, limit: number, leaseMs: number) {
    const due = this.rows
      .filter((r) => r.status === 'pending' || r.status === 'failed')
      .filter((r) => r.nextAttemptAt <= now)
      .slice(0, limit);
    return this.claim(due, now, leaseMs);
  }

  public async markSent(id: string, now: Date): Promise<void> {
    const row = this.rows.find((r) => r.id === id);
    if (row) {
      row.status = 'sent';
      row.completedAt = now;
      row.leaseExpiresAt = null;
    }
  }

  public async markRetry(
    id: string,
    now: Date,
    nextAttemptAt: Date,
    errorCode: string,
    attempts: number
  ): Promise<void> {
    const row = this.rows.find((r) => r.id === id);
    if (row) {
      row.status = 'failed';
      row.attempts = attempts;
      row.nextAttemptAt = nextAttemptAt;
      row.lastErrorCode = errorCode;
      row.leaseExpiresAt = null;
      row.updatedAt = now;
    }
  }

  public async markDeadLetter(
    id: string,
    now: Date,
    errorCode: string,
    attempts: number
  ): Promise<void> {
    const row = this.rows.find((r) => r.id === id);
    if (row) {
      row.status = 'dead_letter';
      row.attempts = attempts;
      row.lastErrorCode = errorCode;
      row.completedAt = now;
      row.leaseExpiresAt = null;
      row.updatedAt = now;
    }
  }

  public async recoverStale(now: Date): Promise<number> {
    let count = 0;
    for (const row of this.rows) {
      if (row.status === 'processing' && row.leaseExpiresAt && row.leaseExpiresAt <= now) {
        row.status = 'pending';
        row.leaseExpiresAt = null;
        count += 1;
      }
    }
    return count;
  }

  public async countClaimable(now: Date): Promise<number> {
    return this.rows.filter(
      (r) => r.status === 'pending' || (r.status === 'failed' && r.nextAttemptAt <= now)
    ).length;
  }

  public async purgeOlderThan(cutoff: Date, limit: number): Promise<number> {
    let purged = 0;
    for (const row of this.rows) {
      if (purged >= limit) break;
      if (
        (row.status === 'sent' || row.status === 'dead_letter') &&
        (row.completedAt ?? row.updatedAt) <= cutoff
      ) {
        row.status = 'purged' as ResetRequestRecord['status'];
        purged += 1;
      }
    }
    return purged;
  }
}

describe('Durable password-reset delivery (F-06)', () => {
  it('persists accepted work before the API can acknowledge it', async () => {
    const store = new MemoryResetStore();
    const gate = { release: () => undefined as void };
    const blocked = new Promise<void>((resolve) => {
      gate.release = resolve;
    });
    const work = vi.fn(async () => {
      await blocked;
    });
    const queue = new ResetRequestDispatcher(work, { store, concurrency: 1 });

    const admitted = await queue.admit({ email: 'durable@example.com' });
    expect(admitted).toBe(true);
    // The row exists and is durable before any delivery is attempted.
    expect(store.rows).toHaveLength(1);
    expect(store.rows[0]).toMatchObject({ email: 'durable@example.com', status: 'pending' });

    gate.release();
    await queue.waitForIdle();
    expect(store.rows[0]!.status).toBe('sent');
  });

  it('refuses to acknowledge work that could not be given durable ownership', async () => {
    const store = new MemoryResetStore();
    store.failEnqueue = true;
    const work = vi.fn(async () => undefined);
    const queue = new ResetRequestDispatcher(work, { store });

    await expect(queue.admit({ email: 'durable@example.com' })).resolves.toBe(false);
    await tick();
    expect(work).not.toHaveBeenCalled();
    expect(store.rows).toHaveLength(0);
  });

  it('keeps a failed delivery as retryable durable work instead of dropping it', async () => {
    const store = new MemoryResetStore();
    const queue = new ResetRequestDispatcher(
      async () => {
        throw new Error('smtp down');
      },
      { store, retryBackoffMs: 30_000, maxAttempts: 5 }
    );

    await queue.admit({ email: 'retry@example.com' });
    await queue.waitForIdle();

    const row = store.rows[0]!;
    expect(row.status).toBe('failed');
    expect(row.attempts).toBe(1);
    expect(row.lastErrorCode).toBe('DELIVERY_FAILED');
    expect(row.nextAttemptAt.getTime()).toBeGreaterThan(row.createdAt.getTime());
    // The request is still owned by the system, not lost.
    await expect(store.countClaimable(new Date(Date.now() + 30_001))).resolves.toBe(1);
  });

  it('dead-letters after the attempt budget instead of retrying forever', async () => {
    const store = new MemoryResetStore();
    const attempts: number[] = [];
    const queue = new ResetRequestDispatcher(
      async () => {
        attempts.push(1);
        throw new Error('smtp down');
      },
      { store, retryBackoffMs: 1, maxAttempts: 2 }
    );

    await queue.admit({ email: 'dead@example.com' });
    await queue.waitForIdle();
    // First failure leaves the row retryable.
    expect(store.rows[0]!.status).toBe('failed');
    // Elapse the tiny backoff so the row becomes claimable again.
    await new Promise((resolve) => setTimeout(resolve, 5));
    await queue.drainDue();
    await queue.waitForIdle();

    expect(attempts).toHaveLength(2);
    expect(store.rows[0]!.status).toBe('dead_letter');
    expect(store.rows[0]!.completedAt).not.toBeNull();
  });

  it('lets another process drain work abandoned by a crash or restart', async () => {
    const store = new MemoryResetStore();
    let now = 0;
    // Process A accepts the request, then its in-process queue expires (the
    // process dies before the background job runs).
    const crashed = new ResetRequestDispatcher(
      vi.fn(async () => undefined),
      {
        store,
        now: () => now,
        maxQueueAgeMs: 10
      }
    );
    await crashed.admit({ email: 'abandoned@example.com' });
    now = 5_000;
    await tick();

    expect(store.rows).toHaveLength(1);
    expect(store.rows[0]!.status).toBe('pending');

    // Process B (restart, or the worker) picks the durable row up.
    const delivered: string[] = [];
    // The survivor runs on the real clock: the durable row is what matters.
    const survivor = new ResetRequestDispatcher(
      async ({ email }) => {
        delivered.push(email);
      },
      { store }
    );
    const claimed = await survivor.drainDue();
    await survivor.waitForIdle();

    expect(claimed).toBe(1);
    expect(delivered).toEqual(['abandoned@example.com']);
    expect(store.rows[0]!.status).toBe('sent');
  });

  it('recovers rows whose processing lease expired and does not deliver twice', async () => {
    const store = new MemoryResetStore();
    const base = Date.now();
    let now = base;
    const deliveries: string[] = [];
    // The first process is killed mid-delivery: its handler never returns.
    const killed = new Promise<void>(() => undefined);
    const makeQueue = (handler: (request: { email: string }) => Promise<void>) =>
      new ResetRequestDispatcher(handler, { store, now: () => now, leaseMs: 1_000 });

    const first = makeQueue(async () => {
      await killed;
    });
    await first.admit({ email: 'leased@example.com' });
    await tick();
    const row = store.rows[0]!;
    expect(row.status).toBe('processing');
    expect(deliveries).toEqual([]);

    now = base + 60_000;
    const second = makeQueue(async ({ email }) => {
      deliveries.push(email);
    });
    expect(await second.recoverStale()).toBe(1);
    expect(row.status).toBe('pending');

    await second.drainDue();
    await second.waitForIdle();
    expect(deliveries).toEqual(['leased@example.com']);
    expect(row.status).toBe('sent');
  });

  it('never stores a reset code or password in the durable payload', async () => {
    const store = new MemoryResetStore();
    const queue = new ResetRequestDispatcher(
      vi.fn(async () => undefined),
      { store }
    );
    await queue.admit({
      email: 'user@example.com',
      meta: { requestId: 'r'.repeat(200), ip: 'i'.repeat(100), userAgent: 'a'.repeat(900) }
    } as never);
    await queue.waitForIdle();

    const row = store.rows[0]!;
    expect(row.requestId!.length).toBeLessThanOrEqual(128);
    expect(row.ip!.length).toBeLessThanOrEqual(64);
    expect(row.userAgent!.length).toBeLessThanOrEqual(512);
    expect(Object.keys(row)).not.toContain('code');
    expect(JSON.stringify(row)).not.toContain('password');
  });
});
