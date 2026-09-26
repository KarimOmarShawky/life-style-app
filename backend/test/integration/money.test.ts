/**
 * Integration tests for expenses, subscriptions and budgets (spec section 41).
 *
 * Driven through the real Express app against the real database, because the
 * three things this feature gets right are all things only PostgreSQL can
 * demonstrate: exact decimal arithmetic, the renewal schedule derived in SQL,
 * and budget spending summed across a join. Mocking the database here would test
 * the mock.
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

interface Expense {
  id: string;
  amount: string;
  currency: string;
  category: string;
  spentOn: string;
  note: string | null;
}

interface Subscription {
  id: string;
  name: string;
  amount: string;
  currency: string;
  renewalDate: string;
  nextRenewalDate: string | null;
  daysUntilRenewal: number | null;
  billingCycle: string;
  isActive: boolean;
}

interface Budget {
  id: string;
  category: string;
  monthlyLimit: string;
  currency: string;
  month: string;
  spent: string;
  remaining: string;
  percentUsed: number;
  isOverBudget: boolean;
  expenseCount: number;
}

interface Summary {
  from: string;
  to: string;
  totals: { currency: string; total: string; count: number }[];
  byCategory: { category: string; currency: string; total: string; count: number }[];
}

interface Costs {
  costs: {
    currency: string;
    monthlyEquivalent: string;
    monthlyTotal: string;
    yearlyTotal: string;
    count: number;
  }[];
}

/** A calendar date `offset` days from today, in UTC. */
function dayOffset(offset: number): string {
  const date = new Date();
  date.setUTCDate(date.getUTCDate() + offset);
  return date.toISOString().slice(0, 10);
}

const TODAY = dayOffset(0);
const THIS_MONTH = TODAY.slice(0, 7);

/**
 * A month far enough in the past that no other test's data can fall inside it,
 * so totals asserted against it are exact rather than "at least".
 */
const ARCHIVE_MONTH = '2001-06';
const ARCHIVE_DAY = '2001-06-15';

async function tokenFor(label: string): Promise<string> {
  const response = await request(app)
    .post('/api/v1/auth/register')
    .send({ email: testEmail(label), password: STRONG_PASSWORD })
    .expect(201);
  return `Bearer ${response.body.data.tokens.accessToken}`;
}

async function createExpense(header: string, body: Record<string, unknown>): Promise<Expense> {
  const response = await request(app)
    .post('/api/v1/expenses')
    .set('Authorization', header)
    .send(body)
    .expect(201);
  return (response.body as Envelope<Expense>).data;
}

async function createSubscription(
  header: string,
  body: Record<string, unknown>,
): Promise<Subscription> {
  const response = await request(app)
    .post('/api/v1/subscriptions')
    .set('Authorization', header)
    .send(body)
    .expect(201);
  return (response.body as Envelope<Subscription>).data;
}

async function createBudget(header: string, body: Record<string, unknown>): Promise<Budget> {
  const response = await request(app)
    .post('/api/v1/budgets')
    .set('Authorization', header)
    .send(body)
    .expect(201);
  return (response.body as Envelope<Budget>).data;
}

beforeAll(async () => {
  app = createApp();
  auth = await tokenFor('money');
});

describe('expenses', () => {
  it('creates an expense with the defaults the column declares', async () => {
    const expense = await createExpense(auth, { amount: '25.00', category: 'coffee' });

    expect(expense.currency).toBe('EGP');
    expect(expense.spentOn).toBe(TODAY);
    expect(expense.note).toBeNull();
  });

  it('publishes the amount as a string, not a JSON number', async () => {
    const response = await request(app)
      .post('/api/v1/expenses')
      .set('Authorization', auth)
      .send({ amount: '10.00', category: 'strings' })
      .expect(201);

    // Asserted on the raw text, because JSON.parse would turn a number back into
    // a plausible-looking value and hide exactly the bug this guards against.
    expect(response.text).toContain('"amount":"10.00"');
    expect(response.text).not.toContain('"amount":10');
  });

  it('keeps a trailing zero a JavaScript number would drop', async () => {
    const expense = await createExpense(auth, { amount: '1234.50', category: 'scale' });
    expect(expense.amount).toBe('1234.50');
  });

  it('accepts a clean JSON number and normalizes its scale', async () => {
    const expense = await createExpense(auth, { amount: 19.9, category: 'numeric' });
    expect(expense.amount).toBe('19.90');
  });

  it('uppercases a currency code', async () => {
    const expense = await createExpense(auth, {
      amount: '5.00',
      category: 'travel',
      currency: 'usd',
    });
    expect(expense.currency).toBe('USD');
  });

  it('refuses an amount with a third decimal place instead of rounding it', async () => {
    await request(app)
      .post('/api/v1/expenses')
      .set('Authorization', auth)
      .send({ amount: '1.005', category: 'x' })
      .expect(422);
  });

  it('refuses the result of floating-point addition', async () => {
    await request(app)
      .post('/api/v1/expenses')
      .set('Authorization', auth)
      .send({ amount: 0.1 + 0.2, category: 'x' })
      .expect(422);
  });

  it('refuses an amount of zero, which the column also forbids', async () => {
    await request(app)
      .post('/api/v1/expenses')
      .set('Authorization', auth)
      .send({ amount: '0.00', category: 'x' })
      .expect(422);
  });

  it('refuses an unknown key rather than dropping it', async () => {
    await request(app)
      .post('/api/v1/expenses')
      .set('Authorization', auth)
      .send({ amount: '1.00', category: 'x', userId: 'someone-else' })
      .expect(422);
  });

  it('returns 404 for an expense that does not exist', async () => {
    await request(app)
      .get('/api/v1/expenses/00000000-0000-4000-8000-000000000000')
      .set('Authorization', auth)
      .expect(404);
  });

  it('updates an expense and leaves absent fields alone', async () => {
    const expense = await createExpense(auth, {
      amount: '10.00',
      category: 'edit',
      note: 'first',
    });

    const response = await request(app)
      .patch(`/api/v1/expenses/${expense.id}`)
      .set('Authorization', auth)
      .send({ amount: '11.00' })
      .expect(200);

    const updated = (response.body as Envelope<Expense>).data;
    expect(updated.amount).toBe('11.00');
    expect(updated.category).toBe('edit');
    expect(updated.note).toBe('first');
  });

  it('clears a note with an explicit null', async () => {
    const expense = await createExpense(auth, {
      amount: '10.00',
      category: 'clear',
      note: 'remove me',
    });

    const response = await request(app)
      .patch(`/api/v1/expenses/${expense.id}`)
      .set('Authorization', auth)
      .send({ note: null })
      .expect(200);

    expect((response.body as Envelope<Expense>).data.note).toBeNull();
  });

  it('refuses an empty update', async () => {
    const expense = await createExpense(auth, { amount: '10.00', category: 'empty' });

    await request(app)
      .patch(`/api/v1/expenses/${expense.id}`)
      .set('Authorization', auth)
      .send({})
      .expect(422);
  });

  it('deletes an expense and then reports it missing', async () => {
    const expense = await createExpense(auth, { amount: '10.00', category: 'gone' });

    await request(app)
      .delete(`/api/v1/expenses/${expense.id}`)
      .set('Authorization', auth)
      .expect(204);

    await request(app)
      .get(`/api/v1/expenses/${expense.id}`)
      .set('Authorization', auth)
      .expect(404);
  });
});

describe('expense listing', () => {
  let listAuth: string;

  beforeAll(async () => {
    listAuth = await tokenFor('money-list');

    // Entered in an order that does not match their spend dates, so ordering by
    // entry time would be visibly wrong.
    await createExpense(listAuth, { amount: '1.00', category: 'a', spentOn: '2001-06-10' });
    await createExpense(listAuth, { amount: '2.00', category: 'b', spentOn: '2001-06-20' });
    await createExpense(listAuth, { amount: '3.00', category: 'c', spentOn: '2001-06-15' });
    await createExpense(listAuth, { amount: '4.00', category: 'd', spentOn: '2001-06-05' });
  });

  it('orders by the date the money was spent, newest first', async () => {
    const response = await request(app)
      .get('/api/v1/expenses?limit=100')
      .set('Authorization', listAuth)
      .expect(200);

    const dates = (response.body as Envelope<Expense[]>).data.map((e) => e.spentOn);
    expect(dates).toEqual(['2001-06-20', '2001-06-15', '2001-06-10', '2001-06-05']);
  });

  it('pages without repeating or skipping a row', async () => {
    const first = await request(app)
      .get('/api/v1/expenses?limit=2')
      .set('Authorization', listAuth)
      .expect(200);

    const firstBody = first.body as Envelope<Expense[]>;
    expect(firstBody.data).toHaveLength(2);
    expect(firstBody.pagination?.hasMore).toBe(true);

    const second = await request(app)
      .get(`/api/v1/expenses?limit=2&cursor=${encodeURIComponent(firstBody.pagination!.nextCursor!)}`)
      .set('Authorization', listAuth)
      .expect(200);

    const secondBody = second.body as Envelope<Expense[]>;
    expect(secondBody.data.map((e) => e.spentOn)).toEqual(['2001-06-10', '2001-06-05']);
    expect(secondBody.pagination?.hasMore).toBe(false);
  });

  it('rejects a malformed cursor with a 422 rather than failing inside the driver', async () => {
    await request(app)
      .get('/api/v1/expenses?cursor=not-a-cursor')
      .set('Authorization', listAuth)
      .expect(422);
  });

  it('filters by date range', async () => {
    const response = await request(app)
      .get('/api/v1/expenses?from=2001-06-10&to=2001-06-15')
      .set('Authorization', listAuth)
      .expect(200);

    expect((response.body as Envelope<Expense[]>).data).toHaveLength(2);
  });

  it('rejects a range that runs backwards', async () => {
    await request(app)
      .get('/api/v1/expenses?from=2001-06-20&to=2001-06-01')
      .set('Authorization', listAuth)
      .expect(422);
  });

  it('matches a category filter case-insensitively', async () => {
    const mixedAuth = await tokenFor('money-case');
    await createExpense(mixedAuth, { amount: '1.00', category: 'Food', spentOn: ARCHIVE_DAY });
    await createExpense(mixedAuth, { amount: '2.00', category: 'food', spentOn: ARCHIVE_DAY });
    await createExpense(mixedAuth, { amount: '3.00', category: 'FOOD', spentOn: ARCHIVE_DAY });
    await createExpense(mixedAuth, { amount: '4.00', category: 'rent', spentOn: ARCHIVE_DAY });

    const response = await request(app)
      .get('/api/v1/expenses?category=fOoD&limit=100')
      .set('Authorization', mixedAuth)
      .expect(200);

    expect((response.body as Envelope<Expense[]>).data).toHaveLength(3);
  });
});

describe('expense reports', () => {
  let reportAuth: string;

  beforeAll(async () => {
    reportAuth = await tokenFor('money-report');

    await createExpense(reportAuth, { amount: '0.10', category: 'cents', spentOn: ARCHIVE_DAY });
    await createExpense(reportAuth, { amount: '0.20', category: 'cents', spentOn: ARCHIVE_DAY });
    await createExpense(reportAuth, { amount: '0.30', category: 'cents', spentOn: ARCHIVE_DAY });
    await createExpense(reportAuth, { amount: '0.40', category: 'Cents', spentOn: ARCHIVE_DAY });
    await createExpense(reportAuth, {
      amount: '5.00',
      category: 'travel',
      currency: 'USD',
      spentOn: ARCHIVE_DAY,
    });
  });

  it('sums decimals exactly, which is the whole reason for NUMERIC', async () => {
    const response = await request(app)
      .get(`/api/v1/expenses/summary?from=${ARCHIVE_MONTH}-01&to=${ARCHIVE_MONTH}-30`)
      .set('Authorization', reportAuth)
      .expect(200);

    const summary = (response.body as Envelope<Summary>).data;
    const cents = summary.byCategory.find((row) => row.category.toLowerCase() === 'cents');

    // 0.1 + 0.2 + 0.3 + 0.4 in binary floating point is 1.0000000000000002.
    expect(cents?.total).toBe('1.00');
  });

  it('groups a category case-insensitively but labels it as the user wrote it', async () => {
    const response = await request(app)
      .get(`/api/v1/expenses/summary?from=${ARCHIVE_MONTH}-01&to=${ARCHIVE_MONTH}-30`)
      .set('Authorization', reportAuth)
      .expect(200);

    const summary = (response.body as Envelope<Summary>).data;
    const cents = summary.byCategory.filter((row) => row.category.toLowerCase() === 'cents');

    expect(cents).toHaveLength(1);
    expect(cents[0]?.count).toBe(4);
    expect(['cents', 'Cents']).toContain(cents[0]?.category);
  });

  it('never adds two currencies together', async () => {
    const response = await request(app)
      .get(`/api/v1/expenses/summary?from=${ARCHIVE_MONTH}-01&to=${ARCHIVE_MONTH}-30`)
      .set('Authorization', reportAuth)
      .expect(200);

    const summary = (response.body as Envelope<Summary>).data;
    expect(summary.totals).toEqual([
      { currency: 'EGP', total: '1.00', count: 4 },
      { currency: 'USD', total: '5.00', count: 1 },
    ]);
  });

  it('defaults to the current month', async () => {
    const response = await request(app)
      .get('/api/v1/expenses/summary')
      .set('Authorization', reportAuth)
      .expect(200);

    const summary = (response.body as Envelope<Summary>).data;
    expect(summary.from).toBe(`${THIS_MONTH}-01`);
    expect(summary.to.slice(0, 7)).toBe(THIS_MONTH);
  });

  it('completes a one-sided range with the rest of that month', async () => {
    const response = await request(app)
      .get('/api/v1/expenses/summary?from=2001-06-10')
      .set('Authorization', reportAuth)
      .expect(200);

    expect((response.body as Envelope<Summary>).data.to).toBe('2001-06-30');
  });

  it('allows a full leap year', async () => {
    await request(app)
      .get('/api/v1/expenses/summary?from=2024-01-01&to=2024-12-31')
      .set('Authorization', reportAuth)
      .expect(200);
  });

  it('refuses a range wider than a year', async () => {
    await request(app)
      .get('/api/v1/expenses/summary?from=2020-01-01&to=2026-01-01')
      .set('Authorization', reportAuth)
      .expect(422);
  });

  it('returns an empty report rather than an error when there is nothing', async () => {
    const emptyAuth = await tokenFor('money-empty');

    const response = await request(app)
      .get('/api/v1/expenses/summary?from=2001-06-01&to=2001-06-30')
      .set('Authorization', emptyAuth)
      .expect(200);

    const summary = (response.body as Envelope<Summary>).data;
    expect(summary.totals).toEqual([]);
    expect(summary.byCategory).toEqual([]);
  });
});

describe('subscriptions', () => {
  it('derives the next renewal from an anchor years in the past', async () => {
    const subscription = await createSubscription(auth, {
      name: 'Streaming',
      amount: '120.00',
      renewalDate: '2020-01-15',
    });

    expect(subscription.renewalDate).toBe('2020-01-15');
    expect(subscription.nextRenewalDate! >= TODAY).toBe(true);
    expect(subscription.nextRenewalDate!.slice(8)).toBe('15');
    expect(subscription.daysUntilRenewal!).toBeGreaterThanOrEqual(0);
    expect(subscription.daysUntilRenewal!).toBeLessThanOrEqual(31);
  });

  it('does not get an end-of-month anchor stuck on the 28th', async () => {
    // Rolling a stored date forward month by month would take 31 January to 28
    // February and leave it there for ever. Adding N months to the ANCHOR gives
    // the 31st back in months that have one.
    const subscription = await createSubscription(auth, {
      name: 'Anchored on the 31st',
      amount: '10.00',
      renewalDate: '2020-01-31',
    });

    const next = subscription.nextRenewalDate!;
    const lastDayOfThatMonth = new Date(
      Date.UTC(Number(next.slice(0, 4)), Number(next.slice(5, 7)), 0),
    ).getUTCDate();

    expect(Number(next.slice(8))).toBe(Math.min(31, lastDayOfThatMonth));
  });

  it('advances a yearly subscription by whole years', async () => {
    const subscription = await createSubscription(auth, {
      name: 'Domain',
      amount: '1200.00',
      renewalDate: '2020-03-05',
      billingCycle: 'yearly',
    });

    expect(subscription.nextRenewalDate! >= TODAY).toBe(true);
    expect(subscription.nextRenewalDate!.slice(5)).toBe('03-05');
    expect(subscription.daysUntilRenewal!).toBeLessThanOrEqual(366);
  });

  it('leaves an anchor in the future alone', async () => {
    const subscription = await createSubscription(auth, {
      name: 'Later',
      amount: '10.00',
      renewalDate: dayOffset(45),
    });

    expect(subscription.nextRenewalDate).toBe(dayOffset(45));
    expect(subscription.daysUntilRenewal).toBe(45);
  });

  it('reports no next renewal for a cancelled subscription', async () => {
    const subscription = await createSubscription(auth, {
      name: 'Cancelled',
      amount: '10.00',
      renewalDate: dayOffset(3),
      isActive: false,
    });

    expect(subscription.nextRenewalDate).toBeNull();
    expect(subscription.daysUntilRenewal).toBeNull();
  });

  it('restores the schedule when a subscription is reactivated', async () => {
    const subscription = await createSubscription(auth, {
      name: 'Paused',
      amount: '10.00',
      renewalDate: dayOffset(4),
      isActive: false,
    });

    const response = await request(app)
      .patch(`/api/v1/subscriptions/${subscription.id}`)
      .set('Authorization', auth)
      .send({ isActive: true })
      .expect(200);

    expect((response.body as Envelope<Subscription>).data.nextRenewalDate).toBe(dayOffset(4));
  });

  it('refuses a billing cycle the column does not allow', async () => {
    await request(app)
      .post('/api/v1/subscriptions')
      .set('Authorization', auth)
      .send({ name: 'x', amount: '1.00', renewalDate: TODAY, billingCycle: 'weekly' })
      .expect(422);
  });

  it('deletes a subscription', async () => {
    const subscription = await createSubscription(auth, {
      name: 'Temporary',
      amount: '10.00',
      renewalDate: TODAY,
    });

    await request(app)
      .delete(`/api/v1/subscriptions/${subscription.id}`)
      .set('Authorization', auth)
      .expect(204);

    await request(app)
      .get(`/api/v1/subscriptions/${subscription.id}`)
      .set('Authorization', auth)
      .expect(404);
  });
});

describe('upcoming renewals', () => {
  let renewalAuth: string;

  beforeAll(async () => {
    renewalAuth = await tokenFor('money-renewals');

    await createSubscription(renewalAuth, {
      name: 'Soon',
      amount: '10.00',
      renewalDate: dayOffset(2),
    });
    await createSubscription(renewalAuth, {
      name: 'Later',
      amount: '10.00',
      renewalDate: dayOffset(45),
    });
    await createSubscription(renewalAuth, {
      name: 'Cancelled',
      amount: '10.00',
      renewalDate: dayOffset(1),
      isActive: false,
    });
  });

  it('returns only what bills inside the window', async () => {
    const response = await request(app)
      .get('/api/v1/subscriptions/upcoming?days=7')
      .set('Authorization', renewalAuth)
      .expect(200);

    const names = (response.body as Envelope<Subscription[]>).data.map((s) => s.name);
    expect(names).toEqual(['Soon']);
  });

  it('excludes a cancelled subscription without needing a predicate for it', async () => {
    const response = await request(app)
      .get('/api/v1/subscriptions/upcoming?days=365')
      .set('Authorization', renewalAuth)
      .expect(200);

    const names = (response.body as Envelope<Subscription[]>).data.map((s) => s.name);
    expect(names).not.toContain('Cancelled');
  });

  it('orders by the derived renewal date, soonest first', async () => {
    const response = await request(app)
      .get('/api/v1/subscriptions/upcoming?days=90')
      .set('Authorization', renewalAuth)
      .expect(200);

    const dates = (response.body as Envelope<Subscription[]>).data.map((s) => s.nextRenewalDate!);
    expect(dates).toEqual([...dates].sort());
  });

  it('defaults the window to thirty days', async () => {
    const response = await request(app)
      .get('/api/v1/subscriptions/upcoming')
      .set('Authorization', renewalAuth)
      .expect(200);

    expect((response.body as Envelope<Subscription[]>).data).toHaveLength(1);
  });

  it('refuses a window outside its bounds', async () => {
    await request(app)
      .get('/api/v1/subscriptions/upcoming?days=0')
      .set('Authorization', renewalAuth)
      .expect(422);

    await request(app)
      .get('/api/v1/subscriptions/upcoming?days=400')
      .set('Authorization', renewalAuth)
      .expect(422);
  });
});

describe('subscription costs', () => {
  let costAuth: string;

  beforeAll(async () => {
    costAuth = await tokenFor('money-costs');

    await createSubscription(costAuth, {
      name: 'Monthly',
      amount: '50.00',
      renewalDate: dayOffset(5),
    });
    // 100 / 12 is 8.3333..., twice. Rounding each row first gives 16.66; summing
    // first and rounding once gives 16.67. The second is correct.
    await createSubscription(costAuth, {
      name: 'Yearly A',
      amount: '100.00',
      renewalDate: dayOffset(5),
      billingCycle: 'yearly',
    });
    await createSubscription(costAuth, {
      name: 'Yearly B',
      amount: '100.00',
      renewalDate: dayOffset(5),
      billingCycle: 'yearly',
    });
    await createSubscription(costAuth, {
      name: 'Cancelled',
      amount: '999.00',
      renewalDate: dayOffset(5),
      isActive: false,
    });
    await createSubscription(costAuth, {
      name: 'In dollars',
      amount: '10.00',
      currency: 'USD',
      renewalDate: dayOffset(5),
    });
  });

  it('rounds the monthly equivalent once, on the sum', async () => {
    const response = await request(app)
      .get('/api/v1/subscriptions/summary')
      .set('Authorization', costAuth)
      .expect(200);

    const egp = (response.body as Envelope<Costs>).data.costs.find((c) => c.currency === 'EGP');
    expect(egp?.monthlyEquivalent).toBe('66.67');
  });

  it('reports the real monthly and yearly commitments separately', async () => {
    const response = await request(app)
      .get('/api/v1/subscriptions/summary')
      .set('Authorization', costAuth)
      .expect(200);

    const egp = (response.body as Envelope<Costs>).data.costs.find((c) => c.currency === 'EGP');
    expect(egp?.monthlyTotal).toBe('50.00');
    expect(egp?.yearlyTotal).toBe('200.00');
    expect(egp?.count).toBe(3);
  });

  it('keeps currencies apart', async () => {
    const response = await request(app)
      .get('/api/v1/subscriptions/summary')
      .set('Authorization', costAuth)
      .expect(200);

    const costs = (response.body as Envelope<Costs>).data.costs;
    expect(costs.map((c) => c.currency)).toEqual(['EGP', 'USD']);
    expect(costs.find((c) => c.currency === 'USD')?.monthlyEquivalent).toBe('10.00');
  });

  it('leaves a cancelled subscription out of the cost entirely', async () => {
    const response = await request(app)
      .get('/api/v1/subscriptions/summary')
      .set('Authorization', costAuth)
      .expect(200);

    const total = (response.body as Envelope<Costs>).data.costs
      .map((c) => c.monthlyEquivalent)
      .join(',');
    expect(total).not.toContain('999');
  });
});

describe('budgets', () => {
  let budgetAuth: string;
  let budget: Budget;

  beforeAll(async () => {
    budgetAuth = await tokenFor('money-budgets');

    budget = await createBudget(budgetAuth, {
      category: 'Food',
      monthlyLimit: '1000.00',
      month: ARCHIVE_MONTH,
    });

    await createExpense(budgetAuth, { amount: '300.00', category: 'food', spentOn: ARCHIVE_DAY });
    await createExpense(budgetAuth, { amount: '199.99', category: 'FOOD', spentOn: ARCHIVE_DAY });
    // None of these count: wrong currency, wrong category, wrong month.
    await createExpense(budgetAuth, {
      amount: '500.00',
      category: 'food',
      currency: 'USD',
      spentOn: ARCHIVE_DAY,
    });
    await createExpense(budgetAuth, { amount: '700.00', category: 'rent', spentOn: ARCHIVE_DAY });
    await createExpense(budgetAuth, { amount: '900.00', category: 'food', spentOn: '2001-07-15' });
  });

  it('starts with nothing spent and the whole limit remaining', async () => {
    const fresh = await createBudget(budgetAuth, {
      category: 'untouched',
      monthlyLimit: '100.00',
      month: ARCHIVE_MONTH,
    });

    expect(fresh.spent).toBe('0.00');
    expect(fresh.remaining).toBe('100.00');
    expect(fresh.percentUsed).toBe(0);
    expect(fresh.expenseCount).toBe(0);
  });

  it('echoes the month in the form it was given', async () => {
    expect(budget.month).toBe(ARCHIVE_MONTH);
  });

  it('counts spending in the same category regardless of case', async () => {
    const response = await request(app)
      .get(`/api/v1/budgets/${budget.id}`)
      .set('Authorization', budgetAuth)
      .expect(200);

    const current = (response.body as Envelope<Budget>).data;
    expect(current.spent).toBe('499.99');
    expect(current.expenseCount).toBe(2);
  });

  it('does not count spending in another currency', async () => {
    // The 500.00 USD expense shares the category and the month. Counting it
    // would make the budget report 999.99 of a limit denominated in EGP.
    const response = await request(app)
      .get(`/api/v1/budgets/${budget.id}`)
      .set('Authorization', budgetAuth)
      .expect(200);

    expect((response.body as Envelope<Budget>).data.spent).toBe('499.99');
  });

  it('floors the percentage rather than rounding it up', async () => {
    const response = await request(app)
      .get(`/api/v1/budgets/${budget.id}`)
      .set('Authorization', budgetAuth)
      .expect(200);

    // 499.99 of 1000 is 49.999%. Rounding would say 50.
    expect((response.body as Envelope<Budget>).data.percentUsed).toBe(49);
    expect((response.body as Envelope<Budget>).data.remaining).toBe('500.01');
  });

  it('reports going over rather than capping at the limit', async () => {
    const rent = await createBudget(budgetAuth, {
      category: 'rent',
      monthlyLimit: '600.00',
      month: ARCHIVE_MONTH,
    });

    expect(rent.spent).toBe('700.00');
    expect(rent.isOverBudget).toBe(true);
    expect(rent.percentUsed).toBe(116);
    expect(rent.remaining).toBe('-100.00');
  });

  it('survives a limit small enough to overflow a 32-bit percentage', async () => {
    // 700.00 against a limit of 0.01 is 7,000,000%. The ratio is returned as an
    // int, and nothing stops a user setting a limit of one cent, so an unbounded
    // expression here is a reachable 500 rather than a hypothetical.
    await createExpense(budgetAuth, {
      amount: '700.00',
      category: 'overflow',
      spentOn: '2001-11-15',
    });

    const tiny = await createBudget(budgetAuth, {
      category: 'overflow',
      monthlyLimit: '0.01',
      month: '2001-11',
    });

    expect(tiny.spent).toBe('700.00');
    expect(tiny.isOverBudget).toBe(true);
    expect(tiny.remaining).toBe('-699.99');
    // Saturated, not overflowed. Past a million percent the number says nothing
    // the isOverBudget flag has not already said.
    expect(tiny.percentUsed).toBe(1_000_000);
  });

  it('scopes spending to the budget month', async () => {
    const july = await createBudget(budgetAuth, {
      category: 'food',
      monthlyLimit: '1000.00',
      month: '2001-07',
    });

    expect(july.spent).toBe('900.00');
  });

  it('follows an expense that moves category, with no counter to update', async () => {
    const moving = await createExpense(budgetAuth, {
      amount: '0.01',
      category: 'misc',
      spentOn: ARCHIVE_DAY,
    });

    await request(app)
      .patch(`/api/v1/expenses/${moving.id}`)
      .set('Authorization', budgetAuth)
      .send({ category: 'food' })
      .expect(200);

    const response = await request(app)
      .get(`/api/v1/budgets/${budget.id}`)
      .set('Authorization', budgetAuth)
      .expect(200);

    expect((response.body as Envelope<Budget>).data.spent).toBe('500.00');
    expect((response.body as Envelope<Budget>).data.expenseCount).toBe(3);
  });

  it('refuses a second budget for the same category and month', async () => {
    const response = await request(app)
      .post('/api/v1/budgets')
      .set('Authorization', budgetAuth)
      .send({ category: 'food', monthlyLimit: '10.00', month: ARCHIVE_MONTH })
      .expect(409);

    expect(response.body.error.code).toBe('ALREADY_EXISTS');
  });

  it('treats a differently-cased duplicate as the same budget', async () => {
    await request(app)
      .post('/api/v1/budgets')
      .set('Authorization', budgetAuth)
      .send({ category: 'fOoD', monthlyLimit: '10.00', month: ARCHIVE_MONTH })
      .expect(409);
  });

  it('allows the same category in a different month', async () => {
    await request(app)
      .post('/api/v1/budgets')
      .set('Authorization', budgetAuth)
      .send({ category: 'food', monthlyLimit: '10.00', month: '2001-08' })
      .expect(201);
  });

  it('filters a listing by month', async () => {
    const response = await request(app)
      .get(`/api/v1/budgets?month=2001-08&limit=100`)
      .set('Authorization', budgetAuth)
      .expect(200);

    const months = (response.body as Envelope<Budget[]>).data.map((b) => b.month);
    expect(months).toEqual(['2001-08']);
  });

  it('refuses a month that does not exist', async () => {
    await request(app)
      .post('/api/v1/budgets')
      .set('Authorization', budgetAuth)
      .send({ category: 'x', monthlyLimit: '10.00', month: '2001-13' })
      .expect(422);
  });

  it('recomputes spending after the limit is raised', async () => {
    const response = await request(app)
      .patch(`/api/v1/budgets/${budget.id}`)
      .set('Authorization', budgetAuth)
      .send({ monthlyLimit: '2000.00' })
      .expect(200);

    const updated = (response.body as Envelope<Budget>).data;
    expect(updated.monthlyLimit).toBe('2000.00');
    expect(updated.spent).toBe('500.00');
    expect(updated.percentUsed).toBe(25);
  });

  it('deletes a budget without touching the expenses it measured', async () => {
    const disposable = await createBudget(budgetAuth, {
      category: 'rent',
      monthlyLimit: '10.00',
      month: '2001-09',
    });

    await request(app)
      .delete(`/api/v1/budgets/${disposable.id}`)
      .set('Authorization', budgetAuth)
      .expect(204);

    const remaining = await request(app)
      .get('/api/v1/expenses?category=rent&limit=100')
      .set('Authorization', budgetAuth)
      .expect(200);

    expect((remaining.body as Envelope<Expense[]>).data.length).toBeGreaterThan(0);
  });
});
