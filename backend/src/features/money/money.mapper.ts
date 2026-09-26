/** Database record to client response (spec section 35). */
import type {
  BudgetResponse,
  BudgetWithSpending,
  ExpenseRecord,
  ExpenseResponse,
  SubscriptionResponse,
  SubscriptionWithSchedule,
} from './money.types';

export function toExpenseResponse(record: ExpenseRecord): ExpenseResponse {
  return {
    id: record.id,
    // Passed through as the string PostgreSQL produced. Converting to a number
    // here would be the one place in the feature that loses precision, and it
    // would do it on the way out, where nothing can detect it.
    amount: record.amount,
    currency: record.currency,
    category: record.category,
    spentOn: record.spentOn,
    note: record.note,
    createdAt: record.createdAt.toISOString(),
    updatedAt: record.updatedAt.toISOString(),
  };
}

export function toSubscriptionResponse(record: SubscriptionWithSchedule): SubscriptionResponse {
  return {
    id: record.id,
    name: record.name,
    amount: record.amount,
    currency: record.currency,
    // Both dates are published. `renewalDate` is what the user set and can edit;
    // `nextRenewalDate` is when it actually bills next. Showing only the derived
    // one would leave the user unable to see or correct the value they own, and
    // showing only the stored one would be wrong for every subscription whose
    // anchor is in the past.
    renewalDate: record.renewalDate,
    nextRenewalDate: record.nextRenewalDate,
    daysUntilRenewal: record.daysUntilRenewal,
    billingCycle: record.billingCycle,
    isActive: record.isActive,
    createdAt: record.createdAt.toISOString(),
    updatedAt: record.updatedAt.toISOString(),
  };
}

/** `2026-09-01` to `2026-09`, the form a budget is created with. */
export function toBudgetMonth(storedMonth: string): string {
  return storedMonth.slice(0, 7);
}

export function toBudgetResponse(record: BudgetWithSpending): BudgetResponse {
  return {
    id: record.id,
    category: record.category,
    monthlyLimit: record.monthlyLimit,
    currency: record.currency,
    month: toBudgetMonth(record.month),
    // Spending, what is left and how far through the limit the user is all come
    // from PostgreSQL already computed. Subtracting two amounts in JavaScript
    // would turn two exact decimals into two doubles and a wrong difference.
    spent: record.spent,
    remaining: record.remaining,
    percentUsed: record.percentUsed,
    isOverBudget: record.isOverBudget,
    expenseCount: record.expenseCount,
    createdAt: record.createdAt.toISOString(),
    updatedAt: record.updatedAt.toISOString(),
  };
}
