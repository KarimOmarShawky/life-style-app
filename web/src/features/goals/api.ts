/**
 * Goals API — verified against `goals.routes.ts` / `goals.validation.ts`.
 * Runtime list response: `{ goals }` (no pagination).
 */

import { apiFetch } from '@/lib/api/client';
import type { AuthSession } from '@/lib/auth/session';
import type {
  CreateGoalBody,
  Goal,
  GoalListResponse,
  Milestone,
  UpdateGoalBody
} from '@/types/api';

export interface ListGoalsParams {
  status?: string;
  progressType?: string;
  includeDeleted?: boolean;
}

export const goalsApi = {
  list(params: ListGoalsParams, auth: AuthSession): Promise<GoalListResponse> {
    return apiFetch<GoalListResponse>('/goals', {
      query: {
        status: params.status,
        progressType: params.progressType,
        includeDeleted: params.includeDeleted ? 'true' : undefined
      },
      auth
    });
  },

  get(id: string, auth: AuthSession): Promise<{ goal: Goal }> {
    return apiFetch<{ goal: Goal }>(`/goals/${id}`, { auth });
  },

  create(body: CreateGoalBody, auth: AuthSession): Promise<{ goal: Goal }> {
    return apiFetch<{ goal: Goal }>('/goals', { method: 'POST', body, auth });
  },

  update(id: string, body: UpdateGoalBody, auth: AuthSession): Promise<{ goal: Goal }> {
    return apiFetch<{ goal: Goal }>(`/goals/${id}`, { method: 'PATCH', body, auth });
  },

  remove(id: string, auth: AuthSession): Promise<void> {
    return apiFetch<void>(`/goals/${id}`, { method: 'DELETE', auth });
  },

  restore(id: string, auth: AuthSession): Promise<{ goal: Goal }> {
    return apiFetch<{ goal: Goal }>(`/goals/${id}/restore`, { method: 'POST', auth });
  },

  listMilestones(goalId: string, auth: AuthSession): Promise<{ milestones: Milestone[] }> {
    return apiFetch<{ milestones: Milestone[] }>(`/goals/${goalId}/milestones`, { auth });
  },

  createMilestone(
    goalId: string,
    body: { title: string; dueDate?: string | null; sortOrder?: number },
    auth: AuthSession
  ): Promise<{ milestone: Milestone }> {
    return apiFetch<{ milestone: Milestone }>(`/goals/${goalId}/milestones`, {
      method: 'POST',
      body,
      auth
    });
  },

  updateMilestone(
    goalId: string,
    milestoneId: string,
    body: {
      title?: string;
      dueDate?: string | null;
      completed?: boolean;
      sortOrder?: number;
      version?: number;
    },
    auth: AuthSession
  ): Promise<{ milestone: Milestone }> {
    return apiFetch<{ milestone: Milestone }>(`/goals/${goalId}/milestones/${milestoneId}`, {
      method: 'PATCH',
      body,
      auth
    });
  },

  deleteMilestone(goalId: string, milestoneId: string, auth: AuthSession): Promise<void> {
    return apiFetch<void>(`/goals/${goalId}/milestones/${milestoneId}`, {
      method: 'DELETE',
      auth
    });
  }
};
