/** Password-reset admission: durable when a store is supplied, volatile otherwise. */
import { logger, requestContextStore } from '../logger/logger.js';
import type { ResetRequestClaim, ResetRequestStore } from './reset-request-store.js';

export interface ResetRequestMeta {
  requestId?: string | undefined;
  /** Durable row id, so the delivery step can attach ownership (V-06). */
  recordId?: string | undefined;
  ip?: string | undefined;
  userAgent?: string | undefined;
  /** Ownership key for erasure/retention (V-06); never echoed to the caller. */
  userId?: string | undefined;
}
export interface ResetRequest {
  email: string;
  meta?: ResetRequestMeta | undefined;
}
export interface ResetDispatcherOptions {
  capacity?: number;
  concurrency?: number;
  maxQueueAgeMs?: number;
  now?: () => number;
  /**
   * Durable backing store (F-06). When present, accepted work is persisted
   * before the API answers, survives process loss, and is retried with a
   * bounded backoff until it succeeds or is dead-lettered.
   */
  store?: ResetRequestStore | undefined;
  /** Attempt budget per persisted request before it is dead-lettered. */
  maxAttempts?: number;
  /** Base backoff; attempt n waits base * n. */
  retryBackoffMs?: number;
  /** How many due rows a drain pass claims from the store at once. */
  claimLimit?: number;
  /** Lease held while a row is being processed. */
  leaseMs?: number;
}

export const DEFAULT_RESET_MAX_ATTEMPTS = 5;
export const DEFAULT_RESET_RETRY_BACKOFF_MS = 30_000;
export const DEFAULT_RESET_LEASE_MS = 120_000;
export const DEFAULT_RESET_CLAIM_LIMIT = 10;
/** Upper bound for a scheduled recovery cycle to wait for its own work. */
export const DEFAULT_RESET_DRAIN_TIMEOUT_MS = 30_000;

interface WaitingItem {
  request: ResetRequest;
  /** Durable row id, when the request was persisted on admission. */
  recordId?: string | undefined;
  /** True when the row was already claimed from the store for this item. */
  claimed?: boolean;
  /** Attempt count observed at claim time (already incremented by the store). */
  attempts?: number;
  /** Fencing token observed at claim time; every completion must present it. */
  leaseToken?: string | undefined;
  admittedAt: number;
}

export class ResetRequestDispatcher {
  private readonly waiting: WaitingItem[] = [];
  private active = 0;
  private scheduled = false;
  private accepting = true;
  private readonly capacity: number;
  private readonly concurrency: number;
  private readonly maxQueueAgeMs: number;
  private readonly now: () => number;
  private readonly store: ResetRequestStore | undefined;
  private readonly maxAttempts: number;
  private readonly retryBackoffMs: number;
  private readonly claimLimit: number;
  private readonly leaseMs: number;
  private idle: Promise<void> | undefined;
  private resolveIdle: (() => void) | undefined;
  private draining = false;

  constructor(
    private readonly processRequest: (request: ResetRequest) => Promise<void>,
    options: ResetDispatcherOptions = {}
  ) {
    this.capacity = options.capacity ?? 64;
    this.concurrency = options.concurrency ?? 4;
    this.maxQueueAgeMs = options.maxQueueAgeMs ?? 60_000;
    this.now = options.now ?? Date.now;
    this.store = options.store;
    this.maxAttempts = options.maxAttempts ?? DEFAULT_RESET_MAX_ATTEMPTS;
    this.retryBackoffMs = options.retryBackoffMs ?? DEFAULT_RESET_RETRY_BACKOFF_MS;
    // A drain pass can never claim more than the dispatcher can hold.
    this.claimLimit = Math.min(options.claimLimit ?? DEFAULT_RESET_CLAIM_LIMIT, this.capacity);
    this.leaseMs = options.leaseMs ?? DEFAULT_RESET_LEASE_MS;
    if (
      !Number.isInteger(this.capacity) ||
      this.capacity < 1 ||
      this.capacity > 256 ||
      !Number.isInteger(this.concurrency) ||
      this.concurrency < 1 ||
      this.concurrency > this.capacity ||
      !Number.isFinite(this.maxQueueAgeMs) ||
      this.maxQueueAgeMs <= 0 ||
      !Number.isInteger(this.maxAttempts) ||
      this.maxAttempts < 1 ||
      !Number.isInteger(this.claimLimit) ||
      this.claimLimit < 1 ||
      !Number.isFinite(this.retryBackoffMs) ||
      this.retryBackoffMs <= 0 ||
      !Number.isFinite(this.leaseMs) ||
      this.leaseMs <= 0
    )
      throw new Error('Invalid reset dispatcher bounds');
  }

  /**
   * Admission. No lookup, cooldown check, OTP or SMTP call happens here.
   * With a durable store the row is written first, so a 202 acknowledgement
   * can never describe work that only existed in memory.
   */
  async admit(request: ResetRequest): Promise<boolean> {
    if (!this.accepting || this.waiting.length + this.active >= this.capacity) return false;

    // Explicit projection: even accidental extra caller fields cannot enqueue a code/password.
    const meta = request.meta;
    const projected: ResetRequest = {
      email: request.email,
      meta: meta
        ? {
            requestId: meta.requestId?.slice(0, 128),
            ip: meta.ip?.slice(0, 64),
            userAgent: meta.userAgent?.slice(0, 512),
            userId: meta.userId
          }
        : undefined
    };

    let recordId: string | undefined;
    if (this.store) {
      try {
        const record = await this.store.enqueue({
          email: projected.email,
          userId: projected.meta?.userId ?? null,
          meta: projected.meta ? { ...projected.meta } : undefined
        });
        recordId = record.id;
      } catch (err) {
        // Do not acknowledge work that could not be given durable ownership.
        logger.error('Password reset request could not be persisted', {
          reason: err instanceof Error ? err.name : 'unknown'
        });
        return false;
      }
    }

    this.waiting.push({ request: projected, recordId, admittedAt: this.now() });
    this.schedule();
    return true;
  }

  stopAccepting(): void {
    this.accepting = false;
  }

  snapshot(): { waiting: number; active: number; accepting: boolean } {
    return { waiting: this.waiting.length, active: this.active, accepting: this.accepting };
  }

  /**
   * Pulls due durable rows (from a previous process or an earlier failure)
   * into the in-process queue. Safe to call from a schedule: rows are claimed
   * with SKIP LOCKED, so concurrent processes cannot both take the same row.
   */
  async drainDue(): Promise<number> {
    if (!this.store || !this.accepting) return 0;
    if (this.draining) return 0;
    this.draining = true;
    try {
      // Claim only the capacity this process can actually admit. Claiming the
      // configured total while the in-process queue is already full left rows
      // in `processing` that nobody was working on, delaying them until lease
      // recovery (V-05).
      const free = this.capacity - (this.waiting.length + this.active);
      if (free <= 0) return 0;
      const now = new Date(this.now());
      const claimed = await this.store.claimDue(
        now,
        Math.min(this.claimLimit, free),
        this.leaseMs
      );
      for (const record of claimed) {
        if (this.waiting.length + this.active >= this.capacity) break;
        this.waiting.push({
          request: {
            email: record.email,
            meta: {
              requestId: record.requestId ?? undefined,
              ip: record.ip ?? undefined,
              userAgent: record.userAgent ?? undefined,
              userId: record.userId ?? undefined
            }
          },
          recordId: record.id,
          // claimDue() already owns and incremented the row.
          claimed: true,
          attempts: record.attempts,
          leaseToken: record.leaseToken ?? undefined,
          admittedAt: this.now()
        });
      }
      if (claimed.length) this.schedule();
      return claimed.length;
    } catch (err) {
      logger.error('Password reset recovery pass failed', {
        reason: err instanceof Error ? err.name : 'unknown'
      });
      return 0;
    } finally {
      this.draining = false;
    }
  }

  /**
   * One bounded recovery cycle: claim due work, then wait (up to
   * `idleTimeoutMs`) for the work this cycle scheduled to finish. Scheduled
   * recovery used to return as soon as delivery was started, so a job that
   * reported success could still be interrupted by the next tick or by
   * shutdown (V-05).
   */
  async runRecoveryCycle(
    idleTimeoutMs: number = DEFAULT_RESET_DRAIN_TIMEOUT_MS
  ): Promise<{ claimed: number; drained: boolean }> {
    const claimed = await this.drainDue();
    if (this.waiting.length + this.active === 0) return { claimed, drained: true };
    const drained = await this.waitForIdleWithin(idleTimeoutMs);
    return { claimed, drained };
  }

  /**
   * Resolves `true` when this process has no in-flight reset work, or `false`
   * when the deadline expired first. Work that is still durable is recovered by
   * the next process, so a timeout is a warning, never a loss.
   */
  async waitForIdleWithin(timeoutMs: number): Promise<boolean> {
    if (this.waiting.length + this.active === 0) return true;
    let timer: NodeJS.Timeout | undefined;
    const timeout = new Promise<boolean>((resolve) => {
      timer = setTimeout(() => resolve(false), Math.max(1, timeoutMs));
      timer.unref?.();
    });
    try {
      return await Promise.race([this.waitForIdle().then(() => true), timeout]);
    } finally {
      if (timer) clearTimeout(timer);
    }
  }

  /**
   * Stops admission and drains in-flight reset work before the caller closes
   * SMTP, Redis or PostgreSQL (V-05).
   */
  async shutdown(deadlineMs: number = DEFAULT_RESET_DRAIN_TIMEOUT_MS): Promise<boolean> {
    this.stopAccepting();
    const drained = await this.waitForIdleWithin(deadlineMs);
    if (!drained) {
      logger.warn('Password reset work did not drain before the shutdown deadline', {
        waiting: this.waiting.length,
        active: this.active
      });
    }
    return drained;
  }

  /**
   * Attaches the owning account to a durable row after the background delivery
   * step resolved it (V-06). Admission performs no lookup, so this is the only
   * place the link can be made without changing the endpoint's response.
   */
  async attachOwner(recordId: string, userId: string): Promise<void> {
    if (!this.store) return;
    try {
      await this.store.attachOwner(recordId, userId);
    } catch (err) {
      logger.warn('Password reset ownership link could not be recorded', {
        reason: err instanceof Error ? err.name : 'unknown'
      });
    }
  }

  /** Releases rows abandoned by a crashed or restarted process. */
  async recoverStale(): Promise<number> {
    if (!this.store) return 0;
    try {
      return await this.store.recoverStale(new Date(this.now()));
    } catch (err) {
      logger.error('Password reset stale-lease recovery failed', {
        reason: err instanceof Error ? err.name : 'unknown'
      });
      return 0;
    }
  }

  /**
   * Resolves when this process has no in-flight reset work. With a durable
   * store it first makes one recovery pass, so rows admitted by a previous
   * process are picked up instead of being reported as idle.
   */
  waitForIdle(): Promise<void> {
    if (!this.store) {
      if (this.waiting.length + this.active > 0) return this.idlePromise();
      return Promise.resolve();
    }
    // Durable mode: return the shared promise, then reconcile asynchronously so
    // repeated calls keep returning the same promise (existing contract).
    const promise = this.idlePromise();
    void this.reconcileDurableIdle();
    return promise;
  }

  private idlePromise(): Promise<void> {
    this.idle ??= new Promise<void>((resolve) => {
      this.resolveIdle = resolve;
    });
    return this.idle;
  }

  private async reconcileDurableIdle(): Promise<void> {
    try {
      const claimed = await this.drainDue();
      // Nothing left to claim here: either the work is done, it waits for a
      // backoff, or another process owns it. Never block a caller forever.
      if (claimed === 0) this.resolveIdleIfEmpty();
    } catch {
      this.resolveIdleIfEmpty();
    }
  }

  private resolveIdleIfEmpty(): void {
    if (this.waiting.length + this.active > 0) return;
    const resolve = this.resolveIdle;
    this.idle = undefined;
    this.resolveIdle = undefined;
    resolve?.();
  }

  private schedule(): void {
    if (!this.scheduled) {
      this.scheduled = true;
      // Do not retain the first HTTP request's AsyncLocalStorage/user context for other jobs.
      requestContextStore.exit(() =>
        setImmediate(() => {
          this.scheduled = false;
          this.pump();
        })
      );
    }
  }

  private report(
    reason: 'expired' | 'processing' | 'dead_letter' | 'stale_completion'
  ): void {
    try {
      logger.error('Password reset background request did not complete', { reason });
    } catch {
      // Reporting must not strand accepted work or turn into an unhandled rejection.
      process.emitWarning('Password reset diagnostic reporting failed');
    }
  }

  private pump(): void {
    while (this.active < this.concurrency && this.waiting.length) {
      const next = this.waiting.shift();
      if (!next) break;
      if (this.now() - next.admittedAt >= this.maxQueueAgeMs) {
        // Expired in the in-process queue. With a durable store the row is
        // still pending and a later recovery pass retries it, so this is only
        // a real loss when no store is configured.
        if (!this.store) this.report('expired');
        continue;
      }
      this.active++;
      void this.run(next);
    }
    this.maybeResolveIdle();
  }

  private maybeResolveIdle(): void {
    if (this.waiting.length + this.active > 0) return;
    if (!this.resolveIdle) return;
    if (!this.store) {
      this.resolveIdleIfEmpty();
      return;
    }
    void this.store
      .countClaimable(new Date(this.now()))
      .then((claimable) => {
        if (claimable > 0) {
          // Durable work is still claimable: pick it up instead of reporting idle.
          void this.drainDue().then((claimed) => {
            if (claimed === 0) this.resolveIdleIfEmpty();
          });
          return;
        }
        this.resolveIdleIfEmpty();
      })
      .catch(() => this.resolveIdleIfEmpty());
  }

  private async run(item: WaitingItem): Promise<void> {
    const now = new Date(this.now());
    let claim: ResetRequestClaim | undefined;
    try {
      if (item.recordId && this.store) {
        if (item.claimed && item.leaseToken) {
          claim = {
            id: item.recordId,
            leaseToken: item.leaseToken,
            attempts: item.attempts ?? 1
          };
        } else {
          const claimed = await this.store.claimById(item.recordId, now, this.leaseMs);
          if (!claimed || !claimed.leaseToken) {
            // Another process (or an earlier recovery pass) already owns this
            // row: skip it here instead of delivering twice.
            return;
          }
          claim = {
            id: claimed.id,
            leaseToken: claimed.leaseToken,
            attempts: claimed.attempts
          };
        }
      }
      await this.processRequest(
        item.recordId
          ? {
              email: item.request.email,
              meta: { ...item.request.meta, recordId: item.recordId }
            }
          : item.request
      );
      if (claim && this.store) {
        // Fenced completion (V-04): if the lease expired and another claimant
        // took the row, this returns false and writes nothing.
        const applied = await this.store.markSent(claim, new Date(this.now()));
        if (!applied) this.report('stale_completion');
      }
    } catch {
      // Coarse code only: never persist provider text or account details.
      const errorCode = 'DELIVERY_FAILED';
      if (claim && this.store) {
        const used = claim.attempts;
        try {
          if (used >= this.maxAttempts) {
            const applied = await this.store.markDeadLetter(
              claim,
              new Date(this.now()),
              errorCode
            );
            if (applied) this.report('dead_letter');
            else this.report('stale_completion');
          } else {
            const backoff = this.retryBackoffMs * used;
            const applied = await this.store.markRetry(
              claim,
              new Date(this.now()),
              new Date(this.now() + backoff),
              errorCode
            );
            if (!applied) this.report('stale_completion');
          }
        } catch (storeErr) {
          logger.error('Password reset delivery state could not be recorded', {
            reason: storeErr instanceof Error ? storeErr.name : 'unknown'
          });
        }
      }
      this.report('processing');
    } finally {
      this.active--;
      this.pump();
    }
  }
}
