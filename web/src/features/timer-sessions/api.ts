/**
 * Timer sessions API — verified against `timer-sessions.routes.ts` /
 * `timer-sessions.validation.ts`.
 *
 * Runtime response shapes: `{ timerSession }`, `{ timerSession: null }`,
 * list `{ data, meta: { nextCursor } }`, stop → 200 `{ timerSession }`,
 * delete → 204.
 */

import { apiFetch } from '@/lib/api/client';
import type { AuthSession } from '@/lib/auth/session';
import type {
  ActiveTimerResponse,
  CreateTimerSessionBody,
  TimerSession,
  TimerSessionListResponse
} from '@/types/api';

export interface ListTimerParams {
  taskId?: string;
  from?: string;
  to?: string;
  limit?: number;
  cursor?: string;
}

export const timerApi = {
  active(auth: AuthSession): Promise<ActiveTimerResponse> {
    return apiFetch<ActiveTimerResponse>('/timer-sessions/active', { auth });
  },

  list(params: ListTimerParams, auth: AuthSession): Promise<TimerSessionListResponse> {
    return apiFetch<TimerSessionListResponse>('/timer-sessions', {
      query: {
        taskId: params.taskId,
        from: params.from,
        to: params.to,
        limit: params.limit,
        cursor: params.cursor
      },
      auth
    });
  },

  start(body: CreateTimerSessionBody, auth: AuthSession): Promise<{ timerSession: TimerSession }> {
    return apiFetch<{ timerSession: TimerSession }>('/timer-sessions', {
      method: 'POST',
      body,
      auth
    });
  },

  stop(id: string, auth: AuthSession): Promise<{ timerSession: TimerSession }> {
    return apiFetch<{ timerSession: TimerSession }>(`/timer-sessions/${id}/stop`, {
      method: 'POST',
      auth
    });
  },

  remove(id: string, auth: AuthSession): Promise<void> {
    return apiFetch<void>(`/timer-sessions/${id}`, { method: 'DELETE', auth });
  }
};
