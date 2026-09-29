'use client';

import {
  useMutation,
  useQuery,
  useQueryClient,
  type UseMutationResult,
  type UseQueryResult
} from '@tanstack/react-query';
import { tasksApi, type ListTasksParams } from './api';
import { useAuth } from '@/lib/auth/auth-provider';
import type { CreateTaskBody, Task, TaskListResponse, UpdateTaskBody } from '@/types/api';
import { ApiError } from '@/lib/api/errors';

export const tasksKeys = {
  all: ['tasks'] as const,
  list: (params: ListTasksParams) => ['tasks', 'list', params] as const,
  detail: (id: string) => ['tasks', 'detail', id] as const
};

export function useTasks(params: ListTasksParams): UseQueryResult<TaskListResponse, ApiError> {
  const { session } = useAuth();
  return useQuery<TaskListResponse, ApiError>({
    queryKey: tasksKeys.list(params),
    queryFn: () => tasksApi.list(params, session)
  });
}

export function useTask(id: string | null): UseQueryResult<{ task: Task }, ApiError> {
  const { session } = useAuth();
  return useQuery<{ task: Task }, ApiError>({
    queryKey: tasksKeys.detail(id ?? 'none'),
    queryFn: () => tasksApi.get(id as string, session),
    enabled: Boolean(id)
  });
}

function useInvalidateTasks(): () => void {
  const queryClient = useQueryClient();
  return () => {
    void queryClient.invalidateQueries({ queryKey: tasksKeys.all });
  };
}

export function useCreateTask(): UseMutationResult<{ task: Task }, ApiError, CreateTaskBody> {
  const { session } = useAuth();
  const invalidate = useInvalidateTasks();
  return useMutation<{ task: Task }, ApiError, CreateTaskBody>({
    mutationFn: (body) => tasksApi.create(body, session),
    onSuccess: invalidate
  });
}

export function useUpdateTask(): UseMutationResult<
  { task: Task },
  ApiError,
  { id: string; body: UpdateTaskBody }
> {
  const { session } = useAuth();
  const invalidate = useInvalidateTasks();
  return useMutation<{ task: Task }, ApiError, { id: string; body: UpdateTaskBody }>({
    mutationFn: ({ id, body }) => tasksApi.update(id, body, session),
    onSuccess: invalidate
  });
}

export function useDeleteTask(): UseMutationResult<void, ApiError, string> {
  const { session } = useAuth();
  const invalidate = useInvalidateTasks();
  return useMutation<void, ApiError, string>({
    mutationFn: (id) => tasksApi.remove(id, session),
    onSuccess: invalidate
  });
}

export function useRestoreTask(): UseMutationResult<{ task: Task }, ApiError, string> {
  const { session } = useAuth();
  const invalidate = useInvalidateTasks();
  return useMutation<{ task: Task }, ApiError, string>({
    mutationFn: (id) => tasksApi.restore(id, session),
    onSuccess: invalidate
  });
}
