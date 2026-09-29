'use client';

import {
  useMutation,
  useQuery,
  useQueryClient,
  type UseMutationResult,
  type UseQueryResult
} from '@tanstack/react-query';
import { notesApi, type CreateNoteInput, type ListNotesParams, type UpdateNoteInput } from './api';
import { useAuth } from '@/lib/auth/auth-provider';
import type { Note, NoteLink, NoteListResponse, TagCount } from '@/types/api';
import { ApiError } from '@/lib/api/errors';

export const notesKeys = {
  all: ['notes'] as const,
  list: (params: ListNotesParams) => ['notes', 'list', params] as const,
  detail: (id: string) => ['notes', 'detail', id] as const,
  tags: ['notes', 'tags'] as const,
  links: (id: string) => ['notes', 'links', id] as const
};

export function useNotes(params: ListNotesParams): UseQueryResult<NoteListResponse, ApiError> {
  const { session } = useAuth();
  return useQuery<NoteListResponse, ApiError>({
    queryKey: notesKeys.list(params),
    queryFn: () => notesApi.list(params, session)
  });
}

export function useNoteTags(): UseQueryResult<{ tags: TagCount[] }, ApiError> {
  const { session } = useAuth();
  return useQuery<{ tags: TagCount[] }, ApiError>({
    queryKey: notesKeys.tags,
    queryFn: () => notesApi.tags(session)
  });
}

export function useNote(id: string | null): UseQueryResult<{ note: Note }, ApiError> {
  const { session } = useAuth();
  return useQuery<{ note: Note }, ApiError>({
    queryKey: notesKeys.detail(id ?? 'none'),
    queryFn: () => notesApi.get(id as string, session),
    enabled: Boolean(id)
  });
}

export function useNoteLinks(id: string | null): UseQueryResult<{ links: NoteLink[] }, ApiError> {
  const { session } = useAuth();
  return useQuery<{ links: NoteLink[] }, ApiError>({
    queryKey: notesKeys.links(id ?? 'none'),
    queryFn: () => notesApi.listLinks(id as string, session),
    enabled: Boolean(id)
  });
}

function useInvalidateNotes(): () => void {
  const queryClient = useQueryClient();
  return () => {
    void queryClient.invalidateQueries({ queryKey: notesKeys.all });
  };
}

export function useCreateNote(): UseMutationResult<{ note: Note }, ApiError, CreateNoteInput> {
  const { session } = useAuth();
  const invalidate = useInvalidateNotes();
  return useMutation({
    mutationFn: (body: CreateNoteInput) => notesApi.create(body, session),
    onSuccess: invalidate
  });
}

export function useUpdateNote(): UseMutationResult<
  { note: Note },
  ApiError,
  { id: string; body: UpdateNoteInput }
> {
  const { session } = useAuth();
  const invalidate = useInvalidateNotes();
  return useMutation({
    mutationFn: ({ id, body }: { id: string; body: UpdateNoteInput }) =>
      notesApi.update(id, body, session),
    onSuccess: invalidate
  });
}

export function useDeleteNote(): UseMutationResult<void, ApiError, string> {
  const { session } = useAuth();
  const invalidate = useInvalidateNotes();
  return useMutation({
    mutationFn: (id: string) => notesApi.remove(id, session),
    onSuccess: invalidate
  });
}

export function useRestoreNote(): UseMutationResult<{ note: Note }, ApiError, string> {
  const { session } = useAuth();
  const invalidate = useInvalidateNotes();
  return useMutation({
    mutationFn: (id: string) => notesApi.restore(id, session),
    onSuccess: invalidate
  });
}

export function useAddNoteLink(): UseMutationResult<
  { link: NoteLink },
  ApiError,
  { noteId: string; entityType: 'task' | 'project' | 'goal' | 'habit' | 'event'; entityId: string }
> {
  const { session } = useAuth();
  const invalidate = useInvalidateNotes();
  return useMutation({
    mutationFn: ({
      noteId,
      entityType,
      entityId
    }: {
      noteId: string;
      entityType: 'task' | 'project' | 'goal' | 'habit' | 'event';
      entityId: string;
    }) => notesApi.addLink(noteId, { entityType, entityId }, session),
    onSuccess: invalidate
  });
}

export function useRemoveNoteLink(): UseMutationResult<
  void,
  ApiError,
  { noteId: string; linkId: string }
> {
  const { session } = useAuth();
  const invalidate = useInvalidateNotes();
  return useMutation({
    mutationFn: ({ noteId, linkId }: { noteId: string; linkId: string }) =>
      notesApi.removeLink(noteId, linkId, session),
    onSuccess: invalidate
  });
}
