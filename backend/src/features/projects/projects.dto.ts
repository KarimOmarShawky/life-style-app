/**
 * src/features/projects/projects.dto.ts
 *
 * Implements Section 14.5: Projects DTO Serialization.
 */

import type { ProjectRow, ProjectDto, ProjectTaskCounts } from './projects.types.js';

function formatDateOnly(val: Date | string | null): string | null {
  if (!val) return null;
  if (val instanceof Date) {
    return val.toISOString().slice(0, 10);
  }
  return val.slice(0, 10);
}

function formatIso(val: Date | string | null): string | null {
  if (!val) return null;
  if (val instanceof Date) {
    return val.toISOString();
  }
  return new Date(val).toISOString();
}

export function toProjectDto(row: ProjectRow, counts?: ProjectTaskCounts): ProjectDto {
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    status: row.status,
    color: row.color,
    goalId: row.goal_id,
    dueDate: formatDateOnly(row.due_date),
    createdAt: formatIso(row.created_at)!,
    updatedAt: formatIso(row.updated_at)!,
    version: row.version,
    taskCounts: counts ?? { open: 0, done: 0 }
  };
}
