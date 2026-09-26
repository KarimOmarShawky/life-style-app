/**
 * Expense persistence.
 *
 * TWO RULES SHAPE EVERY QUERY HERE.
 *
 * Amounts stay decimal. `sum(amount)` runs in PostgreSQL, which adds NUMERIC
 * exactly, and the result crosses into JavaScript as a string. Nothing in this
 * file, or anything downstream of it, adds two amounts together.
 *
 * Totals always group by currency. A user with expenses in EGP and USD has two
 * separate answers to "how much did I spend", and a single number would be the
 * sum of two incompatible quantities. The report returns one row per currency
 * rather than pretending otherwise.
 *
 * Ownership is in the WHERE clause of every statement (DD-008).
 */
import { formatCalendarDate } from '@/core/utils/calendar-date';
import type { Cursor } from '@/core/utils/pagination';
import { query } from '@/infrastructure/database/postgres/pool';

import type {
  CategoryTotal,
  CreateExpenseInput,
  CurrencyTotal,
  ExpenseFilters,
  ExpenseRecord,
  UpdateExpenseInput,
} from './money.types';

interface ExpenseRow {
  id: string;
  user_id: string;
  amount: string;
  currency: string;
  category: string;
  spent_on: Date;
  note: string | null;
  created_at: Date;
  updated_at: Date;
}

function toExpenseRecord(row: ExpenseRow): ExpenseRecord {
  return {
    id: row.id,
    userId: row.user_id,
    // Already a string: node-postgres does not parse NUMERIC into a JavaScript
    // number precisely because that conversion is lossy. Left alone on purpose.
    amount: row.amount,
    currency: row.currency,
    category: row.category,
    spentOn: formatCalendarDate(row.spent_on),
    note: row.note,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

/** Published columns, qualified for SELECT and bare for RETURNING. */
const COLUMNS = `e.id, e.user_id, e.amount, e.currency, e.category, e.spent_on, e.note,
                 e.created_at, e.updated_at`;
const RETURNED = `id, user_id, amount, currency, category, spent_on, note,
                  created_at, updated_at`;

export async function insertExpense(
  userId: string,
  input: CreateExpenseInput,
): Promise<ExpenseRecord> {
  const result = await query<ExpenseRow>(
    `INSERT INTO expenses (user_id, amount, currency, category, spent_on, note)
     VALUES ($1, $2::numeric, coalesce($3, 'EGP'), $4, coalesce($5::date, CURRENT_DATE), $6)
     RETURNING ${RETURNED}`,
    [
      userId,
      input.amount,
      input.currency ?? null,
      input.category,
      input.spentOn ?? null,
      input.note ?? null,
    ],
  );

  const row = result.rows[0];
  if (!row) {
    throw new Error('INSERT ... RETURNING produced no row');
  }
  return toExpenseRecord(row);
}

export async function findExpenseById(
  userId: string,
  expenseId: string,
): Promise<ExpenseRecord | undefined> {
  const result = await query<ExpenseRow>(
    `SELECT ${COLUMNS} FROM expenses e WHERE e.id = $1 AND e.user_id = $2`,
    [expenseId, userId],
  );

  const row = result.rows[0];
  return row ? toExpenseRecord(row) : undefined;
}

/**
 * A page of expenses, newest SPENDING first.
 *
 * Ordered by `spent_on` rather than `created_at`, because a list of last month's
 * receipts typed in this morning is unusable in entry order. The keyset is
 * therefore `(spent_on, id)`, and the cursor the service hands back is built
 * from the same pair.
 *
 * Category matching is case-insensitive, to agree with the unique index on
 * budgets, which is `(user_id, lower(category), month)`. If filtering here were
 * case-sensitive, a budget for "Food" would cover expenses that a list filtered
 * by "Food" would not show.
 */
export async function listExpenses(
  userId: string,
  limit: number,
  cursor: Cursor | undefined,
  filters: ExpenseFilters,
): Promise<ExpenseRecord[]> {
  const shared = [
    userId,
    filters.category ?? null,
    filters.currency ?? null,
    filters.from ?? null,
    filters.to ?? null,
  ];

  const predicates = `
    WHERE e.user_id = $1
      AND ($2::text IS NULL OR lower(e.category) = lower($2))
      AND ($3::text IS NULL OR e.currency = $3)
      AND ($4::date IS NULL OR e.spent_on >= $4::date)
      AND ($5::date IS NULL OR e.spent_on <= $5::date)`;

  if (cursor) {
    const result = await query<ExpenseRow>(
      `SELECT ${COLUMNS} FROM expenses e
       ${predicates}
         AND (e.spent_on, e.id) < ($6::date, $7::uuid)
       ORDER BY e.spent_on DESC, e.id DESC
       LIMIT $8`,
      [...shared, cursor.createdAt, cursor.id, limit + 1],
    );
    return result.rows.map(toExpenseRecord);
  }

  const result = await query<ExpenseRow>(
    `SELECT ${COLUMNS} FROM expenses e
     ${predicates}
     ORDER BY e.spent_on DESC, e.id DESC
     LIMIT $6`,
    [...shared, limit + 1],
  );
  return result.rows.map(toExpenseRecord);
}

export async function updateExpense(
  userId: string,
  expenseId: string,
  input: UpdateExpenseInput,
): Promise<ExpenseRecord | undefined> {
  const result = await query<ExpenseRow>(
    `UPDATE expenses e
        SET amount   = CASE WHEN $3::boolean  THEN $4::numeric ELSE e.amount END,
            currency = CASE WHEN $5::boolean  THEN $6::text    ELSE e.currency END,
            category = CASE WHEN $7::boolean  THEN $8::text    ELSE e.category END,
            spent_on = CASE WHEN $9::boolean  THEN $10::date   ELSE e.spent_on END,
            note     = CASE WHEN $11::boolean THEN $12::text   ELSE e.note END
      WHERE e.id = $1 AND e.user_id = $2
      RETURNING ${RETURNED}`,
    [
      expenseId,
      userId,
      input.amount !== undefined,
      input.amount ?? null,
      input.currency !== undefined,
      input.currency ?? null,
      input.category !== undefined,
      input.category ?? null,
      input.spentOn !== undefined,
      input.spentOn ?? null,
      input.note !== undefined,
      input.note ?? null,
    ],
  );

  const row = result.rows[0];
  return row ? toExpenseRecord(row) : undefined;
}

export async function deleteExpense(userId: string, expenseId: string): Promise<boolean> {
  const result = await query(`DELETE FROM expenses WHERE id = $1 AND user_id = $2`, [
    expenseId,
    userId,
  ]);
  return (result.rowCount ?? 0) > 0;
}

interface TotalRow {
  currency: string;
  total: string;
  entry_count: number;
}

interface CategoryRow extends TotalRow {
  category: string;
}

/** Spending over a date range, one row per currency. */
export async function totalsByCurrency(
  userId: string,
  from: string,
  to: string,
): Promise<CurrencyTotal[]> {
  const result = await query<TotalRow>(
    `SELECT e.currency, sum(e.amount)::text AS total, count(*)::int AS entry_count
       FROM expenses e
      WHERE e.user_id = $1 AND e.spent_on >= $2::date AND e.spent_on <= $3::date
      GROUP BY e.currency
      ORDER BY e.currency`,
    [userId, from, to],
  );

  return result.rows.map((row) => ({
    currency: row.currency,
    total: row.total,
    count: row.entry_count,
  }));
}

/**
 * Spending over a date range, one row per category and currency.
 *
 * Grouped by `lower(category)` so "Food" and "food" are one line rather than
 * two, which is the same rule budgets use. The label is `min(category)`: some
 * spelling the user actually typed, chosen deterministically, rather than a
 * lowercased version of it that they never wrote.
 */
export async function totalsByCategory(
  userId: string,
  from: string,
  to: string,
): Promise<CategoryTotal[]> {
  const result = await query<CategoryRow>(
    `SELECT min(e.category) AS category, e.currency,
            sum(e.amount)::text AS total, count(*)::int AS entry_count
       FROM expenses e
      WHERE e.user_id = $1 AND e.spent_on >= $2::date AND e.spent_on <= $3::date
      GROUP BY lower(e.category), e.currency
      ORDER BY sum(e.amount) DESC, min(e.category) ASC`,
    [userId, from, to],
  );

  return result.rows.map((row) => ({
    category: row.category,
    currency: row.currency,
    total: row.total,
    count: row.entry_count,
  }));
}
