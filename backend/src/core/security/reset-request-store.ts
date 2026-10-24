/**
 * src/core/security/reset-request-store.ts
 *
 * Durable store for accepted password-reset work (F-06).
 *
 * The in-process dispatcher alone loses accepted work when the process
 * crashes, restarts, is force-shut-down, or when the queue age expires. This
 * store gives accepted work durable ownership: a row exists before the API
 * answers 202, and the row is only completed, retried (with backoff) or
 * dead-lettered after an attempt.
 *
 * Privacy rules preserved from the volatile design:
 *  - No OTP/reset code is ever stored here. Codes are generated after the row
 *    is claimed, never enqueued.
 *  - Only a coarse error code is stored; provider/account details are not.
 */

export type ResetRequestStatus = 'pending' | 'processing' | 'sent' | 'failed' | 'dead_letter';

export const TERMINAL_RESET_STATUSES: readonly ResetRequestStatus[] = ['sent', 'dead_letter'];

export interface ResetRequestRecord {
  id: string;
  email: string;
  status: ResetRequestStatus;
  attempts: number;
  nextAttemptAt: Date;
  lastErrorCode: string | null;
  requestId: string | null;
  ip: string | null;
  userAgent: string | null;
  createdAt: Date;
  updatedAt: Date;
  completedAt: Date | null;
  leaseExpiresAt: Date | null;
}

export interface ResetRequestEnqueueMeta {
  requestId?: string | undefined;
  ip?: string | undefined;
  userAgent?: string | undefined;
}

export interface ResetRequestEnqueueInput {
  email: string;
  meta?: ResetRequestEnqueueMeta | undefined;
}

export interface ResetRequestStore {
  /** Persists accepted work. Called before the API acknowledges the request. */
  enqueue(input: ResetRequestEnqueueInput): Promise<ResetRequestRecord>;
  /** Atomically claims one already-persisted row for this process. */
  claimById(id: string, now: Date, leaseMs: number): Promise<ResetRequestRecord | null>;
  /** Atomically claims due rows (pending or failed with an elapsed backoff). */
  claimDue(now: Date, limit: number, leaseMs: number): Promise<ResetRequestRecord[]>;
  markSent(id: string, now: Date): Promise<void>;
  /** Returns the row to `failed` with a bounded backoff for a later attempt. */
  markRetry(
    id: string,
    now: Date,
    nextAttemptAt: Date,
    errorCode: string,
    attempts: number
  ): Promise<void>;
  /** Terminal failure after the attempt budget is exhausted. */
  markDeadLetter(id: string, now: Date, errorCode: string, attempts: number): Promise<void>;
  /**
   * Releases rows abandoned by a crashed or restarted process back to
   * `pending` so another attempt can pick them up.
   */
  recoverStale(now: Date): Promise<number>;
  /** Rows that are claimable right now (used to decide whether work is idle). */
  countClaimable(now: Date): Promise<number>;
  /** Retention: drops completed or dead-lettered rows older than the cutoff. */
  purgeOlderThan(cutoff: Date, limit: number): Promise<number>;
}
