'use client';

import {
  useMutation,
  useQuery,
  useQueryClient,
  type UseMutationResult,
  type UseQueryResult
} from '@tanstack/react-query';
import { recurringTasksApi, type ListRecurringParams } from './api';
import { useAuth } from '@/lib/auth/auth-provider';
import type {
  CreateRecurringTaskBody,
  RecurringTask,
  RecurringTaskListResponse,
  UpdateRecurringTaskBody
} from '@/types/api';
import { ApiError } from '@/lib/api/errors';

export const recurringKeys = {
  all: ['recurring-tasks'] as const,
  list: (params: ListRecurringParams) => ['recurring-tasks', 'list', params] as const
};

export function useRecurringTasks(
  params: ListRecurringParams
): UseQueryResult<RecurringTaskListResponse, ApiError> {
  const { session } = useAuth();
  return useQuery<RecurringTaskListResponse, ApiError>({
    queryKey: recurringKeys.list(params),
    queryFn: () => recurringTasksApi.list(params, session)
  });
}

function useInvalidate(): () => void {
  const queryClient = useQueryClient();
  return () => {
    void queryClient.invalidateQueries({ queryKey: recurringKeys.all });
    void queryClient.invalidateQueries({ queryKey: ['tasks'] });
  };
}

export function useCreateRecurringTask(): UseMutationResult<
  { recurringTask: RecurringTask },
  ApiError,
  CreateRecurringTaskBody
> {
  const { session } = useAuth();
  const invalidate = useInvalidate();
  return useMutation({
    mutationFn: (body: CreateRecurringTaskBody) => recurringTasksApi.create(body, session),
    onSuccess: invalidate
  });
}

export function useUpdateRecurringTask(): UseMutationResult<
  { recurringTask: RecurringTask },
  ApiError,
  { id: string; body: UpdateRecurringTaskBody }
> {
  const { session } = useAuth();
  const invalidate = useInvalidate();
  return useMutation({
    mutationFn: ({ id, body }: { id: string; body: UpdateRecurringTaskBody }) =>
      recurringTasksApi.update(id, body, session),
    onSuccess: invalidate
  });
}

export function useDeleteRecurringTask(): UseMutationResult<void, ApiError, string> {
  const { session } = useAuth();
  const invalidate = useInvalidate();
  return useMutation({
    mutationFn: (id: string) => recurringTasksApi.remove(id, session),
    onSuccess: invalidate
  });
}
