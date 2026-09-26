/**
 * src/features/money/money.types.ts
 *
 * Implements Section 6.7 & 14.11–14.13: Categories, Transactions, Subscriptions, and Budgets domain types.
 */

export interface CategoryEntity {
  id: string;
  userId: string;
  kind: 'expense' | 'income';
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
  kind: 'expense' | 'income';
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
  billingUnit: 'week' | 'month' | 'year';
  billingInterval: number;
  anchorDate: string;
  nextBillingDate: string;
  status: 'active' | 'paused' | 'cancelled';
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
  period: 'monthly';
  createdAt: Date;
  updatedAt: Date;
  deletedAt: Date | null;
  version: number;
}
