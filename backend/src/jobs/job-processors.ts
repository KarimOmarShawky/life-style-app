/**
 * src/jobs/job-processors.ts
 *
 * Implements Section 11: background job processors (reminder dispatch,
 * recurring-task generation, timer auto-close, soft-delete purge, queued
 * emails). Each processor is a plain function with injected dependencies so it
 * can be unit-tested without BullMQ; `worker.ts` wires them to the queues.
 */

import type { EmailSender } from '../infrastructure/external/email-sender.js';

export interface DispatchableReminder {
  id: string;
  userId: string;
  entityType: 'task' | 'habit' | 'event' | 'subscription';
  entityId: string;
  channel: 'push' | 'in_app' | 'email';
  remindAt: Date;
  attemptCount: number;
}

export interface ReminderDispatchStore {
  /** Atomically claims due pending reminders (SKIP LOCKED) and marks them processing. */
  claimDue(now: Date, limit: number): Promise<DispatchableReminder[]>;
  markSent(id: string, sentAt: Date, attemptCount: number): Promise<void>;
  /** Schedules a retry with an explicit next attempt time. */
  markRetry(
    id: string,
    nextAttemptAt: Date,
    errorCode: string,
    errorMessage: string,
    attemptCount: number
  ): Promise<void>;
  markFailed(
    id: string,
    failedAt: Date,
    errorCode: string,
    errorMessage: string,
    attemptCount: number
  ): Promise<void>;
  /** Cancels reminders whose parent entity was soft-deleted or hard-deleted. */
  cancelOrphans(): Promise<number>;
}

export interface UserEmailLookup {
  findEmails(userIds: string[]): Promise<Map<string, string>>;
}

export interface PushSender {
  isAvailable(): boolean;
  send(userId: string, title: string, body: string): Promise<void>;
}

export interface RecurringGenerationStore {
  /** Generates missing task occurrences up to and including horizonDate. */
  generateDueOccurrences(horizonDate: string): Promise<number>;
}

export interface TimerMaintenanceStore {
  /** Closes sessions still running past maxHours and returns how many were closed. */
  autoCloseStale(cutoff: Date): Promise<number>;
}

export interface PurgeStore {
  /** Hard-deletes rows soft-deleted before cutoff. Returns rows removed. */
  purgeSoftDeleted(cutoff: Date): Promise<number>;
  /** Hard-deletes accounts whose pending_deletion grace window expired at or before now. */
  purgeExpiredAccounts?(now: Date): Promise<number>;
}

export interface SessionRetentionStore {
  /** Hard-deletes auth sessions that expired before cutoff. Returns rows removed. */
  purgeExpiredSessions(cutoff: Date): Promise<number>;
}

export interface AuditRetentionStore {
  /**
   * Hard-deletes audit log rows older than cutoff. Requires the maintenance
   * role (lifestyle_maintenance holds DELETE on audit_logs); the runtime
   * application role intentionally does not.
   */
  purgeAuditLogsOlderThan(cutoff: Date): Promise<number>;
}

export interface JobClock {
  now(): Date;
}

const MAX_REMINDER_ATTEMPTS = 5;
const RETRY_BACKOFF_MS = 5 * 60_000;

function truncate(message: string, max = 480): string {
  return message.length > max ? `${message.slice(0, max)}…` : message;
}

/**
 * Dispatches due reminders. `in_app` reminders are "delivered" by being listed
 * through the API (the mobile client shows a local notification), `email`
 * reminders go through the SMTP sender, and `push` requires a configured push
 * sender — otherwise it retries and eventually fails with PUSH_UNAVAILABLE.
 */
export async function processReminderDispatch(
  clock: JobClock,
  store: ReminderDispatchStore,
  emails: UserEmailLookup,
  emailSender: EmailSender,
  push: PushSender
): Promise<{ claimed: number; sent: number; retried: number; failed: number; cancelled: number }> {
  const now = clock.now();
  const cancelled = await store.cancelOrphans();
  const claimed = await store.claimDue(now, 50);
  let sent = 0;
  let retried = 0;
  let failed = 0;

  const emailsById = await emails.findEmails([...new Set(claimed.map((r) => r.userId))]);

  for (const reminder of claimed) {
    try {
      if (reminder.channel === 'email') {
        const to = emailsById.get(reminder.userId);
        if (!to) {
          throw new Error('USER_EMAIL_MISSING');
        }
        await emailSender.sendReminderEmail(
          to,
          'LifeStyle App Reminder',
          `You have a reminder scheduled for ${reminder.remindAt.toISOString()}.`
        );
      } else if (reminder.channel === 'push') {
        if (!push.isAvailable()) {
          throw new Error('PUSH_UNAVAILABLE');
        }
        await push.send(reminder.userId, 'Reminder', 'You have a scheduled reminder');
      }
      // 'in_app': delivered by presence in the API listing.
      await store.markSent(reminder.id, now, reminder.attemptCount);
      sent += 1;
    } catch (err) {
      const message = truncate(err instanceof Error ? err.message : String(err));
      const attempts = reminder.attemptCount; // claimDue already increments this attempt
      if (attempts >= MAX_REMINDER_ATTEMPTS) {
        await store.markFailed(reminder.id, now, 'DELIVERY_FAILED', message, reminder.attemptCount);
        failed += 1;
      } else {
        await store.markRetry(
          reminder.id,
          new Date(now.getTime() + RETRY_BACKOFF_MS * attempts),
          'DELIVERY_FAILED',
          message,
          reminder.attemptCount
        );
        retried += 1;
      }
    }
  }

  return { claimed: claimed.length, sent, retried, failed, cancelled };
}

/** Rolls the recurring-task generation window forward. */
export async function processRecurringGeneration(
  store: RecurringGenerationStore,
  horizonDate: string
): Promise<{ generated: number }> {
  const generated = await store.generateDueOccurrences(horizonDate);
  return { generated };
}

/** Auto-closes focus sessions left running (spec: > 12 hours). */
export async function processTimerAutoClose(
  clock: JobClock,
  store: TimerMaintenanceStore,
  maxHours = 12
): Promise<{ closed: number }> {
  const cutoff = new Date(clock.now().getTime() - maxHours * 3_600_000);
  const closed = await store.autoCloseStale(cutoff);
  return { closed };
}

/** Hard-deletes rows whose 30-day restore window has expired and accounts whose 14-day deletion grace window has elapsed. */
export async function processPurge(
  clock: JobClock,
  store: PurgeStore,
  retentionDays = 30
): Promise<{ purged: number }> {
  const now = clock.now();
  const cutoff = new Date(now.getTime() - retentionDays * 86_400_000);
  const softDeleted = await store.purgeSoftDeleted(cutoff);
  const expiredAccounts = store.purgeExpiredAccounts ? await store.purgeExpiredAccounts(now) : 0;
  return { purged: softDeleted + expiredAccounts };
}

/**
 * Hard-deletes authentication sessions whose absolute expiry passed before
 * the cutoff. Complements the session TTLs (B-07 residual: expired-session
 * cleanup) so abandoned sessions do not accumulate indefinitely.
 */
export async function processSessionRetention(
  clock: JobClock,
  store: SessionRetentionStore,
  retentionDays = 90
): Promise<{ purged: number }> {
  const cutoff = new Date(clock.now().getTime() - retentionDays * 86_400_000);
  const purged = await store.purgeExpiredSessions(cutoff);
  return { purged };
}

/**
 * Hard-deletes audit log rows older than the retention window
 * (spec: 12 months). Runs under the maintenance role, which is the
 * only role granted DELETE on audit_logs.
 */
export async function processAuditRetention(
  clock: JobClock,
  store: AuditRetentionStore,
  retentionMonths = 12
): Promise<{ purged: number }> {
  const cutoff = new Date(clock.now().getTime() - retentionMonths * 30 * 86_400_000);
  const purged = await store.purgeAuditLogsOlderThan(cutoff);
  return { purged };
}
