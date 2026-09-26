/**
 * Event and reminder request schemas.
 *
 * The case worth having a test for is the one that looks like it works: two
 * instants compared as strings. Everything else here is ordinary boundary
 * checking, and it is cheap.
 */
import { describe, expect, it } from 'vitest';

import {
  createEventSchema,
  createReminderSchema,
  dueRemindersQuerySchema,
  listEventsQuerySchema,
  listRemindersQuerySchema,
  snoozeReminderSchema,
  updateEventSchema,
  updateReminderSchema,
} from '@/features/schedule/schedule.validation';

const UUID = '11111111-1111-4111-8111-111111111111';

function event(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    title: 'Standup',
    startTime: '2026-09-24T09:00:00Z',
    endTime: '2026-09-24T09:15:00Z',
    ...overrides,
  };
}

describe('createEventSchema time ordering', () => {
  it('accepts an event that ends after it starts', () => {
    expect(createEventSchema.safeParse(event()).success).toBe(true);
  });

  it('accepts a zero-length event, which the database also allows', () => {
    const same = event({ endTime: '2026-09-24T09:00:00Z' });
    expect(createEventSchema.safeParse(same).success).toBe(true);
  });

  it('rejects an event that ends before it starts', () => {
    const backwards = event({ startTime: '2026-09-24T10:00:00Z', endTime: '2026-09-24T09:00:00Z' });
    const result = createEventSchema.safeParse(backwards);

    expect(result.success).toBe(false);
    expect(result.error?.issues[0]?.path).toEqual(['endTime']);
  });

  it('compares instants, not strings, across timezone offsets', () => {
    // 12:00+03:00 is 09:00Z, which is BEFORE 10:00Z. Sorted as text, "12" comes
    // after "10" and this valid event would be rejected.
    const offset = event({
      startTime: '2026-09-24T12:00:00+03:00',
      endTime: '2026-09-24T10:00:00Z',
    });
    expect(createEventSchema.safeParse(offset).success).toBe(true);
  });

  it('catches an inversion that only shows up once offsets are applied', () => {
    // 09:00-05:00 is 14:00Z, which is after 10:00Z. As text it looks earlier.
    const hidden = event({
      startTime: '2026-09-24T09:00:00-05:00',
      endTime: '2026-09-24T10:00:00Z',
    });
    expect(createEventSchema.safeParse(hidden).success).toBe(false);
  });

  it('requires a real date-time, not a bare date', () => {
    expect(createEventSchema.safeParse(event({ startTime: '2026-09-24' })).success).toBe(false);
  });
});

describe('event links', () => {
  it('accepts an event with no link at all', () => {
    expect(createEventSchema.safeParse(event()).success).toBe(true);
  });

  it('accepts a complete link', () => {
    const linked = event({ linkedType: 'task', linkedId: UUID });
    expect(createEventSchema.safeParse(linked).success).toBe(true);
  });

  it('rejects a type with no id', () => {
    expect(createEventSchema.safeParse(event({ linkedType: 'task' })).success).toBe(false);
  });

  it('rejects an id with no type', () => {
    expect(createEventSchema.safeParse(event({ linkedId: UUID })).success).toBe(false);
  });

  it('rejects half a clear', () => {
    const half = event({ linkedType: null, linkedId: UUID });
    expect(createEventSchema.safeParse(half).success).toBe(false);
  });

  it('accepts clearing both together', () => {
    const cleared = updateEventSchema.safeParse({ linkedType: null, linkedId: null });
    expect(cleared.success).toBe(true);
  });

  it('rejects a link to something an event cannot be attached to', () => {
    // Reminders may point at a subscription; events may not.
    const wrong = event({ linkedType: 'subscription', linkedId: UUID });
    expect(createEventSchema.safeParse(wrong).success).toBe(false);
  });
});

describe('updateEventSchema', () => {
  it('rejects an empty patch', () => {
    expect(updateEventSchema.safeParse({}).success).toBe(false);
  });

  it('allows one end to move on its own', () => {
    // The other end is in the database, so the pair cannot be checked here.
    expect(updateEventSchema.safeParse({ startTime: '2026-09-24T08:00:00Z' }).success).toBe(true);
  });

  it('still checks the pair when both ends are sent', () => {
    const backwards = {
      startTime: '2026-09-24T10:00:00Z',
      endTime: '2026-09-24T09:00:00Z',
    };
    expect(updateEventSchema.safeParse(backwards).success).toBe(false);
  });

  it('refuses an unknown field rather than ignoring it', () => {
    expect(updateEventSchema.safeParse({ title: 'x', userId: 'someone' }).success).toBe(false);
  });
});

describe('listEventsQuerySchema', () => {
  it('accepts a window', () => {
    const window = { from: '2026-09-01T00:00:00Z', to: '2026-09-30T23:59:59Z' };
    expect(listEventsQuerySchema.safeParse(window).success).toBe(true);
  });

  it('accepts either end on its own', () => {
    expect(listEventsQuerySchema.safeParse({ from: '2026-09-01T00:00:00Z' }).success).toBe(true);
    expect(listEventsQuerySchema.safeParse({ to: '2026-09-01T00:00:00Z' }).success).toBe(true);
  });

  it('rejects a window that runs backwards', () => {
    const backwards = { from: '2026-09-30T00:00:00Z', to: '2026-09-01T00:00:00Z' };
    expect(listEventsQuerySchema.safeParse(backwards).success).toBe(false);
  });

  it('defaults the page size', () => {
    const parsed = listEventsQuerySchema.parse({});
    expect(parsed.limit).toBe(20);
  });
});

describe('createReminderSchema', () => {
  const base = { entityType: 'task', entityId: UUID, remindAt: '2026-09-24T08:00:00Z' };

  it('accepts each entity type the table allows', () => {
    for (const entityType of ['task', 'habit', 'subscription', 'event']) {
      expect(createReminderSchema.safeParse({ ...base, entityType }).success).toBe(true);
    }
  });

  it('rejects an entity type the CHECK constraint would reject', () => {
    expect(createReminderSchema.safeParse({ ...base, entityType: 'project' }).success).toBe(false);
  });

  it('rejects an entity id that is not a UUID', () => {
    expect(createReminderSchema.safeParse({ ...base, entityId: 'abc' }).success).toBe(false);
  });

  it('accepts a human-readable offset and caps its length', () => {
    expect(
      createReminderSchema.safeParse({ ...base, offsetDescription: '15 minutes before' }).success,
    ).toBe(true);
    expect(
      createReminderSchema.safeParse({ ...base, offsetDescription: 'x'.repeat(101) }).success,
    ).toBe(false);
  });

  it('refuses a status supplied by the client', () => {
    // Status is moved by the action routes, never assigned. Accepting it here
    // would let a client write `sent` without a `sent_at` and break the CHECK.
    expect(createReminderSchema.safeParse({ ...base, status: 'sent' }).success).toBe(false);
  });

  it('refuses client-supplied delivery bookkeeping', () => {
    expect(createReminderSchema.safeParse({ ...base, attempts: 99 }).success).toBe(false);
    expect(createReminderSchema.safeParse({ ...base, sentAt: '2026-09-24T08:00:00Z' }).success).toBe(
      false,
    );
  });
});

describe('updateReminderSchema', () => {
  it('rejects an empty patch', () => {
    expect(updateReminderSchema.safeParse({}).success).toBe(false);
  });

  it('accepts a reschedule', () => {
    expect(updateReminderSchema.safeParse({ remindAt: '2026-09-25T08:00:00Z' }).success).toBe(true);
  });

  it('accepts clearing the offset description', () => {
    expect(updateReminderSchema.safeParse({ offsetDescription: null }).success).toBe(true);
  });

  it('refuses a status change disguised as a field update', () => {
    expect(updateReminderSchema.safeParse({ status: 'dismissed' }).success).toBe(false);
  });
});

describe('listRemindersQuerySchema', () => {
  it('accepts every status as a filter, including ones only a worker can set', () => {
    for (const status of ['pending', 'sent', 'dismissed', 'failed']) {
      expect(listRemindersQuerySchema.safeParse({ status }).success).toBe(true);
    }
  });

  it('rejects an unknown status', () => {
    expect(listRemindersQuerySchema.safeParse({ status: 'snoozed' }).success).toBe(false);
  });

  it('rejects an entity id that is not a UUID, before it reaches SQL', () => {
    expect(listRemindersQuerySchema.safeParse({ entityId: "' OR 1=1 --" }).success).toBe(false);
  });
});

describe('dueRemindersQuerySchema', () => {
  it('defaults to a bounded batch', () => {
    expect(dueRemindersQuerySchema.parse({}).limit).toBe(50);
  });

  it('coerces the query string, which is always text', () => {
    expect(dueRemindersQuerySchema.parse({ limit: '25' }).limit).toBe(25);
  });

  it('refuses to hand out an unbounded queue', () => {
    expect(dueRemindersQuerySchema.safeParse({ limit: 1000 }).success).toBe(false);
    expect(dueRemindersQuerySchema.safeParse({ limit: 0 }).success).toBe(false);
  });
});

describe('snoozeReminderSchema', () => {
  it('defaults to ten minutes', () => {
    expect(snoozeReminderSchema.parse({}).minutes).toBe(10);
  });

  it('accepts up to a week', () => {
    expect(snoozeReminderSchema.safeParse({ minutes: 10080 }).success).toBe(true);
    expect(snoozeReminderSchema.safeParse({ minutes: 10081 }).success).toBe(false);
  });

  it('rejects a snooze into the past', () => {
    expect(snoozeReminderSchema.safeParse({ minutes: -5 }).success).toBe(false);
    expect(snoozeReminderSchema.safeParse({ minutes: 0 }).success).toBe(false);
  });

  it('rejects a fractional minute, which make_interval would truncate silently', () => {
    expect(snoozeReminderSchema.safeParse({ minutes: 1.5 }).success).toBe(false);
  });
});
