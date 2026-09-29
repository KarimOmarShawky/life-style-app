/**
 * Tasks API — verified against `tasks.routes.ts`, `tasks.controller.ts`,
 * `tasks.validation.ts` (strict schemas: unknown params are rejected).
 */

import { apiFetch } from '@/lib/api/client';
import type { AuthSession } from '@/lib/auth/session';
import type { CreateTaskBody, Task, TaskListResponse, UpdateTaskBody } from '@/types/api';

export interface ListTasksParams {
  status?: string;
  priority?: string;
  projectId?: string;
  dueFrom?: string;
  dueTo?: string;
  plannedDate?: string;
  overdue?: boolean;
  isFocus?: boolean;
  completedFrom?: string;
  completedTo?: string;
  sort?: 'dueDate' | 'priority' | 'createdAt' | 'updatedAt';
  order?: 'asc' | 'desc';
  limit?: number;
  cursor?: string;
}

export const tasksApi = {
  list(params: ListTasksParams, auth: AuthSession): Promise<TaskListResponse> {
    const query: Record<string, string | number | boolean | undefined> = {
      status: params.status,
      priority: params.priority,
      projectId: params.projectId,
      dueFrom: params.dueFrom,
      dueTo: params.dueTo,
      plannedDate: params.plannedDate,
      overdue: params.overdue,
      isFocus: params.isFocus,
      completedFrom: params.completedFrom,
      completedTo: params.completedTo,
      sort: params.sort,
      order: params.order,
      limit: params.limit,
      cursor: params.cursor
    };
    return apiFetch<TaskListResponse>('/tasks', { query, auth });
  },

  get(id: string, auth: AuthSession): Promise<{ task: Task }> {
    return apiFetch<{ task: Task }>(`/tasks/${id}`, { auth });
  },

  create(body: CreateTaskBody, auth: AuthSession): Promise<{ task: Task }> {
    return apiFetch<{ task: Task }>('/tasks', { method: 'POST', body, auth });
  },

  update(id: string, body: UpdateTaskBody, auth: AuthSession): Promise<{ task: Task }> {
    return apiFetch<{ task: Task }>(`/tasks/${id}`, { method: 'PATCH', body, auth });
  },

  remove(id: string, auth: AuthSession): Promise<void> {
    return apiFetch<void>(`/tasks/${id}`, { method: 'DELETE', auth });
  },

  restore(id: string, auth: AuthSession): Promise<{ task: Task }> {
    return apiFetch<{ task: Task }>(`/tasks/${id}/restore`, { method: 'POST', auth });
  }
};
