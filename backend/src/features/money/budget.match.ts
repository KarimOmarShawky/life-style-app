/**
 * Which expenses a budget measures.
 *
 * Extracted from `budget.repository` because the dashboard counts budgets that
 * are over their limit, and it has to agree with the budgets screen exactly. Two
 * copies of this predicate would not fail loudly — they would drift, and the
 * symptom would be a home screen reporting two budgets over while the list shows
 * three, with no way to tell which is right.
 *
 * The rule itself is DD-023: an expense counts when its MONTH, its CATEGORY
 * (compared case-insensitively, agreeing with the unique index on
 * `(user_id, lower(category), month)`) and its CURRENCY all match. Currency is
 * part of it because 100 USD does not spend an EGP budget.
 *
 * This is a SQL fragment and nothing else: it runs no query and imports no
 * module, so depending on it is not one feature reaching into another's
 * repository (see feature-architecture.md).
 */

/**
 * The WHERE clause matching `expenses e` against a budget, given the alias the
 * budget row is bound to.
 *
 * `user_id` is part of the match, not an afterthought: without it a budget would
 * be measured against every user's spending, and nothing about the request would
 * look wrong.
 */
export function budgetExpenseMatch(budgetAlias: string): string {
  return `e.user_id = ${budgetAlias}.user_id
      AND lower(e.category) = lower(${budgetAlias}.category)
      AND e.currency = ${budgetAlias}.currency
      AND e.spent_on >= ${budgetAlias}.month
      AND e.spent_on < (${budgetAlias}.month + INTERVAL '1 month')`;
}

/**
 * The spending total for one budget, rounded rather than cast.
 *
 * A cast to `numeric(14,2)` raises a numeric-overflow error — and therefore a
 * 500 — for a total larger than the column a single expense fits in. `round`
 * gives the same two decimal places with no upper bound, and turns a null into
 * "0.00" rather than "0".
 */
export const BUDGET_SPENT_SUM = `round(coalesce(sum(e.amount), 0), 2)`;
