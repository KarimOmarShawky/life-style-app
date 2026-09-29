'use client';

import {
  useMutation,
  useQuery,
  useQueryClient,
  type UseMutationResult,
  type UseQueryResult
} from '@tanstack/react-query';
import { timerApi, type ListTimerParams } from './api';
import { useAuth } from '@/lib/auth/auth-provider';
import type { CreateTimerSessionBody, TimerSession, TimerSessionListResponse } from '@/types/api';
import { ApiError } from '@/lib/api/errors';

export const timerKeys = {
  all: ['timer-sessions'] as const,
  active: ['timer-sessions', 'active'] as const,
  list: (params: ListTimerParams) => ['timer-sessions', 'list', params] as const
};

export function useActiveTimer(): UseQueryResult<{ timerSession: TimerSession | null }, ApiError> {
  const { session } = useAuth();
  return useQuery<{ timerSession: TimerSession | null }, ApiError>({
    queryKey: timerKeys.active,
    queryFn: () => timerApi.active(session),
    refetchInterval: 30_000
  });
}

export function useTimerSessions(
  params: ListTimerParams
): UseQueryResult<TimerSessionListResponse, ApiError> {
  const { session } = useAuth();
  return useQuery<TimerSessionListResponse, ApiError>({
    queryKey: timerKeys.list(params),
    queryFn: () => timerApi.list(params, session)
  });
}

function useInvalidateTimer(): () => void {
  const queryClient = useQueryClient();
  return () => {
    void queryClient.invalidateQueries({ queryKey: timerKeys.all });
    void queryClient.invalidateQueries({ queryKey: ['tasks'] });
  };
}

export function useStartTimer(): UseMutationResult<
  { timerSession: TimerSession },
  ApiError,
  CreateTimerSessionBody
> {
  const { session } = useAuth();
  const invalidate = useInvalidateTimer();
  return useMutation({
    mutationFn: (body: CreateTimerSessionBody) => timerApi.start(body, session),
    onSuccess: invalidate
  });
}

export function useStopTimer(): UseMutationResult<
  { timerSession: TimerSession },
  ApiError,
  string
> {
  const { session } = useAuth();
  const invalidate = useInvalidateTimer();
  return useMutation({
    mutationFn: (id: string) => timerApi.stop(id, session),
    onSuccess: invalidate
  });
}

export function useDeleteTimerSession(): UseMutationResult<void, ApiError, string> {
  const { session } = useAuth();
  const invalidate = useInvalidateTimer();
  return useMutation({
    mutationFn: (id: string) => timerApi.remove(id, session),
    onSuccess: invalidate
  });
}
