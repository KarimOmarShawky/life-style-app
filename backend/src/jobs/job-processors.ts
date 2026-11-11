/**
 * src/jobs/job-processors.ts
 *
 * Implements Section 11: background job processors (reminder dispatch,
 * recurring-task generation, timer auto-close, soft-delete purge, queued
 * emails). Each processor is a plain function with injected dependencies so it
 * can be unit-tested without BullMQ; `worker.ts` wires them to the queues.
 */

import type { EmailSender } from '../infrastructure/external/email-sender.js';
import {
  DEFAULT_NOTIFICATION_PREFERENCES,
  decideNotification,
  localDateOf,
  localDayBounds,
  summaryDeliveryAt,
  type NotificationDecision,
  type NotificationPreferences
} from '../features/notifications/notification-policy.js';

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
  /** True when no push provider can ever be configured in this deployment. */
  readonly permanentlyUnavailable?: boolean;
  send(userId: string, title: string, body: string): Promise<void>;
}

export interface PushSettings {
  preferences: NotificationPreferences;
  timeZone: string;
}

/**
 * Feature guide G2 (ADR-046): what the worker needs to apply the account's
 * notification settings before any push. processReminderDispatch requires it,
 * so no push provider (E3) can be wired without the policy.
 */
export interface PushPolicyStore {
  /** Settings and time zone per user; users without saved settings get the defaults. */
  loadPushSettings(userIds: string[]): Promise<Map<string, PushSettings>>;
  /** Push reminders already sent to the user in [from, to). */
  countSentPushes(userId: string, from: Date, to: Date): Promise<number>;
  /** The user's other pending push reminders due in (after, before), oldest first. */
  listPendingPushes(
    userId: string,
    after: Date,
    before: Date
  ): Promise<Array<{ id: string; remindAt: Date }>>;
  /** Claims pending reminders for a summary; rows another worker took are skipped. */
  claimForSummary(ids: string[], now: Date): Promise<Array<{ id: string; attemptCount: number }>>;
  /** Moves a claimed reminder to a later time without spending a delivery attempt. */
  markDeferred(id: string, until: Date, attemptCount: number): Promise<void>;
  /** Cancels a claimed reminder because the account turned notifications off. */
  markSuppressed(id: string, at: Date, attemptCount: number): Promise<void>;
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

/**
 * Dispatches due reminders. `in_app` reminders are "delivered" by being listed
 * through the API (the mobile client shows a local notification), `email`
 * reminders go through the SMTP sender, and `push` requires a configured push
 * sender — otherwise it retries and eventually fails with PUSH_UNAVAILABLE.
 * When a sender exists, every push first goes through the account's
 * notification policy (G2): it may be sent, deferred out of quiet hours,
 * folded into one summary push, or cancelled when notifications are off.
 */
export async function processReminderDispatch(
  clock: JobClock,
  store: ReminderDispatchStore,
  emails: UserEmailLookup,
  emailSender: EmailSender,
  push: PushSender,
  pushPolicy: PushPolicyStore
): Promise<{
  claimed: number;
  sent: number;
  retried: number;
  failed: number;
  cancelled: number;
  deferred: number;
  suppressed: number;
  summarized: number;
}> {
  const now = clock.now();
  const cancelled = await store.cancelOrphans();
  const claimed = await store.claimDue(now, 50);
  let sent = 0;
  let retried = 0;
  let failed = 0;
  let deferred = 0;
  let suppressed = 0;
  let summarized = 0;
  let pushSettings: Map<string, PushSettings> | undefined;

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
          if (push.permanentlyUnavailable) {
            // No provider exists in this deployment: retrying cannot succeed,
            // so the row fails immediately instead of burning five attempts
            // and delaying every later reminder (F-04).
            await store.markFailed(
              reminder.id,
              now,
              'PUSH_UNAVAILABLE',
              'Push delivery is not configured on this deployment',
              reminder.attemptCount
            );
            failed += 1;
            continue;
          }
          throw new Error('PUSH_UNAVAILABLE');
        }
        pushSettings ??= await pushPolicy.loadPushSettings([
          ...new Set(claimed.filter((r) => r.channel === 'push').map((r) => r.userId))
        ]);
        const outcome = await dispatchPolicyGatedPush(
          reminder,
          now,
          push,
          pushPolicy,
          store,
          pushSettings
        );
        if (outcome === 'deferred') {
          deferred += 1;
          continue;
        }
        if (outcome === 'suppressed') {
          suppressed += 1;
          continue;
        }
        if (outcome === 'summary') summarized += 1;
      }
      // 'in_app': delivered by presence in the API listing.
      await store.markSent(reminder.id, now, reminder.attemptCount);
      sent += 1;
    } catch {
      const message = 'Reminder delivery failed';
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

  return {
    claimed: claimed.length,
    sent,
    retried,
    failed,
    cancelled,
    deferred,
    suppressed,
    summarized
  };
}

const PUSH_TITLE = 'Reminder';
const PUSH_BODY = 'You have a scheduled reminder';
const SUMMARY_TITLE = 'Reminders';
const DEFAULT_PUSH_SETTINGS: PushSettings = {
  preferences: DEFAULT_NOTIFICATION_PREFERENCES,
  timeZone: 'UTC'
};

function summaryBody(count: number): string {
  return count === 1 ? 'You have 1 reminder waiting' : `You have ${count} reminders waiting`;
}

/** Decides one push reminder; the daily limit counts pushes already sent that local day. */
async function decidePush(
  userId: string,
  at: Date,
  settings: PushSettings,
  policy: PushPolicyStore
): Promise<NotificationDecision> {
  const base = {
    tier: 'normal' as const,
    at,
    timeZone: settings.timeZone,
    preferences: settings.preferences
  };
  const provisional = decideNotification({ ...base, deliveredOn: () => 0 });
  if (
    settings.preferences.dailyCap === null ||
    (provisional.action !== 'allow' && provisional.action !== 'delay')
  ) {
    return provisional;
  }
  // The delivery day does not depend on the count, so count that day only.
  const day = localDateOf(provisional.at, settings.timeZone);
  const { start, end } = localDayBounds(day, settings.timeZone);
  const sentThatDay = await policy.countSentPushes(userId, start, end);
  return decideNotification({ ...base, deliveredOn: (d) => (d === day ? sentThatDay : 0) });
}

/**
 * Applies the G2 policy to one claimed push reminder. 'sent' and 'summary'
 * leave the reminder for the caller to mark sent; 'deferred' and
 * 'suppressed' have already updated it.
 */
async function dispatchPolicyGatedPush(
  reminder: DispatchableReminder,
  now: Date,
  push: PushSender,
  policy: PushPolicyStore,
  store: ReminderDispatchStore,
  settingsByUser: Map<string, PushSettings>
): Promise<'sent' | 'summary' | 'deferred' | 'suppressed'> {
  const settings = settingsByUser.get(reminder.userId) ?? DEFAULT_PUSH_SETTINGS;
  const decision = await decidePush(reminder.userId, reminder.remindAt, settings, policy);

  if (decision.action === 'drop') {
    await policy.markSuppressed(reminder.id, now, reminder.attemptCount);
    return 'suppressed';
  }
  if (decision.action === 'delay' && decision.at.getTime() > now.getTime()) {
    await policy.markDeferred(reminder.id, decision.at, reminder.attemptCount);
    return 'deferred';
  }
  if (decision.action !== 'digest') {
    await push.send(reminder.userId, PUSH_TITLE, PUSH_BODY);
    return 'sent';
  }

  const summaryAt = summaryDeliveryAt(reminder.remindAt, settings.timeZone, settings.preferences);
  if (summaryAt.getTime() > now.getTime()) {
    await policy.markDeferred(reminder.id, summaryAt, reminder.attemptCount);
    return 'deferred';
  }

  // One summary push covers the rest of that local day's reminders over the
  // limit. Reminders that quiet hours move to the next day are not included.
  const { end } = localDayBounds(decision.localDate, settings.timeZone);
  const candidates = await policy.listPendingPushes(reminder.userId, now, end);
  const sameDay = candidates.filter((candidate) => {
    const provisional = decideNotification({
      tier: 'normal',
      at: candidate.remindAt,
      timeZone: settings.timeZone,
      preferences: settings.preferences,
      deliveredOn: () => 0
    });
    return (
      (provisional.action === 'allow' || provisional.action === 'delay') &&
      localDateOf(provisional.at, settings.timeZone) === decision.localDate
    );
  });
  const covered =
    sameDay.length > 0
      ? await policy.claimForSummary(
          sameDay.map((c) => c.id),
          now
        )
      : [];
  try {
    await push.send(reminder.userId, SUMMARY_TITLE, summaryBody(covered.length + 1));
  } catch (err) {
    for (const item of covered) {
      await store.markRetry(
        item.id,
        new Date(now.getTime() + RETRY_BACKOFF_MS),
        'DELIVERY_FAILED',
        'Reminder delivery failed',
        item.attemptCount
      );
    }
    throw err;
  }
  for (const item of covered) {
    await store.markSent(item.id, now, item.attemptCount);
  }
  return 'summary';
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
