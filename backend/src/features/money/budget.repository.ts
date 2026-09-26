/**
 * Budget persistence, and the spending derived against each one.
 *
 * A BUDGET IS A LIMIT, NOT A COUNTER. Nothing here stores how much has been
 * spent against it. The figure is a sum over the expenses that fall inside the
 * budget's month, category and currency, computed on every read, so it cannot
 * disagree with the expense list the user is looking at. Storing a running total
 * would mean every expense create, update and delete had to adjust it — and
 * editing an expense's date, category, currency or amount would have to adjust
 * two budgets, the one it left and the one it joined. The first path that
 * forgets leaves a budget quietly wrong.
 *
 * THREE THINGS HAVE TO MATCH for an expense to count against a budget:
 *
 *   month     the expense falls inside the budget's calendar month
 *   category  compared case-insensitively, the same way the unique index on
 *             (user_id, lower(category), month) treats it, so "Food" and "food"
 *             are one budget and one bucket of spending
 *   currency  100 USD does not spend an EGP budget. Without this predicate a
 *             budget would be measured against a total that is the sum of two
 *             different units, and would report nonsense with total confidence
 *
 * Ownership is in the WHERE clause of every statement (DD-008).
 */
import { formatCalendarDate } from '@/core/utils/calendar-date';
import type { Cursor } from '@/core/utils/pagination';
import { query } from '@/infrastructure/database/postgres/pool';

import { BUDGET_SPENT_SUM, budgetExpenseMatch } from './budget.match';

import type { BudgetWithSpending, CreateBudgetInput, UpdateBudgetInput } from './money.types';

interface BudgetRow {
  id: string;
  user_id: string;
  category: string;
  monthly_limit: string;
  currency: string;
  month: Date;
  created_at: Date;
  updated_at: Date;
  spent: string;
  remaining: string;
  percent_used: number;
  is_over_budget: boolean;
  entry_count: number;
}

function toBudgetRecord(row: BudgetRow): BudgetWithSpending {
  return {
    id: row.id,
    userId: row.user_id,
    category: row.category,
    monthlyLimit: row.monthly_limit,
    currency: row.currency,
    month: formatCalendarDate(row.month),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    spent: row.spent,
    remaining: row.remaining,
    percentUsed: row.percent_used,
    isOverBudget: row.is_over_budget,
    expenseCount: row.entry_count,
  };
}

/**
 * The spending sum, as one lateral join rather than several correlated
 * subqueries, so the expenses for a budget are scanned once and not once per
 * derived field.
 *
 * `percent_used` is floored, not rounded. A budget at 99.6% used would round to
 * 100 and tell the user they have nothing left while they still do; flooring can
 * only ever understate how far along they are, which is the safe direction for
 * a number someone is about to make a spending decision from. It is not capped
 * at 100: going over is exactly what the user needs to see.
 *
 * It IS bounded at a million percent, which is not a display decision. The ratio
 * is returned as a 32-bit integer, and a budget of 0.01 with a few hundred
 * thousand spent against it overflows one — a reachable 500, since nothing stops
 * a user setting a limit of one cent. Past a million percent the number carries
 * no information anyway.
 *
 * The sum is rounded rather than cast to numeric(14,2): a cast would raise a
 * numeric-overflow error, and therefore a 500, for a total larger than the column
 * a single expense fits in. `round(..., 2)` gives the same two decimal places
 * with no upper bound, and turns a null into "0.00" rather than "0".
 */
const SELECT_WITH_SPENDING = `
  SELECT b.id, b.user_id, b.category, b.monthly_limit, b.currency, b.month,
         b.created_at, b.updated_at,
         sp.spent::text AS spent,
         (b.monthly_limit - sp.spent)::text AS remaining,
         least(floor(sp.spent * 100 / b.monthly_limit), 1000000)::int AS percent_used,
         (sp.spent > b.monthly_limit) AS is_over_budget,
         sp.entry_count
    FROM budgets b
    CROSS JOIN LATERAL (
      SELECT ${BUDGET_SPENT_SUM} AS spent,
             count(e.id)::int AS entry_count
        FROM expenses e
       WHERE ${budgetExpenseMatch('b')}
    ) sp`;

export async function insertBudget(
  userId: string,
  input: CreateBudgetInput,
): Promise<BudgetWithSpending> {
  const inserted = await query<{ id: string }>(
    `INSERT INTO budgets (user_id, category, monthly_limit, currency, month)
     VALUES ($1, $2, $3::numeric, coalesce($4, 'EGP'), $5::date)
     RETURNING id`,
    [userId, input.category, input.monthlyLimit, input.currency ?? null, input.month],
  );

  const id = inserted.rows[0]?.id;
  if (id === undefined) {
    throw new Error('INSERT ... RETURNING produced no row');
  }

  const created = await findBudgetById(userId, id);
  if (!created) {
    throw new Error('budget vanished immediately after insert');
  }
  return created;
}

export async function findBudgetById(
  userId: string,
  budgetId: string,
): Promise<BudgetWithSpending | undefined> {
  const result = await query<BudgetRow>(
    `${SELECT_WITH_SPENDING} WHERE b.id = $1 AND b.user_id = $2`,
    [budgetId, userId],
  );

  const row = result.rows[0];
  return row ? toBudgetRecord(row) : undefined;
}

export async function listBudgets(
  userId: string,
  limit: number,
  cursor: Cursor | undefined,
  month: string | undefined,
): Promise<BudgetWithSpending[]> {
  const shared = [userId, month ?? null];

  if (cursor) {
    const result = await query<BudgetRow>(
      `${SELECT_WITH_SPENDING}
        WHERE b.user_id = $1
          AND ($2::date IS NULL OR b.month = $2::date)
          AND (b.created_at, b.id) < ($3, $4)
        ORDER BY b.created_at DESC, b.id DESC
        LIMIT $5`,
      [...shared, cursor.createdAt, cursor.id, limit + 1],
    );
    return result.rows.map(toBudgetRecord);
  }

  const result = await query<BudgetRow>(
    `${SELECT_WITH_SPENDING}
      WHERE b.user_id = $1
        AND ($2::date IS NULL OR b.month = $2::date)
      ORDER BY b.created_at DESC, b.id DESC
      LIMIT $3`,
    [...shared, limit + 1],
  );
  return result.rows.map(toBudgetRecord);
}

export async function updateBudget(
  userId: string,
  budgetId: string,
  input: UpdateBudgetInput,
): Promise<BudgetWithSpending | undefined> {
  const result = await query<{ id: string }>(
    `UPDATE budgets b
        SET category      = CASE WHEN $3::boolean THEN $4::text    ELSE b.category END,
            monthly_limit = CASE WHEN $5::boolean THEN $6::numeric ELSE b.monthly_limit END,
            currency      = CASE WHEN $7::boolean THEN $8::text    ELSE b.currency END,
            month         = CASE WHEN $9::boolean THEN $10::date   ELSE b.month END
      WHERE b.id = $1 AND b.user_id = $2
      RETURNING id`,
    [
      budgetId,
      userId,
      input.category !== undefined,
      input.category ?? null,
      input.monthlyLimit !== undefined,
      input.monthlyLimit ?? null,
      input.currency !== undefined,
      input.currency ?? null,
      input.month !== undefined,
      input.month ?? null,
    ],
  );

  if (result.rowCount === 0) {
    return undefined;
  }
  return findBudgetById(userId, budgetId);
}

export async function deleteBudget(userId: string, budgetId: string): Promise<boolean> {
  // Only the limit goes. The expenses it was measuring are untouched: they are
  // the record of what happened, and the budget was only an opinion about it.
  const result = await query(`DELETE FROM budgets WHERE id = $1 AND user_id = $2`, [
    budgetId,
    userId,
  ]);
  return (result.rowCount ?? 0) > 0;
}
