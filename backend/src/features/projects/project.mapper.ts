/** Database record to client response (spec section 35). */
import type { ProjectResponse, ProjectWithStats } from './project.types';

export function toProjectResponse(record: ProjectWithStats): ProjectResponse {
  // Fields are listed explicitly. A spread with deletions fails open when a new
  // internal column is added; this fails closed.
  return {
    id: record.id,
    name: record.name,
    description: record.description,
    taskCount: record.taskCount,
    openTaskCount: record.openTaskCount,
    createdAt: record.createdAt.toISOString(),
    updatedAt: record.updatedAt.toISOString(),
  };
}
