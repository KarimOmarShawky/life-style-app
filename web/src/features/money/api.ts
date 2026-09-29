/**
 * Money API — verified against `money.routes.ts` / `money.validation.ts` /
 * `money.controller.ts` / `money.dto.ts`.
 *
 * Critical contract details:
 * - Monetary values are decimal STRINGS end-to-end (never JS numbers).
 * - POST /money/transactions and POST /money/subscriptions/{id}/pay REQUIRE
 *   an `Idempotency-Key` UUID header.
 * - PATCH mutations carry `version` for optimistic concurrency
 *   (409 VERSION_CONFLICT on mismatch).
 * - Transactions/subscriptions lists return full `{ limit, hasMore,
 *   nextCursor }` meta; categories/budgets are plain arrays.
 */

import { apiFetch } from '@/lib/api/client';
import type { AuthSession } from '@/lib/auth/session';
import type {
  Budget,
  BudgetListResponse,
  Category,
  CategoryListResponse,
  PaySubscriptionResponse,
  ReportSummary,
  Subscription,
  SubscriptionListResponse,
  Transaction,
  TransactionListResponse
} from '@/types/api';

/* ------------------------------- Categories ------------------------------ */

export interface CategoryInput {
  kind: 'expense' | 'income';
  name: string;
  icon?: string | null;
  color?: string | null;
}

export interface CategoryUpdateInput {
  name?: string;
  icon?: string | null;
  color?: string | null;
  archived?: boolean;
  version?: number;
}

export const categoriesApi = {
  list(
    params: { kind?: 'expense' | 'income'; includeArchived?: boolean },
    auth: AuthSession
  ): Promise<CategoryListResponse> {
    return apiFetch<CategoryListResponse>('/money/categories', {
      query: {
        kind: params.kind,
        includeArchived: params.includeArchived ? 'true' : undefined
      },
      auth
    });
  },

  create(body: CategoryInput, auth: AuthSession): Promise<{ category: Category }> {
    return apiFetch<{ category: Category }>('/money/categories', { method: 'POST', body, auth });
  },

  update(
    id: string,
    body: CategoryUpdateInput,
    auth: AuthSession
  ): Promise<{ category: Category }> {
    return apiFetch<{ category: Category }>(`/money/categories/${id}`, {
      method: 'PATCH',
      body,
      auth
    });
  },

  archive(id: string, auth: AuthSession): Promise<void> {
    return apiFetch<void>(`/money/categories/${id}`, { method: 'DELETE', auth });
  }
};

/* ------------------------------ Transactions ----------------------------- */

export interface TransactionInput {
  kind: 'expense' | 'income';
  amount: string;
  currency: string;
  occurredOn: string;
  categoryId?: string | null;
  description?: string | null;
  merchant?: string | null;
  billingDate?: string | null;
}

export interface TransactionUpdateInput {
  kind?: 'expense' | 'income';
  amount?: string;
  currency?: string;
  occurredOn?: string;
  categoryId?: string | null;
  description?: string | null;
  merchant?: string | null;
  version?: number;
}

export interface ListTransactionsParams {
  kind?: 'expense' | 'income';
  categoryId?: string;
  from?: string;
  to?: string;
  currency?: string;
  sort?: 'occurredOn' | 'amount';
  limit?: number;
  cursor?: string;
}

export const transactionsApi = {
  list(params: ListTransactionsParams, auth: AuthSession): Promise<TransactionListResponse> {
    return apiFetch<TransactionListResponse>('/money/transactions', {
      query: {
        kind: params.kind,
        categoryId: params.categoryId,
        from: params.from,
        to: params.to,
        currency: params.currency,
        sort: params.sort,
        limit: params.limit,
        cursor: params.cursor
      },
      auth
    });
  },

  /** `idempotencyKey` is REQUIRED by the backend (UUID). */
  create(
    body: TransactionInput,
    idempotencyKey: string,
    auth: AuthSession
  ): Promise<{ transaction: Transaction }> {
    return apiFetch<{ transaction: Transaction }>('/money/transactions', {
      method: 'POST',
      body,
      idempotencyKey,
      auth
    });
  },

  get(id: string, auth: AuthSession): Promise<{ transaction: Transaction }> {
    return apiFetch<{ transaction: Transaction }>(`/money/transactions/${id}`, { auth });
  },

  update(
    id: string,
    body: TransactionUpdateInput,
    auth: AuthSession
  ): Promise<{ transaction: Transaction }> {
    return apiFetch<{ transaction: Transaction }>(`/money/transactions/${id}`, {
      method: 'PATCH',
      body,
      auth
    });
  },

  remove(id: string, auth: AuthSession): Promise<void> {
    return apiFetch<void>(`/money/transactions/${id}`, { method: 'DELETE', auth });
  }
};

/* ------------------------------ Subscriptions ---------------------------- */

export interface SubscriptionInput {
  name: string;
  amount: string;
  currency: string;
  billingUnit: 'week' | 'month' | 'year';
  billingInterval?: number;
  anchorDate: string;
  nextBillingDate?: string;
  categoryId?: string | null;
  reminderDaysBefore?: number | null;
  notes?: string | null;
}

export interface SubscriptionUpdateInput {
  name?: string;
  amount?: string;
  currency?: string;
  billingUnit?: 'week' | 'month' | 'year';
  billingInterval?: number;
  anchorDate?: string;
  nextBillingDate?: string;
  status?: 'active' | 'paused' | 'cancelled';
  cancelledOn?: string | null;
  categoryId?: string | null;
  reminderDaysBefore?: number | null;
  notes?: string | null;
  version?: number;
}

export const subscriptionsApi = {
  list(
    params: { status?: 'active' | 'paused' | 'cancelled'; limit?: number; cursor?: string },
    auth: AuthSession
  ): Promise<SubscriptionListResponse> {
    return apiFetch<SubscriptionListResponse>('/money/subscriptions', {
      query: { status: params.status, limit: params.limit, cursor: params.cursor },
      auth
    });
  },

  create(body: SubscriptionInput, auth: AuthSession): Promise<{ subscription: Subscription }> {
    return apiFetch<{ subscription: Subscription }>('/money/subscriptions', {
      method: 'POST',
      body,
      auth
    });
  },

  update(
    id: string,
    body: SubscriptionUpdateInput,
    auth: AuthSession
  ): Promise<{ subscription: Subscription }> {
    return apiFetch<{ subscription: Subscription }>(`/money/subscriptions/${id}`, {
      method: 'PATCH',
      body,
      auth
    });
  },

  remove(id: string, auth: AuthSession): Promise<void> {
    return apiFetch<void>(`/money/subscriptions/${id}`, { method: 'DELETE', auth });
  },

  /** Payment requires an Idempotency-Key UUID header. Cycle math is server-side. */
  pay(
    id: string,
    body: { amount?: string; occurredOn?: string },
    idempotencyKey: string,
    auth: AuthSession
  ): Promise<PaySubscriptionResponse> {
    return apiFetch<PaySubscriptionResponse>(`/money/subscriptions/${id}/pay`, {
      method: 'POST',
      body,
      idempotencyKey,
      auth
    });
  }
};

/* -------------------------------- Budgets -------------------------------- */

export interface BudgetInput {
  categoryId?: string | null;
  amountLimit: string;
  currency: string;
  period?: 'monthly';
}

export const budgetsApi = {
  list(auth: AuthSession): Promise<BudgetListResponse> {
    return apiFetch<BudgetListResponse>('/money/budgets', { auth });
  },

  create(body: BudgetInput, auth: AuthSession): Promise<{ budget: Budget }> {
    return apiFetch<{ budget: Budget }>('/money/budgets', { method: 'POST', body, auth });
  },

  update(
    id: string,
    body: { amountLimit?: string; version?: number },
    auth: AuthSession
  ): Promise<{ budget: Budget }> {
    return apiFetch<{ budget: Budget }>(`/money/budgets/${id}`, { method: 'PATCH', body, auth });
  },

  remove(id: string, auth: AuthSession): Promise<void> {
    return apiFetch<void>(`/money/budgets/${id}`, { method: 'DELETE', auth });
  }
};

/* -------------------------------- Reports -------------------------------- */

export interface ReportParams {
  from: string;
  to: string;
  currency?: string;
  groupBy?: 'none' | 'day' | 'week' | 'month';
}

export const reportsApi = {
  summary(params: ReportParams, auth: AuthSession): Promise<ReportSummary> {
    return apiFetch<ReportSummary>('/money/reports/summary', {
      query: {
        from: params.from,
        to: params.to,
        currency: params.currency,
        groupBy: params.groupBy
      },
      auth
    });
  }
};

/** Generate a client-side UUID for idempotency keys (never reused across submissions). */
export function newIdempotencyKey(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  // Fallback for older environments (still UUID-shaped per backend regex).
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (char) => {
    const random = (Math.random() * 16) | 0;
    const value = char === 'x' ? random : (random & 0x3) | 0x8;
    return value.toString(16);
  });
}
