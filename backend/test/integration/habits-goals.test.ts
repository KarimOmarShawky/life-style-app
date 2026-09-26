/**
 * Integration tests for habits, streaks, goals and milestones (spec section 41).
 *
 * Driven through the real Express app against the real database, so the CHECK
 * constraints, the unique index on (habit_id, log_date) and the streak SQL are
 * exercised rather than mocked away.
 *
 * The streak tests are the reason this file matters. A streak is computed in one
 * statement using gaps and islands, and the only way to know that statement is
 * right is to feed it real gaps.
 */
import request from 'supertest';
import { beforeAll, describe, expect, it } from 'vitest';
import type { Express } from 'express';

import { createApp } from '@/app';

import { STRONG_PASSWORD, testEmail } from '../setup';

let app: Express;
let auth: string;

interface Envelope<T> {
  success: boolean;
  data: T;
  pagination?: { nextCursor: string | null; hasMore: boolean };
}

interface Habit {
  id: string;
  title: string;
  frequency: string;
  isArchived: boolean;
  currentStreak: number | null;
  longestStreak: number | null;
  totalCompletions: number;
  lastCompletedDate: string | null;
  isCompletedForCurrentPeriod: boolean;
}

interface Milestone {
  id: string;
  goalId: string;
  taskId: string | null;
  title: string;
  isDone: boolean;
  position: number;
}

interface Goal {
  id: string;
  title: string;
  targetDate: string | null;
  status: string;
  milestoneCount: number;
  doneMilestoneCount: number;
  progressPercent: number | null;
  isOverdue: boolean;
  milestones?: Milestone[];
}

/** A calendar date `offset` days from today, in UTC, as YYYY-MM-DD. */
function dayOffset(offset: number): string {
  const date = new Date();
  date.setUTCDate(date.getUTCDate() + offset);
  return date.toISOString().slice(0, 10);
}

const TODAY = dayOffset(0);

async function tokenFor(label: string): Promise<string> {
  const response = await request(app)
    .post('/api/v1/auth/register')
    .send({ email: testEmail(label), password: STRONG_PASSWORD })
    .expect(201);
  return `Bearer ${response.body.data.tokens.accessToken}`;
}

async function createHabit(header: string, body: Record<string, unknown>): Promise<Habit> {
  const response = await request(app)
    .post('/api/v1/habits')
    .set('Authorization', header)
    .send(body)
    .expect(201);
  return (response.body as Envelope<Habit>).data;
}

/** Marks the given day offsets complete, oldest first. */
async function logDays(header: string, habitId: string, offsets: number[]): Promise<void> {
  for (const offset of offsets) {
    await request(app)
      .post(`/api/v1/habits/${habitId}/logs`)
      .set('Authorization', header)
      .send({ date: dayOffset(offset) })
      .expect(200);
  }
}

async function readHabit(header: string, habitId: string): Promise<Habit> {
  const response = await request(app)
    .get(`/api/v1/habits/${habitId}?asOf=${TODAY}`)
    .set('Authorization', header)
    .expect(200);
  return (response.body as Envelope<Habit>).data;
}

async function createGoal(header: string, body: Record<string, unknown>): Promise<Goal> {
  const response = await request(app)
    .post('/api/v1/goals')
    .set('Authorization', header)
    .send(body)
    .expect(201);
  return (response.body as Envelope<Goal>).data;
}

async function readGoal(header: string, goalId: string): Promise<Goal> {
  const response = await request(app)
    .get(`/api/v1/goals/${goalId}`)
    .set('Authorization', header)
    .expect(200);
  return (response.body as Envelope<Goal>).data;
}

beforeAll(async () => {
  app = createApp();
  auth = await tokenFor('habits-goals');
});

describe('habits', () => {
  it('creates a habit that defaults to daily with no history', async () => {
    const habit = await createHabit(auth, { title: 'Read' });

    expect(habit.frequency).toBe('daily');
    expect(habit.currentStreak).toBe(0);
    expect(habit.longestStreak).toBe(0);
    expect(habit.totalCompletions).toBe(0);
    expect(habit.lastCompletedDate).toBeNull();
    expect(habit.isCompletedForCurrentPeriod).toBe(false);
  });

  it('rejects a frequency the database would refuse', async () => {
    await request(app)
      .post('/api/v1/habits')
      .set('Authorization', auth)
      .send({ title: 'x', frequency: 'hourly' })
      .expect(422);
  });

  it('never exposes the owner id', async () => {
    const habit = await createHabit(auth, { title: 'No owner' });
    expect(habit).not.toHaveProperty('userId');
  });
});

describe('streaks', () => {
  it('counts an unbroken run ending today', async () => {
    const habit = await createHabit(auth, { title: 'Five in a row' });
    await logDays(auth, habit.id, [-4, -3, -2, -1, 0]);

    const updated = await readHabit(auth, habit.id);
    expect(updated.currentStreak).toBe(5);
    expect(updated.longestStreak).toBe(5);
    expect(updated.totalCompletions).toBe(5);
    expect(updated.isCompletedForCurrentPeriod).toBe(true);
    expect(updated.lastCompletedDate).toBe(TODAY);
  });

  it('keeps the streak alive when yesterday is done but today is not', async () => {
    // Without this tolerance every streak would read as zero each morning.
    const habit = await createHabit(auth, { title: 'Up to yesterday' });
    await logDays(auth, habit.id, [-2, -1]);

    const updated = await readHabit(auth, habit.id);
    expect(updated.currentStreak).toBe(2);
    expect(updated.isCompletedForCurrentPeriod).toBe(false);
  });

  it('breaks the streak once two periods have passed', async () => {
    const habit = await createHabit(auth, { title: 'Stale' });
    await logDays(auth, habit.id, [-6, -5, -4]);

    const updated = await readHabit(auth, habit.id);
    expect(updated.currentStreak).toBe(0);
    expect(updated.longestStreak).toBe(3);
  });

  it('remembers the longest run after a gap', async () => {
    const habit = await createHabit(auth, { title: 'Gapped' });
    await logDays(auth, habit.id, [-20, -19, -18, -17, -1, 0]);

    const updated = await readHabit(auth, habit.id);
    expect(updated.currentStreak).toBe(2);
    expect(updated.longestStreak).toBe(4);
  });

  it('does not count a day logged as not completed', async () => {
    const habit = await createHabit(auth, { title: 'Missed one' });
    await logDays(auth, habit.id, [-3, -2, -1, 0]);

    await request(app)
      .post(`/api/v1/habits/${habit.id}/logs`)
      .set('Authorization', auth)
      .send({ date: dayOffset(-2), completed: false })
      .expect(200);

    const updated = await readHabit(auth, habit.id);
    // -3 alone, then -1 and 0. The middle day broke it.
    expect(updated.currentStreak).toBe(2);
    expect(updated.longestStreak).toBe(2);
    expect(updated.totalCompletions).toBe(3);
  });

  it('counts weeks rather than days for a weekly habit', async () => {
    const habit = await createHabit(auth, { title: 'Weekly', frequency: 'weekly' });
    // Two logs in the same week must count as one completed week.
    await logDays(auth, habit.id, [-14, -13, -7, 0]);

    const updated = await readHabit(auth, habit.id);
    expect(updated.currentStreak).toBe(3);
    expect(updated.longestStreak).toBe(3);
    expect(updated.totalCompletions).toBe(4);
  });

  it('reports no streak for a custom habit', async () => {
    // 'custom' has no fixed period, so "consecutive" has nothing to mean. Null
    // says that; zero would claim the streak is broken.
    const habit = await createHabit(auth, { title: 'Custom', frequency: 'custom' });
    await logDays(auth, habit.id, [-1, 0]);

    const updated = await readHabit(auth, habit.id);
    expect(updated.currentStreak).toBeNull();
    expect(updated.longestStreak).toBeNull();
    expect(updated.totalCompletions).toBe(2);
  });

  it('computes streaks for a whole page in one request', async () => {
    const header = await tokenFor('habits-page');
    const first = await createHabit(header, { title: 'One' });
    const second = await createHabit(header, { title: 'Two' });
    await logDays(header, first.id, [-1, 0]);
    await logDays(header, second.id, [0]);

    const response = await request(app)
      .get(`/api/v1/habits?asOf=${TODAY}`)
      .set('Authorization', header)
      .expect(200);

    const habits = (response.body as Envelope<Habit[]>).data;
    const byId = new Map(habits.map((habit) => [habit.id, habit]));
    expect(byId.get(first.id)?.currentStreak).toBe(2);
    expect(byId.get(second.id)?.currentStreak).toBe(1);
  });
});

describe('habit logs', () => {
  it('is idempotent: marking the same day twice creates one entry', async () => {
    const habit = await createHabit(auth, { title: 'Double tap' });

    await request(app)
      .post(`/api/v1/habits/${habit.id}/logs`)
      .set('Authorization', auth)
      .send({})
      .expect(200);

    const second = await request(app)
      .post(`/api/v1/habits/${habit.id}/logs`)
      .set('Authorization', auth)
      .send({})
      .expect(200);

    expect((second.body as Envelope<Habit>).data.totalCompletions).toBe(1);

    const logs = await request(app)
      .get(`/api/v1/habits/${habit.id}/logs`)
      .set('Authorization', auth)
      .expect(200);

    expect((logs.body as Envelope<unknown[]>).data).toHaveLength(1);
  });

  it('allows one day of future tolerance for a client ahead of UTC', async () => {
    // At 01:00 in UTC+14 the user's today is the server's tomorrow. Refusing it
    // would make the app unusable east of the date line for part of every day.
    const habit = await createHabit(auth, { title: 'Timezone' });

    await request(app)
      .post(`/api/v1/habits/${habit.id}/logs`)
      .set('Authorization', auth)
      .send({ date: dayOffset(1) })
      .expect(200);
  });

  it('refuses a date beyond any timezone', async () => {
    const habit = await createHabit(auth, { title: 'No time travel' });

    await request(app)
      .post(`/api/v1/habits/${habit.id}/logs`)
      .set('Authorization', auth)
      .send({ date: dayOffset(2) })
      .expect(422);

    await request(app)
      .post(`/api/v1/habits/${habit.id}/logs`)
      .set('Authorization', auth)
      .send({ date: dayOffset(400) })
      .expect(422);
  });

  it('cannot be tricked into the future by supplying the bound itself', async () => {
    // An earlier version measured "is this in the future" against a date the
    // same request supplied, so the check could never fail.
    const habit = await createHabit(auth, { title: 'Self-referential' });

    await request(app)
      .post(`/api/v1/habits/${habit.id}/logs`)
      .set('Authorization', auth)
      .send({ date: dayOffset(30) })
      .expect(422);

    const updated = await readHabit(auth, habit.id);
    expect(updated.totalCompletions).toBe(0);
  });

  it('distinguishes "not done" from "never said"', async () => {
    const habit = await createHabit(auth, { title: 'Two kinds of empty' });

    await request(app)
      .post(`/api/v1/habits/${habit.id}/logs`)
      .set('Authorization', auth)
      .send({ date: TODAY, completed: false })
      .expect(200);

    const withEntry = await request(app)
      .get(`/api/v1/habits/${habit.id}/logs`)
      .set('Authorization', auth)
      .expect(200);
    expect((withEntry.body as Envelope<unknown[]>).data).toHaveLength(1);

    await request(app)
      .delete(`/api/v1/habits/${habit.id}/logs/${TODAY}`)
      .set('Authorization', auth)
      .expect(200);

    const afterDelete = await request(app)
      .get(`/api/v1/habits/${habit.id}/logs`)
      .set('Authorization', auth)
      .expect(200);
    expect((afterDelete.body as Envelope<unknown[]>).data).toHaveLength(0);
  });

  it('returns 404 when deleting an entry that does not exist', async () => {
    const habit = await createHabit(auth, { title: 'Nothing to delete' });

    await request(app)
      .delete(`/api/v1/habits/${habit.id}/logs/${TODAY}`)
      .set('Authorization', auth)
      .expect(404);
  });

  it('filters logs by range', async () => {
    const habit = await createHabit(auth, { title: 'Ranged' });
    await logDays(auth, habit.id, [-10, -5, 0]);

    const response = await request(app)
      .get(`/api/v1/habits/${habit.id}/logs?from=${dayOffset(-6)}&to=${dayOffset(-1)}`)
      .set('Authorization', auth)
      .expect(200);

    expect((response.body as Envelope<unknown[]>).data).toHaveLength(1);
  });
});

describe('archiving habits', () => {
  it('keeps history and separates archived from live', async () => {
    const header = await tokenFor('habits-archive');
    const habit = await createHabit(header, { title: 'Archive me' });
    await logDays(header, habit.id, [-1, 0]);

    await request(app)
      .patch(`/api/v1/habits/${habit.id}`)
      .set('Authorization', header)
      .send({ isArchived: true })
      .expect(200);

    const live = await request(app).get('/api/v1/habits').set('Authorization', header).expect(200);
    expect((live.body as Envelope<Habit[]>).data).toHaveLength(0);

    const archived = await request(app)
      .get('/api/v1/habits?archived=true')
      .set('Authorization', header)
      .expect(200);

    const rows = (archived.body as Envelope<Habit[]>).data;
    expect(rows).toHaveLength(1);
    // Archiving is not deleting: the history is the point of having tracked it.
    expect(rows[0]?.totalCompletions).toBe(2);
  });

  it('removes the logs when the habit itself is deleted', async () => {
    const header = await tokenFor('habits-delete');
    const habit = await createHabit(header, { title: 'Delete me' });
    await logDays(header, habit.id, [0]);

    await request(app)
      .delete(`/api/v1/habits/${habit.id}`)
      .set('Authorization', header)
      .expect(204);

    await request(app).get(`/api/v1/habits/${habit.id}`).set('Authorization', header).expect(404);
  });
});

describe('goals', () => {
  it('reports null progress for a goal with no milestones', async () => {
    const goal = await createGoal(auth, { title: 'Nothing measured' });
    expect(goal.progressPercent).toBeNull();
    expect(goal.milestoneCount).toBe(0);
  });

  it('computes progress from its milestones', async () => {
    const goal = await createGoal(auth, { title: 'Three parts' });
    for (const title of ['One', 'Two', 'Three']) {
      await request(app)
        .post(`/api/v1/goals/${goal.id}/milestones`)
        .set('Authorization', auth)
        .send({ title })
        .expect(201);
    }

    const withMilestones = await readGoal(auth, goal.id);
    expect(withMilestones.progressPercent).toBe(0);

    const first = withMilestones.milestones?.[0];
    await request(app)
      .patch(`/api/v1/goals/${goal.id}/milestones/${first?.id}`)
      .set('Authorization', auth)
      .send({ isDone: true })
      .expect(200);

    const updated = await readGoal(auth, goal.id);
    expect(updated.doneMilestoneCount).toBe(1);
    expect(updated.progressPercent).toBe(33);
  });

  it('orders milestones by position', async () => {
    const goal = await createGoal(auth, { title: 'Ordered' });
    for (const [title, position] of [
      ['Third', 30],
      ['First', 10],
      ['Second', 20],
    ] as const) {
      await request(app)
        .post(`/api/v1/goals/${goal.id}/milestones`)
        .set('Authorization', auth)
        .send({ title, position })
        .expect(201);
    }

    const detail = await readGoal(auth, goal.id);
    expect(detail.milestones?.map((milestone) => milestone.title)).toEqual([
      'First',
      'Second',
      'Third',
    ]);
  });

  it('marks an active goal past its target date as overdue', async () => {
    const goal = await createGoal(auth, { title: 'Late', targetDate: dayOffset(-1) });
    expect(goal.isOverdue).toBe(true);
  });

  it('stops calling a goal overdue once it is achieved', async () => {
    const goal = await createGoal(auth, { title: 'Late but done', targetDate: dayOffset(-1) });

    const response = await request(app)
      .patch(`/api/v1/goals/${goal.id}`)
      .set('Authorization', auth)
      .send({ status: 'achieved' })
      .expect(200);

    expect((response.body as Envelope<Goal>).data.isOverdue).toBe(false);
  });

  it('filters by status', async () => {
    const header = await tokenFor('goals-filter');
    await createGoal(header, { title: 'Active one' });
    const other = await createGoal(header, { title: 'Abandoned one' });

    await request(app)
      .patch(`/api/v1/goals/${other.id}`)
      .set('Authorization', header)
      .send({ status: 'abandoned' })
      .expect(200);

    const response = await request(app)
      .get('/api/v1/goals?status=abandoned')
      .set('Authorization', header)
      .expect(200);

    const goals = (response.body as Envelope<Goal[]>).data;
    expect(goals).toHaveLength(1);
    expect(goals[0]?.title).toBe('Abandoned one');
  });

  it('clears a target date with null', async () => {
    const goal = await createGoal(auth, { title: 'Dated', targetDate: dayOffset(10) });

    const response = await request(app)
      .patch(`/api/v1/goals/${goal.id}`)
      .set('Authorization', auth)
      .send({ targetDate: null })
      .expect(200);

    expect((response.body as Envelope<Goal>).data.targetDate).toBeNull();
  });

  it('deletes its milestones with it', async () => {
    const goal = await createGoal(auth, { title: 'Doomed goal' });
    const milestone = await request(app)
      .post(`/api/v1/goals/${goal.id}/milestones`)
      .set('Authorization', auth)
      .send({ title: 'Doomed milestone' })
      .expect(201);

    await request(app).delete(`/api/v1/goals/${goal.id}`).set('Authorization', auth).expect(204);

    await request(app)
      .patch(`/api/v1/goals/${goal.id}/milestones/${milestone.body.data.id}`)
      .set('Authorization', auth)
      .send({ title: 'Still here?' })
      .expect(404);
  });
});

describe('milestones backed by a task', () => {
  async function createTask(header: string, title: string): Promise<string> {
    const response = await request(app)
      .post('/api/v1/tasks')
      .set('Authorization', header)
      .send({ title })
      .expect(201);
    return response.body.data.id as string;
  }

  it('takes its completion from the task', async () => {
    const goal = await createGoal(auth, { title: 'Task backed' });
    const taskId = await createTask(auth, 'Write chapter');

    await request(app)
      .post(`/api/v1/goals/${goal.id}/milestones`)
      .set('Authorization', auth)
      .send({ title: 'Chapter', taskId })
      .expect(201);

    expect((await readGoal(auth, goal.id)).doneMilestoneCount).toBe(0);

    await request(app)
      .patch(`/api/v1/tasks/${taskId}`)
      .set('Authorization', auth)
      .send({ status: 'done' })
      .expect(200);

    // Nothing wrote to the milestone. The goal moved because completion is
    // derived, which is what stops the two ever disagreeing.
    expect((await readGoal(auth, goal.id)).doneMilestoneCount).toBe(1);

    await request(app)
      .patch(`/api/v1/tasks/${taskId}`)
      .set('Authorization', auth)
      .send({ status: 'todo' })
      .expect(200);

    expect((await readGoal(auth, goal.id)).doneMilestoneCount).toBe(0);
  });

  it('refuses to set isDone directly on a task-backed milestone', async () => {
    const goal = await createGoal(auth, { title: 'Refuses' });
    const taskId = await createTask(auth, 'Backing task');

    const milestone = await request(app)
      .post(`/api/v1/goals/${goal.id}/milestones`)
      .set('Authorization', auth)
      .send({ title: 'Backed', taskId })
      .expect(201);

    // Accepting it would store a value every later read ignores, so the client
    // would believe it had taken effect.
    await request(app)
      .patch(`/api/v1/goals/${goal.id}/milestones/${milestone.body.data.id}`)
      .set('Authorization', auth)
      .send({ isDone: true })
      .expect(409);
  });

  it('allows one task to back only one milestone', async () => {
    const goal = await createGoal(auth, { title: 'One link only' });
    const taskId = await createTask(auth, 'Single use');

    await request(app)
      .post(`/api/v1/goals/${goal.id}/milestones`)
      .set('Authorization', auth)
      .send({ title: 'First', taskId })
      .expect(201);

    await request(app)
      .post(`/api/v1/goals/${goal.id}/milestones`)
      .set('Authorization', auth)
      .send({ title: 'Second', taskId })
      .expect(409);
  });

  it('keeps the displayed completion when the task is unlinked', async () => {
    const goal = await createGoal(auth, { title: 'Unlink' });
    const taskId = await createTask(auth, 'Finished work');

    const milestone = await request(app)
      .post(`/api/v1/goals/${goal.id}/milestones`)
      .set('Authorization', auth)
      .send({ title: 'Backed', taskId })
      .expect(201);

    await request(app)
      .patch(`/api/v1/tasks/${taskId}`)
      .set('Authorization', auth)
      .send({ status: 'done' })
      .expect(200);

    const unlinked = await request(app)
      .patch(`/api/v1/goals/${goal.id}/milestones/${milestone.body.data.id}`)
      .set('Authorization', auth)
      .send({ taskId: null })
      .expect(200);

    expect((unlinked.body as Envelope<Milestone>).data.taskId).toBeNull();
    // Progress must not jump backwards because a task was detached.
    expect((unlinked.body as Envelope<Milestone>).data.isDone).toBe(true);

    await request(app)
      .patch(`/api/v1/tasks/${taskId}`)
      .set('Authorization', auth)
      .send({ status: 'todo' })
      .expect(200);

    expect((await readGoal(auth, goal.id)).doneMilestoneCount).toBe(1);
  });

  it('survives deletion of its task', async () => {
    const goal = await createGoal(auth, { title: 'Task deleted' });
    const taskId = await createTask(auth, 'Doomed');

    await request(app)
      .post(`/api/v1/goals/${goal.id}/milestones`)
      .set('Authorization', auth)
      .send({ title: 'Backed by doomed', taskId })
      .expect(201);

    await request(app).delete(`/api/v1/tasks/${taskId}`).set('Authorization', auth).expect(204);

    // ON DELETE SET NULL: the checklist item remains, unbacked.
    const detail = await readGoal(auth, goal.id);
    expect(detail.milestoneCount).toBe(1);
    expect(detail.milestones?.[0]?.taskId).toBeNull();
  });
});
