/**
 * src/features/auth/password-reset-request.repository.pg.ts
 *
 * PostgreSQL implementation of the durable password-reset store (F-06).
 *
 * Concurrency: claim-by-id and claim-due both use a single UPDATE ... FROM
 * (SELECT ... FOR UPDATE SKIP LOCKED) statement, so several API replicas and
 * the worker can drain the same table without double-processing a row.
 */

import { sql, type Kysely } from 'kysely';
import type { DatabaseSchema } from '../../infrastructure/database/postgres/kysely.js';
import type {
  ResetRequestRecord,
  ResetRequestEnqueueInput,
  ResetRequestStore,
  ResetRequestStatus
} from '../../core/security/reset-request-store.js';

interface ResetRequestRow {
  id: string;
  email: string;
  status: ResetRequestStatus;
  attempts: number;
  next_attempt_at: Date;
  last_error_code: string | null;
  request_id: string | null;
  ip: string | null;
  user_agent: string | null;
  created_at: Date;
  updated_at: Date;
  completed_at: Date | null;
  lease_expires_at: Date | null;
}

// Every column is qualified with the UPDATE target alias: with UPDATE ... FROM
// an unqualified name in RETURNING is ambiguous between the target and the
// joined sub-select, which fails at execution time (caught by the real-DB gate,
// never by an in-memory fake).
const RETURNING = sql`RETURNING r.id, r.email, r.status, r.attempts,
  r.next_attempt_at, r.last_error_code, r.request_id, r.ip, r.user_agent,
  r.created_at, r.updated_at, r.completed_at, r.lease_expires_at`;

function toRecord(row: ResetRequestRow): ResetRequestRecord {
  return {
    id: row.id,
    email: row.email,
    status: row.status,
    attempts: row.attempts,
    nextAttemptAt: row.next_attempt_at,
    lastErrorCode: row.last_error_code,
    requestId: row.request_id,
    ip: row.ip,
    userAgent: row.user_agent,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    completedAt: row.completed_at,
    leaseExpiresAt: row.lease_expires_at
  };
}

export class PgPasswordResetRequestStore implements ResetRequestStore {
  constructor(private readonly db: Kysely<DatabaseSchema>) {}

  public async enqueue(input: ResetRequestEnqueueInput): Promise<ResetRequestRecord> {
    // Explicit projection: extra caller fields cannot reach the row, and no
    // code/password is ever part of the payload.
    const row = await this.db
      .insertInto('password_reset_requests')
      .values({
        email: input.email,
        request_id: input.meta?.requestId?.slice(0, 128) ?? null,
        ip: input.meta?.ip?.slice(0, 64) ?? null,
        user_agent: input.meta?.userAgent?.slice(0, 512) ?? null
      })
      .returning([
        'id',
        'email',
        'status',
        'attempts',
        'next_attempt_at',
        'last_error_code',
        'request_id',
        'ip',
        'user_agent',
        'created_at',
        'updated_at',
        'completed_at',
        'lease_expires_at'
      ])
      .executeTakeFirstOrThrow();

    return toRecord(row as unknown as ResetRequestRow);
  }

  public async claimById(
    id: string,
    now: Date,
    leaseMs: number
  ): Promise<ResetRequestRecord | null> {
    const lease = new Date(now.getTime() + leaseMs);
    const result = await sql<ResetRequestRow>`
      UPDATE password_reset_requests AS r
         SET status = 'processing',
             attempts = (r.attempts + 1)::smallint,
             processing_started_at = ${now},
             lease_expires_at = ${lease},
             updated_at = ${now}
        FROM (
          SELECT id FROM password_reset_requests
           WHERE id = ${id}::uuid
             AND status = 'pending'
           FOR UPDATE SKIP LOCKED
        ) AS c
       WHERE r.id = c.id
      ${RETURNING}
    `.execute(this.db);
    return result.rows[0] ? toRecord(result.rows[0]) : null;
  }

  public async claimDue(now: Date, limit: number, leaseMs: number): Promise<ResetRequestRecord[]> {
    const lease = new Date(now.getTime() + leaseMs);
    const result = await sql<ResetRequestRow>`
      UPDATE password_reset_requests AS r
         SET status = 'processing',
             attempts = (r.attempts + 1)::smallint,
             processing_started_at = ${now},
             lease_expires_at = ${lease},
             updated_at = ${now}
        FROM (
          SELECT id FROM password_reset_requests
           WHERE status IN ('pending', 'failed')
             AND next_attempt_at <= ${now}
           ORDER BY next_attempt_at ASC
           LIMIT ${limit}
           FOR UPDATE SKIP LOCKED
        ) AS c
       WHERE r.id = c.id
      ${RETURNING}
    `.execute(this.db);
    return result.rows.map(toRecord);
  }

  public async markSent(id: string, now: Date): Promise<void> {
    await this.db
      .updateTable('password_reset_requests')
      .set({
        status: 'sent',
        completed_at: now,
        lease_expires_at: null,
        last_error_code: null,
        updated_at: now
      })
      .where('id', '=', id)
      .execute();
  }

  public async markRetry(
    id: string,
    now: Date,
    nextAttemptAt: Date,
    errorCode: string,
    attempts: number
  ): Promise<void> {
    await this.db
      .updateTable('password_reset_requests')
      .set({
        status: 'failed',
        attempts,
        next_attempt_at: nextAttemptAt,
        last_error_code: errorCode.slice(0, 50),
        lease_expires_at: null,
        updated_at: now
      })
      .where('id', '=', id)
      .execute();
  }

  public async markDeadLetter(
    id: string,
    now: Date,
    errorCode: string,
    attempts: number
  ): Promise<void> {
    await this.db
      .updateTable('password_reset_requests')
      .set({
        status: 'dead_letter',
        attempts,
        last_error_code: errorCode.slice(0, 50),
        completed_at: now,
        lease_expires_at: null,
        updated_at: now
      })
      .where('id', '=', id)
      .execute();
  }

  public async recoverStale(now: Date): Promise<number> {
    // Rows left in `processing` by a crash, restart or forced shutdown, and
    // rows whose lease simply expired while SMTP hung, go back to `pending`.
    const result = await this.db
      .updateTable('password_reset_requests')
      .set({ status: 'pending', lease_expires_at: null, updated_at: now })
      .where('status', '=', 'processing')
      .where('lease_expires_at', '<=', now)
      .executeTakeFirst();
    return Number(result.numUpdatedRows);
  }

  public async countClaimable(now: Date): Promise<number> {
    const row = await this.db
      .selectFrom('password_reset_requests')
      .select((eb) => eb.fn.countAll<number>().as('count'))
      // Mirrors claimDue(): a pending row, or a failed row whose backoff elapsed.
      .where((eb) =>
        eb.or([
          eb('status', '=', 'pending'),
          eb.and([eb('status', '=', 'failed'), eb('next_attempt_at', '<=', now)])
        ])
      )
      .executeTakeFirst();
    return Number(row?.count ?? 0);
  }

  public async purgeOlderThan(cutoff: Date, limit: number): Promise<number> {
    const result = await sql<{ id: string }>`
      DELETE FROM password_reset_requests
       WHERE id IN (
         SELECT id FROM password_reset_requests
          WHERE status IN ('sent', 'dead_letter')
            AND COALESCE(completed_at, updated_at) <= ${cutoff}
          LIMIT ${limit}
       )
    `.execute(this.db);
    return Number(result.numAffectedRows ?? 0);
  }
}
