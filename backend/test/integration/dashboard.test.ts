/**
 * The home summary, end to end (FR-24).
 *
 * This is the one endpoint that reads every other feature's tables, so what it
 * has to prove is that it AGREES with those features rather than answering a
 * similar-looking question of its own. Three agreements are load-bearing:
 *
 *   A weekly habit logged on Monday is done for the week, so the summary must
 *   not call it outstanding on Thursday. The rule is imported from the habits
 *   slice rather than restated, and this suite checks the import did its job.
 *
 *   A budget is over its limit on the same terms the budgets screen uses,
 *   including the case-insensitive category match.
 *
 *   The due-reminder count matches GET /reminders/due exactly, orphan filter
 *   included. A badge that disagrees with the list it opens is worse than none.
 *
 * Everything is scoped to the day the test runs, because "today" is what a home
 * screen is about. Fixtures therefore use offsets from the current UTC day, not
 * fixed dates.
 */
import request from 'supertest';
import { beforeAll, describe, expect, it } from 'vitest';
import type { Express } from 'express';

import { createApp } from '@/app';
import type { DashboardResponse } from '@/features/dashboard/dashboard.types';

import { STRONG_PASSWORD, testEmail } from '../setup';

let app: Express;

const MS_PER_DAY = 86_400_000;

function utcDay(offsetDays: number): string {
  return new Date(Date.now() + offsetDays * MS_PER_DAY).toISOString().slice(0, 10);
}

const TODAY = utcDay(0);
const YESTERDAY = utcDay(-1);
const TOMORROW = utcDay(1);

async function register(label: string): Promise<string> {
  const response = await request(app)
    .post('/api/v1/auth/register')
    .send({ email: testEmail(label), password: STRONG_PASSWORD })
    .expect(201);
  return `Bearer ${response.body.data.tokens.accessToken}`;
}

async function dashboard(token: string): Promise<DashboardResponse> {
  const response = await request(app)
    .get('/api/v1/dashboard')
    .set('Authorization', token)
    .expect(200);
  return response.body.data;
}

beforeAll(() => {
  app = createApp();
});

describe('an account with nothing in it', () => {
  let empty: DashboardResponse;

  beforeAll(async () => {
    empty = await dashboard(await register('dash-empty'));
  });

  it('reports today', () => {
    expect(empty.date).toBe(TODAY);
  });

  it('reports zeros and empty lists rather than nulls', () => {
    // A client rendering this must not have to distinguish "none" from "not
    // loaded". jsonb_agg returns NULL over an empty set, so every list is
    // coalesced in the query; this is what proves it.
    expect(empty.tasks).toEqual({ overdue: 0, dueToday: 0, completedToday: 0, items: [] });
    expect(empty.habits).toEqual({ tracked: 0, completed: 0, items: [] });
    expect(empty.events).toEqual({ today: 0, items: [] });
    expect(empty.reminders).toEqual({ due: 0, items: [] });
    expect(empty.money).toEqual({ spending: [], budgetsOverLimit: 0 });
    expect(empty.goals).toEqual({ active: 0, dueSoon: 0 });
  });
});

describe('tasks on the home screen', () => {
  let auth: string;
  let overdueId: string;

  beforeAll(async () => {
    auth = await register('dash-tasks');

    const overdue = await request(app)
      .post('/api/v1/tasks')
      .set('Authorization', auth)
      .send({ title: 'Overdue', dueDate: `${YESTERDAY}T09:00:00.000Z` })
      .expect(201);
    overdueId = overdue.body.data.id;

    await request(app)
      .post('/api/v1/tasks')
      .set('Authorization', auth)
      .send({ title: 'Due today', dueDate: `${TODAY}T18:00:00.000Z` })
      .expect(201);

    await request(app)
      .post('/api/v1/tasks')
      .set('Authorization', auth)
      .send({ title: 'Due tomorrow', dueDate: `${TOMORROW}T09:00:00.000Z` })
      .expect(201);

    await request(app)
      .post('/api/v1/tasks')
      .set('Authorization', auth)
      .send({ title: 'Someday', description: 'no due date' })
      .expect(201);

    const finished = await request(app)
      .post('/api/v1/tasks')
      .set('Authorization', auth)
      .send({ title: 'Finished', dueDate: `${TODAY}T10:00:00.000Z` })
      .expect(201);
    await request(app)
      .patch(`/api/v1/tasks/${finished.body.data.id}`)
      .set('Authorization', auth)
      .send({ status: 'done' })
      .expect(200);
  });

  it('separates overdue from due today', async () => {
    const data = await dashboard(auth);
    expect(data.tasks.overdue).toBe(1);
    expect(data.tasks.dueToday).toBe(1);
  });

  it('counts what was finished today', async () => {
    const data = await dashboard(auth);
    expect(data.tasks.completedToday).toBe(1);
  });

  it('lists overdue and due-today together, soonest first', async () => {
    const data = await dashboard(auth);
    const titles = data.tasks.items.map((task: { title: string }) => task.title);
    expect(titles).toEqual(['Overdue', 'Due today']);
  });

  it('leaves out tomorrow, undated and finished tasks', async () => {
    const data = await dashboard(auth);
    const titles = data.tasks.items.map((task: { title: string }) => task.title);
    expect(titles).not.toContain('Due tomorrow');
    expect(titles).not.toContain('Someday');
    expect(titles).not.toContain('Finished');
  });

  it('flags which of them are actually late', async () => {
    const data = await dashboard(auth);
    expect(data.tasks.items[0]?.isOverdue).toBe(true);
    expect(data.tasks.items[1]?.isOverdue).toBe(false);
  });

  it('emits timestamps in the same format as every other endpoint', async () => {
    // PostgreSQL renders a timestamptz in JSON as +00:00; the mappers everywhere
    // else use Date.toISOString. Two formats for one field is a contract bug.
    const data = await dashboard(auth);
    const viaTasks = await request(app)
      .get(`/api/v1/tasks/${overdueId}`)
      .set('Authorization', auth)
      .expect(200);

    expect(data.tasks.items[0]?.dueDate).toBe(viaTasks.body.data.dueDate);
    expect(data.tasks.items[0]?.dueDate).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
  });

  it('stops listing at the cap but keeps counting past it', async () => {
    const crowded = await register('dash-many-tasks');
    for (let index = 0; index < 12; index += 1) {
      await request(app)
        .post('/api/v1/tasks')
        .set('Authorization', crowded)
        .send({ title: `Task ${index}`, dueDate: `${TODAY}T0${index % 10}:00:00.000Z` })
        .expect(201);
    }

    const data = await dashboard(crowded);
    expect(data.tasks.items).toHaveLength(10);
    expect(data.tasks.dueToday).toBe(12);
  });
});

describe('habits on the home screen', () => {
  let auth: string;

  beforeAll(async () => {
    auth = await register('dash-habits');

    const done = await request(app)
      .post('/api/v1/habits')
      .set('Authorization', auth)
      .send({ title: 'Done daily' })
      .expect(201);
    await request(app)
      .post(`/api/v1/habits/${done.body.data.id}/logs`)
      .set('Authorization', auth)
      .send({ date: TODAY })
      .expect(200);

    await request(app)
      .post('/api/v1/habits')
      .set('Authorization', auth)
      .send({ title: 'Pending daily' })
      .expect(201);

    const archived = await request(app)
      .post('/api/v1/habits')
      .set('Authorization', auth)
      .send({ title: 'Archived' })
      .expect(201);
    await request(app)
      .patch(`/api/v1/habits/${archived.body.data.id}`)
      .set('Authorization', auth)
      .send({ isArchived: true })
      .expect(200);
  });

  it('counts only habits still being tracked', async () => {
    const data = await dashboard(auth);
    expect(data.habits.tracked).toBe(2);
  });

  it('counts the ones already satisfied', async () => {
    const data = await dashboard(auth);
    expect(data.habits.completed).toBe(1);
  });

  it('lists only what is still outstanding', async () => {
    const data = await dashboard(auth);
    const titles = data.habits.items.map((habit: { title: string }) => habit.title);
    expect(titles).toEqual(['Pending daily']);
  });

  it('treats a weekly habit logged earlier this week as done', async () => {
    // The whole reason the period rule is imported rather than rewritten. A
    // naive "was it logged today" check calls this outstanding for six days out
    // of seven, and disagrees with the habits screen every one of them.
    const weekly = await register('dash-weekly');
    const habit = await request(app)
      .post('/api/v1/habits')
      .set('Authorization', weekly)
      .send({ title: 'Weekly review', frequency: 'weekly' })
      .expect(201);

    // Monday of the current ISO week, which is always today or earlier.
    const now = new Date();
    const isoWeekday = (now.getUTCDay() + 6) % 7;
    const monday = utcDay(-isoWeekday);

    await request(app)
      .post(`/api/v1/habits/${habit.body.data.id}/logs`)
      .set('Authorization', weekly)
      .send({ date: monday })
      .expect(200);

    const data = await dashboard(weekly);
    expect(data.habits.tracked).toBe(1);
    expect(data.habits.completed).toBe(1);
    expect(data.habits.items).toEqual([]);

    // And it agrees with the habits endpoint, which is the actual claim.
    const viaHabits = await request(app)
      .get(`/api/v1/habits/${habit.body.data.id}`)
      .set('Authorization', weekly)
      .expect(200);
    expect(viaHabits.body.data.isCompletedForCurrentPeriod).toBe(true);
  });
});

describe('events on the home screen', () => {
  let auth: string;

  beforeAll(async () => {
    auth = await register('dash-events');

    await request(app)
      .post('/api/v1/events')
      .set('Authorization', auth)
      .send({
        title: 'Starts today',
        startTime: `${TODAY}T14:00:00.000Z`,
        endTime: `${TODAY}T15:00:00.000Z`,
      })
      .expect(201);

    await request(app)
      .post('/api/v1/events')
      .set('Authorization', auth)
      .send({
        title: 'Already running',
        startTime: `${YESTERDAY}T09:00:00.000Z`,
        endTime: `${TODAY}T23:00:00.000Z`,
      })
      .expect(201);

    await request(app)
      .post('/api/v1/events')
      .set('Authorization', auth)
      .send({
        title: 'Tomorrow',
        startTime: `${TOMORROW}T09:00:00.000Z`,
        endTime: `${TOMORROW}T10:00:00.000Z`,
      })
      .expect(201);
  });

  it('includes an event that was already running when the day began', async () => {
    // Same overlap test the calendar window uses. A start_time-only filter drops
    // exactly this event, and it is the one the user is in the middle of.
    const data = await dashboard(auth);
    expect(data.events.today).toBe(2);
  });

  it('orders them earliest first', async () => {
    const data = await dashboard(auth);
    const titles = data.events.items.map((event: { title: string }) => event.title);
    expect(titles).toEqual(['Already running', 'Starts today']);
  });

  it('excludes tomorrow', async () => {
    const data = await dashboard(auth);
    const titles = data.events.items.map((event: { title: string }) => event.title);
    expect(titles).not.toContain('Tomorrow');
  });

  it('includes an all-day event for today', async () => {
    const allDay = await register('dash-allday');
    await request(app)
      .post('/api/v1/events')
      .set('Authorization', allDay)
      .send({
        title: 'Public holiday',
        startTime: `${TODAY}T11:00:00.000Z`,
        endTime: `${TODAY}T12:00:00.000Z`,
        allDay: true,
      })
      .expect(201);

    const data = await dashboard(allDay);
    expect(data.events.today).toBe(1);
    expect(data.events.items[0]?.allDay).toBe(true);
    expect(data.events.items[0]?.startTime).toBe(`${TODAY}T00:00:00.000Z`);
  });
});

describe('reminders on the home screen', () => {
  let auth: string;
  let dueId: string;

  beforeAll(async () => {
    auth = await register('dash-reminders');

    const task = await request(app)
      .post('/api/v1/tasks')
      .set('Authorization', auth)
      .send({ title: 'Has reminders' })
      .expect(201);

    const due = await request(app)
      .post('/api/v1/reminders')
      .set('Authorization', auth)
      .send({
        entityType: 'task',
        entityId: task.body.data.id,
        remindAt: '2001-01-01T08:00:00.000Z',
      })
      .expect(201);
    dueId = due.body.data.id;

    await request(app)
      .post('/api/v1/reminders')
      .set('Authorization', auth)
      .send({
        entityType: 'task',
        entityId: task.body.data.id,
        remindAt: '2099-01-01T08:00:00.000Z',
      })
      .expect(201);

    const doomed = await request(app)
      .post('/api/v1/tasks')
      .set('Authorization', auth)
      .send({ title: 'Will be deleted' })
      .expect(201);
    await request(app)
      .post('/api/v1/reminders')
      .set('Authorization', auth)
      .send({
        entityType: 'task',
        entityId: doomed.body.data.id,
        remindAt: '2001-01-02T08:00:00.000Z',
      })
      .expect(201);
    await request(app)
      .delete(`/api/v1/tasks/${doomed.body.data.id}`)
      .set('Authorization', auth)
      .expect(204);
  });

  it('counts exactly what the delivery queue would hand over', async () => {
    const data = await dashboard(auth);
    const queue = await request(app)
      .get('/api/v1/reminders/due?limit=100')
      .set('Authorization', auth)
      .expect(200);

    expect(data.reminders.due).toBe(queue.body.data.length);
    expect(data.reminders.due).toBe(1);
  });

  it('excludes the future one and the orphaned one', async () => {
    const data = await dashboard(auth);
    expect(data.reminders.items.map((r: { id: string }) => r.id)).toEqual([dueId]);
  });

  it('resolves the title of the thing being reminded about', async () => {
    const data = await dashboard(auth);
    expect(data.reminders.items[0]?.entityTitle).toBe('Has reminders');
  });

  it('drops out once the reminder is dismissed', async () => {
    await request(app)
      .post(`/api/v1/reminders/${dueId}/dismiss`)
      .set('Authorization', auth)
      .expect(200);

    const data = await dashboard(auth);
    expect(data.reminders.due).toBe(0);
  });
});

describe('money on the home screen', () => {
  let auth: string;

  beforeAll(async () => {
    auth = await register('dash-money');

    for (const amount of ['10.50', '4.50']) {
      await request(app)
        .post('/api/v1/expenses')
        .set('Authorization', auth)
        .send({ amount, category: 'food', spentOn: TODAY })
        .expect(201);
    }

    await request(app)
      .post('/api/v1/expenses')
      .set('Authorization', auth)
      .send({ amount: '100.00', category: 'rent', currency: 'USD', spentOn: TODAY })
      .expect(201);
  });

  it('keeps currencies apart rather than adding them', async () => {
    const data = await dashboard(auth);
    const currencies = data.money.spending.map((row: { currency: string }) => row.currency);
    expect(currencies).toEqual(['EGP', 'USD']);
  });

  it('reports amounts as exact decimal strings', async () => {
    const data = await dashboard(auth);
    const egp = data.money.spending.find((row: { currency: string }) => row.currency === 'EGP');

    expect(typeof egp?.today).toBe('string');
    expect(egp?.today).toBe('15.00');
  });

  it('counts a budget as over its limit on the same terms the budgets screen does', async () => {
    // Budget spelled "Food", expenses spelled "food". The match is
    // case-insensitive in both places because both import the same predicate.
    await request(app)
      .post('/api/v1/budgets')
      .set('Authorization', auth)
      .send({ category: 'Food', monthlyLimit: '10.00', month: TODAY.slice(0, 7) })
      .expect(201);

    await request(app)
      .post('/api/v1/budgets')
      .set('Authorization', auth)
      .send({
        category: 'rent',
        monthlyLimit: '5000.00',
        currency: 'USD',
        month: TODAY.slice(0, 7),
      })
      .expect(201);

    const data = await dashboard(auth);
    expect(data.money.budgetsOverLimit).toBe(1);

    const viaBudgets = await request(app)
      .get('/api/v1/budgets?limit=100')
      .set('Authorization', auth)
      .expect(200);
    const over = viaBudgets.body.data.filter((b: { isOverBudget: boolean }) => b.isOverBudget);
    expect(over).toHaveLength(1);
  });

  it('does not count a budget in another currency as over', async () => {
    const data = await dashboard(auth);
    // 100 USD against a 5000 USD limit. If currency were dropped from the match,
    // the 15.00 EGP of food would be added in and the answer would change.
    expect(data.money.budgetsOverLimit).toBe(1);
  });
});

describe('goals on the home screen', () => {
  it('counts active goals and the ones landing soon', async () => {
    const auth = await register('dash-goals');

    await request(app)
      .post('/api/v1/goals')
      .set('Authorization', auth)
      .send({ title: 'Soon', targetDate: utcDay(5) })
      .expect(201);

    await request(app)
      .post('/api/v1/goals')
      .set('Authorization', auth)
      .send({ title: 'Just inside the horizon', targetDate: utcDay(30) })
      .expect(201);

    await request(app)
      .post('/api/v1/goals')
      .set('Authorization', auth)
      .send({ title: 'Just outside', targetDate: utcDay(31) })
      .expect(201);

    await request(app)
      .post('/api/v1/goals')
      .set('Authorization', auth)
      .send({ title: 'No target date' })
      .expect(201);

    const data = await dashboard(auth);
    expect(data.goals.active).toBe(4);
    expect(data.goals.dueSoon).toBe(2);
  });

  it('stops counting a goal once it is no longer active', async () => {
    const auth = await register('dash-goals-done');

    const goal = await request(app)
      .post('/api/v1/goals')
      .set('Authorization', auth)
      .send({ title: 'Will be achieved', targetDate: utcDay(3) })
      .expect(201);

    await request(app)
      .patch(`/api/v1/goals/${goal.body.data.id}`)
      .set('Authorization', auth)
      .send({ status: 'achieved' })
      .expect(200);

    const data = await dashboard(auth);
    expect(data.goals.active).toBe(0);
    expect(data.goals.dueSoon).toBe(0);
  });
});
