/**
 * Events and reminders, end to end (spec sections 41 and 43).
 *
 * The three behaviours worth the length of this file:
 *
 *   OVERLAP, NOT START. A calendar window must return an event that was already
 *   running when the window opened. The easy filter — `start_time BETWEEN from
 *   AND to` — passes every single-day test and drops exactly the multi-day
 *   events a calendar exists to show.
 *
 *   ALL-DAY IS STORED, NOT DECORATED. An event flagged all-day is snapped to the
 *   whole UTC day by the database, in the same statement that sets the flag, so
 *   the two can never disagree — including when only the flag is patched.
 *
 *   A REMINDER FOR A DELETED THING NEVER FIRES. There is no foreign key to
 *   cascade, so the orphan check is a condition in the due query. Deleting the
 *   target and re-reading the queue is what proves it is there.
 */
import request from 'supertest';
import { beforeAll, describe, expect, it } from 'vitest';
import type { Express } from 'express';

import { createApp } from '@/app';

import { STRONG_PASSWORD, testEmail } from '../setup';

let app: Express;
let auth: string;

let taskId: string;
let habitId: string;
let subscriptionId: string;

/** Well-formed and belonging to nobody. */
const ABSENT_ID = '00000000-0000-4000-8000-000000000000';

const PAST = '2001-06-01T08:00:00.000Z';
const FUTURE = '2099-06-01T08:00:00.000Z';

async function register(label: string): Promise<string> {
  const response = await request(app)
    .post('/api/v1/auth/register')
    .send({ email: testEmail(label), password: STRONG_PASSWORD })
    .expect(201);
  return `Bearer ${response.body.data.tokens.accessToken}`;
}

/**
 * Deliberately NOT async: supertest's own Test object is what carries `.expect`,
 * and wrapping it in a promise would hand back something that can be awaited but
 * not asserted on.
 */
function createEvent(body: Record<string, unknown>, token = auth): request.Test {
  return request(app).post('/api/v1/events').set('Authorization', token).send(body);
}

function createReminder(body: Record<string, unknown>, token = auth): request.Test {
  return request(app).post('/api/v1/reminders').set('Authorization', token).send(body);
}

beforeAll(async () => {
  app = createApp();
  auth = await register('schedule');

  const task = await request(app)
    .post('/api/v1/tasks')
    .set('Authorization', auth)
    .send({ title: 'Write the report' })
    .expect(201);
  taskId = task.body.data.id;

  const habit = await request(app)
    .post('/api/v1/habits')
    .set('Authorization', auth)
    .send({ title: 'Morning run' })
    .expect(201);
  habitId = habit.body.data.id;

  const subscription = await request(app)
    .post('/api/v1/subscriptions')
    .set('Authorization', auth)
    .send({ name: 'Streaming', amount: '99.00', renewalDate: '2001-06-01' })
    .expect(201);
  subscriptionId = subscription.body.data.id;
});

describe('creating events', () => {
  it('stores a timed event unchanged', async () => {
    const response = await createEvent({
      title: 'Standup',
      description: 'Daily',
      startTime: '2001-07-02T09:00:00.000Z',
      endTime: '2001-07-02T09:15:00.000Z',
    }).expect(201);

    expect(response.body.data.startTime).toBe('2001-07-02T09:00:00.000Z');
    expect(response.body.data.endTime).toBe('2001-07-02T09:15:00.000Z');
    expect(response.body.data.allDay).toBe(false);
    expect(response.body.data.linkedType).toBeNull();
  });

  it('accepts an event that starts and ends at the same instant', async () => {
    await createEvent({
      title: 'Moment',
      startTime: '2001-07-03T09:00:00.000Z',
      endTime: '2001-07-03T09:00:00.000Z',
    }).expect(201);
  });

  it('refuses an event that ends before it starts', async () => {
    const response = await createEvent({
      title: 'Backwards',
      startTime: '2001-07-04T10:00:00.000Z',
      endTime: '2001-07-04T09:00:00.000Z',
    }).expect(422);

    // Prefixed with the request part it came from: this issue was raised by the
    // body schema, whereas the ones the service raises name the field alone.
    expect(response.body.error.issues[0].field).toBe('body.endTime');
  });

  it('refuses a blank title rather than letting the database constraint answer', async () => {
    await createEvent({
      title: '   ',
      startTime: '2001-07-05T09:00:00.000Z',
      endTime: '2001-07-05T10:00:00.000Z',
    }).expect(422);
  });

  it('normalizes an offset to UTC on the way out', async () => {
    const response = await createEvent({
      title: 'Cairo morning',
      startTime: '2001-07-06T12:00:00+03:00',
      endTime: '2001-07-06T13:00:00+03:00',
    }).expect(201);

    expect(response.body.data.startTime).toBe('2001-07-06T09:00:00.000Z');
  });
});

describe('all-day events', () => {
  it('snaps a flagged event to the whole UTC day', async () => {
    const response = await createEvent({
      title: 'Public holiday',
      startTime: '2001-07-10T09:30:00.000Z',
      endTime: '2001-07-10T17:00:00.000Z',
      allDay: true,
    }).expect(201);

    expect(response.body.data.startTime).toBe('2001-07-10T00:00:00.000Z');
    expect(response.body.data.endTime).toBe('2001-07-10T23:59:59.999Z');
  });

  it('ends a millisecond before midnight, so it does not bleed into the next day', async () => {
    const holiday = await createEvent({
      title: 'Single day',
      startTime: '2001-07-11T00:00:00.000Z',
      endTime: '2001-07-11T00:00:00.000Z',
      allDay: true,
    }).expect(201);

    const nextDay = await request(app)
      .get('/api/v1/events?from=2001-07-12T00:00:00.000Z&to=2001-07-12T23:59:59.999Z&limit=100')
      .set('Authorization', auth)
      .expect(200);

    const ids = nextDay.body.data.map((event: { id: string }) => event.id);
    expect(ids).not.toContain(holiday.body.data.id);
  });

  it('spans several whole days when the range covers them', async () => {
    const response = await createEvent({
      title: 'Holiday week',
      startTime: '2001-07-16T11:00:00.000Z',
      endTime: '2001-07-20T15:00:00.000Z',
      allDay: true,
    }).expect(201);

    expect(response.body.data.startTime).toBe('2001-07-16T00:00:00.000Z');
    expect(response.body.data.endTime).toBe('2001-07-20T23:59:59.999Z');
  });

  it('snaps the stored times when only the flag is patched', async () => {
    const timed = await createEvent({
      title: 'Becomes all day',
      startTime: '2001-07-21T14:00:00.000Z',
      endTime: '2001-07-21T15:00:00.000Z',
    }).expect(201);

    const flagged = await request(app)
      .patch(`/api/v1/events/${timed.body.data.id}`)
      .set('Authorization', auth)
      .send({ allDay: true })
      .expect(200);

    // The request carried no times at all. Normalizing only what the request
    // supplies would leave a flagged event sitting in a one-hour slot.
    expect(flagged.body.data.startTime).toBe('2001-07-21T00:00:00.000Z');
    expect(flagged.body.data.endTime).toBe('2001-07-21T23:59:59.999Z');
  });

  it('leaves the times alone when the flag is cleared', async () => {
    const created = await createEvent({
      title: 'Was all day',
      startTime: '2001-07-22T00:00:00.000Z',
      endTime: '2001-07-22T00:00:00.000Z',
      allDay: true,
    }).expect(201);

    const cleared = await request(app)
      .patch(`/api/v1/events/${created.body.data.id}`)
      .set('Authorization', auth)
      .send({ allDay: false })
      .expect(200);

    // Nothing better to restore: the original times are gone. The honest result
    // is a timed event covering the same span, not an invented 9-to-5.
    expect(cleared.body.data.allDay).toBe(false);
    expect(cleared.body.data.startTime).toBe('2001-07-22T00:00:00.000Z');
    expect(cleared.body.data.endTime).toBe('2001-07-22T23:59:59.999Z');
  });
});

describe('the calendar window', () => {
  let conferenceId: string;
  let beforeId: string;
  let afterId: string;

  beforeAll(async () => {
    const conference = await createEvent({
      title: 'Conference',
      startTime: '2001-08-06T08:00:00.000Z',
      endTime: '2001-08-10T18:00:00.000Z',
    }).expect(201);
    conferenceId = conference.body.data.id;

    const earlier = await createEvent({
      title: 'Before',
      startTime: '2001-08-01T09:00:00.000Z',
      endTime: '2001-08-01T10:00:00.000Z',
    }).expect(201);
    beforeId = earlier.body.data.id;

    const later = await createEvent({
      title: 'After',
      startTime: '2001-08-20T09:00:00.000Z',
      endTime: '2001-08-20T10:00:00.000Z',
    }).expect(201);
    afterId = later.body.data.id;
  });

  async function idsInWindow(from: string, to: string): Promise<string[]> {
    const response = await request(app)
      .get(`/api/v1/events?from=${from}&to=${to}&limit=100`)
      .set('Authorization', auth)
      .expect(200);
    return response.body.data.map((event: { id: string }) => event.id);
  }

  it('returns an event already running when the window opens', async () => {
    // Wednesday of a Monday-to-Friday conference. This is the case a
    // start_time-only filter gets wrong.
    const ids = await idsInWindow('2001-08-08T00:00:00.000Z', '2001-08-08T23:59:59.999Z');
    expect(ids).toContain(conferenceId);
  });

  it('returns an event that starts inside the window', async () => {
    const ids = await idsInWindow('2001-08-06T00:00:00.000Z', '2001-08-06T23:59:59.999Z');
    expect(ids).toContain(conferenceId);
  });

  it('returns an event that ends inside the window', async () => {
    const ids = await idsInWindow('2001-08-10T00:00:00.000Z', '2001-08-10T23:59:59.999Z');
    expect(ids).toContain(conferenceId);
  });

  it('excludes events wholly outside it', async () => {
    const ids = await idsInWindow('2001-08-08T00:00:00.000Z', '2001-08-08T23:59:59.999Z');
    expect(ids).not.toContain(beforeId);
    expect(ids).not.toContain(afterId);
  });

  it('includes an event touching the window by a single instant', async () => {
    const ids = await idsInWindow('2001-08-10T18:00:00.000Z', '2001-08-10T18:00:00.000Z');
    expect(ids).toContain(conferenceId);
  });

  it('accepts an open-ended window', async () => {
    const forward = await request(app)
      .get('/api/v1/events?from=2001-08-15T00:00:00.000Z&limit=100')
      .set('Authorization', auth)
      .expect(200);

    const ids = forward.body.data.map((event: { id: string }) => event.id);
    expect(ids).toContain(afterId);
    expect(ids).not.toContain(beforeId);
  });

  it('refuses a window that runs backwards', async () => {
    await request(app)
      .get('/api/v1/events?from=2001-08-20T00:00:00.000Z&to=2001-08-01T00:00:00.000Z')
      .set('Authorization', auth)
      .expect(422);
  });
});

describe('listing events', () => {
  it('returns them earliest first', async () => {
    const response = await request(app)
      .get('/api/v1/events?limit=100')
      .set('Authorization', auth)
      .expect(200);

    const starts = response.body.data.map((event: { startTime: string }) => event.startTime);
    expect(starts).toEqual([...starts].sort());
    expect(starts.length).toBeGreaterThan(3);
  });

  it('pages forward without skipping or repeating a row', async () => {
    const first = await request(app)
      .get('/api/v1/events?limit=3')
      .set('Authorization', auth)
      .expect(200);

    expect(first.body.pagination.hasMore).toBe(true);
    expect(first.body.pagination.nextCursor).not.toBeNull();

    const second = await request(app)
      .get(`/api/v1/events?limit=3&cursor=${encodeURIComponent(first.body.pagination.nextCursor)}`)
      .set('Authorization', auth)
      .expect(200);

    const firstIds = first.body.data.map((event: { id: string }) => event.id);
    const secondIds = second.body.data.map((event: { id: string }) => event.id);

    expect(secondIds.some((id: string) => firstIds.includes(id))).toBe(false);

    // The cursor carries `start_time`, which is what the scan orders by. Built
    // from `created_at` instead it would resume a different ordering.
    const lastOfFirst = first.body.data[first.body.data.length - 1].startTime;
    expect(second.body.data[0].startTime >= lastOfFirst).toBe(true);
  });

  it('filters to events carrying a link of a given kind', async () => {
    const linked = await createEvent({
      title: 'Linked to a habit',
      startTime: '2001-09-01T09:00:00.000Z',
      endTime: '2001-09-01T10:00:00.000Z',
      linkedType: 'habit',
      linkedId: habitId,
    }).expect(201);

    const response = await request(app)
      .get('/api/v1/events?linkedType=habit&limit=100')
      .set('Authorization', auth)
      .expect(200);

    const ids = response.body.data.map((event: { id: string }) => event.id);
    expect(ids).toContain(linked.body.data.id);

    for (const event of response.body.data) {
      expect(event.linkedType).toBe('habit');
    }
  });
});

describe('event links', () => {
  it('resolves the title of the linked task in the same response', async () => {
    const response = await createEvent({
      title: 'Report review',
      startTime: '2001-09-05T09:00:00.000Z',
      endTime: '2001-09-05T10:00:00.000Z',
      linkedType: 'task',
      linkedId: taskId,
    }).expect(201);

    expect(response.body.data.linkedTitle).toBe('Write the report');
  });

  it('refuses a link to an id that does not exist', async () => {
    const response = await createEvent({
      title: 'Nowhere',
      startTime: '2001-09-06T09:00:00.000Z',
      endTime: '2001-09-06T10:00:00.000Z',
      linkedType: 'task',
      linkedId: ABSENT_ID,
    }).expect(422);

    expect(response.body.error.issues[0].field).toBe('linkedId');
  });

  it('refuses half a link', async () => {
    await createEvent({
      title: 'Half',
      startTime: '2001-09-07T09:00:00.000Z',
      endTime: '2001-09-07T10:00:00.000Z',
      linkedType: 'task',
    }).expect(422);
  });

  it('reports a link whose target was deleted as an id with no title', async () => {
    const doomed = await request(app)
      .post('/api/v1/tasks')
      .set('Authorization', auth)
      .send({ title: 'Will be deleted' })
      .expect(201);

    const event = await createEvent({
      title: 'Points at a ghost',
      startTime: '2001-09-08T09:00:00.000Z',
      endTime: '2001-09-08T10:00:00.000Z',
      linkedType: 'task',
      linkedId: doomed.body.data.id,
    }).expect(201);

    await request(app)
      .delete(`/api/v1/tasks/${doomed.body.data.id}`)
      .set('Authorization', auth)
      .expect(204);

    const after = await request(app)
      .get(`/api/v1/events/${event.body.data.id}`)
      .set('Authorization', auth)
      .expect(200);

    // Not "unlinked": the user attached this to something, and the something is
    // gone. Reporting the id with a null title is the only honest answer.
    expect(after.body.data.linkedType).toBe('task');
    expect(after.body.data.linkedId).toBe(doomed.body.data.id);
    expect(after.body.data.linkedTitle).toBeNull();
  });

  it('clears a link when both halves are sent as null', async () => {
    const event = await createEvent({
      title: 'Unlink me',
      startTime: '2001-09-09T09:00:00.000Z',
      endTime: '2001-09-09T10:00:00.000Z',
      linkedType: 'habit',
      linkedId: habitId,
    }).expect(201);

    const cleared = await request(app)
      .patch(`/api/v1/events/${event.body.data.id}`)
      .set('Authorization', auth)
      .send({ linkedType: null, linkedId: null })
      .expect(200);

    expect(cleared.body.data.linkedType).toBeNull();
    expect(cleared.body.data.linkedId).toBeNull();
    expect(cleared.body.data.linkedTitle).toBeNull();
  });
});

describe('updating an event', () => {
  let eventId: string;

  beforeAll(async () => {
    const created = await createEvent({
      title: 'Movable',
      startTime: '2001-10-01T09:00:00.000Z',
      endTime: '2001-10-01T10:00:00.000Z',
    }).expect(201);
    eventId = created.body.data.id;
  });

  it('changes one field and leaves the rest', async () => {
    const response = await request(app)
      .patch(`/api/v1/events/${eventId}`)
      .set('Authorization', auth)
      .send({ title: 'Renamed' })
      .expect(200);

    expect(response.body.data.title).toBe('Renamed');
    expect(response.body.data.startTime).toBe('2001-10-01T09:00:00.000Z');
  });

  it('reports a 422, not a 500, when one end is moved past the stored other end', async () => {
    // Nothing in this request looks wrong. The conflict only exists against the
    // row, and the database CHECK is what finds it.
    const response = await request(app)
      .patch(`/api/v1/events/${eventId}`)
      .set('Authorization', auth)
      .send({ startTime: '2001-10-01T23:00:00.000Z' })
      .expect(422);

    expect(response.body.error.issues[0].field).toBe('endTime');
  });

  it('leaves the event untouched after that rejection', async () => {
    const response = await request(app)
      .get(`/api/v1/events/${eventId}`)
      .set('Authorization', auth)
      .expect(200);

    expect(response.body.data.startTime).toBe('2001-10-01T09:00:00.000Z');
  });

  it('accepts both ends moving together', async () => {
    const response = await request(app)
      .patch(`/api/v1/events/${eventId}`)
      .set('Authorization', auth)
      .send({ startTime: '2001-10-02T09:00:00.000Z', endTime: '2001-10-02T11:00:00.000Z' })
      .expect(200);

    expect(response.body.data.endTime).toBe('2001-10-02T11:00:00.000Z');
  });

  it('is 404 for an event that does not exist', async () => {
    await request(app)
      .patch(`/api/v1/events/${ABSENT_ID}`)
      .set('Authorization', auth)
      .send({ title: 'x' })
      .expect(404);
  });
});

describe('creating reminders', () => {
  it('attaches to a task and resolves its title', async () => {
    const response = await createReminder({
      entityType: 'task',
      entityId: taskId,
      remindAt: '2001-11-01T08:00:00.000Z',
      offsetDescription: '1 day before',
    }).expect(201);

    expect(response.body.data.entityTitle).toBe('Write the report');
    expect(response.body.data.status).toBe('pending');
    expect(response.body.data.sentAt).toBeNull();
    expect(response.body.data.attempts).toBe(0);
  });

  it('attaches to a habit', async () => {
    const response = await createReminder({
      entityType: 'habit',
      entityId: habitId,
      remindAt: '2001-11-02T08:00:00.000Z',
    }).expect(201);

    expect(response.body.data.entityTitle).toBe('Morning run');
  });

  it('attaches to a subscription, whose title column is called name', async () => {
    const response = await createReminder({
      entityType: 'subscription',
      entityId: subscriptionId,
      remindAt: '2001-11-03T08:00:00.000Z',
    }).expect(201);

    expect(response.body.data.entityTitle).toBe('Streaming');
  });

  it('attaches to an event', async () => {
    const event = await createEvent({
      title: 'Dentist',
      startTime: '2001-11-04T09:00:00.000Z',
      endTime: '2001-11-04T10:00:00.000Z',
    }).expect(201);

    const response = await createReminder({
      entityType: 'event',
      entityId: event.body.data.id,
      remindAt: '2001-11-04T08:00:00.000Z',
    }).expect(201);

    expect(response.body.data.entityTitle).toBe('Dentist');
  });

  it('refuses an entity that does not exist', async () => {
    const response = await createReminder({
      entityType: 'task',
      entityId: ABSENT_ID,
      remindAt: '2001-11-05T08:00:00.000Z',
    }).expect(422);

    expect(response.body.error.issues[0].field).toBe('entityId');
  });

  it('refuses the same reminder twice at the same instant', async () => {
    const body = {
      entityType: 'habit',
      entityId: habitId,
      remindAt: '2001-11-06T08:00:00.000Z',
    };

    await createReminder(body).expect(201);
    const second = await createReminder(body).expect(409);

    expect(second.body.error.code).toBe('ALREADY_EXISTS');
  });

  it('allows the same entity at a different instant', async () => {
    await createReminder({
      entityType: 'habit',
      entityId: habitId,
      remindAt: '2001-11-06T08:00:01.000Z',
    }).expect(201);
  });
});

describe('the due queue', () => {
  let duePast: string;
  let dueEarlier: string;
  let notYetDue: string;
  let queueAuth: string;

  beforeAll(async () => {
    const owner = await register('due-queue');
    queueAuth = owner;

    const task = await request(app)
      .post('/api/v1/tasks')
      .set('Authorization', owner)
      .send({ title: 'Queue subject' })
      .expect(201);

    const later = await request(app)
      .post('/api/v1/reminders')
      .set('Authorization', owner)
      .send({ entityType: 'task', entityId: task.body.data.id, remindAt: PAST })
      .expect(201);
    duePast = later.body.data.id;

    const earlier = await request(app)
      .post('/api/v1/reminders')
      .set('Authorization', owner)
      .send({
        entityType: 'task',
        entityId: task.body.data.id,
        remindAt: '2001-01-01T08:00:00.000Z',
      })
      .expect(201);
    dueEarlier = earlier.body.data.id;

    const future = await request(app)
      .post('/api/v1/reminders')
      .set('Authorization', owner)
      .send({ entityType: 'task', entityId: task.body.data.id, remindAt: FUTURE })
      .expect(201);
    notYetDue = future.body.data.id;
  });

  it('returns what has come due and nothing that has not', async () => {
    const response = await request(app)
      .get('/api/v1/reminders/due')
      .set('Authorization', queueAuth)
      .expect(200);

    const ids = response.body.data.map((reminder: { id: string }) => reminder.id);
    expect(ids).toContain(duePast);
    expect(ids).not.toContain(notYetDue);
  });

  it('returns the oldest first, because it is a queue and not a list', async () => {
    const response = await request(app)
      .get('/api/v1/reminders/due')
      .set('Authorization', queueAuth)
      .expect(200);

    const ids = response.body.data.map((reminder: { id: string }) => reminder.id);
    expect(ids.indexOf(dueEarlier)).toBeLessThan(ids.indexOf(duePast));
  });

  it('is bounded, and says so rather than silently truncating an unbounded ask', async () => {
    await request(app)
      .get('/api/v1/reminders/due?limit=1000')
      .set('Authorization', queueAuth)
      .expect(422);
  });

  it('honours a smaller batch', async () => {
    const response = await request(app)
      .get('/api/v1/reminders/due?limit=1')
      .set('Authorization', queueAuth)
      .expect(200);

    expect(response.body.data).toHaveLength(1);
    expect(response.body.data[0].id).toBe(dueEarlier);
  });

  it('drops a reminder whose entity has been deleted', async () => {
    const doomed = await request(app)
      .post('/api/v1/tasks')
      .set('Authorization', queueAuth)
      .send({ title: 'About to vanish' })
      .expect(201);

    const reminder = await request(app)
      .post('/api/v1/reminders')
      .set('Authorization', queueAuth)
      .send({ entityType: 'task', entityId: doomed.body.data.id, remindAt: PAST })
      .expect(201);

    const before = await request(app)
      .get('/api/v1/reminders/due?limit=100')
      .set('Authorization', queueAuth)
      .expect(200);
    expect(before.body.data.map((r: { id: string }) => r.id)).toContain(reminder.body.data.id);

    await request(app)
      .delete(`/api/v1/tasks/${doomed.body.data.id}`)
      .set('Authorization', queueAuth)
      .expect(204);

    const after = await request(app)
      .get('/api/v1/reminders/due?limit=100')
      .set('Authorization', queueAuth)
      .expect(200);

    // Firing this would open a notification onto a 404. There is no foreign key
    // to cascade the delete, so the filter in the query is the whole defence.
    expect(after.body.data.map((r: { id: string }) => r.id)).not.toContain(reminder.body.data.id);
  });

  it('still shows the orphaned reminder on a direct read, with a null title', async () => {
    const doomed = await request(app)
      .post('/api/v1/tasks')
      .set('Authorization', queueAuth)
      .send({ title: 'Also vanishing' })
      .expect(201);

    const reminder = await request(app)
      .post('/api/v1/reminders')
      .set('Authorization', queueAuth)
      .send({ entityType: 'task', entityId: doomed.body.data.id, remindAt: FUTURE })
      .expect(201);

    await request(app)
      .delete(`/api/v1/tasks/${doomed.body.data.id}`)
      .set('Authorization', queueAuth)
      .expect(204);

    const read = await request(app)
      .get(`/api/v1/reminders/${reminder.body.data.id}`)
      .set('Authorization', queueAuth)
      .expect(200);

    expect(read.body.data.entityTitle).toBeNull();
    expect(read.body.data.entityId).toBe(doomed.body.data.id);
  });

  it('leaves a dismissed reminder out of the queue', async () => {
    await request(app)
      .post(`/api/v1/reminders/${duePast}/dismiss`)
      .set('Authorization', queueAuth)
      .expect(200);

    const response = await request(app)
      .get('/api/v1/reminders/due?limit=100')
      .set('Authorization', queueAuth)
      .expect(200);

    expect(response.body.data.map((r: { id: string }) => r.id)).not.toContain(duePast);
  });
});

describe('reminder transitions', () => {
  let reminderId: string;
  let owner: string;

  beforeAll(async () => {
    owner = await register('transitions');

    const habit = await request(app)
      .post('/api/v1/habits')
      .set('Authorization', owner)
      .send({ title: 'Stretch' })
      .expect(201);

    const reminder = await request(app)
      .post('/api/v1/reminders')
      .set('Authorization', owner)
      .send({ entityType: 'habit', entityId: habit.body.data.id, remindAt: PAST })
      .expect(201);
    reminderId = reminder.body.data.id;
  });

  it('marks a reminder sent and records when', async () => {
    const response = await request(app)
      .post(`/api/v1/reminders/${reminderId}/acknowledge`)
      .set('Authorization', owner)
      .expect(200);

    expect(response.body.data.status).toBe('sent');
    expect(response.body.data.sentAt).not.toBeNull();
  });

  it('is idempotent, so a retry on a flaky connection is harmless', async () => {
    const first = await request(app)
      .get(`/api/v1/reminders/${reminderId}`)
      .set('Authorization', owner)
      .expect(200);

    const again = await request(app)
      .post(`/api/v1/reminders/${reminderId}/acknowledge`)
      .set('Authorization', owner)
      .expect(200);

    // The timestamp must not move, or a client that retries would report the
    // notification as having been shown later than it was.
    expect(again.body.data.sentAt).toBe(first.body.data.sentAt);
  });

  it('dismisses from sent', async () => {
    const response = await request(app)
      .post(`/api/v1/reminders/${reminderId}/dismiss`)
      .set('Authorization', owner)
      .expect(200);

    expect(response.body.data.status).toBe('dismissed');
  });

  it('dismisses again without complaining', async () => {
    await request(app)
      .post(`/api/v1/reminders/${reminderId}/dismiss`)
      .set('Authorization', owner)
      .expect(200);
  });

  it('refuses to acknowledge something already thrown away', async () => {
    const response = await request(app)
      .post(`/api/v1/reminders/${reminderId}/acknowledge`)
      .set('Authorization', owner)
      .expect(409);

    expect(response.body.error.code).toBe('CONFLICT');
  });

  it('is a 404, not a 409, for a reminder that does not exist', async () => {
    // The two error paths look identical from inside the repository, so this is
    // what proves they are told apart correctly.
    await request(app)
      .post(`/api/v1/reminders/${ABSENT_ID}/acknowledge`)
      .set('Authorization', owner)
      .expect(404);
  });

  it('snoozes back into the queue, measured from now', async () => {
    const response = await request(app)
      .post(`/api/v1/reminders/${reminderId}/snooze`)
      .set('Authorization', owner)
      .send({ minutes: 15 })
      .expect(200);

    expect(response.body.data.status).toBe('pending');
    expect(response.body.data.sentAt).toBeNull();

    const delta = Date.parse(response.body.data.remindAt) - Date.now();
    expect(delta).toBeGreaterThan(14 * 60_000);
    expect(delta).toBeLessThan(16 * 60_000);
  });

  it('defaults a snooze to ten minutes', async () => {
    const response = await request(app)
      .post(`/api/v1/reminders/${reminderId}/snooze`)
      .set('Authorization', owner)
      .send({})
      .expect(200);

    const delta = Date.parse(response.body.data.remindAt) - Date.now();
    expect(delta).toBeGreaterThan(9 * 60_000);
    expect(delta).toBeLessThan(11 * 60_000);
  });

  it('refuses a snooze longer than the schema allows', async () => {
    await request(app)
      .post(`/api/v1/reminders/${reminderId}/snooze`)
      .set('Authorization', owner)
      .send({ minutes: 20000 })
      .expect(422);
  });
});

describe('listing and editing reminders', () => {
  let owner: string;
  let taskEntity: string;
  let habitEntity: string;

  beforeAll(async () => {
    owner = await register('reminder-list');

    const task = await request(app)
      .post('/api/v1/tasks')
      .set('Authorization', owner)
      .send({ title: 'Listed task' })
      .expect(201);
    taskEntity = task.body.data.id;

    const habit = await request(app)
      .post('/api/v1/habits')
      .set('Authorization', owner)
      .send({ title: 'Listed habit' })
      .expect(201);
    habitEntity = habit.body.data.id;

    for (const day of ['05', '06', '07']) {
      await request(app)
        .post('/api/v1/reminders')
        .set('Authorization', owner)
        .send({ entityType: 'task', entityId: taskEntity, remindAt: `2001-12-${day}T08:00:00.000Z` })
        .expect(201);
    }

    await request(app)
      .post('/api/v1/reminders')
      .set('Authorization', owner)
      .send({ entityType: 'habit', entityId: habitEntity, remindAt: '2001-12-08T08:00:00.000Z' })
      .expect(201);
  });

  it('returns the most recently scheduled first', async () => {
    const response = await request(app)
      .get('/api/v1/reminders?limit=100')
      .set('Authorization', owner)
      .expect(200);

    const times = response.body.data.map((r: { remindAt: string }) => r.remindAt);
    expect(times).toEqual([...times].sort().reverse());
  });

  it('filters by entity type', async () => {
    const response = await request(app)
      .get('/api/v1/reminders?entityType=habit&limit=100')
      .set('Authorization', owner)
      .expect(200);

    expect(response.body.data).toHaveLength(1);
    expect(response.body.data[0].entityTitle).toBe('Listed habit');
  });

  it('filters by a single entity', async () => {
    const response = await request(app)
      .get(`/api/v1/reminders?entityId=${taskEntity}&limit=100`)
      .set('Authorization', owner)
      .expect(200);

    expect(response.body.data).toHaveLength(3);
  });

  it('filters by status', async () => {
    const response = await request(app)
      .get('/api/v1/reminders?status=pending&limit=100')
      .set('Authorization', owner)
      .expect(200);

    expect(response.body.data).toHaveLength(4);
  });

  it('pages without repeating a row', async () => {
    const first = await request(app)
      .get('/api/v1/reminders?limit=2')
      .set('Authorization', owner)
      .expect(200);

    expect(first.body.pagination.nextCursor).not.toBeNull();

    const second = await request(app)
      .get(
        `/api/v1/reminders?limit=2&cursor=${encodeURIComponent(first.body.pagination.nextCursor)}`,
      )
      .set('Authorization', owner)
      .expect(200);

    const firstIds = first.body.data.map((r: { id: string }) => r.id);
    const secondIds = second.body.data.map((r: { id: string }) => r.id);
    expect(secondIds.some((id: string) => firstIds.includes(id))).toBe(false);
  });

  it('reschedules a reminder', async () => {
    const created = await request(app)
      .post('/api/v1/reminders')
      .set('Authorization', owner)
      .send({ entityType: 'task', entityId: taskEntity, remindAt: '2001-12-20T08:00:00.000Z' })
      .expect(201);

    const moved = await request(app)
      .patch(`/api/v1/reminders/${created.body.data.id}`)
      .set('Authorization', owner)
      .send({ remindAt: '2001-12-21T09:30:00.000Z', offsetDescription: 'the day before' })
      .expect(200);

    expect(moved.body.data.remindAt).toBe('2001-12-21T09:30:00.000Z');
    expect(moved.body.data.offsetDescription).toBe('the day before');
  });

  it('refuses a reschedule onto an instant already taken for the same entity', async () => {
    const created = await request(app)
      .post('/api/v1/reminders')
      .set('Authorization', owner)
      .send({ entityType: 'task', entityId: taskEntity, remindAt: '2001-12-22T08:00:00.000Z' })
      .expect(201);

    const clash = await request(app)
      .patch(`/api/v1/reminders/${created.body.data.id}`)
      .set('Authorization', owner)
      .send({ remindAt: '2001-12-05T08:00:00.000Z' })
      .expect(409);

    expect(clash.body.error.code).toBe('ALREADY_EXISTS');
  });

  it('deletes a reminder', async () => {
    const created = await request(app)
      .post('/api/v1/reminders')
      .set('Authorization', owner)
      .send({ entityType: 'task', entityId: taskEntity, remindAt: '2001-12-25T08:00:00.000Z' })
      .expect(201);

    await request(app)
      .delete(`/api/v1/reminders/${created.body.data.id}`)
      .set('Authorization', owner)
      .expect(204);

    await request(app)
      .get(`/api/v1/reminders/${created.body.data.id}`)
      .set('Authorization', owner)
      .expect(404);
  });
});

describe('deleting an event', () => {
  it('takes its reminders with it', async () => {
    const owner = await register('event-cascade');

    const event = await request(app)
      .post('/api/v1/events')
      .set('Authorization', owner)
      .send({
        title: 'Cancelled meeting',
        startTime: '2001-12-30T09:00:00.000Z',
        endTime: '2001-12-30T10:00:00.000Z',
      })
      .expect(201);

    const reminder = await request(app)
      .post('/api/v1/reminders')
      .set('Authorization', owner)
      .send({ entityType: 'event', entityId: event.body.data.id, remindAt: FUTURE })
      .expect(201);

    await request(app)
      .delete(`/api/v1/events/${event.body.data.id}`)
      .set('Authorization', owner)
      .expect(204);

    // ON DELETE CASCADE, written out by hand, because the reminders table cannot
    // declare a foreign key whose target table varies per row.
    await request(app)
      .get(`/api/v1/reminders/${reminder.body.data.id}`)
      .set('Authorization', owner)
      .expect(404);
  });

  it('leaves reminders for other entities alone', async () => {
    const owner = await register('cascade-scope');

    const task = await request(app)
      .post('/api/v1/tasks')
      .set('Authorization', owner)
      .send({ title: 'Survives' })
      .expect(201);

    const keeper = await request(app)
      .post('/api/v1/reminders')
      .set('Authorization', owner)
      .send({ entityType: 'task', entityId: task.body.data.id, remindAt: FUTURE })
      .expect(201);

    const event = await request(app)
      .post('/api/v1/events')
      .set('Authorization', owner)
      .send({
        title: 'Unrelated',
        startTime: '2001-12-31T09:00:00.000Z',
        endTime: '2001-12-31T10:00:00.000Z',
      })
      .expect(201);

    await request(app)
      .delete(`/api/v1/events/${event.body.data.id}`)
      .set('Authorization', owner)
      .expect(204);

    await request(app)
      .get(`/api/v1/reminders/${keeper.body.data.id}`)
      .set('Authorization', owner)
      .expect(200);
  });

  it('is 404 for an event that does not exist', async () => {
    const owner = await register('cascade-missing');
    await request(app)
      .delete(`/api/v1/events/${ABSENT_ID}`)
      .set('Authorization', owner)
      .expect(404);
  });
});
