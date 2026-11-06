// Types for retained subscriptions and their legacy category references.

export type TransactionKind = 'expense' | 'income';
export type SubscriptionStatus = 'active' | 'paused' | 'cancelled';
export type BillingUnit = 'week' | 'month' | 'year';
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

export interface SubscriptionEntity {
  id: string;
  userId: string;
  name: string;
  amount: string;
  amountScale: number | null;
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
