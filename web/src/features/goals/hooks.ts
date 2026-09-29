'use client';

import {
  useMutation,
  useQuery,
  useQueryClient,
  type UseMutationResult,
  type UseQueryResult
} from '@tanstack/react-query';
import { goalsApi, type ListGoalsParams } from './api';
import { useAuth } from '@/lib/auth/auth-provider';
import type {
  CreateGoalBody,
  Goal,
  GoalListResponse,
  Milestone,
  UpdateGoalBody
} from '@/types/api';
import { ApiError } from '@/lib/api/errors';

export const goalsKeys = {
  all: ['goals'] as const,
  list: (params: ListGoalsParams) => ['goals', 'list', params] as const,
  milestones: (goalId: string) => ['goals', 'milestones', goalId] as const
};

export function useGoals(params: ListGoalsParams): UseQueryResult<GoalListResponse, ApiError> {
  const { session } = useAuth();
  return useQuery<GoalListResponse, ApiError>({
    queryKey: goalsKeys.list(params),
    queryFn: () => goalsApi.list(params, session)
  });
}

export function useGoalMilestones(
  goalId: string | null
): UseQueryResult<{ milestones: Milestone[] }, ApiError> {
  const { session } = useAuth();
  return useQuery<{ milestones: Milestone[] }, ApiError>({
    queryKey: goalsKeys.milestones(goalId ?? 'none'),
    queryFn: () => goalsApi.listMilestones(goalId as string, session),
    enabled: Boolean(goalId)
  });
}

function useInvalidateGoals(): () => void {
  const queryClient = useQueryClient();
  return () => {
    void queryClient.invalidateQueries({ queryKey: goalsKeys.all });
  };
}

export function useCreateGoal(): UseMutationResult<{ goal: Goal }, ApiError, CreateGoalBody> {
  const { session } = useAuth();
  const invalidate = useInvalidateGoals();
  return useMutation({
    mutationFn: (body: CreateGoalBody) => goalsApi.create(body, session),
    onSuccess: invalidate
  });
}

export function useUpdateGoal(): UseMutationResult<
  { goal: Goal },
  ApiError,
  { id: string; body: UpdateGoalBody }
> {
  const { session } = useAuth();
  const invalidate = useInvalidateGoals();
  return useMutation({
    mutationFn: ({ id, body }: { id: string; body: UpdateGoalBody }) =>
      goalsApi.update(id, body, session),
    onSuccess: invalidate
  });
}

export function useDeleteGoal(): UseMutationResult<void, ApiError, string> {
  const { session } = useAuth();
  const invalidate = useInvalidateGoals();
  return useMutation({
    mutationFn: (id: string) => goalsApi.remove(id, session),
    onSuccess: invalidate
  });
}

export function useRestoreGoal(): UseMutationResult<{ goal: Goal }, ApiError, string> {
  const { session } = useAuth();
  const invalidate = useInvalidateGoals();
  return useMutation({
    mutationFn: (id: string) => goalsApi.restore(id, session),
    onSuccess: invalidate
  });
}

export function useCreateMilestone(): UseMutationResult<
  { milestone: Milestone },
  ApiError,
  { goalId: string; title: string; dueDate?: string | null }
> {
  const { session } = useAuth();
  const invalidate = useInvalidateGoals();
  return useMutation({
    mutationFn: ({
      goalId,
      title,
      dueDate
    }: {
      goalId: string;
      title: string;
      dueDate?: string | null;
    }) => goalsApi.createMilestone(goalId, { title, dueDate }, session),
    onSuccess: invalidate
  });
}

export function useUpdateMilestone(): UseMutationResult<
  { milestone: Milestone },
  ApiError,
  {
    goalId: string;
    milestoneId: string;
    body: {
      title?: string;
      dueDate?: string | null;
      completed?: boolean;
      sortOrder?: number;
      version?: number;
    };
  }
> {
  const { session } = useAuth();
  const invalidate = useInvalidateGoals();
  return useMutation({
    mutationFn: ({
      goalId,
      milestoneId,
      body
    }: {
      goalId: string;
      milestoneId: string;
      body: {
        title?: string;
        dueDate?: string | null;
        completed?: boolean;
        sortOrder?: number;
        version?: number;
      };
    }) => goalsApi.updateMilestone(goalId, milestoneId, body, session),
    onSuccess: invalidate
  });
}

export function useDeleteMilestone(): UseMutationResult<
  void,
  ApiError,
  { goalId: string; milestoneId: string }
> {
  const { session } = useAuth();
  const invalidate = useInvalidateGoals();
  return useMutation({
    mutationFn: ({ goalId, milestoneId }: { goalId: string; milestoneId: string }) =>
      goalsApi.deleteMilestone(goalId, milestoneId, session),
    onSuccess: invalidate
  });
}
