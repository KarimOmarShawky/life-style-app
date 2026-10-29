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
 * Fencing (V-04). Every claim issues a fresh `leaseToken` and increments
 * `attempts`. Completions must present that exact claim, and the store only
 * applies a completion while the row is still `processing`, still carries the
 * same token and still has the same attempt number. A processor whose lease
 * expired and was recovered by another claimant therefore cannot overwrite the
 * newer state or report a duplicate delivery as `sent`.
 *
 * Privacy rules preserved from the volatile design:
 *  - No OTP/reset code is ever stored here. Codes are generated after the row
 *    is claimed, never enqueued.
 *  - Only a coarse error code is stored; provider/account details are not.
 *  - `userId` is an ownership/erasure key only (V-06): it is set when the
 *    account exists, so account deletion and retention can reach the metadata.
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
  /** Owning account, when the request matched one. Null for unknown emails. */
  userId: string | null;
  createdAt: Date;
  updatedAt: Date;
  completedAt: Date | null;
  leaseExpiresAt: Date | null;
  /** Fencing token issued by the claim that currently owns the row. */
  leaseToken: string | null;
}

export interface ResetRequestEnqueueMeta {
  requestId?: string | undefined;
  ip?: string | undefined;
  userAgent?: string | undefined;
}

export interface ResetRequestEnqueueInput {
  email: string;
  /** Ownership key for erasure/retention; never used to answer the caller. */
  userId?: string | null | undefined;
  meta?: ResetRequestEnqueueMeta | undefined;
}

/** The proof of ownership a completion must present. */
export interface ResetRequestClaim {
  id: string;
  leaseToken: string;
  attempts: number;
}

/**
 * Age windows applied by retention. Terminal rows (sent / dead-lettered) keep
 * a short window; abandoned non-terminal rows (pending / failed / a
 * permanently expired processing lease) get a longer but finite one, so
 * metadata for a request that will never complete cannot live forever (V-06).
 */
export interface ResetRetentionWindows {
  terminalCutoff: Date;
  abandonedCutoff: Date;
}

export interface ResetRequestStore {
  /** Persists accepted work. Called before the API acknowledges the request. */
  enqueue(input: ResetRequestEnqueueInput): Promise<ResetRequestRecord>;
  /**
   * Records the owning account once delivery has resolved it (V-06).
   *
   * Admission deliberately performs no account lookup (that would turn the
   * endpoint into an existence oracle and block the 202), so ownership is
   * attached later, from the background delivery step. Best-effort: a failure
   * here never blocks delivery, and erasure still deletes by email.
   */
  attachOwner(id: string, userId: string): Promise<void>;
  /** Atomically claims one already-persisted row for this process. */
  claimById(id: string, now: Date, leaseMs: number): Promise<ResetRequestRecord | null>;
  /** Atomically claims due rows (pending or failed with an elapsed backoff). */
  claimDue(now: Date, limit: number, leaseMs: number): Promise<ResetRequestRecord[]>;
  /**
   * Records successful delivery. Returns false when the caller no longer owns
   * the row (stale lease, recovered row, or a newer attempt), in which case
   * nothing is written.
   */
  markSent(claim: ResetRequestClaim, now: Date): Promise<boolean>;
  /** Returns the row to `failed` with a bounded backoff for a later attempt. */
  markRetry(claim: ResetRequestClaim, now: Date, nextAttemptAt: Date, errorCode: string): Promise<boolean>;
  /** Terminal failure after the attempt budget is exhausted. */
  markDeadLetter(claim: ResetRequestClaim, now: Date, errorCode: string): Promise<boolean>;
  /**
   * Releases rows abandoned by a crashed or restarted process back to
   * `pending` so another attempt can pick them up. The previous lease token is
   * cleared, which is what fences the abandoned processor out.
   */
  recoverStale(now: Date): Promise<number>;
  /** Rows that are claimable right now (used to decide whether work is idle). */
  countClaimable(now: Date): Promise<number>;
  /** Retention across every status, bounded by `limit`. */
  purgeOlderThan(windows: ResetRetentionWindows, limit: number): Promise<number>;
}
