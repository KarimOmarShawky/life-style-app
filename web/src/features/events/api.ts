/**
 * Calendar events API — verified against `calendar.routes.ts` /
 * `calendar.validation.ts`.
 *
 * Runtime response shapes: `{ events }`, `{ event }`, `{ reminders }`,
 * `{ reminder }`, agenda `{ date, events, totalEvents }`,
 * conflicts `{ hasConflict, conflicts }`, 204 on deletes.
 * Event timestamps are absolute ISO instants; `timezone` names the zone the
 * user composed the event in.
 */

import { apiFetch } from '@/lib/api/client';
import type { AuthSession } from '@/lib/auth/session';
import type {
  AgendaResponse,
  ConflictResponse,
  CreateEventBody,
  Event,
  EventListResponse,
  Reminder,
  UpdateEventBody
} from '@/types/api';

export interface ListEventsParams {
  from?: string;
  to?: string;
  includeDeleted?: boolean;
}

export const eventsApi = {
  list(params: ListEventsParams, auth: AuthSession): Promise<EventListResponse> {
    return apiFetch<EventListResponse>('/events', {
      query: {
        from: params.from,
        to: params.to,
        includeDeleted: params.includeDeleted ? 'true' : undefined
      },
      auth
    });
  },

  agenda(date: string | undefined, auth: AuthSession): Promise<AgendaResponse> {
    return apiFetch<AgendaResponse>('/events/agenda', {
      query: date ? { date } : undefined,
      auth
    });
  },

  conflicts(
    startAt: string,
    endAt: string,
    excludeEventId: string | undefined,
    auth: AuthSession
  ): Promise<ConflictResponse> {
    return apiFetch<ConflictResponse>('/events/conflicts', {
      query: { startAt, endAt, excludeEventId },
      auth
    });
  },

  get(id: string, auth: AuthSession): Promise<{ event: Event }> {
    return apiFetch<{ event: Event }>(`/events/${id}`, { auth });
  },

  create(body: CreateEventBody, auth: AuthSession): Promise<{ event: Event }> {
    return apiFetch<{ event: Event }>('/events', { method: 'POST', body, auth });
  },

  update(id: string, body: UpdateEventBody, auth: AuthSession): Promise<{ event: Event }> {
    return apiFetch<{ event: Event }>(`/events/${id}`, { method: 'PATCH', body, auth });
  },

  remove(id: string, auth: AuthSession): Promise<void> {
    return apiFetch<void>(`/events/${id}`, { method: 'DELETE', auth });
  },

  restore(id: string, auth: AuthSession): Promise<{ event: Event }> {
    return apiFetch<{ event: Event }>(`/events/${id}/restore`, { method: 'POST', auth });
  },

  listReminders(id: string, auth: AuthSession): Promise<{ reminders: Reminder[] }> {
    return apiFetch<{ reminders: Reminder[] }>(`/events/${id}/reminders`, { auth });
  },

  addReminder(
    id: string,
    body: {
      channel: 'push' | 'in_app' | 'email';
      offsetMinutes?: number | null;
      remindAt?: string;
    },
    auth: AuthSession
  ): Promise<{ reminder: Reminder }> {
    return apiFetch<{ reminder: Reminder }>(`/events/${id}/reminders`, {
      method: 'POST',
      body,
      auth
    });
  },

  deleteReminder(id: string, reminderId: string, auth: AuthSession): Promise<void> {
    return apiFetch<void>(`/events/${id}/reminders/${reminderId}`, { method: 'DELETE', auth });
  }
};
