'use client';

import {
  useMutation,
  useQuery,
  useQueryClient,
  type UseMutationResult,
  type UseQueryResult
} from '@tanstack/react-query';
import { projectsApi, type ListProjectsParams } from './api';
import { useAuth } from '@/lib/auth/auth-provider';
import type {
  CreateProjectBody,
  Project,
  ProjectListResponse,
  UpdateProjectBody
} from '@/types/api';
import { ApiError } from '@/lib/api/errors';

export const projectsKeys = {
  all: ['projects'] as const,
  list: (params: ListProjectsParams) => ['projects', 'list', params] as const
};

export function useProjects(
  params: ListProjectsParams = {}
): UseQueryResult<ProjectListResponse, ApiError> {
  const { session } = useAuth();
  return useQuery<ProjectListResponse, ApiError>({
    queryKey: projectsKeys.list(params),
    queryFn: () => projectsApi.list(params, session)
  });
}

function useInvalidateProjects(): () => void {
  const queryClient = useQueryClient();
  return () => {
    void queryClient.invalidateQueries({ queryKey: projectsKeys.all });
    void queryClient.invalidateQueries({ queryKey: ['tasks'] });
  };
}

export function useCreateProject(): UseMutationResult<
  { project: Project },
  ApiError,
  CreateProjectBody
> {
  const { session } = useAuth();
  const invalidate = useInvalidateProjects();
  return useMutation<{ project: Project }, ApiError, CreateProjectBody>({
    mutationFn: (body) => projectsApi.create(body, session),
    onSuccess: invalidate
  });
}

export function useUpdateProject(): UseMutationResult<
  { project: Project },
  ApiError,
  { id: string; body: UpdateProjectBody }
> {
  const { session } = useAuth();
  const invalidate = useInvalidateProjects();
  return useMutation<{ project: Project }, ApiError, { id: string; body: UpdateProjectBody }>({
    mutationFn: ({ id, body }) => projectsApi.update(id, body, session),
    onSuccess: invalidate
  });
}

export function useDeleteProject(): UseMutationResult<
  void,
  ApiError,
  { id: string; cascade: boolean }
> {
  const { session } = useAuth();
  const invalidate = useInvalidateProjects();
  return useMutation<void, ApiError, { id: string; cascade: boolean }>({
    mutationFn: ({ id, cascade }) => projectsApi.remove(id, cascade, session),
    onSuccess: invalidate
  });
}

export function useRestoreProject(): UseMutationResult<{ project: Project }, ApiError, string> {
  const { session } = useAuth();
  const invalidate = useInvalidateProjects();
  return useMutation<{ project: Project }, ApiError, string>({
    mutationFn: (id) => projectsApi.restore(id, session),
    onSuccess: invalidate
  });
}
