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
  ResetRequestClaim,
  ResetRequestRecord,
  ResetRequestStore,
  ResetRequestEnqueueInput,
  ResetRetentionWindows
} from '../../src/core/security/reset-request-store.js';

const tick = () => new Promise<void>((resolve) => setImmediate(resolve));

class MemoryResetStore implements ResetRequestStore {
  public readonly rows: ResetRequestRecord[] = [];
  public failEnqueue = false;
  private seq = 0;
  private token = 0;

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
      userId: input.userId ?? null,
      createdAt: now,
      updatedAt: now,
      completedAt: null,
      leaseExpiresAt: null,
      leaseToken: null
    };
    this.rows.push(record);
    return { ...record };
  }

  private claim(rows: ResetRequestRecord[], now: Date, leaseMs: number): ResetRequestRecord[] {
    const claimed: ResetRequestRecord[] = [];
    for (const row of rows) {
      this.token += 1;
      row.status = 'processing';
      row.attempts += 1;
      row.leaseExpiresAt = new Date(now.getTime() + leaseMs);
      // Fresh fencing token per claim, exactly like the PostgreSQL store.
      row.leaseToken = `lease-${this.token}`;
      row.updatedAt = now;
      claimed.push({ ...row });
    }
    return claimed;
  }

  public async attachOwner(id: string, userId: string): Promise<void> {
    const row = this.rows.find((r) => r.id === id);
    if (row && row.userId === null) row.userId = userId;
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

  /** Same predicate as completeOwned() in the PostgreSQL store. */
  private owned(claim: ResetRequestClaim): ResetRequestRecord | undefined {
    return this.rows.find(
      (r) =>
        r.id === claim.id &&
        r.status === 'processing' &&
        r.leaseToken === claim.leaseToken &&
        r.attempts === claim.attempts
    );
  }

  public async markSent(claim: ResetRequestClaim, now: Date): Promise<boolean> {
    const row = this.owned(claim);
    if (!row) return false;
    row.status = 'sent';
    row.completedAt = now;
    row.leaseExpiresAt = null;
    row.leaseToken = null;
    row.updatedAt = now;
    return true;
  }

  public async markRetry(
    claim: ResetRequestClaim,
    now: Date,
    nextAttemptAt: Date,
    errorCode: string
  ): Promise<boolean> {
    const row = this.owned(claim);
    if (!row) return false;
    row.status = 'failed';
    row.nextAttemptAt = nextAttemptAt;
    row.lastErrorCode = errorCode;
    row.leaseExpiresAt = null;
    row.leaseToken = null;
    row.updatedAt = now;
    return true;
  }

  public async markDeadLetter(
    claim: ResetRequestClaim,
    now: Date,
    errorCode: string
  ): Promise<boolean> {
    const row = this.owned(claim);
    if (!row) return false;
    row.status = 'dead_letter';
    row.lastErrorCode = errorCode;
    row.completedAt = now;
    row.leaseExpiresAt = null;
    row.leaseToken = null;
    row.updatedAt = now;
    return true;
  }

  public async recoverStale(now: Date): Promise<number> {
    let count = 0;
    for (const row of this.rows) {
      if (row.status === 'processing' && row.leaseExpiresAt && row.leaseExpiresAt <= now) {
        row.status = 'pending';
        row.leaseExpiresAt = null;
        row.leaseToken = null;
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

  public async purgeOlderThan(windows: ResetRetentionWindows, limit: number): Promise<number> {
    let purged = 0;
    for (const row of this.rows) {
      if (purged >= limit) break;
      if (row.status === 'purged') continue;
      const terminal =
        (row.status === 'sent' || row.status === 'dead_letter') &&
        (row.completedAt ?? row.updatedAt) <= windows.terminalCutoff;
      const abandonedPending =
        (row.status === 'pending' || row.status === 'failed') &&
        row.updatedAt <= windows.abandonedCutoff;
      const abandonedProcessing =
        row.status === 'processing' &&
        row.leaseExpiresAt !== null &&
        row.leaseExpiresAt <= windows.abandonedCutoff;
      if (terminal || abandonedPending || abandonedProcessing) {
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
  it('rejects a stale completion after another claimant recovered the lease (V-04)', async () => {
    const store = new MemoryResetStore();
    const base = Date.now();
    let now = base;
    let releaseOld = () => undefined as void;
    const oldGate = new Promise<void>((resolve) => {
      releaseOld = resolve;
    });

    // Claimant A holds the lease but its SMTP call hangs past the lease.
    const first = new ResetRequestDispatcher(
      async () => {
        await oldGate;
      },
      { store, now: () => now, leaseMs: 1_000 }
    );
    await first.admit({ email: 'fenced@example.com' });
    await tick();
    const row = store.rows[0]!;
    expect(row.status).toBe('processing');
    const staleToken = row.leaseToken;

    // Lease expires; the recovery pass releases the row and claimant B takes it.
    now = base + 60_000;
    const second = new ResetRequestDispatcher(
      async () => undefined,
      { store, now: () => now, leaseMs: 1_000 }
    );
    await second.recoverStale();
    await second.drainDue();
    await second.waitForIdle();
    expect(row.status).toBe('sent');
    expect(row.leaseToken).toBeNull();
    expect(row.leaseToken).not.toBe(staleToken);
    const completedAt = row.completedAt;

    // A now finishes too. Its completion must not overwrite B's state.
    releaseOld();
    await first.waitForIdle();
    expect(row.status).toBe('sent');
    expect(row.completedAt).toBe(completedAt);
    expect(row.leaseToken).toBeNull();
  });

  it('claims only free capacity so rows are never left processing without a worker (V-05)', async () => {
    const store = new MemoryResetStore();
    for (let index = 0; index < 5; index += 1) {
      await store.enqueue({ email: `capacity-${index}@example.com` });
    }
    const blocked = new Promise<void>(() => undefined);
    const queue = new ResetRequestDispatcher(
      async () => {
        await blocked;
      },
      { store, capacity: 2, concurrency: 1, claimLimit: 10 }
    );

    expect(await queue.drainDue()).toBe(2);
    // No free capacity: a second pass must claim nothing rather than stranding
    // rows in `processing` until their lease expires.
    expect(await queue.drainDue()).toBe(0);
    const processing = store.rows.filter((r) => r.status === 'processing');
    expect(processing).toHaveLength(2);
    expect(store.rows.filter((r) => r.status === 'pending')).toHaveLength(3);
  });

  it('awaits its own delivery work during a scheduled recovery cycle (V-05)', async () => {
    const store = new MemoryResetStore();
    const delivered: string[] = [];
    let release = () => undefined as void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const queue = new ResetRequestDispatcher(
      async ({ email }) => {
        await gate;
        delivered.push(email);
      },
      { store, concurrency: 1 }
    );
    await store.enqueue({ email: 'cycle@example.com' });

    const cycle = queue.runRecoveryCycle(5_000);
    await tick();
    expect(delivered).toEqual([]);
    release();
    await expect(cycle).resolves.toEqual({ claimed: 1, drained: true });
    expect(delivered).toEqual(['cycle@example.com']);
    expect(store.rows[0]!.status).toBe('sent');
  });

  it('stops admission and drains active work during shutdown (V-05)', async () => {
    const queue = new ResetRequestDispatcher(
      async () => {
        await new Promise((resolve) => setTimeout(resolve, 5));
      },
      { concurrency: 1 }
    );
    await queue.admit({ email: 'drain@example.com' });

    await expect(queue.shutdown(1_000)).resolves.toBe(true);
    expect(queue.snapshot()).toMatchObject({ active: 0, waiting: 0, accepting: false });
    // Admission after shutdown is refused instead of being silently dropped.
    await expect(queue.admit({ email: 'late@example.com' })).resolves.toBe(false);
  });

  it('attaches the owning account in the background for erasure (V-06)', async () => {
    const store = new MemoryResetStore();
    const queue = new ResetRequestDispatcher(vi.fn(async () => undefined), { store });
    await queue.admit({ email: 'owned@example.com' });

    const row = store.rows[0]!;
    // Admission itself never stores or reveals an owner.
    expect(row.userId).toBeNull();

    await queue.attachOwner(row.id, '11111111-1111-1111-1111-111111111111');
    expect(store.rows[0]!.userId).toBe('11111111-1111-1111-1111-111111111111');
    // An existing owner is never overwritten.
    await queue.attachOwner(row.id, '22222222-2222-2222-2222-222222222222');
    expect(store.rows[0]!.userId).toBe('11111111-1111-1111-1111-111111111111');
  });

  it('retains every status within a bounded window, sparing active leases (V-06)', async () => {
    const store = new MemoryResetStore();
    const base = Date.now();
    const old = new Date(base - 30 * 24 * 60 * 60 * 1000);

    // A sent row, an abandoned failed row and an abandoned processing row.
    const sent = await store.enqueue({ email: 'sent@example.com' });
    const live = store.rows.find((r) => r.id === sent.id)!;
    live.status = 'sent';
    live.completedAt = old;
    live.updatedAt = old;

    const failed = await store.enqueue({ email: 'failed@example.com' });
    const failedRow = store.rows.find((r) => r.id === failed.id)!;
    failedRow.status = 'failed';
    failedRow.updatedAt = old;

    const stuck = await store.enqueue({ email: 'stuck@example.com' });
    const stuckRow = store.rows.find((r) => r.id === stuck.id)!;
    stuckRow.status = 'processing';
    stuckRow.leaseExpiresAt = old;
    stuckRow.updatedAt = old;

    // An active lease and a recent pending row must survive.
    const active = await store.enqueue({ email: 'active@example.com' });
    const activeRow = store.rows.find((r) => r.id === active.id)!;
    activeRow.status = 'processing';
    activeRow.leaseExpiresAt = new Date(Date.now() + 60_000);
    const recent = await store.enqueue({ email: 'recent@example.com' });

    const purged = await store.purgeOlderThan(
      {
        terminalCutoff: new Date(base - 24 * 60 * 60 * 1000),
        abandonedCutoff: new Date(base - 7 * 24 * 60 * 60 * 1000)
      },
      100
    );

    expect(purged).toBe(3);
    const survivors = store.rows.filter((r) => r.status !== 'purged').map((r) => r.email);
    expect(survivors).toEqual(['active@example.com', 'recent@example.com']);
    expect(recent.email).toBe('recent@example.com');
  });
});
