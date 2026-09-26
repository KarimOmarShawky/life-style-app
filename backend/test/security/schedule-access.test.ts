/**
 * Access-control tests for events and reminders (spec sections 41 and 43).
 *
 * This slice adds an attack surface the rest of the API does not have: a
 * reference whose TARGET TABLE is chosen by a value in the request. Two things
 * follow, and both are attacked here.
 *
 *   THE TYPE AND THE ID MUST BE CHECKED TOGETHER. Validating "is this a real
 *   entity type" and "is this one of my ids" as separate questions passes both
 *   for `{entityType: 'habit', entityId: <my task's id>}`, and for the same
 *   shape with someone else's id. The check has to be one query against the
 *   table the type names, scoped to the caller.
 *
 *   A FAILED DELETE MUST NOT CASCADE. Deleting an event deletes its reminders in
 *   the same transaction. An attacker deleting an event that is not theirs gets
 *   a 404 — the interesting question is whether the reminders were already gone
 *   by the time the ownership check answered.
 *
 * Every id used in an attack below exists and belongs to the victim. A test
 * using a random UUID would pass without proving anything.
 */
import request from 'supertest';
import { beforeAll, describe, expect, it } from 'vitest';
import type { Express } from 'express';

import { createApp } from '@/app';

import { STRONG_PASSWORD, testEmail } from '../setup';

let app: Express;
let victim: string;
let attacker: string;

let victimTask: string;
let victimHabit: string;
let victimEvent: string;
let victimReminder: string;
let attackerTask: string;

/** Real, well-formed, and belonging to nobody. */
const ABSENT_ID = '00000000-0000-4000-8000-000000000000';

const FUTURE = '2099-06-01T08:00:00.000Z';

async function tokenFor(label: string): Promise<string> {
  const response = await request(app)
    .post('/api/v1/auth/register')
    .send({ email: testEmail(label), password: STRONG_PASSWORD })
    .expect(201);
  return `Bearer ${response.body.data.tokens.accessToken}`;
}

beforeAll(async () => {
  app = createApp();
  victim = await tokenFor('schedule-victim');
  attacker = await tokenFor('schedule-attacker');

  const task = await request(app)
    .post('/api/v1/tasks')
    .set('Authorization', victim)
    .send({ title: 'Confidential deliverable' })
    .expect(201);
  victimTask = task.body.data.id;

  const habit = await request(app)
    .post('/api/v1/habits')
    .set('Authorization', victim)
    .send({ title: 'Therapy' })
    .expect(201);
  victimHabit = habit.body.data.id;

  const event = await request(app)
    .post('/api/v1/events')
    .set('Authorization', victim)
    .send({
      title: 'Private appointment',
      startTime: '2001-05-15T09:00:00.000Z',
      endTime: '2001-05-15T10:00:00.000Z',
      linkedType: 'task',
      linkedId: victimTask,
    })
    .expect(201);
  victimEvent = event.body.data.id;

  // Two more, so the victim's own listing actually issues a cursor. With a
  // single row `nextCursor` is null and the forged-cursor test would pass
  // without ever sending one.
  for (const day of ['16', '17']) {
    await request(app)
      .post('/api/v1/events')
      .set('Authorization', victim)
      .send({
        title: `Padding ${day}`,
        startTime: `2001-05-${day}T09:00:00.000Z`,
        endTime: `2001-05-${day}T10:00:00.000Z`,
      })
      .expect(201);
  }

  const reminder = await request(app)
    .post('/api/v1/reminders')
    .set('Authorization', victim)
    .send({ entityType: 'event', entityId: victimEvent, remindAt: FUTURE })
    .expect(201);
  victimReminder = reminder.body.data.id;

  const ownTask = await request(app)
    .post('/api/v1/tasks')
    .set('Authorization', attacker)
    .send({ title: 'Attacker task' })
    .expect(201);
  attackerTask = ownTask.body.data.id;
});

describe('events belonging to another user', () => {
  it('cannot be read', async () => {
    await request(app)
      .get(`/api/v1/events/${victimEvent}`)
      .set('Authorization', attacker)
      .expect(404);
  });

  it('cannot be updated', async () => {
    await request(app)
      .patch(`/api/v1/events/${victimEvent}`)
      .set('Authorization', attacker)
      .send({ title: 'Owned' })
      .expect(404);
  });

  it('cannot be deleted', async () => {
    await request(app)
      .delete(`/api/v1/events/${victimEvent}`)
      .set('Authorization', attacker)
      .expect(404);
  });

  it('survives the attempt intact', async () => {
    const response = await request(app)
      .get(`/api/v1/events/${victimEvent}`)
      .set('Authorization', victim)
      .expect(200);

    expect(response.body.data.title).toBe('Private appointment');
  });

  it('keeps its reminders after a failed delete', async () => {
    // The delete and the reminder cleanup share a transaction. If the cleanup
    // ran before the ownership check answered, the victim's reminder would be
    // gone and the attacker would still have got their 404.
    await request(app)
      .get(`/api/v1/reminders/${victimReminder}`)
      .set('Authorization', victim)
      .expect(200);
  });

  it('is indistinguishable from an id that never existed', async () => {
    const other = await request(app)
      .get(`/api/v1/events/${victimEvent}`)
      .set('Authorization', attacker)
      .expect(404);

    const absent = await request(app)
      .get(`/api/v1/events/${ABSENT_ID}`)
      .set('Authorization', attacker)
      .expect(404);

    expect(other.body.error.code).toBe(absent.body.error.code);
    expect(other.body.error.message).toBe(absent.body.error.message);
  });

  it('never appears in the attacker list', async () => {
    const response = await request(app)
      .get('/api/v1/events?limit=100')
      .set('Authorization', attacker)
      .expect(200);

    const ids = response.body.data.map((event: { id: string }) => event.id);
    expect(ids).not.toContain(victimEvent);
  });

  it('never appears in a window drawn tightly around it', async () => {
    const response = await request(app)
      .get('/api/v1/events?from=2001-05-15T00:00:00.000Z&to=2001-05-15T23:59:59.999Z&limit=100')
      .set('Authorization', attacker)
      .expect(200);

    expect(response.body.data).toEqual([]);
  });

  it('cannot be reached with a cursor issued to its owner', async () => {
    // A cursor is base64, not a signature, and the client can forge one. That is
    // safe only because the owner filter is applied separately and is not part
    // of the cursor. This test is what proves the "separately" part.
    const owners = await request(app)
      .get('/api/v1/events?limit=1')
      .set('Authorization', victim)
      .expect(200);

    const cursor = owners.body.pagination.nextCursor;
    expect(cursor).not.toBeNull();

    const response = await request(app)
      .get(`/api/v1/events?limit=100&cursor=${encodeURIComponent(cursor)}`)
      .set('Authorization', attacker)
      .expect(200);

    const ids = response.body.data.map((event: { id: string }) => event.id);
    expect(ids).not.toContain(victimEvent);
  });
});

describe('reminders belonging to another user', () => {
  it('cannot be read', async () => {
    await request(app)
      .get(`/api/v1/reminders/${victimReminder}`)
      .set('Authorization', attacker)
      .expect(404);
  });

  it('cannot be updated', async () => {
    await request(app)
      .patch(`/api/v1/reminders/${victimReminder}`)
      .set('Authorization', attacker)
      .send({ remindAt: '2001-01-01T00:00:00.000Z' })
      .expect(404);
  });

  it('cannot be acknowledged', async () => {
    await request(app)
      .post(`/api/v1/reminders/${victimReminder}/acknowledge`)
      .set('Authorization', attacker)
      .expect(404);
  });

  it('cannot be dismissed', async () => {
    // Dismissal is unconditional for the owner, which makes the `user_id`
    // predicate the only thing standing between an attacker and silencing
    // someone else's notifications.
    await request(app)
      .post(`/api/v1/reminders/${victimReminder}/dismiss`)
      .set('Authorization', attacker)
      .expect(404);
  });

  it('cannot be snoozed', async () => {
    await request(app)
      .post(`/api/v1/reminders/${victimReminder}/snooze`)
      .set('Authorization', attacker)
      .send({ minutes: 10080 })
      .expect(404);
  });

  it('cannot be deleted', async () => {
    await request(app)
      .delete(`/api/v1/reminders/${victimReminder}`)
      .set('Authorization', attacker)
      .expect(404);
  });

  it('is still pending and unchanged after all of that', async () => {
    const response = await request(app)
      .get(`/api/v1/reminders/${victimReminder}`)
      .set('Authorization', victim)
      .expect(200);

    expect(response.body.data.status).toBe('pending');
    expect(response.body.data.remindAt).toBe(FUTURE);
    expect(response.body.data.sentAt).toBeNull();
  });

  it('never appears in the attacker list or due queue', async () => {
    const list = await request(app)
      .get('/api/v1/reminders?limit=100')
      .set('Authorization', attacker)
      .expect(200);
    expect(list.body.data.map((r: { id: string }) => r.id)).not.toContain(victimReminder);

    const due = await request(app)
      .get('/api/v1/reminders/due?limit=100')
      .set('Authorization', attacker)
      .expect(200);
    expect(due.body.data.map((r: { id: string }) => r.id)).not.toContain(victimReminder);
  });

  it('cannot be found by filtering for the entity it points at', async () => {
    const response = await request(app)
      .get(`/api/v1/reminders?entityId=${victimEvent}&limit=100`)
      .set('Authorization', attacker)
      .expect(200);

    expect(response.body.data).toEqual([]);
  });
});

describe('the polymorphic reference', () => {
  it("refuses an event linked to another user's task", async () => {
    const response = await request(app)
      .post('/api/v1/events')
      .set('Authorization', attacker)
      .send({
        title: 'Borrowed',
        startTime: '2001-05-20T09:00:00.000Z',
        endTime: '2001-05-20T10:00:00.000Z',
        linkedType: 'task',
        linkedId: victimTask,
      })
      .expect(422);

    expect(response.body.error.issues[0].field).toBe('linkedId');
  });

  it("refuses a patch that links an existing event to another user's habit", async () => {
    const own = await request(app)
      .post('/api/v1/events')
      .set('Authorization', attacker)
      .send({
        title: 'Own event',
        startTime: '2001-05-21T09:00:00.000Z',
        endTime: '2001-05-21T10:00:00.000Z',
      })
      .expect(201);

    await request(app)
      .patch(`/api/v1/events/${own.body.data.id}`)
      .set('Authorization', attacker)
      .send({ linkedType: 'habit', linkedId: victimHabit })
      .expect(422);
  });

  it("refuses a reminder for another user's task", async () => {
    await request(app)
      .post('/api/v1/reminders')
      .set('Authorization', attacker)
      .send({ entityType: 'task', entityId: victimTask, remindAt: FUTURE })
      .expect(422);
  });

  it("refuses a reminder for another user's event", async () => {
    await request(app)
      .post('/api/v1/reminders')
      .set('Authorization', attacker)
      .send({ entityType: 'event', entityId: victimEvent, remindAt: FUTURE })
      .expect(422);
  });

  it("refuses a reminder for another user's subscription", async () => {
    const subscription = await request(app)
      .post('/api/v1/subscriptions')
      .set('Authorization', victim)
      .send({ name: 'Private service', amount: '99.00', renewalDate: '2001-05-15' })
      .expect(201);

    await request(app)
      .post('/api/v1/reminders')
      .set('Authorization', attacker)
      .send({ entityType: 'subscription', entityId: subscription.body.data.id, remindAt: FUTURE })
      .expect(422);
  });

  it('refuses a type that does not match the id, even when both are the attacker own', async () => {
    // The attacker's own task id, presented as a habit. Checking "is this a
    // valid type" and "is this one of my ids" as separate questions would let
    // this through and resolve a title from the wrong table.
    await request(app)
      .post('/api/v1/reminders')
      .set('Authorization', attacker)
      .send({ entityType: 'habit', entityId: attackerTask, remindAt: FUTURE })
      .expect(422);
  });

  it('reports a missing target and a foreign one with the same message', async () => {
    const foreign = await request(app)
      .post('/api/v1/reminders')
      .set('Authorization', attacker)
      .send({ entityType: 'task', entityId: victimTask, remindAt: FUTURE })
      .expect(422);

    const absent = await request(app)
      .post('/api/v1/reminders')
      .set('Authorization', attacker)
      .send({ entityType: 'task', entityId: ABSENT_ID, remindAt: FUTURE })
      .expect(422);

    // Any difference here is an oracle: it turns this endpoint into a way to ask
    // "does this id exist for somebody?" one id at a time.
    expect(foreign.body.error.issues).toEqual(absent.body.error.issues);
  });

  it("does not leak another user's title through a link that resolves", async () => {
    const response = await request(app)
      .get('/api/v1/events?limit=100')
      .set('Authorization', attacker)
      .expect(200);

    const titles = response.body.data.map((event: { linkedTitle: string | null }) => event.linkedTitle);
    expect(titles).not.toContain('Confidential deliverable');
  });
});

describe('injection and mass assignment', () => {
  it('refuses an owner supplied in the body of a create', async () => {
    await request(app)
      .post('/api/v1/events')
      .set('Authorization', attacker)
      .send({
        title: 'x',
        startTime: '2001-05-22T09:00:00.000Z',
        endTime: '2001-05-22T10:00:00.000Z',
        userId: 'someone-else',
      })
      .expect(422);
  });

  it('refuses an id supplied in the body', async () => {
    await request(app)
      .post('/api/v1/reminders')
      .set('Authorization', attacker)
      .send({ id: ABSENT_ID, entityType: 'task', entityId: attackerTask, remindAt: FUTURE })
      .expect(422);
  });

  it('refuses a status written directly', async () => {
    // Status moves through the action routes, which set `sent_at` with it. A
    // client able to write `sent` on its own would violate the CHECK that ties
    // the two together, and would do it as a 500.
    await request(app)
      .post('/api/v1/reminders')
      .set('Authorization', attacker)
      .send({ entityType: 'task', entityId: attackerTask, remindAt: FUTURE, status: 'sent' })
      .expect(422);
  });

  it('refuses delivery bookkeeping written directly', async () => {
    await request(app)
      .post('/api/v1/reminders')
      .set('Authorization', attacker)
      .send({ entityType: 'task', entityId: attackerTask, remindAt: FUTURE, attempts: -5 })
      .expect(422);
  });

  it('treats SQL metacharacters in a status filter as invalid rather than as SQL', async () => {
    await request(app)
      .get("/api/v1/reminders?status=pending' OR '1'='1")
      .set('Authorization', attacker)
      .expect(422);
  });

  it('treats SQL metacharacters in an entity id as invalid rather than as SQL', async () => {
    await request(app)
      .get("/api/v1/reminders?entityId=' OR 1=1 --")
      .set('Authorization', attacker)
      .expect(422);
  });

  it('refuses a window boundary that is not a date-time', async () => {
    await request(app)
      .get("/api/v1/events?from=2001-05-15' OR '1'='1")
      .set('Authorization', attacker)
      .expect(422);
  });

  it('refuses a link type outside the allowed set', async () => {
    await request(app)
      .post('/api/v1/events')
      .set('Authorization', attacker)
      .send({
        title: 'x',
        startTime: '2001-05-23T09:00:00.000Z',
        endTime: '2001-05-23T10:00:00.000Z',
        linkedType: 'users',
        linkedId: ABSENT_ID,
      })
      .expect(422);
  });

  it('leaves the victim data intact after all of that', async () => {
    const event = await request(app)
      .get(`/api/v1/events/${victimEvent}`)
      .set('Authorization', victim)
      .expect(200);
    expect(event.body.data.linkedTitle).toBe('Confidential deliverable');

    const reminder = await request(app)
      .get(`/api/v1/reminders/${victimReminder}`)
      .set('Authorization', victim)
      .expect(200);
    expect(reminder.body.data.status).toBe('pending');
  });
});

describe('unauthenticated access', () => {
  const routes: [string, string][] = [
    ['get', '/api/v1/events'],
    ['post', '/api/v1/events'],
    ['get', '/api/v1/reminders'],
    ['get', '/api/v1/reminders/due'],
    ['post', '/api/v1/reminders'],
  ];

  it.each(routes)('is refused on %s %s', async (method, path) => {
    const response = await (method === 'get'
      ? request(app).get(path)
      : request(app).post(path).send({}));

    expect(response.status).toBe(401);
  });

  it.each(['acknowledge', 'dismiss', 'snooze'])('is refused on the %s action', async (action) => {
    const response = await request(app)
      .post(`/api/v1/reminders/${ABSENT_ID}/${action}`)
      .send({});

    // 401 rather than 404: authentication runs at the router level, before any
    // handler can reveal whether the id exists.
    expect(response.status).toBe(401);
  });

  it('is refused with a forged token', async () => {
    await request(app)
      .get('/api/v1/events')
      .set('Authorization', 'Bearer not.a.token')
      .expect(401);
  });
});
