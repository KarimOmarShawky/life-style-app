/**
 * Money domain types: expenses, subscriptions and budgets.
 *
 * MONETARY AMOUNTS ARE STRINGS, EVERYWHERE IN THIS FILE. They are strings in the
 * database (NUMERIC(14,2)), strings as they cross this process, and strings in
 * the JSON response.
 *
 * The reason is the same one the migration gives for choosing NUMERIC over
 * DOUBLE PRECISION: binary floating point cannot represent 0.10 exactly, so
 * sums drift. A JavaScript `number` IS a double, and `JSON.parse` turns a JSON
 * number into one. Parsing a NUMERIC into a `number` here, or publishing it as a
 * JSON number, would reintroduce on the way out the exact error the column type
 * was chosen to avoid. The `pg` driver already hands NUMERIC back as a string
 * for this reason; this feature keeps it that way rather than undoing it.
 *
 * The consequence for anything reading these types: never add amounts in
 * JavaScript. Every total in this feature is computed by PostgreSQL, which does
 * exact decimal arithmetic, and arrives already summed.
 */

export const BILLING_CYCLES = ['monthly', 'yearly'] as const;
export type BillingCycle = (typeof BILLING_CYCLES)[number];

// --- Expenses ---------------------------------------------------------------

export interface ExpenseRecord {
  readonly id: string;
  readonly userId: string;
  /** Exact decimal, as a string. Never a number. */
  readonly amount: string;
  readonly currency: string;
  readonly category: string;
  readonly spentOn: string;
  readonly note: string | null;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

export interface ExpenseResponse {
  readonly id: string;
  readonly amount: string;
  readonly currency: string;
  readonly category: string;
  readonly spentOn: string;
  readonly note: string | null;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface CreateExpenseInput {
  readonly amount: string;
  readonly currency?: string | undefined;
  readonly category: string;
  readonly spentOn?: string | undefined;
  readonly note?: string | null | undefined;
}

export interface UpdateExpenseInput {
  readonly amount?: string | undefined;
  readonly currency?: string | undefined;
  readonly category?: string | undefined;
  readonly spentOn?: string | undefined;
  readonly note?: string | null | undefined;
}

export interface ExpenseFilters {
  readonly category?: string | undefined;
  readonly currency?: string | undefined;
  readonly from?: string | undefined;
  readonly to?: string | undefined;
}

/**
 * One row of a spending report.
 *
 * Every total is grouped BY CURRENCY as well as by whatever else it groups by.
 * Adding 100 EGP to 100 USD produces 200 of nothing, and a report that does it
 * is worse than no report because it looks authoritative.
 */
export interface CurrencyTotal {
  readonly currency: string;
  readonly total: string;
  readonly count: number;
}

export interface CategoryTotal extends CurrencyTotal {
  readonly category: string;
}

export interface ExpenseSummaryResponse {
  readonly from: string;
  readonly to: string;
  readonly totals: readonly CurrencyTotal[];
  readonly byCategory: readonly CategoryTotal[];
}

// --- Subscriptions ----------------------------------------------------------

export interface SubscriptionRecord {
  readonly id: string;
  readonly userId: string;
  readonly name: string;
  readonly amount: string;
  readonly currency: string;
  /** The stored anchor date, which is NOT necessarily the next one due. */
  readonly renewalDate: string;
  readonly billingCycle: BillingCycle;
  readonly isActive: boolean;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

/**
 * A subscription together with when it next bills.
 *
 * `nextRenewalDate` is derived from the anchor and today, never stored, so a
 * subscription whose renewal date is months in the past still reports the right
 * answer without a job having to roll it forward. Null for an inactive
 * subscription: a cancelled subscription has no next billing date, and printing
 * one would claim it is still going to charge.
 */
export interface SubscriptionWithSchedule extends SubscriptionRecord {
  readonly nextRenewalDate: string | null;
  readonly daysUntilRenewal: number | null;
}

export interface SubscriptionResponse {
  readonly id: string;
  readonly name: string;
  readonly amount: string;
  readonly currency: string;
  readonly renewalDate: string;
  readonly nextRenewalDate: string | null;
  readonly daysUntilRenewal: number | null;
  readonly billingCycle: BillingCycle;
  readonly isActive: boolean;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface CreateSubscriptionInput {
  readonly name: string;
  readonly amount: string;
  readonly currency?: string | undefined;
  readonly renewalDate: string;
  readonly billingCycle?: BillingCycle | undefined;
  readonly isActive?: boolean | undefined;
}

export interface UpdateSubscriptionInput {
  readonly name?: string | undefined;
  readonly amount?: string | undefined;
  readonly currency?: string | undefined;
  readonly renewalDate?: string | undefined;
  readonly billingCycle?: BillingCycle | undefined;
  readonly isActive?: boolean | undefined;
}

/** What active subscriptions cost, normalized to a month, per currency. */
export interface SubscriptionCostRow {
  readonly currency: string;
  readonly monthlyEquivalent: string;
  readonly monthlyTotal: string;
  readonly yearlyTotal: string;
  readonly count: number;
}

export interface SubscriptionSummaryResponse {
  readonly costs: readonly SubscriptionCostRow[];
}

// --- Budgets ----------------------------------------------------------------

export interface BudgetRecord {
  readonly id: string;
  readonly userId: string;
  readonly category: string;
  readonly monthlyLimit: string;
  readonly currency: string;
  /** Always the first day of the month, enforced by a CHECK constraint. */
  readonly month: string;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

export interface BudgetWithSpending extends BudgetRecord {
  readonly spent: string;
  readonly remaining: string;
  readonly percentUsed: number;
  readonly isOverBudget: boolean;
  readonly expenseCount: number;
}

export interface BudgetResponse {
  readonly id: string;
  readonly category: string;
  readonly monthlyLimit: string;
  readonly currency: string;
  /** `YYYY-MM`, the form the client sends and the form it reads back. */
  readonly month: string;
  readonly spent: string;
  readonly remaining: string;
  readonly percentUsed: number;
  readonly isOverBudget: boolean;
  readonly expenseCount: number;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface CreateBudgetInput {
  readonly category: string;
  readonly monthlyLimit: string;
  readonly currency?: string | undefined;
  readonly month: string;
}

export interface UpdateBudgetInput {
  readonly category?: string | undefined;
  readonly monthlyLimit?: string | undefined;
  readonly currency?: string | undefined;
  readonly month?: string | undefined;
}

export interface BudgetFilters {
  readonly month?: string | undefined;
}
