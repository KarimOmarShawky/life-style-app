/**
 * tests/unit/job-processors.test.ts
 *
 * Validates Section 11: background job processors with injected fakes (no
 * BullMQ, no network) — reminder dispatch/retry/failure, recurring generation,
 * timer auto-close, retention purge, and the queued email sender fallback.
 */

import { describe, it, expect, vi } from 'vitest';
import {
  processReminderDispatch,
  processRecurringGeneration,
  processTimerAutoClose,
  processPurge,
  processSessionRetention,
  processAuditRetention,
  type PurgeStore,
  type ReminderDispatchStore,
  type DispatchableReminder
} from '../../src/jobs/job-processors.js';
import type { EmailSender } from '../../src/infrastructure/external/email-sender.js';

const NOW = new Date('2026-10-11T12:00:00.000Z');
const clock = { now: () => NOW };

function reminder(overrides: Partial<DispatchableReminder> = {}): DispatchableReminder {
  return {
    id: 'rem-1',
    userId: 'user-1',
    entityType: 'task',
    entityId: 'task-1',
    channel: 'in_app',
    remindAt: NOW,
    attemptCount: 1,
    ...overrides
  };
}

function fakeStore(claimed: DispatchableReminder[]): ReminderDispatchStore & {
  sent: string[];
  retried: Array<{ id: string; next: Date }>;
  failed: string[];
} {
  const sent: string[] = [];
  const retried: Array<{ id: string; next: Date }> = [];
  const failed: string[] = [];
  return {
    sent,
    retried,
    failed,
    claimDue: vi.fn(async () => claimed),
    markSent: vi.fn(async (id: string) => {
      sent.push(id);
    }),
    markRetry: vi.fn(async (id: string, nextAttemptAt: Date) => {
      retried.push({ id, next: nextAttemptAt });
    }),
    markFailed: vi.fn(async (id: string) => {
      failed.push(id);
    }),
    cancelOrphans: vi.fn(async () => 0)
  };
}

const emails = {
  findEmails: vi.fn(async (ids: string[]) => new Map(ids.map((id) => [id, `${id}@example.com`])))
};

const emailSender: EmailSender = {
  sendPasswordResetEmail: vi.fn(async () => undefined),
  sendReminderEmail: vi.fn(async () => undefined)
};

const pushAvailable = {
  isAvailable: () => true,
  send: vi.fn(async () => undefined)
};

const pushUnavailable = {
  isAvailable: () => false,
  send: vi.fn(async () => undefined)
};

describe('processReminderDispatch', () => {
  it('sends in_app and email reminders and marks them sent', async () => {
    const store = fakeStore([reminder(), reminder({ id: 'rem-2', channel: 'email' })]);
    const result = await processReminderDispatch(clock, store, emails, emailSender, pushAvailable);

    expect(result).toMatchObject({ claimed: 2, sent: 2, retried: 0, failed: 0 });
    expect(store.sent).toEqual(['rem-1', 'rem-2']);
    expect(emailSender.sendReminderEmail).toHaveBeenCalledTimes(1);
  });

  it('retries push reminders when no push sender is available, then fails at the cap', async () => {
    const store = fakeStore([reminder({ id: 'rem-3', channel: 'push', attemptCount: 1 })]);
    const first = await processReminderDispatch(clock, store, emails, emailSender, pushUnavailable);
    expect(first).toMatchObject({ sent: 0, retried: 1, failed: 0 });
    expect(store.retried[0]?.id).toBe('rem-3');

    const atCap = fakeStore([reminder({ id: 'rem-4', channel: 'push', attemptCount: 5 })]);
    const second = await processReminderDispatch(
      clock,
      atCap,
      emails,
      emailSender,
      pushUnavailable
    );
    expect(second).toMatchObject({ sent: 0, retried: 0, failed: 1 });
    expect(atCap.failed).toEqual(['rem-4']);
  });

  it('retries the fourth claimed attempt with a 20 minute delay and fails only the fifth', async () => {
    const store = fakeStore([reminder({ channel: 'push', attemptCount: 4 })]);
    const result = await processReminderDispatch(
      clock,
      store,
      emails,
      emailSender,
      pushUnavailable
    );
    expect(result.retried).toBe(1);
    expect(store.retried[0]?.next).toEqual(new Date(NOW.getTime() + 20 * 60_000));
  });

  it('cancels orphaned reminders before claiming', async () => {
    const store = fakeStore([]);
    await processReminderDispatch(clock, store, emails, emailSender, pushAvailable);
    expect(store.cancelOrphans).toHaveBeenCalled();
    expect(store.claimDue).toHaveBeenCalledWith(NOW, 50);
  });
});

describe('maintenance processors', () => {
  it('generates recurring occurrences up to the horizon', async () => {
    const store = { generateDueOccurrences: vi.fn(async () => 3) };
    const result = await processRecurringGeneration(store, '2026-10-18');
    expect(result.generated).toBe(3);
    expect(store.generateDueOccurrences).toHaveBeenCalledWith('2026-10-18');
  });

  it('auto-closes timer sessions older than 12 hours', async () => {
    const store = { autoCloseStale: vi.fn(async () => 2) };
    const result = await processTimerAutoClose(clock, store);
    expect(result.closed).toBe(2);
    expect(store.autoCloseStale).toHaveBeenCalledWith(new Date(NOW.getTime() - 12 * 3_600_000));
  });

  it('purges rows soft-deleted more than 30 days ago', async () => {
    const store = { purgeSoftDeleted: vi.fn(async () => 5) };
    const result = await processPurge(clock, store);
    expect(result.purged).toBe(5);
    expect(store.purgeSoftDeleted).toHaveBeenCalledWith(new Date(NOW.getTime() - 30 * 86_400_000));
  });

  it('processPurge purges both soft-deleted rows and expired pending_deletion accounts', async () => {
    const store: PurgeStore = {
      purgeSoftDeleted: vi.fn(async () => 4),
      purgeExpiredAccounts: vi.fn(async () => 2)
    };

    const res = await processPurge(clock, store, 30);

    expect(res).toEqual({ purged: 6 });
    expect(store.purgeExpiredAccounts).toHaveBeenCalledWith(clock.now());
  });

  it('processSessionRetention purges sessions expired before the cutoff', async () => {
    const store = { purgeExpiredSessions: vi.fn(async () => 7) };
    const result = await processSessionRetention(clock, store, 90);
    expect(result).toEqual({ purged: 7 });
    expect(store.purgeExpiredSessions).toHaveBeenCalledWith(
      new Date(NOW.getTime() - 90 * 86_400_000)
    );
  });

  it('processAuditRetention purges audit logs older than the retention window', async () => {
    const store = { purgeAuditLogsOlderThan: vi.fn(async () => 120) };
    const result = await processAuditRetention(clock, store, 12);
    expect(result).toEqual({ purged: 120 });
    expect(store.purgeAuditLogsOlderThan).toHaveBeenCalledWith(
      new Date(NOW.getTime() - 12 * 30 * 86_400_000)
    );
  });
});
