/**
 * Access-control tests for the money feature (spec sections 41 and 43).
 *
 * Financial rows are the ones where a broken object reference matters most: an
 * attacker who can read another user's expenses learns where they shop, when
 * they travel and what they earn. Every path that takes an id is attacked here
 * with an id that exists and belongs to someone else, which is the case a test
 * using a random UUID would pass without proving anything.
 *
 * The feature also introduces a reference that is NOT an id: a budget finds its
 * spending by matching category, month and currency rather than by a foreign
 * key. That match is only scoped to its owner by a `user_id` predicate inside
 * the lateral join, and nothing about the request would look wrong if it were
 * missing — so two users with a budget of the same name are set up here
 * deliberately.
 */
import request from 'supertest';
import { beforeAll, describe, expect, it } from 'vitest';
import type { Express } from 'express';

import { createApp } from '@/app';

import { STRONG_PASSWORD, testEmail } from '../setup';

let app: Express;
let victim: string;
let attacker: string;

let victimExpense: string;
let victimSubscription: string;
let victimBudget: string;

/** Real, well-formed, and belonging to nobody. */
const ABSENT_ID = '00000000-0000-4000-8000-000000000000';

const MONTH = '2001-05';
const DAY = '2001-05-15';

async function tokenFor(label: string): Promise<string> {
  const response = await request(app)
    .post('/api/v1/auth/register')
    .send({ email: testEmail(label), password: STRONG_PASSWORD })
    .expect(201);
  return `Bearer ${response.body.data.tokens.accessToken}`;
}

beforeAll(async () => {
  app = createApp();
  victim = await tokenFor('money-victim');
  attacker = await tokenFor('money-attacker');

  const expense = await request(app)
    .post('/api/v1/expenses')
    .set('Authorization', victim)
    .send({ amount: '4200.00', category: 'salary-secret', spentOn: DAY })
    .expect(201);
  victimExpense = expense.body.data.id;

  // Two more, so the victim's own listing actually issues a cursor. With a
  // single row `nextCursor` is null and the forged-cursor test below would pass
  // without ever sending one.
  for (const day of ['2001-05-10', '2001-05-05']) {
    await request(app)
      .post('/api/v1/expenses')
      .set('Authorization', victim)
      .send({ amount: '1.00', category: 'padding', spentOn: day })
      .expect(201);
  }

  const subscription = await request(app)
    .post('/api/v1/subscriptions')
    .set('Authorization', victim)
    .send({ name: 'Private service', amount: '99.00', renewalDate: DAY })
    .expect(201);
  victimSubscription = subscription.body.data.id;

  const budget = await request(app)
    .post('/api/v1/budgets')
    .set('Authorization', victim)
    .send({ category: 'salary-secret', monthlyLimit: '5000.00', month: MONTH })
    .expect(201);
  victimBudget = budget.body.data.id;
});

describe('expenses belonging to another user', () => {
  it('cannot be read', async () => {
    await request(app)
      .get(`/api/v1/expenses/${victimExpense}`)
      .set('Authorization', attacker)
      .expect(404);
  });

  it('cannot be updated', async () => {
    await request(app)
      .patch(`/api/v1/expenses/${victimExpense}`)
      .set('Authorization', attacker)
      .send({ amount: '0.01' })
      .expect(404);
  });

  it('cannot be deleted', async () => {
    await request(app)
      .delete(`/api/v1/expenses/${victimExpense}`)
      .set('Authorization', attacker)
      .expect(404);
  });

  it('survives the attempt intact', async () => {
    const response = await request(app)
      .get(`/api/v1/expenses/${victimExpense}`)
      .set('Authorization', victim)
      .expect(200);

    expect(response.body.data.amount).toBe('4200.00');
  });

  it('is indistinguishable from an id that never existed', async () => {
    const other = await request(app)
      .get(`/api/v1/expenses/${victimExpense}`)
      .set('Authorization', attacker)
      .expect(404);

    const absent = await request(app)
      .get(`/api/v1/expenses/${ABSENT_ID}`)
      .set('Authorization', attacker)
      .expect(404);

    // Identical codes and messages. Any difference is an oracle that turns the
    // id space into a directory of which ids are real.
    expect(other.body.error.code).toBe(absent.body.error.code);
    expect(other.body.error.message).toBe(absent.body.error.message);
  });

  it('never appears in the attacker list', async () => {
    const response = await request(app)
      .get('/api/v1/expenses?limit=100')
      .set('Authorization', attacker)
      .expect(200);

    const ids = response.body.data.map((e: { id: string }) => e.id);
    expect(ids).not.toContain(victimExpense);
  });

  it('never appears in the attacker report, even filtered to its own day', async () => {
    const response = await request(app)
      .get(`/api/v1/expenses/summary?from=${DAY}&to=${DAY}`)
      .set('Authorization', attacker)
      .expect(200);

    expect(response.body.data.totals).toEqual([]);
    expect(response.body.data.byCategory).toEqual([]);
  });

  it('cannot be reached with a cursor issued to its owner', async () => {
    // A cursor is base64, not a signature, and the client can forge one. That is
    // safe only because the owner filter is applied separately and is not part
    // of the cursor. This test is what proves the "separately" part.
    const owners = await request(app)
      .get('/api/v1/expenses?limit=1')
      .set('Authorization', victim)
      .expect(200);

    const cursor = owners.body.pagination.nextCursor;
    expect(cursor).not.toBeNull();

    const response = await request(app)
      .get(`/api/v1/expenses?limit=100&cursor=${encodeURIComponent(cursor)}`)
      .set('Authorization', attacker)
      .expect(200);

    const ids = response.body.data.map((e: { id: string }) => e.id);
    expect(ids).not.toContain(victimExpense);
  });
});

describe('subscriptions belonging to another user', () => {
  it('cannot be read', async () => {
    await request(app)
      .get(`/api/v1/subscriptions/${victimSubscription}`)
      .set('Authorization', attacker)
      .expect(404);
  });

  it('cannot be updated', async () => {
    await request(app)
      .patch(`/api/v1/subscriptions/${victimSubscription}`)
      .set('Authorization', attacker)
      .send({ isActive: false })
      .expect(404);
  });

  it('cannot be deleted', async () => {
    await request(app)
      .delete(`/api/v1/subscriptions/${victimSubscription}`)
      .set('Authorization', attacker)
      .expect(404);
  });

  it('never appears in the attacker upcoming list', async () => {
    const response = await request(app)
      .get('/api/v1/subscriptions/upcoming?days=365')
      .set('Authorization', attacker)
      .expect(200);

    const ids = response.body.data.map((s: { id: string }) => s.id);
    expect(ids).not.toContain(victimSubscription);
  });

  it('never appears in the attacker cost summary', async () => {
    const response = await request(app)
      .get('/api/v1/subscriptions/summary')
      .set('Authorization', attacker)
      .expect(200);

    expect(response.body.data.costs).toEqual([]);
  });
});

describe('budgets belonging to another user', () => {
  it('cannot be read', async () => {
    await request(app)
      .get(`/api/v1/budgets/${victimBudget}`)
      .set('Authorization', attacker)
      .expect(404);
  });

  it('cannot be updated', async () => {
    await request(app)
      .patch(`/api/v1/budgets/${victimBudget}`)
      .set('Authorization', attacker)
      .send({ monthlyLimit: '1.00' })
      .expect(404);
  });

  it('cannot be deleted', async () => {
    await request(app)
      .delete(`/api/v1/budgets/${victimBudget}`)
      .set('Authorization', attacker)
      .expect(404);
  });

  it('does not block the attacker from using the same category and month', async () => {
    // The unique index is per user. Rejecting this as a duplicate would tell the
    // attacker that someone else already has a budget by that name.
    await request(app)
      .post('/api/v1/budgets')
      .set('Authorization', attacker)
      .send({ category: 'salary-secret', monthlyLimit: '5000.00', month: MONTH })
      .expect(201);
  });

  it('does not lend its spending to an identical budget owned by someone else', async () => {
    // Same category, same month, same currency, different owner. The only thing
    // keeping these apart is the `user_id` predicate inside the spending join.
    const response = await request(app)
      .get('/api/v1/budgets?limit=100')
      .set('Authorization', attacker)
      .expect(200);

    const mirrored = response.body.data.find(
      (b: { category: string }) => b.category === 'salary-secret',
    );

    expect(mirrored.spent).toBe('0.00');
    expect(mirrored.expenseCount).toBe(0);
  });

  it('still reports its own spending to its owner', async () => {
    const response = await request(app)
      .get(`/api/v1/budgets/${victimBudget}`)
      .set('Authorization', victim)
      .expect(200);

    expect(response.body.data.spent).toBe('4200.00');
  });
});

describe('injection and mass assignment', () => {
  it('refuses an owner supplied in the body of a create', async () => {
    await request(app)
      .post('/api/v1/expenses')
      .set('Authorization', attacker)
      .send({ amount: '1.00', category: 'x', userId: 'someone-else' })
      .expect(422);
  });

  it('refuses an owner supplied in the body of an update', async () => {
    const own = await request(app)
      .post('/api/v1/expenses')
      .set('Authorization', attacker)
      .send({ amount: '1.00', category: 'own' })
      .expect(201);

    await request(app)
      .patch(`/api/v1/expenses/${own.body.data.id}`)
      .set('Authorization', attacker)
      .send({ userId: 'someone-else' })
      .expect(422);
  });

  it('refuses an id supplied in the body', async () => {
    await request(app)
      .post('/api/v1/budgets')
      .set('Authorization', attacker)
      .send({ id: ABSENT_ID, category: 'x', monthlyLimit: '1.00', month: MONTH })
      .expect(422);
  });

  it('treats SQL metacharacters in a category filter as ordinary text', async () => {
    const response = await request(app)
      .get(`/api/v1/expenses?category=${encodeURIComponent("' OR 1=1 --")}&limit=100`)
      .set('Authorization', attacker)
      .expect(200);

    // Parameterized, so this matches a category literally spelled that way,
    // which nobody has. A successful injection would return every row instead.
    expect(response.body.data).toEqual([]);
  });

  it('treats SQL metacharacters in an amount as invalid rather than as SQL', async () => {
    await request(app)
      .post('/api/v1/expenses')
      .set('Authorization', attacker)
      .send({ amount: "1.00'); DROP TABLE expenses; --", category: 'x' })
      .expect(422);
  });

  it('refuses a month that is not a month', async () => {
    await request(app)
      .get("/api/v1/budgets?month=2001-05' OR '1'='1")
      .set('Authorization', attacker)
      .expect(422);
  });

  it('refuses a currency that is not three letters', async () => {
    await request(app)
      .get("/api/v1/expenses?currency=EGP' OR '1'='1")
      .set('Authorization', attacker)
      .expect(422);
  });

  it('leaves the expenses table intact after all of that', async () => {
    const response = await request(app)
      .get(`/api/v1/expenses/${victimExpense}`)
      .set('Authorization', victim)
      .expect(200);

    expect(response.body.data.amount).toBe('4200.00');
  });
});

describe('unauthenticated access', () => {
  const routes: [string, string][] = [
    ['get', '/api/v1/expenses'],
    ['get', '/api/v1/expenses/summary'],
    ['post', '/api/v1/expenses'],
    ['get', '/api/v1/subscriptions'],
    ['get', '/api/v1/subscriptions/upcoming'],
    ['get', '/api/v1/subscriptions/summary'],
    ['post', '/api/v1/subscriptions'],
    ['get', '/api/v1/budgets'],
    ['post', '/api/v1/budgets'],
  ];

  it.each(routes)('is refused on %s %s', async (method, path) => {
    const response = await (method === 'get'
      ? request(app).get(path)
      : request(app).post(path).send({}));

    expect(response.status).toBe(401);
  });

  it('is refused with a forged token', async () => {
    await request(app)
      .get('/api/v1/expenses')
      .set('Authorization', 'Bearer not.a.token')
      .expect(401);
  });
});
