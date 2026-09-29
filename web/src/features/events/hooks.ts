'use client';

import {
  useMutation,
  useQuery,
  useQueryClient,
  type UseMutationResult,
  type UseQueryResult
} from '@tanstack/react-query';
import { eventsApi, type ListEventsParams } from './api';
import { useAuth } from '@/lib/auth/auth-provider';
import type {
  AgendaResponse,
  CreateEventBody,
  Event,
  EventListResponse,
  Reminder,
  UpdateEventBody
} from '@/types/api';
import { ApiError } from '@/lib/api/errors';

export const eventsKeys = {
  all: ['events'] as const,
  list: (params: ListEventsParams) => ['events', 'list', params] as const,
  agenda: (date: string) => ['events', 'agenda', date] as const,
  reminders: (id: string) => ['events', 'reminders', id] as const
};

export function useEvents(params: ListEventsParams): UseQueryResult<EventListResponse, ApiError> {
  const { session } = useAuth();
  return useQuery<EventListResponse, ApiError>({
    queryKey: eventsKeys.list(params),
    queryFn: () => eventsApi.list(params, session)
  });
}

export function useAgenda(date: string): UseQueryResult<AgendaResponse, ApiError> {
  const { session } = useAuth();
  return useQuery<AgendaResponse, ApiError>({
    queryKey: eventsKeys.agenda(date),
    queryFn: () => eventsApi.agenda(date, session)
  });
}

export function useEventReminders(
  id: string | null
): UseQueryResult<{ reminders: Reminder[] }, ApiError> {
  const { session } = useAuth();
  return useQuery<{ reminders: Reminder[] }, ApiError>({
    queryKey: eventsKeys.reminders(id ?? 'none'),
    queryFn: () => eventsApi.listReminders(id as string, session),
    enabled: Boolean(id)
  });
}

function useInvalidateEvents(): () => void {
  const queryClient = useQueryClient();
  return () => {
    void queryClient.invalidateQueries({ queryKey: eventsKeys.all });
  };
}

export function useCreateEvent(): UseMutationResult<{ event: Event }, ApiError, CreateEventBody> {
  const { session } = useAuth();
  const invalidate = useInvalidateEvents();
  return useMutation({
    mutationFn: (body: CreateEventBody) => eventsApi.create(body, session),
    onSuccess: invalidate
  });
}

export function useUpdateEvent(): UseMutationResult<
  { event: Event },
  ApiError,
  { id: string; body: UpdateEventBody }
> {
  const { session } = useAuth();
  const invalidate = useInvalidateEvents();
  return useMutation({
    mutationFn: ({ id, body }: { id: string; body: UpdateEventBody }) =>
      eventsApi.update(id, body, session),
    onSuccess: invalidate
  });
}

export function useDeleteEvent(): UseMutationResult<void, ApiError, string> {
  const { session } = useAuth();
  const invalidate = useInvalidateEvents();
  return useMutation({
    mutationFn: (id: string) => eventsApi.remove(id, session),
    onSuccess: invalidate
  });
}

export function useRestoreEvent(): UseMutationResult<{ event: Event }, ApiError, string> {
  const { session } = useAuth();
  const invalidate = useInvalidateEvents();
  return useMutation({
    mutationFn: (id: string) => eventsApi.restore(id, session),
    onSuccess: invalidate
  });
}

export function useAddReminder(): UseMutationResult<
  { reminder: Reminder },
  ApiError,
  { eventId: string; channel: 'push' | 'in_app' | 'email'; offsetMinutes?: number | null }
> {
  const { session } = useAuth();
  const invalidate = useInvalidateEvents();
  return useMutation({
    mutationFn: ({
      eventId,
      channel,
      offsetMinutes
    }: {
      eventId: string;
      channel: 'push' | 'in_app' | 'email';
      offsetMinutes?: number | null;
    }) => eventsApi.addReminder(eventId, { channel, offsetMinutes }, session),
    onSuccess: invalidate
  });
}

export function useDeleteReminder(): UseMutationResult<
  void,
  ApiError,
  { eventId: string; reminderId: string }
> {
  const { session } = useAuth();
  const invalidate = useInvalidateEvents();
  return useMutation({
    mutationFn: ({ eventId, reminderId }: { eventId: string; reminderId: string }) =>
      eventsApi.deleteReminder(eventId, reminderId, session),
    onSuccess: invalidate
  });
}
