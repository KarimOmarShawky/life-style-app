/** Volatile request admission only. OTPs are generated after dequeue, never queued. */
import { logger, requestContextStore } from '../logger/logger.js';

export interface ResetRequestMeta {
  requestId?: string | undefined;
  ip?: string | undefined;
  userAgent?: string | undefined;
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
}

export class ResetRequestDispatcher {
  private readonly waiting: { request: ResetRequest; admittedAt: number }[] = [];
  private active = 0;
  private scheduled = false;
  private accepting = true;
  private readonly capacity: number;
  private readonly concurrency: number;
  private readonly maxQueueAgeMs: number;
  private readonly now: () => number;
  private idle: Promise<void> | undefined;
  private resolveIdle: (() => void) | undefined;

  constructor(
    private readonly processRequest: (request: ResetRequest) => Promise<void>,
    options: ResetDispatcherOptions = {}
  ) {
    this.capacity = options.capacity ?? 64;
    this.concurrency = options.concurrency ?? 4;
    this.maxQueueAgeMs = options.maxQueueAgeMs ?? 60_000;
    this.now = options.now ?? Date.now;
    if (
      !Number.isInteger(this.capacity) ||
      this.capacity < 1 ||
      this.capacity > 256 ||
      !Number.isInteger(this.concurrency) ||
      this.concurrency < 1 ||
      this.concurrency > this.capacity ||
      !Number.isFinite(this.maxQueueAgeMs) ||
      this.maxQueueAgeMs <= 0
    )
      throw new Error('Invalid reset dispatcher bounds');
  }

  /** No lookup, cooldown check, OTP or SMTP call occurs in admission. */
  admit(request: ResetRequest): boolean {
    if (!this.accepting || this.waiting.length + this.active >= this.capacity) return false;
    // Explicit projection: even accidental extra caller fields cannot enqueue a code/password.
    const meta = request.meta;
    this.waiting.push({
      request: {
        email: request.email,
        meta: meta
          ? {
              requestId: meta.requestId?.slice(0, 128),
              ip: meta.ip?.slice(0, 64),
              userAgent: meta.userAgent?.slice(0, 512)
            }
          : undefined
      },
      admittedAt: this.now()
    });
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
    return true;
  }

  stopAccepting(): void {
    this.accepting = false;
  }

  snapshot(): { waiting: number; active: number; accepting: boolean } {
    return { waiting: this.waiting.length, active: this.active, accepting: this.accepting };
  }

  waitForIdle(): Promise<void> {
    if (this.waiting.length + this.active === 0) return Promise.resolve();
    this.idle ??= new Promise<void>((resolve) => {
      this.resolveIdle = resolve;
    });
    return this.idle;
  }

  private report(reason: 'expired' | 'processing'): void {
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
        this.report('expired');
        continue;
      }
      this.active++;
      void this.run(next.request);
    }
    if (this.active + this.waiting.length === 0) {
      const resolve = this.resolveIdle;
      this.idle = undefined;
      this.resolveIdle = undefined;
      resolve?.();
    }
  }

  private async run(request: ResetRequest): Promise<void> {
    try {
      await this.processRequest(request);
    } catch {
      this.report('processing');
    } finally {
      this.active--;
      this.pump();
    }
  }
}
