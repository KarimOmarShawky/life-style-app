/**
 * Recurring tasks API — verified against `recurring-tasks.routes.ts`,
 * `recurring-tasks.validation.ts` (strict schemas).
 */

import { apiFetch } from '@/lib/api/client';
import type { AuthSession } from '@/lib/auth/session';
import type {
  CreateRecurringTaskBody,
  RecurringTask,
  RecurringTaskListResponse,
  UpdateRecurringTaskBody
} from '@/types/api';

export interface ListRecurringParams {
  status?: string;
  limit?: number;
  cursor?: string;
}

export const recurringTasksApi = {
  list(params: ListRecurringParams, auth: AuthSession): Promise<RecurringTaskListResponse> {
    return apiFetch<RecurringTaskListResponse>('/recurring-tasks', {
      query: { status: params.status, limit: params.limit, cursor: params.cursor },
      auth
    });
  },

  get(id: string, auth: AuthSession): Promise<{ recurringTask: RecurringTask }> {
    return apiFetch<{ recurringTask: RecurringTask }>(`/recurring-tasks/${id}`, { auth });
  },

  create(
    body: CreateRecurringTaskBody,
    auth: AuthSession
  ): Promise<{ recurringTask: RecurringTask }> {
    return apiFetch<{ recurringTask: RecurringTask }>('/recurring-tasks', {
      method: 'POST',
      body,
      auth
    });
  },

  update(
    id: string,
    body: UpdateRecurringTaskBody,
    auth: AuthSession
  ): Promise<{ recurringTask: RecurringTask }> {
    return apiFetch<{ recurringTask: RecurringTask }>(`/recurring-tasks/${id}`, {
      method: 'PATCH',
      body,
      auth
    });
  },

  remove(id: string, auth: AuthSession): Promise<void> {
    return apiFetch<void>(`/recurring-tasks/${id}`, { method: 'DELETE', auth });
  }
};
