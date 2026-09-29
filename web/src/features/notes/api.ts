/**
 * Notes API — verified against `notes.routes.ts` / `notes.validation.ts`.
 * List response: `{ notes }` (NoteListItem: excerpt, no body). Detail:
 * `{ note }` with full body + links. Tags: `{ tags }`.
 */

import { apiFetch } from '@/lib/api/client';
import type { AuthSession } from '@/lib/auth/session';
import type { Note, NoteLink, NoteListResponse, TagCount } from '@/types/api';

export interface ListNotesParams {
  q?: string;
  tag?: string;
  isPinned?: boolean;
  taskId?: string;
  projectId?: string;
  goalId?: string;
  habitId?: string;
  eventId?: string;
}

export interface CreateNoteInput {
  title?: string | null;
  body?: string;
  tags?: string[];
  isPinned?: boolean;
  links?: Array<{ entityType: 'task' | 'project' | 'goal' | 'habit' | 'event'; entityId: string }>;
}

export interface UpdateNoteInput {
  title?: string | null;
  body?: string;
  tags?: string[];
  isPinned?: boolean;
  version?: number;
}

export const notesApi = {
  list(params: ListNotesParams, auth: AuthSession): Promise<NoteListResponse> {
    return apiFetch<NoteListResponse>('/notes', {
      query: {
        q: params.q,
        tag: params.tag,
        isPinned: params.isPinned === undefined ? undefined : String(params.isPinned),
        taskId: params.taskId,
        projectId: params.projectId,
        goalId: params.goalId,
        habitId: params.habitId,
        eventId: params.eventId
      },
      auth
    });
  },

  tags(auth: AuthSession): Promise<{ tags: TagCount[] }> {
    return apiFetch<{ tags: TagCount[] }>('/notes/tags', { auth });
  },

  get(id: string, auth: AuthSession): Promise<{ note: Note }> {
    return apiFetch<{ note: Note }>(`/notes/${id}`, { auth });
  },

  create(body: CreateNoteInput, auth: AuthSession): Promise<{ note: Note }> {
    return apiFetch<{ note: Note }>('/notes', { method: 'POST', body, auth });
  },

  update(id: string, body: UpdateNoteInput, auth: AuthSession): Promise<{ note: Note }> {
    return apiFetch<{ note: Note }>(`/notes/${id}`, { method: 'PATCH', body, auth });
  },

  remove(id: string, auth: AuthSession): Promise<void> {
    return apiFetch<void>(`/notes/${id}`, { method: 'DELETE', auth });
  },

  restore(id: string, auth: AuthSession): Promise<{ note: Note }> {
    return apiFetch<{ note: Note }>(`/notes/${id}/restore`, { method: 'POST', auth });
  },

  listLinks(id: string, auth: AuthSession): Promise<{ links: NoteLink[] }> {
    return apiFetch<{ links: NoteLink[] }>(`/notes/${id}/links`, { auth });
  },

  addLink(
    id: string,
    body: { entityType: 'task' | 'project' | 'goal' | 'habit' | 'event'; entityId: string },
    auth: AuthSession
  ): Promise<{ link: NoteLink }> {
    return apiFetch<{ link: NoteLink }>(`/notes/${id}/links`, { method: 'POST', body, auth });
  },

  removeLink(id: string, linkId: string, auth: AuthSession): Promise<void> {
    return apiFetch<void>(`/notes/${id}/links/${linkId}`, { method: 'DELETE', auth });
  }
};
