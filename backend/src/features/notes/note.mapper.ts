/** Stored document to client response (spec section 35). */
import type { LinkResolution, NoteRecord, NoteResponse } from './note.types';

/**
 * Maps one note.
 *
 * `links` is OPTIONAL and omitting it means "the stored ids are known good",
 * which is the case immediately after a write that validated them. Passing an
 * empty resolution instead would null every link, so the two cases are
 * deliberately different arities rather than a value that could be confused.
 *
 * A link whose PostgreSQL row is missing is reported as null. Returning the
 * stored id instead would hand the client an id that 404s on the endpoint it
 * points at, which looks like a bug in that endpoint rather than a deleted row.
 * The stored value is left alone; `reconcileLinks` is what clears it.
 */
export function toNoteResponse(record: NoteRecord, links?: LinkResolution): NoteResponse {
  const resolveProject = (): string | null => {
    if (record.projectId === null || links === undefined) {
      return record.projectId;
    }
    return links.projects.has(record.projectId) ? record.projectId : null;
  };

  const resolveTask = (): string | null => {
    if (record.taskId === null || links === undefined) {
      return record.taskId;
    }
    return links.tasks.has(record.taskId) ? record.taskId : null;
  };

  return {
    id: record.id,
    projectId: resolveProject(),
    taskId: resolveTask(),
    title: record.title,
    content: record.content,
    tags: record.tags,
    isArchived: record.isArchived,
    createdAt: record.createdAt.toISOString(),
    updatedAt: record.updatedAt.toISOString(),
  };
}
