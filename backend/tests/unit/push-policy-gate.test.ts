/**
 * tests/unit/push-policy-gate.test.ts
 *
 * Feature guide G2 (ADR-046): once a push provider exists (E3), every push
 * reminder goes through the account's notification policy first. Today the
 * worker's sender is permanently unavailable, so these tests use an
 * available fake sender.
 */

import { describe, expect, it, vi } from 'vitest';
import {
  processReminderDispatch,
  type DispatchableReminder,
  type PushPolicyStore,
  type PushSender,
  type PushSettings,
  type ReminderDispatchStore
} from '../../src/jobs/job-processors.js';
import {
  DEFAULT_NOTIFICATION_PREFERENCES,
  type NotificationPreferences
} from '../../src/features/notifications/notification-policy.js';
import type { EmailSender } from '../../src/infrastructure/external/email-sender.js';

const CAIRO = 'Africa/Cairo';

function reminder(overrides: Partial<DispatchableReminder> = {}): DispatchableReminder {
  return {
    id: 'rem-1',
    userId: 'user-1',
    entityType: 'task',
    entityId: 'task-1',
    channel: 'push',
    remindAt: new Date('2026-11-11T08:00:00Z'),
    attemptCount: 1,
    ...overrides
  };
}

function harness(options: {
  claimed: DispatchableReminder[];
  preferences?: Partial<NotificationPreferences>;
  sentToday?: number;
  pending?: Array<{ id: string; remindAt: Date }>;
  sendFails?: boolean;
  available?: boolean;
}) {
  const settings: PushSettings = {
    preferences: { ...DEFAULT_NOTIFICATION_PREFERENCES, ...options.preferences },
    timeZone: CAIRO
  };
  const store: ReminderDispatchStore = {
    claimDue: vi.fn(async () => options.claimed),
    markSent: vi.fn(async () => undefined),
    markRetry: vi.fn(async () => undefined),
    markFailed: vi.fn(async () => undefined),
    cancelOrphans: vi.fn(async () => 0)
  };
  const policy: PushPolicyStore = {
    loadPushSettings: vi.fn(async (ids: string[]) => new Map(ids.map((id) => [id, settings]))),
    countSentPushes: vi.fn(async () => options.sentToday ?? 0),
    listPendingPushes: vi.fn(async () => options.pending ?? []),
    claimForSummary: vi.fn(async (ids: string[]) => ids.map((id) => ({ id, attemptCount: 1 }))),
    markDeferred: vi.fn(async () => undefined),
    markSuppressed: vi.fn(async () => undefined)
  };
  const send = vi.fn(async () => {
    if (options.sendFails) throw new Error('provider down');
  });
  const push: PushSender =
    options.available === false
      ? { isAvailable: () => false, permanentlyUnavailable: true, send }
      : { isAvailable: () => true, send };
  const emails = { findEmails: vi.fn(async () => new Map<string, string>()) };
  const emailSender: EmailSender = {
    sendPasswordResetEmail: vi.fn(async () => undefined),
    sendReminderEmail: vi.fn(async () => undefined)
  };
  const run = (now: string) =>
    processReminderDispatch({ now: () => new Date(now) }, store, emails, emailSender, push, policy);
  return { store, policy, push, run };
}

describe('push policy gate (G2)', () => {
  it('sends with generic, content-free text when the defaults apply', async () => {
    const { run, push, store } = harness({ claimed: [reminder()] });
    const result = await run('2026-11-11T08:00:30Z');
    expect(result).toMatchObject({ sent: 1, deferred: 0, suppressed: 0, summarized: 0 });
    expect(push.send).toHaveBeenCalledWith('user-1', 'Reminder', 'You have a scheduled reminder');
    expect(store.markSent).toHaveBeenCalledWith('rem-1', expect.any(Date), 1);
  });

  it('defers a push due in quiet hours to their end without spending an attempt', async () => {
    const { run, push, policy, store } = harness({
      claimed: [reminder({ remindAt: new Date('2026-11-11T21:30:00Z') })],
      preferences: { quietStartMinute: 22 * 60, quietEndMinute: 7 * 60 }
    });
    const result = await run('2026-11-11T21:30:10Z');
    expect(result).toMatchObject({ sent: 0, deferred: 1 });
    expect(push.send).not.toHaveBeenCalled();
    expect(store.markSent).not.toHaveBeenCalled();
    // 07:00 in Cairo (UTC+2) the next morning.
    expect(policy.markDeferred).toHaveBeenCalledWith('rem-1', new Date('2026-11-12T05:00:00Z'), 1);
  });

  it('sends a deferred push once quiet hours have ended', async () => {
    const { run, push } = harness({
      claimed: [reminder({ remindAt: new Date('2026-11-11T21:30:00Z') })],
      preferences: { quietStartMinute: 22 * 60, quietEndMinute: 7 * 60 }
    });
    const result = await run('2026-11-12T05:00:05Z');
    expect(result).toMatchObject({ sent: 1, deferred: 0 });
    expect(push.send).toHaveBeenCalledTimes(1);
  });

  it('cancels instead of sending when the account turned notifications off', async () => {
    const { run, push, policy, store } = harness({
      claimed: [reminder()],
      preferences: { notificationsEnabled: false }
    });
    const result = await run('2026-11-11T08:00:30Z');
    expect(result).toMatchObject({ sent: 0, suppressed: 1 });
    expect(push.send).not.toHaveBeenCalled();
    expect(store.markSent).not.toHaveBeenCalled();
    expect(policy.markSuppressed).toHaveBeenCalledWith('rem-1', expect.any(Date), 1);
  });

  it('at the daily limit, sends one summary covering the rest of that local day', async () => {
    const { run, push, policy, store } = harness({
      claimed: [reminder()],
      preferences: { dailyCap: 2 },
      sentToday: 2,
      pending: [
        { id: 'rem-2', remindAt: new Date('2026-11-11T12:00:00Z') },
        { id: 'rem-3', remindAt: new Date('2026-11-11T18:00:00Z') }
      ]
    });
    const result = await run('2026-11-11T08:00:30Z');
    expect(result).toMatchObject({ sent: 1, summarized: 1 });
    expect(push.send).toHaveBeenCalledTimes(1);
    expect(push.send).toHaveBeenCalledWith('user-1', 'Reminders', 'You have 3 reminders waiting');
    // The count covers the local day in Cairo: 2026-11-10T22:00Z to 2026-11-11T22:00Z.
    expect(policy.countSentPushes).toHaveBeenCalledWith(
      'user-1',
      new Date('2026-11-10T22:00:00Z'),
      new Date('2026-11-11T22:00:00Z')
    );
    expect(policy.claimForSummary).toHaveBeenCalledWith(['rem-2', 'rem-3'], expect.any(Date));
    expect(
      vi
        .mocked(store.markSent)
        .mock.calls.map(([id]) => id)
        .sort()
    ).toEqual(['rem-1', 'rem-2', 'rem-3']);
  });

  it('leaves reminders that quiet hours move to the next day out of the summary', async () => {
    const { run, policy } = harness({
      claimed: [reminder()],
      preferences: { dailyCap: 1, quietStartMinute: 22 * 60, quietEndMinute: 7 * 60 },
      sentToday: 1,
      pending: [
        { id: 'rem-day', remindAt: new Date('2026-11-11T15:00:00Z') },
        { id: 'rem-night', remindAt: new Date('2026-11-11T21:00:00Z') }
      ]
    });
    await run('2026-11-11T08:00:30Z');
    expect(policy.claimForSummary).toHaveBeenCalledWith(['rem-day'], expect.any(Date));
  });

  it('puts covered reminders back for a retry when the summary push fails', async () => {
    const { run, store } = harness({
      claimed: [reminder()],
      preferences: { dailyCap: 1 },
      sentToday: 1,
      pending: [{ id: 'rem-2', remindAt: new Date('2026-11-11T12:00:00Z') }],
      sendFails: true
    });
    const result = await run('2026-11-11T08:00:30Z');
    expect(result).toMatchObject({ sent: 0, retried: 1, summarized: 0 });
    expect(
      vi
        .mocked(store.markRetry)
        .mock.calls.map(([id]) => id)
        .sort()
    ).toEqual(['rem-1', 'rem-2']);
    expect(store.markSent).not.toHaveBeenCalled();
  });

  it('does not consult the policy while push is permanently unavailable (F-04 unchanged)', async () => {
    const { run, policy, store } = harness({ claimed: [reminder()], available: false });
    const result = await run('2026-11-11T08:00:30Z');
    expect(result).toMatchObject({ failed: 1, sent: 0 });
    expect(policy.loadPushSettings).not.toHaveBeenCalled();
    expect(store.markFailed).toHaveBeenCalledWith(
      'rem-1',
      expect.any(Date),
      'PUSH_UNAVAILABLE',
      expect.any(String),
      1
    );
  });

  it('loads settings once per batch, only for users with push reminders', async () => {
    const { run, policy } = harness({
      claimed: [
        reminder({ id: 'a', userId: 'user-1' }),
        reminder({ id: 'b', userId: 'user-2' }),
        reminder({ id: 'c', userId: 'user-3', channel: 'in_app' })
      ]
    });
    await run('2026-11-11T08:00:30Z');
    expect(policy.loadPushSettings).toHaveBeenCalledTimes(1);
    expect(policy.loadPushSettings).toHaveBeenCalledWith(['user-1', 'user-2']);
  });
});
