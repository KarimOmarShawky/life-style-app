/**
 * Habits API — verified against `habits.routes.ts` / `habits.validation.ts`.
 * NOTE: runtime contract differs from OpenAPI (see web/docs/api-verification.md):
 * list query = {status,limit,cursor} (not includeArchived), response
 * `{ data, meta: { nextCursor } }` (not `{ habits }`), checkin body field is
 * `note` (not `notes`), status enum is done|skipped, checkins query uses
 * required `from`/`to`.
 */

import { apiFetch } from '@/lib/api/client';
import type { AuthSession } from '@/lib/auth/session';
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

export interface ListHabitsParams {
  status?: string;
  limit?: number;
  cursor?: string;
}

export const habitsApi = {
  list(params: ListHabitsParams, auth: AuthSession): Promise<HabitListResponse> {
    return apiFetch<HabitListResponse>('/habits', {
      query: { status: params.status, limit: params.limit, cursor: params.cursor },
      auth
    });
  },

  today(auth: AuthSession): Promise<TodayProgressResponse> {
    return apiFetch<TodayProgressResponse>('/habits/progress/today', { auth });
  },

  get(id: string, auth: AuthSession): Promise<{ habit: HabitDto }> {
    return apiFetch<{ habit: HabitDto }>(`/habits/${id}`, { auth });
  },

  create(body: CreateHabitBody, auth: AuthSession): Promise<{ habit: HabitDto }> {
    return apiFetch<{ habit: HabitDto }>('/habits', { method: 'POST', body, auth });
  },

  update(id: string, body: UpdateHabitBody, auth: AuthSession): Promise<{ habit: HabitDto }> {
    return apiFetch<{ habit: HabitDto }>(`/habits/${id}`, { method: 'PATCH', body, auth });
  },

  remove(id: string, auth: AuthSession): Promise<void> {
    return apiFetch<void>(`/habits/${id}`, { method: 'DELETE', auth });
  },

  restore(id: string, auth: AuthSession): Promise<{ habit: HabitDto }> {
    return apiFetch<{ habit: HabitDto }>(`/habits/${id}/restore`, { method: 'POST', auth });
  },

  checkins(id: string, from: string, to: string, auth: AuthSession): Promise<CheckinListResponse> {
    return apiFetch<CheckinListResponse>(`/habits/${id}/checkins`, {
      query: { from, to },
      auth
    });
  },

  putCheckin(
    id: string,
    date: string,
    body: { status: HabitCheckinStatus; note?: string | null },
    auth: AuthSession
  ): Promise<{ checkin: HabitCheckinDto; habit: HabitDto }> {
    return apiFetch<{ checkin: HabitCheckinDto; habit: HabitDto }>(
      `/habits/${id}/checkins/${date}`,
      { method: 'PUT', body, auth }
    );
  },

  deleteCheckin(id: string, date: string, auth: AuthSession): Promise<void> {
    return apiFetch<void>(`/habits/${id}/checkins/${date}`, { method: 'DELETE', auth });
  }
};
