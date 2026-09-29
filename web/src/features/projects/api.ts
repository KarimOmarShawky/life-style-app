/**
 * Projects API — verified against `projects.routes.ts`, `projects.validation.ts`.
 * List response at runtime: `{ data, meta: { nextCursor } }`.
 */

import { apiFetch } from '@/lib/api/client';
import type { AuthSession } from '@/lib/auth/session';
import type {
  CreateProjectBody,
  Project,
  ProjectListResponse,
  UpdateProjectBody
} from '@/types/api';

export interface ListProjectsParams {
  status?: string;
  limit?: number;
  cursor?: string;
}

export const projectsApi = {
  list(params: ListProjectsParams, auth: AuthSession): Promise<ProjectListResponse> {
    return apiFetch<ProjectListResponse>('/projects', {
      query: { status: params.status, limit: params.limit, cursor: params.cursor },
      auth
    });
  },

  get(id: string, auth: AuthSession): Promise<{ project: Project }> {
    return apiFetch<{ project: Project }>(`/projects/${id}`, { auth });
  },

  create(body: CreateProjectBody, auth: AuthSession): Promise<{ project: Project }> {
    return apiFetch<{ project: Project }>('/projects', { method: 'POST', body, auth });
  },

  update(id: string, body: UpdateProjectBody, auth: AuthSession): Promise<{ project: Project }> {
    return apiFetch<{ project: Project }>(`/projects/${id}`, { method: 'PATCH', body, auth });
  },

  remove(id: string, cascade: boolean, auth: AuthSession): Promise<void> {
    return apiFetch<void>(`/projects/${id}`, {
      method: 'DELETE',
      query: cascade ? { cascade: 'true' } : undefined,
      auth
    });
  },

  restore(id: string, auth: AuthSession): Promise<{ project: Project }> {
    return apiFetch<{ project: Project }>(`/projects/${id}/restore`, { method: 'POST', auth });
  }
};
