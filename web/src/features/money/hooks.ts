'use client';

import {
  useMutation,
  useQuery,
  useQueryClient,
  type UseMutationResult,
  type UseQueryResult
} from '@tanstack/react-query';
import {
  budgetsApi,
  categoriesApi,
  reportsApi,
  subscriptionsApi,
  transactionsApi,
  type BudgetInput,
  type CategoryInput,
  type CategoryUpdateInput,
  type ListTransactionsParams,
  type ReportParams,
  type SubscriptionInput,
  type SubscriptionUpdateInput,
  type TransactionInput,
  type TransactionUpdateInput
} from './api';
import { useAuth } from '@/lib/auth/auth-provider';
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
import { ApiError } from '@/lib/api/errors';

export const moneyKeys = {
  all: ['money'] as const,
  categories: (includeArchived: boolean) => ['money', 'categories', includeArchived] as const,
  transactions: (params: ListTransactionsParams) => ['money', 'transactions', params] as const,
  subscriptions: (status: string) => ['money', 'subscriptions', status] as const,
  budgets: ['money', 'budgets'] as const,
  report: (params: ReportParams) => ['money', 'report', params] as const
};

function useInvalidateMoney(): () => void {
  const queryClient = useQueryClient();
  return () => {
    void queryClient.invalidateQueries({ queryKey: moneyKeys.all });
  };
}

/* ------------------------------- Categories ------------------------------ */

export function useCategories(
  includeArchived = false
): UseQueryResult<CategoryListResponse, ApiError> {
  const { session } = useAuth();
  return useQuery<CategoryListResponse, ApiError>({
    queryKey: moneyKeys.categories(includeArchived),
    queryFn: () => categoriesApi.list({ includeArchived }, session)
  });
}

export function useCreateCategory(): UseMutationResult<
  { category: Category },
  ApiError,
  CategoryInput
> {
  const { session } = useAuth();
  const invalidate = useInvalidateMoney();
  return useMutation({
    mutationFn: (body: CategoryInput) => categoriesApi.create(body, session),
    onSuccess: invalidate
  });
}

export function useUpdateCategory(): UseMutationResult<
  { category: Category },
  ApiError,
  { id: string; body: CategoryUpdateInput }
> {
  const { session } = useAuth();
  const invalidate = useInvalidateMoney();
  return useMutation({
    mutationFn: ({ id, body }: { id: string; body: CategoryUpdateInput }) =>
      categoriesApi.update(id, body, session),
    onSuccess: invalidate
  });
}

export function useArchiveCategory(): UseMutationResult<void, ApiError, string> {
  const { session } = useAuth();
  const invalidate = useInvalidateMoney();
  return useMutation({
    mutationFn: (id: string) => categoriesApi.archive(id, session),
    onSuccess: invalidate
  });
}

/* ------------------------------ Transactions ----------------------------- */

export function useTransactions(
  params: ListTransactionsParams
): UseQueryResult<TransactionListResponse, ApiError> {
  const { session } = useAuth();
  return useQuery<TransactionListResponse, ApiError>({
    queryKey: moneyKeys.transactions(params),
    queryFn: () => transactionsApi.list(params, session)
  });
}

export function useCreateTransaction(): UseMutationResult<
  { transaction: Transaction },
  ApiError,
  { body: TransactionInput; idempotencyKey: string }
> {
  const { session } = useAuth();
  const invalidate = useInvalidateMoney();
  return useMutation({
    mutationFn: ({ body, idempotencyKey }: { body: TransactionInput; idempotencyKey: string }) =>
      transactionsApi.create(body, idempotencyKey, session),
    onSuccess: invalidate
  });
}

export function useUpdateTransaction(): UseMutationResult<
  { transaction: Transaction },
  ApiError,
  { id: string; body: TransactionUpdateInput }
> {
  const { session } = useAuth();
  const invalidate = useInvalidateMoney();
  return useMutation({
    mutationFn: ({ id, body }: { id: string; body: TransactionUpdateInput }) =>
      transactionsApi.update(id, body, session),
    onSuccess: invalidate
  });
}

export function useDeleteTransaction(): UseMutationResult<void, ApiError, string> {
  const { session } = useAuth();
  const invalidate = useInvalidateMoney();
  return useMutation({
    mutationFn: (id: string) => transactionsApi.remove(id, session),
    onSuccess: invalidate
  });
}

/* ------------------------------ Subscriptions ---------------------------- */

export function useSubscriptions(
  status: string
): UseQueryResult<SubscriptionListResponse, ApiError> {
  const { session } = useAuth();
  return useQuery<SubscriptionListResponse, ApiError>({
    queryKey: moneyKeys.subscriptions(status),
    queryFn: () =>
      subscriptionsApi.list(
        {
          status: (status || undefined) as 'active' | 'paused' | 'cancelled' | undefined,
          limit: 50
        },
        session
      )
  });
}

export function useCreateSubscription(): UseMutationResult<
  { subscription: Subscription },
  ApiError,
  SubscriptionInput
> {
  const { session } = useAuth();
  const invalidate = useInvalidateMoney();
  return useMutation({
    mutationFn: (body: SubscriptionInput) => subscriptionsApi.create(body, session),
    onSuccess: invalidate
  });
}

export function useUpdateSubscription(): UseMutationResult<
  { subscription: Subscription },
  ApiError,
  { id: string; body: SubscriptionUpdateInput }
> {
  const { session } = useAuth();
  const invalidate = useInvalidateMoney();
  return useMutation({
    mutationFn: ({ id, body }: { id: string; body: SubscriptionUpdateInput }) =>
      subscriptionsApi.update(id, body, session),
    onSuccess: invalidate
  });
}

export function useDeleteSubscription(): UseMutationResult<void, ApiError, string> {
  const { session } = useAuth();
  const invalidate = useInvalidateMoney();
  return useMutation({
    mutationFn: (id: string) => subscriptionsApi.remove(id, session),
    onSuccess: invalidate
  });
}

export function usePaySubscription(): UseMutationResult<
  PaySubscriptionResponse,
  ApiError,
  { id: string; idempotencyKey: string }
> {
  const { session } = useAuth();
  const invalidate = useInvalidateMoney();
  return useMutation({
    mutationFn: ({ id, idempotencyKey }: { id: string; idempotencyKey: string }) =>
      subscriptionsApi.pay(id, {}, idempotencyKey, session),
    onSuccess: invalidate
  });
}

/* -------------------------------- Budgets -------------------------------- */

export function useBudgets(): UseQueryResult<BudgetListResponse, ApiError> {
  const { session } = useAuth();
  return useQuery<BudgetListResponse, ApiError>({
    queryKey: moneyKeys.budgets,
    queryFn: () => budgetsApi.list(session)
  });
}

export function useCreateBudget(): UseMutationResult<{ budget: Budget }, ApiError, BudgetInput> {
  const { session } = useAuth();
  const invalidate = useInvalidateMoney();
  return useMutation({
    mutationFn: (body: BudgetInput) => budgetsApi.create(body, session),
    onSuccess: invalidate
  });
}

export function useUpdateBudget(): UseMutationResult<
  { budget: Budget },
  ApiError,
  { id: string; body: { amountLimit?: string; version?: number } }
> {
  const { session } = useAuth();
  const invalidate = useInvalidateMoney();
  return useMutation({
    mutationFn: ({ id, body }: { id: string; body: { amountLimit?: string; version?: number } }) =>
      budgetsApi.update(id, body, session),
    onSuccess: invalidate
  });
}

export function useDeleteBudget(): UseMutationResult<void, ApiError, string> {
  const { session } = useAuth();
  const invalidate = useInvalidateMoney();
  return useMutation({
    mutationFn: (id: string) => budgetsApi.remove(id, session),
    onSuccess: invalidate
  });
}

/* -------------------------------- Reports -------------------------------- */

export function useReportSummary(
  params: ReportParams | null
): UseQueryResult<ReportSummary, ApiError> {
  const { session } = useAuth();
  return useQuery<ReportSummary, ApiError>({
    queryKey: moneyKeys.report(params ?? ({ from: '', to: '' } as ReportParams)),
    queryFn: () => reportsApi.summary(params as ReportParams, session),
    enabled: Boolean(params)
  });
}
