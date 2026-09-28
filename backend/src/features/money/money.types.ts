/**
 * src/features/money/money.types.ts
 *
 * Implements Section 6.7, 14.11 & AC-MON-01..07: Money domain types.
 */

export type TransactionKind = 'expense' | 'income';
export type SubscriptionStatus = 'active' | 'paused' | 'cancelled';
export type BillingUnit = 'week' | 'month' | 'year';
export type BudgetPeriod = 'monthly';
export type ReportGroupBy = 'none' | 'day' | 'week' | 'month';

export interface CategoryEntity {
  id: string;
  userId: string;
  kind: TransactionKind;
  name: string;
  icon: string | null;
  color: string | null;
  archivedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
  version: number;
}

export interface TransactionEntity {
  id: string;
  userId: string;
  kind: TransactionKind;
  amount: string;
  currency: string;
  occurredOn: string;
  categoryId: string | null;
  description: string | null;
  merchant: string | null;
  subscriptionId: string | null;
  billingDate: string | null;
  source: 'manual';
  idempotencyKey: string | null;
  idempotencyFingerprint: Buffer | null;
  createdAt: Date;
  updatedAt: Date;
  deletedAt: Date | null;
  version: number;
}

export interface SubscriptionEntity {
  id: string;
  userId: string;
  name: string;
  amount: string;
  currency: string;
  billingUnit: BillingUnit;
  billingInterval: number;
  anchorDate: string;
  nextBillingDate: string;
  status: SubscriptionStatus;
  cancelledOn: string | null;
  categoryId: string | null;
  reminderDaysBefore: number | null;
  notes: string | null;
  createdAt: Date;
  updatedAt: Date;
  deletedAt: Date | null;
  version: number;
}

export interface BudgetEntity {
  id: string;
  userId: string;
  categoryId: string | null;
  amountLimit: string;
  currency: string;
  period: BudgetPeriod;
  createdAt: Date;
  updatedAt: Date;
  deletedAt: Date | null;
  version: number;
}

export interface BudgetUsage {
  periodStart: string;
  periodEnd: string;
  spent: string;
  remaining: string;
  percentUsed: number;
  overspent: boolean;
}

export interface CreateCategoryInput {
  kind: TransactionKind;
  name: string;
  icon?: string | null | undefined;
  color?: string | null | undefined;
}

export interface UpdateCategoryInput {
  name?: string | undefined;
  icon?: string | null | undefined;
  color?: string | null | undefined;
  archived?: boolean | undefined;
  version?: number | undefined;
}

export interface CreateTransactionInput {
  kind: TransactionKind;
  amount: string;
  currency: string;
  occurredOn: string;
  categoryId?: string | null | undefined;
  description?: string | null | undefined;
  merchant?: string | null | undefined;
  subscriptionId?: string | null | undefined;
  billingDate?: string | null | undefined;
  idempotencyKey: string;
  idempotencyFingerprint: Buffer;
}

export interface UpdateTransactionInput {
  kind?: TransactionKind | undefined;
  amount?: string | undefined;
  currency?: string | undefined;
  occurredOn?: string | undefined;
  categoryId?: string | null | undefined;
  description?: string | null | undefined;
  merchant?: string | null | undefined;
  version?: number | undefined;
}

export interface ListTransactionsFilter {
  kind?: TransactionKind | undefined;
  categoryId?: string | undefined;
  from?: string | undefined;
  to?: string | undefined;
  currency?: string | undefined;
  minAmount?: string | undefined;
  maxAmount?: string | undefined;
  sort?: 'occurredOn' | 'amount' | undefined;
  limit?: number | undefined;
  cursor?: string | undefined;
}

export interface CreateSubscriptionInput {
  name: string;
  amount: string;
  currency: string;
  billingUnit: BillingUnit;
  billingInterval?: number | undefined;
  anchorDate: string;
  nextBillingDate?: string | undefined;
  categoryId?: string | null | undefined;
  reminderDaysBefore?: number | null | undefined;
  notes?: string | null | undefined;
}

export interface UpdateSubscriptionInput {
  name?: string | undefined;
  amount?: string | undefined;
  currency?: string | undefined;
  billingUnit?: BillingUnit | undefined;
  billingInterval?: number | undefined;
  anchorDate?: string | undefined;
  nextBillingDate?: string | undefined;
  status?: SubscriptionStatus | undefined;
  cancelledOn?: string | null | undefined;
  categoryId?: string | null | undefined;
  reminderDaysBefore?: number | null | undefined;
  notes?: string | null | undefined;
  version?: number | undefined;
}

export interface ListSubscriptionsFilter {
  status?: SubscriptionStatus | undefined;
  limit?: number | undefined;
  cursor?: string | undefined;
}

export interface PaySubscriptionInput {
  amount?: string | undefined;
  occurredOn?: string | undefined;
  idempotencyKey: string;
}

export interface CreateBudgetInput {
  categoryId?: string | null | undefined;
  amountLimit: string;
  currency: string;
  period?: BudgetPeriod | undefined;
}

export interface UpdateBudgetInput {
  amountLimit?: string | undefined;
  version?: number | undefined;
}

export interface ReportCategoryItem {
  categoryId: string | null;
  name: string;
  kind: TransactionKind;
  total: string;
  count: number;
  share: number;
}

export interface ReportSeriesItem {
  periodStart: string;
  income: string;
  expense: string;
}

export interface ReportSummary {
  currency: string;
  from: string;
  to: string;
  totals: {
    income: string;
    expense: string;
    net: string;
  };
  byCategory: ReportCategoryItem[];
  series?: ReportSeriesItem[] | undefined;
}

export interface ReportFilter {
  from: string;
  to: string;
  currency?: string | undefined;
  groupBy?: ReportGroupBy | undefined;
}
