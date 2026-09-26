/**
 * Resource-level security tests for habits and goals (spec sections 16, 41, 57).
 *
 * Same scenario as the other access-control suites: Mallory is a fully
 * authenticated, legitimate user who asks for Alice's identifiers.
 *
 * These two features add reference paths the earlier ones did not have. A habit
 * log is written through an INSERT ... SELECT, and a milestone can point at a
 * task. Both are places where an ownership check could be dropped without any
 * visible symptom, so both are attacked directly here.
 */
import request from 'supertest';
import { beforeAll, describe, expect, it } from 'vitest';
import type { Express } from 'express';

import { createApp } from '@/app';

import { STRONG_PASSWORD, testEmail } from '../setup';

let app: Express;
let alice: string;
let mallory: string;

let aliceHabitId: string;
let aliceGoalId: string;
let aliceMilestoneId: string;
let aliceTaskId: string;

/** A well-formed UUID that has never been issued. */
const INVENTED_ID = '3f2504e0-4f89-11d3-9a0c-0305e82c3301';

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

async function tokenFor(label: string): Promise<string> {
  const response = await request(app)
    .post('/api/v1/auth/register')
    .send({ email: testEmail(label), password: STRONG_PASSWORD })
    .expect(201);
  return `Bearer ${response.body.data.tokens.accessToken}`;
}

beforeAll(async () => {
  app = createApp();
  alice = await tokenFor('hg-idor-alice');
  mallory = await tokenFor('hg-idor-mallory');

  const habit = await request(app)
    .post('/api/v1/habits')
    .set('Authorization', alice)
    .send({ title: 'Alice private habit' })
    .expect(201);
  aliceHabitId = habit.body.data.id;

  await request(app)
    .post(`/api/v1/habits/${aliceHabitId}/logs`)
    .set('Authorization', alice)
    .send({})
    .expect(200);

  const task = await request(app)
    .post('/api/v1/tasks')
    .set('Authorization', alice)
    .send({ title: 'Alice private task' })
    .expect(201);
  aliceTaskId = task.body.data.id;

  const goal = await request(app)
    .post('/api/v1/goals')
    .set('Authorization', alice)
    .send({ title: 'Alice private goal' })
    .expect(201);
  aliceGoalId = goal.body.data.id;

  const milestone = await request(app)
    .post(`/api/v1/goals/${aliceGoalId}/milestones`)
    .set('Authorization', alice)
    .send({ title: 'Alice milestone' })
    .expect(201);
  aliceMilestoneId = milestone.body.data.id;
});

describe('habit access control', () => {
  it('hides another user habit from every verb', async () => {
    await request(app)
      .get(`/api/v1/habits/${aliceHabitId}`)
      .set('Authorization', mallory)
      .expect(404);

    await request(app)
      .patch(`/api/v1/habits/${aliceHabitId}`)
      .set('Authorization', mallory)
      .send({ title: 'Mine now' })
      .expect(404);

    await request(app)
      .delete(`/api/v1/habits/${aliceHabitId}`)
      .set('Authorization', mallory)
      .expect(404);
  });

  it('refuses to log a day against another user habit', async () => {
    // The write is an INSERT ... SELECT whose SELECT carries the owner filter.
    // If that filter were dropped, this would silently succeed.
    await request(app)
      .post(`/api/v1/habits/${aliceHabitId}/logs`)
      .set('Authorization', mallory)
      .send({})
      .expect(404);
  });

  it('refuses to delete an entry from another user habit', async () => {
    await request(app)
      .delete(`/api/v1/habits/${aliceHabitId}/logs/${today()}`)
      .set('Authorization', mallory)
      .expect(404);
  });

  it('refuses to read another user habit history', async () => {
    await request(app)
      .get(`/api/v1/habits/${aliceHabitId}/logs`)
      .set('Authorization', mallory)
      .expect(404);
  });

  it('leaves the victim history untouched after every attempt', async () => {
    const response = await request(app)
      .get(`/api/v1/habits/${aliceHabitId}`)
      .set('Authorization', alice)
      .expect(200);

    expect(response.body.data.totalCompletions).toBe(1);
    expect(response.body.data.title).toBe('Alice private habit');
  });

  it('answers identically for a real foreign id and an invented one', async () => {
    const foreign = await request(app)
      .get(`/api/v1/habits/${aliceHabitId}`)
      .set('Authorization', mallory)
      .expect(404);

    const invented = await request(app)
      .get(`/api/v1/habits/${INVENTED_ID}`)
      .set('Authorization', mallory)
      .expect(404);

    expect(foreign.body.error.code).toBe(invented.body.error.code);
    expect(foreign.body.error.message).toBe(invented.body.error.message);
  });

  it('leaks no habit content in the refusal', async () => {
    const response = await request(app)
      .get(`/api/v1/habits/${aliceHabitId}`)
      .set('Authorization', mallory)
      .expect(404);

    expect(JSON.stringify(response.body)).not.toContain('Alice private habit');
  });

  it('does not list another user habits', async () => {
    const response = await request(app)
      .get('/api/v1/habits')
      .set('Authorization', mallory)
      .expect(200);

    expect(response.body.data).toEqual([]);
  });
});

describe('goal and milestone access control', () => {
  it('hides another user goal from every verb', async () => {
    await request(app)
      .get(`/api/v1/goals/${aliceGoalId}`)
      .set('Authorization', mallory)
      .expect(404);

    await request(app)
      .patch(`/api/v1/goals/${aliceGoalId}`)
      .set('Authorization', mallory)
      .send({ title: 'Mine now' })
      .expect(404);

    await request(app)
      .delete(`/api/v1/goals/${aliceGoalId}`)
      .set('Authorization', mallory)
      .expect(404);
  });

  it('refuses to add a milestone to another user goal', async () => {
    await request(app)
      .post(`/api/v1/goals/${aliceGoalId}/milestones`)
      .set('Authorization', mallory)
      .send({ title: 'Injected' })
      .expect(404);
  });

  it('refuses to change or delete another user milestone', async () => {
    await request(app)
      .patch(`/api/v1/goals/${aliceGoalId}/milestones/${aliceMilestoneId}`)
      .set('Authorization', mallory)
      .send({ isDone: true })
      .expect(404);

    await request(app)
      .delete(`/api/v1/goals/${aliceGoalId}/milestones/${aliceMilestoneId}`)
      .set('Authorization', mallory)
      .expect(404);
  });

  it('refuses to reach a milestone through a goal the caller does own', async () => {
    // The nested path is not a shortcut: the milestone must belong to THIS goal
    // and to this caller, not merely exist.
    const ownGoal = await request(app)
      .post('/api/v1/goals')
      .set('Authorization', mallory)
      .send({ title: 'Mallory own goal' })
      .expect(201);

    await request(app)
      .patch(`/api/v1/goals/${ownGoal.body.data.id}/milestones/${aliceMilestoneId}`)
      .set('Authorization', mallory)
      .send({ isDone: true })
      .expect(404);
  });

  it('refuses to back a milestone with another user task', async () => {
    const ownGoal = await request(app)
      .post('/api/v1/goals')
      .set('Authorization', mallory)
      .send({ title: 'Mallory goal' })
      .expect(201);

    await request(app)
      .post(`/api/v1/goals/${ownGoal.body.data.id}/milestones`)
      .set('Authorization', mallory)
      .send({ title: 'Steal progress', taskId: aliceTaskId })
      .expect(422);
  });

  it('answers identically for a foreign task and a nonexistent one', async () => {
    const ownGoal = await request(app)
      .post('/api/v1/goals')
      .set('Authorization', mallory)
      .send({ title: 'Probe goal' })
      .expect(201);

    const foreign = await request(app)
      .post(`/api/v1/goals/${ownGoal.body.data.id}/milestones`)
      .set('Authorization', mallory)
      .send({ title: 'Probe', taskId: aliceTaskId })
      .expect(422);

    const invented = await request(app)
      .post(`/api/v1/goals/${ownGoal.body.data.id}/milestones`)
      .set('Authorization', mallory)
      .send({ title: 'Probe', taskId: INVENTED_ID })
      .expect(422);

    expect(JSON.stringify(foreign.body.error.issues)).toBe(
      JSON.stringify(invented.body.error.issues),
    );
  });

  it('leaves the victim goal intact after every attempt', async () => {
    const response = await request(app)
      .get(`/api/v1/goals/${aliceGoalId}`)
      .set('Authorization', alice)
      .expect(200);

    expect(response.body.data.title).toBe('Alice private goal');
    expect(response.body.data.milestoneCount).toBe(1);
    expect(response.body.data.doneMilestoneCount).toBe(0);
  });

  it('does not list another user goals', async () => {
    const response = await request(app)
      .get('/api/v1/goals')
      .set('Authorization', mallory)
      .expect(200);

    expect(
      response.body.data.every((goal: { title: string }) => goal.title !== 'Alice private goal'),
    ).toBe(true);
  });
});

describe('mass assignment and malformed input', () => {
  it('refuses an owner id supplied in a habit body', async () => {
    await request(app)
      .post('/api/v1/habits')
      .set('Authorization', mallory)
      .send({ title: 'Injected', userId: INVENTED_ID })
      .expect(422);
  });

  it('refuses computed habit fields supplied by a client', async () => {
    // Streaks are derived. Accepting them would let a client write a number the
    // logs do not support.
    await request(app)
      .post('/api/v1/habits')
      .set('Authorization', mallory)
      .send({ title: 'Fake streak', currentStreak: 999 })
      .expect(422);
  });

  it('refuses computed goal fields supplied by a client', async () => {
    await request(app)
      .post('/api/v1/goals')
      .set('Authorization', mallory)
      .send({ title: 'Fake progress', progressPercent: 100 })
      .expect(422);
  });

  it('rejects a malformed date in the log path', async () => {
    const own = await request(app)
      .post('/api/v1/habits')
      .set('Authorization', mallory)
      .send({ title: 'Date shapes' })
      .expect(201);

    await request(app)
      .delete(`/api/v1/habits/${own.body.data.id}/logs/not-a-date`)
      .set('Authorization', mallory)
      .expect(422);

    await request(app)
      .delete(`/api/v1/habits/${own.body.data.id}/logs/2026-13-45`)
      .set('Authorization', mallory)
      .expect(422);
  });

  it('rejects an unknown query parameter instead of ignoring it', async () => {
    await request(app).get('/api/v1/habits?colour=red').set('Authorization', mallory).expect(422);
    await request(app).get('/api/v1/goals?colour=red').set('Authorization', mallory).expect(422);
  });
});

describe('authentication', () => {
  it('requires a token on every habit and goal route', async () => {
    await request(app).get('/api/v1/habits').expect(401);
    await request(app).post('/api/v1/habits').send({ title: 'x' }).expect(401);
    await request(app).get(`/api/v1/habits/${aliceHabitId}`).expect(401);
    await request(app).post(`/api/v1/habits/${aliceHabitId}/logs`).send({}).expect(401);
    await request(app).get(`/api/v1/habits/${aliceHabitId}/logs`).expect(401);
    await request(app).delete(`/api/v1/habits/${aliceHabitId}/logs/${today()}`).expect(401);
    await request(app).get('/api/v1/goals').expect(401);
    await request(app).post('/api/v1/goals').send({ title: 'x' }).expect(401);
    await request(app).get(`/api/v1/goals/${aliceGoalId}`).expect(401);
    await request(app)
      .post(`/api/v1/goals/${aliceGoalId}/milestones`)
      .send({ title: 'x' })
      .expect(401);
    await request(app)
      .patch(`/api/v1/goals/${aliceGoalId}/milestones/${aliceMilestoneId}`)
      .send({ title: 'x' })
      .expect(401);
  });
});
