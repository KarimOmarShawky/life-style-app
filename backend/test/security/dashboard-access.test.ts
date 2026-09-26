/**
 * Access control for the home summary.
 *
 * This endpoint reads SEVEN tables in one statement: tasks, habits, habit_logs,
 * events, reminders, expenses, budgets and goals. That is seven separate chances
 * to leave a `user_id` predicate off, and unlike a normal endpoint there is no
 * id in the URL to get wrong — a leak here would show up as someone else's
 * numbers quietly folded into your own totals, with nothing to point at.
 *
 * So the shape of this suite is: give the victim data in every single section,
 * give the attacker data in none, and assert the attacker's summary is all
 * zeros. Then give the attacker a little data of their own and assert the totals
 * are theirs alone rather than the sum of both.
 *
 * The final test is the backstop: no string the victim ever typed may appear
 * anywhere in the attacker's response, whatever shape a future section takes.
 */
import request from 'supertest';
import { beforeAll, describe, expect, it } from 'vitest';
import type { Express } from 'express';

import { createApp } from '@/app';
import type { DashboardResponse } from '@/features/dashboard/dashboard.types';

import { STRONG_PASSWORD, testEmail } from '../setup';

let app: Express;
let victim: string;
let attacker: string;

const MS_PER_DAY = 86_400_000;

function utcDay(offsetDays: number): string {
  return new Date(Date.now() + offsetDays * MS_PER_DAY).toISOString().slice(0, 10);
}

const TODAY = utcDay(0);
const YESTERDAY = utcDay(-1);

/** Distinctive enough that finding one in the wrong response is unambiguous. */
const VICTIM_STRINGS = [
  'Victim confidential task',
  'Victim private habit',
  'Victim secret appointment',
  'victim-category',
];

async function tokenFor(label: string): Promise<string> {
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

beforeAll(async () => {
  app = createApp();
  victim = await tokenFor('dash-victim');
  attacker = await tokenFor('dash-attacker');

  // --- the victim, populated in every section ------------------------------
  const task = await request(app)
    .post('/api/v1/tasks')
    .set('Authorization', victim)
    .send({ title: 'Victim confidential task', dueDate: `${YESTERDAY}T09:00:00.000Z` })
    .expect(201);

  const finished = await request(app)
    .post('/api/v1/tasks')
    .set('Authorization', victim)
    .send({ title: 'Victim finished task', dueDate: `${TODAY}T09:00:00.000Z` })
    .expect(201);
  await request(app)
    .patch(`/api/v1/tasks/${finished.body.data.id}`)
    .set('Authorization', victim)
    .send({ status: 'done' })
    .expect(200);

  await request(app)
    .post('/api/v1/habits')
    .set('Authorization', victim)
    .send({ title: 'Victim private habit' })
    .expect(201);

  await request(app)
    .post('/api/v1/events')
    .set('Authorization', victim)
    .send({
      title: 'Victim secret appointment',
      startTime: `${TODAY}T09:00:00.000Z`,
      endTime: `${TODAY}T10:00:00.000Z`,
    })
    .expect(201);

  await request(app)
    .post('/api/v1/reminders')
    .set('Authorization', victim)
    .send({ entityType: 'task', entityId: task.body.data.id, remindAt: '2001-01-01T08:00:00.000Z' })
    .expect(201);

  await request(app)
    .post('/api/v1/expenses')
    .set('Authorization', victim)
    .send({ amount: '4200.00', category: 'victim-category', spentOn: TODAY })
    .expect(201);

  await request(app)
    .post('/api/v1/budgets')
    .set('Authorization', victim)
    .send({ category: 'victim-category', monthlyLimit: '1.00', month: TODAY.slice(0, 7) })
    .expect(201);

  await request(app)
    .post('/api/v1/goals')
    .set('Authorization', victim)
    .send({ title: 'Victim goal', targetDate: utcDay(5) })
    .expect(201);
});

describe("an attacker's summary, with no data of their own", () => {
  let data: DashboardResponse;

  beforeAll(async () => {
    data = await dashboard(attacker);
  });

  it('shows no tasks', () => {
    expect(data.tasks).toEqual({ overdue: 0, dueToday: 0, completedToday: 0, items: [] });
  });

  it('shows no habits', () => {
    expect(data.habits).toEqual({ tracked: 0, completed: 0, items: [] });
  });

  it('shows no events', () => {
    expect(data.events).toEqual({ today: 0, items: [] });
  });

  it('shows no reminders', () => {
    expect(data.reminders).toEqual({ due: 0, items: [] });
  });

  it('shows no spending and no budgets over limit', () => {
    // The budget spending match joins expenses to budgets on category, currency
    // and month. Its owner predicate is inside that join, where nothing about a
    // request would look wrong if it were missing.
    expect(data.money).toEqual({ spending: [], budgetsOverLimit: 0 });
  });

  it('shows no goals', () => {
    expect(data.goals).toEqual({ active: 0, dueSoon: 0 });
  });
});

describe("an attacker's summary, with a little data of their own", () => {
  let data: DashboardResponse;

  beforeAll(async () => {
    await request(app)
      .post('/api/v1/tasks')
      .set('Authorization', attacker)
      .send({ title: 'Own task', dueDate: `${TODAY}T09:00:00.000Z` })
      .expect(201);

    await request(app)
      .post('/api/v1/habits')
      .set('Authorization', attacker)
      .send({ title: 'Own habit' })
      .expect(201);

    await request(app)
      .post('/api/v1/expenses')
      .set('Authorization', attacker)
      .send({ amount: '1.00', category: 'victim-category', spentOn: TODAY })
      .expect(201);

    // Deliberately the same category, currency and month as the victim's
    // budget. If the budget spending join were not owner-scoped, one of these
    // two users would be measured against the other's 4200.00.
    await request(app)
      .post('/api/v1/budgets')
      .set('Authorization', attacker)
      .send({ category: 'victim-category', monthlyLimit: '1000.00', month: TODAY.slice(0, 7) })
      .expect(201);

    data = await dashboard(attacker);
  });

  it('counts only their own tasks', () => {
    expect(data.tasks.dueToday).toBe(1);
    expect(data.tasks.overdue).toBe(0);
    expect(data.tasks.completedToday).toBe(0);
    expect(data.tasks.items.map((task: { title: string }) => task.title)).toEqual(['Own task']);
  });

  it('counts only their own habits', () => {
    expect(data.habits.tracked).toBe(1);
    expect(data.habits.items.map((habit: { title: string }) => habit.title)).toEqual(['Own habit']);
  });

  it('totals only their own spending, despite an identical category', () => {
    expect(data.money.spending).toEqual([{ currency: 'EGP', today: '1.00', month: '1.00' }]);
  });

  it('measures their budget against their own spending alone', () => {
    // 1.00 against a 1000.00 limit is not over. The victim's identically named
    // budget IS over, at 4200.00 against 1.00, and must not be borrowed.
    expect(data.money.budgetsOverLimit).toBe(0);
  });

  it('leaves the victim measured against their own spending too', async () => {
    const victimData = await dashboard(victim);
    expect(victimData.money.budgetsOverLimit).toBe(1);
    expect(victimData.money.spending).toEqual([
      { currency: 'EGP', today: '4200.00', month: '4200.00' },
    ]);
  });
});

describe('the victim keeps seeing their own summary', () => {
  it('is unaffected by everything the attacker did', async () => {
    const data = await dashboard(victim);

    expect(data.tasks.overdue).toBe(1);
    expect(data.tasks.completedToday).toBe(1);
    expect(data.habits.tracked).toBe(1);
    expect(data.events.today).toBe(1);
    expect(data.reminders.due).toBe(1);
    expect(data.goals.active).toBe(1);
    expect(data.goals.dueSoon).toBe(1);
  });
});

describe('nothing the victim typed reaches the attacker', () => {
  it('appears nowhere in the response body', async () => {
    // A catch-all rather than a list of fields, so a section added later is
    // covered without anyone remembering to extend this suite.
    const response = await request(app)
      .get('/api/v1/dashboard')
      .set('Authorization', attacker)
      .expect(200);

    const body = JSON.stringify(response.body);
    for (const secret of VICTIM_STRINGS) {
      expect(body, `"${secret}" leaked into another user's summary`).not.toContain(secret);
    }
  });
});

describe('unauthenticated access', () => {
  it('is refused', async () => {
    await request(app).get('/api/v1/dashboard').expect(401);
  });

  it('is refused with a forged token', async () => {
    await request(app)
      .get('/api/v1/dashboard')
      .set('Authorization', 'Bearer not.a.token')
      .expect(401);
  });
});
