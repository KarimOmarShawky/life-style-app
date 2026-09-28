/**
 * src/features/projects/projects.repository.ts
 *
 * Implements Section 4.3 & 6.4: Projects Repository Interface.
 */

import type { ProjectRow, ProjectStatus, ProjectTaskCounts } from './projects.types.js';

export interface CreateProjectDbInput {
  userId: string;
  name: string;
  description?: string | null | undefined;
  status?: ProjectStatus | undefined;
  color?: string | null | undefined;
  goalId?: string | null | undefined;
  dueDate?: string | null | undefined;
}

export interface UpdateProjectDbInput {
  name?: string | undefined;
  description?: string | null | undefined;
  status?: ProjectStatus | undefined;
  color?: string | null | undefined;
  goalId?: string | null | undefined;
  dueDate?: string | null | undefined;
}

export interface ProjectsRepository {
  create(input: CreateProjectDbInput): Promise<ProjectRow>;
  findById(userId: string, id: string): Promise<ProjectRow | null>;
  findActiveById(userId: string, id: string): Promise<ProjectRow | null>;
  update(
    userId: string,
    id: string,
    input: UpdateProjectDbInput,
    expectedVersion?: number
  ): Promise<ProjectRow | null>;
  softDelete(userId: string, id: string, cascade: boolean): Promise<boolean>;
  restore(userId: string, id: string, maxAgeDays?: number): Promise<ProjectRow | null>;
  list(
    userId: string,
    status?: ProjectStatus[],
    limit?: number,
    cursor?: string
  ): Promise<{ projects: ProjectRow[]; nextCursor: string | null }>;
  getTaskCounts(userId: string, projectIds: string[]): Promise<Map<string, ProjectTaskCounts>>;
}
