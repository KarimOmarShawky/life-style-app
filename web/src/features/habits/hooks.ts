'use client';

import {
  useMutation,
  useQuery,
  useQueryClient,
  type UseMutationResult,
  type UseQueryResult
} from '@tanstack/react-query';
import { habitsApi, type ListHabitsParams } from './api';
import { useAuth } from '@/lib/auth/auth-provider';
import type {
  CheckinListResponse,
  CreateHabitBody,
  HabitCheckinDto,
  HabitCheckinStatus,
  HabitDto,
  HabitListResponse,
  TodayProgressResponse,
  UpdateHabitBody
} from '@/types/api';
import { ApiError } from '@/lib/api/errors';

export const habitsKeys = {
  all: ['habits'] as const,
  list: (params: ListHabitsParams) => ['habits', 'list', params] as const,
  today: () => ['habits', 'today'] as const,
  checkins: (id: string, from: string, to: string) => ['habits', 'checkins', id, from, to] as const
};

export function useHabits(params: ListHabitsParams): UseQueryResult<HabitListResponse, ApiError> {
  const { session } = useAuth();
  return useQuery<HabitListResponse, ApiError>({
    queryKey: habitsKeys.list(params),
    queryFn: () => habitsApi.list(params, session)
  });
}

/**
 * Aggregate progress for the user's *today* (server resolves the date from
 * the authenticated user's timezone — the endpoint takes no date parameter).
 */
export function useTodayProgress(): UseQueryResult<TodayProgressResponse, ApiError> {
  const { session } = useAuth();
  return useQuery<TodayProgressResponse, ApiError>({
    queryKey: habitsKeys.today(),
    queryFn: () => habitsApi.today(session)
  });
}

export function useHabitCheckins(
  id: string | null,
  from: string,
  to: string
): UseQueryResult<CheckinListResponse, ApiError> {
  const { session } = useAuth();
  return useQuery<CheckinListResponse, ApiError>({
    queryKey: habitsKeys.checkins(id ?? 'none', from, to),
    queryFn: () => habitsApi.checkins(id as string, from, to, session),
    enabled: Boolean(id)
  });
}

function useInvalidateHabits(): () => void {
  const queryClient = useQueryClient();
  return () => {
    void queryClient.invalidateQueries({ queryKey: habitsKeys.all });
  };
}

export function useCreateHabit(): UseMutationResult<
  { habit: HabitDto },
  ApiError,
  CreateHabitBody
> {
  const { session } = useAuth();
  const invalidate = useInvalidateHabits();
  return useMutation({
    mutationFn: (body: CreateHabitBody) => habitsApi.create(body, session),
    onSuccess: invalidate
  });
}

export function useUpdateHabit(): UseMutationResult<
  { habit: HabitDto },
  ApiError,
  { id: string; body: UpdateHabitBody }
> {
  const { session } = useAuth();
  const invalidate = useInvalidateHabits();
  return useMutation({
    mutationFn: ({ id, body }: { id: string; body: UpdateHabitBody }) =>
      habitsApi.update(id, body, session),
    onSuccess: invalidate
  });
}

export function useDeleteHabit(): UseMutationResult<void, ApiError, string> {
  const { session } = useAuth();
  const invalidate = useInvalidateHabits();
  return useMutation({
    mutationFn: (id: string) => habitsApi.remove(id, session),
    onSuccess: invalidate
  });
}

export function useRestoreHabit(): UseMutationResult<{ habit: HabitDto }, ApiError, string> {
  const { session } = useAuth();
  const invalidate = useInvalidateHabits();
  return useMutation({
    mutationFn: (id: string) => habitsApi.restore(id, session),
    onSuccess: invalidate
  });
}

export interface PutCheckinInput {
  habitId: string;
  date: string;
  status: HabitCheckinStatus;
  note?: string | null;
}

export function usePutCheckin(): UseMutationResult<
  { checkin: HabitCheckinDto; habit: HabitDto },
  ApiError,
  PutCheckinInput
> {
  const { session } = useAuth();
  const invalidate = useInvalidateHabits();
  return useMutation({
    mutationFn: ({ habitId, date, status, note }: PutCheckinInput) =>
      habitsApi.putCheckin(habitId, date, { status, note }, session),
    onSuccess: invalidate
  });
}

export function useDeleteCheckin(): UseMutationResult<
  void,
  ApiError,
  { habitId: string; date: string }
> {
  const { session } = useAuth();
  const invalidate = useInvalidateHabits();
  return useMutation({
    mutationFn: ({ habitId, date }: { habitId: string; date: string }) =>
      habitsApi.deleteCheckin(habitId, date, session),
    onSuccess: invalidate
  });
}
